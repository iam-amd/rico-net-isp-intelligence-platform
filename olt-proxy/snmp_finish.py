"""
Finish SNMP trap config:
- GPON1 (.200): use snmp-server host syntax (confirmed working on GPON2)
- EPON (.100): probe 'trap ?' to find remaining arg, then apply
- GPON2 (.210): already configured, just verify
"""
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

def try_cmd(sock, cmd_text):
    r = c(sock, cmd_text)
    lines = [l.strip() for l in r.splitlines() if l.strip() and l.strip() not in ["#",">"]]
    error = any("%" in l for l in lines)
    tag = "FAIL" if error else "OK"
    print(f"  [{tag}] {cmd_text[:65]}")
    if error:
        for l in lines:
            if "%" in l:
                print(f"       {l}")
    return not error

def login(sock, olt_ip):
    recv_until(sock, ["ame:", "ogin:"], timeout=5)
    c(sock, OLT_USER, wait=["word:"])
    c(sock, OLT_PASS, wait=[">", "#"])
    r = c(sock, "enable", wait=["word:", "#"])
    if "word" in r.lower():
        c(sock, OLT_PASS, wait=["#"])

def show_running_snmp(sock, label):
    r = c(sock, "show running-config | include snmp")
    lines = [l.strip() for l in r.splitlines()
             if l.strip() and l.strip() not in ["#", ">"]
             and "%" not in l and "include" not in l]
    if lines:
        print(f"  running-config [{label}]:")
        for l in lines:
            print(f"    {l}")
    else:
        print(f"  running-config [{label}]: (empty â€” show snmp not supported or no config)")

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# EPON (.100): probe 'trap ?' to find remaining argument
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("=" * 60)
print("EPON 10.10.10.100 â€” probing trap ? and snmp-server host")
print("=" * 60)
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(("10.10.10.100", 23))
login(sock, "10.10.10.100")
c(sock, "configure terminal")
print("Logged in.\n")

# Probe what comes after 'trap'
print("  [probe] snmp targetaddress x 10.10.10.50 trap ?")
r = c(sock, f"snmp targetaddress x {PI_TRAP_IP} trap ?")
for l in r.splitlines():
    if l.strip() and l.strip() not in ["#",">"]:
        print(f"    {l}")

# Try without a name (maybe name is optional?)
print("\n  [probe] snmp targetaddress 10.10.10.50 trap ?")
r = c(sock, f"snmp targetaddress {PI_TRAP_IP} trap ?")
for l in r.splitlines():
    if l.strip() and l.strip() not in ["#",">"]:
        print(f"    {l}")

# Try snmp-server host (GPON2's syntax)
print("\n  Trying snmp-server host syntax...")
try_cmd(sock, f"snmp-server host {PI_TRAP_IP} version 2c community {COMMUNITY}")
try_cmd(sock, f"snmp-server host {PI_TRAP_IP} version 2c {COMMUNITY}")
try_cmd(sock, f"snmp-server host {PI_TRAP_IP} {COMMUNITY}")
try_cmd(sock, "snmp-server start")
try_cmd(sock, f"snmp-server community {COMMUNITY} ro")
try_cmd(sock, f"snmp-server notify notif trap {COMMUNITY} trap")
try_cmd(sock, f"snmp-server notify rico_noc trap trap trap")

# Try targetaddress with more args
print("\n  Trying targetaddress with extra args...")
for extra in ["1", "0", "200", "v2c", "public", "default", "notify"]:
    r = c(sock, f"snmp targetaddress x {PI_TRAP_IP} trap {extra}")
    lines = [l.strip() for l in r.splitlines() if "%" in l]
    incomplete = any("incomplete" in l.lower() for l in lines)
    unknown = any("unknown" in l.lower() for l in lines)
    tag = "INCOMPLETE" if incomplete else ("ERROR" if unknown else "OK")
    print(f"    [{tag}] snmp targetaddress x {PI_TRAP_IP} trap {extra}")
    if tag == "OK":
        print(f"    *** ACCEPTED ***")

c(sock, "exit")
show_running_snmp(sock, "EPON after apply")
c(sock, "write", wait=["#", ">", "saved", "OK"])
sock.close()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# GPON1 (.200): apply same syntax as GPON2 which is confirmed working
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n" + "=" * 60)
print("GPON1 10.10.10.200 â€” applying GPON2-confirmed syntax")
print("=" * 60)
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(("10.10.10.200", 23))
login(sock, "10.10.10.200")
c(sock, "configure terminal")
print("Logged in.\n")

try_cmd(sock, "snmp-server start")
try_cmd(sock, f"snmp-server community {COMMUNITY} ro")
try_cmd(sock, f"snmp-server host {PI_TRAP_IP} version 2c community {COMMUNITY}")
try_cmd(sock, f"snmp-server notify notif trap {COMMUNITY} trap")
try_cmd(sock, "snmp-server enable traps snmp linkdown linkup")

c(sock, "exit")
show_running_snmp(sock, "GPON1 after apply")
c(sock, "write", wait=["#", ">", "saved", "OK"])
sock.close()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# GPON2 (.210): verify existing config
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n" + "=" * 60)
print("GPON2 10.10.10.210 â€” verify existing config")
print("=" * 60)
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect(("10.10.10.210", 23))
login(sock, "10.10.10.210")
print("Logged in.\n")
show_running_snmp(sock, "GPON2 current")
sock.close()

print("\n" + "=" * 60)
print("DONE â€” check trap receiver log for incoming traps:")
print("  ssh rico@100.x.x.x 'sudo journalctl -u olt-trap-receiver -f'")
print("=" * 60)
