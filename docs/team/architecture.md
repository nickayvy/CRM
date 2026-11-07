# Local Business CRM — System architecture

## Overview

```
                 ┌──────────────────────────────────────────────────────┐
  Yelp Fusion ──▶│ Ingestion (src/lib/yelp, src/features/ingest)        │
  (or fixtures)  │   search job → page results → upsert → qualify       │
                 └───────────────┬──────────────────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────────────────┐
                 │ Postgres (Supabase in prod, PGlite locally/tests)    │
                 │ businesses · activities · rules · search_jobs        │
                 │ call_campaigns · call_queue_items                    │
                 │ email_campaigns · email_steps · enrollments · msgs   │
                 └───────┬──────────────────┬──────────────────┬────────┘
                         ▼                  ▼                  ▼
                 Businesses UI        Calling UI          Email UI
                 (table, detail,      (campaigns, dialer, (campaigns, steps,
                  searches, rules)     queue, cron)        enrollments, cron)
                         └──────────────────┴──────────────────┘
                                 Dashboard · Cmd-K · Shell
                     all built on src/components/primitives + src/lib/motion
```

Next.js App Router app. Server Components read through repository
functions; Server Actions write. No client-side data fetching except
polling a job/campaign status endpoint. One Postgres schema managed by
Drizzle migrations, run against PGlite when `DATABASE_URL` is unset.

## Components

### App shell and auth gate — `src/app/layout.tsx`, `src/components/shell/**`, `src/proxy.ts`
- Responsibility: sidebar/topbar navigation, mobile collapse, theme toggle,
  command-palette slot, optional shared-password gate.
- Exposes: `<AppShell>`; `/login` route; middleware that redirects to
  `/login` when `APP_PASSWORD` is set and the session cookie is missing.

### Database layer — `src/db/**`, `drizzle/**`
- Responsibility: schema, migrations, client factory, seed, test utils,
  shared tiny repos (activities, rules).
- Exposes: `getDb()`, `createTestDb()`, `runMigrations(db)`, `seed(db)`,
  `activitiesRepo`, `rulesRepo`, all table types.

### Yelp client — `src/lib/yelp/**`
- Responsibility: typed Fusion v3 client with paging, retry, budget; fixture
  adapter; normalization into `NewBusiness` rows.
- Exposes: `YelpClient` interface, `createYelpClient(env)`, `normalizeYelpBusiness()`.

### Qualification engine — `src/lib/qualify/**`
- Responsibility: pure functions from (business, context, rules, db lookups)
  to `{ qualification, score, reasons }`.
- Exposes: `qualify()`, `scoreBusiness()`, `REASON_LABELS`.

### Ingestion — `src/features/ingest/**`, `src/db/repo/search-jobs.ts`, `src/db/repo/businesses.ts`
- Responsibility: run search jobs, upsert, qualify, enrich, requalify.
- Exposes: `runSearchJob()`, `enrichBusiness()`, `requalifyAll()`, server
  actions `startSearchAction`, `enrichAction`, `requalifyAllAction`.

### Design system — `src/components/primitives/**`, `src/components/ui/**`, `src/lib/motion/**`, `src/app/design/**`
- Responsibility: every reusable visual building block and the animation
  system; dark mode tokens; showcase route.

### Businesses UI — `src/app/businesses/**`, `src/app/searches/**`, `src/app/settings/**`, `src/features/businesses/**`, `src/features/searches/**`, `src/features/rules/**`

### Calling — `src/app/calling/**`, `src/app/api/cron/campaigns/**`, `src/features/calling/**`, `src/db/repo/call-campaigns.ts`

### Email — `src/app/email/**`, `src/app/api/cron/email/**`, `src/features/email/**`, `src/db/repo/email-campaigns.ts`, `src/lib/email/**`

### Dashboard and integration — `src/app/page.tsx`, `src/features/dashboard/**`, `src/db/repo/dashboard.ts`, `src/db/repo/search.ts`, `src/components/command-palette.tsx`

## Data model

Drizzle schema in `src/db/schema.ts`. Postgres dialect. All ids `uuid`
with `defaultRandom()`. All timestamps `timestamptz`. `createdAt` /
`updatedAt` on every mutable table (`updatedAt` maintained by the repo
layer, not triggers).

```ts
// enums
export const qualificationEnum = pgEnum('qualification', ['qualified', 'review', 'rejected']);
export const businessStatusEnum = pgEnum('business_status',
  ['new', 'contacted', 'interested', 'callback', 'not_interested', 'do_not_call', 'converted']);
export const activityTypeEnum = pgEnum('activity_type', ['note', 'call', 'email', 'status_change', 'system']);
export const jobStatusEnum = pgEnum('job_status', ['pending', 'running', 'completed', 'failed']);
export const campaignStatusEnum = pgEnum('campaign_status', ['draft', 'running', 'paused', 'completed']);
export const pauseReasonEnum = pgEnum('pause_reason', ['manual', 'daily_cap', 'outside_hours', 'exhausted']);
export const queueStateEnum = pgEnum('queue_state', ['pending', 'claimed', 'completed', 'skipped', 'callback']);
export const callOutcomeEnum = pgEnum('call_outcome',
  ['no_answer', 'voicemail', 'busy', 'interested', 'not_interested', 'callback', 'wrong_number', 'do_not_call']);
export const enrollmentStateEnum = pgEnum('enrollment_state',
  ['active', 'completed', 'replied', 'unsubscribed', 'bounced', 'paused']);
export const messageStatusEnum = pgEnum('message_status', ['queued', 'sent', 'failed', 'dry_run']);

// search_jobs
id, term text, location text not null, categoryAliases text[] not null,
radiusM integer not null default 20000, maxResults integer not null default 200,
status job_status not null default 'pending', fetchedCount int default 0,
qualifiedCount int default 0, reviewCount int default 0, rejectedCount int default 0,
apiCalls int default 0, error text, startedAt, finishedAt, createdAt

// businesses
id, yelpId text unique not null, yelpAlias text, name text not null,
nameNormalized text not null,          // lowercased, punctuation stripped, legal suffixes (llc, inc, co, corp, ltd) removed, whitespace collapsed
phone text,                             // E.164 as Yelp returns, '' → null
phoneDigits text,                       // digits only, for duplicate detection; index
displayPhone text, website text, yelpUrl text, imageUrl text,
rating numeric(2,1), reviewCount integer not null default 0, price text,
categories jsonb not null $type<{alias:string; title:string}[]>(),
primaryCategory text,                   // categories[0].alias
isClosed boolean not null default false, isClaimed boolean,
address1 text, address2 text, city text, state text, zip text, country text,
latitude double precision, longitude double precision, distanceM real,
hours jsonb, photos jsonb $type<string[]>(), transactions jsonb $type<string[]>(),
raw jsonb not null, enrichedAt timestamptz,
qualification qualification not null default 'review', score integer not null default 0,
rejectionReasons text[] not null default '{}', qualifiedAt timestamptz,
status business_status not null default 'new', ownerName text, ownerEmail text,
notes text, tags text[] not null default '{}', doNotCall boolean not null default false,
doNotEmail boolean not null default false, lastContactedAt timestamptz,
nextFollowUpAt timestamptz, sourceJobId uuid references search_jobs on delete set null,
searchCategory text,                    // target alias the job searched for (first of categoryAliases)
searchLocation text, createdAt, updatedAt
indexes: phoneDigits, nameNormalized, (city, state), status, qualification, sourceJobId

// activities
id, businessId uuid references businesses on delete cascade not null,
type activity_type not null, outcome text, body text not null default '',
metadata jsonb not null default '{}', campaignType text, campaignId uuid,
agent text, occurredAt timestamptz not null default now(), createdAt
index: (businessId, occurredAt desc)

// qualification_rules (single row, id = 1)
id integer primary key default 1, minRating numeric(2,1) not null default 3.5,
minReviews integer not null default 5, maxReviews integer,
requirePhone boolean not null default true, rejectClosed boolean not null default true,
rejectChains boolean not null default true, chainPatterns text[] not null default '{}',
categoryStrict boolean not null default true, distanceTolerancePct integer not null default 10,
multiLocationThreshold integer not null default 3, reviewScoreBelow integer not null default 40,
updatedAt

// call_campaigns
id, name text not null, description text, status campaign_status not null default 'draft',
script text not null default '', dailyCap integer, callingHoursStart time, callingHoursEnd time,
timezone text not null default 'America/Chicago', maxConcurrentAgents integer not null default 5,
maxAttempts integer not null default 3, pauseReason pause_reason, autoResume boolean not null default true,
pausedAt timestamptz, createdAt, updatedAt

// call_queue_items
id, campaignId uuid references call_campaigns on delete cascade not null,
businessId uuid references businesses on delete cascade not null,
position integer not null, state queue_state not null default 'pending',
claimedBy text, claimedAt timestamptz, leaseExpiresAt timestamptz,
attempts integer not null default 0, lastOutcome call_outcome, lastOutcomeAt timestamptz,
callbackAt timestamptz, notes text, createdAt, updatedAt
unique (campaignId, businessId); index (campaignId, state, position)

// email_campaigns
id, name text not null, status campaign_status not null default 'draft',
fromName text not null, fromEmail text not null, dailyCap integer not null default 50,
pauseReason pause_reason, pausedAt timestamptz, createdAt, updatedAt

// email_steps
id, campaignId uuid references email_campaigns on delete cascade not null,
stepOrder integer not null, subject text not null, body text not null,
delayDays integer not null default 0   // delay after the previous step; step 1 uses 0
unique (campaignId, stepOrder)

// email_enrollments
id, campaignId references email_campaigns cascade, businessId references businesses cascade,
state enrollment_state not null default 'active', currentStep integer not null default 0,
nextSendAt timestamptz, lastSentAt timestamptz, enrolledAt timestamptz default now(), updatedAt
unique (campaignId, businessId)

// email_messages
id, enrollmentId references email_enrollments cascade, stepId references email_steps set null,
businessId references businesses cascade, toEmail text not null, subject text not null,
bodyRendered text not null, status message_status not null, providerId text, error text,
sentAt timestamptz, createdAt
```

## Interfaces (frozen)

Every repository function takes `db: Db` as its first argument so tests can
inject a PGlite instance. Pages and actions obtain it with `getDb()`.

### `src/db/client.ts`
```ts
export type Db = PgDatabase<...> & { $client: unknown };   // drizzle instance (exact generic chosen by WP-01)
export function getDb(): Db;            // cached on globalThis; postgres-js when DATABASE_URL, else PGlite at PGLITE_DATA_DIR ?? '.data/pglite'
export async function closeDb(): Promise<void>;
```
### `src/db/migrate.ts`
```ts
export async function runMigrations(db: Db): Promise<void>;   // applies ./drizzle/*.sql via drizzle migrator for the active driver
```
### `src/db/test-utils.ts`
```ts
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }>;  // in-memory PGlite, migrated, empty
```
### `src/db/seed.ts`
```ts
export async function seed(db: Db): Promise<SeedSummary>;   // idempotent: truncates all tables then inserts; returns row counts per table
export type SeedSummary = Record<string, number>;
```
### `src/db/repo/activities.ts`
```ts
export type LogActivityInput = { businessId: string; type: ActivityType; body?: string; outcome?: string;
  metadata?: Record<string, unknown>; campaignType?: 'call' | 'email'; campaignId?: string; agent?: string; occurredAt?: Date };
export async function logActivity(db: Db, input: LogActivityInput): Promise<Activity>;
export async function listActivities(db: Db, businessId: string, opts?: { limit?: number }): Promise<Activity[]>;   // newest first
export async function listRecentActivities(db: Db, limit: number): Promise<(Activity & { businessName: string })[]>;
```
### `src/db/repo/rules.ts`
```ts
export async function getRules(db: Db): Promise<QualificationRules>;          // creates the default row if missing
export async function updateRules(db: Db, patch: Partial<Omit<QualificationRules,'id'|'updatedAt'>>): Promise<QualificationRules>;
export const DEFAULT_CHAIN_PATTERNS: string[];   // see §Qualification
```
### `src/lib/action-result.ts`
```ts
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; message?: string; fieldErrors?: Record<string, string[]> };
// Form actions: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>; on success call redirect() where a navigation is expected.
```
### `src/lib/env.ts`
```ts
export const env: { DATABASE_URL?: string; PGLITE_DATA_DIR: string; YELP_API_KEY?: string; YELP_MODE: 'live' | 'fixture';
  APP_PASSWORD?: string; APP_SESSION_SECRET: string; RESEND_API_KEY?: string; EMAIL_FROM: string; CRON_SECRET?: string; APP_TIMEZONE: string };
// YELP_MODE defaults to 'fixture' when YELP_API_KEY is absent, else 'live'.
```
### `src/lib/format.ts`
```ts
export function formatPhone(e164: string | null): string;      // "+17135550123" → "(713) 555-0123"
export function formatRating(r: number | string | null): string; // "4.5"
export function formatRelative(d: Date | string): string;        // "3 h ago"
export function formatDate(d: Date | string, tz?: string): string;
export function normalizeName(name: string): string;             // rule in §businesses.nameNormalized
export function phoneDigits(phone: string | null): string | null;
```

### `src/lib/yelp/types.ts`, `client.ts`, `fixture.ts`, `normalize.ts` (WP-03)
```ts
export type YelpSearchParams = { term?: string; location: string; categories?: string; radius?: number; limit?: number; offset?: number; sort_by?: 'best_match'|'rating'|'review_count'|'distance' };
export type YelpBusiness = { id: string; alias: string; name: string; image_url?: string; is_closed: boolean; url: string; review_count: number;
  categories: { alias: string; title: string }[]; rating: number; coordinates: { latitude: number|null; longitude: number|null };
  transactions: string[]; price?: string; location: { address1?: string|null; address2?: string|null; address3?: string|null; city: string; zip_code: string; country: string; state: string; display_address: string[] };
  phone: string; display_phone: string; distance?: number };
export type YelpBusinessDetails = YelpBusiness & { is_claimed?: boolean; photos?: string[]; hours?: unknown[] };
export type YelpSearchResponse = { businesses: YelpBusiness[]; total: number; region?: unknown };
export interface YelpClient {
  search(params: YelpSearchParams): Promise<YelpSearchResponse>;
  details(idOrAlias: string): Promise<YelpBusinessDetails>;
  readonly mode: 'live' | 'fixture';
  readonly callCount: number;
}
export function createYelpClient(opts?: { apiKey?: string; mode?: 'live'|'fixture'; fetch?: typeof fetch; fixtureDir?: string }): YelpClient;
export async function* searchAll(client: YelpClient, params: YelpSearchParams, maxResults: number): AsyncGenerator<YelpBusiness>;
  // limit 50 per page, offset ≤ 1000-limit, stops at maxResults or when a page is short or total reached
export function normalizeYelpBusiness(b: YelpBusiness | YelpBusinessDetails, ctx: { jobId?: string; searchCategory: string; searchLocation: string }): NewBusiness;
```
Fixture adapter: `search()` resolves `fixtures/yelp/search-<slug>.json` where
slug = `${categories first alias}-${location lowercased, non-alphanumerics → '-', collapsed}` and
serves it paged by `limit/offset`; unknown slug → `{ businesses: [], total: 0 }`.
`details(id)` resolves `fixtures/yelp/business-<id>.json`, else returns the
search record with `is_claimed: true, photos: [], hours: []`.
Live client: `Authorization: Bearer <key>`; 429 → retry up to 3 times with
backoff 500 ms × 2^n; other 4xx → `YelpApiError` (no retry); 5xx → retry 3.

### `src/lib/qualify/index.ts` (WP-03)
```ts
export type QualifyContext = { searchCategory: string; categoryAliases: string[]; radiusM: number; locationState?: string | null;
  sameNameCityCount: number;     // distinct cities in DB with the same nameNormalized, including this business
  phoneDuplicate: boolean };     // another business (different yelpId) has the same phoneDigits
export type QualifyResult = { qualification: 'qualified' | 'review' | 'rejected'; score: number; reasons: ReasonCode[] };
export type ReasonCode = 'closed' | 'category_mismatch' | 'chain' | 'multi_location' | 'no_phone' | 'out_of_area'
  | 'low_rating' | 'too_few_reviews' | 'too_many_reviews' | 'duplicate_phone' | 'unclaimed' | 'low_score';
export function qualify(b: BusinessLike, ctx: QualifyContext, rules: QualificationRules): QualifyResult;
export function scoreBusiness(b: BusinessLike, ctx: QualifyContext): number;
export function isChain(name: string, patterns: string[]): boolean;
export const REASON_LABELS: Record<ReasonCode, string>;   // plain English for the UI
```

### `src/db/repo/businesses.ts` (WP-03; consumed by WP-04/05/06/07)
```ts
export type BusinessFilter = { q?: string; qualification?: Qualification[]; status?: BusinessStatus[]; city?: string; state?: string;
  category?: string; minScore?: number; maxScore?: number; hasPhone?: boolean; hasEmail?: boolean; excludeDoNotCall?: boolean;
  excludeDoNotEmail?: boolean; sourceJobId?: string; ids?: string[]; tag?: string };
export type BusinessSort = { field: 'name'|'score'|'rating'|'reviewCount'|'city'|'status'|'createdAt'|'lastContactedAt'; dir: 'asc'|'desc' };
export async function listBusinesses(db: Db, f: BusinessFilter, opts?: { sort?: BusinessSort; limit?: number; offset?: number }): Promise<{ rows: Business[]; total: number }>;
export async function listBusinessIds(db: Db, f: BusinessFilter): Promise<string[]>;
export async function getBusiness(db: Db, id: string): Promise<Business | null>;
export async function upsertBusinessByYelpId(db: Db, row: NewBusiness): Promise<{ business: Business; created: boolean }>;  // never overwrites CRM fields (status, owner*, notes, tags, doNot*)
export async function updateBusinessCrm(db: Db, id: string, patch: Partial<Pick<Business,'status'|'ownerName'|'ownerEmail'|'notes'|'tags'|'doNotCall'|'doNotEmail'|'nextFollowUpAt'>>): Promise<Business | null>;
export async function setQualification(db: Db, id: string, r: QualifyResult): Promise<void>;
export async function countByQualification(db: Db, f?: BusinessFilter): Promise<Record<Qualification, number>>;
export async function countByReason(db: Db): Promise<{ reason: string; count: number }[]>;
export async function countByStatus(db: Db): Promise<Record<BusinessStatus, number>>;
export async function listCities(db: Db): Promise<{ city: string; state: string; count: number }[]>;
export async function listCategories(db: Db): Promise<{ alias: string; count: number }[]>;
export async function deleteBusiness(db: Db, id: string): Promise<boolean>;
```
### `src/db/repo/search-jobs.ts` (WP-03)
```ts
export async function createSearchJob(db: Db, input: { term?: string; location: string; categoryAliases: string[]; radiusM?: number; maxResults?: number }): Promise<SearchJob>;
export async function getSearchJob(db: Db, id: string): Promise<SearchJob | null>;
export async function listSearchJobs(db: Db, limit?: number): Promise<SearchJob[]>;
export async function updateSearchJob(db: Db, id: string, patch: Partial<SearchJob>): Promise<void>;
```
### `src/features/ingest/run.ts` (WP-03)
```ts
export async function runSearchJob(db: Db, jobId: string, client: YelpClient): Promise<SearchJob>;   // sets running → completed/failed; updates counts every page
export async function enrichBusiness(db: Db, id: string, client: YelpClient): Promise<Business>;      // details → hours/photos/isClaimed/enrichedAt → requalify this one
export async function requalifyAll(db: Db): Promise<Record<Qualification, number>>;
export async function qualifyOne(db: Db, business: Business, rules?: QualificationRules): Promise<QualifyResult>;  // builds QualifyContext from DB and applies setQualification
```

### `src/db/repo/call-campaigns.ts` (WP-05)
```ts
export async function createCallCampaign(db, input: NewCallCampaign): Promise<CallCampaign>;
export async function updateCallCampaign(db, id, patch): Promise<CallCampaign | null>;
export async function getCallCampaign(db, id): Promise<CallCampaign | null>;
export async function listCallCampaigns(db): Promise<(CallCampaign & CampaignStats)[]>;
export type CampaignStats = { pending: number; claimed: number; completed: number; skipped: number; callback: number; completedToday: number; activeAgents: number };
export async function getCampaignStats(db, id, now?: Date): Promise<CampaignStats>;
export async function addBusinessesToCampaign(db, id, businessIds: string[]): Promise<{ added: number; skipped: number }>;  // skips duplicates, doNotCall, no phone
export async function removeQueueItem(db, itemId): Promise<void>;
export type ClaimResult = { ok: true; item: CallQueueItem; business: Business } | { ok: false; reason: 'paused' | 'completed' | 'draft' | 'empty' | 'agent_limit'; pauseReason?: PauseReason };
export async function claimNext(db, campaignId, agent: string, now?: Date): Promise<ClaimResult>;   // runs evaluateCampaign first; single-statement claim with FOR UPDATE SKIP LOCKED; lease 10 min
export async function releaseItem(db, itemId): Promise<void>;                                     // back to pending at end of queue (skip)
export type OutcomeInput = { outcome: CallOutcome; notes?: string; callbackAt?: Date; agent: string };
export async function recordOutcome(db, itemId, input: OutcomeInput, now?: Date): Promise<CallQueueItem>;
export async function evaluateCampaign(db, id, now?: Date): Promise<CallCampaign>;                 // §Campaign automation
export async function evaluateAllCampaigns(db, now?: Date): Promise<number>;
export async function pauseCampaign(db, id): Promise<void>;    // manual
export async function resumeCampaign(db, id): Promise<void>;   // clears pauseReason, status running
export async function listQueue(db, id, opts?: { state?: QueueState[]; limit?: number; offset?: number }): Promise<{ rows: (CallQueueItem & { business: Business })[]; total: number }>;
export async function countCallsByOutcome(db, since: Date): Promise<{ outcome: CallOutcome; count: number }[]>;
export async function listDueCallbacks(db, before: Date): Promise<(CallQueueItem & { business: Business; campaignName: string })[]>;
```
### `src/db/repo/email-campaigns.ts`, `src/lib/email/sender.ts` (WP-06)
```ts
export interface EmailSender { send(msg: { to: string; from: string; subject: string; text: string }): Promise<{ id: string } >; readonly kind: 'resend' | 'dry_run'; }
export function createEmailSender(env): EmailSender;   // ResendSender when RESEND_API_KEY, else DryRunSender
export function renderTemplate(tpl: string, b: Business): string;   // tokens: {{business_name}} {{owner_first_name}} {{owner_name}} {{city}} {{state}} {{category}} {{rating}} {{review_count}} {{phone}}; unknown token → ''
export async function createEmailCampaign(db, input: NewEmailCampaign & { steps: Omit<NewEmailStep,'campaignId'>[] }): Promise<EmailCampaign>;
export async function updateEmailCampaign(db, id, patch, steps?): Promise<EmailCampaign | null>;
export async function getEmailCampaign(db, id): Promise<(EmailCampaign & { steps: EmailStep[] }) | null>;
export async function listEmailCampaigns(db): Promise<(EmailCampaign & EmailStats)[]>;
export type EmailStats = { active: number; completed: number; replied: number; unsubscribed: number; sentToday: number; sentTotal: number };
export async function enrollBusinesses(db, campaignId, businessIds: string[], now?: Date): Promise<{ enrolled: number; skipped: number }>;  // skips: no ownerEmail, doNotEmail, already enrolled
export async function processDueSends(db, campaignId, sender: EmailSender, now?: Date): Promise<{ sent: number; skipped: number; failed: number }>;
export async function processAllDue(db, sender, now?: Date): Promise<number>;
export async function markReplied(db, enrollmentId): Promise<void>;
export async function unsubscribe(db, enrollmentId): Promise<void>;     // also sets business.doNotEmail
export async function pauseEmailCampaign(db, id): Promise<void>; export async function resumeEmailCampaign(db, id): Promise<void>;
export async function listEnrollments(db, campaignId, opts?): Promise<{ rows: (EmailEnrollment & { business: Business })[]; total: number }>;
export async function listMessages(db, campaignId, opts?): Promise<{ rows: EmailMessage[]; total: number }>;
export async function countEmailsSent(db, since: Date): Promise<number>;
```
### `src/db/repo/dashboard.ts`, `src/db/repo/search.ts` (WP-07)
```ts
export async function getDashboardStats(db, now?: Date): Promise<DashboardStats>;
export type DashboardStats = { businessesTotal: number; businessesQualified: number; businessesReview: number; businessesRejected: number;
  callsToday: number; interestRate7d: number /* interested / (completed outcomes) over 7d, 0..1 */; emailsSentToday: number;
  runningCallCampaigns: number; runningEmailCampaigns: number; overdueCallbacks: number;
  rejectionBreakdown: { reason: string; count: number }[]; callsByOutcome7d: { day: string; outcome: string; count: number }[];
  statusFunnel: { status: BusinessStatus; count: number }[] };
export async function searchAll(db, q: string, limit?: number): Promise<{ businesses: Business[]; callCampaigns: CallCampaign[]; emailCampaigns: EmailCampaign[] }>;
```

### Routes
| Route | Owner | Purpose |
|---|---|---|
| `/login` | WP-01 | password gate |
| `/` | WP-01 placeholder → WP-07 | dashboard |
| `/design` | WP-02 | primitives showcase |
| `/businesses`, `/businesses/[id]` | WP-04 | table, detail |
| `/searches`, `/searches/new`, `/searches/[id]` | WP-04 | jobs |
| `/settings`, `/settings/rules` | WP-04 | rules |
| `/calling`, `/calling/new`, `/calling/[id]`, `/calling/[id]/dial`, `/calling/[id]/settings` | WP-05 | campaigns + dialer |
| `/api/cron/campaigns` (GET, `Authorization: Bearer CRON_SECRET` when set) | WP-05 | evaluateAllCampaigns |
| `/api/calling/[id]/status` (GET JSON stats, for polling) | WP-05 | |
| `/email`, `/email/new`, `/email/[id]`, `/email/[id]/messages` | WP-06 | |
| `/api/cron/email` (GET, same auth) | WP-06 | processAllDue |
| `/api/searches/[id]` (GET JSON job, for polling) | WP-04 | |

## Qualification

Rules row defaults: minRating 3.5, minReviews 5, maxReviews null,
requirePhone true, rejectClosed true, rejectChains true, categoryStrict
true, distanceTolerancePct 10, multiLocationThreshold 3, reviewScoreBelow 40.

`DEFAULT_CHAIN_PATTERNS` (case-insensitive substring match on the raw name,
each pattern is a plain string): `roto-rooter`, `mr. rooter`, `mr rooter`,
`benjamin franklin plumbing`, `ars rescue rooter`, `ars/rescue`, `one hour
heating`, `one hour air`, `service experts`, `aire serv`, `aspen dental`,
`western dental`, `smile direct`, `great clips`, `supercuts`, `sport clips`,
`jiffy lube`, `midas`, `meineke`, `pep boys`, `firestone complete`,
`goodyear auto`, `christian brothers automotive`, `maaco`, `servpro`,
`servicemaster`, `stanley steemer`, `chem-dry`, `molly maid`, `merry maids`,
`the maids`, `terminix`, `orkin`, `trugreen`, `lawn doctor`, `state farm`,
`allstate`, `farmers insurance`, `h&r block`, `jackson hewitt`, `liberty
tax`, `the ups store`, `fedex office`, `anytime fitness`, `planet fitness`,
`orangetheory`, `massage envy`, `european wax center`, `hand & stone`,
`the joint chiropractic`, `clear choice`, `lenscrafters`, `pearle vision`,
`visionworks`, `america's best`, `banfield`, `vca animal`, `petsmart`,
`petco`, `kumon`, `mathnasium`, `sylvan learning`, `huntington learning`,
`primrose school`, `kindercare`, `goddard school`, `the learning experience`,
`window world`, `renewal by andersen`, `bath fitter`, `re-bath`,
`mr. handyman`, `mr handyman`, `ace handyman`, `handyman connection`,
`college hunks`, `two men and a truck`, `1-800-got-junk`, `junk king`,
`pods`, `u-haul`, `public storage`, `extra space storage`, `cubesmart`.

### Rule order (all hard rejections are collected; the result is `rejected`
if any applies)
1. `closed`: `isClosed` and `rejectClosed`.
2. `category_mismatch`: `categoryStrict` and none of the business's
   category aliases is in `ctx.categoryAliases`.
3. `chain`: `rejectChains` and `isChain(name, rules.chainPatterns)`.
4. `multi_location`: `rejectChains` and `ctx.sameNameCityCount >= multiLocationThreshold`.
5. `no_phone`: `requirePhone` and `phoneDigits` is null/empty.
6. `out_of_area`: (`distanceM` is a number and `distanceM > radiusM * (1 + distanceTolerancePct/100)`)
   or (`ctx.locationState` is set and `state` differs, case-insensitive).
   `ctx.locationState` is parsed from the job location when it ends with
   `, XX` (two letters).
7. `low_rating`: `rating < minRating` (null rating counts as 0).
8. `too_few_reviews`: `reviewCount < minReviews`.
9. `too_many_reviews`: `maxReviews` set and `reviewCount > maxReviews`.
10. `duplicate_phone`: `ctx.phoneDuplicate`.

Soft flags (never reject): `unclaimed` when `isClaimed === false`;
`low_score` when no hard rejection and `score < reviewScoreBelow` → the
result is `review`. Otherwise `qualified`. `reasons` lists every code that
applied, hard first, in the order above.

### Score (0–100, integer)
```
base            = 50
ratingPart      = clamp((rating - 3) * 10, -20, +20)           // null rating → -20
reviewPart      = min(20, round(5 * log10(reviewCount + 1)))    // 0 → 0, 9 → 5, 99 → 10, 999 → 15, 9999 → 20
phonePart       = phoneDigits ? +5 : -5
claimedPart     = isClaimed === true ? +10 : isClaimed === false ? -10 : 0
categoryPart    = primaryCategory in ctx.categoryAliases ? +10 : (any category alias in ctx.categoryAliases ? +5 : 0)
proximityPart   = distanceM != null && distanceM <= radiusM / 2 ? +5 : 0
score           = clamp(round(base + ratingPart + reviewPart + phonePart + claimedPart + categoryPart + proximityPart), 0, 100)
```
Worked examples (unit test must reproduce):
- rating 4.5, reviews 120, phone yes, isClaimed true, primary category matches, distance 3000 of radius 20000 → 50+15+10+5+10+10+5 = **95**.
- rating 3.0, reviews 4, phone yes, isClaimed null, secondary category matches, distance 15000/20000 → 50+0+3+5+0+5+0 = **63**.
- rating null, reviews 0, no phone, isClaimed false, no category match, distance null → 50-20+0-5-10+0+0 = **15**.
- rating 5.0, reviews 2000, phone yes, claimed true, primary match, distance 100 → 50+20+17+5+10+10+5 = 117 → **100**.

### Fixture traps (fixtures/yelp/search-plumbing-houston.json, 40 businesses; categories param `plumbing`, location "Houston, TX", radius 20000)
Ingesting this fixture into an **empty** DB with default rules must give exactly:
| name | trap | expected |
|---|---|---|
| Roto-Rooter Plumbing & Water Cleanup | chain pattern | rejected `chain` |
| Mr. Rooter Plumbing of Houston | chain pattern | rejected `chain` |
| Bayou City Lawn & Landscape | categories `[landscaping]` | rejected `category_mismatch` |
| Gulf Coast Plumbing | `is_closed: true` | rejected `closed` |
| Katy Drain Pros | city Katy, distance 31000 | rejected `out_of_area` |
| Handy Hank Plumbing | `phone: ""` | rejected `no_phone` |
| Quick Fix Plumbing | rating 2.5, reviews 40 | rejected `low_rating` |
| New Guy Plumbing LLC | rating 5.0, reviews 2 | rejected `too_few_reviews` |
| Reliable Plumbing Co (second record, different yelp id, same phone) | duplicate phone | rejected `duplicate_phone` (the first record qualifies) |
| Sugar Land Pipe Masters | state TX, city Sugar Land, distance 21500 | **qualified** (within 10 % tolerance) |
| Dusty Wrench Plumbing | rating 3.5, reviews 6, isClaimed unknown, secondary category only | `review` (`low_score`; score 50+5+4+5+0+5+0 = 69? no → see note) |
| remaining 29 | none | qualified |

Note on Dusty Wrench: with the numbers above its score is 69, which is not
below 40, so make the fixture `rating 3.5, reviewCount 5, phone present,
secondary category only, distance 19000` **and** ensure the expected
outcome is `qualified` with score 50+5+4+5+0+5+0 = **69**. The `review`
bucket is exercised instead by a unit test that lowers inputs (rating 3.5,
reviews 5, no claimed info, category secondary, phone present but
`reviewScoreBelow` raised to 70) — WP-03 writes that test. WP-01 authors
the fixtures to these exact values; WP-03's engine must reproduce the
table. Counts for the fixture after ingestion: qualified 31, review 0,
rejected 9 (chain 2, category_mismatch 1, closed 1, out_of_area 1,
no_phone 1, low_rating 1, too_few_reviews 1, duplicate_phone 1).

Multi-location: "ABC Plumbing" appears once in each of the three fixture
sets (`plumbing-houston`, `hvac-dallas` as a plumbing-categorized stray →
also category_mismatch there, `dentists-austin` likewise) with distinct
yelp ids and cities. After all three are ingested, `requalifyAll` marks all
three `multi_location` (threshold 3). Before the third ingestion they are
not. WP-03 tests this.

Other fixture sets: `search-hvac-dallas.json` (category `hvac`, "Dallas,
TX", 30 records, 4 traps of the engineer's choice drawn from the same
list, documented in the file's `_traps` key) and
`search-dentists-austin.json` (category `dentists`, "Austin, TX", 30
records, 4 traps). Each fixture file: `{ "_traps": [...], "businesses": [...], "total": N }`.
`fixtures/yelp/business-<id>.json` exists for at least 6 businesses with
`hours`, `photos` (3 URLs), `is_claimed` (two of them `false`).

Fixture realism: fake but plausible names, Houston/Dallas/Austin area
addresses and coordinates, phone numbers in the 555 range
(`+1713555xxxx`, `+1214555xxxx`, `+1512555xxxx`), ratings 3.5–5 in 0.5
steps, review counts 5–450, image URLs may be empty strings.

## Campaign automation and concurrency (investigation result: include)

Why: a call center runs several lists at once (by vertical, by region, by
rep team). Without isolated queues two agents dial the same business, caps
are enforced by hand, and campaigns run outside calling hours. The design
below has no long-running process, so it works on Vercel functions.

Claim (`claimNext`), one statement inside one transaction:
```sql
UPDATE call_queue_items SET state='claimed', claimed_by=$agent, claimed_at=$now,
  lease_expires_at=$now + interval '10 minutes', updated_at=$now
WHERE id = (
  SELECT id FROM call_queue_items
  WHERE campaign_id=$campaign AND (
        state='pending'
     OR (state='claimed' AND lease_expires_at < $now)
     OR (state='callback' AND callback_at <= $now))
  ORDER BY CASE WHEN state='callback' THEN 0 ELSE 1 END, position
  FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```
Before claiming: `evaluateCampaign`; if status ≠ running → `{ ok:false, reason }`.
Agent limit: distinct `claimed_by` with `state='claimed' AND lease_expires_at > now`
(excluding this agent) ≥ `maxConcurrentAgents` → `agent_limit`.

Outcome transitions (`recordOutcome`):
| outcome | item | business |
|---|---|---|
| no_answer, voicemail, busy | attempts+1; if attempts < maxAttempts → pending, position = max(position)+1; else skipped | status → contacted if new; lastContactedAt |
| interested | completed | status interested; lastContactedAt |
| not_interested | completed | status not_interested |
| callback | callback, callbackAt set | status callback; nextFollowUpAt |
| wrong_number | completed | activity only; tag `wrong_number` |
| do_not_call | completed | doNotCall true, status do_not_call; delete pending/callback items for this business in every campaign |
Every outcome logs `activities(type:'call', outcome, body: notes, agent, campaignType:'call', campaignId)`.

`evaluateCampaign(now)` for status in (running, paused):
1. If paused with reason `manual` → return unchanged.
2. `completedToday` = items with `lastOutcomeAt` on the same calendar day as
   `now` in `campaign.timezone` and `state in (completed, skipped, pending, callback)`
   (i.e. any outcome recorded today).
3. `withinHours` = callingHoursStart/End null, or local time of `now` in
   `[start, end)`.
4. `available` = count of items matching the claim predicate.
5. Running → paused(`daily_cap`) if dailyCap set and completedToday ≥ dailyCap;
   running → paused(`outside_hours`) if !withinHours;
   running → completed if available = 0 and no items in `claimed` or future
   `callback`; running → paused(`exhausted`) if available = 0 but future
   callbacks exist.
6. Paused with autoResume and reason in (daily_cap, outside_hours, exhausted):
   → running when its condition no longer holds (cap not reached today,
   within hours, available > 0).
Evaluated in `claimNext`, on campaign page load (server component calls
it), and by `GET /api/cron/campaigns` (`evaluateAllCampaigns`).

Email runner (`processDueSends`): for a running campaign, select active
enrollments with `nextSendAt <= now`, ordered by `nextSendAt`, limited to
`dailyCap - sentToday`; for each: step = steps[currentStep]; render; skip
(state → paused reason none, log system activity) if business has no email
or doNotEmail; send; insert message (status sent | dry_run | failed);
currentStep+1; if more steps → nextSendAt = now + nextStep.delayDays days,
else state completed. Log `activities(type:'email')` per send.

## Technology choices
| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js latest stable (App Router, Turbopack), React 19, TS strict | one codebase, Vercel-native |
| Styling | Tailwind CSS v4 + shadcn/ui (`radix-nova` style, neutral base; `field` is used instead of the removed `form` item) | fast, consistent, accessible |
| Animation | `motion` (framer-motion v12, `motion/react`) | layout animations, presence, reduced-motion support |
| ORM | Drizzle ORM + drizzle-kit migrations | typed schema, same SQL for PGlite and Supabase |
| DB drivers | `postgres` (postgres-js) for `DATABASE_URL` (Supabase pooler, `prepare: false`); `@electric-sql/pglite` otherwise | no Docker for local/test; real Postgres in prod |
| Validation | zod | shared by actions and forms |
| Tests | Vitest | fast, TS-native |
| Lint | ESLint (next config) | |
| Email | `resend` SDK behind `EmailSender` | simplest Vercel-friendly provider; dry-run fallback |
| Icons | lucide-react | ships with shadcn |
| Charts (dashboard) | recharts | shadcn chart components wrap it |
| Dates | date-fns + date-fns-tz | timezone math for calling hours |
| Markdown (scripts) | react-markdown | script rendering |
| Tables | TanStack Table inside `DataTable` | sorting/selection without reinventing |

## Cross-cutting conventions
- Package manager: npm. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`
  (`tsc --noEmit`), `test` (`vitest run`), `test:watch`, `db:generate`
  (`drizzle-kit generate`), `db:migrate` (`tsx scripts/migrate.ts`),
  `db:seed` (`tsx scripts/seed.ts`), `ingest` (`tsx scripts/ingest.ts`).
- Paths: `@/*` → `src/*`. Tests in `tests/**/*.test.ts` (node environment);
  each test file calls `createTestDb()` in `beforeAll` and `close()` after.
- All pages that read the DB export `const dynamic = 'force-dynamic'`.
  `next.config.ts` sets `serverExternalPackages: ['@electric-sql/pglite', 'postgres']`.
- PGlite dev DB: `getDb()` caches on `globalThis.__db` to survive HMR. Only
  one process may open `.data/pglite`; README says to stop `npm run dev`
  before `db:seed`/`db:migrate` (or set `DATABASE_URL`).
- Errors: actions return `ActionResult`; never throw for validation; log
  unexpected errors with `console.error` and return `{ ok:false, message }`.
- Forms: `useActionState` + shadcn `Form` primitives; field errors under
  fields; submit buttons disabled while pending.
- Money/phone/date formatting only via `src/lib/format.ts`. `normalizeName` strips legal suffixes (llc, inc, co, corp, ltd) only when they end the name.
- `typecheck` is plain `tsc --noEmit`: type page/layout props explicitly (e.g. `{ params: Promise<{ id: string }> }`), do not rely on Next's generated `PageProps`/`LayoutProps` globals.
- Next 16: middleware is `src/proxy.ts`; Cache Components is off because pages use `force-dynamic`.
- Time zone: all stored timestamps UTC; display via `formatDate(d, env.APP_TIMEZONE)`.
- Enum labels/colors: `src/lib/labels.ts` (WP-01) exports
  `STATUS_LABELS`, `QUALIFICATION_LABELS`, `OUTCOME_LABELS`, `CAMPAIGN_STATUS_LABELS`
  as `{ label: string; tone: 'neutral'|'info'|'success'|'warning'|'danger' }`;
  `StatusBadge` (WP-02) consumes `tone`.
- Agent identity for the dialer: cookie `crm_agent` (display name), set by
  a small form; `agent` string is stored on claims and activities.
- Cron auth: when `CRON_SECRET` is set, routes require
  `Authorization: Bearer <CRON_SECRET>`; otherwise open (local only).
- Every new UI package composes pages only from primitives; raw Tailwind is
  fine inside feature components, but tables, cards, headers, badges, empty
  states, and panels must be the shared ones.
- Commit messages: conventional (`feat(calling): …`), trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` is NOT added
  by seniors (the PM adds attribution at merge).

## Deliberately undecided (senior's call inside the package)
- WP-01: exact Drizzle generic for `Db`; how the password session cookie is
  signed; shadcn components to pre-install; whether middleware is
  `middleware.ts` or `proxy.ts` (whatever the installed Next version wants).
- WP-02: visual language (type scale, radius, spacing, palette within
  neutral+one accent), exact DataTable API beyond the required features,
  how `AnimatedNumber` eases.
- WP-03: internal structure of the engine, how DB lookups for
  `QualifyContext` are batched, CLI argument parsing.
- WP-04: table virtualization or pagination (pagination is fine), detail
  layout, how polling is implemented (SWR, interval fetch).
- WP-05: dialer layout and shortcut mapping beyond "digits 1–8 map to the
  outcome list order", how the script tokens are rendered.
- WP-06: steps editor UX, how previews are rendered.
- WP-07: chart types, palette usage, command palette library (cmdk via shadcn is expected).
