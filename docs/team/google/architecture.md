# Google Maps discovery — System architecture

Read with `docs/team/google/spec.md`. Interfaces in this file are frozen:
seniors build to them and report problems instead of changing them.

## Overview

```
 /searches/new (Google tab)        npm run google:search        /api/cron/daily
        │ preview / start                 │                           │ continue
        ▼                                 ▼                           ▼
 features/google/actions ───────► features/google/run.ts  ◄──────────┘
        (WP-20)                    runGoogleJobSlice (WP-18)
                                          │
              ┌───────────────────────────┼─────────────────────────────┐
              ▼                           ▼                             ▼
   lib/google-places/client      lib/google-places/normalize     db/repo/google.ts
   Text Search (New), usage      place → NewBusiness, name        upsert, cross-source
   cap, typed errors             cleaning, category map           match, api_usage
              │                                                         │
              ▼                                                         ▼
   places.googleapis.com                                   businesses, search_jobs,
                                                           api_usage, review_snapshots
                                                                        │
                                   qualifyOne (existing engine + duplicate_website /
                                   duplicate_email, WP-18) ─────────────┤
                                                                        ▼
                         enrichPendingLinks (existing) ◄── page source: direct fetch
                         qualify-before-enrich filter       first, Firecrawl fallback
                                   (WP-19)                         (WP-19)
```

## Components

### Places client — `src/lib/google-places/client.ts` (WP-18)
- Responsibility: one function per Google endpoint used, behind an interface
  tests can fake; typed errors; no retries beyond one for 5xx/network.
- Depends on: `fetch`, `env`.

### Plan — `src/lib/google-places/{niches,zips,plan}.ts` (WP-18)
- Responsibility: niches, offline zip resolution, plan and cost arithmetic,
  limits.

### Normalise — `src/lib/google-places/{normalize,clean-name,categories}.ts` (WP-18)
- Responsibility: pure functions from a Google place to a `NewBusiness`.

### Storage — `src/db/repo/google.ts`, `src/db/schema.ts`, `drizzle/0005_*.sql` (WP-18)
- Responsibility: schema, upsert by place id, cross-source matching, monthly
  usage counter, job lease.

### Runner — `src/features/google/run.ts` (WP-18)
- Responsibility: run one slice of a Google job inside a time budget.

### Duplicate flags — `src/lib/domain.ts`, `src/lib/qualify/index.ts`, `src/features/ingest/context.ts` (WP-18)
- Responsibility: `duplicate_website` and `duplicate_email` hard reasons.

### Page source — `src/lib/web/**`, `src/lib/firecrawl/enrich.ts` (WP-19)
- Responsibility: direct HTTP page fetch with SSRF guards, composed in front
  of Firecrawl behind the existing `FirecrawlLike.scrapePage` seam.

### UI, actions, cron — `src/features/google/{actions,server-actions}.ts`, `src/features/searches/**`, `src/app/searches/**`, lookup components, `src/app/api/cron/daily/route.ts` (WP-20)

## Data model

Migration `drizzle/0005_<name>.sql`, generated with `npm run db:generate`
(WP-18). Additive only; existing rows are untouched.

```ts
// enum
businessSourceEnum: ["yelp", "trustpilot", "google"]

// businesses: new columns
googlePlaceId: text("google_place_id").unique(),     // Places API place id
googleMapsUrl: text("google_maps_url"),              // places.googleMapsUri
/** Host of `website` without scheme, "www." or path, lower case; null when
 *  empty. Postgres generated column so every writer keeps it in step. */
websiteDomain: text("website_domain").generatedAlwaysAs(sql`…`),
// + index on website_domain, + index on lower(email)

// search_jobs: new columns
source: businessSourceEnum("source").notNull().default("yelp"),
plan: jsonb("plan").$type<GooglePlan>(),             // null for Yelp jobs
queriesTotal: integer("queries_total").notNull().default(0),
queriesDone: integer("queries_done").notNull().default(0),
newCount: integer("new_count").notNull().default(0),       // rows inserted
matchedCount: integer("matched_count").notNull().default(0), // attached to a Yelp/Trustpilot row
leaseExpiresAt: ts("lease_expires_at"),

// new table
apiUsage = pgTable("api_usage", {
  provider: text("provider").notNull(),   // "google_places" | "google_geocoding"
  period: text("period").notNull(),       // "YYYY-MM", UTC
  requests: integer("requests").notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.provider, t.period] })]);
```

If a generated column proves unworkable on PGlite or in drizzle-kit, WP-18
may maintain `website_domain` in application code instead, and must then say
so in its report so WP-19's writers are checked at integration.

How a Google job uses the existing `search_jobs` columns:

| Column | Google job |
|---|---|
| `term` | niche label, or the first term for custom terms |
| `location` | area label; ends in `, ST` when every zip is in one state (the engine's out-of-area rule reads it), e.g. `Dallas, TX` or `12 zips, TX` |
| `categoryAliases` | the niche's accepted Google types (drives `category_mismatch`); `[]` for custom terms |
| `radiusM`, `maxResults` | defaults, unused |
| `fetchedCount` | distinct places processed |
| `qualifiedCount` / `reviewCount` / `rejectedCount` | as today |
| `apiCalls` | Google requests made by this job |
| `status` | `pending` → `running` → `completed` or `failed` |
| `error` | failure message; with `status = running` it is the pause reason (cap reached, rate limited) and is cleared when a slice next makes progress |

```ts
export type GooglePlan = {
  nicheId: string | null;
  terms: string[];                 // 1..12, trimmed, lower case, unique
  zips: string[];                  // 1..200 five-digit strings, unique, sorted
  areaLabel: string;
  acceptTypes: string[];           // Google place types; [] = no category rule
  maxPagesPerQuery: 1 | 2 | 3;
  saturated: { term: string; zip: string }[];             // filled every page
  errors: { term: string; zip: string; message: string }[]; // skipped searches, last 50
};
```

Search `i` (0-based, `i < terms.length × zips.length`) is
`zips[Math.floor(i / terms.length)]` with `terms[i % terms.length]`.
`queriesDone` is the index of the next search to run.

## Interfaces

### Environment (`src/lib/env.ts`, WP-18)
```ts
GOOGLE_PLACES_API_KEY?: string;            // absent → Google search disabled
GOOGLE_GEOCODING_API_KEY?: string;         // getter falls back to GOOGLE_PLACES_API_KEY
GOOGLE_PLACES_MONTHLY_REQUEST_CAP: number; // default 1000, minimum 0
```

### Places client (WP-18)
```ts
export type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | string;
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  pureServiceAreaBusiness?: boolean;
};

export type TextSearchRequest = {
  textQuery: string;
  pageToken?: string;
  /** Circle around the zip centre. */
  locationBias?: { latitude: number; longitude: number; radiusM: number };
  regionCode?: string;   // "US"
};

export interface PlacesClient {
  searchText(req: TextSearchRequest): Promise<{ places: GooglePlace[]; nextPageToken: string | null }>;
  /** Requests sent by this client instance. */
  readonly callCount: number;
}

/** `POST https://places.googleapis.com/v1/places:searchText`, headers
 *  `X-Goog-Api-Key` and `X-Goog-FieldMask: TEXT_SEARCH_FIELD_MASK`. */
export function createPlacesClient(apiKey: string, opts?: { fetch?: typeof fetch }): PlacesClient;

export const TEXT_SEARCH_FIELD_MASK: string; // every GooglePlace field as `places.<field>`, plus `nextPageToken`
export const GOOGLE_NOT_CONFIGURED = "Google Maps search is not configured: set GOOGLE_PLACES_API_KEY";

export class GooglePlacesError extends Error {
  readonly httpStatus: number;
  readonly status: string;   // google.rpc status, e.g. "PERMISSION_DENIED"
  /** True when retrying cannot help: bad or restricted key, API not enabled, billing off, invalid request. */
  readonly fatal: boolean;
}
export class GoogleRateLimited extends GooglePlacesError {} // HTTP 429 / RESOURCE_EXHAUSTED
```
The field mask must not contain `reviews`, `editorialSummary` or any other
Atmosphere field. The API key is sent only in the header, never in a URL, and
never logged.

### Plan (WP-18)
```ts
export type Niche = { id: string; label: string; category: string /* one of the 22 slugs */; terms: string[]; acceptTypes: string[] };
export const NICHES: Niche[];                         // at least 20, see WP-18
export const MAX_ZIPS_PER_JOB = 200;
export const MAX_QUERIES_PER_JOB = 500;
export const MAX_TERMS_PER_JOB = 12;
export const PRICE_PER_1000_REQUESTS_USD = 35;

export type ResolvedArea = { zips: string[]; label: string; states: string[] };
/** Offline for zip lists, "City, ST" and "<zip> +<n>mi". Other text is
 *  geocoded when `opts.geocode` is given. Throws AreaError with a user-facing
 *  message when nothing resolves. */
export function resolveArea(input: string, opts?: { geocode?: (text: string) => Promise<{ latitude: number; longitude: number } | null> }): Promise<ResolvedArea>;
export function zipCentre(zip: string): { latitude: number; longitude: number } | null;

export type PlanInput = { nicheId?: string | null; terms?: string[]; area: string; maxPagesPerQuery?: 1 | 2 | 3 };
export type PlanPreview = {
  plan: GooglePlan;
  location: string;          // value for search_jobs.location
  term: string;              // value for search_jobs.term
  queries: number;
  maxRequests: number;       // queries × maxPagesPerQuery
  estMaxUsd: number;         // maxRequests × PRICE / 1000, 2 decimals
};
/** Validates and builds the plan. Throws PlanError (user-facing message,
 *  optional field name) over the limits or with no terms/zips. */
export function planGoogleSearch(input: PlanInput, opts?: Parameters<typeof resolveArea>[1]): Promise<PlanPreview>;
```

### Normalise (WP-18)
```ts
export function cleanBusinessName(raw: string, ctx?: { city?: string | null; state?: string | null }): string;
/** One of the 22 Trustpilot slugs, or null. Primary type first, then the rest. */
export function categoryForTypes(primaryType: string | null | undefined, types: string[]): string | null;
export function normalizeGooglePlace(place: GooglePlace, ctx: { jobId?: string; searchCategory: string; searchLocation: string; now?: Date }): NewBusiness & { googlePlaceId: string };
```
Row contract for a Google place:
- `source: "google"`, `googlePlaceId`, `googleMapsUrl`.
- `name` cleaned; `nameNormalized = normalizeName(name)`; the uncleaned name
  stays in `raw`.
- `phone` = international number when present, else national; `phoneDigits`
  via `phoneDigits()` so a Google number and the same number on a Yelp row
  compare equal; `displayPhone` = national number.
- `website` through `cleanWebsiteUrl` (tracking parameters dropped).
- `address1`, `city`, `state` (two-letter), `zip`, `country` from
  `addressComponents`; `latitude`, `longitude`.
- `rating` (one decimal, string), `reviewCount`.
- `isClosed = businessStatus === "CLOSED_PERMANENTLY"`.
- `primaryCategory` = `categoryForTypes(...)`; `subcategory` = primary type
  display name.
- `categories` = the top-level category first as `{ alias: slug, title: label }`
  (when resolved), then every Google type as `{ alias: type, title }`. The
  Lookup category filter and `category_mismatch` both read these aliases.
- `slug` = website host when there is one (drives the favicon logo).
- `lastScrapedAt = now`; `raw` = the place.
- No CRM fields, no qualification fields.

### Storage (WP-18)
```ts
export type GoogleUpsert = { business: Business; outcome: "created" | "updated" | "matched" };
/**
 * created: no row had this place id and nothing matched; inserted.
 * updated: a row already had this place id; Google-owned columns refreshed.
 * matched: a non-Google row without a place id matched on phoneDigits or
 *          websiteDomain; place id and Maps URL attached, only empty columns
 *          filled; source, name, rating, reviewCount, categories unchanged.
 * CRM fields are never written.
 */
export function upsertGooglePlace(db: Db, row: NewBusiness & { googlePlaceId: string }): Promise<GoogleUpsert>;

/** Atomically adds one request to this month's counter when it is below
 *  `cap`; false (nothing counted) when the cap is reached. */
export function reserveUsage(db: Db, provider: string, cap: number, now?: Date): Promise<boolean>;
export function getUsage(db: Db, provider: string, now?: Date): Promise<number>;

export function createGoogleJob(db: Db, preview: PlanPreview): Promise<SearchJob>;
/** Google jobs with status pending or running, oldest first. */
export function listUnfinishedGoogleJobs(db: Db, limit?: number): Promise<SearchJob[]>;
```

### Runner (WP-18)
```ts
export type SliceOutcome = "completed" | "more" | "busy" | "capped" | "rate_limited" | "failed";
/**
 * Runs searches from `queriesDone` until the job is done or `budgetMs` is
 * nearly spent (no search starts with under 15 s left). Takes the job lease
 * (120 s, renewed after every search) and releases it on exit.
 *   busy         another slice holds the lease; nothing done
 *   capped       monthly cap reached; status stays running, error = pause reason
 *   rate_limited Google answered 429; same search is retried by the next slice
 *   failed       fatal GooglePlacesError; status failed, error set
 *   more         budget spent with searches left; status running
 *   completed    every search done; status completed, finishedAt set
 * Per place: skip ids already handled in this slice, normalise, upsert,
 * snapshot (R17), qualifyOne. Counters and `queriesDone` are persisted after
 * every search. A non-fatal error on one search is retried once, then
 * recorded in `plan.errors` and the job moves on.
 */
export function runGoogleJobSlice(
  db: Db,
  client: PlacesClient,
  jobId: string,
  opts: { budgetMs: number; cap?: number; now?: () => number },
): Promise<{ job: SearchJob; outcome: SliceOutcome }>;
```

### Duplicate flags (WP-18)
```ts
// src/lib/domain.ts
/** "https://www.Acme.com/x" → "acme.com"; null for empty or unparsable. */
export function websiteDomain(url: string | null | undefined): string | null;
/** True for hosts many unrelated businesses share (facebook.com, instagram.com,
 *  linktr.ee, yelp.com, google.com, business.site, wixsite.com, squarespace.com,
 *  godaddysites.com, weebly.com, …) and their subdomains. */
export function isSharedHost(domain: string): boolean;

// src/lib/qualify/index.ts
type QualifyContext = { /* existing */ websiteDuplicate: boolean; emailDuplicate: boolean };
type ReasonCode = /* existing */ | "duplicate_website" | "duplicate_email";
// HARD_REASONS order: …, "duplicate_phone", "duplicate_website", "duplicate_email"
```
"Duplicate" means an earlier-ingested other row has the same value, by the
same `(createdAt, ORDER_KEY)` ordering as `hasEarlierPhoneDuplicate`. Website
compares `website_domain` and never fires for a shared host. Email compares
`lower(email)`.

### Page source (WP-19)
```ts
// src/lib/web/fetch-page.ts
/** Direct GET of an HTML page as a ScrapedPage (links + text in `markdown`).
 *  Null when the response is not usable HTML. Rejects on transport failure,
 *  non-2xx, timeout, or a refused address (UnsafeUrlError). */
export function fetchPage(url: string, opts?: { timeoutMs?: number; fetch?: typeof fetch; lookup?: (host: string) => Promise<string[]> }): Promise<ScrapedPage | null>;
export class UnsafeUrlError extends Error {}

// src/lib/web/page-source.ts
/** A FirecrawlLike whose scrapePage tries `fetchPage` first and falls back to
 *  `firecrawl.scrapePage` when it is given and the direct fetch rejects,
 *  returns null, or returns a thin page. scrapeJson passes through to
 *  Firecrawl and rejects with DiscoveryUnavailable without one. */
export function createPageSource(opts: { firecrawl?: FirecrawlLike | null; direct?: typeof fetchPage }): FirecrawlLike;
```
`enrichBusinessLinks` and `enrichPendingLinks` keep their signatures.
Every caller that enriches links builds its `FirecrawlLike` with
`createPageSource`, and no longer requires `FIRECRAWL_API_KEY` for the links
step (Trustpilot scraping still does).

Pending-links rule (WP-19, `pendingLinksWhere`): a row is not pending when
`qualification = 'rejected'` and its `rejection_reasons` contain any code other
than `no_phone`, `unclaimed`, `low_score`.

### Actions and routes (WP-20)
```ts
// src/features/google/server-actions.ts ("use server"), re-exported by ./actions
previewGoogleSearchAction(input: PlanInput): Promise<ActionResult<{ preview: Omit<PlanPreview, "plan"> & { terms: string[]; zipCount: number; areaLabel: string }; usedThisMonth: number; cap: number }>>;
startGoogleSearchAction(prev: ActionResult<{ jobId: string }> | null, formData: FormData): Promise<ActionResult<{ jobId: string }>>;
continueGoogleSearchAction(jobId: string): Promise<ActionResult<{ outcome: SliceOutcome | "queued" }>>;
rerunGoogleSearchAction(jobId: string): Promise<ActionResult<{ jobId: string }>>;
// src/features/google/actions.ts
googleConfigured(): boolean;
```
All four call `requireUser()` first. Start and continue run slices behind
`after()` with a 240 s total budget; the response returns at once.
`GET /api/searches/[id]` (existing) returns the job row including the new
columns; the job page polls it.

Cron (`/api/cron/daily`): a `google` stage after `emails`, 60 s budget,
continues unfinished Google jobs oldest first; response key
`google: { jobs: number; searches: number; outcome: … } | { skipped: string }`.

### CLI (WP-18)
```
npm run google:search -- --niche roofing --area "75201,75202" [--terms "a,b"] [--max-pages 3] [--dry-run]
npm run google:search -- --probe "roofer 75201"     # one request, prints mapped rows, writes nothing
npm run google:search -- --resume <jobId>
```

## Technology choices
| Concern | Choice | Why |
|---|---|---|
| Google access | Places API (New) Text Search over `fetch` | Official, key supplied, no SDK needed |
| Zip data | Bundled offline dataset, server only | No per-plan API cost; resolves "City, ST" |
| Long jobs | Slices + DB lease | Fits a 300 s function; no queue service |
| Spend control | `api_usage` counter with atomic reserve | One guard for every caller |
| Website fetch | Node `fetch` with DNS check | Free and fast; Firecrawl stays as fallback |

## Cross-cutting conventions
- Node 24 (`export PATH=/opt/node24/bin:$PATH`), `npm ci`, `npm test`
  (Vitest, PGlite), `npm run typecheck`, `npm run lint`, `npm run build`.
- Read `AGENTS.md`: this Next.js version differs from older ones; check
  `node_modules/next/dist/docs/` before writing route or action code.
- Repos take a `Db` first; pure logic takes no `Db`; network clients are
  injected so tests use fakes (`tests/helpers/fake-yelp.ts` is the pattern).
- Server actions return `ActionResult` (`src/lib/action-result.ts`).
- No secret in logs, URLs, test fixtures or committed files.
- Tests live in `tests/*.test.ts(x)`; helpers in `tests/helpers/`.
- No new runtime dependency without saying so in the report. WP-19 adds none.

## Deliberately undecided
- The zip dataset and how it is stored (WP-18).
- The exact text query format and bias radius; default `"<term> <zip>"` with
  an 8 km circle, to be confirmed by the live probe (WP-18).
- Name-cleaning rules beyond the cases in the package (WP-18).
- HTML link and text extraction technique; thin-page threshold; direct-fetch
  concurrency and the cron's link limits (WP-19).
- Layout of the Google form and job page within the existing design system
  (WP-20).
