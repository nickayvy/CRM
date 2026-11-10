# Deploying LAR to Vercel + Supabase

Step by step, from an empty Supabase project to a smoke-tested deployment.
Node 24 is required (`engines.node` in `package.json` is `>=24`); in Vercel set
Project Settings → General → Node.js Version to **24.x**.

LAR ships **no demo data**. A fresh deployment starts empty: businesses
arrive from Trustpilot discovery (Firecrawl) or Yelp searches, leads from what
each user adds in Lookup.

## 1. Supabase

One Supabase project provides both the Postgres database and Auth.

### 1a. Postgres (transaction pooler)

1. Create a project at https://supabase.com and note the database password.
2. Project → **Connect** → copy the **Transaction pooler** connection string:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
   User is `postgres.<project-ref>`, host is `aws-0-<region>.pooler.supabase.com`,
   port is **6543**.
3. Replace `<password>` with your database password. URL-encode special
   characters (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `%` → `%25`),
   or reset the password to something alphanumeric.

**Why these client flags.** The transaction pooler does not support
prepared statements. `src/db/client.ts` creates the postgres-js client as
`postgres(url, { prepare: false, max: 3, max_pipeline: 1, idle_timeout: 20, max_lifetime: 300, connect_timeout: 10 })`:
prepared statements are off, at most 3 connections are opened per server
instance, and only one query is in flight per connection (postgres-js
pipelines queued queries by default and the transaction pooler never answers
them, so bursty pages would hang). Do not use the session pooler (port 5432):
it is capped at 15 clients per project and saturates under a few function
instances. The URL is passed through untouched; no `?pgbouncer=true` flag is
needed (that is a Prisma convention).

4. Apply the migrations from your machine (the build does not migrate):
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" npm run db:migrate
   ```
   Pass the variable inline: the scripts run through `tsx` and do not load
   `.env.local`. The script prints `Applying migrations to Postgres
   (DATABASE_URL)…` and `Migrations applied.`.
5. Ensure the qualification rules row exists:
   ```bash
   DATABASE_URL="…same…" npm run db:seed
   ```
   `db:seed` only inserts the default `qualification_rules` row when it is
   missing. It never inserts businesses, campaigns or other sample rows, and
   it does not truncate anything.

Data access goes through Drizzle over `DATABASE_URL`; per-user scoping (leads)
is enforced in server code (`requireUser()`), not by RLS.

### 1b. Auth (email + password)

1. Authentication → Sign In / Providers → **Email**: enabled.
2. Authentication → URL Configuration:
   - **Site URL**: `https://<vercel-domain>` (your production domain).
   - **Redirect URLs**: add `https://<vercel-domain>/api/auth/callback`
     (and `http://localhost:3000/api/auth/callback` for local development; add
     preview domains too if you sign in on previews).
3. **Email confirmation** (Authentication → Sign In / Providers → Email →
   "Confirm email"):
   - On (recommended): sign-up shows "Check your email to confirm your
     account"; the link lands on `/api/auth/callback`, which exchanges the code
     for a session and redirects to `/lookup`.
   - Off: sign-up signs the user in immediately.
4. Users can sign up at `/signup`, or be created in Authentication → Users →
   Add user (tick "Auto Confirm").
5. Project Settings → API: copy the **Project URL** and the **anon /
   publishable** key for the env vars below. Both are public by design.

## 2. Vercel

1. Vercel → Add New → Project → import the GitHub repo.
2. Framework preset **Next.js**, build command `npm run build` (the default),
   Node.js **24.x**.
3. Add environment variables (Production, and Preview if wanted). Defaults
   below come from `src/lib/env.ts` and `.env.example`.

| Variable | Required | Default if unset | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes, on Vercel** | PGlite on disk | The transaction pooler URI from step 1a (port 6543). PGlite cannot persist on serverless, so leaving it unset breaks the deployment. |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Every page redirects to `/login` and sign-in fails | Supabase Project URL. Read literally at build time, so redeploy after changing it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | As above | Supabase anon / publishable key. |
| `FIRECRAWL_API_KEY` | Recommended | Trustpilot discovery disabled; Lookup says so | Key from https://firecrawl.dev. Powers paste-a-URL scraping, category seeding and the daily sync. |
| `CRON_SECRET` | Recommended | `/api/cron/*` are open | Vercel sends it automatically as `Authorization: Bearer <CRON_SECRET>` to declared crons. Use a long random value, e.g. `openssl rand -hex 32`. |
| `GOOGLE_PLACES_API_KEY` | Recommended | Google Maps search disabled; `/searches/new` shows "Google Maps search is not configured: set GOOGLE_PLACES_API_KEY" and no Google request is made | Places API (New) key; see [Google Maps search](#google-maps-search) below. |
| `GOOGLE_GEOCODING_API_KEY` | Optional | Falls back to `GOOGLE_PLACES_API_KEY` | Used only for areas that are not zip codes, "City, ST" or "`<zip>` +`<n>`mi". |
| `GOOGLE_PLACES_MONTHLY_REQUEST_CAP` | Optional | `1000` | Most Places requests per calendar month (UTC). Searches pause at the cap and say so. Geocoding requests are counted separately against the same number. |
| `YELP_API_KEY` | Optional | Yelp search disabled; `/searches` shows "Yelp search is not configured" | Yelp Fusion key. |
| `RESEND_API_KEY` | Optional | Email is dry-run | Without it, email campaigns record `dry_run` messages and send nothing. |
| `EMAIL_FROM` | Optional | `CRM <onboarding@resend.dev>` | Must be a sender Resend accepts for your domain. |
| `APP_TIMEZONE` | Optional | `America/Chicago` | IANA zone for displaying timestamps; storage is UTC. |
| `NEXT_PUBLIC_APP_URL` | Optional | unset | Public base URL, for absolute links. |

`PGLITE_DATA_DIR` is ignored when `DATABASE_URL` is set. `/settings` shows
which of the optional sources are configured (never the values).

4. Deploy. Vercel redeploys on every push to the production branch.

### Google Maps search

1. In the Google Cloud console, pick (or create) a project with billing on.
   Under **APIs & Services → Library**, enable **Places API (New)**, and
   optionally **Geocoding API** (only needed for areas typed as free text,
   such as a neighbourhood name).
2. **APIs & Services → Credentials → Create credentials → API key.** Edit the
   key: under **API restrictions** choose **Restrict key** and select only
   Places API (New) (and Geocoding API if enabled). The server sends the key
   in a request header, so no application (referrer) restriction is needed.
3. Set `GOOGLE_PLACES_API_KEY` in Vercel (Production and Preview) and
   redeploy. Set `GOOGLE_PLACES_MONTHLY_REQUEST_CAP` if 1,000 requests a
   month is not the limit you want.
4. Apply migration `0005_google_places.sql` (see [Migrations](#4-migrations))
   before the first search.

How spend is controlled: every Text Search request is counted per calendar
month (UTC) in the `api_usage` table before it is sent. At the cap no further
request is made; the job stays running with the message "Paused: the monthly
Google Places request cap of N is reached …" and continues when the cap is
raised or the month changes. The form on `/searches/new` shows each plan's
searches, maximum requests, estimated maximum cost (about $35 per 1,000
requests, an estimate) and the requests left this month before anything is
spent; `/settings` shows "N of CAP requests used". A search can also be run
from a terminal with `npm run google:search` (see the README).

## 3. Cron (one, daily)

`vercel.json` declares a single cron, `/api/cron/daily` at `0 13 * * *` (UTC),
which fits the Hobby plan's once-a-day limit. One run:

1. re-evaluates every running or paused call campaign (auto pause, resume, complete);
2. sends every due email step across running email campaigns;
3. **google**: continues unfinished Google Maps searches, oldest first, for up
   to 60 s (it stops early at the monthly request cap). This is how a search
   nobody is watching finishes; an open job page also continues it;
4. re-scrapes up to 12 stale Trustpilot businesses within a 30 s budget
   (never-scraped first, then oldest; rows whose scrape keeps failing back off
   for 24 h × attempts, capped at 7 days);
5. reads the websites of businesses still missing links (email, phone,
   social) directly, Firecrawl only as a fallback, up to 300 rows;
6. on Sundays (UTC), seeds up to 20 new businesses from each of the 22
   Trustpilot categories within the remaining budget.

Steps 3 to 6 share a 240 s budget. Without `GOOGLE_PLACES_API_KEY`, step 3
reports `{"skipped": "GOOGLE_PLACES_API_KEY not set"}`; otherwise
`{"jobs": <continued>, "searches": <finished>, "outcome": <last slice outcome or null>}`.
Without `FIRECRAWL_API_KEY`, steps 4 and 6 report `{"skipped": "FIRECRAWL_API_KEY not set"}`.
The route sets `maxDuration = 300`.

The app does not depend on the cron. Call campaigns are evaluated on page load
and before every claim, email campaigns have a manual **Process now** button,
and Lookup can scrape a URL or seed a category on demand.

The route returns `401` when `CRON_SECRET` is set and the request lacks the
exact `Authorization: Bearer <CRON_SECRET>` header (open when unset). It is
exempt from the sign-in redirect (`src/proxy.ts`). The older
`/api/cron/campaigns` and `/api/cron/email` routes remain callable by hand but
are not scheduled.

Trigger it by hand:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/daily
# 200 {"campaigns":…,"emails":…,"google":…,"sync":…,"links":…,"seeded":…}
```

## 4. Migrations

The Vercel build runs `next build` only; it never migrates. Whenever a new
file lands in `drizzle/` (generated with `npm run db:generate`), run against
the production database before or right after deploying:

```bash
DATABASE_URL="…transaction pooler URI…" npm run db:migrate
```

Applied migrations are skipped, so it is safe to re-run. Current files:
`0000_init.sql`, `0001_v2.sql` (LAR v2 tables and columns),
`0002_scrape_backoff.sql` (scrape back-off columns on `businesses`),
`0003_ai_calls.sql`, `0004_campaign_agent.sql`, and
`0005_google_places.sql` (the `google` source, Google place id and Maps URL
and `website_domain` on `businesses`, job plan and progress columns on
`search_jobs`, and the `api_usage` table for the monthly cap; additive only).
Apply `0005` before the first Google search.

## 5. Smoke checklist

Replace `<app>` with your deployment URL.

- [ ] `https://<app>/` while signed out redirects to `/login`; the LAR sign-in card renders.
- [ ] Sign up at `/signup` (confirm the email if confirmation is on), then sign in: you land on `/lookup` with the top bar (LOOKUP · LEADS · CALLING · EMAIL · OVERVIEW) and your email in the user menu.
- [ ] `/lookup` on an empty database shows "No businesses yet". With `FIRECRAWL_API_KEY` set, paste `https://www.trustpilot.com/review/<domain>`: the business appears in the grid and graph; open its dossier and **Add to Lead List**.
- [ ] Seed a category from Lookup: "Seeding started" toast; rows appear within a minute.
- [ ] `/leads` shows the lead; change its status, add a note, export CSV.
- [ ] Create a call campaign, add the lead from `/leads`, open the dialer, set your agent name, record an outcome.
- [ ] Email campaign: start it, then **Process now** records a dry-run message (without `RESEND_API_KEY`).
- [ ] `/overview` renders its tiles (leads by status, businesses by source) and charts.
- [ ] `/searches/new` without `YELP_API_KEY` shows "Yelp search is not configured" on the Yelp tab.
- [ ] `/searches/new` without `GOOGLE_PLACES_API_KEY` shows "Google Maps search is not configured: set GOOGLE_PLACES_API_KEY". With it: pick Roofing, type `75201` and set pages to 1; the plan line reads "3 terms × 1 zip = 3 searches · up to 3 requests · …"; start it and the job page counts searches to 3 of 3; `/lookup?source=google` lists the businesses with a Google Maps link; `/settings` shows the requests used.
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/daily` returns 200 with JSON; without the header it returns 401.
- [ ] Cmd/Ctrl+K opens search and finds a business.

## 6. Troubleshooting

- **Sign-in link from the confirmation email fails or lands on the wrong host**:
  Site URL / Redirect URLs in Supabase Auth do not match the deployment
  domain; see 1b.
- **Every page redirects to `/login` even after signing in**:
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing or
  added after the last build. Set them and redeploy.
- **`prepared statement "..." does not exist` / `already exists`**: the
  connection is not going through the transaction pooler. Use the port 6543
  `pooler.supabase.com` URI, not the session pooler (port 5432) or a
  non-pooled direct connection.
- **PGlite errors or filesystem write errors in the Vercel function logs**:
  `DATABASE_URL` is unset (or blank) for that environment, so the app fell
  back to PGlite. Set it for Production and Preview, then redeploy.
- **`password authentication failed` or `Tenant or user not found`**: wrong
  password (check URL-encoding), or the user is not `postgres.<project-ref>`.
- **`column "scrape_failed_at" does not exist`** (or any `relation "…" does
  not exist`): migrations were not applied; run section 4.
- **Lookup says discovery is not configured**: `FIRECRAWL_API_KEY` is unset
  for that environment (redeploy after adding it).
- **Cron route returns 401**: `CRON_SECRET` differs between your request and
  the Vercel environment variable, or was added after the last deploy (redeploy).
