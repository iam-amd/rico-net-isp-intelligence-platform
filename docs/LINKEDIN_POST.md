# LinkedIn Project Post Draft

I built Rico Net, a full-stack ISP intelligence platform for broadband operations.

The project connects customer records, field technician workflows, ticketing, OLT/ONU signal diagnostics, alarms, predictions, and a NOC dashboard into one operating system. The main engineering problem was mapping ISP billing identity to live fiber diagnostics, so support teams can move from manual checking to proactive operations.

Public demo:
- Admin dashboard: https://rico-net-admin.vercel.app
- NOC dashboard: https://rico-net-noc.vercel.app
- GitHub: https://github.com/iam-amd/rico-net-isp-intelligence-platform

Demo login:
- Username: admin
- Password: demo1234

Tech stack:
- FastAPI, PostgreSQL, SQLAlchemy, JWT auth
- Next.js 15, Refine, TypeScript
- Vite React NOC dashboard
- Expo React Native technician app
- OLT proxy and Railwire scraper architecture
- Render, Vercel, Neon free-tier deployment

What I wanted to show:
- Backend service-layer architecture
- Realistic synthetic ISP data
- Public-safe demo deployment
- NOC-style alarm and signal monitoring
- Customer, ticket, technician, and network workflows
- Practical system design for a real local broadband use case

The public version uses only synthetic data. Real customer data, private credentials, OLT dumps, and production files are excluded.

Screenshots are in the repository under `docs/screenshots/`.

