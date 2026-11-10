# WP-18: Google Places core (client, plan, normalise, storage, runner, duplicate flags, CLI)

**Wave:** 1
**Depends on:** none (current `main`, 1052 tests green)
**Owns files:**
- `src/lib/google-places/**` (new)
- `src/lib/domain.ts` (new)
- `src/lib/env.ts`
- `src/lib/qualify/index.ts`
- `src/features/ingest/context.ts`
- `src/features/google/run.ts` (new; nothing else in `src/features/google/`)
- `src/db/schema.ts`, `drizzle/0005_*.sql`, `drizzle/meta/*`
- `src/db/repo/google.ts` (new), `src/db/repo/search-jobs.ts`
- `scripts/google-search.ts` (new), `package.json` / `package-lock.json`
- `tests/google-*.test.ts` (new), `tests/helpers/fake-places.ts` (new),
  `tests/domain.test.ts` (new), and existing tests for the files above
  (`tests/qualify*.test.ts`, `tests/ingest*.test.ts`, `tests/migration.test.ts`,
  `tests/search-jobs.test.ts`, `tests/helpers/builders.ts`)

**Do not edit:** `src/lib/firecrawl/**`, `src/db/repo/discovery.ts`,
`src/features/discovery/**`, `src/app/**`, `src/components/**`,
`src/features/searches/**`, `src/features/lookup/**`, `scripts/enrich-links.ts`
(WP-19 and WP-20 own them). You may import from them.

**Delivers:** branch `wp-18-google-places-core`

## Objective
Everything needed to pull local businesses from Google's Places API (New) into
the `businesses` table from code and from a terminal: a typed client, a plan
builder (niches × zip codes with cost), a normaliser, storage with cross-source
matching and a monthly spend cap, a resumable job runner, and two new
qualification reasons for rows that share a website or an email. No UI.

## Context the engineer needs
- Stack: Next.js 16.4.5 (read `AGENTS.md` first), React 19, TypeScript,
  Drizzle ORM over Postgres (prod) or PGlite (tests and local), Vitest, zod.
- Node 24: `export PATH=/opt/node24/bin:$PATH`. Install `npm ci`. Test
  `npm test`. Typecheck `npm run typecheck`. Lint `npm run lint`. Build
  `npm run build`. Migration: edit `src/db/schema.ts`, then `npm run db:generate`.
- Frozen interfaces: `docs/team/google/architecture.md` sections Data model
  and Interfaces (Environment, Places client, Plan, Normalise, Storage, Runner,
  Duplicate flags, CLI). Build exactly those signatures; WP-20 codes against
  them without seeing your branch.
- Patterns to copy:
  - `src/lib/yelp/client.ts` + `tests/helpers/fake-yelp.ts`: injectable client
    with a call counter and a fake.
  - `src/lib/yelp/normalize.ts`: record → `NewBusiness`.
  - `src/db/repo/businesses.ts` `upsertBusinessByYelpId` and
    `src/db/repo/discovery.ts` `upsertBusinessByTrustpilotId`: upsert that
    never writes `CRM_FIELDS`.
  - `src/features/ingest/run.ts` `runSearchJob` / `qualifyOne`: job counters
    and qualification per row.
  - `src/features/ingest/context.ts` `hasEarlierPhoneDuplicate`: the
    "earlier-ingested row wins" SQL; `buildContext` and `buildContextIndex`
    (the bulk path used by `requalifyAll`) must both learn the two new flags.
  - `src/lib/firecrawl/external-links.ts` `cleanWebsiteUrl`, `src/lib/format.ts`
    `normalizeName` / `phoneDigits`, `src/lib/trustpilot-categories.ts` (the 22
    slugs), `src/lib/firecrawl/trustpilot.ts` `addSnapshot` use and
    `computeVelocity`.
- Google contract (from memory; the docs site was unreachable from the PM's
  session, so treat the live probe as the authority):
  - `POST https://places.googleapis.com/v1/places:searchText`, JSON body
    `{ textQuery, pageSize: 20, pageToken?, locationBias: { circle: { center:
    { latitude, longitude }, radius } }, regionCode }`.
  - Headers `X-Goog-Api-Key`, `X-Goog-FieldMask` (comma-separated
    `places.<field>` plus `nextPageToken`), `Content-Type: application/json`.
  - Up to 20 places a page, 3 pages a query; `nextPageToken` absent on the
    last page. Pages can repeat a place.
  - Errors are `{ error: { code, message, status } }`: 400 `INVALID_ARGUMENT`,
    403 `PERMISSION_DENIED` (bad key, API not enabled, key restriction,
    billing), 429 `RESOURCE_EXHAUSTED`.
- **Live key.** `GOOGLE_PLACES_API_KEY` may or may not be present in your
  shell. If `curl -sS -X POST https://places.googleapis.com/v1/places:searchText
  -H "X-Goog-Api-Key: placeholder" -H "X-Goog-FieldMask: places.id" -H
  "Content-Type: application/json" -d '{"textQuery":"roofer 75201"}'` returns
  places, the session proxy is injecting a real key: run the probe, save one
  trimmed real place as a test fixture, and adjust the mapping to what Google
  actually returns. If it returns an auth error, build to the contract above
  and say "not verified live" in the report. Never print or commit a key.

## Scope
### In
1. **Schema + migration 0005** exactly as in the architecture Data model:
   `google` enum value, three `businesses` columns with their indexes, six
   `search_jobs` columns, `api_usage`. Must apply on PGlite and on Postgres 17
   on top of the five existing migrations with existing rows present.
   `ALTER TYPE … ADD VALUE` must not be used in the same transaction as the
   new value.
2. **Env**: the three variables.
3. **Client** with typed errors and a fake (`tests/helpers/fake-places.ts`)
   that pages a result list per query and can be told to fail.
4. **Niches**: at least 20, each with 2 to 5 terms and `acceptTypes`, covering
   the article's groups: trades (roofing, plumbing, HVAC, landscaping,
   electrical, pest control, cleaning), health (dentist, chiropractor, med
   spa, veterinary), food (restaurant, coffee shop, bakery), fitness (gym,
   yoga/pilates studio, martial arts), services (law firm, accountant, real
   estate office, auto repair, hair salon/barber).
5. **Zips**: offline dataset (zip → centre, city, state); `resolveArea` for
   `"75201, 75202"`, `"75201 75202"`, `"Dallas, TX"` and `"75201 +10mi"`;
   geocode fallback through an injected function; a geocoder for that
   function using the Geocoding API
   (`GET https://maps.googleapis.com/maps/api/geocode/json?address=…&key=…`,
   the one Google endpoint that takes the key as a query parameter; do not
   log the URL) counted under provider `google_geocoding`. The dataset must
   never be imported by client components.
6. **Plan** with the limits and cost arithmetic.
7. **Normalise**: `normalizeGooglePlace` to the row contract in the
   architecture; `cleanBusinessName`; `categoryForTypes` with a table covering
   Google's place types that a local-business search returns (restaurants and
   food, health, beauty, home services and contractors, automotive, fitness,
   legal, finance, education, lodging, pets, retail) plus keyword rules on the
   type string as a fallback.
8. **Storage**: `upsertGooglePlace` (three outcomes), `reserveUsage`,
   `getUsage`, `createGoogleJob`, `listUnfinishedGoogleJobs`, lease helpers.
   Matching order for a place with no existing place-id row: `phoneDigits`
   (non-null) on a non-Google row with no place id, then `websiteDomain`
   (non-null, not a shared host) likewise. Ties: oldest row.
9. **Runner** `runGoogleJobSlice` to the documented outcomes. One request =
   one `reserveUsage` call before it is sent.
10. **Duplicate flags**: `websiteDomain`, `isSharedHost`, the two reasons in
    the engine with labels ("Shares a website with another business", "Shares
    an email address with another business"), context flags in both the
    per-row and the bulk path. Also make the three existing labels that say
    "Yelp" source-neutral ("Marked permanently closed", "Page not claimed by
    the owner", …) since Google rows now show them.
11. **Review snapshot** per sync, at most one per business per 24 h; set
    `reviewsLast30d` from the snapshots when at least one older snapshot
    exists (reuse or mirror `computeVelocity`), else leave it.
12. **CLI** `scripts/google-search.ts` + `npm run google:search` with
    `--niche`, `--terms`, `--area`, `--max-pages`, `--dry-run`, `--probe`,
    `--resume`. It loops slices until the job completes, pauses or fails, and
    prints one line per search. `--dry-run` and a missing key make no request.

### Out
- Server actions, pages, components, cron (WP-20).
- Link enrichment and the pending-links filter (WP-19).
- Review text, Place Details, opening hours, photos.

## Interfaces
### Consumes
Existing: `Db`, `NewBusiness`, `qualifyOne`, `normalizeName`, `phoneDigits`,
`cleanWebsiteUrl`, `addSnapshot`, `listSnapshots`, `TRUSTPILOT_CATEGORIES`.
### Produces
Everything under "Interfaces" in the architecture for WP-18, verbatim.

## Acceptance criteria
AC-18.1 Migration: `npm test -- migration` passes; a test applies 0000–0005 to
  a database that already holds a Yelp row, a Trustpilot row and a Yelp search
  job, and those rows read back unchanged with `source` `yelp`/`trustpilot`,
  job `source = 'yelp'`, `website_domain` populated from `website`.
AC-18.2 Not configured: with no key, `createPlacesClient` is never constructed
  by the CLI (`--dry-run` and a keyless run print the plan or the
  not-configured message and exit non-zero for the latter); test proves zero
  fetch calls.
AC-18.3 Client: a test with a stub `fetch` asserts URL, method, the two
  headers, the body shape (`textQuery`, `pageSize`, `pageToken`,
  `locationBias.circle`), that the mask has no `reviews`/`editorialSummary`,
  that a 403 body maps to `GooglePlacesError{ fatal: true, status:
  "PERMISSION_DENIED" }` and a 429 to `GoogleRateLimited`, and that the key
  appears in no thrown message.
AC-18.4 Plan: `planGoogleSearch({ nicheId: "roofing", area: "75201, 75202" })`
  → 2 zips, the niche's terms, `queries = terms × 2`, `maxRequests = queries ×
  3`, `estMaxUsd = maxRequests × 0.035`; `"Dallas, TX"` → more than 20 zips,
  label `Dallas, TX`; `"75201 +5mi"` includes 75201 and at least 5 others; 201
  zips and 501 searches each throw `PlanError`; unknown text with no geocoder
  throws `AreaError`; with a fake geocoder it resolves.
AC-18.5 Name cleaning: a table of at least 25 cases, including
  `"BEST ROOFING DALLAS TX - Free Estimates"` → `"Best Roofing"`,
  `"Joe's Plumbing | 24/7 Emergency Service"` → `"Joe's Plumbing"`,
  `"ABC HVAC"` → `"ABC HVAC"` (acronyms kept), `"McDonald Roofing LLC"`
  unchanged, a name that is only a location or tagline falls back to the raw
  name, never returns an empty string.
AC-18.6 Normalise: a fixture place maps to every column in the row contract;
  `CLOSED_PERMANENTLY` → `isClosed`; a place with no website has `slug` null;
  `categories[0].alias` is the top-level slug and the Google types follow.
AC-18.7 Categories: at least 60 Google types map to the expected slug in a
  table test (`roofing_contractor` → `home_services`, `dentist` →
  `health_medical`, `veterinary_care` → `animals_pets`, `hair_salon` →
  `beauty_wellbeing`, `car_repair` → `vehicles_transportation`, `restaurant` →
  `restaurants_bars`, `gym` → `sports`, `lawyer` →
  `legal_services_government`, `accounting` → `money_insurance`); an unknown
  type returns null.
AC-18.8 Dedupe: the same place upserted twice → one row, second outcome
  `updated`; a place whose phone equals an existing Trustpilot row's →
  `matched`, no new row, that row has `googlePlaceId` and keeps its `source`,
  `name`, `rating`; same for a domain match; a `facebook.com` website matches
  nothing; CRM fields set on the existing row survive every outcome.
AC-18.9 Runner, resumable: a job of 6 searches, each taking a controlled 100
  ms on an injected clock, with a budget that fits 2 → three slices return
  `more`, `more`, `completed`; every `(term, zip)` was requested exactly once;
  `queriesDone` is 2, 4, 6. A slice started while the lease is held returns
  `busy` and sends nothing.
AC-18.10 Runner, cap: cap 5 → the sixth request is never sent, outcome
  `capped`, status `running`, `error` names the cap; with cap 100 the next
  slice resumes at the same search and completes; `getUsage` equals requests
  sent.
AC-18.11 Runner, errors: a fatal error → `failed` with the message and no key
  in it; a 429 → `rate_limited`, `queriesDone` unchanged; a search that fails
  twice with a 500 is recorded in `plan.errors` and the job continues; a
  search filling 3 pages is in `plan.saturated`.
AC-18.12 Qualification: in a `roofing` job a `hardware_store` place is
  rejected with `category_mismatch`; a closed one with `closed`; two Google
  rows on one domain → the later has `duplicate_website`, the earlier does
  not; setting an earlier row's email on a later row and calling `qualifyOne`
  → `duplicate_email`; `requalifyAll` gives the same verdicts as `qualifyOne`
  for these rows.
AC-18.13 Snapshots: syncing the same place twice inside 24 h stores one
  snapshot; 31 days apart stores two and sets `reviewsLast30d` to the
  difference.
AC-18.14 CLI: `npm run google:search -- --niche roofing --area "75201,75202"
  --dry-run` prints terms, zips, searches, max requests and estimated cost and
  exits 0 with no network call (paste the output in the report).
AC-18.15 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` exit
  0. Paste the test count.
AC-18.16 Live probe (only if the key is available to you): paste the output of
  `--probe "roofer 75201"` (names, phones, websites, types; no key).

## Delegation guidance
Good junior tasks: the name-cleaning table and function (AC-18.5), the
type → category table (AC-18.7), the niche list, the zip dataset wiring and
`resolveArea` tests, the fake Places client, the CLI argument parsing.
Keep: the migration, `upsertGooglePlace` matching, the runner (lease, cap,
resume), the qualify-context SQL.

## Reporting
Use the completion-report format from the senior brief. Under "Needs PM
decision" list any place the real API differed from the frozen interface.
