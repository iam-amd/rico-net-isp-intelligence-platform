import sqlite3

conn = sqlite3.connect('db/rico_net.db')
cur = conn.cursor()

# List all tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cur.fetchall()
print("=== TABLES ===")
for t in tables:
    print(t[0])

print("\n=== TECHNICIANS ===")
try:
    cur.execute("SELECT id, username, full_name, role, is_active FROM technicians LIMIT 20")
    rows = cur.fetchall()
    for r in rows:
        print(r)
except Exception as e:
    print(f"Error: {e}")
    # Try 'users' table
    try:
        cur.execute("SELECT id, username, full_name, role, is_active FROM users LIMIT 20")
        rows = cur.fetchall()
        for r in rows:
            print(r)
    except Exception as e2:
        print(f"users table error: {e2}")

conn.close()
