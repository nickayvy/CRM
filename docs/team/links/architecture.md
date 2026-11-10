# External links at scrape time — System architecture

## Overview

```
 paste URL ─► scrapeUrlAction ─► scrapeTrustpilotBusiness ─┐
                                                           ├─► enrichBusinessLinks ─► businesses row
 seed category ─► seedCategoryAction ─ after() ─► scrapeTrustpilotCategory ─► enrichPendingLinks
 daily cron ─► GET /api/cron/daily ───────────────────────────────────────► enrichPendingLinks
 CLI ─► scripts/enrich-links.ts ──────────────────────────────────────────► enrichPendingLinks

 enrichBusinessLinks = resolveExternalLinks (network, no DB) + persist (DB)
 resolveExternalLinks = FirecrawlLike.scrapePage (homepage, then at most one contact page)
                        + extractExternalLinks (pure)
```

## Components

### Firecrawl seam — `src/lib/firecrawl/client.ts`
- Responsibility: the only place that talks to the Firecrawl SDK. Gains a
  non-LLM page scrape next to `scrapeJson`.
- Exposes: `FirecrawlLike.scrapePage`, `ScrapedPage`.

### Link extraction — `src/lib/firecrawl/external-links.ts` (new, pure)
- Responsibility: turn a scraped page into validated external links. No I/O,
  no DB, no env.
- Exposes: `extractExternalLinks`, `cleanWebsiteUrl`, `websiteFromSlug`,
  `SOCIAL_KEYS`, `ExternalLinks`.

### Enrichment — `src/lib/firecrawl/enrich.ts` (new)
- Responsibility: resolve links for one business over the network, persist
  them under the write rules, and drain pending rows inside a budget.
- Depends on: the seam, extraction, `src/db/repo/*`, `qualifyOne`.
- Exposes: `resolveExternalLinks`, `enrichBusinessLinks`, `enrichPendingLinks`.

### Callers (existing files, edited)
- `src/lib/firecrawl/trustpilot.ts`: clean website on profile scrape, website
  from slug on seed, inserted ids returned from the seed.
- `src/features/discovery/server-actions.ts`: R3 and R4.
- `src/app/api/cron/daily/route.ts`: R5 stage.
- `scripts/enrich-links.ts` (new) + `enrich:links` npm script.

## Data model

No change. Columns used on `businesses`: `website text`, `phone text`,
`phone_digits text`, `email text`, `social_links jsonb` (`Record<string,string>`,
default `{}`), `enriched_at timestamptz`, `slug`, `trustpilot_id`.

`social_links` keys written by this work: `facebook`, `twitter`, `linkedin`,
`instagram`, `youtube`, `tiktok`. X profiles are stored under `twitter`.

**Pending** (eligible for enrichment): a row with a non-empty `website`, or a
domain-like `slug`, and either `enriched_at IS NULL`, or `enriched_at` older
than 7 days with `social_links = '{}'`. Order: never-enriched first (oldest
`created_at` first), then the stale-empty ones (oldest `enriched_at` first).

## Interfaces (frozen)

```ts
// src/lib/firecrawl/client.ts
export type ScrapedPage = {
  /** URL that was requested. */
  url: string;
  /** URL after redirects, when Firecrawl reports one. */
  finalUrl: string | null;
  /** Every href on the page, as Firecrawl returns them (may include mailto:/tel:). */
  links: string[];
  /** Page markdown (full page, not main-content only), or null. */
  markdown: string | null;
};

export interface FirecrawlLike {
  scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null>; // unchanged
  /** Non-LLM scrape. Resolves null when the page yields nothing; rejects on transport/HTTP failure
   *  and with DiscoveryUnavailable without a key. */
  scrapePage(url: string, opts?: { timeoutMs?: number }): Promise<ScrapedPage | null>;
}
```

```ts
// src/lib/firecrawl/external-links.ts
export const SOCIAL_KEYS = ["facebook", "twitter", "linkedin", "instagram", "youtube", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type ExternalLinks = {
  /** Clean origin-level website (https://host[/path]); null when unknown. */
  website: string | null;
  socialLinks: Partial<Record<SocialKey, string>>;
  email: string | null;
  phone: string | null;
};
/** Same-host contact/about/support page worth a second look, if any. */
export type Extracted = ExternalLinks & { contactUrl: string | null };

export function extractExternalLinks(page: ScrapedPage): Extracted;
export function cleanWebsiteUrl(url: string | null | undefined): string | null;
export function websiteFromSlug(slug: string | null | undefined): string | null;
```

```ts
// src/lib/firecrawl/enrich.ts
export type EnrichStatus = "enriched" | "empty" | "skipped" | "failed";

/** Network only. Homepage, then at most ONE same-host contact page when email or phone is still missing. */
export function resolveExternalLinks(
  fc: FirecrawlLike,
  target: { website: string | null; slug: string | null },
  opts?: { timeoutMs?: number },
): Promise<ExternalLinks | null>; // null = no usable website

/** resolve + persist + re-qualify. Never throws for a per-site failure (returns "failed");
 *  DiscoveryUnavailable propagates. "skipped" = no website and no domain-like slug. */
export function enrichBusinessLinks(
  db: Db, fc: FirecrawlLike, businessId: string, opts?: { now?: Date; timeoutMs?: number },
): Promise<{ status: EnrichStatus; business: Business }>;

/** Drains pending rows. `ids` are processed first. No new scrape starts after budgetMs. */
export function enrichPendingLinks(
  db: Db, fc: FirecrawlLike,
  opts: { limit: number; budgetMs: number; ids?: string[]; concurrency?: number; now?: () => number },
): Promise<{ enriched: number; empty: number; failed: number; remaining: number }>;
```

`scrapeTrustpilotCategory` return type grows to
`{ inserted: number; seen: number; insertedIds: string[] }` (additive).

Signatures of `scrapeUrlAction`, `seedCategoryAction`, `enrichTrustpilotAction`,
`discoveryConfigured` and everything re-exported from
`src/features/lookup/discovery-bridge.ts` stay as they are.

Cron response gains one key:
`links: { enriched, empty, failed, remaining } | { skipped: string } | { error: string }`.

## Write rules (R6)

| Column | Rule |
|---|---|
| `website` | set when empty (final URL's origin, else `https://<slug>`); an existing value is only replaced by its own cleaned form |
| `phone`, `phone_digits` | set only when `phone` is empty |
| `email` | set only when empty |
| `social_links` | `{ ...existing, ...found }`; never removes a key |
| `enriched_at`, `updated_at` | stamped on `enriched`, `empty` and `failed` |
| CRM fields, `last_scraped_at`, `scrape_*` | never written |

`enriched` = at least one of social/email/phone was found; `empty` = the page
loaded and nothing was found; `failed` = the scrape rejected or timed out.

## Validation rules (R7)

A social URL is accepted only if it parses as a URL, the protocol is `http:`
or `https:` (stored as `https:`), the hostname is the platform's registrable
domain or a subdomain of it (`facebook.com`, `fb.com`; `twitter.com`, `x.com`;
`linkedin.com`; `instagram.com`; `youtube.com`, `youtu.be`; `tiktok.com`), the
path is not empty, and it is not a share/intent/login/policy URL. For
LinkedIn, a `/company/` URL wins over `/in/`. First acceptable link wins
otherwise. Emails must look like an address and not be an asset name
(`logo@2x.png`) or a known vendor placeholder; phones come from `tel:` links.

## Budgets

| Path | Budget |
|---|---|
| Paste a URL | profile scrape as today, then one `enrichBusinessLinks` capped at 45 s total |
| Category seed (`after()`) | 240 s for seed + enrichment together; enrichment `limit` 60 |
| Daily cron `links` stage | `limit` 40, `budgetMs` 60 000, and inside the existing 240 s discovery budget |
| Per page scrape | 30 s timeout |
| Website scrape concurrency | 2 (Firecrawl plan limit) |

The Trustpilot limiter (1 in flight, 1.5 s apart) stays for Trustpilot URLs.
Website scrapes target distinct hosts and must not queue behind that 1.5 s gap.

### Rate limit (added in review round 1)

Measured on 2026-11-09: the Firecrawl plan rejects the 11th scrape request of a
minute with HTTP 429 and `retry-after`. So:

- **Pacing.** One process-wide limiter shared by `scrapeJson` and `scrapePage`
  starts at most `FIRECRAWL_REQUESTS_PER_MINUTE` requests (optional env var,
  default 10) in any rolling 60 s, on top of the concurrency rules above.
- **Typed error.** `FirecrawlRateLimited extends Error { retryAfterMs: number }`
  (`client.ts`), thrown by both seam methods on a 429 from the Firecrawl API.
- **Not a site failure.** `resolveExternalLinks` and `enrichBusinessLinks`
  propagate it and write nothing. `enrichPendingLinks` waits and retries the
  row when `retryAfterMs + 10 s` fits the remaining budget, otherwise stops;
  its result gains `rateLimited: boolean`; it accepts
  `sleep?: (ms: number) => Promise<void>`. `syncStale` stops without
  `markScrapeFailed`.
- **Cron `links` budget.** Remaining discovery budget capped at 180 s on
  non-Sundays, 60 s on Sundays; limit 40.

At 10 requests a minute a 240 s seed enriches roughly 20 to 35 of its rows;
the rest stay pending for the cron (about 25 rows a day).

## Files

**Owned by WP-17 (may edit or create):**
`src/lib/firecrawl/**`, `src/features/discovery/**`,
`src/app/api/cron/daily/route.ts`, `scripts/enrich-links.ts`, `package.json`
(one `scripts` entry only), `tests/firecrawl.test.ts`,
`tests/discovery-actions.test.ts`, `tests/discovery.test.ts`,
`tests/helpers/fake-firecrawl.ts`, new `tests/external-links*.test.ts` /
`tests/enrich*.test.ts`, `src/db/repo/discovery.ts` (new query helpers only),
`docs/team/links/**`.

**Off limits (uncommitted local work on the main checkout; a merge that
touches any of these is rejected):**
`src/app/calling/**`, `src/app/globals.css`, `src/app/lookup/page.tsx`,
`src/components/leads/**`, `src/components/lookup/**`,
`src/db/repo/call-campaigns.ts`, `src/db/repo/leads.ts`,
`src/features/calling/**`, `src/features/leads/**`,
`src/features/lookup/actions.ts`, `src/features/lookup/data.ts`,
`src/lib/supabase/server.ts`, `tests/calling-actions.test.ts`,
`tests/leads-actions.test.ts`, `tests/leads-ui.test.tsx`,
`tests/lookup-ui.test.tsx`, `tests/routes-render.test.tsx`, any `loading.tsx`,
`src/components/shell/page-skeleton.tsx`. Also unchanged: `src/db/schema.ts`,
`drizzle/**`.

## Cross-cutting conventions

- Tests: vitest, PGlite via `src/db/test-utils.ts`, Firecrawl faked through
  `tests/helpers/fake-firecrawl.ts`. No network in tests.
- Server actions return `ActionResult` (`src/lib/action-result.ts`).
- Logging prefix `[discovery]`. Never log the API key.
- `AGENTS.md`: this Next.js version differs from older ones; read
  `node_modules/next/dist/docs/` before using `after()`, `revalidatePath` or
  route config.

## Deliberately undecided (senior's call)

- How concurrency 2 is implemented (second limiter, pool, or Firecrawl batch).
- Email and phone heuristics beyond the rules above, and which same-host link
  counts as the contact page.
- Whether `enrichFromWebsite` (LLM-based) is removed or reimplemented on the
  new pipeline; `enrichTrustpilotAction` must keep its signature either way.
- Whether `revalidatePath("/lookup")` is called after background enrichment
  (only if the Next docs say it is valid inside `after()`).
- Test file layout.
