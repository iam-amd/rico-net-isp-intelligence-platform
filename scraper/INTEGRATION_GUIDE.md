# Scraper Integration Guide

> Railwire Scraper is now integrated into the Rico Net monorepo with auto-sync to PostgreSQL.
> Status: Ready to use | Location: `<local-project-path>\scraper\`

## Quick Start

```bash
# Windows (easiest)
cd scraper
start_all_scraper.bat

# Linux/Mac
cd scraper
python start_all_scraper.py
```

That's it. Everything runs automatically.

## What's Running

When you start the scraper, these 3 components run in parallel:

### 1. ðŸ”„ Sync Daemon (auto, continuous)
- **What:** Watches local SQLite `rico_net.db` and syncs to PostgreSQL automatically
- **How often:** Every 30 seconds
- **What it syncs:** Customers, phone numbers, audit logs
- **Log:** `sync_daemon.log`
- **Status:** You'll see "âœ“ Sync complete: X customers, Y phones, Z audit logs" every time new data is found

### 2. â° Scheduler (24/7, automated)
- **What:** Runs scraper jobs on schedule â€” no manual commands needed
- **Schedule:**
  - CSV import: Daily at 2:00 AM (re-download subscriber list)
  - Detail scraping: Daily at 3:00 AM (names & addresses)
  - MAC scraping: Every 2 hours (collect MAC addresses)
- **Log:** `scheduler.log`
- **Status:** Check the log to see what runs when

### 3. ðŸ“Š Dashboard API
- **What:** Admin web interface showing scraper status, metrics, logs
- **URL:** `http://localhost:5005`
- **What you can do:**
  - View customer list with MAC coverage %
  - Check real-time metrics (total customers, active, MAC collected)
  - See live logs from all scraper steps
  - Manually trigger scraping jobs
  - Monitor scheduler

## Architecture

```
Railwire Portal (tn.railwire.co.in)
            â†“
     scraper.py (Playwright)
            â†“
   rico_net.db (SQLite) â† Local working DB
            â†“
   sync_daemon.py â† AUTO SYNC (every 30s)
            â†“
rico_net PostgreSQL â† Main database (for rest of Rico Net)
```

## Auto-Sync Details

The sync daemon automatically watches the SQLite database and pushes changes to PostgreSQL:

| Entity | What Gets Synced | Conflict Resolution |
|--------|------------------|-------------------|
| Customers | All fields (name, address, plan, balance, MAC, etc.) | PostgreSQL updated with latest from SQLite |
| Phone Numbers | Customer phone lookups | New numbers added, duplicates skipped |
| Audit Logs | Change history (who changed what, when) | New logs appended permanently |

**No manual intervention needed.** The sync happens automatically in the background.

## Data Flow

1. **Scraper runs** (scheduled or manual) â†’ writes to SQLite
2. **Sync daemon detects changes** (every 30s) â†’ reads from SQLite
3. **Daemon writes to PostgreSQL** â†’ upserts customer data
4. **Other Rico Net systems** (backend API, frontend CMS, mobile app) â†’ read from PostgreSQL
5. **Everything stays in sync** âœ“

## Monitoring

### Check if it's working
1. Open dashboard: `http://localhost:5005`
2. Look for:
   - âœ“ "X customers synced" in the dashboard metrics
   - âœ“ Logs showing sync activity in the log viewer
   - âœ“ MAC address count increasing over time

### Check the logs
- `sync_daemon.log` â€” Sync activity every 30 seconds
- `scheduler.log` â€” When scheduled jobs run
- `scraper.log` â€” Details of what scraper extracted
- `csv_sync.log` â€” CSV import details
- `mac_scrape.log` â€” MAC extraction progress

### Troubleshooting

If sync isn't working:
1. Check PostgreSQL is running: `psql -U postgres -d rico_net -c "SELECT 1"`
2. Check .env has correct DATABASE_URL: `postgresql://postgres:postgres@localhost/rico_net_demo`
3. Check sync_daemon.log for errors
4. Verify SQLite file exists: `rico_net.db` should be ~1MB

## Manual Scraping (if needed)

Even though the scheduler runs automatically, you can run scraper steps manually:

```bash
# Run CSV import immediately
python scraper.py --step csv

# Scrape missing names & addresses
python scraper.py --step details

# Collect MAC addresses (batched)
python scraper.py --step mac

# Session setup (one-time, only if session expires)
python scraper.py --step session
```

After any manual run, the sync daemon will automatically push changes to PostgreSQL within 30 seconds.

## Integration Status

- âœ… Scraper moved to monorepo
- âœ… SQLite local database working
- âœ… Auto-sync daemon created
- âœ… Scheduler running 24/7
- âœ… Dashboard accessible
- âœ… PostgreSQL sync tested

## Next Steps

1. **Run the scraper** using `start_all_scraper.bat` (Windows) or `python start_all_scraper.py` (Linux/Mac)
2. **Let it collect MACs** â€” currently at 121/1267 (9.5%), should reach 100% in ~2 weeks
3. **Once MACs are complete**, Phase 2 (OLT mapping) can begin

## Support

- Dashboard shows real-time status
- Check logs for errors or sync activity
- Sync runs automatically â€” no configuration needed
- All data stays in PostgreSQL for the rest of Rico Net to use

---

Built as part of Rico Net Phase 1. See `CLAUDE.md` for architecture details.
