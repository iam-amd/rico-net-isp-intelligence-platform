"""
Pi-side script: configure SNMP trap target using Netlink-specific 'snmp targetaddress' syntax.
Upload to Pi and run directly.
"""
PI_TRAP_IP = "10.10.10.50"
TRAP_PORT  = 162
COMMUNITY  = "public"
OLT_USER   = "admin"
OLT_PASS   = "replace-with-olt-password"

OLTS = [
    ("10.10.10.100", "EPON"),
    ("10.10.10.200", "GPON1"),
    ("10.10.10.210", "GPON2"),
]

import socket, time, sys


def recv_until(sock, markers, timeout=4.0):
    if isinstance(markers, str):
        markers = [markers]
    buf = b""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            sock.settimeout(0.3)
            chunk = sock.recv(4096)
            if not chunk:
                break
            clean = bytearray()
            i = 0
            while i < len(chunk):
                if chunk[i] == 0xFF and i + 2 < len(chunk):
                    i += 3
                elif chunk[i] in (0x00, 0x08):
                    i += 1
                else:
                    clean.append(chunk[i])
                    i += 1
            buf += bytes(clean)
            if any(m.encode() in buf for m in markers):
                break
        except socket.timeout:
            continue
        except Exception:
            break
    return buf.decode("utf-8", errors="replace")


def cmd(sock, text, wait=["#", ">"]):
    sock.send((text + "\n").encode())
    return recv_until(sock, wait, timeout=3)


def login(olt_ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((olt_ip, 23))
    recv_until(sock, ["ame:", "ogin:"], timeout=5)
    cmd(sock, OLT_USER, wait=["word:"])
    cmd(sock, OLT_PASS, wait=[">", "#"])
    # Enable mode
    r = cmd(sock, "enable", wait=["word:", "#"])
    if "word" in r.lower():
        cmd(sock, OLT_PASS, wait=["#"])
    return sock


def configure_olt(olt_ip, label):
    print(f"\n{'='*58}")
    print(f"  {label}  {olt_ip}")
    print(f"{'='*58}")
    try:
        sock = login(olt_ip)
        print(f"  Logged in.")
    except Exception as e:
        print(f"  CONNECT FAILED: {e}")
        return

    # â”€â”€ Probe targetaddress syntax â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    r = cmd(sock, "configure terminal")
    print(f"\n  === snmp targetaddress ? ===")
    r = cmd(sock, "snmp targetaddress ?", wait=["#", ">"])
    for l in r.splitlines():
        if l.strip() and l.strip() not in ["#", ">"]:
            print(f"    {l}")

    print(f"\n  === snmp-server targetaddress ? ===")
    r = cmd(sock, "snmp-server targetaddress ?", wait=["#", ">"])
    for l in r.splitlines():
        if l.strip() and l.strip() not in ["#", ">"]:
            print(f"    {l}")

    print(f"\n  === snmp-server addressparam ? ===")
    r = cmd(sock, "snmp-server addressparam ?", wait=["#", ">"])
    for l in r.splitlines():
        if l.strip() and l.strip() not in ["#", ">"]:
            print(f"    {l}")

    # â”€â”€ Try setting target address â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print(f"\n  === Configuring trap target {PI_TRAP_IP}:{TRAP_PORT} ===")

    attempts = [
        f"snmp targetaddress {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY}",
        f"snmp targetaddress {PI_TRAP_IP} port {TRAP_PORT} community {COMMUNITY}",
        f"snmp targetaddress trap_target {PI_TRAP_IP} {TRAP_PORT}",
        f"snmp targetaddress trap_target {PI_TRAP_IP}",
        f"snmp-server targetaddress {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY}",
        f"snmp-server targetaddress trap_target {PI_TRAP_IP} {TRAP_PORT}",
        f"snmp-server targetaddress trap_target {PI_TRAP_IP}",
    ]

    for attempt in attempts:
        r = cmd(sock, attempt, wait=["#", ">"])
        lines = [l.strip() for l in r.splitlines() if l.strip() and l.strip() not in ["#", ">"]]
        relevant = [l for l in lines if attempt.split()[-1] not in l]
        error = any("%" in l or "invalid" in l.lower() or "error" in l.lower() or "unknown" in l.lower() for l in relevant)
        print(f"  [{attempt[:55]}]")
        if relevant:
            for l in relevant[:3]:
                print(f"    -> {l}")
        if not error or not relevant:
            print(f"    *** ACCEPTED ***")
            break

    # â”€â”€ Show all snmp sub-commands to find show command â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    cmd(sock, "exit")  # exit config mode
    print(f"\n  === show snmp sub-commands ===")
    for show_cmd in ["show snmp trap", "show snmp targetaddress", "show snmp host",
                     "show snmp config", "show running-config | include snmp"]:
        r = cmd(sock, show_cmd, wait=["#", ">"])
        lines = [l.strip() for l in r.splitlines() if l.strip() and l.strip() not in ["#", ">"]]
        relevant = [l for l in lines if show_cmd.split()[-1] not in l and "%" not in l]
        if relevant:
            print(f"  [{show_cmd}]")
            for l in relevant[:5]:
                print(f"    {l}")

    # Save
    r = cmd(sock, "write", wait=["#", ">", "OK", "success", "saved"])
    print(f"\n  write: {r[:100].strip()}")

    sock.close()


if __name__ == "__main__":
    for olt_ip, label in OLTS:
        configure_olt(olt_ip, label)

    print(f"\n{'='*58}")
    print("ALL DONE")
    print(f"Trap target: {PI_TRAP_IP}:{TRAP_PORT} community={COMMUNITY}")
    print("Watch for traps: sudo journalctl -u olt-trap-receiver -f --no-pager")
    print(f"{'='*58}")
