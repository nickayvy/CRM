# WP-17: External links pulled at scrape time

**Wave:** 1
**Depends on:** none
**Owns files:** see "Files" below — no other work touches these
**Delivers:** branch `wp-17-external-links` / PR titled "WP-17: External links pulled at scrape time"

## Objective

The dossier's EXTERNAL LINKS tiles (website, Facebook, Meta Ads, X, LinkedIn,
email, phone) are empty for nearly every business because seeded rows are
stored bare and nothing ever reads the business's own website. When this
package is done, adding a business to the network (paste a Trustpilot URL, or
seed a category) also pulls its website, social profiles, email and phone,
deterministically and without an LLM, and a budgeted drain fills in rows that
are already stored.

## Context the engineer needs

- Stack: Next.js 16.4 (App Router; read `node_modules/next/dist/docs/` before
  using `after()`, `revalidatePath`, route config — `AGENTS.md` requires it),
  React 19, Drizzle ORM, PGlite in tests, vitest, `@mendable/firecrawl-js` v4
  (v2 API).
- Install `npm ci` · Test `npm test` · Typecheck `npm run typecheck` · Lint
  `npm run lint` (must stay at 0 warnings).
- Read first: `docs/team/links/spec.md` and `docs/team/links/architecture.md`
  (interfaces there are frozen), then `src/lib/firecrawl/client.ts`,
  `src/lib/firecrawl/trustpilot.ts`, `src/features/discovery/server-actions.ts`,
  `src/app/api/cron/daily/route.ts`, `tests/helpers/fake-firecrawl.ts`,
  `tests/firecrawl.test.ts`, `tests/discovery-actions.test.ts`.
- What the UI reads (do not edit it): `src/components/lookup/dossier-modal.tsx`
  builds the tiles from `LookupBusiness.website`, `.email`, `.phone` and
  `socialLink(b.socialLinks, "facebook" | "twitter","x" | "linkedin")`
  (`src/features/lookup/links.ts`, `src/features/lookup/types.ts`).
- Verified by the PM against the live API on 2026-11-09: a Firecrawl scrape of
  a homepage with `formats: ["links"]`, `onlyMainContent: false` costs 1
  credit and returns footer links such as `https://www.facebook.com/<page>`,
  `https://twitter.com/<handle>`, `http://instagram.com/<handle>`,
  `https://www.tiktok.com/@<handle>?lang=en`, plus `metadata.url` (the URL
  after redirects) and `metadata.sourceURL`. Whether `mailto:`/`tel:` hrefs
  appear in `links` was not confirmed: check it, and fall back to the
  markdown for email if they do not.
- The Firecrawl plan allows 2 concurrent jobs.
- Live probes: you may load `FIRECRAWL_API_KEY` from
  `/Users/nick/Documents/projects/CRM/.env.local` in a shell for at most 15
  live page scrapes. Never print, log or commit the key, and never copy that
  file into the worktree.

## Scope

### In
1. `FirecrawlLike.scrapePage` on the seam (real client + fake helper).
2. `src/lib/firecrawl/external-links.ts`: `extractExternalLinks`,
   `cleanWebsiteUrl`, `websiteFromSlug` (pure, validated per architecture
   §Validation rules).
3. `src/lib/firecrawl/enrich.ts`: `resolveExternalLinks`,
   `enrichBusinessLinks`, `enrichPendingLinks` (write rules and pending
   definition per architecture).
4. `scrapeTrustpilotBusiness`: store the cleaned website; fall back to
   `websiteFromSlug` when the profile has none.
5. `scrapeTrustpilotCategory`: new rows get `website` from the slug; return
   `insertedIds`.
6. `scrapeUrlAction`: enrich the business in the same action, non-fatal,
   capped at 45 s.
7. `seedCategoryAction`: inside the existing `after()`, enrich the inserted
   rows first, then other pending rows, within a 240 s total budget.
8. Cron: a `links` stage after `sync` (limit 40, 60 s), reported in the JSON,
   isolated from the other stages.
9. `scripts/enrich-links.ts` + `"enrich:links"` npm script: loops
   `enrichPendingLinks` against the DB the env points to; flags `--limit N`
   (default 200) and `--budget-seconds N`; prints the totals.
10. Tests for all of the above.

### Out
- Any UI file, any file in the off-limits list, schema or migrations.
- New tile types, founder lookup, Yelp website discovery.
- Backfilling production (the PM does that after the merge).

## Interfaces

### Consumes
Existing repos and helpers: `getBusiness`, `upsertBusinessByTrustpilotId`,
`getBusinessByTrustpilotId` (`src/db/repo/*`), `qualifyOne`
(`src/features/ingest/run`), `phoneDigits` (`src/lib/format`), `RateLimiter`.

### Produces (frozen — copy from `architecture.md` §Interfaces)

```ts
// client.ts
export type ScrapedPage = { url: string; finalUrl: string | null; links: string[]; markdown: string | null };
export interface FirecrawlLike {
  scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null>;
  scrapePage(url: string, opts?: { timeoutMs?: number }): Promise<ScrapedPage | null>;
}

// external-links.ts
export const SOCIAL_KEYS = ["facebook", "twitter", "linkedin", "instagram", "youtube", "tiktok"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];
export type ExternalLinks = { website: string | null; socialLinks: Partial<Record<SocialKey, string>>; email: string | null; phone: string | null };
export type Extracted = ExternalLinks & { contactUrl: string | null };
export function extractExternalLinks(page: ScrapedPage): Extracted;
export function cleanWebsiteUrl(url: string | null | undefined): string | null;
export function websiteFromSlug(slug: string | null | undefined): string | null;

// enrich.ts
export type EnrichStatus = "enriched" | "empty" | "skipped" | "failed";
export function resolveExternalLinks(fc: FirecrawlLike, target: { website: string | null; slug: string | null }, opts?: { timeoutMs?: number }): Promise<ExternalLinks | null>;
export function enrichBusinessLinks(db: Db, fc: FirecrawlLike, businessId: string, opts?: { now?: Date; timeoutMs?: number }): Promise<{ status: EnrichStatus; business: Business }>;
export function enrichPendingLinks(db: Db, fc: FirecrawlLike, opts: { limit: number; budgetMs: number; ids?: string[]; concurrency?: number; now?: () => number }): Promise<{ enriched: number; empty: number; failed: number; remaining: number }>;
```

`scrapeTrustpilotCategory` → `{ inserted, seen, insertedIds: string[] }`.
Cron JSON gains `links: { enriched, empty, failed, remaining } | { skipped } | { error }`.
Existing action signatures and `discovery-bridge.ts` exports do not change.

## Files

May edit or create: `src/lib/firecrawl/**`, `src/features/discovery/**`,
`src/app/api/cron/daily/route.ts`, `scripts/enrich-links.ts`, `package.json`
(one `scripts` entry), `src/db/repo/discovery.ts` (add query helpers only),
`tests/firecrawl.test.ts`, `tests/discovery-actions.test.ts`,
`tests/discovery.test.ts`, `tests/helpers/fake-firecrawl.ts`, new
`tests/external-links*.test.ts` and `tests/enrich*.test.ts`.

Must not touch (uncommitted local work exists on the main checkout; a branch
that touches any of these cannot be merged): `src/app/calling/**`,
`src/app/globals.css`, `src/app/lookup/page.tsx`, `src/components/leads/**`,
`src/components/lookup/**`, `src/db/repo/call-campaigns.ts`,
`src/db/repo/leads.ts`, `src/features/calling/**`, `src/features/leads/**`,
`src/features/lookup/actions.ts`, `src/features/lookup/data.ts`,
`src/lib/supabase/server.ts`, `tests/calling-actions.test.ts`,
`tests/leads-actions.test.ts`, `tests/leads-ui.test.tsx`,
`tests/lookup-ui.test.tsx`, `tests/routes-render.test.tsx`, any `loading.tsx`,
`src/components/shell/page-skeleton.tsx`, `src/db/schema.ts`, `drizzle/**`.

If a test outside your list breaks because of your change (for example a cron
test in another file), report it under "Needs PM decision" instead of editing
an off-limits file.

## Acceptance criteria

AC-17.1 `extractExternalLinks` on a fixture of a real homepage's link list
        returns facebook, twitter, instagram, youtube and tiktok profile URLs
        under those keys; `x.com` and `twitter.com` both map to `twitter`.
        Proof: unit tests.
AC-17.2 Share/intent links, bare platform roots, `javascript:`/`data:` values
        and look-alike hosts (`facebook.com.evil.test`) are never returned.
        Proof: unit tests.
AC-17.3 `cleanWebsiteUrl` drops `utm_*` parameters and fragments and returns
        null for non-http(s) input; `websiteFromSlug("acme.com")` is
        `https://acme.com`; null for a slug without a dot. Proof: unit tests.
AC-17.4 After `scrapeUrlAction` with the fake Firecrawl, the stored row has a
        clean `website`, populated `socialLinks` and `enrichedAt` set. When
        `scrapePage` rejects, the action still returns `ok` and the profile
        data is stored. Proof: `tests/discovery-actions.test.ts`.
AC-17.5 Rows inserted by `scrapeTrustpilotCategory` have
        `website = https://<slug>` for domain-like slugs and the result lists
        `insertedIds`. Proof: `tests/firecrawl.test.ts`.
AC-17.6 `enrichPendingLinks` handles `ids` first, then never-enriched rows,
        then stale-empty rows; starts no scrape after `budgetMs`; respects
        `limit`; its counts add up to the rows attempted and `remaining` is
        the number still pending. Proof: tests with an injected clock.
AC-17.7 Enrichment never overwrites a non-empty `phone` or `email`, merges
        into existing `socialLinks`, leaves CRM fields unchanged, and stamps
        `enrichedAt` on `enriched`, `empty` and `failed`. Proof: tests.
AC-17.8 `GET /api/cron/daily` returns a `links` stage; `{ skipped }` without
        a key; a throwing `links` stage leaves `campaigns`, `emails` and
        `sync` intact. Proof: tests.
AC-17.9 `npm run typecheck`, `npm run lint` (0 warnings), `npm test` all
        pass; test count ≥ the count on `main` before your first commit
        (record both numbers).
AC-17.10 `git diff --stat main...HEAD` lists no off-limits file.
AC-17.11 Live: `resolveExternalLinks` against three real business sites with
         the real key returns a website and at least one social link for at
         least two of them. Proof: the command and its output (no key).
AC-17.12 An enriched row mapped through `toLookupBusiness` resolves
         `socialLink(links, "facebook")`, `socialLink(links, "twitter", "x")`
         and `socialLink(links, "linkedin")` to non-null `https://` URLs.
         Proof: unit test.

## Delegation guidance

Good junior tasks: the unit-test matrix for `external-links.ts` once you have
written the module and a first fixture (AC-17.1 to .3); the cron-stage test
(AC-17.8) following the existing cron tests; a QA pass that walks every AC and
re-runs the three commands; the CLI script following `scripts/ingest.ts`.
Keep for yourself: the seam, the validation rules, write rules and the
budget/concurrency design in `enrich.ts`, and the action wiring.

## Reporting

Use the completion-report format from the senior brief.
