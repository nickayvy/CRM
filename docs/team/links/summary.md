# External links at scrape time — Run summary

**Date:** 2026-11-09 · **PM:** Fable 5.2

## Shipped

- **WP-17 External links pulled at scrape time** — [PR #16](https://github.com/nickayvy/CRM/pull/16),
  merged to `main` as `575a11b`, one revision round. Production deploy
  `dpl_4dXErzLrX3dULmgvCp1C66gjeS2L` READY.
  - Pasting a Trustpilot URL enriches the business in the same action.
  - Seeding a category enriches the new rows in the same background task,
    then other pending rows, within 240 s.
  - The daily cron drains pending rows (`links` stage: 180 s weekdays, 60 s
    Sundays, limit 40).
  - Links are extracted by code from the business's own site (Firecrawl
    `links` + `markdown`, 1 credit a page, no LLM): website, Facebook, X,
    LinkedIn, Instagram, YouTube, TikTok, email, phone.
  - All Firecrawl requests are paced to `FIRECRAWL_REQUESTS_PER_MINUTE`
    (default 10); a 429 leaves rows pending instead of marking them failed.
  - `npm run enrich:links` drains pending rows on demand.

## Production data (Trustpilot rows)

| | Before | After |
|---|---|---|
| Rows | 148 | 154 (6 added through the app after the deploy) |
| Website | 4 | 154 |
| Any social link | 0 | 129 |
| Facebook / X / LinkedIn | 0 / 0 / 0 | 122 / 50 / 21 |
| Email | 4 | 103 |
| Phone | 3 | 80 |
| Websites with tracking parameters | 4 | 0 |
| Pending enrichment | 148 | 4 |

- The 148 existing rows were backfilled by the PM: links resolved locally with
  the merged code and the real key (139 enriched, 5 loaded with nothing found,
  4 site failures), then written through the Supabase MCP in six batches, each
  guarded by a server-side md5 of its payload (all six matched). Writes only
  fill empty website, phone and email and merge social links.
- The 6 rows added after the deploy were enriched by production itself, which
  is the feature working end to end.
- Still pending (site-side failures, retried by the cron):
  `www.scienceinsport.com` (timeout), `www.thegroomroom.co.uk` (503),
  `www.factoryoutletstore.com` (520), `www.gunbroker.com` (Firecrawl does not
  support the site).

## Cut or deferred

- **No UI change.** The lookup UI files carry uncommitted local work and were
  off limits. Consequences: Instagram, YouTube and TikTok links are stored but
  have no tile; there is no "refresh links" action in the dossier.
- **Yelp rows** have no website, so they have nothing to enrich from.
- **FOUNDER tile** shows the company LinkedIn page; only 21 of 154 sites link
  to LinkedIn.

## Integration check

- PM's own runs on the delivered branch: typecheck clean, lint 0 warnings,
  1033 tests passed (807 before the package).
- Main checkout (merge plus the uncommitted local work): typecheck clean.
- Live: a real 429 surfaces as `FirecrawlRateLimited`; production enriched its
  own new rows.
- Not checked: the dossier tiles in a signed-in browser. They render the
  columns verified above; the mapping is covered by a unit test (AC-17.12).

## Open issues

- **Throughput is capped by the Firecrawl plan** (10 scrapes a minute, 2
  concurrent). A 50-row seed enriches roughly 20 to 35 rows in its own run and
  the cron picks up about 15 to 20 a day. Upgrading the plan and raising
  `FIRECRAWL_REQUESTS_PER_MINUTE` on Vercel lifts this.
- The Sunday cron seed (22 categories) can add rows faster than a weekday
  drains them.
- The backfill did not re-run qualification for rows that gained a phone; the
  daily Trustpilot sync re-qualifies them as it reaches them.
- 45 uncommitted files on the main checkout (lookup, calling, leads, loading
  skeletons) are not part of this push.

## Cost

- Agents: 1 senior (Opus 5.5, medium; two rounds, about 560k tokens), 1 junior
  (Sonnet 5.5, high; one test-matrix task).
- Firecrawl: roughly 300 credits (probes, rate-limit measurement, backfill).
