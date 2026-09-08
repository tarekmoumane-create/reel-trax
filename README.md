# Reel Trax

Your creator-tracking OS — every creator, across every client, in one place.
Inspired by viral.app, built for an agency workflow: **automatic posting-cadence
tracking** across TikTok, Instagram Reels and YouTube Shorts, a **client
switcher**, **sourcing tags** (Sideshift & others), payout tracking with
per-video pay controls, and client invoices for any date range.

## What it does

- **Client switcher** (top-left) — toggle between all your clients; everything
  scopes to the selected one.
- **Automatic posting cadence** — add a creator's TikTok / Instagram / YouTube
  profile URL once and a scheduled job tracks their posts for you. Calendars,
  streaks, and "on track / behind / gone quiet" flags update themselves.
- **Roster dashboard** — the people you need to chase float to the top.
- **Contact launcher** — one click opens iMessage, WhatsApp, IG DM, Discord or
  email for a creator (Reel Trax doesn't log conversations).
- **Payouts & invoices** — per-video pay controls (warm-up posts, fixed prices),
  and a print-ready invoice for any date range.
- **Sourcing** — tag where each creator came from (Sideshift, referral, outreach…).

Automatic tracking is powered by [ScrapeCreators](https://scrapecreators.com)
(pay-as-you-go, ~$5–15/mo for 25–100 creators checked daily).

---

## 1. Run it locally

```bash
npm install
cp .env.example .env          # DATABASE_URL defaults to local SQLite
npx prisma db push            # create the local database
node prisma/seed.mjs          # optional: demo data
npm run dev                   # http://localhost:3000
```

Then open **Settings → ScrapeCreators API key** and paste your key
(create a free account at scrapecreators.com — 100 free credits to test).
Click **Sync now** on the dashboard to pull real posts.

> Without an API key the app still works for organizing creators, clients, payouts,
> and manual post logging — only the automatic pull is paused.

---

## 2. Deploy so tracking runs 24/7 (Vercel + Postgres)

The background sync only runs when the app is hosted. Recommended: **Vercel** +
a free **Neon** Postgres database.

### a. Create a Postgres database
Spin up a free database at [neon.tech](https://neon.tech) (or Vercel Postgres /
Supabase) and copy its connection string.

### b. Switch Prisma to Postgres
In `prisma/schema.prisma` change the datasource provider:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

The schema is written to be portable, so no other edits are needed.

### c. Deploy
```bash
npm i -g vercel
vercel            # link/create the project
```
In the Vercel dashboard → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Neon Postgres URL |
| `CRON_SECRET` | any long random string (protects the cron endpoint) |
| `SCRAPECREATORS_API_KEY` | optional — or set it in-app under Settings |

Then push the schema to the prod DB and redeploy:
```bash
DATABASE_URL="<neon-url>" npx prisma db push
vercel --prod
```

### d. The scheduled job
`vercel.json` already registers the cron:

```json
{ "crons": [{ "path": "/api/cron/sync", "schedule": "0 */6 * * *" }] }
```

That runs the automatic sync **every 6 hours**. Change the schedule to taste
(e.g. `0 * * * *` for hourly). Vercel calls it with your `CRON_SECRET`.

---

## How it fits together

| Layer | Where |
|---|---|
| Cadence engine (streaks, flags) | `lib/cadence.ts` |
| ScrapeCreators client + parsers | `lib/scrapecreators.ts` |
| Sync service (fetch → DB) | `lib/sync.ts` |
| Scheduled job | `app/api/cron/sync/route.ts` + `vercel.json` |
| Data model | `prisma/schema.prisma` |
| Dashboard / roster | `app/page.tsx` |
| Creator detail | `app/creators/[id]/page.tsx` |
| Client switcher | `components/TopBar.tsx` |

### A note on Instagram field mapping
TikTok's response schema is confirmed against ScrapeCreators' OpenAPI spec.
Instagram's exact field names can vary by API version, so `fetchInstagram` in
`lib/scrapecreators.ts` probes several candidate paths. If IG posts don't import
after your first real sync, check the raw response and adjust the field paths
there — it's isolated to that one function.

---

## Roadmap ideas (not built yet)
- Auto-resolve TikTok `user_id` cache is in place; add IG user-id caching too.
- Campaign & payout tracking (CPM/flat) per creator.
- Slack/Discord "creator went quiet" alerts from the cron job.
- Send-from-app SMS via Twilio.
