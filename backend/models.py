from sqlalchemy import Column, Integer, BigInteger, String, Float, DateTime, Date, Text, ForeignKey, Boolean, text, Sequence
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base


# =============================================================================
# CUSTOMER
# =============================================================================
class Customer(Base):
    __tablename__ = "customers"

    # --- 0. NUMERIC ID (for mobile/API lookups) ---
    id = Column(Integer, Sequence("customers_id_seq"), autoincrement=True, unique=True, nullable=False)

    # --- 1. IDENTITY ---
    username = Column(String, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String, nullable=True)
    phone = Column(String, index=True)
    email = Column(String, nullable=True, index=True)
    railwire_address = Column(Text)
    notes = Column(Text, nullable=True)

    # --- 2. BILLING ---
    plan_name = Column(String)
    expiry_date = Column(DateTime)
    status = Column(String)
    balance = Column(Float, default=0.0)

    # --- 3. RICO NET SHADOW DATA ---
    rico_address = Column(String, nullable=True)
    geo_lat = Column(Float, nullable=True)
    geo_long = Column(Float, nullable=True)
    pole_id = Column(String, nullable=True)
    splitter_id = Column(String, nullable=True)
    mac_address = Column(String, nullable=True, index=True) # Trusted EPON MAC when field/admin verified
    wifi_ssid = Column(String, nullable=True)           # V2: Router WiFi Name (2.4 GHz)
    wifi_ssid_5g = Column(String, nullable=True)        # V2: Router WiFi Name (5 GHz)
    wifi_password = Column(String, nullable=True)

    # --- 3a. SCRAPER ENRICHMENT ---
    framed_ip = Column(String(45), nullable=True)        # PPPoE framed IP from Railwire
    monthly_data_used_mb = Column(Float, nullable=True)  # Monthly usage in MB from Railwire

    # --- 3b. OLT INTEGRATION (Phase 2) ---
    olt_host = Column(String(45), nullable=True)         # e.g., 10.10.10.100
    pon_port = Column(String(20), nullable=True)         # e.g., epon0/2
    onu_index = Column(Integer, nullable=True)           # e.g., 13

    # --- 4. ENRICHMENT TRACKING (V2) ---
    last_enriched_at = Column(DateTime(timezone=True), nullable=True)
    last_enriched_by = Column(Integer, nullable=True)

    # --- 4b. CONNECTION STATUS ---
    connection_status = Column(String(20), nullable=False, default="unknown", server_default="unknown")
    last_seen_online = Column(DateTime(timezone=True), nullable=True)

    # --- 4c. FIELD SURVEY DATA (Operation Bridge the Gap) ---
    gps_lat = Column(Float, nullable=True)
    gps_lng = Column(Float, nullable=True)
    gps_accuracy_m = Column(Float, nullable=True)
    alt_phone = Column(String(20), nullable=True)
    install_photo_url = Column(String, nullable=True)
    device_setup = Column(String(20), nullable=True)  # single_ont | onu_router
    sticker_photo_url = Column(String, nullable=True)
    ont_serial_number = Column(String(64), nullable=True)
    ont_model = Column(String(64), nullable=True)
    ont_sticker_data = Column(JSONB, nullable=True)
    # Router fields (when customer has ONT + separate router)
    router_sticker_photo_url = Column(String, nullable=True)
    router_mac_address = Column(String(64), nullable=True)
    router_model = Column(String(64), nullable=True)
    router_serial = Column(String(64), nullable=True)
    router_sticker_data = Column(JSONB, nullable=True)
    last_surveyed_at = Column(DateTime(timezone=True), nullable=True)

    # --- 4d. POLE GROUP (segregation by physical pole group) ---
    pg_id = Column(Integer, ForeignKey("pole_groups.id", ondelete="SET NULL"), nullable=True, index=True)

    # --- 5. RELATIONS ---
    tickets = relationship("Ticket", back_populates="customer", cascade="all, delete-orphan")
    phones = relationship("CustomerPhone", back_populates="customer", cascade="all, delete-orphan")  # V2
    audit_logs = relationship("CustomerAuditLog", back_populates="customer", cascade="all, delete-orphan")
    pole_group = relationship("PoleGroup", back_populates="customers")

    @property
    def pg_name(self):
        return self.pole_group.name if self.pole_group else None

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_updated = Column(DateTime(timezone=True), onupdate=func.now())


# =============================================================================
# CUSTOMER PHONES â€” Multi-Number Linking (V2)
# =============================================================================
class CustomerPhone(Base):
    __tablename__ = "customer_phones"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(String, ForeignKey("customers.username", ondelete="CASCADE"), nullable=False)
    phone_number = Column(String(15), nullable=False, unique=True)
    label = Column(String(30), nullable=False, default="Self")
    is_primary = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    customer = relationship("Customer", back_populates="phones")


# =============================================================================
# CUSTOMER AUDIT LOG (DATA HISTORY VIEWER)
# =============================================================================
class CustomerAuditLog(Base):
    __tablename__ = "customer_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(String, ForeignKey("customers.username", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(50), nullable=False) # e.g., 'CREATE', 'UPDATE'
    field_name = Column(String(50), nullable=True) # e.g., 'mac_address'
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    changed_by = Column(String(50), default="System") # e.g., 'Railwire Scraper'
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    customer = relationship("Customer", back_populates="audit_logs")


class CustomerFieldProvenance(Base):
    __tablename__ = "customer_field_provenance"

    customer_id = Column(String, ForeignKey("customers.username", ondelete="CASCADE"), primary_key=True)
    field_name = Column(String(80), primary_key=True)
    source = Column(String(40), nullable=False)
    source_rank = Column(Integer, nullable=False, default=0, server_default="0")
    writer = Column(String(80), nullable=True)
    evidence_ref = Column(String(500), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    verified_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)


class CustomerSyncState(Base):
    __tablename__ = "customer_sync_state"

    customer_id = Column(String, ForeignKey("customers.username", ondelete="CASCADE"), primary_key=True)
    source = Column(String(40), nullable=False, default="railwire_scraper", server_default="railwire_scraper")
    last_csv_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_details_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_mac_synced_at = Column(DateTime(timezone=True), nullable=True)
    source_updated_at = Column(DateTime(timezone=True), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_status = Column(String(30), nullable=False, default="success", server_default="success")
    last_error = Column(Text, nullable=True)
    error_count = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


# =============================================================================
# TICKET
# =============================================================================
class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(String, ForeignKey("customers.username"))

    # Complaint Details
    issue_type = Column(String)
    priority = Column(String, default="Normal")
    status = Column(String, default="Open", index=True)

    description = Column(Text, nullable=True)
    assigned_tech = Column(String, nullable=True)  # Kept as string for backward compat

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    assigned_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)       # V2
    resolved_at = Column(DateTime(timezone=True), nullable=True)      # V2
    closed_at = Column(DateTime(timezone=True), nullable=True)

    # Smart Fields
    sub_issue = Column(String, nullable=True)
    tags = Column(String, nullable=True)
    internal_notes = Column(Text, nullable=True)
    materials_used = Column(Text, nullable=True)
    resolution_remarks = Column(Text, nullable=True)                  # V2: Completion Popup

    # RELATIONS
    customer = relationship("Customer", back_populates="tickets")
    comments = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan")
    media = relationship("TicketMedia", back_populates="ticket", cascade="all, delete-orphan")
    audit_log = relationship("TicketAuditLog", back_populates="ticket", cascade="all, delete-orphan")  # V2


# =============================================================================
# TICKET COMMENTS
# =============================================================================
class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    author = Column(String)
    content = Column(Text)
    is_internal = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="comments")


# =============================================================================
# TICKET MEDIA
# =============================================================================
class TicketMedia(Base):
    __tablename__ = "ticket_media"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    file_type = Column(String, default="image")
    file_path = Column(String)
    filename = Column(String)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="media")


# =============================================================================
# TICKET AUDIT LOG (V2)
# =============================================================================
class TicketAuditLog(Base):
    __tablename__ = "ticket_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    changed_by = Column(Integer, nullable=True)

    action = Column(String(50), nullable=False)
    field_name = Column(String(50), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=True)

    changed_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("Ticket", back_populates="audit_log")


# =============================================================================
# TECHNICIAN (V2 â€” Full Profile Management)
# =============================================================================
class Technician(Base):
    __tablename__ = "technicians"

    # --- Core (V1 â€” unchanged) ---
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String)
    role = Column(String, default="Field Tech")
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- Contact (V2) ---
    phone = Column(String(15), nullable=True)
    email = Column(String, nullable=True)
    emergency_contact = Column(String(15), nullable=True)

    # --- Professional (V2) ---
    specialization = Column(String(50), nullable=True, default="General")
    area_assigned = Column(String(100), nullable=True)
    employment_type = Column(String(30), nullable=True, default="Full-Time")
    join_date = Column(DateTime(timezone=True), nullable=True)

    # --- Extra (V2) ---
    address = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    profile_photo = Column(String, nullable=True)

    # --- Push Notifications ---
    push_token = Column(String(255), nullable=True)
    push_platform = Column(String(10), nullable=True)  # 'ios', 'android', 'web'

    # --- Tracking (V2) ---
    last_login = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


# =============================================================================
# NETWORK NODES (V2 â€” For Auto-Diagnostics)
# =============================================================================
class NetworkNode(Base):
    __tablename__ = "network_nodes"

    id = Column(Integer, primary_key=True, index=True)
    node_name = Column(String(50), nullable=False, unique=True)
    area = Column(String(100), nullable=True)
    node_type = Column(String(30), nullable=False, default="pole")
    geo_lat = Column(Float, nullable=True)
    geo_long = Column(Float, nullable=True)
    is_operational = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    outages = relationship("NodeOutage", back_populates="node", cascade="all, delete-orphan")


# =============================================================================
# NODE OUTAGES (V2)
# =============================================================================
class NodeOutage(Base):
    __tablename__ = "node_outages"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey("network_nodes.id", ondelete="CASCADE"), nullable=False)
    outage_type = Column(String(50), nullable=False, default="unknown")
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    reported_by = Column(Integer, nullable=True)

    node = relationship("NetworkNode", back_populates="outages")


# =============================================================================
# INVENTORY
# =============================================================================
class InventoryItem(Base):
    __tablename__ = "inventory"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    category = Column(String, default="General")
    quantity = Column(Integer, default=0)
    unit = Column(String, default="units")

    last_updated = Column(DateTime(timezone=True), onupdate=func.now())


# =============================================================================
# ONU SNAPSHOTS (Phase 2 â€” Time-Series OLT Polling Data)
# =============================================================================
class ONUSnapshot(Base):
    __tablename__ = "onu_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    mac_address = Column(String(17), nullable=False, index=True)
    olt_host = Column(String(45), nullable=True)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    status = Column(String(10), nullable=True)  # online/offline
    rx_power_dbm = Column(Float, nullable=True)
    tx_power_dbm = Column(Float, nullable=True)
    temperature_c = Column(Float, nullable=True)
    voltage_mv = Column(Integer, nullable=True)
    flap_count = Column(Integer, nullable=True)
    dying_gasp = Column(Boolean, nullable=False, default=False)
    distance_m = Column(Integer, nullable=True)
    rx_bytes_delta = Column(Integer, nullable=True)
    tx_bytes_delta = Column(Integer, nullable=True)
    alive_time_sec = Column(Integer, nullable=True)
    rtt_ns = Column(BigInteger, nullable=True)
    tx_bias_current_ma = Column(Float, nullable=True)
    polled_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# ALARM EVENTS (Phase 2 â€” SNMP Trap Events + Lifecycle)
# =============================================================================
class AlarmEvent(Base):
    __tablename__ = "alarm_events"

    id = Column(Integer, primary_key=True, index=True)
    mac_address = Column(String(64), nullable=False, index=True)
    event_type = Column(String(50), nullable=False)  # ONU_OFFLINE, DYING_GASP, FIBER_CRITICAL, etc.
    olt_host = Column(String(45), nullable=True)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    payload = Column(JSONB, nullable=True)  # Raw trap data
    auto_ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- Lifecycle (Migration 005) ---
    status = Column(String(20), nullable=False, server_default="open")
    # open | resolved | suppressed
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)   # resolved_at - received_at
    occurrence_count = Column(Integer, nullable=False, server_default="1")
    last_seen = Column(DateTime(timezone=True), nullable=True)
    pon_port_outage_id = Column(
        Integer,
        ForeignKey("pon_port_outages.id", ondelete="SET NULL"),
        nullable=True,
    )
    area_outage_id = Column(
        Integer,
        ForeignKey("area_outages.id", ondelete="SET NULL"),
        nullable=True,
    )
    acknowledged_by = Column(Integer, nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    suppressed_until = Column(DateTime(timezone=True), nullable=True)
    resolution_reason = Column(String(120), nullable=True)
    operator_note = Column(Text, nullable=True)


# =============================================================================
# OLT MAINTENANCE WINDOWS (planned work suppression for alarm processor)
# =============================================================================
class OLTMaintenanceWindow(Base):
    __tablename__ = "olt_maintenance_windows"

    id = Column(Integer, primary_key=True, index=True)
    olt_host = Column(String(45), nullable=False, index=True)
    pon_port = Column(String(20), nullable=True, index=True)
    starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
    ends_at = Column(DateTime(timezone=True), nullable=False, index=True)
    reason = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    cancelled_by = Column(Integer, nullable=True)


# =============================================================================
# ONU LATEST (Phase 3 â€” Materialized latest state per ONU for NOC Dashboard)
# =============================================================================
class ONULatest(Base):
    __tablename__ = "onu_latest"

    mac_address = Column(String(17), primary_key=True)
    olt_host = Column(String(45), nullable=False)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    status = Column(String(10), nullable=True)
    rx_power_dbm = Column(Float, nullable=True)
    tx_power_dbm = Column(Float, nullable=True)
    temperature_c = Column(Float, nullable=True)
    voltage_mv = Column(Integer, nullable=True)
    dying_gasp = Column(Boolean, nullable=False, default=False)
    polled_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Device inventory (from show onu basic-info all)
    vendor_id = Column(String(20), nullable=True)
    model_id = Column(String(20), nullable=True)
    hw_version = Column(String(20), nullable=True)
    sw_version = Column(String(30), nullable=True)
    # Web portal extra fields (populated when transport=web)
    deregister_reason = Column(String(50), nullable=True)
    alive_time_sec = Column(Integer, nullable=True)
    rtt_ns = Column(BigInteger, nullable=True)
    tx_bias_current_ma = Column(Float, nullable=True)


# =============================================================================
# ONU HOURLY AGGREGATES (Phase 4 â€” Data Retention)
# =============================================================================
class ONUHourly(Base):
    __tablename__ = "onu_hourly"

    mac_address = Column(String(17), primary_key=True)
    hour = Column(DateTime(timezone=True), primary_key=True)  # truncated to hour
    avg_rx = Column(Float, nullable=True)
    min_rx = Column(Float, nullable=True)
    max_rx = Column(Float, nullable=True)
    avg_tx = Column(Float, nullable=True)
    online_pct = Column(Float, nullable=True)  # 0â€“100%
    sample_count = Column(Integer, nullable=False, default=0)


# =============================================================================
# ONU DAILY AGGREGATES (Phase 4 â€” Data Retention)
# =============================================================================
class ONUDaily(Base):
    __tablename__ = "onu_daily"

    mac_address = Column(String(17), primary_key=True)
    day = Column(Date, primary_key=True)
    avg_rx = Column(Float, nullable=True)
    min_rx = Column(Float, nullable=True)
    max_rx = Column(Float, nullable=True)
    avg_tx = Column(Float, nullable=True)
    online_pct = Column(Float, nullable=True)
    sample_count = Column(Integer, nullable=False, default=0)


# =============================================================================
# PREDICTIONS (Phase 6 â€” Nightly risk scoring per ONU)
# =============================================================================
class Prediction(Base):
    __tablename__ = "predictions"

    mac_address = Column(String(17), primary_key=True)
    olt_host = Column(String(45), nullable=True)
    pon_port = Column(String(20), nullable=True)
    # Fiber health
    rx_slope_7d = Column(Float, nullable=True)      # dBm/day negative = degrading
    rx_avg_7d = Column(Float, nullable=True)
    # Fault history
    alarm_count_30d = Column(Integer, nullable=False, default=0)
    offline_count_30d = Column(Integer, nullable=False, default=0)
    # Risk levels
    fiber_risk = Column(String(10), nullable=True)  # LOW / MEDIUM / HIGH / CRITICAL
    churn_risk = Column(String(10), nullable=True)  # LOW / MEDIUM / HIGH
    health_score = Column(Integer, nullable=False, default=100)  # 0â€“100
    recommended_action = Column(String(150), nullable=True)
    # Cached customer info for display
    customer_name = Column(String(120), nullable=True)
    customer_phone = Column(String(20), nullable=True)
    last_computed = Column(DateTime(timezone=True), nullable=True)


# =============================================================================
# CUSTOMER DNA (OLT Engine output â€” one row per customer)
# =============================================================================
class CustomerDNA(Base):
    __tablename__ = "customer_dna"

    username = Column(String, ForeignKey("customers.username", ondelete="CASCADE"), primary_key=True)

    railwire_mac = Column(String(17), nullable=True)
    sticker_optical_mac = Column(String(17), nullable=True)
    sticker_serial = Column(String(64), nullable=True)
    router_mac = Column(String(17), nullable=True)

    olt_host = Column(String(45), nullable=True)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    optical_mac = Column(String(17), nullable=True)
    optical_serial = Column(String(64), nullable=True)

    binding_source = Column(String(20), nullable=True)
    confidence = Column(String(15), nullable=True)
    railwire_to_optical_offset = Column(Integer, nullable=True)

    status = Column(String(10), nullable=True)
    rx_power_dbm = Column(Float, nullable=True)
    tx_power_dbm = Column(Float, nullable=True)
    temperature_c = Column(Float, nullable=True)
    voltage_mv = Column(Integer, nullable=True)
    dying_gasp = Column(Boolean, default=False)
    polled_at = Column(DateTime(timezone=True), nullable=True)

    signal_label = Column(String(15), nullable=True)
    fault_type = Column(String(30), nullable=True)
    health_score = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)
    last_reconciled_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.now(), nullable=False)


# =============================================================================
# TECH LOCATIONS (Field Team GPS â€” live position from mobile app)
# =============================================================================
class TechLocation(Base):
    __tablename__ = "tech_locations"

    id = Column(Integer, primary_key=True, index=True)
    technician_id = Column(Integer, ForeignKey("technicians.id"), nullable=False, index=True)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    accuracy_m = Column(Float, nullable=True)
    battery_pct = Column(Integer, nullable=True)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# ONU BINDINGS (Operation Bridge the Gap â€” authoritative customer-to-ONU link)
# =============================================================================
class ONUBinding(Base):
    __tablename__ = "onu_bindings"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(
        String,
        ForeignKey("customers.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    onu_identifier = Column(String(64), nullable=False, index=True)  # MAC or SN
    onu_type = Column(String(10), nullable=False)  # 'epon' | 'gpon'
    primary_identifier_type = Column(String(10), nullable=True)  # mac | serial
    serial_number = Column(String(64), nullable=True, index=True)
    mac_address = Column(String(64), nullable=True, index=True)
    olt_host = Column(String(45), nullable=True)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    binding_source = Column(String(20), nullable=False, default="field_scan")
    # field_scan | manual | mac_match | tech_scan
    confidence = Column(String(15), nullable=False, default="verified")
    # verified | probable | guess
    first_seen = Column(DateTime(timezone=True), server_default=func.now())
    last_seen = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    verified_at = Column(DateTime(timezone=True), nullable=True)
    verified_by_user_id = Column(Integer, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    deactivated_at = Column(DateTime(timezone=True), nullable=True)
    deactivated_reason = Column(String(120), nullable=True)
    sticker_photo_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)


# =============================================================================
# COLLECTION CAMPAIGNS (Operation Bridge the Gap)
# =============================================================================
class CollectionCampaign(Base):
    __tablename__ = "collection_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(15), nullable=False, default="active")
    # active | paused | ended
    target_count = Column(Integer, nullable=False, default=0)
    completed_count = Column(Integer, nullable=False, default=0)
    skipped_count = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)


# =============================================================================
# COLLECTION ASSIGNMENTS (per-customer per-collector work item)
# =============================================================================
class CollectionAssignment(Base):
    __tablename__ = "collection_assignments"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer,
        ForeignKey("collection_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    collector_id = Column(
        Integer,
        ForeignKey("technicians.id"),
        nullable=False,
        index=True,
    )
    customer_id = Column(
        String,
        ForeignKey("customers.username", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = Column(String(20), nullable=False, default="pending", index=True)
    # pending | in_progress | done | skipped | no_access | needs_review
    skip_reason = Column(String(60), nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


# =============================================================================
# POLE GROUPS (physical fiber split groups â€” 500+ of them in the field)
# =============================================================================
class PoleGroup(Base):
    __tablename__ = "pole_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), unique=True, nullable=False, index=True)
    description = Column(Text, nullable=True)
    area = Column(String(80), nullable=True, index=True)  # Optional grouping (e.g. "Kanchipuram East")
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    customers = relationship("Customer", back_populates="pole_group")


# =============================================================================
# ONU STATE EVENTS (state changes only â€” onlineâ†”offline, threshold crossings)
# =============================================================================
class ONUStateEvent(Base):
    __tablename__ = "onu_state_events"

    id = Column(Integer, primary_key=True, index=True)
    mac_address = Column(String(64), nullable=False, index=True)
    olt_host = Column(String(45), nullable=False)
    pon_port = Column(String(20), nullable=True)
    onu_index = Column(Integer, nullable=True)
    event_type = Column(String(30), nullable=False)
    # status_change | threshold_crossed | threshold_recovered | signal_drop | high_temp | flap_spike
    from_state = Column(String(30), nullable=True)
    to_state = Column(String(30), nullable=False)
    rx_power_dbm = Column(Float, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# PON PORT OUTAGES (â‰¥3 ONUs offline on same port in 60s window)
# =============================================================================
class PONPortOutage(Base):
    __tablename__ = "pon_port_outages"

    id = Column(Integer, primary_key=True, index=True)
    olt_host = Column(String(45), nullable=False)
    pon_port = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, server_default="open")
    # open | resolved
    affected_count = Column(Integer, nullable=False, server_default="0")
    fault_type = Column(String(30), server_default="UNKNOWN")
    # UNKNOWN | PON_FIBER_CUT | OLT_PORT_FAILURE | POWER_CUT
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)


# =============================================================================
# AREA OUTAGES (GPS cluster: â‰¥3 ONUs offline within 500m in 120s)
# =============================================================================
class AreaOutage(Base):
    __tablename__ = "area_outages"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(String(20), nullable=False, server_default="open")
    # open | resolved
    affected_count = Column(Integer, nullable=False, server_default="0")
    centroid_lat = Column(Float, nullable=True)
    centroid_lng = Column(Float, nullable=True)
    radius_m = Column(Float, nullable=True)
    fault_type = Column(String(30), server_default="POWER_CUT")
    area_name = Column(String(120), nullable=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    duration_seconds = Column(Integer, nullable=True)


# =============================================================================
# OLT HEALTH (per-OLT ingest watchdog â€” stale data detection)
# =============================================================================
class OLTHealth(Base):
    __tablename__ = "olt_health"

    olt_host = Column(String(45), primary_key=True)
    last_snapshot_at = Column(DateTime(timezone=True), nullable=True)
    last_trap_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, server_default="unknown")
    # unknown | ok | stale | unreachable
    stale_since = Column(DateTime(timezone=True), nullable=True)
    snapshot_count_24h = Column(Integer, server_default="0")
    collector_id = Column(String(80), nullable=True, index=True)
    collector_name = Column(String(120), nullable=True)
    collector_hostname = Column(String(120), nullable=True)
    collector_ip = Column(String(45), nullable=True)
    collector_version = Column(String(40), nullable=True)
    collector_started_at = Column(DateTime(timezone=True), nullable=True)
    last_collector_seen_at = Column(DateTime(timezone=True), nullable=True)
    last_batch_size = Column(Integer, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# =============================================================================
# COLLECTION LOG (full audit trail â€” end-to-end journal)
# =============================================================================
class CollectorHealth(Base):
    __tablename__ = "collector_health"

    collector_id = Column(String(80), primary_key=True)
    collector_name = Column(String(120), nullable=True)
    collector_hostname = Column(String(120), nullable=True)
    collector_ip = Column(String(45), nullable=True)
    collector_version = Column(String(40), nullable=True)
    collector_started_at = Column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_snapshot_at = Column(DateTime(timezone=True), nullable=True)
    last_status = Column(String(30), nullable=False, server_default="unknown")
    last_message = Column(Text, nullable=True)
    backend_url = Column(String(500), nullable=True)
    configured_olts = Column(JSONB, nullable=True)
    last_batch_total = Column(Integer, nullable=True)
    heartbeat_count = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CollectorCredential(Base):
    __tablename__ = "collector_credentials"

    collector_id = Column(String(80), primary_key=True)
    token_hash = Column(String(64), nullable=False)
    token_last_four = Column(String(8), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    rotated_at = Column(DateTime(timezone=True), nullable=True)


class CollectionLog(Base):
    __tablename__ = "collection_log"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(Integer, nullable=True, index=True)
    assignment_id = Column(Integer, nullable=True, index=True)
    customer_id = Column(String, nullable=True, index=True)
    collector_id = Column(Integer, nullable=True, index=True)
    action = Column(String(40), nullable=False)
    # opened | gps_captured | onu_scanned | submitted | skipped | failed
    # | admin_correction | duplicate_resolved | reassigned
    payload = Column(JSONB, nullable=True)
    message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


# =============================================================================
# PG BUILDINGS â€” Paying Guest Property Management (Phase 4)
# =============================================================================

class PGBuilding(Base):
    __tablename__ = "pg_buildings"

    id = Column(String(36), primary_key=True)          # UUID from mobile
    name = Column(String(200), nullable=False)
    pg_type = Column(String(20), nullable=False, default='Mixed')
    address = Column(Text, nullable=True)
    owner_name = Column(String(120), nullable=False)
    owner_mobile = Column(String(20), nullable=True)
    owner_alt_mobile = Column(String(20), nullable=True)
    gps_lat = Column(Float, nullable=True)
    gps_lng = Column(Float, nullable=True)
    photo_url = Column(String(500), nullable=True)
    created_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    floors = relationship("PGFloor", back_populates="building", cascade="all, delete-orphan", order_by="PGFloor.floor_number")
    rooms = relationship("PGRoom", back_populates="building", cascade="all, delete-orphan")
    router_groups = relationship("PGRouterGroup", back_populates="building", cascade="all, delete-orphan")


class PGFloor(Base):
    __tablename__ = "pg_floors"

    id = Column(String(36), primary_key=True)
    building_id = Column(String(36), ForeignKey("pg_buildings.id", ondelete="CASCADE"), nullable=False, index=True)
    floor_number = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    building = relationship("PGBuilding", back_populates="floors")
    rooms = relationship("PGRoom", back_populates="floor", cascade="all, delete-orphan", order_by="PGRoom.room_number")
    router_groups = relationship("PGRouterGroup", back_populates="floor", cascade="all, delete-orphan")


class PGRouterGroup(Base):
    __tablename__ = "pg_router_groups"

    id = Column(String(36), primary_key=True)
    building_id = Column(String(36), ForeignKey("pg_buildings.id", ondelete="CASCADE"), nullable=False, index=True)
    floor_id = Column(String(36), ForeignKey("pg_floors.id", ondelete="CASCADE"), nullable=False, index=True)
    group_name = Column(String(100), nullable=False)
    ont_serial = Column(String(64), nullable=True)
    mac_address = Column(String(17), nullable=True)
    username = Column(String(50), nullable=True)
    photo_url = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    building = relationship("PGBuilding", back_populates="router_groups")
    floor = relationship("PGFloor", back_populates="router_groups")
    rooms = relationship("PGRoom", back_populates="router_group", foreign_keys="PGRoom.router_group_id")


class PGRoom(Base):
    __tablename__ = "pg_rooms"

    id = Column(String(36), primary_key=True)
    building_id = Column(String(36), ForeignKey("pg_buildings.id", ondelete="CASCADE"), nullable=False, index=True)
    floor_id = Column(String(36), ForeignKey("pg_floors.id", ondelete="CASCADE"), nullable=False, index=True)
    router_group_id = Column(String(36), ForeignKey("pg_router_groups.id", ondelete="SET NULL"), nullable=True, index=True)
    room_number = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default='pending')
    connection_type = Column(String(20), nullable=False, default='none')
    device_setup = Column(String(20), nullable=True)  # single_ont | onu_router
    username = Column(String(50), nullable=True)
    ont_serial = Column(String(64), nullable=True)
    mac_address = Column(String(32), nullable=True)
    ont_model = Column(String(64), nullable=True)
    ont_sticker_photo_url = Column(String(500), nullable=True)
    ont_sticker_data = Column(JSONB, nullable=True)
    router_sticker_photo_url = Column(String(500), nullable=True)
    router_mac_address = Column(String(32), nullable=True)
    router_serial = Column(String(64), nullable=True)
    router_model = Column(String(64), nullable=True)
    router_sticker_data = Column(JSONB, nullable=True)
    wifi_ssid = Column(String(100), nullable=True)
    wifi_ssid_5g = Column(String(100), nullable=True)
    wifi_password = Column(String(100), nullable=True)
    scan_history = Column(Text, nullable=True)           # JSON list of {ts,mac,serial,model,wifi_ssid,source}
    tech_note = Column(Text, nullable=True)
    photo_urls = Column(Text, nullable=True)             # JSON-serialised list of URLs
    collected_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    building = relationship("PGBuilding", back_populates="rooms")
    floor = relationship("PGFloor", back_populates="rooms")
    router_group = relationship("PGRouterGroup", back_populates="rooms", foreign_keys=[router_group_id])


class PGChangeEvent(Base):
    __tablename__ = "pg_change_events"

    id = Column(Integer, primary_key=True, index=True)
    entity_type = Column(String(20), nullable=False, index=True)  # building | room
    entity_id = Column(String(36), nullable=False, index=True)
    building_id = Column(String(36), ForeignKey("pg_buildings.id", ondelete="CASCADE"), nullable=True, index=True)
    room_id = Column(String(36), ForeignKey("pg_rooms.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(40), nullable=False)
    reason = Column(Text, nullable=True)
    changed_by = Column(String(80), nullable=True)
    before_data = Column(JSONB, nullable=True)
    after_data = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
