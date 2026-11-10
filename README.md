# LAR

Test demo built for localairegistry

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript strict,
Tailwind CSS v4, shadcn/ui, `motion`, Drizzle ORM, PGlite (local and tests)
or Supabase Postgres (production), Vitest.

## Quick start

No Docker needed. Requires Node 24 and npm. Signing in needs the two public
Supabase values in `.env.local` (see [Authentication](#authentication-supabase-auth)).

```bash
npm install
npm run db:migrate   # creates .data/pglite and applies ./drizzle migrations
npm run db:seed      # ensures the qualification-rules row; no demo data
npm run dev          # http://localhost:3000
```

`db:seed` is idempotent and inserts nothing but the default rules row. The app
starts empty: businesses arrive from Trustpilot discovery or Yelp searches.

> **PGlite is single-process.** Only one process may open `.data/pglite` at
> a time. Stop `npm run dev` before running `db:migrate` or `db:seed`, or set
> `DATABASE_URL` to use a real Postgres instead.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Vitest (`tests/**/*.test.{ts,tsx}`, each file gets an in-memory PGlite) |
| `npm run db:generate` | `drizzle-kit generate`: write a new SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply `./drizzle/*.sql` to the active database |
| `npm run db:seed` | Ensure the qualification-rules row exists (no demo data) |
| `npm run ingest` | Run a Yelp search job from the CLI (needs `YELP_API_KEY`) |
| `npm run google:search` | Plan, run, probe or resume a Google Maps search from the CLI (see [Google Maps search](#google-maps-search)) |

## Environment

Every variable except the two Supabase ones (needed to sign in) is optional. Copy `.env.example` to `.env.local` and fill in
what you need; the example file documents each one.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | unset → PGlite | Postgres connection string. When set, the app uses postgres-js. |
| `PGLITE_DATA_DIR` | `.data/pglite` | Local PGlite directory. |
| `GOOGLE_PLACES_API_KEY` | unset → Google Maps search disabled | Places API (New) key. Without it, `/searches/new` says "Google Maps search is not configured: set GOOGLE_PLACES_API_KEY". |
| `GOOGLE_GEOCODING_API_KEY` | unset → uses `GOOGLE_PLACES_API_KEY` | Geocoding for free-text areas only. |
| `GOOGLE_PLACES_MONTHLY_REQUEST_CAP` | `1000` | Most Google Places requests per month; searches pause at the cap. |
| `YELP_API_KEY` | unset → Yelp disabled | Yelp Fusion key. Without it, `/searches` says "Yelp search is not configured". |
| `FIRECRAWL_API_KEY` | unset → discovery disabled | Firecrawl key for Trustpilot discovery (scrape, seed, daily sync). |
| `NEXT_PUBLIC_SUPABASE_URL` | unset | Supabase project URL. Required for sign-in; unset → every page redirects to `/login`. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | unset | Supabase anon or publishable key (public by design). Required for sign-in; unset → every page redirects to `/login`. |
| `RESEND_API_KEY` | unset → dry run | Real email sending via Resend. |
| `EMAIL_FROM` | `CRM <onboarding@resend.dev>` | Default sender. |
| `CRON_SECRET` | unset → open | Bearer token required by `/api/cron/*`. |
| `APP_TIMEZONE` | `America/Chicago` | Display time zone (storage is UTC). |

### Database drivers

`getDb()` (`src/db/client.ts`) picks the driver once per process:

- **`DATABASE_URL` set** → `postgres` (postgres-js) with `prepare: false`, which
  Supabase's transaction pooler requires.
- **unset** → PGlite on disk at `PGLITE_DATA_DIR`.

Both drivers run the same migrations from `./drizzle`, so the schema is
identical. Tests always use an in-memory PGlite (`createTestDb()`).

### Authentication (Supabase Auth)

Sign-in is email + password through Supabase Auth, using `@supabase/ssr`.
`src/proxy.ts` calls `updateSession`, which refreshes the session cookie and
redirects signed-out users to `/login` (API routes get a 401 instead).
Exempt paths: `/login`, `/signup`, `/api/auth/*` and `/api/cron/*` (cron routes
check `CRON_SECRET` themselves). Signed-in users who open `/login` or
`/signup` are sent to `/lookup`.

Setup:

1. Put `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
   `.env.local` (never commit it).
2. In the Supabase dashboard, go to Authentication → URL Configuration. Set
   **Site URL** to `https://<domain>` and add the redirect URL
   `https://<domain>/api/auth/callback` (plus
   `http://localhost:3000/api/auth/callback` for local dev).
3. Email confirmation: when "Confirm email" is on, sign-up sends a link that
   lands on `/api/auth/callback`, which exchanges the code for a session and
   redirects to `/lookup`. When it is off, sign-up signs the user in
   immediately.
4. You can also create users in the dashboard: Authentication → Users → Add
   user, with "Auto Confirm" ticked.

## Google Maps search

`/searches/new` (also reached from the "Google Maps" button in Lookup)
searches Google Maps through Google's Places API (New): pick a niche (its
search terms fill in and stay editable) and an area (zip codes, "City, ST" or
"75201 +10mi"), and the form shows terms × zips = searches, the maximum
requests, an estimated maximum cost and the requests left this month before
anything is spent. Each term is searched in every zip (up to 3 pages, 60
places); results are cleaned, deduplicated against Yelp and Trustpilot rows,
qualified with the usual rules, and their websites read for email and social
links. Long searches run in slices: the open job page and the daily cron
continue them, and every request counts against
`GOOGLE_PLACES_MONTHLY_REQUEST_CAP`. Key setup is in
[docs/deploy.md](docs/deploy.md#google-maps-search). From a terminal:

```bash
npm run google:search -- --niche roofing --area "75201,75202" --dry-run   # plan and cost, no request
npm run google:search -- --niche roofing --area "Dallas, TX" --max-pages 1  # run a job
npm run google:search -- --probe "roofer 75201"                            # one request, prints rows, writes nothing
npm run google:search -- --resume <jobId>                                  # continue a paused or unfinished job
```

## Deploying

Vercel (app) + Supabase (Postgres, transaction pooler). Full walkthrough,
env var table, cron notes and smoke checklist: **[docs/deploy.md](docs/deploy.md)**.

In short:

1. Create a Supabase project and copy the **Transaction pooler** URI (port
   6543). Run `DATABASE_URL="…" npm run db:migrate` against it. The client
   already sets `prepare: false`, so no extra flags are needed.
2. Import the repo in Vercel (Next.js preset, `npm run build`, Node 24) and set
   `DATABASE_URL` (required: PGlite cannot persist on serverless), plus
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `CRON_SECRET` (recommended). See
   the [Environment](#environment) table for the rest.
3. Set `FIRECRAWL_API_KEY` for Trustpilot discovery (optional: `YELP_API_KEY`,
   `RESEND_API_KEY`). In Supabase Auth set the Site URL to
   `https://<vercel-domain>` and add the redirect URL `/api/auth/callback`.
4. `vercel.json` declares one daily cron, `/api/cron/daily` (`0 13 * * *`):
   campaigns, due emails, a 12-row stale Trustpilot sync and, on Sundays, a
   category seed. It fits the Hobby plan; the app does not depend on it.
5. The build does not migrate: re-run `npm run db:migrate` whenever a new file
   lands in `drizzle/` (currently up to `0002_scrape_backoff.sql`). There is no
   demo data to load.

## Project layout

```
src/app/            routes (App Router); every DB-reading page is force-dynamic
src/components/ui/  shadcn/ui components
src/components/shell/  app shell: top bar and navigation
src/db/             schema, client, migrator, seed, test utils, repositories
src/lib/            env, formatting, labels, action results, auth helpers
src/proxy.ts        Supabase Auth session refresh + redirects (Next 16 "proxy", formerly middleware)
drizzle/            generated SQL migrations (committed)
scripts/            migrate / seed / ingest CLIs (run with tsx)
tests/              Vitest suites
docs/deploy.md      Vercel + Supabase deployment guide
docs/team/          spec, architecture and work packages
```
