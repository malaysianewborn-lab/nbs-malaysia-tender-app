# Newborn Screening Malaysia — Tender Cost Estimator

A multi-site LC-MS/MS assay cost estimator, rebuilt as a small web app on top
of Supabase (free tier) and deployed on Render (free tier). Every formula
from the original Excel workbook (Batch Setup, LC Gradient, Calibrator & QC
Prep, Reagents, Column, Solvents & Acid, Summary) has been ported into
`public/calc.js` and verified to produce identical numbers.

## What this app does

- **Multiple sites**: create as many sites as you need (one per tender
  site/hospital), each with its own fully independent calculator.
- **Freely name each site** — rename or delete at any time.
- **Full 8-tab calculator per site**, editable and auto-saving as you type.
- **A discussion tab per site** for the tender team to leave notes.
- **One shared password** gates the whole app (no individual accounts).
- All data lives in your own Supabase Postgres database.

## Architecture

- **Frontend**: plain HTML/CSS/JS (`public/`) — no build step.
- **Backend**: a small Express server (`server/index.js`) that:
  - Checks the shared password and issues a signed session cookie.
  - Is the only thing that talks to Supabase, using the **service role**
    key (kept server-side only — the browser never sees your Supabase
    credentials).
- **Database**: Supabase Postgres — two tables (`sites`, `discussion_messages`),
  see `db/schema.sql`.

## One-time setup

### 1. Create a Supabase project (free tier)

In the Supabase account you want this app to live under (a **different**
account/org than AngCY's, as requested):

1. Create a new project (free tier is enough — this app uses a tiny amount
   of storage).
2. Go to the **SQL Editor** and run the entire contents of `db/schema.sql`.
   This creates the tables and seeds one starter site ("Site 1") so the app
   has something to open.
3. Go to **Settings > API** and copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (NOT the `anon` key) → this is
     `SUPABASE_SERVICE_ROLE_KEY`. Keep this secret — never put it in the
     frontend or share it publicly.

### 2. Choose your app's credentials

- `APP_SHARED_PASSWORD` — the one password your whole team will use to log in.
- `SESSION_SECRET` — any long random string (used only to sign the login
  cookie; Render can auto-generate this for you, see `render.yaml`).

### 3. Deploy to Render (free tier)

**Option A — you deploy it yourself:**
1. Push this folder to a GitHub repo.
2. In Render, "New +" → "Blueprint", point it at the repo (it will read
   `render.yaml` automatically).
3. When prompted, fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
   `APP_SHARED_PASSWORD`. Render will auto-generate `SESSION_SECRET`.
4. Deploy. Render gives you a URL like
   `https://newborn-screening-malaysia-tender.onrender.com`.

**Option B — hand me the credentials and I deploy it:**
Give me the three values above and confirm you're fine using the Render
account already connected to this chat, and I'll create the web service and
deploy it for you directly.

> Free-tier note: Render's free web services spin down after periods of
> inactivity and take ~30–60 seconds to wake up on the next visit. This is
> normal and costs nothing.

## Local development (optional)

```bash
cp .env.example .env   # fill in your values
npm install
npm start
# visit http://localhost:3000
```

## Notes on the data model

Each site stores its entire calculator state as a single JSON document
(`sites.data`), mirroring the Excel workbook's tabs. This keeps the schema
simple while still being fully editable and auditable. The Calibrator & QC
Prep tab's serial-dilution logic (raw standard drawn only where actually
used — not multiplied by calibration level count) and the LC Gradient tab's
trapezoidal integration (for Mobile Phase A/B volume per sample) are ported
exactly from the Excel version.
