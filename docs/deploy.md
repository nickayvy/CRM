# Deploying to Vercel + Supabase

Step by step, from an empty Supabase project to a smoke-tested deployment.
Node 24 is required (`engines.node` in `package.json` is `>=24`); in Vercel set
Project Settings → General → Node.js Version to **24.x**.

## 1. Supabase (Postgres)

1. Create a project at https://supabase.com and note the database password.
2. Project → **Connect** → copy the **Session pooler** connection string:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   User is `postgres.<project-ref>`, host is `aws-0-<region>.pooler.supabase.com`,
   port is **6543**.
3. Replace `<password>` with your database password. URL-encode special
   characters (`@` → `%40`, `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `%` → `%25`),
   or reset the password to something alphanumeric.

**Why the transaction pooler works without extra flags.** It does not support
prepared statements. `src/db/client.ts` creates the postgres-js client as
`postgres(url, { prepare: false, max: 5 })`, so prepared statements are off
and at most 5 connections are opened per server instance. The URL is passed
through untouched. No `?pgbouncer=true` flag is needed (that is a Prisma
convention); leave it off.

4. Apply the migrations from your machine (the build does not migrate):
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" npm run db:migrate
   ```
   Pass the variable inline: the scripts run through `tsx` and do not load
   `.env.local`. The script prints `Applying migrations to Postgres
   (DATABASE_URL)…` and `Migrations applied.`.
5. Optional demo data:
   ```bash
   DATABASE_URL="…same…" npm run db:seed
   ```
   **Warning: `db:seed` TRUNCATES every table** (`RESTART IDENTITY CASCADE`)
   before inserting. Never run it against a database holding real data.

Only Postgres is used. There is no Supabase Auth, RLS, Realtime or Storage
dependency.

## 2. Vercel

1. Vercel → Add New → Project → import the GitHub repo.
2. Framework preset **Next.js**, build command `npm run build` (the default),
   Node.js **24.x**.
3. Add environment variables (Production, and Preview if wanted). Defaults
   below come from `src/lib/env.ts` and `.env.example`.

| Variable | Required | Default if unset | Notes |
|---|---|---|---|
| `DATABASE_URL` | **Yes, on Vercel** | PGlite on disk | The transaction pooler URI from step 1. PGlite cannot persist on serverless, so leaving it unset breaks the deployment. |
| `APP_PASSWORD` | Recommended | Gate off, every page is open | Shared workspace password. |
| `APP_SESSION_SECRET` | Recommended (needed with `APP_PASSWORD`) | Insecure dev default, with a warning in logs | Generate with `openssl rand -hex 32`. Changing it, or `APP_PASSWORD`, logs everyone out. |
| `CRON_SECRET` | Recommended | `/api/cron/*` are open | Vercel sends it automatically as `Authorization: Bearer <CRON_SECRET>` to declared crons. Use a long random value, e.g. `openssl rand -hex 32`. |
| `YELP_API_KEY` | Optional | Fixture mode | Without it, searches read the bundled `fixtures/yelp/*.json`. `next.config.ts` ships them with every function through `outputFileTracingIncludes`. |
| `YELP_MODE` | Optional | `live` if `YELP_API_KEY` is set, else `fixture` | `live` or `fixture`; forces a mode. |
| `RESEND_API_KEY` | Optional | Email is dry-run | Without it, email campaigns record `dry_run` messages and send nothing. |
| `EMAIL_FROM` | Optional | `CRM <onboarding@resend.dev>` | Must be a sender Resend accepts for your domain. |
| `APP_TIMEZONE` | Optional | `America/Chicago` | IANA zone for displaying timestamps; storage is UTC. |

`PGLITE_DATA_DIR` is ignored when `DATABASE_URL` is set.

4. Deploy. Vercel redeploys on every push to the production branch.

## 3. Crons

`vercel.json` declares two daily crons (`0 13 * * *` for campaigns, `0 14 * * *` for email, UTC):

| Path | Does |
|---|---|
| `/api/cron/campaigns` | Re-evaluates every running or paused call campaign (auto pause, resume, complete). |
| `/api/cron/email` | Sends every due email step across running campaigns. |

**Hobby plan:** Hobby allows cron jobs only once per day, so an hourly
schedules will fail the deploy. Either upgrade to Pro, or edit both
`schedule` values in `vercel.json` to a daily expression, for example
`0 14 * * *`.

The app does not depend on crons. Call campaigns are evaluated on page load
and before every claim, and email campaigns have a manual **Process now**
button.

Both routes return `401` when `CRON_SECRET` is set and the request lacks the
exact `Authorization: Bearer <CRON_SECRET>` header. When `CRON_SECRET` is
unset they are open. They are exempt from the password gate (`src/proxy.ts`).

Trigger one by hand:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/campaigns
# 200 {"evaluated": ...}
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/email
# 200 {"sent": ...}
```

## 4. Migrations

The Vercel build runs `next build` only; it never migrates. Whenever a new
file lands in `drizzle/` (generated with `npm run db:generate`), run against
the production database before or right after deploying:

```bash
DATABASE_URL="…transaction pooler URI…" npm run db:migrate
```

Applied migrations are skipped, so it is safe to re-run.

## 5. Smoke checklist

Replace `<app>` with your deployment URL.

- [ ] Opening `https://<app>/` while signed out redirects to `/login`, and the `APP_PASSWORD` signs you in.
- [ ] Dashboard `/` renders its stat cards.
- [ ] `/searches/new`: run a search for "Houston, TX" with category plumbing; it completes (fixture mode when `YELP_API_KEY` is unset).
- [ ] `/businesses` lists the results.
- [ ] Open a call campaign, set your agent name, press Next to claim a business, record an outcome.
- [ ] Email campaign: start it, then **Process now** records a dry-run message (without `RESEND_API_KEY`).
- [ ] `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/campaigns` returns 200 with JSON, and the same request without the header returns 401.
- [ ] Cmd/Ctrl+K opens search and finds a business.

## 6. Troubleshooting

- **`prepared statement "..." does not exist` / `already exists`**: the
  connection is not going through the transaction pooler. Use the port 5432
  `pooler.supabase.com` URI, not the session pooler (port 5432) or a
  non-pooled direct connection.
- **PGlite errors or filesystem write errors in the Vercel function logs**:
  `DATABASE_URL` is unset (or blank) for that environment, so the app fell
  back to PGlite. Set it for Production and Preview, then redeploy.
- **`password authentication failed` or `Tenant or user not found`**: wrong
  password (check URL-encoding), or the user is not `postgres.<project-ref>`.
- **Cron route returns 401**: `CRON_SECRET` differs between your request and
  the Vercel environment variable, or was added after the last deploy (redeploy).
- **Deploy fails on cron validation**: you are on Hobby with hourly schedules;
  see section 3.
- **Everyone keeps getting logged out**: `APP_SESSION_SECRET` is unset or
  changing between deploys. Set a fixed value.
- **`relation "…" does not exist`**: migrations were not applied; run section 4.
- **Searches return the same sample businesses**: no `YELP_API_KEY`, so fixture
  mode is active by design.
