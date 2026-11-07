# Local Business CRM

A lead-generation CRM for selling to small local businesses. It pulls
businesses from Yelp Fusion by category and location, qualifies them with an
explicit rule engine, and gives a sales team browsing, calling campaigns and
email sequences.

Stack: Next.js 16 (App Router, Turbopack), React 19, TypeScript strict,
Tailwind CSS v4, shadcn/ui, `motion`, Drizzle ORM, PGlite (local and tests)
or Supabase Postgres (production), Vitest.

## Quick start

No accounts, keys or Docker needed. Requires Node 24 and npm.

```bash
npm install
npm run db:migrate   # creates .data/pglite and applies ./drizzle migrations
npm run db:seed      # 100 fixture businesses, campaigns, activities
npm run dev          # http://localhost:3000
```

`db:seed` is idempotent: it truncates every table and inserts the demo data
again, then prints a row count per table.

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
| `npm test` / `npm run test:watch` | Vitest (`tests/**/*.test.ts`, each file gets an in-memory PGlite) |
| `npm run db:generate` | `drizzle-kit generate`: write a new SQL migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply `./drizzle/*.sql` to the active database |
| `npm run db:seed` | Migrate, then reset and seed demo data |
| `npm run ingest` | Run a Yelp search job from the CLI (implemented in WP-03) |

## Environment

Every variable is optional. Copy `.env.example` to `.env.local` and fill in
what you need; the example file documents each one.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | unset → PGlite | Postgres connection string. When set, the app uses postgres-js. |
| `PGLITE_DATA_DIR` | `.data/pglite` | Local PGlite directory. |
| `YELP_API_KEY` | unset | Yelp Fusion key. Without it, searches read `fixtures/yelp/`. |
| `YELP_MODE` | `live` with a key, else `fixture` | Force a mode. |
| `APP_PASSWORD` | unset → gate off | Shared password for the whole app. |
| `APP_SESSION_SECRET` | dev default (warns) | HMAC secret for the session cookie. Set it in production. |
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

### Password gate

When `APP_PASSWORD` is set, `src/proxy.ts` redirects every page to `/login`
until the browser holds a `crm_session` cookie equal to
`HMAC-SHA256(APP_SESSION_SECRET, APP_PASSWORD)`. Changing either value logs
everyone out. `/api/cron/*` is exempt and uses `CRON_SECRET` instead. A
logout button appears in the top bar while the gate is active.

## Deploying

### 1. Supabase (Postgres)

1. Create a project at https://supabase.com (or use the existing one).
2. Project → **Connect** → copy the **Transaction pooler** URI (port 6543)
   and substitute your database password.
3. Apply migrations and, optionally, the demo data from your machine:
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres" npm run db:migrate
   DATABASE_URL="…same…" npm run db:seed    # optional: resets all tables
   ```
   Only Postgres is used: no Supabase Auth, RLS or Realtime.

### 2. Vercel

1. Import the GitHub repo in Vercel (framework preset: Next.js; build
   command `npm run build`).
2. Set environment variables for Production (and Preview if wanted):
   `DATABASE_URL` (required on Vercel: PGlite cannot persist on serverless),
   `APP_PASSWORD` + `APP_SESSION_SECRET` (recommended), `CRON_SECRET`,
   and optionally `YELP_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `APP_TIMEZONE`.
3. Deploy. `vercel.json` declares two hourly crons, `/api/cron/campaigns` and
   `/api/cron/email`. When `CRON_SECRET` is set, Vercel sends it as a bearer
   token automatically. On the Hobby plan crons run at most once a day; the
   app does not depend on them, since campaigns are also evaluated on access
   and email has a manual "Process now".
4. Run `npm run db:migrate` against `DATABASE_URL` whenever a new migration
   lands. The build does not migrate.

## Project layout

```
src/app/            routes (App Router); every DB-reading page is force-dynamic
src/components/ui/  shadcn/ui components
src/components/shell/  app shell: sidebar, mobile drawer, theme toggle
src/db/             schema, client, migrator, seed, test utils, repositories
src/lib/            env, formatting, labels, action results, auth helpers
src/proxy.ts        optional password gate (Next 16 "proxy", formerly middleware)
drizzle/            generated SQL migrations (committed)
fixtures/yelp/      offline Yelp Fusion fixtures used without an API key
scripts/            migrate / seed / ingest CLIs (run with tsx)
tests/              Vitest suites
docs/team/          spec, architecture and work packages
```
