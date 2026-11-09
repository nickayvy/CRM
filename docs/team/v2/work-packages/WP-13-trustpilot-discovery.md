# WP-13: Trustpilot discovery via Firecrawl

**Wave:** 2 (v2)
**Depends on:** WP-11, WP-12 (merged)
**Owns files:** `src/lib/firecrawl/**`, `src/lib/trustpilot-categories.ts`, `src/features/discovery/**`, `src/app/api/cron/daily/**`, `vercel.json`, `tests/firecrawl*.test.ts`, `tests/discovery-*.test.ts`, `tests/helpers/fake-firecrawl.ts`, `package.json`/lockfile (`@mendable/firecrawl-js`)
**Delivers:** branch `wp-13-discovery` / PR "WP-13: Trustpilot discovery"

## Objective
Port gtm's Firecrawl/Trustpilot pipeline onto our Drizzle repos: scrape a profile URL, scrape a category, enrich from the website, compute velocity from snapshots, build relations, run the daily sync, and expose server actions and a single daily cron. No fake data: without `FIRECRAWL_API_KEY` every entry point fails clearly.

## Context the engineer needs
- Read `docs/team/v2/architecture.md` §Discovery and §Repos, `docs/team/v2/gtm-inventory.md` §Firecrawl and §Data (velocity), then gtm `lib/firecrawl/*.ts`, `lib/constants.ts`, `app/api/businesses/scrape|seed|enrich/route.ts`, `app/api/cron/*`.
- Firecrawl v2 SDK: `new Firecrawl({ apiKey })`, `fc.scrape(url, { formats: [{ type: 'json', schema }] })` → `result.json`. Wrap it behind `FirecrawlLike` so tests inject a fake (`tests/helpers/fake-firecrawl.ts` returns builder profiles keyed by URL).
- Hobby plan allows few cron jobs; `vercel.json` must declare exactly one cron `/api/cron/daily` at `0 13 * * *`; the v1 routes stay.
- Rate limits: 1 concurrent, 1.5 s between Firecrawl calls (gtm's limiter).

## Scope
### In
- `client.ts` (`createFirecrawl`, `DiscoveryUnavailable`), `rate-limiter.ts`, `trustpilot.ts` (`slugFromTrustpilotUrl`, `computeVelocity`, `scrapeTrustpilotBusiness`, `scrapeTrustpilotCategory`, `enrichFromWebsite`, `syncStale`), `src/lib/trustpilot-categories.ts`.
- Mapping into our row: `name`=displayName, `nameNormalized`, `phone`/`phoneDigits`, `website`, `email`, `city`/`country`, `primaryCategory`=categories[0], `subcategory`=categories[1], `categories`=[{alias: slugified, title}], `rating`=stars, `reviewCount`=numberOfReviews, `trustScore`, `socialLinks`, `logoUrl` (gstatic favicon by slug), `slug`, `trustpilotId`, `source:'trustpilot'`, `raw` (full profile), `lastScrapedAt=now`, `reviewsLast30d` from `computeVelocity`; then `qualifyOne`.
- Relations: for each related slug that already exists → `addRelation(source, target, 'similar')`.
- Actions per architecture + `discoveryConfigured()`.
- `GET /api/cron/daily`: bearer check; runs campaign evaluation, email `processAllDue`, `syncStale({limit: 12, budgetMs: 30000})`, and on Sundays (UTC) `scrapeTrustpilotCategory` for every category with `max: 20` inside the remaining budget; returns `{ campaigns, emails, sync, seeded }`; `export const maxDuration = 300`.
- Tests with the fake Firecrawl: profile scrape (fields, snapshot, velocity 0 on first scrape, relations only to existing slugs, CRM fields preserved on rescrape), velocity (30-day snapshot delta; extrapolation; rate fallback; `computeVelocity` worked examples), category scrape (pagination, dedupe, basic rows with `lastScrapedAt` null), `syncStale` ordering and budget, `DiscoveryUnavailable` paths, cron route auth.
### Out
- UI (WP-14). BFS crawler (unused in gtm; skip). Bland.

## Acceptance criteria
AC-13.1 `tests/firecrawl.test.ts`: all scenarios above pass; `computeVelocity` examples: snapshots [100 @ now-31d], current 130 → 30; snapshots [100 @ now-2d], current 110 → 150; no snapshots, visible 40 over 10 days → 120; no data → 0.
AC-13.2 Scraping the same profile twice keeps `status`, `ownerEmail`, `notes`, `tags`, `doNotCall` and adds a second snapshot.
AC-13.3 Category scrape with a fake returning 2 pages × 20 inserts 40 basic rows (source trustpilot, `lastScrapedAt` null) and skips existing slugs.
AC-13.4 `syncStale` picks null-first then oldest, respects `limit` and `budgetMs`, and reports `remaining`.
AC-13.5 Without `FIRECRAWL_API_KEY`: `scrapeUrlAction` → `{ ok:false, message: 'Discovery is not configured: set FIRECRAWL_API_KEY' }`; `discoveryConfigured()` false.
AC-13.6 `curl` the daily cron locally with and without the bearer (200 JSON with counts / 401); `vercel.json` has exactly one cron.
AC-13.7 If you have a real key in `.env.local`, one live scrape of a public Trustpilot page succeeds (optional; report what you did). `npm test`, typecheck, lint, build exit 0.

## Delegation guidance
Juniors: `trustpilot-categories.ts`, rate limiter + test, fake Firecrawl helper, cron route auth test. Keep: extraction schema, mapping, velocity, sync.
