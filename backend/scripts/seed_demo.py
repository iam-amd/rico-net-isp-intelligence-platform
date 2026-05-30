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


DEMO_CUSTOMERS = [
    {
        "username": "RNDEMO001",
        "first_name": "Asha",
        "last_name": "Raman",
        "phone": "9000001001",
        "email": "asha.demo@example.com",
        "railwire_address": "Demo Street 1, Kanchipuram East",
        "plan_name": "100 Mbps Unlimited",
        "status": "Active",
        "balance": 0,
        "mac_address": "02:10:00:00:00:01",
        "olt_host": "10.10.10.100",
        "pon_port": "epon0/1",
        "onu_index": 12,
        "connection_status": "online",
        "gps_lat": 12.8341,
        "gps_lng": 79.7036,
        "ont_serial_number": "DEMOEPON0001",
    },
    {
        "username": "RNDEMO002",
        "first_name": "Vikram",
        "last_name": "Selvan",
        "phone": "9000001002",
        "email": "vikram.demo@example.com",
        "railwire_address": "Demo Street 2, Kanchipuram East",
        "plan_name": "150 Mbps Unlimited",
        "status": "Active",
        "balance": 120,
        "mac_address": "02:10:00:00:00:02",
        "olt_host": "10.10.10.100",
        "pon_port": "epon0/1",
        "onu_index": 18,
        "connection_status": "weak",
        "gps_lat": 12.8348,
        "gps_lng": 79.7042,
        "ont_serial_number": "DEMOEPON0002",
    },
    {
        "username": "RNDEMO003",
        "first_name": "Meena",
        "last_name": "Kumar",
        "phone": "9000001003",
        "email": "meena.demo@example.com",
        "railwire_address": "Demo Street 3, Kanchipuram West",
        "plan_name": "75 Mbps Basic",
        "status": "Expired",
        "balance": -250,
        "mac_address": "02:10:00:00:00:03",
        "olt_host": "10.10.10.200",
        "pon_port": "gpon0/2",
        "onu_index": 7,
        "connection_status": "offline",
        "gps_lat": 12.8324,
        "gps_lng": 79.6988,
        "ont_serial_number": "DEMOGPON0003",
    },
    {
        "username": "RNDEMO004",
        "first_name": "Karthik",
        "last_name": "Raj",
        "phone": "9000001004",
        "email": "karthik.demo@example.com",
        "railwire_address": "Demo Street 4, Collectorate Road",
        "plan_name": "200 Mbps Business",
        "status": "Active",
        "balance": 0,
        "mac_address": "02:10:00:00:00:04",
        "olt_host": "10.10.10.210",
        "pon_port": "gpon0/4",
        "onu_index": 33,
        "connection_status": "critical",
        "gps_lat": 12.8391,
        "gps_lng": 79.7061,
        "ont_serial_number": "DEMOGPON0004",
    },
]


def upsert_tech(db, username, full_name, role, area):
    tech = db.query(models.Technician).filter_by(username=username).first()
    if not tech:
        tech = models.Technician(username=username)
        db.add(tech)
    tech.hashed_password = get_password_hash("demo1234")
    tech.full_name = full_name
    tech.role = role
    tech.area_assigned = area
    tech.phone = "9000001999" if role == "Admin" else "9000001888"
    tech.email = f"{username}@example.com"
    tech.is_active = 1
    return tech


def clear_demo(db):
    usernames = [c["username"] for c in DEMO_CUSTOMERS]
    macs = [c["mac_address"] for c in DEMO_CUSTOMERS]
    db.query(models.TicketComment).filter(models.TicketComment.ticket_id.in_(
        db.query(models.Ticket.id).filter(models.Ticket.customer_id.in_(usernames))
    )).delete(synchronize_session=False)
    db.query(models.TicketAuditLog).filter(models.TicketAuditLog.ticket_id.in_(
        db.query(models.Ticket.id).filter(models.Ticket.customer_id.in_(usernames))
    )).delete(synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.customer_id.in_(usernames)).delete(synchronize_session=False)
    db.query(models.AlarmEvent).filter(models.AlarmEvent.mac_address.in_(macs)).delete(synchronize_session=False)
    db.query(models.ONUSnapshot).filter(models.ONUSnapshot.mac_address.in_(macs)).delete(synchronize_session=False)
    db.query(models.ONULatest).filter(models.ONULatest.mac_address.in_(macs)).delete(synchronize_session=False)
    db.query(models.Prediction).filter(models.Prediction.mac_address.in_(macs)).delete(synchronize_session=False)
    db.query(models.ONUBinding).filter(models.ONUBinding.customer_id.in_(usernames)).delete(synchronize_session=False)
    db.query(models.CustomerDNA).filter(models.CustomerDNA.username.in_(usernames)).delete(synchronize_session=False)
    db.query(models.CustomerPhone).filter(models.CustomerPhone.customer_id.in_(usernames)).delete(synchronize_session=False)
    db.query(models.Customer).filter(models.Customer.username.in_(usernames)).delete(synchronize_session=False)
    db.commit()


def seed_demo(create_tables=False, reset_demo=False):
    if create_tables:
        models.Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if reset_demo:
            clear_demo(db)

        admin = upsert_tech(db, "admin", "Demo Admin", "Admin", "All Areas")
        tech = upsert_tech(db, "fieldtech", "Demo Field Technician", "Field Tech", "Kanchipuram East")

        pg = db.query(models.PoleGroup).filter_by(name="PG-DEMO-01").first()
        if not pg:
            pg = models.PoleGroup(name="PG-DEMO-01")
            db.add(pg)
        pg.description = "Synthetic pole group used for public demo data"
        pg.area = "Kanchipuram East"

        db.flush()

        now = datetime.now(timezone.utc)
        rx_values = [-18.4, -25.7, None, -28.6]
        statuses = ["online", "online", "offline", "online"]

        for idx, payload in enumerate(DEMO_CUSTOMERS):
            customer = db.query(models.Customer).filter_by(username=payload["username"]).first()
            if not customer:
                customer = models.Customer(username=payload["username"])
                db.add(customer)
            for key, value in payload.items():
                setattr(customer, key, value)
            customer.expiry_date = now + timedelta(days=20 - idx * 8)
            customer.pg_id = pg.id

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
            binding.onu_type = "epon" if payload["pon_port"].startswith("epon") else "gpon"
            binding.primary_identifier_type = "mac"
            binding.mac_address = payload["mac_address"]
            binding.serial_number = payload["ont_serial_number"]
            binding.olt_host = payload["olt_host"]
            binding.pon_port = payload["pon_port"]
            binding.onu_index = payload["onu_index"]
            binding.binding_source = "demo_seed"
            binding.confidence = "verified"
            binding.verified_at = now - timedelta(days=idx + 1)
            binding.verified_by_user_id = admin.id

            latest = db.query(models.ONULatest).filter_by(mac_address=payload["mac_address"]).first()
            if not latest:
                latest = models.ONULatest(mac_address=payload["mac_address"])
                db.add(latest)
            latest.olt_host = payload["olt_host"]
            latest.pon_port = payload["pon_port"]
            latest.onu_index = payload["onu_index"]
            latest.status = statuses[idx]
            latest.rx_power_dbm = rx_values[idx]
            latest.tx_power_dbm = 2.1 + idx
            latest.temperature_c = 42 + idx
            latest.voltage_mv = 3300
            latest.dying_gasp = idx == 2
            latest.polled_at = now - timedelta(minutes=idx * 4)
            latest.vendor_id = "DEMO"
            latest.model_id = "ONT-X1"

            for h in range(6):
                db.add(models.ONUSnapshot(
                    mac_address=payload["mac_address"],
                    olt_host=payload["olt_host"],
                    pon_port=payload["pon_port"],
                    onu_index=payload["onu_index"],
                    status=statuses[idx],
                    rx_power_dbm=None if rx_values[idx] is None else rx_values[idx] + (h * 0.15),
                    tx_power_dbm=2.1 + idx,
                    temperature_c=42 + idx,
                    voltage_mv=3300,
                    flap_count=idx * 3,
                    dying_gasp=idx == 2,
                    distance_m=350 + idx * 90,
                    polled_at=now - timedelta(hours=6 - h),
                ))

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
            dna.binding_source = "demo_seed"
            dna.confidence = "verified"
            dna.status = statuses[idx]
            dna.rx_power_dbm = rx_values[idx]
            dna.signal_label = ["excellent", "weak", "offline", "critical"][idx]
            dna.fault_type = [None, "FIBER_WEAK", "POWER_CUT", "FIBER_CRITICAL"][idx]
            dna.health_score = [96, 67, 42, 28][idx]
            dna.updated_at = now

            prediction = db.query(models.Prediction).filter_by(mac_address=payload["mac_address"]).first()
            if not prediction:
                prediction = models.Prediction(mac_address=payload["mac_address"])
                db.add(prediction)
            prediction.olt_host = payload["olt_host"]
            prediction.pon_port = payload["pon_port"]
            prediction.rx_slope_7d = [-0.02, -0.41, -0.15, -0.62][idx]
            prediction.rx_avg_7d = rx_values[idx] or -31.0
            prediction.alarm_count_30d = idx + 1
            prediction.offline_count_30d = idx
            prediction.fiber_risk = ["LOW", "HIGH", "MEDIUM", "CRITICAL"][idx]
            prediction.churn_risk = ["LOW", "MEDIUM", "HIGH", "MEDIUM"][idx]
            prediction.health_score = [96, 61, 48, 24][idx]
            prediction.recommended_action = [
                "Monitor normally",
                "Schedule connector inspection",
                "Call customer before dispatch",
                "Dispatch fiber kit immediately",
            ][idx]
            prediction.customer_name = f"{payload['first_name']} {payload['last_name']}"
            prediction.customer_phone = payload["phone"]
            prediction.last_computed = now

        db.flush()

        ticket_specs = [
            ("RNDEMO002", "Slow Speed", "High", "Open", "Signal is weak and trending down."),
            ("RNDEMO003", "No Internet", "Urgent", "Assigned", "Dying gasp received. Confirm power at customer home."),
            ("RNDEMO004", "Fiber Cut", "Urgent", "Ongoing", "Critical Rx detected on business connection."),
        ]
        for customer_id, issue_type, priority, status, description in ticket_specs:
            existing = db.query(models.Ticket).filter_by(customer_id=customer_id, issue_type=issue_type).first()
            if not existing:
                existing = models.Ticket(customer_id=customer_id, issue_type=issue_type)
                db.add(existing)
            existing.priority = priority
            existing.status = status
            existing.description = description
            existing.assigned_tech = tech.username
            existing.sub_issue = "Fiber Diagnostics"
            existing.tags = "demo,noc"

        alarm_specs = [
            ("02:10:00:00:00:02", "FIBER_WEAK", "open"),
            ("02:10:00:00:00:03", "DYING_GASP", "open"),
            ("02:10:00:00:00:04", "FIBER_CRITICAL", "open"),
        ]
        for mac, event_type, status in alarm_specs:
            customer = next(c for c in DEMO_CUSTOMERS if c["mac_address"] == mac)
            db.add(models.AlarmEvent(
                mac_address=mac,
                event_type=event_type,
                olt_host=customer["olt_host"],
                pon_port=customer["pon_port"],
                onu_index=customer["onu_index"],
                payload={"source": "demo_seed", "public_demo": True},
                received_at=now - timedelta(minutes=12),
                status=status,
                occurrence_count=1,
                last_seen=now - timedelta(minutes=2),
            ))

        inventory = [
            ("Netlink ONT", "Hardware", 18, "units"),
            ("SC/APC Patch Cord", "Fiber", 75, "pcs"),
            ("Drop Cable 1F", "Fiber", 1200, "m"),
            ("Splice Sleeves", "Fiber", 300, "pcs"),
        ]
        for name, category, quantity, unit in inventory:
            item = db.query(models.InventoryItem).filter_by(name=name).first()
            if not item:
                item = models.InventoryItem(name=name)
                db.add(item)
            item.category = category
            item.quantity = quantity
            item.unit = unit

        for host in ["10.10.10.100", "10.10.10.200", "10.10.10.210"]:
            health = db.query(models.OLTHealth).filter_by(olt_host=host).first()
            if not health:
                health = models.OLTHealth(olt_host=host)
                db.add(health)
            health.last_snapshot_at = now
            health.status = "ok"
            health.snapshot_count_24h = 1440
            health.collector_id = "demo-collector"
            health.collector_name = "Public Demo Collector"

        db.commit()
        print("Seeded public demo data.")
        print("Login: admin / demo1234")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--create-tables", action="store_true", help="Create tables with SQLAlchemy before seeding.")
    parser.add_argument("--reset-demo", action="store_true", help="Remove existing RNDEMO seed data before seeding.")
    args = parser.parse_args()
    seed_demo(create_tables=args.create_tables, reset_demo=args.reset_demo)

