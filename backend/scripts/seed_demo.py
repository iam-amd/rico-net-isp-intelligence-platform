import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import models
from database import SessionLocal, engine
from middleware.auth import get_password_hash


FIRST_NAMES = [
    "Asha", "Vikram", "Meena", "Karthik", "Divya", "Suresh", "Priya", "Arun",
    "Nisha", "Ramesh", "Lakshmi", "Naveen", "Keerthi", "Rahul", "Janani",
    "Mohan", "Farah", "Imran", "Kavya", "Dinesh", "Anitha", "Bala", "Rekha",
    "Saravanan", "Yamini", "Prakash", "Fathima", "Gokul", "Sneha", "Vasanth",
]
LAST_NAMES = [
    "Raman", "Selvan", "Kumar", "Raj", "Sekar", "Babu", "Krishnan", "Khan",
    "Devi", "Muthu", "Srinivasan", "Ali", "Nair", "Joseph", "Ganesh",
]
AREAS = [
    ("Kanchipuram East", 12.8341, 79.7036),
    ("Kanchipuram West", 12.8324, 79.6988),
    ("Collectorate Road", 12.8391, 79.7061),
    ("Pillaiyarpalayam", 12.8365, 79.6948),
    ("Orikkai", 12.8209, 79.7112),
    ("Enathur", 12.8482, 79.7167),
]
PLANS = ["75 Mbps Basic", "100 Mbps Unlimited", "150 Mbps Unlimited", "200 Mbps Business"]
OLTS = [
    ("10.10.10.100", "EPON", ["epon0/1", "epon0/2", "epon0/3", "epon0/4"]),
    ("10.10.10.200", "GPON", ["gpon0/1", "gpon0/2", "gpon0/3", "gpon0/4"]),
    ("10.10.10.210", "GPON", ["gpon0/1", "gpon0/2", "gpon0/3", "gpon0/4"]),
]

SCENARIOS = {
    "healthy": {
        "status": "online", "rx": -18.4, "ticket": None, "alarm": None,
        "fault": None, "priority": None, "health": 96, "fiber_risk": "LOW",
        "action": "Monitor normally",
    },
    "good": {
        "status": "online", "rx": -22.1, "ticket": None, "alarm": None,
        "fault": None, "priority": None, "health": 84, "fiber_risk": "LOW",
        "action": "Monitor",
    },
    "weak_signal": {
        "status": "online", "rx": -25.7, "ticket": "Slow Speed", "alarm": "FIBER_WEAK",
        "fault": "FIBER_WEAK", "priority": "High", "health": 61, "fiber_risk": "HIGH",
        "action": "Schedule connector inspection within 48h",
    },
    "critical_signal": {
        "status": "online", "rx": -28.6, "ticket": "Fiber Cut", "alarm": "FIBER_CRITICAL",
        "fault": "FIBER_CRITICAL", "priority": "Urgent", "health": 24, "fiber_risk": "CRITICAL",
        "action": "Dispatch fiber kit immediately",
    },
    "power_cut": {
        "status": "offline", "rx": None, "ticket": "No Internet", "alarm": "DYING_GASP",
        "fault": "POWER_CUT", "priority": "Urgent", "health": 42, "fiber_risk": "MEDIUM",
        "action": "Call customer, do not dispatch until power is confirmed",
    },
    "onu_offline": {
        "status": "offline", "rx": None, "ticket": "No Internet", "alarm": "ONU_OFFLINE",
        "fault": "ONU_OFFLINE", "priority": "High", "health": 38, "fiber_risk": "MEDIUM",
        "action": "Try remote reboot, then dispatch if still offline",
    },
    "flapping": {
        "status": "online", "rx": -23.8, "ticket": "Frequent Disconnection", "alarm": "FIBER_FLAP",
        "fault": "FIBER_FLAP", "priority": "High", "health": 55, "fiber_risk": "HIGH",
        "action": "Check splice/connector for intermittent loss",
    },
    "router_issue": {
        "status": "online", "rx": -19.6, "ticket": "WiFi Issue", "alarm": None,
        "fault": "ONLINE_CHECK_ROUTER", "priority": "Normal", "health": 78, "fiber_risk": "LOW",
        "action": "Reboot router or verify PPPoE credentials",
    },
}
SCENARIO_CYCLE = [
    "healthy", "healthy", "healthy", "good", "good", "weak_signal", "critical_signal",
    "power_cut", "onu_offline", "flapping", "router_issue", "healthy",
]


def mac_for(i: int) -> str:
    return f"02:10:{(i // 65536) & 255:02X}:{(i // 256) & 255:02X}:{i & 255:02X}:{(i * 7) & 255:02X}"


def serial_for(i: int, tech: str) -> str:
    return f"DEMO{tech}{i:05d}"


def upsert_tech(db, username, full_name, role, area, phone):
    tech = db.query(models.Technician).filter_by(username=username).first()
    if not tech:
        tech = models.Technician(username=username)
        db.add(tech)
    tech.hashed_password = get_password_hash("demo1234")
    tech.full_name = full_name
    tech.role = role
    tech.area_assigned = area
    tech.phone = phone
    tech.email = f"{username}@example.com"
    tech.is_active = 1
    return tech


def demo_usernames(db):
    return [r[0] for r in db.query(models.Customer.username).filter(models.Customer.username.like("RNDEMO%")).all()]


def demo_macs(db):
    rows = db.query(models.Customer.mac_address).filter(models.Customer.username.like("RNDEMO%")).all()
    return [r[0] for r in rows if r[0]]


def clear_demo(db):
    usernames = demo_usernames(db)
    macs = demo_macs(db)
    if not usernames and not macs:
        return
    ticket_ids = [r[0] for r in db.query(models.Ticket.id).filter(models.Ticket.customer_id.in_(usernames)).all()]
    if ticket_ids:
        db.query(models.TicketComment).filter(models.TicketComment.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
        db.query(models.TicketAuditLog).filter(models.TicketAuditLog.ticket_id.in_(ticket_ids)).delete(synchronize_session=False)
        db.query(models.Ticket).filter(models.Ticket.id.in_(ticket_ids)).delete(synchronize_session=False)
    if macs:
        db.query(models.AlarmEvent).filter(models.AlarmEvent.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.ONUStateEvent).filter(models.ONUStateEvent.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.ONUSnapshot).filter(models.ONUSnapshot.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.ONUHourly).filter(models.ONUHourly.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.ONUDaily).filter(models.ONUDaily.mac_address.in_(macs)).delete(synchronize_session=False)
        db.query(models.Prediction).filter(models.Prediction.mac_address.in_(macs)).delete(synchronize_session=False)
    if usernames:
        db.query(models.ONUBinding).filter(models.ONUBinding.customer_id.in_(usernames)).delete(synchronize_session=False)
        db.query(models.CustomerDNA).filter(models.CustomerDNA.username.in_(usernames)).delete(synchronize_session=False)
        db.query(models.CustomerPhone).filter(models.CustomerPhone.customer_id.in_(usernames)).delete(synchronize_session=False)
        db.query(models.CollectionAssignment).filter(models.CollectionAssignment.customer_id.in_(usernames)).delete(synchronize_session=False)
        db.query(models.Customer).filter(models.Customer.username.in_(usernames)).delete(synchronize_session=False)
    db.commit()


def ensure_pole_groups(db):
    groups = []
    for idx, (area, _, _) in enumerate(AREAS, start=1):
        pg = db.query(models.PoleGroup).filter_by(name=f"PG-DEMO-{idx:02d}").first()
        if not pg:
            pg = models.PoleGroup(name=f"PG-DEMO-{idx:02d}")
            db.add(pg)
        pg.description = f"Synthetic pole group for {area}"
        pg.area = area
        groups.append(pg)
    db.flush()
    return groups


def make_customer_payload(i: int):
    first = FIRST_NAMES[(i - 1) % len(FIRST_NAMES)]
    last = LAST_NAMES[(i * 3) % len(LAST_NAMES)]
    area, lat, lng = AREAS[(i - 1) % len(AREAS)]
    olt_host, tech, ports = OLTS[(i - 1) % len(OLTS)]
    pon_port = ports[((i - 1) // len(OLTS)) % len(ports)]
    scenario = SCENARIO_CYCLE[(i - 1) % len(SCENARIO_CYCLE)]
    username = f"RNDEMO{i:04d}"
    return {
        "username": username,
        "first_name": first,
        "last_name": last,
        "phone": f"9000{i:06d}",
        "email": f"{username.lower()}@example.com",
        "railwire_address": f"Door {100 + i}, Demo {area}, Kanchipuram",
        "plan_name": PLANS[(i - 1) % len(PLANS)],
        "status": "Expired" if i % 17 == 0 else "Active",
        "balance": -250 if i % 17 == 0 else (120 if i % 9 == 0 else 0),
        "mac_address": mac_for(i),
        "olt_host": olt_host,
        "pon_port": pon_port,
        "onu_index": 1 + ((i * 5) % 64),
        "onu_type": tech.lower(),
        "connection_status": SCENARIOS[scenario]["status"],
        "gps_lat": lat + ((i % 9) * 0.0008),
        "gps_lng": lng + ((i % 7) * 0.0008),
        "ont_serial_number": serial_for(i, tech),
        "scenario": scenario,
    }


def add_signal_history(db, payload, scenario, now):
    rx = scenario["rx"]
    for h in range(24):
        age = 24 - h
        drift = (h - 12) * (-0.03 if scenario["fault"] in {"FIBER_WEAK", "FIBER_CRITICAL"} else 0.01)
        status = scenario["status"]
        if scenario["fault"] == "FIBER_FLAP" and h % 5 == 0:
            status = "offline"
        sample_rx = None if rx is None or status == "offline" else round(rx + drift, 2)
        db.add(models.ONUSnapshot(
            mac_address=payload["mac_address"],
            olt_host=payload["olt_host"],
            pon_port=payload["pon_port"],
            onu_index=payload["onu_index"],
            status=status,
            rx_power_dbm=sample_rx,
            tx_power_dbm=2.0 + (payload["onu_index"] % 5) * 0.35,
            temperature_c=39 + (payload["onu_index"] % 9),
            voltage_mv=3300,
            flap_count=12 if scenario["fault"] == "FIBER_FLAP" else payload["onu_index"] % 3,
            dying_gasp=scenario["fault"] == "POWER_CUT",
            distance_m=240 + (payload["onu_index"] * 18),
            rx_bytes_delta=1200000 + h * 10000,
            tx_bytes_delta=420000 + h * 5000,
            polled_at=now - timedelta(hours=age),
        ))


def seed_demo(create_tables=False, reset_demo=False, customers=120):
    if create_tables:
        models.Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if reset_demo:
            clear_demo(db)

        admin = upsert_tech(db, "admin", "Demo Admin", "Admin", "All Areas", "9000001999")
        techs = [
            upsert_tech(db, "fieldtech", "Demo Field Technician", "Field Tech", "Kanchipuram East", "9000001888"),
            upsert_tech(db, "fiberteam", "Demo Fiber Team", "Field Tech", "Kanchipuram West", "9000001889"),
            upsert_tech(db, "nocdemo", "Demo NOC Operator", "Senior Tech", "All Areas", "9000001890"),
        ]
        pole_groups = ensure_pole_groups(db)
        db.flush()

        now = datetime.now(timezone.utc)
        open_ticket_count = 0
        alarm_count = 0

        for i in range(1, customers + 1):
            payload = make_customer_payload(i)
            scenario = SCENARIOS[payload["scenario"]]
            pg = pole_groups[(i - 1) % len(pole_groups)]

            customer = db.query(models.Customer).filter_by(username=payload["username"]).first()
            if not customer:
                customer = models.Customer(username=payload["username"])
                db.add(customer)
            for key in [
                "first_name", "last_name", "phone", "email", "railwire_address", "plan_name",
                "status", "balance", "mac_address", "olt_host", "pon_port", "onu_index",
                "connection_status", "gps_lat", "gps_lng", "ont_serial_number",
            ]:
                setattr(customer, key, payload[key])
            customer.expiry_date = now + timedelta(days=30 - (i % 45))
            customer.pg_id = pg.id
            customer.ont_model = "Netlink Demo ONT"
            customer.router_model = "Integrated ONT Router"
            customer.last_seen_online = now - timedelta(minutes=i % 90) if scenario["status"] == "online" else now - timedelta(hours=2 + i % 12)

            phone = db.query(models.CustomerPhone).filter_by(phone_number=payload["phone"]).first()
            if not phone:
                phone = models.CustomerPhone(phone_number=payload["phone"])
                db.add(phone)
            phone.customer_id = payload["username"]
            phone.label = "Self"
            phone.is_primary = True

            binding = db.query(models.ONUBinding).filter_by(customer_id=payload["username"]).first()
            if not binding:
                binding = models.ONUBinding(customer_id=payload["username"])
                db.add(binding)
            binding.onu_identifier = payload["mac_address"]
            binding.onu_type = payload["onu_type"]
            binding.primary_identifier_type = "mac"
            binding.mac_address = payload["mac_address"]
            binding.serial_number = payload["ont_serial_number"]
            binding.olt_host = payload["olt_host"]
            binding.pon_port = payload["pon_port"]
            binding.onu_index = payload["onu_index"]
            binding.binding_source = "demo_simulator"
            binding.confidence = "verified"
            binding.verified_at = now - timedelta(days=i % 14)
            binding.verified_by_user_id = admin.id
            binding.is_active = True

            latest = db.query(models.ONULatest).filter_by(mac_address=payload["mac_address"]).first()
            if not latest:
                latest = models.ONULatest(mac_address=payload["mac_address"])
                db.add(latest)
            latest.olt_host = payload["olt_host"]
            latest.pon_port = payload["pon_port"]
            latest.onu_index = payload["onu_index"]
            latest.status = scenario["status"]
            latest.rx_power_dbm = scenario["rx"]
            latest.tx_power_dbm = 2.0 + (i % 5) * 0.35
            latest.temperature_c = 39 + (i % 9)
            latest.voltage_mv = 3300
            latest.dying_gasp = scenario["fault"] == "POWER_CUT"
            latest.polled_at = now - timedelta(minutes=i % 20)
            latest.vendor_id = "DEMO"
            latest.model_id = "ONT-X1"

            add_signal_history(db, payload, scenario, now)

            dna = db.query(models.CustomerDNA).filter_by(username=payload["username"]).first()
            if not dna:
                dna = models.CustomerDNA(username=payload["username"])
                db.add(dna)
            dna.railwire_mac = payload["mac_address"]
            dna.optical_mac = payload["mac_address"]
            dna.optical_serial = payload["ont_serial_number"]
            dna.olt_host = payload["olt_host"]
            dna.pon_port = payload["pon_port"]
            dna.onu_index = payload["onu_index"]
            dna.binding_source = "demo_simulator"
            dna.confidence = "verified"
            dna.status = scenario["status"]
            dna.rx_power_dbm = scenario["rx"]
            dna.tx_power_dbm = latest.tx_power_dbm
            dna.temperature_c = latest.temperature_c
            dna.voltage_mv = latest.voltage_mv
            dna.dying_gasp = latest.dying_gasp
            dna.polled_at = latest.polled_at
            dna.signal_label = "offline" if scenario["rx"] is None else ("critical" if scenario["rx"] < -27 else "weak" if scenario["rx"] < -24 else "good" if scenario["rx"] < -20 else "excellent")
            dna.fault_type = scenario["fault"]
            dna.health_score = scenario["health"]
            dna.notes = f"Synthetic scenario: {payload['scenario']}"
            dna.last_reconciled_at = now
            dna.updated_at = now

            prediction = db.query(models.Prediction).filter_by(mac_address=payload["mac_address"]).first()
            if not prediction:
                prediction = models.Prediction(mac_address=payload["mac_address"])
                db.add(prediction)
            prediction.olt_host = payload["olt_host"]
            prediction.pon_port = payload["pon_port"]
            prediction.rx_slope_7d = -0.62 if scenario["fault"] == "FIBER_CRITICAL" else -0.41 if scenario["fault"] in {"FIBER_WEAK", "FIBER_FLAP"} else -0.04
            prediction.rx_avg_7d = scenario["rx"] if scenario["rx"] is not None else -31.0
            prediction.alarm_count_30d = 4 if scenario["alarm"] else (1 if payload["scenario"] == "router_issue" else 0)
            prediction.offline_count_30d = 3 if scenario["status"] == "offline" else (2 if scenario["fault"] == "FIBER_FLAP" else 0)
            prediction.fiber_risk = scenario["fiber_risk"]
            prediction.churn_risk = "HIGH" if customer.status == "Expired" or scenario["status"] == "offline" else "MEDIUM" if scenario["ticket"] else "LOW"
            prediction.health_score = scenario["health"]
            prediction.recommended_action = scenario["action"]
            prediction.customer_name = f"{payload['first_name']} {payload['last_name']}"
            prediction.customer_phone = payload["phone"]
            prediction.last_computed = now

            if scenario["alarm"]:
                alarm_count += 1
                db.add(models.AlarmEvent(
                    mac_address=payload["mac_address"],
                    event_type=scenario["alarm"],
                    olt_host=payload["olt_host"],
                    pon_port=payload["pon_port"],
                    onu_index=payload["onu_index"],
                    payload={"source": "demo_simulator", "scenario": payload["scenario"], "public_demo": True},
                    received_at=now - timedelta(minutes=5 + i % 90),
                    status="open",
                    occurrence_count=1 + (i % 4),
                    last_seen=now - timedelta(minutes=i % 20),
                ))
                db.add(models.ONUStateEvent(
                    mac_address=payload["mac_address"],
                    olt_host=payload["olt_host"],
                    pon_port=payload["pon_port"],
                    onu_index=payload["onu_index"],
                    event_type="threshold_crossed" if scenario["rx"] is not None else "status_change",
                    from_state="normal",
                    to_state=scenario["fault"] or scenario["status"],
                    rx_power_dbm=scenario["rx"],
                    occurred_at=now - timedelta(minutes=5 + i % 90),
                ))

            if scenario["ticket"]:
                open_ticket_count += 1
                ticket = db.query(models.Ticket).filter_by(customer_id=payload["username"], issue_type=scenario["ticket"]).first()
                if not ticket:
                    ticket = models.Ticket(customer_id=payload["username"], issue_type=scenario["ticket"])
                    db.add(ticket)
                ticket.priority = scenario["priority"]
                ticket.status = ["Open", "Assigned", "Ongoing"][open_ticket_count % 3]
                ticket.description = f"{scenario['action']}. Synthetic complaint generated from {payload['scenario']} scenario."
                ticket.assigned_tech = techs[open_ticket_count % len(techs)].username
                ticket.assigned_at = now - timedelta(minutes=30 + i % 60)
                ticket.started_at = now - timedelta(minutes=10 + i % 40) if ticket.status == "Ongoing" else None
                ticket.sub_issue = "Fiber Diagnostics" if "FIBER" in (scenario["fault"] or "") else "Customer Premise"
                ticket.tags = f"demo,{payload['scenario']},simulator"

        inventory = [
            ("Netlink ONT", "Hardware", 72, "units"),
            ("SC/APC Patch Cord", "Fiber", 220, "pcs"),
            ("Drop Cable 1F", "Fiber", 5400, "m"),
            ("Splice Sleeves", "Fiber", 1200, "pcs"),
            ("Fiber Joint Box", "Fiber", 24, "units"),
        ]
        for name, category, quantity, unit in inventory:
            item = db.query(models.InventoryItem).filter_by(name=name).first()
            if not item:
                item = models.InventoryItem(name=name)
                db.add(item)
            item.category = category
            item.quantity = quantity
            item.unit = unit

        for host, tech, _ports in OLTS:
            health = db.query(models.OLTHealth).filter_by(olt_host=host).first()
            if not health:
                health = models.OLTHealth(olt_host=host)
                db.add(health)
            health.last_snapshot_at = now
            health.last_trap_at = now - timedelta(minutes=6)
            health.status = "ok"
            health.snapshot_count_24h = customers * 24 // len(OLTS)
            health.collector_id = "demo-collector"
            health.collector_name = "Public Demo Collector"
            health.collector_hostname = "demo-collector.local"
            health.collector_ip = "10.0.0.10"
            health.collector_version = "demo-1.0"
            health.last_collector_seen_at = now
            health.last_batch_size = customers // len(OLTS)

        collector = db.query(models.CollectorHealth).filter_by(collector_id="demo-collector").first()
        if not collector:
            collector = models.CollectorHealth(collector_id="demo-collector")
            db.add(collector)
        collector.collector_name = "Public Demo Collector"
        collector.collector_hostname = "demo-collector.local"
        collector.collector_ip = "10.0.0.10"
        collector.collector_version = "demo-1.0"
        collector.collector_started_at = now - timedelta(hours=4)
        collector.last_heartbeat_at = now
        collector.last_snapshot_at = now
        collector.last_status = "ok"
        collector.last_message = f"Generated {customers} synthetic ONU records"
        collector.configured_olts = [{"host": host, "tech": tech} for host, tech, _ in OLTS]
        collector.last_batch_total = customers
        collector.heartbeat_count = 48

        db.commit()
        print(f"Seeded {customers} synthetic public demo customers.")
        print(f"Generated {open_ticket_count} complaints/tickets and {alarm_count} alarm events.")
        print("Login: admin / demo1234")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--create-tables", action="store_true", help="Create tables with SQLAlchemy before seeding.")
    parser.add_argument("--reset-demo", action="store_true", help="Remove existing RNDEMO seed data before seeding.")
    parser.add_argument("--customers", type=int, default=int(os.getenv("DEMO_CUSTOMER_COUNT", "120")))
    args = parser.parse_args()
    seed_demo(create_tables=args.create_tables, reset_demo=args.reset_demo, customers=max(12, args.customers))

