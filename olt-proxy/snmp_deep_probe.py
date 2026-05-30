"""Deep probe: find exact syntax for snmp targetaddress on Netlink OLTs."""
PI_TRAP_IP = "10.10.10.50"
TRAP_PORT  = 162
COMMUNITY  = "public"
OLT_USER   = "admin"
OLT_PASS   = "replace-with-olt-password"

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

def c(sock, text, wait=["#", ">"]):
    sock.send((text + "\n").encode())
    return recv_until(sock, wait, timeout=3)

def pr(label, r):
    lines = [l.strip() for l in r.splitlines() if l.strip() and l.strip() not in ["#",">"]]
    lines = [l for l in lines if l != label.split()[-1]]
    print(f"  [{label}]")
    for l in lines[:8]:
        print(f"    {l}")

def login(olt_ip):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((olt_ip, 23))
    recv_until(sock, ["ame:", "ogin:"], timeout=5)
    c(sock, OLT_USER, wait=["word:"])
    c(sock, OLT_PASS, wait=[">", "#"])
    r = c(sock, "enable", wait=["word:", "#"])
    if "word" in r.lower():
        c(sock, OLT_PASS, wait=["#"])
    c(sock, "configure terminal")
    return sock

# Only probe EPON (.100) since all 3 OLTs have same firmware
olt_ip = "10.10.10.100"
print(f"Deep probe on {olt_ip}")
sock = login(olt_ip)
print("Logged in.\n")

# â”€â”€ Find what follows the name â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
pr("snmp targetaddress pi_trap ?", c(sock, "snmp targetaddress pi_trap ?"))
pr("snmp targetaddress pi_trap 10.10.10.50 ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} ?"))
pr("snmp-server targetaddress pi_trap 10.10.10.50 ?", c(sock, f"snmp-server targetaddress pi_trap {PI_TRAP_IP} ?"))

# Try TAB completion style â€” send partial and see what OLT suggests
pr("snmp targetaddress pi_trap 10.10.10.50 162 ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} ?"))
pr("snmp targetaddress pi_trap 10.10.10.50 162 public ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY} ?"))
pr("snmp targetaddress pi_trap 10.10.10.50 162 public 1 ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY} 1 ?"))

# OID-style params (some OLTs need notification OID)
pr("snmp targetaddress pi_trap 10.10.10.50 162 v2c ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} v2c ?"))
pr("snmp targetaddress pi_trap 10.10.10.50 v2c ?", c(sock, f"snmp targetaddress pi_trap {PI_TRAP_IP} v2c ?"))

# addressparam syntax
pr("snmp-server addressparam pi_trap ?", c(sock, "snmp-server addressparam pi_trap ?"))
pr("snmp-server addressparam pi_trap 200 ?", c(sock, "snmp-server addressparam pi_trap 200 ?"))

# Try the working combinations
print("\n--- Trying combinations ---")
combos = [
    f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT}",
    f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY}",
    f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} {COMMUNITY} 1",
    f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} v2c {COMMUNITY}",
    f"snmp targetaddress pi_trap {PI_TRAP_IP} {TRAP_PORT} v2c",
    f"snmp targetaddress pi_trap {PI_TRAP_IP} 0 {COMMUNITY}",  # some OLTs use 0 for default port
]
for combo in combos:
    r = c(sock, combo)
    lines = [l.strip() for l in r.splitlines() if l.strip() and l.strip() not in ["#",">"]]
    error = any("%" in l or "invalid" in l.lower() or "unknown" in l.lower() for l in lines)
    incomplete = any("incomplete" in l.lower() for l in lines)
    tag = "ACCEPTED" if not error and not incomplete else ("INCOMPLETE" if incomplete else "ERROR")
    print(f"  [{tag}] {combo[:60]}")
    if lines and error:
        print(f"         -> {lines[0]}")

# Show current config
c(sock, "exit")
print("\n--- show running-config (snmp section) ---")
r = c(sock, "show running-config", wait=["#", ">"])
for l in r.splitlines():
    if "snmp" in l.lower() or "trap" in l.lower():
        print(f"  {l}")

sock.close()
print("\nDONE")
