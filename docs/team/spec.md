# Local Business CRM — Spec

**Status:** approved by directive (user set the goal via /goal on 2026-11-07 and asked
the PM to proceed without pausing). The user may redirect at any wave boundary.
**PM:** Fable 5.1
**Source of the product idea:** https://origami.chat/products/local-business
(researched 2026-11-07; see "What Origami actually describes" below).

## Goal

A lead-generation CRM for selling to small local businesses. It pulls
businesses from the Yelp Fusion API by category and location, runs every
result through an explicit qualification engine that removes the false
positives Yelp's fuzzy search produces (closed businesses, chains, wrong
category, out-of-area, no phone, low signal, duplicates), stores the
qualified businesses in Supabase Postgres, and gives a sales team a fast UI
to browse businesses and their details, run concurrent calling campaigns
from isolated queues with safe multi-agent claiming and automatic
pause/resume, and run cold-email sequences. Everything is built from a
shared set of React design primitives and one animation system, deploys to
Vercel, and works end to end with seeded data on first run.

## What Origami actually describes (research summary)

Origami's page and blog describe a natural-language prospecting agent over
Google Maps and public registries. It does not describe a Yelp pipeline or
numeric rules. The false-positive criteria it names are: franchises and
corporate branches, closed or moved businesses, wrong-category fuzzy
matches, out-of-service-area results, generic inboxes, and low or stale
review signal (user-supplied thresholds such as "3.5+ stars", "at least 20
reviews", "in business 5+ years"). Its workflow is: build a list, refine,
enrich, then run multi-step sequences with delays, personalization tokens,
throttling, and auto-unenrollment on reply; calls are logged with notes and
labels. This spec turns those criteria into a deterministic, configurable
rule set applied to Yelp Fusion results, and turns the workflow into
calling and email campaigns with queues.

## Non-goals (v1)

- User accounts, roles, multi-tenant workspaces. One shared workspace behind
  an optional shared password (`APP_PASSWORD`). Agents identify themselves
  by typing a display name in the dialer.
- Telephony (no VoIP dialing; the dialer shows the number and the agent
  calls on their own phone/softphone). Click-to-call is a `tel:` link.
- Inbound email parsing, reply detection, open/click tracking. Replies are
  recorded manually ("Mark replied").
- Google Maps, license registries, or any source other than Yelp Fusion.
- Email address discovery. Yelp provides no emails; owner name and email are
  entered or imported manually. Email campaigns only enroll businesses that
  have an email.
- Custom pipelines or custom fields. Statuses and outcomes are fixed enums.
- CSV import/export (deferred; the data model does not block it).
- Browser end-to-end test suite. Verification is Vitest against embedded
  Postgres plus a passing production build; the PM checks UI criteria in a
  browser.

## Users and scenarios

- As a list builder, I run a search ("plumbing in Houston, TX, 20 km") and
  get a table of qualified businesses with the reason each rejected one was
  rejected, so that I trust the list before anyone calls it.
- As a list builder, I tune the qualification rules (minimum rating, review
  count, chain list) and re-qualify everything, so the list matches our ICP.
- As a sales rep, I open a business and see everything: Yelp data, hours,
  photos, score, why it qualified, CRM status, owner contact, and the full
  history of notes, calls, and emails.
- As a call-center agent, I pick a running campaign, press Next, and get the
  next business nobody else is working, with the script and one-key outcome
  buttons, so I can make 60+ calls an hour without touching a mouse.
- As a call-center manager, I run several campaigns at once, each with its
  own queue, daily cap, calling hours, and agent limit; campaigns pause
  themselves outside hours or at cap and resume on their own.
- As an SDR, I enroll businesses with emails into a 3-step sequence with
  delays and tokens; it sends on schedule, respects a daily cap, and stops
  when I mark a reply.
- As a manager, I open the dashboard to see qualification yield, calls and
  outcomes today, running campaigns, email volume, and overdue callbacks.

## Functional requirements

R1. Yelp ingestion: a search job has term, location (free text), target
    category alias(es), radius (m, ≤ 40000), max results (≤ 1000). It pages
    through Yelp Fusion `/v3/businesses/search` and upserts every business
    by Yelp id. With no API key it runs against bundled fixtures so the app
    is fully usable offline.
R2. Qualification engine: every ingested business gets `qualification`
    (qualified | review | rejected), an integer `score` 0–100, and a list of
    reason codes. Rules are stored in the database and editable in the UI.
    Rejection codes: `closed`, `category_mismatch`, `chain`,
    `multi_location`, `no_phone`, `out_of_area`, `low_rating`,
    `too_few_reviews`, `too_many_reviews`, `duplicate_phone`. Soft flags:
    `unclaimed`, `low_score`. Exact rules are in architecture.md §Qualification.
R3. Re-qualify: one action re-runs the engine over all businesses with the
    current rules, without re-fetching from Yelp.
R4. Enrichment: per business, fetch `/v3/businesses/{id}` for hours, photos,
    and claimed status; re-score afterwards.
R5. Businesses UI: filterable, sortable table (qualification, CRM status,
    city, category, score, text search), bulk selection, detail page with
    all data, editable CRM fields (status, owner name/email, tags, notes,
    do-not-call, do-not-email), activity timeline with note form, enrich
    button, and "why rejected" explanation.
R6. Searches UI: create a search job, watch progress (fetched / qualified /
    rejected / API calls), open results filtered to that job.
R7. Rules UI: edit every rule and the chain pattern list; re-qualify all.
R8. Call campaigns: create with name, script (markdown with tokens), daily
    cap, calling hours window + timezone, max concurrent agents; add
    businesses by filter or selection (qualified, has phone, not do-not-call,
    not already in the campaign); queue is ordered; pause/resume manually.
R9. Dialer: agent enters a display name once; "Next" atomically claims the
    next available item for that campaign (pending, expired lease, or due
    callback) with a 10-minute lease; shows business card, script with
    tokens filled, notes field, outcome buttons with keyboard shortcuts;
    outcomes: no_answer, voicemail, busy, interested, not_interested,
    callback (with datetime), wrong_number, do_not_call; each outcome logs a
    call activity and updates business status per architecture.md.
R10. Campaign automation: a campaign auto-pauses with reason `daily_cap`,
    `outside_hours`, or `exhausted`, and auto-resumes when the cap or hours
    condition clears (never from a manual pause). Evaluated before every
    claim, on campaign page load, and by a cron endpoint.
R11. Concurrency: several campaigns run at once with isolated queues; several
    agents work one campaign without ever receiving the same item; agent
    limit enforced; `do_not_call` removes the business from every campaign's
    pending items.
R12. Email campaigns: ordered steps (subject, body with tokens, delay days),
    daily cap, from name/address; enroll businesses with emails; a runner
    sends due steps through Resend when configured, otherwise records a
    dry-run message; manual "Mark replied" / "Unsubscribe" unenrolls;
    pause/resume; message log.
R13. Dashboard: stat cards (businesses total/qualified, calls today, interest
    rate 7d, emails sent today, running campaigns, overdue callbacks),
    rejection-reason breakdown, calls by outcome (7 days), CRM status
    funnel, running campaigns panel, recent activity.
R14. Global search (Cmd/Ctrl+K): businesses by name/phone/city, campaigns
    by name, and navigation to pages.
R15. Design system: all pages are composed from `src/components/primitives`
    (PageShell, PageHeader, StatCard, DataTable, FilterBar, StatusBadge,
    EmptyState, SidePanel, KeyValueList, Timeline, Toolbar) and
    `src/lib/motion` (tokens, variants, FadeIn, AnimatedList,
    PageTransition, AnimatedNumber), with reduced-motion support and dark
    mode. A `/design` route showcases every primitive.
R16. Responsive: every page usable at 375 px with no horizontal scroll.
R17. Zero-config local run with embedded Postgres (PGlite); Supabase Postgres
    when `DATABASE_URL` is set; identical schema and migrations.
R18. Deployable to Vercel: production build passes, cron routes declared,
    env documented in `.env.example` and README.

## Acceptance criteria

Package in brackets. Full per-package lists (with proofs) are in each
work-package file; these are the spec-level ones the PM walks at the end.

AC1  [WP-01] Clean clone, no env: `npm install`, `npm run db:migrate`,
     `npm run db:seed`, `npm test`, `npm run typecheck`, `npm run lint`,
     `npm run build` all exit 0.
AC2  [WP-01] `npm run dev`: `/`, `/businesses`, `/searches`, `/calling`,
     `/email`, `/settings`, `/design` return 200 with the shared shell.
     With `APP_PASSWORD` set, those routes redirect to `/login` until the
     password is entered.
AC3  [WP-01] `createTestDb()` gives an empty migrated DB; `seed(db)` fills
     every table; seeding twice is idempotent (same counts).
AC4  [WP-02] `/design` renders every primitive and motion component with
     sample data, in light and dark mode, with no console errors; with
     `prefers-reduced-motion`, no transform/opacity animations run.
AC5  [WP-03] Ingesting fixture `plumbing-houston` into an empty DB produces
     exactly the outcomes in architecture.md §Fixture traps (repo test).
AC6  [WP-03] Score function matches the worked examples in architecture.md
     §Score (unit test), and `requalifyAll` after changing `min_rating` to
     4.5 rejects the businesses rated below it.
AC7  [WP-03] Yelp client: pages with `limit=50`, stops at `max_results`,
     retries 429 three times with backoff, never exceeds offset 1000, and
     records `api_calls` on the job (unit tests with a mocked fetch).
AC8  [WP-04] `/businesses` filters by qualification, status, city, score,
     and `q`; sorting works; rows open the detail page; detail page shows
     score, reasons in plain English, Yelp fields, hours, photos; CRM edits
     persist; note form adds a timeline entry; Enrich updates hours/claimed.
AC9  [WP-04] `/searches/new` runs a fixture search and the job page shows
     live counts until `completed`; `/settings/rules` saves rules and
     "Re-qualify all" changes qualification counts accordingly.
AC10 [WP-05] Repo test: two sequential `claimNext` calls for different
     agents return different items; a claimed item whose lease expired is
     returned by the next claim; `recordOutcome('do_not_call')` removes the
     business from a second campaign's pending items; `evaluateCampaign`
     pauses at daily cap and outside hours, resumes when clear, and never
     resumes a manual pause.
AC11 [WP-05] Dialer in the browser: Next claims and displays a business;
     pressing `3` records `busy` and advances; callback with a datetime
     puts the item into `callback` state; the campaign page shows updated
     counts; a paused campaign's dialer shows the pause reason and no Next.
AC12 [WP-06] Repo test: `processDueSends` sends step 1 immediately for new
     enrollments, schedules step 2 at `delay_days`, respects `daily_cap`,
     renders tokens, uses the dry-run sender without `RESEND_API_KEY`,
     and skips replied/unsubscribed/do-not-email businesses.
AC13 [WP-06] Email UI: create a 3-step campaign, enroll seeded businesses
     with emails, "Process now" produces dry-run messages visible in the
     log; "Mark replied" moves the enrollment to `replied`.
AC14 [WP-07] Dashboard numbers equal values computed from the seed in a
     repo test; Cmd/Ctrl+K finds a seeded business by name and phone and a
     campaign by name; bulk "Add to campaign" from the businesses table
     adds selected rows to a chosen call or email campaign.
AC15 [all UI] At 375 px every package's pages have no horizontal scroll.
AC16 [WP-07] `vercel.json` declares both cron routes; README documents
     env, Supabase setup, and deploy; `npm run build` passes on main with
     `DATABASE_URL` pointing at Supabase and migrations applied there.

## Decisions made by the PM

- Yelp Fusion is the only source (user's explicit framing); fixture mode
  keeps everything testable without a key. Yelp key is a user-supplied env.
- Supabase is used as Postgres via Drizzle ORM over the connection string.
  Supabase Auth/RLS/Realtime are not used in v1 (no auth in scope).
- PGlite for tests and keyless local dev; same migrations as production.
- Next.js (latest stable, App Router), React Server Components for reads,
  Server Actions for writes, TypeScript strict, Tailwind v4, shadcn/ui,
  `motion` (framer-motion v12) for the animation system.
- "Concurrent campaigns with isolated queue runners": investigated and
  included. The claim path is a single `UPDATE … WHERE id = (SELECT … FOR
  UPDATE SKIP LOCKED)` so it is safe across agents and function instances
  with no coordinator process. Pause/resume is rule-evaluated, not timer
  driven, so it works on serverless. Rationale in architecture.md.
- Email sending via Resend when `RESEND_API_KEY` exists, dry-run otherwise.
- Vercel crons are declared, with the caveat that the Hobby plan runs them
  at most daily; the app does not depend on them (evaluation also runs on
  access and via a manual "Process now").
- The "60+ production files" and "redesign" language in the goal is read as:
  build the UI from reusable primitives and one animation system from day
  one; there is no legacy UI to redesign in a greenfield repo.
- No GitHub PRs unless a remote exists when a wave is spawned; otherwise
  seniors deliver local branches and the PM merges.

## Open questions

None blocking. Needed from the user before production use: `YELP_API_KEY`
(ingestion), optionally `RESEND_API_KEY` (real email), a Vercel login or
MCP authorization (deploy).
