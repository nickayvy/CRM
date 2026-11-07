# WP-03: Yelp ingestion and qualification engine

**Wave:** 2
**Depends on:** WP-01 (merged)
**Owns files:** `src/lib/yelp/**`, `src/lib/qualify/**`, `src/db/repo/businesses.ts`, `src/db/repo/search-jobs.ts`, `src/features/ingest/**`, `scripts/ingest.ts`, `src/db/seed.ts` (ownership transfers from WP-01: make the seed run the real engine), `fixtures/**` (fix values only if the trap table is impossible to satisfy; report any change), `tests/yelp*.test.ts`, `tests/qualify*.test.ts`, `tests/businesses*.test.ts`, `tests/ingest*.test.ts`, `tests/search-jobs*.test.ts`
**Delivers:** branch `wp-03-ingestion` / PR "WP-03: Ingestion and qualification"

## Objective
Businesses flow from Yelp Fusion (or fixtures) into the database, every
one scored and labeled by a deterministic, rule-driven engine that removes
Yelp's false positives, with re-qualification and enrichment. No UI in this
package; everything is exercised by tests, the CLI, and server actions
that WP-04 will call.

## Context the engineer needs
- Stack: see WP-01 README. Test `npm test`, typecheck, lint, build.
- Read architecture §Interfaces (`src/lib/yelp/*`, `src/lib/qualify/*`,
  `src/db/repo/businesses.ts`, `src/db/repo/search-jobs.ts`,
  `src/features/ingest/run.ts`), §Qualification (rules, order, score
  formula with worked examples, chain patterns), §Fixture traps.
- Yelp Fusion v3: `GET https://api.yelp.com/v3/businesses/search`
  (`location`, `term`, `categories`, `radius` ≤ 40000, `limit` ≤ 50,
  `offset`; `offset + limit` must not exceed 1000), `GET
  /v3/businesses/{id}`; header `Authorization: Bearer <YELP_API_KEY>`.
  Never call the live API in tests; inject `fetch`.
- `upsertBusinessByYelpId` must never overwrite CRM fields.
- The seed currently inserts fixture businesses unqualified. Change it to
  run `qualifyOne` for every business after insert (through the same code
  path as ingestion, with `ctx` built from the DB), in fixture order
  (`plumbing-houston`, then `hvac-dallas`, then `dentists-austin`), and
  then `requalifyAll` once, so the seeded DB reflects the engine. Keep the
  rest of the seed (campaigns, activities, enrollments) intact. Update
  the search_jobs seed rows' counts from the real results.

## Scope
### In
- Yelp types, live client (retry/backoff/budget, `callCount`), fixture
  adapter (slug rule in architecture), `searchAll` generator, `normalizeYelpBusiness`.
- Qualification engine per §Qualification, `REASON_LABELS` in plain English
  (e.g. `chain: "Matches a known chain or franchise name"`).
- Repos: businesses (full filter/sort/paging/count API), search jobs.
- `runSearchJob` (pages, upserts, qualifies each business with a fresh
  `QualifyContext`: `sameNameCityCount` via a count of distinct `(city,state)`
  for the same `nameNormalized` including the current row; `phoneDuplicate`
  via another row with the same `phoneDigits` and a different `yelpId`),
  `enrichBusiness`, `requalifyAll` (loads rules once, batches context
  lookups), `qualifyOne`.
- Server actions in `src/features/ingest/actions.ts`:
  `startSearchAction(prev, formData)` (validates with zod: location
  required, categoryAliases required comma-separated, radius 500–40000,
  maxResults 1–1000; creates the job; runs `runSearchJob` via `after()`
  from `next/server` so the response returns at once; returns `{ ok, data: { jobId } }`),
  `enrichAction(businessId)`, `requalifyAllAction()`, `updateRulesAction(prev, formData)`.
- CLI `scripts/ingest.ts`: `npm run ingest -- --location "Houston, TX" --categories plumbing --radius 20000 --max 200 [--term plumber]`, prints progress and the final counts.
### Out
- Pages and forms (WP-04). Campaign logic (WP-05/06).

## Interfaces
### Consumes
`getDb`, `createTestDb`, schema types, `getRules`, `logActivity`, `normalizeName`, `phoneDigits`, `env`.
### Produces
Exactly the signatures in architecture §Interfaces for your files. WP-04
builds its pages against `listBusinesses`, `getBusiness`,
`updateBusinessCrm`, `countBy*`, `listCities`, `listCategories`, search-job
repo, and the four server actions. WP-05/06 use `listBusinesses`,
`listBusinessIds`, `getBusiness`, `updateBusinessCrm`. WP-07 uses the
counts.

## Acceptance criteria
AC-03.1 `tests/qualify.test.ts`: the four worked score examples in architecture §Score produce 95, 63, 15, 100; every rule in §Rule order has a positive and a negative case; `isChain` matches case-insensitively; a `review` outcome is produced when `reviewScoreBelow` is raised above a qualified business's score.
AC-03.2 `tests/ingest.test.ts`: fixture-mode `runSearchJob` for `plumbing-houston` into an empty test DB yields qualified 31 / review 0 / rejected 9 with the per-reason counts and per-name outcomes from the §Fixture traps table (assert each named business's `qualification` and `rejectionReasons`), `fetchedCount` 40, `apiCalls` 1 (one page of 50 covers 40).
AC-03.3 Multi-location: after ingesting all three fixtures then `requalifyAll`, every "ABC Plumbing" row has `multi_location` in its reasons; after only `plumbing-houston`, it does not.
AC-03.4 `tests/yelp.test.ts` with an injected fake `fetch`: `searchAll` requests `limit=50` pages with increasing `offset`, stops at `maxResults`, never requests `offset > 950`, retries a 429 three times with backoff then throws `YelpApiError`, does not retry a 400; `callCount` matches the requests made.
AC-03.5 `upsertBusinessByYelpId` twice with changed Yelp fields updates them but leaves `status`, `ownerEmail`, `notes`, `tags`, `doNotCall` untouched (test).
AC-03.6 `listBusinesses` filters: `q` matches name (case-insensitive, partial) and phone digits; `qualification`, `status`, `city`, `minScore`, `hasPhone`, `hasEmail`, `excludeDoNotCall`, `sourceJobId`, `ids`; sorting by `score desc` and `name asc`; `total` ignores paging (test).
AC-03.7 `requalifyAll` after `updateRules({ minRating: 4.5 })` rejects every business rated below 4.5 with `low_rating` and the counts returned equal `countByQualification` (test).
AC-03.8 `enrichBusiness` on a business with a `business-<id>.json` fixture sets `hours`, `photos`, `isClaimed`, `enrichedAt`, and re-scores (an `is_claimed:false` fixture lowers the score by 10 and adds `unclaimed`).
AC-03.9 `npm run db:seed` output now shows qualification counts; `npm run ingest -- --location "Dallas, TX" --categories hvac` in fixture mode completes and prints counts; `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Good junior tasks: `tests/yelp.test.ts` once the client exists; the
businesses-repo filter tests; the CLI; `REASON_LABELS` wording; fixture
detail files if more are needed. Keep: engine, context building,
`runSearchJob`, seed changes, actions.

## Reporting
Use the completion-report format from the senior brief. List any fixture
value you had to change under "Needs PM decision".
