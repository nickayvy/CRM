# Leadwire v2 — Run summary

**Date:** 2026-11-08 → 2026-11-09   **PM:** Fable 5.1   **Repo:** https://github.com/nickayvy/CRM (main)
**Directive:** overhaul to the gtm ("Leadwire") product; copy its UI first; remove all test data; defer voice agents.

## Shipped
| WP | Package | PR | Review |
|---|---|---|---|
| WP-11 | Leadwire theme (dark-only tokens, Space Grotesk + Source Serif 4), top-bar shell (LOOKUP / LEADS / CALLING / EMAIL / OVERVIEW), Supabase Auth (`/login`, `/signup`, `/api/auth/callback`, `requireUser()`, proxy session refresh), `/design` in the new language | #9 | accept, round 1 |
| WP-12 | Data model v2: business `source` (yelp/trustpilot), Trustpilot fields, `business_relations`, `review_snapshots`, per-user `leads`; migration 0001; fixtures, demo seed and fixture mode removed; inline test builders | #10 | accept, round 1 |
| WP-13 | Trustpilot discovery over Firecrawl: profile scrape (upsert, snapshot, 30-day velocity, relations, qualification), category seed, website enrichment, rate limiter, time-boxed stale sync on the daily cron, server actions with "not configured" errors | #11 | accept, round 1 |
| WP-14 | Lookup page: d3 network graph, category bubbles, filter panel with URL state, business grid and cards, dossier modal, paste-URL and seed-category inputs, "Add to Lead List" | #13 | accept, round 1 |
| WP-15 | Leads page: per-user queue with inline status and notes, tabs, metrics, bulk add to call/email campaigns, CSV export, call history; dialer outcomes sync lead status | #12 | accept, round 1 |
| WP-16 | Restyle of every v1 screen (businesses, searches, calling, dialer, email, settings, rules), `/overview` with leads-by-status and businesses-by-source tiles, Source filter and L30D sort on businesses, Trustpilot detail panel, Yelp not-configured state, category-alias alignment, seed behind `after()`, scrape back-off (migration 0002), deploy docs | #14 | accept, round 1 |

Size on main: 222 files under `src/` (128 `.tsx`), 45 test files / 771 tests, 3 migrations, 0 fixture files.

## Spec acceptance criteria
| AC | Status | Where verified |
|---|---|---|
| AC1 clean-clone chain; `/` → `/lookup`; signed-out → `/login`; Leadwire sign-in card | pass | PM chain on main; `tests/routes-render.test.tsx`; hosted `/lookup` serves the sign-in page |
| AC2 tokens/fonts match gtm; `/design` renders every primitive | pass | v2/reviews/WP-11.md (token diff) |
| AC3 migration on PGlite and Supabase; 0 fixtures; 0 `fixture` refs in src; seed inserts rules only | pass | v2/reviews/WP-12.md; Supabase migrations 0001 + 0002 applied with bookkeeping |
| AC4 fake-Firecrawl pipeline; sync cron; unconfigured error | pass; live scrape verified 2026-11-09 | v2/reviews/WP-13.md; live pass below |
| AC5 Lookup from DB rows; URL filters; actions wired; Add to Lead List | pass (live: bubbles, graph, cards from 48 rows; paste-URL scrape; Add to Lead List → /leads) | v2/reviews/WP-14.md; discovery bridge wired at merge |
| AC6 per-user leads; edits persist; bulk add; CSV; history | pass (CSV download not exercised in the browser: no leads yet) | v2/reviews/WP-15.md |
| AC7 every v1 route in the Leadwire language; `/overview` | pass | v2/reviews/WP-16.md |
| AC8 production on Vercel with Supabase Auth; demo rows gone; live sign-in shows empty Lookup | pass: deployed, demo rows gone, sign-in page live; signed-in flow verified against the production Supabase Auth project from a local build (the PM does not enter credentials on the production host) | Deployment below |

## Removed in the pivot
Shared-password gate (`APP_PASSWORD`, `APP_SESSION_SECRET`, `crm_session`), light theme and `next-themes`, Yelp fixture mode (`YELP_MODE`) and all fixture files, demo seed data (Supabase rows deleted), hourly crons. Voice agents (Bland) were not ported, per the directive.

## Integration check (main c8c7dda)
`npm ci` · `db:migrate` · `db:seed` · `npm test` (771 passed) · `typecheck` · `lint` · `build` (0 warnings): all exit 0. Leftover references to the removed features: 0. Fixture files: 0.

## Supabase
Project `local-business-crm` (ref `aszvhaanfiiofmzvzfub`, us-west-1). Migrations applied through the MCP and mirrored in `drizzle.__drizzle_migrations` (0000 init, 0001 v2, 0002 scrape back-off), so `npm run db:migrate` is a no-op against production. RLS on with no policies (the app uses the postgres role over the transaction pooler; the REST surface is closed). Demo rows deleted; `qualification_rules` holds the single rules row.

## Deployment
Vercel project `local-business-crm` (team `nicks-projects-2e9a7352`), production branch `main`, Vercel Authentication on by the user's choice. Env: `DATABASE_URL` (pooler 6543), `CRON_SECRET`, `APP_TIMEZONE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `YELP_API_KEY`, `FIRECRAWL_API_KEY`. Single daily cron `/api/cron/daily` (Hobby plan). Obsolete env left in place and harmless: `APP_SESSION_SECRET`, `YELP_MODE`.
Live check (2026-11-09, deployment dpl_9SadxBebXchwoPU7MSeTQ7gvCLnX on c8c7dda, via a Vercel share link): `/` and `/lookup` → 307 `/login`; `/overview`, `/businesses`, `/leads`, `/calling`, `/email`, `/settings`, `/searches/new`, `/design` → 307 `/login?next=…`; `/login` 200 titled "Sign in · Leadwire"; `/signup` 200; `/api/search` without a session → 401 JSON; `/api/cron/daily` with the bearer → 200 `{campaigns:0, emails:0, sync:{skipped:"FIRECRAWL_API_KEY not set"}, seeded:null}`, without it → 401. All responses in 0.1–0.25 s.

## Signed-in browser pass (2026-11-09, local build on PGlite + production Supabase Auth, user-created test account)
- Sign-in lands on `/lookup`; the top bar shows LOOKUP / LEADS / CALLING / EMAIL / OVERVIEW, ⌘K search and the user menu (email, Settings, Sign out). Sign out returns to `/login`; `/overview` afterwards → `/login?next=/overview`.
- Lookup, Overview, Leads, Businesses, Calling, Email, Settings, Settings → Rules, Searches → New, Design all render in the Leadwire language with no console errors.
- 375 px: Lookup, Overview, Leads, Businesses, Settings, Calling, Email each report 0 px horizontal overflow; stat tiles collapse to two columns, nav to a menu button.
- Yelp end to end with the user's key: `/searches/new` shows the form, a 50-result San Diego plumbing search completed in 1 s with 1 API call (50 fetched, 45 qualified, 5 rejected); the businesses table and a Yelp detail page (score ring, "why this result", Yelp data, CRM form) render; Settings shows Yelp search "Configured".
- Trustpilot end to end with the user's Firecrawl key (local build): pasting a Trustpilot review URL in Lookup scraped the profile in about 25 s and produced a Trustpilot-sourced card (category, 7,051 reviews, velocity +2/30d, rating 1.7, website); the dossier showed TrustScore metrics, flags (`no_phone`, `low_rating`), last synced and external links; "Add to Lead List" created the lead, and `/leads` listed it as Queued with rating and L30D. Lookup also showed the 47 Yelp rows as bubbles, graph nodes and cards.
- Calling end to end: campaign created, 45 qualified businesses added, campaign started, dialer claimed the first business with N, outcome 1 (No answer) recorded and auto-next claimed #2 with phone, rating, attempt, notes and the eight outcome tiles.

## Keys and remaining setup
- `FIRECRAWL_API_KEY` set on Vercel 2026-11-09 (production, preview, development); production redeployed (dpl_AqcVPedDAVDP4PSXRRjGtErqy1gQ, READY). Hosted `/api/cron/daily` with the bearer now returns `sync:{scraped:0, failed:0, remaining:0}` instead of `skipped`.
1. Supabase Auth → URL Configuration: Site URL `https://local-business-crm-nicks-projects-2e9a7352.vercel.app`, redirect URL `https://local-business-crm-nicks-projects-2e9a7352.vercel.app/api/auth/callback`.
2. Optional: `RESEND_API_KEY` for real email delivery (dry run until then). `YELP_API_KEY` was set on 2026-11-09 (production, preview, development) and production redeployed (dpl_DHYKzN3H57XH2sGnnh5sDWPGype2, READY).
