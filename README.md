# Smart Attendance

QR + GPS + face + device verified attendance for departments (React + Vite + Supabase + Google Sheets, optional Android shell via Capacitor).

## Local development
```bash
cp .env.example .env     # fill in your Supabase URL / publishable key / project id
npm install
npm run dev
npm run lint && npm test && npm run build
```

## Deploying
See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for the full checklist (secrets, migrations, cron, Vercel, Android).
