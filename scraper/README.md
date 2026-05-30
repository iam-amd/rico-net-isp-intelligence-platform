# Rico Net — Railwire Subscriber Scraper

> Automated data extraction engine that synchronizes ISP subscriber data from the [Railwire portal](https://tn.railwire.co.in) into a local SQLite database, with a real-time admin dashboard.

---

## Architecture

```
┌────────────────────┐     ┌──────────────┐     ┌──────────────────────┐
│  Railwire Portal   │────▶│  scraper.py  │────▶│    rico_net.db       │
│  (tn.railwire.co)  │     │  (Playwright │     │  ┌────────────────┐  │
│                    │     │   + Stealth)  │     │  │   customers    │  │
│  • CSV export      │     └──────────────┘     │  │   audit_log    │  │
│  • Detail pages    │            ▲              │  └────────────────┘  │
│  • Data usage      │            │              └──────────┬───────────┘
└────────────────────┘     ┌──────────────┐                │
                           │ scheduler.py │         ┌──────▼───────┐
                           │ (APScheduler)│         │ dashboard.py │
                           └──────────────┘         │ (FastAPI)    │
                                                    │ :5005        │
                                                    └──────────────┘
```

| Component | Purpose |
|---|---|
| `scraper.py` | Core engine — session management, CSV import, detail scraping, MAC extraction |
| `scheduler.py` | Background daemon — automates scraper runs on a cron/interval schedule |
| `dashboard.py` | Admin panel — FastAPI server with a visual dashboard on `http://localhost:5005` |
| `static/index.html` | Dashboard UI — single-page app with metrics, customer table, logs, and controls |
| `rico_net.db` | SQLite database — `customers` table + `scraper_audit_log` table |
| `config.json` | Runtime configuration — accounts, batch size, scheduler toggle |

---

## Features

### Stealth Scraping
- **Playwright + Stealth** — strips WebDriver flags, injects human-like browser fingerprints
- **Human delays** — random pauses (1s–35s) between page loads to avoid WAF detection
- **Micro-batching** — scrapes MAC addresses in configurable batches (default: 100 per run)

### Session Persistence
- Solve the Railwire CAPTCHA **once** manually (`--step session`)
- Session cookies are saved to `railwire_auth_<account>.json`
- All future headless runs reuse the saved session — no more CAPTCHAs

### Smart Extraction
- Only scrapes data that's **missing** — won't re-scrape existing MAC addresses
- Filters by `account_status = 'Active'` to skip inactive subscribers
- Automatically extracts: MAC address, framed IP, data usage, name, address

### Audit Trail
- Every `CREATE` and `UPDATE` is logged to the `scraper_audit_log` table
- Tracks: what changed, old value, new value, when, and which scraper step did it
- Historical data is preserved forever — useful for detecting router swaps

---

## Prerequisites

- **Python 3.10+**
- **Chromium** (installed automatically by Playwright)
- **Tesseract OCR** *(optional)* — enables auto-CAPTCHA solving during session setup

---

## Setup

### 1. Install Dependencies

```bash
pip install -r requirements.txt
playwright install chromium
```

### 2. Configure Credentials

Edit `config.json` (or use the dashboard's Settings page):

```json
{
    "accounts": [
        {"username": "YOUR_RAILWIRE_ID", "password": "YOUR_PASSWORD"}
    ],
    "active_account": "YOUR_RAILWIRE_ID",
    "mac_batch_size": 100,
    "scheduler_enabled": true
}
```

### 3. Generate Login Session

```bash
python scraper.py --step session
```

This opens a visible browser. Log in, solve the CAPTCHA, and the session is saved automatically. You only need to do this **once** (or when the session expires).

---

## Usage

### Manual Scraper Commands

```bash
# Download CSV and sync all subscriber data
python scraper.py --step csv

# Scrape detail pages (name, address) for customers missing this data
python scraper.py --step details

# Extract MAC addresses for active customers (stealth mode, 100 per batch)
python scraper.py --step mac

# Run all steps in sequence: csv → details → mac
python scraper.py --step all

# Quick CSV re-sync (alias for csv step)
python scraper.py --step daily

# Refresh data for a single subscriber
python scraper.py --step single --username tn.john.doe
```

### Automated Scheduling

```bash
python scheduler.py          # Start the scheduler (runs 24/7)
python scheduler.py --now    # Run all jobs immediately, then continue on schedule
```

**Default Schedule:**

| Job | Trigger | Description |
|---|---|---|
| CSV Sync | Daily at 2:00 AM | Downloads and imports all subscriber data |
| Details Scrape | Daily at 3:00 AM | Scrapes name & address for new subscribers |
| MAC Scrape | Every 2 hours | Extracts MAC addresses (100 per batch) |

### Admin Dashboard

```bash
python dashboard.py
# Open http://localhost:5005
```

---

## API Reference

The dashboard exposes a REST API at `http://localhost:5005`:

### Data Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/metrics` | Total customers, active count, MAC coverage, audit count |
| `GET` | `/api/customers` | All customers (JSON array) |
| `GET` | `/api/customers/{username}` | Single customer details |
| `GET` | `/api/audit` | Recent audit events (last 200) |
| `GET` | `/api/customers/{username}/audit` | Audit trail for a specific customer |
| `GET` | `/api/logs/{type}` | Log file tail (`scraper`, `scheduler`, `csv`, `single`, `mac`) |

### Action Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/action/scrape-csv` | Trigger CSV sync in background |
| `POST` | `/api/action/scrape-details` | Trigger details scrape in background |
| `POST` | `/api/action/scrape-mac` | Trigger MAC scrape in background |
| `POST` | `/api/action/scrape-all` | Trigger full scrape in background |
| `POST` | `/api/action/scrape-single/{username}` | Refresh single user's data |
| `POST` | `/api/action/generate-session` | Launch session browser for CAPTCHA solving |

### Status Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/scraper/status` | Check if a scraper process is currently running |
| `GET` | `/api/scheduler/jobs` | List scheduled jobs and scheduler status |
| `GET` | `/api/config` | Read current configuration |
| `POST` | `/api/config` | Update configuration |

---

## Database Schema

### `customers`

| Column | Type | Description |
|---|---|---|
| `railwire_id` | Integer (PK) | Unique subscriber ID from Railwire |
| `railwire_admin` | String | Admin account that manages this subscriber |
| `username` | String (unique) | Subscriber login username |
| `full_name` | String | First + last name |
| `mobile_number` | String | Contact phone |
| `email` | String | Contact email |
| `full_address` | Text | Physical address |
| `plan_name` | String | Current broadband plan |
| `expiry_date` | String | Plan expiration date |
| `account_balance` | Float | Prepaid balance (₹) |
| `account_status` | String | `Active` / `Inactive` / `Suspended` |
| `mac_address` | String | ONU/router MAC address |
| `framed_ip` | String | Assigned IP address |
| `monthly_data_used_mb` | Float | Data consumed this month |
| `is_online` | Boolean | Online status flag |
| `olt_id` | Integer | OLT identifier *(Phase 2)* |
| `pon_port` | String | PON port *(Phase 2)* |
| `onu_index` | Integer | ONU index *(Phase 2)* |
| `mac_scraped_at` | DateTime | When MAC was last extracted |
| `detail_scraped_at` | DateTime | When details were last scraped |
| `last_synced_at` | DateTime | Last CSV sync timestamp |
| `created_at` | DateTime | Record creation time |

### `scraper_audit_log`

| Column | Type | Description |
|---|---|---|
| `id` | Integer (PK) | Auto-increment ID |
| `customer_id` | Integer (FK) | References `customers.railwire_id` |
| `action` | String | `CREATE` or `UPDATE` |
| `field_name` | String | Which field changed |
| `old_value` | Text | Previous value |
| `new_value` | Text | New value |
| `changed_by` | String | Which scraper step made the change |
| `changed_at` | DateTime | Timestamp of the change |

---

## Project Structure

```
rico-net-scraper/
├── scraper.py              # Core scraper engine (session, CSV, details, MAC)
├── scheduler.py            # Background job scheduler (APScheduler)
├── dashboard.py            # FastAPI admin panel server
├── requirements.txt        # Python dependencies
├── config.json             # Runtime config (credentials, batch size)
├── .gitignore              # Git exclusions
├── static/
│   ├── index.html          # Dashboard SPA
│   └── lucide.min.js       # Icon library
├── rico_net.db             # SQLite database (auto-created)
├── railwire_auth_*.json    # Saved session cookies (auto-created)
├── subscribers.csv         # Latest downloaded CSV (auto-created)
└── *.log                   # Step-specific log files (auto-created)
```

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `❌ No saved session found!` | Run `python scraper.py --step session` to log in and save cookies |
| `Session expired` | Re-run `--step session`. Sessions typically last ~24 hours |
| `No module named 'bs4'` | Run `pip install -r requirements.txt` |
| `database is locked` | Only one scraper process can write at a time. Wait for the current one to finish |
| `CAPTCHA solving fails` | Install Tesseract OCR, or solve the CAPTCHA manually in the browser |
| Dashboard shows black screen | Hard-refresh (`Ctrl+Shift+R`) in the browser |

---

## Future Roadmap (Phase 2)

This scraper serves as the foundation for the **OLT Mapping Engine**. In Phase 2, the database will cross-reference live OLT terminal PON/ONU data. If the OLT reports a MAC that doesn't match the scraper database, the system will instantly detect a physical router replacement, trigger an alert, and log the change via the existing audit architecture.
