# Leadwire v2 — Architecture delta

This document amends `docs/team/architecture.md` (v1). Everything not mentioned here is unchanged. Interfaces below are frozen for the v2 packages.

## Components (new or changed)
| Component | Lives in | Owner |
|---|---|---|
| Theme + shell + auth | `src/app/globals.css`, `src/app/layout.tsx`, `src/components/shell/**`, `src/components/ui/**`, `src/components/primitives/**` (restyle), `src/lib/supabase/**`, `src/proxy.ts`, `src/app/login/**`, `src/app/signup/**`, `src/app/api/auth/**`, `public/logo.png` | WP-11 |
| Data model v2 + repos + test-data removal | `src/db/**`, `drizzle/**`, `src/lib/yelp/**`, `src/lib/qualify/**`, `src/lib/env.ts`, `src/lib/velocity.ts`, `src/lib/labels.ts`, `.env.example`, `scripts/**`, `tests/**` | WP-12 |
| Trustpilot discovery (Firecrawl) | `src/lib/firecrawl/**`, `src/lib/trustpilot-categories.ts`, `src/features/discovery/**`, `src/app/api/cron/daily/**`, `vercel.json` | WP-13 |
| Lookup UI | `src/app/lookup/**`, `src/app/api/lookup/**`, `src/features/lookup/**`, `src/components/lookup/**` | WP-14 |
| Leads UI | `src/app/leads/**`, `src/features/leads/**`, `src/components/leads/**`, `src/lib/export-csv.ts` | WP-15 |
| Restyle + integration | all remaining `src/app/**` pages, `src/features/**` components, `src/components/command-palette.tsx`, `docs/deploy.md` | WP-16 |

## Data model delta (Drizzle, `src/db/schema.ts`; migration `drizzle/0001_v2.sql`)
```ts
export const businessSourceEnum = pgEnum('business_source', ['yelp', 'trustpilot']);
export const leadStatusEnum = pgEnum('lead_status', ['queued', 'contacted', 'callback', 'success', 'failed', 'skipped']);

// businesses — changes
yelpId: text('yelp_id').unique()                 // now NULLABLE (trustpilot rows have none)
source: businessSourceEnum('source').notNull().default('yelp')
trustpilotId: text('trustpilot_id').unique()     // = trustpilot slug (e.g. "acme.com")
slug: text('slug')                                // domain-like slug used for favicon/trustpilot links
email: text('email')
logoUrl: text('logo_url')
socialLinks: jsonb('social_links').$type<Record<string, string>>().notNull().default({})
reviewsLast30d: integer('reviews_last_30d').notNull().default(0)   // "velocity"
trustScore: numeric('trust_score', { precision: 3, scale: 1 })
aiSummary: text('ai_summary')
hasMetaAds: boolean('has_meta_ads').notNull().default(false)
subcategory: text('subcategory')
lastScrapedAt: timestamp('last_scraped_at', { withTimezone: true })
// existing columns reused for Trustpilot rows: name=display_name, phone, website, rating=star_rating, reviewCount=total_reviews,
// primaryCategory=category, city=location_city, country=location_country, raw=raw_data, categories=[{alias,title}] built from category/subcategory
// indexes: source, trustpilotId (unique), reviewsLast30d

export const businessRelations = pgTable('business_relations', {
  id uuid pk, sourceBusinessId uuid fk businesses cascade not null, targetBusinessId uuid fk businesses cascade not null,
  relationType text not null default 'similar', createdAt
}, unique(sourceBusinessId, targetBusinessId), index(targetBusinessId));

export const reviewSnapshots = pgTable('review_snapshots', {
  id uuid pk, businessId uuid fk businesses cascade not null, totalReviews integer not null default 0, capturedAt timestamptz not null default now()
}, index(businessId, capturedAt desc));

export const leads = pgTable('leads', {
  id uuid pk, userId uuid not null /* Supabase auth user id; no FK (auth schema) */, businessId uuid fk businesses cascade not null,
  status leadStatusEnum not null default 'queued', notes text, createdAt, updatedAt
}, unique(userId, businessId), index(userId, status));
```
Types exported: `BusinessSource`, `LeadStatus`, `Lead`, `NewLead`, `BusinessRelation`, `ReviewSnapshot`.

## Auth (WP-11) — `src/lib/supabase/*`
```ts
// config.ts — NEXT_PUBLIC vars must be referenced literally
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// client.ts (browser)   export function createClient(): SupabaseClient
// server.ts (RSC/actions/route handlers)
export async function createClient(): Promise<SupabaseClient>;      // cookie-backed, @supabase/ssr
export type AuthUser = { id: string; email: string | null };
export async function getUser(): Promise<AuthUser | null>;
export async function requireUser(): Promise<AuthUser>;             // redirect('/login') when absent
// middleware.ts   export async function updateSession(req: NextRequest): Promise<NextResponse>  // refresh + redirects per spec R3
```
`src/proxy.ts` delegates to `updateSession`. Exempt paths: `/login`, `/signup`, `/api/auth/*`, `/api/cron/*`, `/_next/*`, static files. The v1 `APP_PASSWORD` gate, `/api/auth/login|logout`, and `crm_session` cookie are deleted. Local dev without Supabase env: `getUser()` returns `null` and middleware redirects to `/login`; tests never import these modules.

## Repos (WP-12) — frozen
```ts
// src/db/repo/leads.ts
export type LeadWithBusiness = Lead & { business: Business };
export async function listLeads(db, userId: string, f?: { status?: LeadStatus[]; q?: string; category?: string }): Promise<LeadWithBusiness[]>;   // newest first
export async function getLead(db, userId, id): Promise<LeadWithBusiness | null>;
export async function addLead(db, userId, businessId): Promise<{ lead: Lead; created: boolean }>;                 // idempotent per (user, business)
export async function addLeads(db, userId, businessIds: string[]): Promise<{ added: number; existing: number }>;
export async function updateLead(db, userId, id, patch: { status?: LeadStatus; notes?: string | null }): Promise<Lead | null>;
export async function removeLead(db, userId, id): Promise<boolean>;
export async function countLeadsByStatus(db, userId): Promise<Record<LeadStatus, number>>;
export async function leadBusinessIds(db, userId): Promise<string[]>;
export async function syncLeadStatusFromOutcome(db, businessId, outcome: CallOutcome): Promise<number>;   // maps dialer outcomes → lead status for every user's lead on that business (interested→success, not_interested|wrong_number→failed, callback→callback, no_answer|voicemail|busy→contacted, do_not_call→skipped)

// src/db/repo/discovery.ts
export async function upsertBusinessByTrustpilotId(db, row: NewBusiness & { trustpilotId: string }): Promise<{ business: Business; created: boolean }>;  // never overwrites CRM fields
export async function getBusinessByTrustpilotId(db, trustpilotId): Promise<Business | null>;
export async function addRelation(db, sourceId, targetId, type = 'similar'): Promise<void>;          // ignore duplicates
export async function listRelations(db): Promise<{ source: string; target: string }[]>;
export async function relatedBusinesses(db, id): Promise<Business[]>;                                // both directions, distinct
export async function addSnapshot(db, businessId, totalReviews, capturedAt?: Date): Promise<void>;
export async function listSnapshots(db, businessId): Promise<ReviewSnapshot[]>;                      // oldest first
export async function listStaleBusinesses(db, opts: { olderThanHours: number; limit: number; source?: BusinessSource }): Promise<Business[]>;  // lastScrapedAt null first
export type GraphNode = { id: string; name: string; category: string | null; totalReviews: number; rating: number | null; reviewsLast30d: number };
export async function listGraphNodes(db, limit = 1000): Promise<GraphNode[]>;

// src/db/repo/businesses.ts — BusinessFilter gains: source?: BusinessSource; minReviews?: number; maxReviews?: number; minL30d?: number; maxL30d?: number; minRating?: number; and `q` also matches slug/website. BusinessSort gains 'reviewsLast30d'.
// src/lib/velocity.ts
export type VelocityTier = 'HIGH' | 'MED' | 'LOW';
export function velocityTier(l30d: number): VelocityTier;   // ≥50 HIGH, ≥20 MED, else LOW
```
Qualification (WP-12 edit in `src/lib/qualify`): rule `category_mismatch` is skipped when `ctx.categoryAliases` is empty; `out_of_area` is skipped when `distanceM` is null and `locationState` is null (already true). `qualifyOne` builds `categoryAliases = []` for `source = 'trustpilot'`.

## Discovery (WP-13) — frozen
```ts
// src/lib/firecrawl/client.ts
export interface FirecrawlLike { scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null>; }
export function createFirecrawl(apiKey?: string): FirecrawlLike;   // throws DiscoveryUnavailable('FIRECRAWL_API_KEY is not set') on use when missing
export class DiscoveryUnavailable extends Error {}
// src/lib/firecrawl/trustpilot.ts
export type TrustpilotProfile = { displayName; websiteUrl?; phone?; email?; locationCity?; locationCountry?; categories: string[]; numberOfReviews: number; stars?: number; trustScore?: number; relatedBusinessSlugs: string[]; socialLinks: Record<string,string>; numberOfVisibleReviews?: number; oldestVisibleReviewDate?: string };
export function slugFromTrustpilotUrl(url: string): string | null;    // https://www.trustpilot.com/review/<slug>
export function computeVelocity(args: { snapshots: ReviewSnapshot[]; current: number; now: Date; visible?: number; oldestVisibleDate?: string }): number;   // §gtm velocity rules
export async function scrapeTrustpilotBusiness(db, fc: FirecrawlLike, url: string, now?: Date): Promise<Business>;  // upsert, snapshot, velocity, relations to existing slugs, qualifyOne
export async function scrapeTrustpilotCategory(db, fc, categorySlug: string, opts?: { max?: number; limiter?: RateLimiter }): Promise<{ inserted: number; seen: number }>;
export async function enrichFromWebsite(db, fc, businessId): Promise<Business>;
export async function syncStale(db, fc, opts: { limit: number; budgetMs: number; now?: Date }): Promise<{ scraped: number; failed: number; remaining: number }>;
// src/lib/firecrawl/rate-limiter.ts   export class RateLimiter { constructor(concurrency: number, delayMs: number); run<T>(fn: () => Promise<T>): Promise<T> }
// src/lib/trustpilot-categories.ts    export const TRUSTPILOT_CATEGORIES: { slug: string; label: string }[]  (the 22 from gtm lib/constants.ts)
// src/features/discovery/actions.ts
export async function scrapeUrlAction(url: string): Promise<ActionResult<{ businessId: string; name: string }>>;
export async function seedCategoryAction(slug: string): Promise<ActionResult<{ inserted: number; seen: number }>>;
export async function enrichTrustpilotAction(businessId: string): Promise<ActionResult<Business>>;
export function discoveryConfigured(): boolean;   // !!env.FIRECRAWL_API_KEY
// GET /api/cron/daily  (bearer CRON_SECRET): evaluateAllCampaigns + processAllDue(email) + syncStale({limit: 12, budgetMs: 30000}) + (Sundays) seed all categories with max 20 each; returns the counts. vercel.json: single cron `0 13 * * *`. The two v1 cron routes remain callable.
```

## Lookup (WP-14) consumes
`listBusinesses` (filters above), `countByQualification`, `listCategories`, `listGraphNodes`, `listRelations`, `getBusiness`, `relatedBusinesses`, `addLead` (via `src/features/leads/actions.ts` `addLeadAction` — WP-15 owns; WP-14 calls `addLead` through its own thin action `addToLeadsAction(businessId)` to avoid a wave dependency), `scrapeUrlAction`, `seedCategoryAction`, `discoveryConfigured`, `velocityTier`, `REASON_LABELS`.
Routes: `/lookup` (URL params `search, category, source, minReviews, minL30d, minRating, hasPhone, offset`), `GET /api/lookup/graph` → `{ nodes: GraphNode[], links: {source,target}[] }`.

## Leads (WP-15) consumes
`listLeads`, `updateLead`, `removeLead`, `addLeads`, `countLeadsByStatus`, `addBusinessesToCampaign` (call), `enrollBusinesses` (email), `listCallCampaigns`, `listEmailCampaigns`, `listActivities` (type 'call') for the user's lead businesses, `requireUser`.
Routes: `/leads`. Actions: `updateLeadAction(id, patch)`, `removeLeadAction(id)`, `bulkRemoveLeadsAction(ids)`, `addLeadsToCallCampaignAction(campaignId, leadIds)`, `addLeadsToEmailCampaignAction(campaignId, leadIds)`.
Dialer hook: WP-15 adds a call to `syncLeadStatusFromOutcome` inside `recordOutcome`'s caller? No — WP-12 adds that call inside `src/db/repo/call-campaigns.ts recordOutcome` (WP-12 owns `src/db/**` in wave 1), guarded so it is a no-op when no leads exist.

## Routes (v2)
| Route | Owner |
|---|---|
| `/` → redirect `/lookup` | WP-11 |
| `/login`, `/signup`, `/api/auth/callback` | WP-11 |
| `/lookup`, `/api/lookup/graph` | WP-14 (WP-11 ships a placeholder page) |
| `/leads` | WP-15 (WP-11 ships a placeholder page) |
| `/overview` (v1 dashboard moved) | WP-16 |
| `/businesses/**`, `/searches/**`, `/calling/**`, `/email/**`, `/settings/**`, `/design` | unchanged routes, restyled by WP-16 |
| `/api/cron/daily` | WP-13 |

## Env (v2) — `src/lib/env.ts` (WP-12) + literal NEXT_PUBLIC reads (WP-11)
`DATABASE_URL`, `PGLITE_DATA_DIR`, `YELP_API_KEY?` (no fixture mode; absent → Yelp disabled with a notice), `FIRECRAWL_API_KEY?` (absent → discovery disabled with a notice), `CRON_SECRET?`, `RESEND_API_KEY?`, `EMAIL_FROM`, `APP_TIMEZONE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL?`. Removed: `APP_PASSWORD`, `APP_SESSION_SECRET`, `YELP_MODE`.

## Cross-cutting conventions (additions)
- Dark only: `<html lang="en" class="dark">`; no ThemeProvider toggle. Keep `next-themes` out.
- Every page under the shell calls `requireUser()` (server) once; client components receive `userId` via props when needed.
- Server actions that touch leads take the user from `requireUser()`, never from the client.
- Copy tone: Leadwire's ("INTEL BRIEF", uppercase micro-labels). No placeholder text that pretends to be data; show real timestamps or "NO DATA".
- Tests: node env for repos (PGlite via `createTestDb`), jsdom for components; builders in `tests/helpers/builders.ts` (`makeYelpBusiness(overrides)`, `makeTrustpilotProfile(overrides)`, `makeBusinessRow(overrides)`), `tests/helpers/fake-firecrawl.ts`.

## Deliberately undecided
- WP-11: exact port fidelity of the auth header vs. a shared `Brand` component; how primitives map `tone` to the single-accent palette (success/warning may both be blue tints, as in gtm, or use restrained greens/ambers).
- WP-13: JSON schema wording for Firecrawl extraction; retry policy; whether category seed uses `after()` chaining (the daily cron already time-boxes).
- WP-14: d3 implementation details, whether graph data is fetched client-side (SWR/fetch to `/api/lookup/graph`) or server-rendered.
- WP-15: notes editing UX (inline vs. side panel); CSV columns.
- WP-16: how the five top-bar items collapse on phones (a menu), chart palette on the blue ramp.
