# Team status

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-01 | Foundation | 1 | senior-wp01 (Opus) | wp-01-foundation / PR #1 | merged | reviews/WP-01.md (ACCEPT, round 1) |
| WP-02 | Design system | 2 | senior-wp02 (Opus) | wp-02-design-system / PR #3 | merged | reviews/WP-02.md (ACCEPT, round 1) |
| WP-03 | Ingestion and qualification | 2 | senior-wp03 (Opus) | wp-03-ingestion / PR #2 | merged | reviews/WP-03.md (ACCEPT, round 1) |
| WP-04 | Businesses UI | 3 | senior-wp04 (Opus) | wp-04-businesses-ui / PR #5 | merged | reviews/WP-04.md (ACCEPT, round 1) |
| WP-05 | Calling | 3 | senior-wp05 (Opus) | wp-05-calling / PR #6 | merged | reviews/WP-05.md (ACCEPT, round 1) |
| WP-06 | Email | 3 | senior-wp06 (Opus) | wp-06-email / PR #4 | merged | reviews/WP-06.md (ACCEPT, round 1) |
| WP-07 | Dashboard and integration | 4 | senior-wp07 (Opus) | wp-07-dashboard / PR #7 | merged | reviews/WP-07.md (ACCEPT, round 1) |
| WP-08 | UI polish (AnimatedNumber fallback, mobile bulk bar) | 5 | senior-wp08 (Opus) | wp-08-polish / PR #8 | merged | reviews/WP-08.md (ACCEPT, round 1) |

Estimated agents: 7 Opus seniors + roughly 1–3 Sonnet juniors each.

## Log
- 2026-11-07 spec, architecture, and 7 work packages written; Supabase project `local-business-crm` (ref `aszvhaanfiiofmzvzfub`, us-west-1) created; GitHub remote `nickayvy/CRM` added by the user.
- 2026-11-07 wave 1 spawned: WP-01 (senior-wp01, Opus 5.5, worktree). Cloud move attempted; blocked on Claude GitHub App access to nickayvy/CRM (user action).
- 2026-11-07 WP-01 delivered (PR #1, 94 files, 85 tests); PM review ACCEPT round 1; merged to main.
- 2026-11-07 wave 2 spawned: WP-02 (design system), WP-03 (ingestion + qualification) in parallel.
- 2026-11-07 WP-03 delivered (PR #2, 22 files, 239 tests total); PM review ACCEPT round 1; merged to main. Architecture corrected (score example, fixture slug, duplicate-phone ordering).
- 2026-11-07 WP-02 delivered (PR #3, 38 files, 272 tests total); PM review ACCEPT round 1; merged to main.
- 2026-11-07 wave 3 spawned: WP-04 (businesses UI), WP-05 (calling), WP-06 (email) in parallel.
- 2026-11-07 WP-06 delivered (PR #4, 22 files, 311 tests total); PM review ACCEPT round 1; merged to main.
- 2026-11-07 WP-04 delivered (PR #5, 30 files); PM review started.
- 2026-11-07 WP-04 PM review ACCEPT round 1; merged to main. WP-05 still building.
- 2026-11-07 WP-05 delivered (PR #6, 27 files, 384 tests); PM review ACCEPT round 1; merged to main. Wave 3 complete.
- 2026-11-07 main green after wave 3 (448 tests). Wave 4 spawned: WP-07 (dashboard, search, campaign wiring, deploy readiness, carried-over fixes).
- 2026-11-07 Supabase project `aszvhaanfiiofmzvzfub`: schema applied via the Supabase MCP (migration `0000_init_local_business_crm`, identical to `drizzle/0000_init.sql`), Drizzle bookkeeping row inserted (hash bfd8bea5…, created_at 1794047797511) so `npm run db:migrate` is a no-op there; RLS enabled with no policies on all tables (the app connects as the postgres role over `DATABASE_URL`, which bypasses RLS; the REST surface is closed). Pooled `DATABASE_URL` still needed from the user for the build check and optional seed.
- 2026-11-07 WP-07 delivered (PR #7, 26 files, 482 tests); PM review ACCEPT round 1; merged to main. All seven packages merged; integration check running.
- 2026-11-07 Integration check on main: 482 tests, 0 build warnings, 23 routes 200, cron auth OK. Run summary written (summary.md). Pending user inputs: DATABASE_URL, YELP_API_KEY, Vercel login.
- 2026-11-07 Vercel project `local-business-crm` (prj_j994b2QXyhv1gcryUmHlNpc1r8cU, team team_WcqJseRx2mNyLJUfceaQwuXa) created via the Vercel MCP and linked to nickayvy/CRM (production branch main). `DATABASE_URL` to be set by the user in Vercel. This push triggers the first production deployment.
- 2026-11-07 Deployed to Vercel (production READY). Supabase seeded; live `/api/search` returns Supabase rows. Crons switched to daily for the Hobby plan.
- 2026-11-07 Hosted app hung on query-heavy pages (postgres-js pipelining vs Supabase transaction pooler). Fixed with max_pipeline:1; verified all routes, a 6-way concurrent burst, and both crons live. User keeps Vercel Authentication on. Run complete.
- 2026-11-07 WP-08 spawned for the two cosmetic open issues. Yelp live mode and real email delivery remain gated on user-supplied YELP_API_KEY / RESEND_API_KEY.
- 2026-11-07 WP-08 delivered (PR #8, 3 files, 485 tests); PM review ACCEPT round 1; merged to main; deploying.
- 2026-11-07 WP-08 deployed (production on 9ed47a2): all routes 200, crons OK. Run closed. Remaining inputs are optional and user-held: YELP_API_KEY (live ingestion instead of fixtures) and RESEND_API_KEY (real delivery instead of dry run).

# v2 — LAR pivot (2026-11-08)

| WP | Title | Wave | Agent | Branch / PR | State | Review |
|---|---|---|---|---|---|---|
| WP-11 | LAR theme, shell, Supabase Auth | 1 | senior-wp11 (Opus) | wp-11-theme-shell-auth / PR #9 | merged | v2/reviews/WP-11.md (ACCEPT) |
| WP-12 | Data model v2, repos, test-data removal | 1 | senior-wp12 (Opus) | wp-12-data-v2 / PR #10 | merged | v2/reviews/WP-12.md (ACCEPT) |
| WP-13 | Trustpilot discovery (Firecrawl) | 2 | senior-wp13 (Opus) | wp-13-discovery / PR #11 | merged | v2/reviews/WP-13.md (ACCEPT) |
| WP-14 | Lookup UI | 2 | senior-wp14 (Opus) | wp-14-lookup-ui / PR #13 | merged | v2/reviews/WP-14.md (ACCEPT) |
| WP-15 | Leads UI | 2 | senior-wp15 (Opus) | wp-15-leads-ui / PR #12 | merged | v2/reviews/WP-15.md (ACCEPT) |
| WP-16 | Restyle + integration | 3 | senior-wp16 (Opus) | wp-16-restyle / PR #14 | merged | v2/reviews/WP-16.md (ACCEPT) |

## v2 log
- 2026-11-08 User directive: overhaul to the gtm ("LAR") product and UI, remove all test data, defer voice agents. Inventory, spec, architecture delta, and six packages written under docs/team/v2/.
- 2026-11-08 v2 wave 1 spawned: WP-11 (theme/shell/auth), WP-12 (data v2 + test-data removal) in parallel.
- 2026-11-08 v2 wave 1 merged (WP-11 PR #9, WP-12 PR #10). Supabase: demo rows deleted, migration 0001 applied with RLS on the new tables. Signed-in shell check pending a test user.
- 2026-11-08 Main green after wave 1 (536 tests, 0 warnings). Dev-only auth bypass was proposed and refused by the permission classifier (security weakening); signed-in QA waits for a user-created Supabase test account. Wave 2 spawned: WP-13, WP-14, WP-15 in parallel. Vercel env: NEXT_PUBLIC_SUPABASE_URL/ANON_KEY set.
- 2026-11-08 WP-13 delivered (PR #11, 13 files, 570 tests); PM review ACCEPT; merged.
- 2026-11-08 WP-15 delivered (PR #12, 15 files, 642 tests); PM review ACCEPT; merged. Awaiting WP-14.
- 2026-11-09 WP-14 delivered (PR #13, 31 files); PM review ACCEPT; merged with the discovery bridge wired to WP-13. Wave 2 complete; main 727 tests, 0 warnings.
- 2026-11-09 Wave 3 spawned: WP-16 (restyle all v1 screens, /overview, category-alias alignment, seed via after(), scrape back-off migration 0002).
- 2026-11-09 WP-16 delivered (PR #14, 58 files, 771 tests); PM review ACCEPT; merged. Migration 0002 (scrape back-off) applied to Supabase with its bookkeeping row. All six v2 packages merged; integration chain on main and deploy verification running.
- 2026-11-09 Main green after wave 3 (771 tests, 0 warnings). Deployed to Vercel (production READY on c8c7dda); live check: all protected routes 307 → /login, sign-in page serves, API 401 without session, daily cron 200 with bearer / 401 without. v2 run summary written (v2/summary.md). Remaining user inputs: Supabase test user (signed-in browser pass, AC8), Supabase Auth Site URL + redirect for the Vercel domain, FIRECRAWL_API_KEY (optionally YELP_API_KEY, RESEND_API_KEY).
- 2026-11-09 Signed-in browser pass with the user's Supabase test account (local build, production Auth): shell, sign-out, all routes, 375 px (0 overflow), live Yelp search (50 fetched / 45 qualified), campaign + dialer. YELP_API_KEY set on Vercel and production redeployed (READY). AC8 closed. Open: FIRECRAWL_API_KEY, Supabase Auth Site URL/redirect.
- 2026-11-09 FIRECRAWL_API_KEY set on Vercel, production redeployed (READY); hosted daily cron now runs the Trustpilot sync. Live Trustpilot scrape verified locally: paste-URL → card, dossier, Add to Lead List → /leads. Discovery, Yelp, calling, email (dry run) all working. Open: Supabase Auth Site URL/redirect (user), optional RESEND_API_KEY.
