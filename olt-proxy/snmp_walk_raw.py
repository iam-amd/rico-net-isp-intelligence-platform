"""
Raw SNMP v2c walker â€” no external dependencies beyond stdlib.
Uses BER-encoded UDP packets directly.
"""

import socket
import struct
import sys
import time


# â”€â”€ BER ENCODING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _encode_length(n):
    if n < 0x80:
        return bytes([n])
    enc = []
    while n:
        enc.append(n & 0xFF)
        n >>= 8
    enc.reverse()
    return bytes([0x80 | len(enc)] + enc)


def _encode_tlv(tag, value):
    return bytes([tag]) + _encode_length(len(value)) + value


def encode_int(n):
    if n == 0:
        return _encode_tlv(0x02, b'\x00')
    neg = n < 0
    out = []
    while n not in (0, -1):
        out.append(n & 0xFF)
        n >>= 8
    if neg and out and not (out[-1] & 0x80):
        out.append(0xFF)
    elif not neg and out and (out[-1] & 0x80):
        out.append(0x00)
    out.reverse()
    return _encode_tlv(0x02, bytes(out))


def encode_string(s):
    if isinstance(s, str):
        s = s.encode()
    return _encode_tlv(0x04, s)


def encode_null():
    return b'\x05\x00'


def encode_oid(oid_str):
    parts = [int(x) for x in oid_str.strip('.').split('.')]
    first = parts[0] * 40 + parts[1]
    rest = parts[2:]
    out = []

    def encode_part(n):
        if n == 0:
            return [0]
        buf = []
        while n:
            buf.append(n & 0x7F)
            n >>= 7
        buf.reverse()
        for i in range(len(buf) - 1):
            buf[i] |= 0x80
        return buf

    out.extend(encode_part(first))
    for p in rest:
        out.extend(encode_part(p))
    return _encode_tlv(0x06, bytes(out))


def encode_sequence(contents):
    return _encode_tlv(0x30, contents)


# â”€â”€ BER DECODING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _decode_length(data, pos):
    first = data[pos]
    if first < 0x80:
        return first, pos + 1
    num_bytes = first & 0x7F
    n = 0
    for i in range(num_bytes):
        n = (n << 8) | data[pos + 1 + i]
    return n, pos + 1 + num_bytes


def _decode_tlv(data, pos):
    tag = data[pos]
    length, pos = _decode_length(data, pos + 1)
    value = data[pos:pos + length]
    return tag, value, pos + length


def decode_oid(value):
    pos = 0
    parts = []
    first = value[pos]
    parts.append(first // 40)
    parts.append(first % 40)
    pos += 1
    while pos < len(value):
        n = 0
        while True:
            b = value[pos]
            pos += 1
            n = (n << 7) | (b & 0x7F)
            if not (b & 0x80):
                break
        parts.append(n)
    return '.'.join(str(p) for p in parts)


def decode_int(value):
    if isinstance(value, int):
        return value
    if not value:
        return 0
    n = value[0]
    if n & 0x80:
        n -= 256
    for b in value[1:]:
        n = (n << 8) | b
    return n


def decode_value(tag, value):
    if tag == 0x02:  # INTEGER
        return ('int', decode_int(value))
    elif tag == 0x04:  # OCTET STRING
        # Use strict UTF-8; binary data (MAC addresses, etc.) raises and
        # returns lowercase hex so _parse_mac("8cc7c3eac709") works directly.
        try:
            return ('str', value.decode('utf-8'))
        except (UnicodeDecodeError, ValueError):
            return ('hex', value.hex())
    elif tag == 0x06:  # OID
        return ('oid', decode_oid(value))
    elif tag == 0x05:  # NULL
        return ('null', None)
    elif tag == 0x40:  # IpAddress
        if len(value) == 4:
            return ('ip', '.'.join(str(b) for b in value))
        return ('ip', value.hex())
    elif tag == 0x41:  # Counter32
        return ('counter32', decode_int(value))
    elif tag == 0x42:  # Gauge32
        return ('gauge32', decode_int(value))
    elif tag == 0x43:  # TimeTicks
        return ('timeticks', decode_int(value))
    elif tag == 0x44:  # Opaque
        return ('opaque', value.hex())
    elif tag == 0x46:  # Counter64
        return ('counter64', decode_int(value))
    elif tag == 0x80:  # NoSuchObject
        return ('nosuchobject', None)
    elif tag == 0x81:  # NoSuchInstance
        return ('nosuchinstance', None)
    elif tag == 0x82:  # EndOfMibView
        return ('endofmib', None)
    else:
        return (f'tag0x{tag:02x}', value.hex())


def parse_response(data):
    """Parse SNMP response, return list of (oid_str, type, value)."""
    results = []
    pos = 0

    # outer SEQUENCE
    tag, msg_val, _ = _decode_tlv(data, pos)
    pos = 0

    inner = msg_val
    ipos = 0

    # version
    tag, version_val, ipos = _decode_tlv(inner, ipos)
    # community
    tag, community_val, ipos = _decode_tlv(inner, ipos)
    # PDU
    pdu_tag = inner[ipos]
    pdu_len, ipos = _decode_length(inner, ipos + 1)
    pdu = inner[ipos:ipos + pdu_len]

    ppos = 0
    # request-id
    tag, req_id_val, ppos = _decode_tlv(pdu, ppos)
    # error-status
    tag, err_status_val, ppos = _decode_tlv(pdu, ppos)
    err_status = decode_int(err_status_val)
    # error-index
    tag, err_idx_val, ppos = _decode_tlv(pdu, ppos)

    if err_status != 0:
        return None, err_status

    # variable-bindings SEQUENCE
    tag, vb_val, ppos = _decode_tlv(pdu, ppos)

    vpos = 0
    while vpos < len(vb_val):
        # each varbind is a SEQUENCE of OID + value
        tag, vb, vpos = _decode_tlv(vb_val, vpos)
        bpos = 0
        tag2, oid_val, bpos = _decode_tlv(vb, bpos)
        oid_str = decode_oid(oid_val)
        tag3, raw_val, bpos = _decode_tlv(vb, bpos)
        t, v = decode_value(tag3, raw_val)
        results.append((oid_str, t, v))

    return results, 0


# â”€â”€ SNMP GET-BULK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_req_id = 1

def build_getbulk(community, oid_str, max_reps=25):
    global _req_id
    _req_id = (_req_id + 1) & 0x7FFFFFFF

    varbind = encode_sequence(encode_oid(oid_str) + encode_null())
    varbind_list = encode_sequence(varbind)

    # GetBulk PDU = tag 0xA5
    pdu_contents = (
        encode_int(_req_id) +   # request-id
        encode_int(0) +          # non-repeaters
        encode_int(max_reps) +   # max-repetitions
        varbind_list
    )
    pdu = bytes([0xA5]) + _encode_length(len(pdu_contents)) + pdu_contents

    msg = encode_int(1) + encode_string(community) + pdu  # version=1 means v2c
    return encode_sequence(msg)


def build_get(community, oid_str):
    """Build an SNMP v2c GET-Request packet for one OID."""
    global _req_id
    _req_id = (_req_id + 1) & 0x7FFFFFFF

    varbind = encode_sequence(encode_oid(oid_str) + encode_null())
    varbind_list = encode_sequence(varbind)

    pdu_contents = (
        encode_int(_req_id) +
        encode_int(0) +
        encode_int(0) +
        varbind_list
    )
    pdu = bytes([0xA0]) + _encode_length(len(pdu_contents)) + pdu_contents

    msg = encode_int(1) + encode_string(community) + pdu
    return encode_sequence(msg)


# â”€â”€ MAIN WALKER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def snmp_walk(host, community='public', start_oid='1.3.6.1', port=161,
              timeout=5, max_reps=25):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)

    current_oid = start_oid
    results = []
    end_marker = start_oid

    while True:
        pkt = build_getbulk(community, current_oid, max_reps)
        try:
            sock.sendto(pkt, (host, port))
            resp_data, _ = sock.recvfrom(65535)
        except socket.timeout:
            print(f'  Timeout at OID {current_oid}')
            break

        varbinds, err = parse_response(resp_data[1:] if resp_data[0] != 0x30 else resp_data)
        # strip outer 0x30 wrapper correctly
        if resp_data[0] == 0x30:
            _, inner, _ = _decode_tlv(resp_data, 0)
            varbinds, err = parse_response(b'\x30' + _encode_length(len(inner)) + inner)
            # Actually just call parse_response on the raw data directly
            varbinds, err = _parse_snmp_msg(resp_data)

        if varbinds is None or err != 0:
            break

        last_oid = current_oid
        for oid, t, v in varbinds:
            if t in ('endofmib', 'nosuchobject', 'nosuchinstance'):
                sock.close()
                return results
            if not oid.startswith(end_marker):
                sock.close()
                return results
            results.append((oid, t, v))
            current_oid = oid

        if current_oid == last_oid:
            break

    sock.close()
    return results


def _parse_snmp_msg(data):
    """Parse raw SNMP message bytes."""
    results = []
    pos = 0

    if data[0] != 0x30:
        return None, -1

    msg_len, pos = _decode_length(data, 1)
    msg = data[pos:pos + msg_len]
    mpos = 0

    # version
    tag, version_val, mpos = _decode_tlv(msg, mpos)
    # community
    tag, community_val, mpos = _decode_tlv(msg, mpos)
    # PDU (GetResponse = 0xA2)
    pdu_tag = msg[mpos]
    pdu_len, mpos = _decode_length(msg, mpos + 1)
    pdu = msg[mpos:mpos + pdu_len]

    ppos = 0
    tag, req_id_val, ppos = _decode_tlv(pdu, ppos)
    tag, err_status_val, ppos = _decode_tlv(pdu, ppos)
    err_status = decode_int(err_status_val)
    tag, err_idx_val, ppos = _decode_tlv(pdu, ppos)

    if err_status != 0:
        return None, err_status

    tag, vb_list_val, ppos = _decode_tlv(pdu, ppos)

    vpos = 0
    while vpos < len(vb_list_val):
        tag, vb, vpos = _decode_tlv(vb_list_val, vpos)
        bpos = 0
        tag2, oid_val, bpos = _decode_tlv(vb, bpos)
        oid_str = decode_oid(oid_val)
        tag3, raw_val, bpos = _decode_tlv(vb, bpos)
        t, v = decode_value(tag3, raw_val)
        results.append((oid_str, t, v))

    return results, 0


def oid_tuple(oid_str):
    """Convert OID string to tuple of ints for correct numeric comparison."""
    return tuple(int(x) for x in oid_str.strip('.').split('.'))


def oid_startswith(oid_str, prefix):
    """Check if oid_str is under prefix subtree."""
    o = oid_tuple(oid_str)
    p = oid_tuple(prefix)
    return o[:len(p)] == p


def walk(host, community='public', start_oid='1.3.6.1', port=161, timeout=5, max_reps=50):
    """Walk OLT SNMP tree from start_oid. Returns list of (oid, type, value)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)

    current_oid = start_oid
    current_oid_t = oid_tuple(start_oid)
    results = []

    while True:
        pkt = build_getbulk(community, current_oid, max_reps)
        try:
            sock.sendto(pkt, (host, port))
            resp_data, _ = sock.recvfrom(65535)
        except socket.timeout:
            print(f'  Timeout at {current_oid}', file=sys.stderr)
            break

        varbinds, err = _parse_snmp_msg(resp_data)

        if varbinds is None or err != 0:
            break

        done = False
        for oid, t, v in varbinds:
            if t in ('endofmib', 'nosuchobject', 'nosuchinstance'):
                done = True
                break
            if not oid_startswith(oid, start_oid):
                done = True
                break
            oid_t = oid_tuple(oid)
            if oid_t <= current_oid_t:
                done = True
                break
            results.append((oid, t, v))
            current_oid = oid
            current_oid_t = oid_t

        if done:
            break

    sock.close()
    return results


def get(host, community='public', oid='1.3.6.1.2.1.1.1.0', port=161, timeout=5):
    """
    Read one OID with SNMP GET.
    Returns (oid, type, value), or None when the OID is missing/timed out.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        pkt = build_get(community, oid)
        sock.sendto(pkt, (host, port))
        resp_data, _ = sock.recvfrom(65535)
        varbinds, err = _parse_snmp_msg(resp_data)
        if err != 0 or not varbinds:
            return None
        resp_oid, t, v = varbinds[0]
        if t in ('endofmib', 'nosuchobject', 'nosuchinstance'):
            return None
        return resp_oid, t, v
    except socket.timeout:
        return None
    except Exception:
        return None
    finally:
        sock.close()


def snmp_set_int(host, community, oid_str, int_value, port=161, timeout=5):
    """
    SNMP SET-Request with an INTEGER value.
    Returns True when the OLT acknowledges (error-status == 0).
    Requires a write community (e.g. "private").
    Write-only OIDs will not appear in any GET walk â€” their absence from dumps
    does not mean they don't exist.
    """
    global _req_id
    _req_id = (_req_id + 1) & 0x7FFFFFFF

    varbind = encode_sequence(encode_oid(oid_str) + encode_int(int_value))
    varbind_list = encode_sequence(varbind)

    pdu_contents = (
        encode_int(_req_id) +
        encode_int(0) +   # error-status
        encode_int(0) +   # error-index
        varbind_list
    )
    # Set-Request PDU tag = 0xA3
    pdu = bytes([0xA3]) + _encode_length(len(pdu_contents)) + pdu_contents
    msg = encode_int(1) + encode_string(community) + pdu   # version=1 â†’ SNMPv2c
    pkt = encode_sequence(msg)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(pkt, (host, port))
        resp_data, _ = sock.recvfrom(65535)
        varbinds, err = _parse_snmp_msg(resp_data)
        return err == 0 and varbinds is not None
    except socket.timeout:
        return False
    except Exception:
        return False
    finally:
        sock.close()


if __name__ == '__main__':
    host = sys.argv[1] if len(sys.argv) > 1 else '10.10.10.100'
    community = sys.argv[2] if len(sys.argv) > 2 else 'public'
    out_file = sys.argv[3] if len(sys.argv) > 3 else 'C:/Users/ahame/Downloads/snmp_walk.txt'

    print(f'SNMP walk: {host} community={community}')
    t0 = time.time()

    results = walk(host, community)

    elapsed = time.time() - t0
    print(f'Done in {elapsed:.1f}s â€” {len(results)} OIDs')

    with open(out_file, 'w') as f:
        for oid, t, v in results:
            f.write(f'{oid} [{t}] = {v}\n')
    print(f'Saved to {out_file}')

    print()
    print('--- Preview first 40 ---')
    for oid, t, v in results[:40]:
        val_str = str(v)[:80]
        print(f'  {oid} [{t}] = {val_str}')
