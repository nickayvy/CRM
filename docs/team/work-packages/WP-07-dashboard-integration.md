# WP-07: Dashboard, global search, integration, deploy readiness

**Wave:** 4
**Depends on:** WP-04, WP-05, WP-06 (merged)
**Owns files:** `src/app/page.tsx`, `src/features/dashboard/**`, `src/db/repo/dashboard.ts`, `src/db/repo/search.ts`, `src/components/command-palette.tsx`, `src/components/shell/**` (add palette wiring and shortcuts), `src/features/businesses/components/businesses-table.tsx` and `src/app/businesses/page.tsx` (only to add "Add to campaign" bulk actions), `src/features/businesses/components/campaign-membership.tsx` + its mount in `src/app/businesses/[id]/page.tsx`, `README.md`, `vercel.json`, `docs/deploy.md`, `tests/dashboard*.test.ts`, `tests/search*.test.ts`
**Delivers:** branch `wp-07-dashboard` / PR "WP-07: Dashboard and integration"

## Objective
The manager's view and the glue: a dashboard whose numbers are provably
right, Cmd-K search across businesses and campaigns, "Add to campaign"
from the businesses table, campaign membership on the business detail
page, keyboard-shortcut help, and documentation that gets the app onto
Vercel with Supabase.

## Context the engineer needs
- Everything is merged: read `README.md`, `/design`, and the repos in
  architecture §Interfaces (businesses, call-campaigns, email-campaigns,
  activities). Charts: shadcn chart components over recharts
  (`npx shadcn@latest add chart`), wrapped in the WP-02 `ChartCard`.
- `src/components/command-palette.tsx` is currently a stub (WP-01);
  replace it with a cmdk-based palette (`ui/command` exists).
- Dashboard stat definitions: architecture §Interfaces `DashboardStats`.
  `interestRate7d` = interested outcomes / all outcomes in the last 7 days
  (0 when none). `overdueCallbacks` = queue items in `callback` with
  `callbackAt < now`. `callsToday` = call activities with `occurredAt` on
  today's local date in `env.APP_TIMEZONE`.

## Scope
### In
- `getDashboardStats`, `searchAll` repos + tests.
- `/`: `StatGrid` (businesses total with qualified/review/rejected
  sub-line; calls today; interest rate 7d; emails sent today; running
  campaigns (call + email); overdue callbacks linking to `/calling`),
  charts: rejection breakdown (bar), calls by outcome last 7 days (stacked
  bar by day), status funnel (horizontal bar); "Running campaigns" panel
  (each with queue progress bar, completed today / cap, active agents,
  "Open dialer"); "Due callbacks" list; "Recent activity" `Timeline` (10);
  entrance animations via `AnimatedList`.
- Command palette: `⌘K`/`Ctrl+K` and the shell button; groups: Pages
  (Dashboard, Businesses, Searches, Calling, Email, Settings, Design),
  Businesses (name/phone/city, ≤ 8), Call campaigns, Email campaigns;
  debounce 150 ms; Enter navigates; `?` opens a shortcuts help dialog
  listing global (`⌘K`, `[`, `?`, `⌘/`) and dialer shortcuts.
- Businesses table: bulk actions "Add to call campaign…" and "Add to
  email campaign…" (dialog listing non-completed campaigns →
  `addBusinessesToCampaign` / `enrollBusinesses` → toast with
  added/skipped). Business detail: `CampaignMembership` panel listing the
  call queue items (campaign, state, attempts, last outcome) and email
  enrollments (campaign, state, step) for that business with links.
- Final responsive pass over every route at 375 px; fix anything that
  scrolls horizontally (you may touch other packages' files for
  responsive CSS fixes only; list each in the report).
- `docs/deploy.md`: Supabase (create project, get pooled `DATABASE_URL`
  with `?pgbouncer=true` / port 6543, run `npm run db:migrate` locally
  against it, optional seed), Vercel (import repo, set env vars
  `DATABASE_URL`, `YELP_API_KEY`, `APP_PASSWORD`, `APP_SESSION_SECRET`,
  `CRON_SECRET`, optional `RESEND_API_KEY`/`EMAIL_FROM`, `APP_TIMEZONE`;
  cron note for Hobby plan), and a smoke checklist. Update README to link it.
- `vercel.json`: confirm crons; add nothing else unless required by build.
### Out
- New data model changes. Auth.

## Interfaces
### Consumes
All repos. `BusinessesTable.bulkActions` prop (WP-04). `addBusinessesToCampaign` (WP-05), `enrollBusinesses` (WP-06).
### Produces
`src/db/repo/dashboard.ts`, `src/db/repo/search.ts` as in architecture.

## Acceptance criteria
AC-07.1 `tests/dashboard.test.ts`: on a seeded test DB, every field of `getDashboardStats(now)` equals a value computed independently in the test from the tables (count queries written in the test, not by calling the repo), including `interestRate7d` and `overdueCallbacks`.
AC-07.2 `tests/search.test.ts`: `searchAll('abc')` returns the ABC Plumbing rows; `searchAll('713555')` matches by phone digits; campaign names match case-insensitively; limits respected.
AC-07.3 Browser: `/` renders all stat cards with numbers matching the test values (compare with the seed), three charts, running campaigns panel, callbacks, recent activity. Light + dark screenshots.
AC-07.4 `⌘K` → type a seeded business name → Enter opens its detail page; type a campaign name → opens the campaign; `?` shows the shortcuts dialog.
AC-07.5 Select 3 qualified businesses with phones → "Add to call campaign…" → choose the seeded running campaign → toast "Added 3" (or fewer with the skipped count) and the campaign queue shows them; the same for email with businesses that have emails. Business detail shows the membership panel afterwards.
AC-07.6 Every route in the app at 375 px has no horizontal page scroll (list the routes you checked with screenshot paths).
AC-07.7 `npm test`, typecheck, lint, build exit 0; `docs/deploy.md` and README updated; `vercel.json` valid JSON with both crons.

## Delegation guidance
Good junior tasks: `tests/search.test.ts`, shortcuts help dialog, the
responsive sweep (QA pass with screenshots, fix nothing beyond CSS),
`docs/deploy.md` draft. Keep: dashboard stats repo + test, palette, bulk
actions wiring.

## Reporting
Completion-report format from the senior brief.
