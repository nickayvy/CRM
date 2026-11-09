# Leadwire v2 — Spec (pivot)

**Status:** approved by directive (user message 2026-11-08: "do a complete overhaul … copy the UI first and foremost … get rid of all the test data … voice agents later … scope pivots towards this new product"). PM proceeds without pausing; the user may redirect at any wave boundary.
**PM:** Fable 5.1
**Reference implementation:** `/Users/nick/Documents/projects/gtm` (the "Leadwire" Next.js app; read-only, available to every engineer). Inventory: `docs/team/v2/gtm-inventory.md`.
**Builds on:** the v1 CRM on `main` (spec in `docs/team/spec.md`).

## Goal

Turn the v1 CRM into **Leadwire** ("Turn market noise into signal."): a dark,
dense, signal-first prospecting product that discovers high-activity
businesses, shows them as a category-colored network graph plus a filterable
grid with an intel "dossier" per business, lets each signed-in user build a
personal lead list, and hands leads to the existing calling campaigns and
email sequences. The UI is a faithful port of the gtm repo's visual language
and screens, applied to every screen of this app. All fixture and demo data
is removed: the app starts empty and fills from real sources.

## Non-goals (v2)
- Voice agents: Bland AI calls, call webhooks, agent configuration, active-call
  widgets, call-history-from-AI. (Explicitly deferred by the user.) The manual
  dialer and call activities from v1 stay.
- Light theme (Leadwire is dark-only; we follow).
- Multi-tenant teams/roles. Auth is per user; businesses are shared; leads are
  per user; campaigns stay workspace-shared.
- Any bundled sample data, fixtures, or fake businesses. Tests build their own
  tiny records inline.

## Users and scenarios
- As a user, I sign up and sign in with email and password; everything I do
  (leads) is mine.
- As a list builder, I paste a Trustpilot business URL or seed a Trustpilot
  category and watch the network graph fill; I filter by category, review
  count, 30-day velocity, rating, and phone, and open a dossier for any
  business.
- As a list builder, I can still run a Yelp search (v1 pipeline) when a Yelp
  key is configured; Yelp businesses appear in the same lookup with the same
  qualification engine.
- As an SDR, I add a business to my lead list from the dossier or the card,
  work the Pipeline tab (status, notes, skip, remove, export CSV), and push
  selected leads into a calling campaign or an email sequence.
- As a manager, I see an overview of discovery yield, leads by status, calls,
  and emails.

## Functional requirements
R1. Visual language: Leadwire tokens (background #0a0a0a, surface #0f0f0f,
    elevated #141414, primary #5a8fc9, border #2a2a2a, muted-foreground
    #9ca3af), shadows `--shadow-elevated/floating/inset`, radius 0.625rem,
    fonts Space Grotesk (sans) + Source Serif 4 (display), `.main-depth`
    gradient, `.card-glow`, `.dossier-scroll`, `duration-300 ease-out`
    transitions, `tabular-nums`, uppercase micro-labels. Dark only.
R2. Shell: top bar only (no sidebar), 80 px, blurred `bg-background/80`;
    left brand (logo + "Leadwire" serif + tagline), center nav `LOOKUP ·
    LEADS · CALLING · EMAIL · OVERVIEW` (uppercase, icon + label, active
    `bg-muted/60`), right user menu (email, Settings, Sign out). `/` redirects
    to `/lookup`.
R3. Auth: Supabase Auth email+password. `/login`, `/signup` (Leadwire card
    style), `/api/auth/callback`; middleware redirects unauthenticated users
    to `/login` (exempt: `/login`, `/signup`, `/api/auth/*`, `/api/cron/*`);
    authenticated users on auth pages go to `/lookup`. The v1 shared-password
    gate is removed.
R4. Data model extensions: businesses gain `source` (yelp | trustpilot),
    `trustpilotId`, `slug`, `email`, `logoUrl`, `socialLinks`,
    `reviewsLast30d` (velocity), `trustScore`, `aiSummary`, `hasMetaAds`,
    `subcategory`, `lastScrapedAt`; new tables `business_relations`,
    `review_snapshots`, `leads` (per user). Yelp rows keep working.
R5. Trustpilot discovery via Firecrawl: scrape a business profile URL
    (fields, related slugs → relations, velocity via snapshots + rate method),
    scrape a category (22 top-level categories, 20/page, up to N), enrich from
    the business website (phone/email/socials), daily sync cron for stale
    rows, weekly category seed cron. Requires `FIRECRAWL_API_KEY`; without it
    the UI says so and does nothing fake.
R6. Qualification engine applies to Trustpilot rows too (rating, review
    count, chain name, phone, duplicate phone); distance rules are skipped
    when no distance exists. Velocity tiers are unified: HIGH ≥ 50/30d,
    MED ≥ 20, else LOW.
R7. Lookup page (`/lookup`): left 30 % panel "Business network" with category
    bubbles (top 8) and the d3 force graph (top 50 by reviews, colored by
    category, zoom/drag/hover tooltip, click → dossier); center grid of
    business cards (logo, name, category badge, reviews, L30D + velocity
    badge, rating, website) with pagination 50/page; right filter panel
    (search, category, min reviews slider, min L30D slider, min rating, has
    phone, Clear); top strip with the manual Trustpilot URL input and a
    "Seed category" select; dossier modal (header, overview, metrics box,
    "Add to Lead List", intel brief when present, external links grid,
    similar companies list that navigates in place). All filters in the URL.
R8. Leads page (`/leads`): metrics tiles (Leads, Queued, Success, Calls 7d),
    tabs Pipeline / History; Pipeline = lead queue table (filter tabs All /
    Queued / Called / Success / Failed, search, category select, select-all,
    bulk "Add to call campaign…" / "Add to email sequence…" / "Remove",
    Export CSV; columns phone, name, category, status badge, rating, L30D,
    notes (inline edit), actions skip/remove); History = call activities
    logged by the v1 dialer for this user's leads. Statuses: queued,
    contacted, callback, success, failed, skipped (mapped from dialer
    outcomes where applicable).
R9. Existing v1 screens (businesses table + detail, searches, calling,
    dialer, email, settings, overview) are restyled into the Leadwire
    language and composed under the new shell; their behaviour is unchanged.
R10. Test-data removal: delete `fixtures/`, Yelp fixture mode, the demo seed
    (campaigns, activities, enrollments, fake businesses); `npm run db:seed`
    only ensures the rules row; tests use inline builders. The Supabase
    production tables are truncated of demo rows at close-out.
R11. Zero fake content in the UI: no "Last synced: a day ago" placeholders
    (use real timestamps), no sample arrays.

## Acceptance criteria (spec level; per-package ACs in the WP files)
AC1  [WP-11] Clean clone: `npm ci && npm run db:migrate && npm run db:seed && npm test && npm run typecheck && npm run lint && npm run build` exit 0. `/` → `/lookup`; unauthenticated `/lookup` → `/login`; `/login` and `/signup` render the Leadwire card; after sign-in the top bar shows the five nav items and the user menu.
AC2  [WP-11] Tokens and fonts match the gtm `globals.css` (PM diffs the token blocks); `/design` renders every primitive in the new language with no console errors.
AC3  [WP-12] Migration adds the columns/tables in R4 and applies to PGlite and Supabase; `git ls-files fixtures | wc -l` = 0; `grep -r fixture src | wc -l` = 0; `db:seed` inserts only the rules row; all tests pass with inline builders.
AC4  [WP-13] With a fake Firecrawl client injected: scraping a profile upserts the business, writes a snapshot, computes velocity, creates relations to existing slugs; category scrape inserts basic rows; sync cron picks stale rows and chains; without `FIRECRAWL_API_KEY` the actions return a clear error.
AC5  [WP-14] `/lookup` renders bubbles, graph, grid, filters, and dossier from DB rows; filters round-trip through the URL; paste-URL and seed-category call the WP-13 actions; "Add to Lead List" creates a lead for the signed-in user.
AC6  [WP-15] `/leads` lists only the signed-in user's leads; status/notes edits persist; bulk add to a call campaign increases that campaign's queue; Export CSV downloads; History shows dialer call activities.
AC7  [WP-16] Every v1 route renders in the Leadwire language under the new shell with no horizontal overflow at 375 px; `/overview` shows the v1 dashboard restyled.
AC8  [PM] Production on Vercel runs with Supabase Auth; the demo rows are gone from Supabase; the live app signs a user in and shows an empty, working Lookup.

## Decisions made by the PM
- Product name and copy follow the gtm repo ("Leadwire"). Logo: copy `public/logo.png` from gtm.
- Dark-only, matching gtm; the v1 theme toggle is removed.
- Auth via Supabase Auth with `@supabase/ssr`; data access stays on Drizzle over `DATABASE_URL`, so per-user scoping is enforced in server code (`requireUser()`), not RLS.
- Leads are per user (`leads.user_id` = Supabase auth user id). Businesses, campaigns, and rules are shared.
- Leads is a real route (`/leads`), full width; the graph panel stays on `/lookup` only.
- Trustpilot is the primary discovery source; the Yelp pipeline remains as a secondary source behind `/searches` when a key is set.
- Velocity tiers unified at 50/20 (card thresholds in gtm), applied everywhere.
- Voice-agent code is not ported. Lead statuses that only AI calls produced are dropped; dialer outcomes map: interested → success, not_interested/wrong_number → failed, callback → callback, no_answer/voicemail/busy → contacted, do_not_call → skipped.
- Firecrawl and Yelp keys are user-supplied; the UI must say when a source is unconfigured.

## Open questions
None blocking. Needed from the user at close-out: `FIRECRAWL_API_KEY` (discovery), optionally `YELP_API_KEY`; the Supabase Auth Site URL/redirect for the Vercel domain (PM will set via the dashboard instructions or MCP if available).
