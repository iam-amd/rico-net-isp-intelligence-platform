"""
Rico Net — Ingest Service
==========================
Business logic for writing ONU snapshots and alarm events from the OLT proxy.
No FastAPI imports — pure DB + domain logic.

Fixes applied (Migration 005):
  - Alarm dedup: increment occurrence_count + last_seen instead of creating new rows
  - Auto-resolve open alarms when ONU comes back online
  - Rx power validation: reject values outside [-50, -5] dBm range
  - Signal sudden drop detection: alert when Rx drops >3 dBm in one poll
  - Temperature threshold: alert when ONU temp > 65°C
  - onu_state_events: write on every status transition (not every poll)
  - PON port outage correlation: ≥3 ONUs on same port in 60s window
  - Area outage detection: ≥3 ONUs within 600m in 120s window
  - OLT health tracking: update olt_health on each successful ingest
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

import models
from schemas.ingest import AlarmEventCreate, CollectorHeartbeat, ONUSnapshotBatch
from services import alarm_service, diagnosis_service

logger = logging.getLogger("rico_net.ingest_service")

# ─── Signal thresholds ────────────────────────────────────────────────────────
RX_MIN_VALID = -50.0    # Below this = sensor error
RX_MAX_VALID = -5.0     # Above this = sensor error / near-end reflection
RX_CRITICAL  = -27.0
RX_WEAK      = -24.0
RX_DROP_ALERT_DBM = 3.0  # Drop of ≥3 dBm in one poll = signal_drop event
TEMP_HIGH_C  = 65.0      # Above this = high_temp event


# =============================================================================
# ONU SNAPSHOTS
# =============================================================================

def record_collector_heartbeat(db: Session, heartbeat: CollectorHeartbeat) -> Dict[str, Any]:
    """Upsert Raspberry Pi / OLT poller heartbeat independent of snapshot success."""
    now = datetime.now(timezone.utc)
    heartbeat_at = heartbeat.heartbeat_at or now
    db.execute(
        text("""
            INSERT INTO collector_health (
                collector_id, collector_name, collector_hostname, collector_ip,
                collector_version, collector_started_at, last_heartbeat_at,
                last_snapshot_at, last_status, last_message, backend_url,
                configured_olts, last_batch_total, heartbeat_count, updated_at
            )
            VALUES (
                :collector_id, :collector_name, :collector_hostname, :collector_ip,
                :collector_version, :collector_started_at, :heartbeat_at,
                :last_snapshot_at, :status, :message, :backend_url,
                CAST(:configured_olts AS jsonb), :last_batch_total, 1, NOW()
            )
            ON CONFLICT (collector_id) DO UPDATE SET
                collector_name       = COALESCE(EXCLUDED.collector_name, collector_health.collector_name),
                collector_hostname   = COALESCE(EXCLUDED.collector_hostname, collector_health.collector_hostname),
                collector_ip         = COALESCE(EXCLUDED.collector_ip, collector_health.collector_ip),
                collector_version    = COALESCE(EXCLUDED.collector_version, collector_health.collector_version),
                collector_started_at = COALESCE(EXCLUDED.collector_started_at, collector_health.collector_started_at),
                last_heartbeat_at    = EXCLUDED.last_heartbeat_at,
                last_snapshot_at     = COALESCE(EXCLUDED.last_snapshot_at, collector_health.last_snapshot_at),
                last_status          = EXCLUDED.last_status,
                last_message         = EXCLUDED.last_message,
                backend_url          = COALESCE(EXCLUDED.backend_url, collector_health.backend_url),
                configured_olts      = COALESCE(EXCLUDED.configured_olts, collector_health.configured_olts),
                last_batch_total     = COALESCE(EXCLUDED.last_batch_total, collector_health.last_batch_total),
                heartbeat_count      = collector_health.heartbeat_count + 1,
                updated_at           = NOW()
        """),
        {
            "collector_id": heartbeat.collector_id,
            "collector_name": heartbeat.collector_name,
            "collector_hostname": heartbeat.collector_hostname,
            "collector_ip": heartbeat.collector_ip,
            "collector_version": heartbeat.collector_version,
            "collector_started_at": heartbeat.collector_started_at,
            "heartbeat_at": heartbeat_at,
            "last_snapshot_at": heartbeat.last_snapshot_at,
            "status": heartbeat.status,
            "message": heartbeat.message,
            "backend_url": heartbeat.backend_url,
            "configured_olts": json.dumps(heartbeat.configured_olts or []),
            "last_batch_total": heartbeat.last_batch_total,
        },
    )
    db.commit()
    return {
        "status": "ok",
        "collector_id": heartbeat.collector_id,
        "heartbeat_at": heartbeat_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

def insert_onu_snapshots(db: Session, batch: ONUSnapshotBatch) -> Dict[str, Any]:
    """
    Process a snapshot batch from the OLT poller:
      1. Validate and clean incoming data
      2. Detect status transitions vs onu_latest (online→offline, offline→online)
      3. Detect signal sudden drops and threshold crossings
      4. Detect temperature alerts
      5. Bulk-insert valid snapshot rows (ON CONFLICT DO NOTHING for retries)
      6. UPSERT onu_latest with newest state
      7. Write onu_state_events for every transition
      8. Open/resolve alarms for new offline/online transitions
      9. Check PON port outage + area outage correlation
     10. Update olt_health for this OLT
    """
    now = datetime.now(timezone.utc)
    if not batch.onus:
        return {"inserted": 0, "polled_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}

    olt_host = batch.onus[0].olt_host or "unknown"
    collector = {
        "collector_id": batch.collector_id,
        "collector_name": batch.collector_name,
        "collector_hostname": batch.collector_hostname,
        "collector_ip": batch.collector_ip,
        "collector_version": batch.collector_version,
        "collector_started_at": batch.collector_started_at,
    }

    # ── 1. Load current state for all MACs in this batch ────────────────────
    mac_list = [item.mac_address for item in batch.onus]
    current_state: Dict[str, Dict] = {}
    if mac_list:
        rows = db.execute(
            text("""
                SELECT mac_address, status, rx_power_dbm, temperature_c,
                       pon_port, onu_index, olt_host
                FROM onu_latest
                WHERE mac_address = ANY(:macs)
            """),
            {"macs": mac_list},
        ).fetchall()
        for row in rows:
            current_state[row[0]] = {
                "status": row[1],
                "rx_power_dbm": row[2],
                "temperature_c": row[3],
                "pon_port": row[4],
                "onu_index": row[5],
                "olt_host": row[6],
            }

    # ── 2. Validate, categorize, build snapshot rows ─────────────────────────
    snapshot_rows = []
    newly_offline: Set[str] = set()
    newly_online: Set[str] = set()
    signal_drops: Dict[str, tuple] = {}     # mac → (old_rx, new_rx)
    threshold_crossings: Dict[str, tuple] = {}  # mac → (old_level, new_level)
    temp_alerts: Set[str] = set()
    observed_state: Dict[str, Dict[str, Any]] = {}
    host_counts: Dict[str, int] = {}

    for item in batch.onus:
        mac = item.mac_address
        item_olt_host = item.olt_host or "unknown"
        host_counts[item_olt_host] = host_counts.get(item_olt_host, 0) + 1
        observed_state[mac] = {
            "olt_host": item_olt_host,
            "pon_port": item.pon_port,
            "onu_index": item.onu_index,
        }
        polled_at = item.polled_at if item.polled_at is not None else now

        # Validate Rx power — reject sensor errors
        rx = item.rx_power_dbm
        if rx is not None and not (RX_MIN_VALID <= rx <= RX_MAX_VALID):
            logger.debug(
                "ingest: invalid Rx %.1f dBm for %s - rejected (sensor error)",
                rx, mac,
            )
            rx = None  # Store NULL instead of garbage value

        prev = current_state.get(mac, {})
        prev_status = prev.get("status")
        prev_rx = prev.get("rx_power_dbm")
        prev_temp = prev.get("temperature_c")
        new_status = item.status

        # Status transition detection
        if prev_status == "online" and new_status != "online":
            newly_offline.add(mac)
        elif prev_status is not None and prev_status != "online" and new_status == "online":
            newly_online.add(mac)

        # Signal drop detection (≥3 dBm fall in one poll)
        if rx is not None and prev_rx is not None and (prev_rx - rx) >= RX_DROP_ALERT_DBM:
            signal_drops[mac] = (prev_rx, rx)

        # Threshold crossing detection
        if rx is not None and prev_rx is not None:
            old_level = alarm_service._signal_level(prev_rx)
            new_level = alarm_service._signal_level(rx)
            if old_level != new_level and new_level is not None:
                threshold_crossings[mac] = (old_level, new_level)

        # Temperature alert
        temp = item.temperature_c
        if temp is not None and temp > TEMP_HIGH_C:
            if prev_temp is None or prev_temp <= TEMP_HIGH_C:
                # Just crossed threshold — not already alerting
                temp_alerts.add(mac)

        snapshot_rows.append({
            "mac_address": mac,
            "olt_host": item_olt_host,
            "pon_port": item.pon_port,
            "onu_index": item.onu_index,
            "status": new_status,
            "rx_power_dbm": rx,
            "tx_power_dbm": item.tx_power_dbm,
            "temperature_c": temp,
            "voltage_mv": item.voltage_mv,
            "flap_count": item.flap_count,
            "dying_gasp": item.dying_gasp,
            "distance_m": item.distance_m,
            "rx_bytes_delta": item.rx_bytes_delta,
            "tx_bytes_delta": item.tx_bytes_delta,
            "alive_time_sec": item.alive_time_sec,
            "rtt_ns": item.rtt_ns,
            "tx_bias_current_ma": item.tx_bias_current_ma,
            "polled_at": polled_at,
            "ont_serial_number": item.ont_serial_number,
        })

    # ── 3. Bulk insert snapshots (ON CONFLICT DO NOTHING prevents retry dupes) ─
    inserted = 0
    if snapshot_rows:
        result = db.execute(
            text("""
                INSERT INTO onu_snapshots
                    (mac_address, olt_host, pon_port, onu_index, status,
                     rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
                     flap_count, dying_gasp, distance_m, rx_bytes_delta,
                     tx_bytes_delta, alive_time_sec, rtt_ns, tx_bias_current_ma,
                     polled_at, ont_serial_number)
                VALUES
                    (:mac_address, :olt_host, :pon_port, :onu_index, :status,
                     :rx_power_dbm, :tx_power_dbm, :temperature_c, :voltage_mv,
                     :flap_count, :dying_gasp, :distance_m, :rx_bytes_delta,
                     :tx_bytes_delta, :alive_time_sec, :rtt_ns, :tx_bias_current_ma,
                     :polled_at, :ont_serial_number)
                ON CONFLICT (mac_address, polled_at) DO NOTHING
            """),
            snapshot_rows,
        )
        inserted = result.rowcount if result.rowcount >= 0 else len(snapshot_rows)

    # ── 4. UPSERT onu_latest ──────────────────────────────────────────────────
    _upsert_onu_latest(db, batch, now, validated_rx={r["mac_address"]: r["rx_power_dbm"] for r in snapshot_rows})

    db.commit()

    def _context_for_mac(mac: str) -> Dict[str, Any]:
        observed = observed_state.get(mac, {})
        previous = current_state.get(mac, {})
        return {
            "olt_host": observed.get("olt_host") or previous.get("olt_host") or olt_host,
            "pon_port": observed.get("pon_port") or previous.get("pon_port"),
            "onu_index": (
                observed.get("onu_index")
                if observed.get("onu_index") is not None
                else previous.get("onu_index")
            ),
        }

    # ── 5. Write onu_state_events for transitions ─────────────────────────────
    for mac in newly_offline:
        prev = current_state.get(mac, {})
        ctx = _context_for_mac(mac)
        alarm_service.record_state_change(
            db, mac, ctx["olt_host"],
            ctx["pon_port"], ctx["onu_index"],
            from_state="online", to_state="offline",
            event_type="status_change",
            rx_power_dbm=prev.get("rx_power_dbm"),
            occurred_at=now,
        )

    for mac in newly_online:
        ctx = _context_for_mac(mac)
        alarm_service.record_state_change(
            db, mac, ctx["olt_host"],
            ctx["pon_port"], ctx["onu_index"],
            from_state="offline", to_state="online",
            event_type="status_change",
            rx_power_dbm=None,
            occurred_at=now,
        )

    for mac, (old_rx, new_rx) in signal_drops.items():
        ctx = _context_for_mac(mac)
        alarm_service.record_state_change(
            db, mac, ctx["olt_host"],
            ctx["pon_port"], ctx["onu_index"],
            from_state=f"{old_rx:.1f}dBm", to_state=f"{new_rx:.1f}dBm",
            event_type="signal_drop",
            rx_power_dbm=new_rx,
            occurred_at=now,
        )

    for mac, (old_level, new_level) in threshold_crossings.items():
        if old_level and new_level:
            ctx = _context_for_mac(mac)
            alarm_service.record_state_change(
                db, mac, ctx["olt_host"],
                ctx["pon_port"], ctx["onu_index"],
                from_state=old_level, to_state=new_level,
                event_type="threshold_crossed" if _level_worse(old_level, new_level) else "threshold_recovered",
                rx_power_dbm=current_state.get(mac, {}).get("rx_power_dbm"),
                occurred_at=now,
            )

    if newly_offline or newly_online or signal_drops or threshold_crossings:
        db.commit()

    # ── 6. Alarms for newly offline ONUs ────────────────────────────────────
    for mac in newly_offline:
        try:
            diagnosis_service.process_offline_outage(db, mac)
        except Exception as exc:
            logger.error("offline_outage diagnosis failed for %s: %s", mac, exc)

    # ── 7. Temperature alerts ─────────────────────────────────────────────────
    for mac in temp_alerts:
        try:
            onu = db.query(models.ONULatest).filter(
                models.ONULatest.mac_address == mac
            ).first()
            alarm_service.open_alarm(
                db, mac, "HIGH_TEMP",
                olt_host=onu.olt_host if onu else olt_host,
                pon_port=onu.pon_port if onu else None,
                onu_index=onu.onu_index if onu else None,
                payload={"temperature_c": onu.temperature_c if onu else None},
                received_at=now,
            )
            logger.warning("ingest: HIGH_TEMP alarm for %s", mac)
        except Exception as exc:
            logger.error("high_temp alarm failed for %s: %s", mac, exc)

    # ── 8. Signal drop alarms ─────────────────────────────────────────────────
    for mac, (old_rx, new_rx) in signal_drops.items():
        try:
            onu = db.query(models.ONULatest).filter(
                models.ONULatest.mac_address == mac
            ).first()
            # Only alarm if dropped into WEAK or CRITICAL zone
            if new_rx < RX_WEAK:
                event_type = "FIBER_CRITICAL" if new_rx < RX_CRITICAL else "FIBER_WEAK"
                alarm_service.open_alarm(
                    db, mac, event_type,
                    olt_host=onu.olt_host if onu else olt_host,
                    pon_port=onu.pon_port if onu else None,
                    onu_index=onu.onu_index if onu else None,
                    payload={"old_rx_dbm": old_rx, "new_rx_dbm": new_rx, "drop_dbm": round(old_rx - new_rx, 2)},
                    received_at=now,
                )
        except Exception as exc:
            logger.error("signal_drop alarm failed for %s: %s", mac, exc)

    # ── 9. Auto-resolve alarms for ONUs that came back online ────────────────
    for mac in newly_online:
        try:
            resolved = alarm_service.handle_onu_online(db, mac, now)
            if resolved:
                logger.info("ingest: auto-resolved %d alarm(s) for recovered ONU %s", resolved, mac)
            diagnosis_service.process_online_recovery(db, mac)
            # Check if PON port outage can be cleared
            ctx = _context_for_mac(mac)
            if ctx.get("pon_port"):
                alarm_service.resolve_pon_port_outage_if_clear(db, ctx["olt_host"], ctx["pon_port"], now)
        except Exception as exc:
            logger.error("online_recovery failed for %s: %s", mac, exc)

    # ── 10. PON port and area outage checks (for newly offline ONUs) ─────────
    _check_outages(db, newly_offline, olt_host, current_state, observed_state, now)

    # ── 11. Update OLT health ────────────────────────────────────────────────
    try:
        for host, count in host_counts.items():
            alarm_service.update_olt_health_snapshot(
                db,
                host,
                now,
                collector=collector,
                batch_size=count,
            )
        db.commit()
    except Exception as exc:
        logger.warning("olt_health update failed: %s", exc)

    polled_at_str = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    logger.info(
        "insert_onu_snapshots: %d inserted, %d to offline, %d to online, host=%s",
        inserted, len(newly_offline), len(newly_online), olt_host,
    )
    return {"inserted": inserted, "polled_at": polled_at_str}


def _check_outages(
    db: Session,
    newly_offline: Set[str],
    olt_host: str,
    current_state: Dict[str, Dict],
    observed_state: Dict[str, Dict[str, Any]],
    now: datetime,
) -> None:
    """Run PON port outage and area outage checks for newly offline ONUs."""
    if not newly_offline:
        return

    affected: Dict[tuple, Set[str]] = {}
    for mac in newly_offline:
        observed = observed_state.get(mac, {})
        previous = current_state.get(mac, {})
        host = observed.get("olt_host") or previous.get("olt_host") or olt_host
        pon_port = observed.get("pon_port") or previous.get("pon_port")
        affected.setdefault((host, pon_port), set()).add(mac)

    # Check per PON port
    for host, pon_port in affected:
        if not pon_port:
            continue
        try:
            outage = alarm_service.check_pon_port_outage(db, host, pon_port, now)
            if outage:
                logger.warning(
                    "ingest: PON port outage id=%d on %s port %s",
                    outage.id, host, pon_port,
                )
        except Exception as exc:
            logger.error("pon_port_outage check failed: %s", exc)

    for host in {host for host, _ in affected}:
        try:
            outage = alarm_service.check_area_outage(db, host, None, now)
            if outage:
                logger.warning(
                    "ingest: area outage id=%d - %d ONUs offline near (%.4f, %.4f)",
                    outage.id, outage.affected_count,
                    outage.centroid_lat or 0, outage.centroid_lng or 0,
                )
        except Exception as exc:
            logger.error("area_outage check failed: %s", exc)
    return

    # Check area outage (uses GPS + address fallback)
    try:
        outage = alarm_service.check_area_outage(db, olt_host, None, now)
        if outage:
            logger.warning(
                "ingest: area outage id=%d - %d ONUs offline near (%.4f, %.4f)",
                outage.id, outage.affected_count,
                outage.centroid_lat or 0, outage.centroid_lng or 0,
            )
    except Exception as exc:
        logger.error("area_outage check failed: %s", exc)


def _level_worse(old: str, new: str) -> bool:
    order = {"excellent": 0, "good": 1, "weak": 2, "critical": 3}
    return order.get(new, 0) > order.get(old, 0)


# =============================================================================
# ALARM EVENTS (from SNMP trap receiver)
# =============================================================================

def insert_alarm_event(db: Session, event: AlarmEventCreate) -> models.AlarmEvent:
    """
    Process a single alarm event from the SNMP trap receiver or poller.

    Uses alarm_service.open_alarm() for proper lifecycle management:
      - LIFECYCLE_TYPES (ONU_OFFLINE, DYING_GASP, etc.): dedup + increment
      - ONU_ONLINE: resolve all open offline alarms for this MAC
      - All events: update olt_health.last_trap_at
      - Non-system events: run auto-diagnosis
    """
    received_at = event.received_at if event.received_at is not None else datetime.now(timezone.utc)

    # Silently drop system audit traps (Telnet login notifications)
    if event.event_type == "SYSTEM_AUDIT":
        logger.debug("ingest: SYSTEM_AUDIT trap dropped (mac=%s)", event.mac_address)
        # Return a dummy-like object by fetching the most recent alarm (safe for caller)
        existing = db.execute(
            text("SELECT id FROM alarm_events ORDER BY id DESC LIMIT 1")
        ).fetchone()
        if existing:
            return db.get(models.AlarmEvent, existing[0])
        # Edge case: no alarms yet — create a suppressed placeholder
        alarm = models.AlarmEvent(
            mac_address=event.mac_address,
            event_type="SYSTEM_AUDIT",
            olt_host=event.olt_host,
            pon_port=event.pon_port,
            onu_index=event.onu_index,
            payload=event.payload,
            received_at=received_at,
            status="suppressed",
        )
        db.add(alarm)
        db.commit()
        db.refresh(alarm)
        return alarm

    # Update OLT health — trap means OLT is alive
    if event.olt_host:
        try:
            alarm_service.update_olt_health_trap(db, event.olt_host, received_at)
        except Exception:
            pass

    # ONU_ONLINE: resolve open offline alarms, update onu_latest, no new alarm row
    if event.event_type == "ONU_ONLINE":
        try:
            resolved = alarm_service.handle_onu_online(db, event.mac_address, received_at)
            if resolved:
                logger.info(
                    "ingest: ONU_ONLINE trap resolved %d alarm(s) for %s",
                    resolved, event.mac_address,
                )
            # Update onu_latest status to online from trap
            db.execute(
                text("UPDATE onu_latest SET status='online', updated_at=NOW() WHERE mac_address=:mac"),
                {"mac": event.mac_address},
            )
            # Write state event
            alarm_service.record_state_change(
                db, event.mac_address,
                olt_host=event.olt_host or "",
                pon_port=event.pon_port,
                onu_index=event.onu_index,
                from_state="offline", to_state="online",
                event_type="status_change",
                occurred_at=received_at,
            )
            # Check if PON port outage can be cleared
            if event.olt_host and event.pon_port:
                alarm_service.resolve_pon_port_outage_if_clear(
                    db, event.olt_host, event.pon_port, received_at,
                )
            diagnosis_service.process_online_recovery(db, event.mac_address)
            db.commit()
        except Exception as exc:
            logger.error("online_recovery (trap) failed for %s: %s", event.mac_address, exc)

        # Return the most-recently-resolved alarm for caller (router expects AlarmEvent)
        last = db.execute(
            text("""
                SELECT id FROM alarm_events
                WHERE mac_address=:mac
                ORDER BY received_at DESC LIMIT 1
            """),
            {"mac": event.mac_address},
        ).fetchone()
        if last:
            return db.get(models.AlarmEvent, last[0])
        # No prior alarms — create an informational ONU_ONLINE record
        alarm = models.AlarmEvent(
            mac_address=event.mac_address,
            event_type="ONU_ONLINE",
            olt_host=event.olt_host,
            pon_port=event.pon_port,
            onu_index=event.onu_index,
            payload=event.payload,
            received_at=received_at,
            status="resolved",
        )
        db.add(alarm)
        db.commit()
        db.refresh(alarm)
        return alarm

    # All other event types: open or increment alarm via alarm_service
    alarm = alarm_service.open_alarm(
        db,
        mac_address=event.mac_address,
        event_type=event.event_type,
        olt_host=event.olt_host,
        pon_port=event.pon_port,
        onu_index=event.onu_index,
        payload=event.payload,
        received_at=received_at,
    )

    # Update onu_latest status for offline traps
    if event.event_type in {"ONU_OFFLINE", "ONU_OFFLINE_GPON", "DYING_GASP"}:
        db.execute(
            text("UPDATE onu_latest SET status='offline', updated_at=NOW() WHERE mac_address=:mac"),
            {"mac": event.mac_address},
        )
        alarm_service.record_state_change(
            db, event.mac_address,
            olt_host=event.olt_host or "",
            pon_port=event.pon_port,
            onu_index=event.onu_index,
            from_state="online", to_state="offline",
            event_type="status_change",
            occurred_at=received_at,
        )
        db.commit()

        # PON port outage check
        if event.olt_host and event.pon_port:
            try:
                alarm_service.check_pon_port_outage(
                    db, event.olt_host, event.pon_port, received_at,
                )
            except Exception as exc:
                logger.error("pon_outage check failed: %s", exc)

        # Area outage check
        try:
            alarm_service.check_area_outage(db, event.olt_host or "", event.pon_port, received_at)
        except Exception as exc:
            logger.error("area_outage check failed: %s", exc)

    # Run auto-diagnosis (creates ticket if customer linked)
    try:
        diagnosis_service.process_alarm(db, alarm)
    except Exception as exc:
        logger.error("diagnosis failed for alarm %d: %s", alarm.id, exc)

    logger.info(
        "insert_alarm_event: id=%d type=%s mac=%s status=%s",
        alarm.id, alarm.event_type, alarm.mac_address, alarm.status,
    )
    return alarm


# =============================================================================
# Internal helpers
# =============================================================================

def _upsert_onu_latest(
    db: Session,
    batch: ONUSnapshotBatch,
    now: datetime,
    validated_rx: Optional[Dict[str, Optional[float]]] = None,
) -> None:
    """Bulk UPSERT into onu_latest. Uses validated Rx values (NULLed if out of range)."""
    if not batch.onus:
        return
    if validated_rx is None:
        validated_rx = {}

    db.execute(text("""
        INSERT INTO onu_latest (mac_address, olt_host, pon_port, onu_index, status,
                                rx_power_dbm, tx_power_dbm, temperature_c, voltage_mv,
                                dying_gasp, polled_at, updated_at,
                                vendor_id, model_id, hw_version, sw_version,
                                deregister_reason, alive_time_sec, rtt_ns, tx_bias_current_ma,
                                ont_serial_number)
        VALUES (:mac_address, :olt_host, :pon_port, :onu_index, :status,
                :rx_power_dbm, :tx_power_dbm, :temperature_c, :voltage_mv,
                :dying_gasp, :polled_at, NOW(),
                :vendor_id, :model_id, :hw_version, :sw_version,
                :deregister_reason, :alive_time_sec, :rtt_ns, :tx_bias_current_ma,
                :ont_serial_number)
        ON CONFLICT (mac_address) DO UPDATE SET
            olt_host           = EXCLUDED.olt_host,
            pon_port           = EXCLUDED.pon_port,
            onu_index          = EXCLUDED.onu_index,
            status             = EXCLUDED.status,
            rx_power_dbm       = EXCLUDED.rx_power_dbm,
            tx_power_dbm       = EXCLUDED.tx_power_dbm,
            temperature_c      = EXCLUDED.temperature_c,
            voltage_mv         = EXCLUDED.voltage_mv,
            dying_gasp         = EXCLUDED.dying_gasp,
            polled_at          = EXCLUDED.polled_at,
            updated_at         = NOW(),
            vendor_id          = COALESCE(EXCLUDED.vendor_id,  onu_latest.vendor_id),
            model_id           = COALESCE(EXCLUDED.model_id,   onu_latest.model_id),
            hw_version         = COALESCE(EXCLUDED.hw_version, onu_latest.hw_version),
            sw_version         = COALESCE(EXCLUDED.sw_version, onu_latest.sw_version),
            deregister_reason  = COALESCE(EXCLUDED.deregister_reason, onu_latest.deregister_reason),
            alive_time_sec     = COALESCE(EXCLUDED.alive_time_sec, onu_latest.alive_time_sec),
            rtt_ns             = COALESCE(EXCLUDED.rtt_ns, onu_latest.rtt_ns),
            tx_bias_current_ma = COALESCE(EXCLUDED.tx_bias_current_ma, onu_latest.tx_bias_current_ma),
            ont_serial_number  = COALESCE(EXCLUDED.ont_serial_number, onu_latest.ont_serial_number)
    """), [
        {
            "mac_address":       item.mac_address,
            "olt_host":          item.olt_host or "",
            "pon_port":          item.pon_port,
            "onu_index":         item.onu_index,
            "status":            item.status,
            "rx_power_dbm":      validated_rx.get(item.mac_address, item.rx_power_dbm),
            "tx_power_dbm":      item.tx_power_dbm,
            "temperature_c":     item.temperature_c,
            "voltage_mv":        item.voltage_mv,
            "dying_gasp":        item.dying_gasp,
            "polled_at":         item.polled_at if item.polled_at else now,
            "vendor_id":         item.vendor_id,
            "model_id":          item.model_id,
            "hw_version":        item.hw_version,
            "sw_version":        item.sw_version,
            "deregister_reason": item.deregister_reason,
            "alive_time_sec":    item.alive_time_sec,
            "rtt_ns":            item.rtt_ns,
            "tx_bias_current_ma": item.tx_bias_current_ma,
            "ont_serial_number": item.ont_serial_number,
        }
        for item in batch.onus
    ])
