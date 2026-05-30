"""
Rico Net â€” Railwire â†’ PostgreSQL Sync Daemon (v2)
====================================================
Incrementally syncs SQLite scraper data to the main PostgreSQL database.

Improvements over v1:
  â€¢ Incremental sync â€” uses last_synced_at watermark so only NEW or UPDATED
    records are transferred; full sync avoided on every cycle
  â€¢ Health metrics written to ScraperHealth table after each cycle
  â€¢ Separate phase for marking PostgreSQL customers as "not_found" (scraped flag)
  â€¢ Graceful reconnect on PG transient failure
  â€¢ Structured logging with per-cycle stats

Usage:
  python sync_daemon.py           # Continuous daemon (every 30 s)
  python sync_daemon.py --once    # Run one cycle then exit
"""

import sqlite3
import logging
import time
import os
import sys
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session as PGSession

from runtime_paths import sync_watermark_file

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
except ImportError:
    pass  # python-dotenv optional

# â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

SCRAPER_DIR   = os.path.dirname(os.path.abspath(__file__))
SQLITE_PATH   = os.path.join(SCRAPER_DIR, "rico_net.db")
PG_URL        = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost/rico_net_demo")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL_SECONDS", "30"))

# Watermark file â€” stores ISO timestamp of last successful sync
WATERMARK_FILE = str(sync_watermark_file())
LEGACY_WATERMARK_FILE = os.path.join(SCRAPER_DIR, ".sync_watermark")

# â”€â”€ Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

LOG_FILE = os.path.join(SCRAPER_DIR, "sync_daemon.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | [SYNC] | %(levelname)-8s | %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger("SyncDaemon")


# â”€â”€ Watermark helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def read_watermark() -> Optional[str]:
    try:
        with open(WATERMARK_FILE) as f:
            return f.read().strip() or None
    except FileNotFoundError:
        try:
            with open(LEGACY_WATERMARK_FILE) as f:
                value = f.read().strip() or None
            if value:
                write_watermark(value)
            return value
        except FileNotFoundError:
            return None


def write_watermark(ts: str):
    with open(WATERMARK_FILE, "w") as f:
        f.write(ts)


# â”€â”€ SQLite helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def sqlite_connect() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


# â”€â”€ ScraperHealth sync â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _set_pg_health(pg_conn, key: str, value: str):
    """Upsert a health key-value in the scraper_health table (if it exists in PG)."""
    try:
        pg_conn.execute(
            text("""
                INSERT INTO scraper_health (key, value, updated_at)
                VALUES (:key, :value, :ts)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
            """),
            {"key": key, "value": value, "ts": datetime.now(timezone.utc).isoformat()},
        )
    except Exception:
        pass  # scraper_health may not exist in PG â€” that's fine


# â”€â”€ Main sync logic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _parse_dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _active_status(value) -> bool:
    return (value or "").strip().lower() in {"active", "online", "enabled"}


def _expired(value, now: datetime) -> bool:
    dt = _parse_dt(value)
    if not dt:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < now


def _billing_blocked(status, expiry, now: datetime) -> bool:
    return not _active_status(status) or _expired(expiry, now)


def _billing_restored(status, expiry, connection_status, now: datetime) -> bool:
    if (connection_status or "").strip().lower() == "inactive":
        return False
    return _active_status(status) and not _expired(expiry, now)


def _max_source_ts(*values):
    parsed = [_parse_dt(value) for value in values]
    parsed = [value for value in parsed if value is not None]
    if not parsed:
        return None
    normalized = [
        value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        for value in parsed
    ]
    return max(normalized)


class SyncDaemon:
    def __init__(self):
        self.pg_engine = create_engine(PG_URL, pool_pre_ping=True)
        self.total_synced = 0
        logger.info("Sync Daemon v2 initialized")
        logger.info(f"  SQLite  : {SQLITE_PATH}")
        logger.info(f"  PG      : {PG_URL.split('@')[-1]}")   # hide password
        logger.info(f"  Interval: {SYNC_INTERVAL}s")

    # ------------------------------------------------------------------
    # Customers
    # ------------------------------------------------------------------

    def sync_customers(self, since: Optional[str]) -> tuple[int, int, str]:
        """
        Sync customers modified after `since`.
        Returns (upserted, errors, new_watermark).
        """
        sqlite_conn = sqlite_connect()
        cur = sqlite_conn.cursor()

        if since:
            cur.execute(
                """
                SELECT railwire_id, username, full_name, email, mobile_number,
                       full_address, plan_name, expiry_date, account_balance,
                       account_status, mac_address, framed_ip, monthly_data_used_mb,
                       railwire_status, last_seen_in_railwire,
                       mac_scraped_at, detail_scraped_at, last_synced_at,
                       railwire_admin,
                       mac_scrape_attempts, mac_last_attempt_at, mac_last_error
                FROM customers
                WHERE last_synced_at > ? OR mac_scraped_at > ? OR detail_scraped_at > ?
                ORDER BY last_synced_at DESC
                """,
                (since, since, since),
            )
        else:
            # First run â€” full sync
            logger.info("No watermark found â€” performing full customer sync")
            cur.execute(
                """
                SELECT railwire_id, username, full_name, email, mobile_number,
                       full_address, plan_name, expiry_date, account_balance,
                       account_status, mac_address, framed_ip, monthly_data_used_mb,
                       railwire_status, last_seen_in_railwire,
                       mac_scraped_at, detail_scraped_at, last_synced_at,
                       railwire_admin,
                       mac_scrape_attempts, mac_last_attempt_at, mac_last_error
                FROM customers
                ORDER BY last_synced_at DESC
                """
            )

        rows = cur.fetchall()
        sqlite_conn.close()

        if not rows:
            return 0, 0, since or datetime.now(timezone.utc).isoformat()

        upserted = errors = 0
        new_wm = since or ""
        now = datetime.now(timezone.utc)

        with self.pg_engine.connect() as pg_conn:
            for r in rows:
                try:
                    # Split full name
                    full = (r["full_name"] or "").strip()
                    parts = full.split(" ", 1)
                    first = parts[0] if parts else ""
                    last  = parts[1] if len(parts) > 1 else ""

                    # Balance
                    try:
                        balance = float(r["account_balance"]) if r["account_balance"] else 0.0
                    except (ValueError, TypeError):
                        balance = 0.0

                    # Monthly data
                    try:
                        monthly_data = float(r["monthly_data_used_mb"]) if r["monthly_data_used_mb"] else None
                    except (ValueError, TypeError):
                        monthly_data = None

                    # railwire_status drives the connection_status flag.
                    # Scraped MACs are evidence only; authoritative identity lives in onu_bindings.
                    rw_status = r["railwire_status"] or "active"
                    conn_status = "inactive" if rw_status == "not_found" else (
                        "active" if r["mac_address"] else "unknown"
                    )
                    incoming_status = "Inactive" if conn_status == "inactive" else r["account_status"]
                    existing_pg = pg_conn.execute(
                        text("""
                            SELECT status, expiry_date, connection_status
                            FROM customers
                            WHERE username = :username
                        """),
                        {"username": r["username"]},
                    ).fetchone()

                    rwa = r["railwire_admin"] if "railwire_admin" in r.keys() else None
                    if rwa == "default":
                        rwa = None
                    keys = r.keys()
                    mac_attempts = r["mac_scrape_attempts"] if "mac_scrape_attempts" in keys else None
                    mac_last_at  = r["mac_last_attempt_at"]  if "mac_last_attempt_at"  in keys else None
                    mac_last_err = r["mac_last_error"]       if "mac_last_error"       in keys else None
                    pg_conn.execute(
                        text("""
                            INSERT INTO customers
                              (username, first_name, last_name, phone, email,
                               railwire_address, plan_name, expiry_date, balance,
                               status, mac_address, framed_ip, monthly_data_used_mb,
                               connection_status, railwire_admin, railwire_status,
                               mac_scrape_attempts, mac_last_attempt_at, mac_last_error)
                            VALUES
                              (:username, :first_name, :last_name, :phone, :email,
                               :address, :plan, :expiry, :balance,
                               :status, :mac, :framed_ip, :monthly_data,
                               :conn_status, :rwa, :rw_status,
                               :mac_attempts, :mac_last_at, :mac_last_err)
                            ON CONFLICT (username) DO UPDATE SET
                                first_name           = EXCLUDED.first_name,
                                last_name            = EXCLUDED.last_name,
                                phone                = COALESCE(EXCLUDED.phone, customers.phone),
                                email                = COALESCE(EXCLUDED.email, customers.email),
                                railwire_address     = COALESCE(EXCLUDED.railwire_address, customers.railwire_address),
                                plan_name            = COALESCE(EXCLUDED.plan_name, customers.plan_name),
                                expiry_date          = EXCLUDED.expiry_date,
                                balance              = EXCLUDED.balance,
                                status               = CASE
                                    WHEN EXCLUDED.connection_status = 'inactive' THEN 'Inactive'
                                    ELSE EXCLUDED.status
                                END,
                                -- MAC: never overwrite an existing MAC with NULL. The scraper
                                -- preserves old MAC if a customer is offline at scrape time
                                -- (see scraper.py upsert_customer), and we mirror that here.
                                mac_address          = COALESCE(EXCLUDED.mac_address, customers.mac_address),
                                framed_ip            = COALESCE(EXCLUDED.framed_ip, customers.framed_ip),
                                monthly_data_used_mb = COALESCE(EXCLUDED.monthly_data_used_mb, customers.monthly_data_used_mb),
                                connection_status    = EXCLUDED.connection_status,
                                railwire_admin       = COALESCE(EXCLUDED.railwire_admin, customers.railwire_admin),
                                railwire_status      = EXCLUDED.railwire_status,
                                mac_scrape_attempts  = COALESCE(EXCLUDED.mac_scrape_attempts, customers.mac_scrape_attempts),
                                mac_last_attempt_at  = COALESCE(EXCLUDED.mac_last_attempt_at, customers.mac_last_attempt_at),
                                mac_last_error       = EXCLUDED.mac_last_error
                        """),
                        {
                            "username": r["username"],
                            "first_name": first,
                            "last_name": last,
                            "phone": r["mobile_number"],
                            "email": r["email"],
                            "address": r["full_address"],
                            "plan": r["plan_name"],
                            "expiry": r["expiry_date"],
                            "balance": balance,
                            "status": incoming_status,
                            "mac": (r["mac_address"] or None),
                            "framed_ip": r["framed_ip"],
                            "monthly_data": monthly_data,
                            "conn_status": conn_status,
                            "rwa": rwa,
                            "rw_status": rw_status,
                            "mac_attempts": int(mac_attempts) if mac_attempts is not None else 0,
                            "mac_last_at": mac_last_at,
                            "mac_last_err": mac_last_err,
                        },
                    )
                    upserted += 1

                    # Emit activity events so /pipeline activity feed reflects
                    # new customers + draft/active flips + MAC discoveries.
                    try:
                        self._emit_customer_activity(
                            pg_conn,
                            existing_pg=existing_pg,
                            username=r["username"],
                            rw_status=rw_status,
                            mac=r["mac_address"],
                            mac_last_err=mac_last_err,
                            plan=r["plan_name"],
                            now=now,
                        )
                    except Exception as e:
                        logger.debug(f"activity emit failed for {r['username']}: {e}")

                    if (
                        existing_pg
                        and _billing_blocked(existing_pg.status, existing_pg.expiry_date, now)
                        and _billing_restored(incoming_status, r["expiry_date"], conn_status, now)
                    ):
                        self._apply_billing_recovery(pg_conn, r["username"], now)

                    # â”€â”€ onu_bindings: track every scraped MAC as a 'railwire_scraped' binding â”€â”€
                    # Rule: never overwrite a higher-confidence binding (field_scan, tech_scan, manual).
                    # We maintain exactly one railwire_scraped row per customer.
                    if r["mac_address"]:
                        self._sync_onu_binding(pg_conn, r["username"], r["mac_address"], now)

                    self._record_customer_provenance(
                        pg_conn,
                        username=r["username"],
                        field_names=[
                            "first_name", "last_name", "phone", "email", "railwire_address",
                            "plan_name", "expiry_date", "balance", "status", "framed_ip",
                            "monthly_data_used_mb", "connection_status",
                        ],
                        now=now,
                    )
                    self._record_customer_sync_state(
                        pg_conn,
                        username=r["username"],
                        csv_synced_at=_parse_dt(r["last_synced_at"]),
                        details_synced_at=_parse_dt(r["detail_scraped_at"]),
                        mac_synced_at=_parse_dt(r["mac_scraped_at"]),
                        source_updated_at=_max_source_ts(
                            r["last_synced_at"],
                            r["detail_scraped_at"],
                            r["mac_scraped_at"],
                        ),
                        status="success",
                        error=None,
                        now=now,
                    )

                    # Track new watermark
                    ts = r["last_synced_at"] or r["mac_scraped_at"] or r["detail_scraped_at"]
                    if ts and ts > new_wm:
                        new_wm = ts

                except Exception as exc:
                    errors += 1
                    try:
                        self._record_customer_sync_state(
                            pg_conn,
                            username=r["username"],
                            csv_synced_at=_parse_dt(r["last_synced_at"]),
                            details_synced_at=_parse_dt(r["detail_scraped_at"]),
                            mac_synced_at=_parse_dt(r["mac_scraped_at"]),
                            source_updated_at=_max_source_ts(
                                r["last_synced_at"],
                                r["detail_scraped_at"],
                                r["mac_scraped_at"],
                            ),
                            status="error",
                            error=str(exc)[:1000],
                            now=now,
                        )
                    except Exception:
                        pass
                    logger.debug(f"Customer sync error ({r['username']}): {exc}")

            pg_conn.commit()

        return upserted, errors, new_wm or datetime.now(timezone.utc).isoformat()

    def _emit_customer_activity(
        self,
        pg_conn,
        *,
        existing_pg,
        username: str,
        rw_status: str,
        mac: str | None,
        mac_last_err: str | None,
        plan: str | None,
        now: datetime,
    ):
        """Append rows to activity_events for the operator-visible changes:
          customer.new_in_csv          â€” first time we see this username
          customer.removed_from_csv    â€” railwire_status flipped to not_found
          customer.restored_in_csv     â€” was draft, now back in CSV
          scraper.mac_found            â€” MAC just transitioned NULL â†’ value
          scraper.mac_failed           â€” mac_last_error is set (non-NULL)
        """
        prev_status = None
        prev_mac = None
        if existing_pg is not None:
            # existing_pg is a Row; access by attribute or index where possible
            try:
                prev_status = getattr(existing_pg, "connection_status", None)
            except Exception:
                prev_status = None
            try:
                # earlier code didn't select mac into existing_pg; do a tiny lookup
                row = pg_conn.execute(
                    text("SELECT mac_address FROM customers WHERE username = :u"),
                    {"u": username},
                ).fetchone()
                prev_mac = row[0] if row else None
            except Exception:
                prev_mac = None

        events: list[tuple[str, str, str, dict]] = []  # (category, severity, summary, payload)

        if existing_pg is None:
            events.append((
                "customer.new_in_csv",
                "info",
                f"New customer {username} appeared in Railwire CSV",
                {"plan": plan, "railwire_status": rw_status},
            ))

        if rw_status == "not_found" and prev_status != "inactive":
            events.append((
                "customer.removed_from_csv",
                "warning",
                f"Customer {username} no longer in Railwire CSV (flagged draft)",
                {"prev_status": prev_status},
            ))
        elif rw_status == "active" and existing_pg is not None and prev_status == "inactive":
            events.append((
                "customer.restored_in_csv",
                "info",
                f"Customer {username} reappeared in Railwire CSV (active again)",
                {},
            ))

        if mac and not prev_mac:
            events.append((
                "scraper.mac_found",
                "info",
                f"MAC discovered for {username}: {mac}",
                {"mac": mac},
            ))

        if mac_last_err and not mac:
            # Distinguish expired vs other failure modes for richer feed.
            cat = "scraper.subscriber_expired" if mac_last_err == "subscriber_expired" else "scraper.mac_failed"
            sev = "warning" if mac_last_err in ("no_mac_on_page", "subscriber_expired") else "info"
            events.append((
                cat,
                sev,
                f"MAC scrape outcome for {username}: {mac_last_err}",
                {"reason": mac_last_err},
            ))

        if not events:
            return

        import json
        for cat, sev, summary, payload in events:
            try:
                pg_conn.execute(
                    text("""
                        INSERT INTO activity_events
                            (category, severity, actor, customer_username, summary, payload)
                        VALUES (:cat, :sev, 'sync_daemon', :u, :s, CAST(:p AS JSONB))
                    """),
                    {
                        "cat": cat, "sev": sev, "u": username,
                        "s": summary, "p": json.dumps(payload),
                    },
                )
            except Exception as e:
                logger.debug(f"activity_event insert failed ({cat} for {username}): {e}")

    def _record_customer_provenance(self, pg_conn, username: str, field_names: list[str], now: datetime):
        """Mark Railwire-owned customer fields so later conflicts are explainable."""
        for field_name in field_names:
            pg_conn.execute(
                text("""
                    INSERT INTO customer_field_provenance
                      (customer_id, field_name, source, source_rank, writer, updated_at, verified_at, notes)
                    VALUES
                      (:cust, :field_name, 'railwire_scraper', 60, 'sync_daemon', :now, :now,
                       'Railwire subscriber sync')
                    ON CONFLICT (customer_id, field_name) DO UPDATE SET
                        source = EXCLUDED.source,
                        source_rank = EXCLUDED.source_rank,
                        writer = EXCLUDED.writer,
                        updated_at = EXCLUDED.updated_at,
                        verified_at = EXCLUDED.verified_at,
                        notes = EXCLUDED.notes
                """),
                {"cust": username, "field_name": field_name, "now": now},
            )

    def _record_customer_sync_state(
        self,
        pg_conn,
        *,
        username: str,
        csv_synced_at,
        details_synced_at,
        mac_synced_at,
        source_updated_at,
        status: str,
        error: Optional[str],
        now: datetime,
    ):
        """Record the per-customer Railwire watermark if the production table exists."""
        try:
            pg_conn.execute(
                text("""
                    INSERT INTO customer_sync_state
                      (customer_id, source, last_csv_synced_at, last_details_synced_at,
                       last_mac_synced_at, source_updated_at, last_synced_at,
                       last_status, last_error, error_count, updated_at)
                    VALUES
                      (:cust, 'railwire_scraper', :csv_ts, :details_ts,
                       :mac_ts, :source_ts, :now, :status, :error,
                       CASE WHEN :status = 'error' THEN 1 ELSE 0 END, :now)
                    ON CONFLICT (customer_id) DO UPDATE SET
                        source = EXCLUDED.source,
                        last_csv_synced_at = COALESCE(EXCLUDED.last_csv_synced_at, customer_sync_state.last_csv_synced_at),
                        last_details_synced_at = COALESCE(EXCLUDED.last_details_synced_at, customer_sync_state.last_details_synced_at),
                        last_mac_synced_at = COALESCE(EXCLUDED.last_mac_synced_at, customer_sync_state.last_mac_synced_at),
                        source_updated_at = GREATEST(
                            COALESCE(EXCLUDED.source_updated_at, '-infinity'::timestamptz),
                            COALESCE(customer_sync_state.source_updated_at, '-infinity'::timestamptz)
                        ),
                        last_synced_at = EXCLUDED.last_synced_at,
                        last_status = EXCLUDED.last_status,
                        last_error = EXCLUDED.last_error,
                        error_count = CASE
                            WHEN EXCLUDED.last_status = 'error' THEN customer_sync_state.error_count + 1
                            ELSE 0
                        END,
                        updated_at = EXCLUDED.updated_at
                """),
                {
                    "cust": username,
                    "csv_ts": csv_synced_at,
                    "details_ts": details_synced_at,
                    "mac_ts": mac_synced_at,
                    "source_ts": source_updated_at,
                    "status": status,
                    "error": error,
                    "now": now,
                },
            )
        except Exception:
            pass

    def _apply_billing_recovery(self, pg_conn, username: str, now: datetime):
        """
        Close stale billing-suspension work when Railwire shows the account is active again.

        This keeps NOC from chasing an already-renewed customer after the topup has landed.
        Only tickets/alarm events explicitly tagged as billing/account issues are touched.
        """
        candidates = pg_conn.execute(
            text("""
                SELECT id, status
                FROM tickets
                WHERE customer_id = :cust
                  AND status IN ('Open', 'Assigned', 'Ongoing')
                  AND (
                    LOWER(COALESCE(issue_type, '')) LIKE '%billing%'
                    OR LOWER(COALESCE(issue_type, '')) LIKE '%account%'
                    OR LOWER(COALESCE(sub_issue, '')) LIKE '%billing%'
                    OR LOWER(COALESCE(sub_issue, '')) LIKE '%account%'
                    OR LOWER(COALESCE(tags, '')) LIKE '%billing%'
                    OR LOWER(COALESCE(tags, '')) LIKE '%account%'
                    OR LOWER(COALESCE(description, '')) LIKE '%billing%'
                    OR LOWER(COALESCE(description, '')) LIKE '%suspend%'
                  )
            """),
            {"cust": username},
        ).fetchall()
        if not candidates:
            return

        ticket_ids = [row.id for row in candidates]
        note = "Auto-resolved by Railwire sync: account renewed/active."
        pg_conn.execute(
            text("""
                UPDATE tickets
                SET status = 'Resolved',
                    resolved_at = :now,
                    resolution_remarks = TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n', resolution_remarks, :note))
                WHERE id = ANY(:ticket_ids)
            """),
            {"now": now, "note": note, "ticket_ids": ticket_ids},
        )

        for row in candidates:
            pg_conn.execute(
                text("""
                    INSERT INTO ticket_audit_log
                      (ticket_id, changed_by, action, field_name, old_value, new_value, metadata, changed_at)
                    VALUES
                      (:ticket_id, NULL, 'auto_resolved', 'status', :old_status, 'Resolved',
                       CAST(:metadata AS jsonb), :now)
                """),
                {
                    "ticket_id": row.id,
                    "old_status": row.status,
                    "metadata": json.dumps({"source": "railwire_sync", "reason": "billing_restored"}),
                    "now": now,
                },
            )

        pg_conn.execute(
            text("""
                UPDATE alarm_events
                SET status = 'resolved',
                    resolved_at = :now,
                    duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (:now - received_at))::integer),
                    resolution_reason = 'billing_restored'
                WHERE status = 'open'
                  AND auto_ticket_id = ANY(:ticket_ids)
            """),
            {"now": now, "ticket_ids": ticket_ids},
        )
        logger.info(
            "billing recovery: auto-resolved %d ticket(s) for %s",
            len(ticket_ids), username,
        )

    def _sync_onu_binding(self, pg_conn, username: str, mac: str, now: datetime):
        """
        Keep onu_bindings in sync with the scraped MAC address.

        Confidence hierarchy (high â†’ low):
          field_scan > tech_scan > manual > railwire_scraped > olt_matched

        Rules:
          - If a higher-confidence binding already exists: do nothing.
          - If a railwire_scraped binding already exists with a DIFFERENT MAC:
              update it + write a customer_audit_log row so the change is visible.
          - If no binding exists at all: insert a new railwire_scraped row.
        """
        HIGH_CONF_SOURCES = ("field_scan", "tech_scan", "manual")

        # Check for any existing high-confidence binding
        row = pg_conn.execute(
            text("""
                SELECT id, binding_source, onu_identifier
                FROM onu_bindings
                WHERE customer_id = :cust
                  AND binding_source = ANY(:sources)
                ORDER BY first_seen ASC
                LIMIT 1
            """),
            {"cust": username, "sources": list(HIGH_CONF_SOURCES)},
        ).fetchone()

        if row:
            # A human-verified binding exists â€” trust it, don't touch
            return

        # GATE: refuse to bind if this MAC is already actively bound to another
        # customer. Two Railwire records cannot share one ONU. Block the write
        # and raise a critical alert so the operator fixes Railwire.
        conflict = pg_conn.execute(
            text("""
                SELECT b.customer_id
                FROM onu_bindings b
                JOIN customers c ON c.username = b.customer_id
                WHERE b.is_active = TRUE
                  AND c.status = 'Active'
                  AND COALESCE(c.mac_last_error, '') NOT IN ('no_mac_on_page', 'data_usage_link_missing', 'subscriber_expired')
                  AND UPPER(COALESCE(b.mac_address, b.onu_identifier, '')) = UPPER(:mac)
                  AND b.customer_id <> :cust
                LIMIT 1
            """),
            {"mac": mac, "cust": username},
        ).fetchone()
        if conflict:
            other = conflict[0]
            # Emit a critical alert and an activity event; do NOT write the binding.
            try:
                pg_conn.execute(
                    text("""
                        INSERT INTO binding_alerts
                            (category, severity, summary, suggested_action,
                             customer_username, current_state, dedup_key, status)
                        VALUES
                            ('duplicate_mac', 'critical',
                             :summary,
                             'Sync_daemon blocked the write because this MAC is already bound to another customer. Fix the wrong customer''s MAC in Railwire portal, then sync will retry.',
                             :cust, CAST(:state AS JSONB), :dedup, 'open')
                        ON CONFLICT (dedup_key) WHERE status = 'open' AND dedup_key IS NOT NULL DO NOTHING
                    """),
                    {
                        "summary": f"BLOCKED at sync: {username} cannot be bound to {mac} â€” already owned by {other}",
                        "cust": username,
                        "state": json.dumps({"mac": mac, "other_customer": other, "blocked_at": now.isoformat()}),
                        "dedup": f"duplicate_mac:{mac.upper()}",
                    },
                )
                pg_conn.execute(
                    text("""
                        INSERT INTO activity_events
                            (category, severity, actor, customer_username, summary, payload)
                        VALUES ('customer.mac_conflict_blocked', 'critical', 'sync_daemon', :cust, :s, CAST(:p AS JSONB))
                    """),
                    {
                        "cust": username,
                        "s": f"Sync refused to bind {username} to {mac} (already bound to {other})",
                        "p": json.dumps({"mac": mac, "other_customer": other}),
                    },
                )
            except Exception as e:
                logger.warning(f"duplicate_mac alert insert failed: {e}")
            return  # do NOT write the conflicting binding

        # Check for an existing railwire_scraped binding
        existing = pg_conn.execute(
            text("""
                SELECT id, onu_identifier
                FROM onu_bindings
                WHERE customer_id = :cust AND binding_source = 'railwire_scraped'
                ORDER BY first_seen ASC
                LIMIT 1
            """),
            {"cust": username},
        ).fetchone()

        if existing is None:
            # No binding at all â€” insert fresh
            pg_conn.execute(
                text("""
                    INSERT INTO onu_bindings
                      (customer_id, onu_identifier, onu_type, binding_source,
                       confidence, first_seen, last_seen, mac_address)
                    VALUES
                      (:cust, :mac, 'epon', 'railwire_scraped', 'probable', :now, :now, :mac)
                """),
                {"cust": username, "mac": mac, "now": now},
            )
        elif existing.onu_identifier != mac:
            # MAC changed â€” update and write audit so the change is visible
            old_mac = existing.onu_identifier
            pg_conn.execute(
                text("""
                    UPDATE onu_bindings
                    SET onu_identifier = :mac, mac_address = :mac, last_seen = :now
                    WHERE id = :bid
                """),
                {"mac": mac, "now": now, "bid": existing.id},
            )
            # Write to customer_audit_log so the admin can see the MAC change
            try:
                pg_conn.execute(
                    text("""
                        INSERT INTO customer_audit_log
                          (customer_id, action, field_name, old_value, new_value, changed_by, changed_at)
                        VALUES
                          (:cust, 'UPDATE', 'mac_address', :old, :new, 'Railwire Scraper', :now)
                    """),
                    {"cust": username, "old": old_mac, "new": mac, "now": now},
                )
            except Exception:
                pass  # Non-fatal â€” binding already updated
        else:
            # Same MAC â€” just refresh last_seen
            pg_conn.execute(
                text("UPDATE onu_bindings SET mac_address = :mac, last_seen = :now WHERE id = :bid"),
                {"mac": mac, "now": now, "bid": existing.id},
            )

    # ------------------------------------------------------------------
    # Audit logs
    # ------------------------------------------------------------------

    def sync_audit_logs(self, since: Optional[str]) -> int:
        sqlite_conn = sqlite_connect()
        cur = sqlite_conn.cursor()

        if since:
            cur.execute(
                """
                SELECT customer_id, action, field_name, old_value, new_value,
                       changed_by, changed_at
                FROM scraper_audit_log
                WHERE changed_at > ?
                ORDER BY changed_at ASC
                LIMIT 5000
                """,
                (since,),
            )
        else:
            cur.execute(
                """
                SELECT customer_id, action, field_name, old_value, new_value,
                       changed_by, changed_at
                FROM scraper_audit_log
                ORDER BY changed_at ASC
                LIMIT 5000
                """
            )

        rows = cur.fetchall()
        sqlite_conn.close()

        if not rows:
            return 0

        synced = 0
        with self.pg_engine.connect() as pg_conn:
            for r in rows:
                try:
                    pg_conn.execute(
                        text("""
                            INSERT INTO customer_audit_log
                              (customer_id, action, field_name, old_value, new_value,
                               changed_by, changed_at)
                            VALUES
                              (:cust_id, :action, :field, :old, :new, :by, :when)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "cust_id": r["customer_id"],
                            "action": r["action"],
                            "field": r["field_name"],
                            "old": r["old_value"],
                            "new": r["new_value"],
                            "by": r["changed_by"] or "scraper",
                            "when": r["changed_at"],
                        },
                    )
                    synced += 1
                except Exception as exc:
                    logger.debug(f"Audit log sync skip: {exc}")
            pg_conn.commit()

        return synced

    # ------------------------------------------------------------------
    # Cycle
    # ------------------------------------------------------------------

    def run_cycle(self) -> bool:
        """Run one incremental sync cycle. Returns True on success."""
        since = read_watermark()
        cycle_start = datetime.now(timezone.utc)
        logger.info(f"Sync cycle starting (since: {since or 'beginning'})")

        try:
            cust_upserted, cust_errors, new_wm = self.sync_customers(since)
            audit_synced = self.sync_audit_logs(since)

            total = cust_upserted + audit_synced
            self.total_synced += total

            if total > 0:
                logger.info(
                    f"âœ… Cycle complete â€” customers: {cust_upserted}, "
                    f"errors: {cust_errors}, audit: {audit_synced}"
                )
            else:
                logger.debug("No new data to sync")

            write_watermark(new_wm)

            # Push health metrics to PG if possible
            try:
                with self.pg_engine.connect() as pg_conn:
                    _set_pg_health(pg_conn, "last_sync_at", cycle_start.isoformat())
                    _set_pg_health(pg_conn, "last_sync_customers", str(cust_upserted))
                    _set_pg_health(pg_conn, "last_sync_audit", str(audit_synced))
                    pg_conn.commit()
            except Exception:
                pass  # Non-fatal

            return True

        except Exception as exc:
            logger.error(f"âŒ Sync cycle failed: {exc}")
            return False

    # ------------------------------------------------------------------
    # Daemon
    # ------------------------------------------------------------------

    def start(self):
        logger.info("=" * 55)
        logger.info("â–¶ï¸  Rico Net Sync Daemon v2 startingâ€¦")
        logger.info(f"   Interval: {SYNC_INTERVAL}s | Press Ctrl+C to stop")
        logger.info("=" * 55)

        try:
            while True:
                self.run_cycle()
                time.sleep(SYNC_INTERVAL)
        except KeyboardInterrupt:
            logger.info(f"ðŸ›‘ Daemon stopped. Total synced: {self.total_synced} records")
        except Exception as exc:
            logger.error(f"ðŸ’¥ Fatal: {exc}")
            raise


# â”€â”€ Entry point â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rico Net Sync Daemon v2")
    parser.add_argument("--once", action="store_true", help="Run one cycle then exit")
    args = parser.parse_args()

    daemon = SyncDaemon()
    if args.once:
        ok = daemon.run_cycle()
        sys.exit(0 if ok else 1)
    else:
        daemon.start()
