# External links at scrape time — Spec

**Status:** approved by user directive on 2026-11-09 ("fix this … push to prod when done")
**PM:** Fable 5.2

## Problem (measured on production, 2026-11-09)

The dossier's EXTERNAL LINKS section shows seven tiles: WEBSITE, FACEBOOK,
META ADS, X / TWITTER, FOUNDER (LinkedIn), EMAIL, PHONE. Each reads a column on
`businesses` (`website`, `social_links`, `email`, `phone`). In production:

| | rows | website | phone | email | social links | `enriched_at` |
|---|---|---|---|---|---|---|
| Trustpilot | 148 | 4 | 3 | 4 | 0 | 0 |
| Yelp | 1 | 0 | 1 | 0 | 0 | 0 |

Three causes:

1. **Category seed stores bare rows.** `scrapeTrustpilotCategory` inserts name,
   slug, rating and review count only. 144 of 148 rows are in that state and
   wait for the daily cron, which re-scrapes 12 rows a day.
2. **Social links are never fetched.** Trustpilot profile pages do not list
   them (the profile extraction returns `""` for all four), and
   `enrichFromWebsite`, the only code that looks at the business's own site,
   has no caller in the UI or the cron.
3. **Stored websites carry Trustpilot tracking parameters**
   (`?utm_medium=company_profile&utm_source=trustpilot…`).

## Goal

When a user adds a business to the network (pastes a Trustpilot URL, or seeds
a category), the external-link data is pulled as part of that same operation,
so the dossier tiles are populated when the business appears. Businesses
already in the network are filled in without the user re-adding them.

## Non-goals

- No UI changes. The tiles already render whatever the columns hold. The lookup
  UI files have uncommitted local work and are off limits (see architecture
  §Files).
- No schema change and no migration.
- No new tile types (Instagram, YouTube and TikTok links are stored but not
  shown yet).
- No founder/person lookup: the FOUNDER tile keeps showing the LinkedIn link.
- No website discovery for Yelp rows (the Yelp API does not return a website).
  A Yelp row that has a website is enriched like any other.
- No change to the Trustpilot profile scrape cadence (daily cron, 12 rows).

## Functional requirements

R1. **Deterministic extraction.** Links come from the business's own website
    via Firecrawl's non-LLM page scrape (`links` and `markdown` formats, 1
    credit). Social profiles, email and phone are picked out by code, not by a
    model.
R2. **Website is known at insert.** A Trustpilot slug that looks like a domain
    gives `website = https://<slug>` at seed time. A profile scrape stores the
    profile's website with tracking parameters removed.
R3. **Paste-a-URL add** (`scrapeUrlAction`): the profile scrape is followed, in
    the same action, by link enrichment of that business. A failure of the
    enrichment step does not fail the add.
R4. **Category seed** (`seedCategoryAction`): after the rows are inserted, the
    same background task enriches the new rows, then any other pending rows,
    until its time budget runs out.
R5. **Backlog drain.** The daily cron enriches pending rows (never enriched,
    or enriched more than 7 days ago with nothing found) inside its own time
    budget and reports the result. A CLI script does the same on demand.
R6. **Safe writes.** Enrichment fills `phone` and `email` only when empty,
    merges social links, never touches CRM fields, and stamps `enriched_at` on
    every attempt that reached a verdict.
R7. **Safe values.** Only `http(s)` URLs on the platform's own hosts are stored
    as social links; share/intent URLs and non-URL strings are rejected.

R8. **Paced requests.** All Firecrawl requests stay under the plan's
    requests-per-minute limit (10, measured 2026-11-09; configurable).
R9. **A rate limit is not a failure.** A 429 from Firecrawl never stamps
    `enriched_at` or scrape back-off on a row; drains wait or stop and leave
    the rows pending.

## Acceptance criteria

AC1. Given the link list of a real homepage (fixture), `extractExternalLinks`
     returns that site's facebook, twitter, instagram, youtube and tiktok
     profile URLs under those keys; `x.com` and `twitter.com` both land under
     `twitter`. Proof: unit tests.
AC2. Share/intent links (`facebook.com/sharer…`, `twitter.com/intent/…`,
     `linkedin.com/shareArticle…`), bare platform roots, `javascript:`/`data:`
     values and look-alike hosts (`facebook.com.evil.test`) are never returned.
     Proof: unit tests.
AC3. `cleanWebsiteUrl` drops `utm_*` parameters and fragments and returns null
     for non-http(s) input; `websiteFromSlug("acme.com")` is
     `https://acme.com`, and null for a slug without a dot. Proof: unit tests.
AC4. After `scrapeUrlAction` with a fake Firecrawl, the stored row has a clean
     `website`, populated `socialLinks`, and `enrichedAt` set. When the page
     scrape rejects, the action still returns `ok` and the profile data is
     stored. Proof: tests in `tests/discovery-actions.test.ts`.
AC5. Rows inserted by `scrapeTrustpilotCategory` have
     `website = https://<slug>` for domain-like slugs, and the function reports
     the inserted ids. Proof: tests in `tests/firecrawl.test.ts`.
AC6. `enrichPendingLinks` processes never-enriched rows first (the `ids` it is
     given before others), stops starting new work once `budgetMs` has elapsed,
     respects `limit`, and returns `{ enriched, empty, failed, remaining }`
     that add up. Proof: tests with a fake Firecrawl and an injected clock.
AC7. Enrichment never overwrites a non-empty `phone` or `email`, merges into
     existing `socialLinks`, and leaves every CRM field unchanged. Proof: tests.
AC8. `GET /api/cron/daily` returns a `links` stage next to `sync`; it is
     `{ skipped }` without `FIRECRAWL_API_KEY`, and an error in it does not
     stop the other stages. Proof: tests.
AC9. `npm run typecheck`, `npm run lint` (0 warnings) and `npm test` pass; the
     test count is not lower than the baseline on `main`.
AC10. No file in the off-limits list is modified; `src/db/schema.ts` and
      `drizzle/` are unchanged. Proof: `git diff --stat main...HEAD`.
AC11. Live proof: `resolveExternalLinks` run against three real business
      sites with the real Firecrawl key returns at least a website and one
      social link for at least two of them. Proof: command output in the
      report (no key in the output).
AC12. An enriched row mapped through `toLookupBusiness` resolves the dossier's
      three social tiles (`socialLink(links, "facebook")`,
      `socialLink(links, "twitter", "x")`, `socialLink(links, "linkedin")`) to
      non-null `https://` URLs. Proof: unit test.

AC13–AC18 (added in review round 1, rate limit): see
`reviews/WP-17.md` §Required changes, items 1 to 6.

## Decisions made by the PM

- **One package, one senior.** The change is one cohesive backend slice in a
  small set of files that all depend on one new seam; splitting it would only
  add a merge seam.
- **No LLM for links**: `links` + `markdown` scrape costs 1 credit and is
  deterministic; the JSON/LLM format costs more and returned empty strings.
- **`enriched_at` doubles as "last attempt"** so no migration is needed.
- **Concurrency 2** for website scrapes: the Firecrawl plan allows 2 concurrent
  jobs (checked 2026-11-09; 10,955 credits remain).
- **Existing production rows** are backfilled by the PM after the merge and by
  the cron thereafter.

## Open questions

None.
