# Deployment Guide

This guide is for a public internship/portfolio demo. It favors free hosting and safe defaults over production operations.

## Current Live Demo

| Part | URL |
| --- | --- |
| GitHub repository | <https://github.com/iam-amd/rico-net-isp-intelligence-platform> |
| Admin UI | <https://rico-net-admin.vercel.app> |
| NOC UI | <https://rico-net-noc.vercel.app> |
| Backend API | <https://rico-net-api-demo.onrender.com> |
| Backend health check | <https://rico-net-api-demo.onrender.com/healthz> |

Demo credentials:

```text
username: admin
password: demo1234
```

The deployed backend uses Render free tier and can sleep after inactivity. If a page looks slow at first, open the health check and wait for the service to wake.

## Recommended Public Hosting

| Part | Free-friendly host | Notes |
| --- | --- | --- |
| Admin UI `frontend-pro/` | Vercel | Best fit for Next.js |
| NOC UI `noc-dashboard/` | Vercel, Netlify, Cloudflare Pages | Static Vite app |
| Backend `backend/` | Render, Railway, Fly.io | Needs Python and PostgreSQL |
| Database | Render PostgreSQL, Neon, Supabase, Railway | Use demo data only |
| Mobile `mobile/` | Expo web locally or EAS preview | Good for screenshots/demo video |

Vercel is excellent for the frontend apps. FastAPI should usually be hosted separately on Render/Railway/Fly because it is a long-running API service with PostgreSQL.

## Backend On Render

This public demo currently uses Render Docker deployment with `backend/Dockerfile`, because it can seed the bulk synthetic ISP simulator during container startup.

1. Create a new PostgreSQL database.
2. Create a new Web Service from this repo.
3. Set root directory to `backend`.
4. Build command:

```bash
pip install -r requirements.txt
```

5. Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

6. Environment variables:

```text
DATABASE_URL=<render-or-neon-postgres-url>
SECRET_KEY=<generate-a-long-random-string>
CORS_ALLOW_ORIGINS=https://your-admin.vercel.app,https://your-noc.vercel.app
OLT_PROXY_ENABLED=false
RUN_CREATE_ALL_ON_STARTUP=true
```

7. After first deploy, seed demo data from a local terminal pointed at the hosted database:

```bash
cd backend
set DATABASE_URL=<hosted-postgres-url>
set SECRET_KEY=<same-secret>
python scripts\seed_demo.py --create-tables --reset-demo
```

To control dataset size:

```bash
python scripts\seed_demo.py --create-tables --reset-demo --customers 120
```

## Admin UI On Vercel

1. Import the repo into Vercel.
2. Set root directory to `frontend-pro`.
3. Framework preset: Next.js.
4. Environment variable:

```text
NEXT_PUBLIC_API_URL=https://your-backend-host.example.com
```

5. Deploy.

## NOC Dashboard On Vercel

1. Import the repo a second time as a separate Vercel project.
2. Set root directory to `noc-dashboard`.
3. Framework preset: Vite.
4. Environment variable:

```text
VITE_API_URL=https://your-backend-host.example.com
```

5. Deploy.

## Local Verification Before Posting

```bash
cd backend
python scripts\seed_demo.py --create-tables --reset-demo
uvicorn main:app --reload
```

```bash
cd frontend-pro
npm install
npm run build
npm run dev
```

```bash
cd noc-dashboard
npm install
npm run build
npm run dev
```

Open the admin UI, log in as `admin` / `demo1234`, then check customer pages, tickets, NOC pages, alarms, and predictions.

## LinkedIn Project Post Checklist

- Add the GitHub public repo link.
- Add live Vercel links for Admin UI and NOC UI.
- Mention that the public version uses synthetic data.
- Include 3-5 screenshots: dashboard, customer DNA, NOC alarms, mobile app, architecture diagram.
- In the description, focus on the engineering problem: mapping ISP billing identity to live OLT fiber diagnostics.

Use [`LINKEDIN_POST.md`](LINKEDIN_POST.md) as a ready-to-edit post draft.
