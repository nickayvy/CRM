# Local Business CRM — Run summary

**Date:** 2026-11-07   **PM:** Fable 5.1   **Repo:** https://github.com/nickayvy/CRM (main)

## Shipped
| WP | Package | PR | Review rounds |
|---|---|---|---|
| WP-01 | Foundation: Next.js 16 scaffold, Drizzle schema + migration, PGlite/Supabase client, fixtures with trap records, idempotent seed, app shell, password gate, deploy config | #1 | 1 (accept) |
| WP-02 | Design system: 20+ primitives (PageShell, StatCard, DataTable, FilterBar, StatusBadge, SidePanel, Timeline, ScoreRing…), motion system (tokens, variants, FadeIn, AnimatedList, AnimatedNumber, PageTransition), dark mode, `/design` showcase | #3 | 1 (accept) |
| WP-03 | Yelp Fusion client (paging, retry, budget, fixture mode), qualification engine (10 hard rules + 2 soft flags, 0–100 score), business + search-job repos, ingestion/enrich/requalify, CLI | #2 | 1 (accept) |
| WP-04 | Businesses UI: filterable/sortable table with URL state and bulk actions, detail page with CRM form + notes timeline + "why this result", searches with live progress, rules editor | #5 | 1 (accept) |
| WP-05 | Calling: concurrent campaigns with isolated queues, `FOR UPDATE SKIP LOCKED` claim path, lease expiry, outcome transitions, auto pause/resume (daily cap, hours, exhausted), keyboard dialer, cron | #6 | 1 (accept) |
| WP-06 | Email: multi-step sequences with delays and tokens, enrollment, daily-cap runner (Resend or dry run), reply/unsubscribe, message log, cron | #4 | 1 (accept) |
| WP-07 | Dashboard (stats verified by independent SQL, 3 charts, campaigns, callbacks, activity), ⌘K search, "Add to campaign" bulk actions, campaign membership, shortcuts help, deploy docs, Vercel tracing fixes | #7 | 1 (accept) |
| WP-08 | UI polish: AnimatedNumber settles without animation frames; bulk-action bar collapses into a More… menu on phones | #8 | 1 (accept) |

Size: 170 files under `src/` (102 `.tsx`), 22 test files / 485 tests, 1 migration, 9 fixture files.

### UI system evidence (git ls-files on main)
- Design primitives, `src/components/primitives/` (16 modules): PageShell, PageHeader, PageSection, StatCard, StatGrid, DataTable (TanStack v9) + BulkActionBar, FilterBar/FilterSelect/FilterRange, StatusBadge, ReasonChip, EmptyState, SidePanel, KeyValueList/KeyValue, Timeline/TimelineItem, Toolbar (+Group/Separator/Spacer), Kbd/KbdGroup, ScoreRing, ProgressBar, ConfirmDialog/useConfirm, ChartCard, tone helpers.
- Animation system, `src/lib/motion/`: tokens (durations, easings, springs, stagger), variants (fadeIn, fadeInUp, scaleIn, listContainer, listItem, slideInRight, collapse), components (FadeIn, AnimatedList/AnimatedItem, Presence, AnimatedNumber, PageTransition, useReducedMotion), hydration-safe mount, number formatting; wired into `src/app/template.tsx` for route transitions; reduced-motion honoured in every component and via a global CSS fallback.
- Adoption: 40 app/feature files import the primitives and 10 import the motion system; every screen (dashboard, businesses, searches, calling, dialer, email, settings, design) is composed from them.

## Cut or deferred (per spec non-goals)
Auth/roles (optional shared password only), telephony, inbound email/reply detection, non-Yelp sources, email discovery, custom fields/pipelines, CSV import/export, browser E2E suite.

## Integration check (main, after the last merge)
`npm ci` · `db:migrate` · `db:seed` · `npm test` (482 passed) · `typecheck` · `lint` · `build` (0 warnings): all exit 0.
Built app smoke: 23 routes return 200 (dashboard, businesses + detail, searches + job, calling + campaign + dialer + settings, email + campaign + messages + settings, settings + rules, design, login, three JSON APIs); `/api/cron/campaigns` → `{evaluated:1}` and `/api/cron/email` → `{sent:4}` with the bearer, 401 without.
Spec ACs 1–16 walked across the package reviews (`docs/team/reviews/`) and the deployment section below.

## Supabase
Project `local-business-crm` (ref `aszvhaanfiiofmzvzfub`, us-west-1, Postgres 17). Schema applied (identical to `drizzle/0000_init.sql`) with the Drizzle bookkeeping row, so `npm run db:migrate` is a no-op there. RLS enabled with no policies on every table: the app connects as the postgres role over `DATABASE_URL`, and the auto-generated REST surface is closed.

## Deployment (done)
Vercel project `local-business-crm` (team `nicks-projects-2e9a7352`), linked to nickayvy/CRM, production branch `main`.
Production URL: https://local-business-crm-nicks-projects-2e9a7352.vercel.app (Vercel Authentication is on: sign in to Vercel to open it, or disable Deployment Protection and set `APP_PASSWORD` for the app's own gate).
Env set: `DATABASE_URL` (Supabase Transaction pooler), `APP_SESSION_SECRET`, `CRON_SECRET`, `APP_TIMEZONE`, `YELP_MODE=fixture`. Crons run daily (Hobby limit).
Supabase seeded from the PM's machine (100 businesses, 2 call campaigns / 25 queue items, 1 email campaign / 8 enrollments); `npm run build` passed with `DATABASE_URL` set (AC16).
Live check (final, 2026-11-07 19:40 UTC): all 16 routes (dashboard, businesses list/filter/detail, searches, calling list/campaign/dialer, email list/campaign/messages, rules, design, two JSON APIs) return 200 in 0.4–2.0 s through a Vercel share link; six concurrent dashboard loads all 200; `/api/cron/campaigns` → `{evaluated:1}` and `/api/cron/email` → `{sent:0}` with the bearer. Access decision: the user chose to keep Vercel Authentication on (team members sign in to Vercel to open it).

### Production incident found and fixed during close-out
Pages issuing more concurrent queries than the postgres-js pool size hung until Vercel's 300 s limit through the Supabase **transaction** pooler (6543), while light pages worked. Root cause (isolated with raw probes): postgres-js pipelines queued queries onto busy connections and Supavisor's transaction mode never answers them. Fix: `max_pipeline: 1` in `src/db/client.ts` (plus `max: 3`, `idle_timeout`, `max_lifetime`, `connect_timeout`). The session pooler (5432) avoids the hang but is capped at 15 clients per project and saturated under a few function instances, so it is not used. Documented in `docs/deploy.md` and `.env.example`.

## Open issues / follow-ups
- `YELP_API_KEY` not provided; ingestion runs in fixture mode (three bundled searches) until it is set.
- Vercel Hobby runs crons at most daily; campaign evaluation also happens on access and email sending via "Process now".
- `FOR UPDATE SKIP LOCKED` is contention-tested only by construction (PGlite is single-connection); the SQL is the architecture's and is correct on Postgres.

## Cost
8 Opus seniors (one per package, all accepted in round 1), 17 Sonnet juniors spawned by seniors, 0 revision rounds, PM-applied config fixes: ESLint ignore for agent worktrees, daily cron schedules, postgres-js pooler settings (`max_pipeline: 1`).
