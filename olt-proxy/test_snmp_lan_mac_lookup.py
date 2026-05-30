import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import snmp_client


def test_mac_oid_suffix_normalizes_common_formats():
    assert snmp_client._mac_oid_suffix("8C:C7:C3:30:AC:57") == "140.199.195.48.172.87"
    assert snmp_client._mac_oid_suffix("8cc7c330ac57") == "140.199.195.48.172.87"
    assert snmp_client._mac_oid_suffix("01:00:5e:00:00:01") is None


def test_epon_lan_mac_exact_get_confirms_placement(monkeypatch):
    def fake_get_value(host, oid, timeout):
        assert host == "10.10.10.100"
        assert oid.endswith(".6.140.199.195.48.172.87")
        return "EPON0/6:7"

    monkeypatch.setattr(snmp_client, "_get_value", fake_get_value)

    match = snmp_client.lookup_lan_mac("10.10.10.100", "8C:C7:C3:30:AC:57")

    assert match["supported"] is True
    assert match["confidence"] == "confirmed"
    assert match["placement_confirmed"] is True
    assert match["pon_port"] == "0/6"
    assert match["onu_index"] == 7


def test_gpon_200_lan_mac_requires_survey_without_guessing():
    match = snmp_client.lookup_lan_mac("10.10.10.200", "8C:C7:C3:30:AC:57")

    assert match["supported"] is False
    assert match["confidence"] == "unknown"
    assert match["match_method"] == "survey_required"
    assert match["pon_port"] is None
    assert match["onu_index"] is None


def test_gpon_210_confirms_presence_but_not_placement(monkeypatch):
    monkeypatch.setattr(
        snmp_client,
        "_get_value",
        lambda host, oid, timeout: "8cc7c330ac57",
    )

    match = snmp_client.lookup_lan_mac("10.10.10.210", "8C:C7:C3:30:AC:57")

    assert match["supported"] is True
    assert match["confidence"] == "confirmed_presence"
    assert match["placement_confirmed"] is False
    assert match["pon_port"] is None
    assert match["onu_index"] is None


def test_epon_lan_mac_phys_port_only_placement(monkeypatch):
    def fake_get_value(host, oid, timeout):
        assert host == "10.10.10.100"
        return "PON1"

    monkeypatch.setattr(snmp_client, "_get_value", fake_get_value)

    match = snmp_client.lookup_lan_mac("10.10.10.100", "62:7E:65:D2:F7:32")

    assert match["supported"] is True
    assert match["confidence"] == "probable_port"
    assert match["placement_confirmed"] is False
    assert match["pon_port"] == "0/1"
    assert match["onu_index"] is None

