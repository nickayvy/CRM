# WP-19: Fast website enrichment and qualify-before-enrich

**Wave:** 1 (parallel with WP-18)
**Depends on:** none (current `main`, 1052 tests green)
**Owns files:**
- `src/lib/web/**` (new)
- `src/lib/firecrawl/enrich.ts`, `src/lib/firecrawl/client.ts`
- `src/db/repo/discovery.ts`
- `src/features/discovery/**`
- `src/app/api/cron/daily/route.ts`
- `scripts/enrich-links.ts`
- `tests/fetch-page.test.ts`, `tests/page-source.test.ts` (new), and the
  existing tests for the files above (`tests/enrich.test.ts`,
  `tests/discovery*.test.ts`, `tests/firecrawl*.test.ts`,
  `tests/helpers/fake-firecrawl.ts`)

**Do not edit:** `src/db/schema.ts`, `drizzle/**`, `src/lib/env.ts`,
`src/lib/qualify/**`, `src/features/ingest/**`, `package.json`,
`package-lock.json`, `src/lib/google-places/**`, `src/features/google/**`
(WP-18 owns them and is running at the same time). **Add no dependency.**

**Delivers:** branch `wp-19-fast-website-enrichment`

## Objective
Link enrichment (website, social profiles, email, phone read from the
business's own site) stops being limited by Firecrawl's 10 requests a minute.
Pages are fetched directly over HTTP first, safely, and Firecrawl is used only
when that fails. Rows that qualification has already cut for good are not
enriched. After this package a few hundred new businesses get their emails in
minutes and the links step works with no Firecrawl key at all.

## Context the engineer needs
- Stack and commands: Next.js 16.4.5 (read `AGENTS.md`), TypeScript, Drizzle,
  Vitest. `export PATH=/opt/node24/bin:$PATH`; `npm ci`; `npm test`;
  `npm run typecheck`; `npm run lint`; `npm run build`.
- Read first: `docs/team/links/architecture.md` (the enrichment design this
  extends), `src/lib/firecrawl/enrich.ts`, `src/lib/firecrawl/client.ts`
  (`ScrapedPage`, `FirecrawlLike`, the limiters), `src/lib/firecrawl/external-links.ts`
  (`extractExternalLinks` consumes `ScrapedPage.links` and `.markdown`).
- Today: `enrichBusinessLinks` calls `fc.scrapePage` for the homepage and at
  most one contact page; every call is a Firecrawl credit paced to 10 a
  minute, 2 at a time. The cron drains 40 rows in 180 s; a category seed
  drains 60 in the seed's remaining budget. Callers refuse to run without
  `FIRECRAWL_API_KEY`.
- The frozen interface (architecture, "Page source"):
  ```ts
  // src/lib/web/fetch-page.ts
  export function fetchPage(url: string, opts?: { timeoutMs?: number; fetch?: typeof fetch; lookup?: (host: string) => Promise<string[]> }): Promise<ScrapedPage | null>;
  export class UnsafeUrlError extends Error {}
  // src/lib/web/page-source.ts
  export function createPageSource(opts: { firecrawl?: FirecrawlLike | null; direct?: typeof fetchPage }): FirecrawlLike;
  ```
  `enrichBusinessLinks` and `enrichPendingLinks` keep their signatures.
- Google rows (WP-18) arrive with `website` set and `enrichedAt` null, so the
  existing pending rule already picks them up; you need no Google-specific code.

## Scope
### In
1. **`fetchPage`**: GET with a browser-like `User-Agent` that names no person
   or project, `Accept: text/html`, redirects followed by hand (at most 5),
   timeout (default `PAGE_TIMEOUT_MS`), body capped (about 1.5 MB; stop
   reading past it), only `text/html` / `application/xhtml+xml` accepted
   (anything else → null). Returns `ScrapedPage`: `url`, `finalUrl`, `links`
   (every `href`, resolved to absolute, including `mailto:` and `tel:`),
   `markdown` (visible text: scripts/styles removed, tags stripped, entities
   decoded; `<a>` text kept next to its URL is not required).
   Handle Cloudflare email protection (`data-cfemail` / `/cdn-cgi/l/email-protection#…`)
   by decoding it into a `mailto:` link, since many small-business sites use it.
2. **SSRF guard**, applied to the first URL and to every redirect target
   before connecting: scheme `http`/`https` only; no credentials in the URL;
   port 80/443/default only; hostname resolved (injectable `lookup`) and
   refused when any address is loopback, private (10/8, 172.16/12,
   192.168/16), link-local (169.254/16, fe80::/10), CGNAT (100.64/10),
   unique-local (fc00::/7), unspecified, multicast, or an IPv4-mapped form of
   those; literal-IP hosts get the same check; `localhost` and `.internal` /
   `.local` names refused. Failure → `UnsafeUrlError`, counted as a site
   failure by the enrichment (the row is stamped, not retried forever).
3. **`createPageSource`**: direct first; falls back to `firecrawl.scrapePage`
   when one is given and the direct fetch rejects (except `UnsafeUrlError`,
   which is final), returns null, or returns a thin page (your threshold;
   document it: for example under 200 characters of text and no `mailto:`,
   `tel:` or social link). With no Firecrawl the direct result (or failure)
   stands. `FirecrawlRateLimited` from the fallback propagates as today.
4. **Callers** build their source with `createPageSource`:
   `src/features/discovery/server-actions.ts` (paste-a-URL add, category
   seed's link step, `enrichTrustpilotAction`), the cron `links` stage,
   `scripts/enrich-links.ts`. The links step no longer requires
   `FIRECRAWL_API_KEY`; Trustpilot scraping still does, and its messages are
   unchanged.
5. **Throughput**: direct fetches are not paced by the Firecrawl window
   (only the fallback is). Raise drain concurrency for the direct path (your
   number, at most 8) and the cron's link limit so one daily run can clear a
   few hundred rows inside its existing 180 s / 60 s budget; keep the
   function's `maxDuration` and the discovery budget as they are. Polite:
   never more than 2 requests in flight to one host.
6. **Qualify before enrich** in `pendingLinksWhere` (`src/db/repo/discovery.ts`):
   a row is not pending when `qualification = 'rejected'` and
   `rejection_reasons` contains any code other than `no_phone`, `unclaimed`,
   `low_score` (those three are either curable by a website visit or soft).
   Applies to every source. `countPendingLinks` follows.
7. **Docs**: update `docs/team/links/architecture.md` with a short "Direct
   fetch" section (order, fallback rule, guard, new limits).

### Out
- Google search itself, schema, qualification reasons (WP-18).
- UI (WP-20). The dossier's refresh action keeps working through
  `enrichTrustpilotAction` unchanged.
- An AI agent for owner names; email verification.

## Interfaces
### Consumes
`ScrapedPage`, `FirecrawlLike`, `FirecrawlRateLimited`, `DiscoveryUnavailable`,
`extractExternalLinks`.
### Produces
`fetchPage`, `UnsafeUrlError`, `createPageSource` as above. WP-20 uses
`createPageSource` when it wires enrichment after a Google job.

## Acceptance criteria
AC-19.1 `fetchPage` unit tests with a stub `fetch`: absolute and relative
  `href`s resolved; `mailto:` and `tel:` kept; a Cloudflare-protected email
  decoded; script/style text absent from `markdown`; a `application/pdf`
  response → null; a 404 rejects; a body larger than the cap is truncated and
  still parsed; a 6-redirect chain rejects; `finalUrl` reflects the redirect.
AC-19.2 SSRF: `http://127.0.0.1/`, `http://localhost/`, `http://[::1]/`,
  `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.5/`,
  `http://example.com:22/`, `ftp://example.com/`, `http://user:pw@example.com/`,
  a hostname whose injected lookup returns `10.0.0.5`, and a public URL that
  redirects to `http://192.168.1.1/` all reject with `UnsafeUrlError` and the
  stub `fetch` is never called for the unsafe hop.
AC-19.3 `extractExternalLinks(await fetchPage(...))` on a realistic
  small-business HTML fixture (footer with Facebook and Instagram links, a
  `mailto:info@…`, a `tel:` link, a `/contact` link) returns the same website,
  socials, email and phone as the equivalent Firecrawl-shaped fixture.
AC-19.4 Page source: direct success → the fake Firecrawl's `scrapePage` call
  count is 0; direct rejects → Firecrawl is called once and its page is
  returned; thin direct page → Firecrawl is called; no Firecrawl and direct
  rejects → rejects; `UnsafeUrlError` → Firecrawl is not called.
AC-19.5 Drain: `enrichPendingLinks` over 10 pending rows with a succeeding
  fake direct fetcher makes zero Firecrawl calls and enriches 10; with no
  Firecrawl at all it still enriches 10; rate-limit and timeout behaviour of
  the existing tests is unchanged (they pass unmodified, or the report lists
  each test changed and why).
AC-19.6 Qualify before enrich: `listPendingLinkIds` omits a row rejected for
  `category_mismatch`, includes a row rejected only for `no_phone`, includes a
  `review` row, and `countPendingLinks` agrees.
AC-19.7 No key: with `FIRECRAWL_API_KEY` unset, `enrichTrustpilotAction` on a
  business with a website enriches it through the direct path (test with an
  injected fetch or module mock), while `scrapeUrlAction` still answers the
  not-configured message.
AC-19.8 Cron: `tests` for the daily route show the `links` stage runs without
  a Firecrawl key and reports its counts; `sync` and `seeded` still report
  skipped.
AC-19.9 Live check: run `fetchPage` against three real small-business
  websites of your choice and paste what `extractExternalLinks` found (public
  contact details only). If outbound HTTP to arbitrary sites is blocked in
  your sandbox, say so and give the error.
AC-19.10 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` exit
  0. Paste the test count (baseline 1052).

## Delegation guidance
Good junior tasks: the HTML fixture tests (AC-19.1, 19.3), the SSRF test
matrix (AC-19.2) once you have written the guard, the cron-route tests.
Keep: the guard itself, the fallback rule, concurrency and budgets.

## Reporting
Use the completion-report format from the senior brief. State the thin-page
threshold, the concurrency and the cron limits you chose and why.
