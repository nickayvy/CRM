# WP-12: Data model v2, leads/discovery repos, and test-data removal

**Wave:** 1 (v2)
**Depends on:** none (v1 main)
**Owns files:** `src/db/**`, `drizzle/**`, `fixtures/**` (delete), `src/lib/yelp/**`, `src/lib/qualify/**`, `src/lib/env.ts`, `src/lib/velocity.ts`, `src/lib/labels.ts`, `.env.example`, `scripts/**`, `src/features/ingest/**` (fixture-mode removal + source-aware qualify only), `src/app/searches/new/**` (remove the fixture notice only), `next.config.ts` (remove the fixtures tracing include), `tests/**` except `tests/primitives*`/`tests/shell*`
**Delivers:** branch `wp-12-data-v2` / PR "WP-12: Data model v2 and test-data removal"

## Objective
The database can hold Trustpilot and Yelp businesses, relations, review snapshots, and per-user leads; the repos for leads and discovery exist and are tested; every piece of bundled fake data is gone; the Yelp client is live-only; tests build their own records.

## Context the engineer needs
- Read `docs/team/v2/spec.md` (R4, R6, R10), `docs/team/v2/architecture.md` (§Data model delta, §Repos, §Env, §Cross-cutting tests), `docs/team/v2/gtm-inventory.md` (§Data), and the v1 `docs/team/architecture.md` §Qualification.
- Migration: generate `drizzle/0001_v2.sql` with `npm run db:generate`; it must apply on PGlite (tests) and on Supabase (the PM applies it; `yelp_id` becoming nullable must be an `ALTER COLUMN ... DROP NOT NULL`, not a table rebuild).
- WP-11 is simultaneously replacing the shell/auth and must not touch your files; you must not touch theirs. `src/app/searches/new/**` is yours for one edit only (delete the fixture notice and any `env.YELP_MODE` use).
- Dialer hook: `recordOutcome` in `src/db/repo/call-campaigns.ts` must call `syncLeadStatusFromOutcome` after writing the outcome (no-op when no leads reference the business).

## Scope
### In
- Schema + migration per architecture; exported types.
- `src/db/repo/leads.ts`, `src/db/repo/discovery.ts` per architecture; `BusinessFilter`/`BusinessSort` extensions in `src/db/repo/businesses.ts`; `src/lib/velocity.ts`.
- `src/lib/labels.ts`: `LEAD_STATUS_LABELS` (queued, contacted, callback, success, failed, skipped) with tones.
- Qualification: skip `category_mismatch` when `ctx.categoryAliases` is empty; `qualifyOne` passes `[]` for `source='trustpilot'`; `normalizeYelpBusiness` sets `source: 'yelp'`.
- Yelp: delete `src/lib/yelp/fixture.ts`; `createYelpClient` is live-only and throws `YelpUnavailable('YELP_API_KEY is not set')` on use when the key is missing; `startSearchAction` returns `{ ok:false, message }` in that case; CLI prints the same.
- Delete `fixtures/`, the `outputFileTracingIncludes` for fixtures and the `turbopackIgnore` comments that only existed for fixtures (keep `turbopack.root`).
- Seed: `seed(db)` only calls `getRules` (ensures the rules row) and returns `{ qualification_rules: 1 }`; `scripts/seed.ts` prints that. Remove every seeded campaign/activity/enrollment/business.
- Env: remove `APP_PASSWORD`, `APP_SESSION_SECRET`, `YELP_MODE`; add `FIRECRAWL_API_KEY?`, `NEXT_PUBLIC_APP_URL?`; `.env.example` rewritten (document `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` too, with the project URL and that the key is public).
- Tests: rewrite everything that depended on fixtures or the demo seed using `tests/helpers/builders.ts` (`makeYelpBusiness`, `makeBusinessRow`, `makeTrustpilotProfile`) and a fake `YelpClient` that serves builder output; keep the v1 qualification trap table alive as inline builder data (closed, chain, category mismatch, out of area, no phone, low rating, too few reviews, duplicate phone, multi-location across three cities). New tests: `tests/leads.test.ts`, `tests/discovery.test.ts`, `tests/velocity.test.ts`, `tests/migration.test.ts` (fresh PGlite applies both migrations; columns exist).
### Out
- Firecrawl code (WP-13). UI (WP-14/15/16). Shell/auth (WP-11).

## Acceptance criteria
AC-12.1 `git ls-files fixtures | wc -l` = 0; `grep -rn "fixture" src scripts | wc -l` = 0; `grep -rn "YELP_MODE\|APP_PASSWORD\|APP_SESSION_SECRET" src scripts .env.example | wc -l` = 0.
AC-12.2 `npm run db:seed` on an empty PGlite prints only `qualification_rules 1`; `select count(*)` is 0 for businesses, campaigns, activities, enrollments (test).
AC-12.3 `tests/migration.test.ts`: fresh DB → both migrations → `businesses.source` default `yelp`, `yelp_id` nullable, new columns and the three new tables exist; inserting a Trustpilot row without `yelpId` succeeds.
AC-12.4 Leads repo tests: `addLead` idempotent; `listLeads` scoped by user (user A never sees user B's leads); `updateLead` by another user returns null; `countLeadsByStatus`; `syncLeadStatusFromOutcome` maps every outcome per architecture and updates all users' leads on that business; `recordOutcome` triggers it (test through the dialer repo).
AC-12.5 Discovery repo tests: upsert by trustpilotId preserves CRM fields; relations deduplicate and `relatedBusinesses` is bidirectional; snapshots ordered; `listStaleBusinesses` returns null-first then oldest; `listGraphNodes` shape.
AC-12.6 Qualification tests: Trustpilot rows (no aliases) are never `category_mismatch`; the v1 trap table still yields 31/9 on 40 built records; `velocityTier(50)=HIGH, (20)=MED, (19)=LOW`.
AC-12.7 Yelp client without key: `createYelpClient()` → first `search` throws `YelpUnavailable`; `startSearchAction` returns `ok:false` with a clear message (tests).
AC-12.8 `npm test`, typecheck, lint, build exit 0; build prints no warnings.

## Delegation guidance
Juniors: builders + migrating the existing test files to them; `velocity.ts` + test; `.env.example`. Keep: schema/migration, repos, qualification change, seed.
