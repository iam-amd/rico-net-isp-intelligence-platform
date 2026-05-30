from services.onu_binding_service import build_binding_identity, normalize_mac, normalize_serial


def test_normalize_mac_to_colon_form():
    assert normalize_mac("8cc7-c330.ac57") == "8C:C7:C3:30:AC:57"


def test_normalize_serial_strips_sn_prefix():
    assert normalize_serial(" sn:GPON00508E6A ") == "GPON00508E6A"


def test_gpon_serial_is_primary_when_identifier_is_serial():
    identity = build_binding_identity(
        onu_identifier="SN:GPON00508E6A",
        ont_mac_address="8CC7C330AC57",
    )

    assert identity["onu_identifier"] == "GPON00508E6A"
    assert identity["onu_type"] == "gpon"
    assert identity["primary_identifier_type"] == "serial"
    assert identity["serial_number"] == "GPON00508E6A"
    assert identity["mac_address"] == "8C:C7:C3:30:AC:57"


def test_epon_mac_is_primary_when_identifier_is_mac():
    identity = build_binding_identity(
        onu_identifier="8CC7C330AC57",
        ont_serial_number="NETLINK123",
    )

    assert identity["onu_identifier"] == "8C:C7:C3:30:AC:57"
    assert identity["onu_type"] == "epon"
    assert identity["primary_identifier_type"] == "mac"
    assert identity["serial_number"] == "NETLINK123"
    assert identity["mac_address"] == "8C:C7:C3:30:AC:57"
