// Trustpilot discovery storage: upsert by Trustpilot slug, "similar" relations
// between businesses, review-count snapshots, staleness, and graph nodes.
// See docs/team/v2/architecture.md §Repos.
import { and, asc, desc, eq, getTableColumns, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import {
  type Business,
  type BusinessSource,
  type NewBusiness,
  type ReviewSnapshot,
  businessRelations,
  businesses,
  reviewSnapshots,
} from "../schema";
import { DOMAIN_SLUG_PATTERN } from "@/lib/firecrawl/external-links";
import { CRM_FIELDS } from "./businesses";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GraphNode = {
  id: string;
  name: string;
  category: string | null;
  totalReviews: number;
  rating: number | null;
  reviewsLast30d: number;
};

/**
 * Insert by `trustpilotId`, or update the scraped columns of the existing row.
 * CRM fields (status, owner*, notes, tags, doNot*, lastContactedAt,
 * nextFollowUpAt) are never written on conflict; keys absent from `row` are
 * left untouched. `source` defaults to 'trustpilot' on insert.
 */
export async function upsertBusinessByTrustpilotId(
  db: Db,
  row: NewBusiness & { trustpilotId: string },
): Promise<{ business: Business; created: boolean }> {
  const values: NewBusiness = { source: "trustpilot", ...row };
  const set: Record<string, unknown> = {};
  const skip = new Set<string>([...CRM_FIELDS, "id", "trustpilotId", "source", "createdAt", "updatedAt"]);
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || skip.has(k)) continue;
    set[k] = v;
  }
  set.updatedAt = new Date();
  const [res] = await db
    .insert(businesses)
    .values(values)
    .onConflictDoUpdate({ target: businesses.trustpilotId, set })
    .returning({ ...getTableColumns(businesses), __inserted: sql<boolean>`(xmax = 0)` });
  const { __inserted, ...business } = res;
  return { business: business as Business, created: Boolean(__inserted) };
}

export async function getBusinessByTrustpilotId(db: Db, trustpilotId: string): Promise<Business | null> {
  const [row] = await db.select().from(businesses).where(eq(businesses.trustpilotId, trustpilotId));
  return row ?? null;
}

/** Records `sourceId → targetId`; duplicates and self-relations are ignored. */
export async function addRelation(db: Db, sourceId: string, targetId: string, type = "similar"): Promise<void> {
  if (sourceId === targetId || !UUID_RE.test(sourceId) || !UUID_RE.test(targetId)) return;
  await db
    .insert(businessRelations)
    .values({ sourceBusinessId: sourceId, targetBusinessId: targetId, relationType: type })
    .onConflictDoNothing();
}

/** Every relation as a graph link (business ids), oldest first. */
export async function listRelations(db: Db): Promise<{ source: string; target: string }[]> {
  return db
    .select({ source: businessRelations.sourceBusinessId, target: businessRelations.targetBusinessId })
    .from(businessRelations)
    .orderBy(asc(businessRelations.createdAt), asc(businessRelations.id));
}

/** Businesses related to `id` in either direction, each once, by name. */
export async function relatedBusinesses(db: Db, id: string): Promise<Business[]> {
  if (!UUID_RE.test(id)) return [];
  const outgoing = db
    .select({ id: businessRelations.targetBusinessId })
    .from(businessRelations)
    .where(eq(businessRelations.sourceBusinessId, id));
  const incoming = db
    .select({ id: businessRelations.sourceBusinessId })
    .from(businessRelations)
    .where(eq(businessRelations.targetBusinessId, id));
  return db
    .select()
    .from(businesses)
    .where(and(ne(businesses.id, id), or(inArray(businesses.id, outgoing), inArray(businesses.id, incoming))))
    .orderBy(asc(businesses.name), asc(businesses.id));
}

export async function addSnapshot(db: Db, businessId: string, totalReviews: number, capturedAt?: Date): Promise<void> {
  await db.insert(reviewSnapshots).values({ businessId, totalReviews, ...(capturedAt ? { capturedAt } : {}) });
}

/** Snapshots for one business, oldest first. */
export async function listSnapshots(db: Db, businessId: string): Promise<ReviewSnapshot[]> {
  if (!UUID_RE.test(businessId)) return [];
  return db
    .select()
    .from(reviewSnapshots)
    .where(eq(reviewSnapshots.businessId, businessId))
    .orderBy(asc(reviewSnapshots.capturedAt), asc(reviewSnapshots.id));
}

/** Back-off window after a failed scrape: 24 h × min(attempts, 7). */
export const SCRAPE_BACKOFF_HOURS = 24;
export const SCRAPE_BACKOFF_MAX_STEPS = 7;

/** SQL: true while a row is inside its failure back-off window at `now`. */
function backedOff(now: Date) {
  return sql`(${businesses.scrapeFailedAt} IS NOT NULL AND ${businesses.scrapeFailedAt} > ${now.toISOString()}::timestamptz - make_interval(hours => ${SCRAPE_BACKOFF_HOURS} * least(greatest(${businesses.scrapeAttempts}, 1), ${SCRAPE_BACKOFF_MAX_STEPS})))`;
}

/** SQL filter shared by listStaleBusinesses and countStaleBusinesses. */
function staleWhere(opts: { olderThanHours: number; source?: BusinessSource; now?: Date }) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.olderThanHours * 3_600_000);
  const stale = and(or(isNull(businesses.lastScrapedAt), lt(businesses.lastScrapedAt, cutoff)), sql`NOT ${backedOff(now)}`);
  return opts.source ? and(stale, eq(businesses.source, opts.source)) : stale;
}

/**
 * Businesses never scraped or last scraped more than `olderThanHours` ago,
 * minus rows inside their failure back-off (failed within the last
 * 24 h × min(attempts, 7)). Order: never scraped and never failed first, then
 * oldest `lastScrapedAt`, then never-scraped rows whose back-off has expired
 * (oldest failure first). `source` narrows the set; `now` defaults to the clock.
 */
export async function listStaleBusinesses(
  db: Db,
  opts: { olderThanHours: number; limit: number; source?: BusinessSource; now?: Date },
): Promise<Business[]> {
  return db
    .select()
    .from(businesses)
    .where(staleWhere(opts))
    .orderBy(
      sql`(${businesses.lastScrapedAt} IS NULL AND ${businesses.scrapeFailedAt} IS NULL) DESC`,
      sql`${businesses.lastScrapedAt} ASC NULLS LAST`,
      sql`${businesses.scrapeFailedAt} ASC NULLS FIRST`,
      asc(businesses.createdAt),
      asc(businesses.id),
    )
    .limit(Math.max(0, opts.limit));
}

/** How many rows `listStaleBusinesses` would return without a limit. */
export async function countStaleBusinesses(
  db: Db,
  opts: { olderThanHours: number; source?: BusinessSource; now?: Date },
): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(businesses).where(staleWhere(opts));
  return Number(r?.n ?? 0);
}

/** Records a failed scrape: stamps `scrapeFailedAt` and increments `scrapeAttempts`. */
export async function markScrapeFailed(db: Db, id: string, now: Date = new Date()): Promise<void> {
  if (!UUID_RE.test(id)) return;
  await db
    .update(businesses)
    .set({ scrapeFailedAt: now, scrapeAttempts: sql`${businesses.scrapeAttempts} + 1` })
    .where(eq(businesses.id, id));
}

// ------------------------------------------------------------ external-links enrichment

/** An enriched row with no social links is retried once its attempt is this old. */
export const LINKS_RETRY_AFTER_DAYS = 7;

/**
 * Rejection reasons a website visit can cure (`no_phone`: the site may list
 * one) or that are only soft flags. A rejected row whose reasons are all in
 * this list is still enriched; any other reason rules it out.
 */
export const ENRICHABLE_REJECTION_REASONS = ["no_phone", "unclaimed", "low_score"] as const;

/**
 * SQL: a row is pending link enrichment when it has a website or a domain-like
 * slug, and was never enriched, or was enriched over 7 days ago with no social
 * links (docs/team/links/architecture.md §Data model); and it is not
 * rejected for a reason outside ENRICHABLE_REJECTION_REASONS (qualify before
 * enrich, docs/team/google/architecture.md §Page source).
 */
function pendingLinksWhere(now: Date) {
  const cutoff = new Date(now.getTime() - LINKS_RETRY_AFTER_DAYS * 24 * 3_600_000);
  const hasTarget = or(
    sql`btrim(coalesce(${businesses.website}, '')) <> ''`,
    sql`lower(btrim(coalesce(${businesses.slug}, ''))) ~ ${DOMAIN_SLUG_PATTERN}`,
  );
  const due = or(
    isNull(businesses.enrichedAt),
    and(lt(businesses.enrichedAt, cutoff), sql`${businesses.socialLinks} = '{}'::jsonb`),
  );
  const allowed = sql.join(
    ENRICHABLE_REJECTION_REASONS.map((r) => sql`${r}`),
    sql`, `,
  );
  const worthIt = sql`NOT (${businesses.qualification} = 'rejected' AND NOT (${businesses.rejectionReasons} <@ ARRAY[${allowed}]::text[]))`;
  return and(hasTarget, due, worthIt);
}

/**
 * Ids of rows pending link enrichment: never enriched first (oldest
 * `createdAt` first), then stale-empty ones (oldest `enrichedAt` first).
 * `ids` narrows the set to those rows; `exclude` leaves rows out.
 */
export async function listPendingLinkIds(
  db: Db,
  opts: { limit: number; now?: Date; ids?: string[]; exclude?: string[] },
): Promise<string[]> {
  const conds = [pendingLinksWhere(opts.now ?? new Date())];
  if (opts.ids) {
    const ids = opts.ids.filter((id) => UUID_RE.test(id));
    if (ids.length === 0) return [];
    conds.push(inArray(businesses.id, ids));
  }
  const exclude = (opts.exclude ?? []).filter((id) => UUID_RE.test(id));
  if (exclude.length > 0) conds.push(sql`${businesses.id} NOT IN (${sql.join(exclude.map((id) => sql`${id}::uuid`), sql`, `)})`);
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(...conds))
    .orderBy(
      sql`${businesses.enrichedAt} ASC NULLS FIRST`,
      asc(businesses.createdAt),
      asc(businesses.id),
    )
    .limit(Math.max(0, opts.limit));
  return rows.map((r) => r.id);
}

/** How many rows are pending link enrichment. */
export async function countPendingLinks(db: Db, opts: { now?: Date } = {}): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(businesses)
    .where(pendingLinksWhere(opts.now ?? new Date()));
  return Number(r?.n ?? 0);
}

/** Graph nodes for the lookup network, most-reviewed first. */
export async function listGraphNodes(db: Db, limit = 1000): Promise<GraphNode[]> {
  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      category: businesses.primaryCategory,
      totalReviews: businesses.reviewCount,
      rating: businesses.rating,
      reviewsLast30d: businesses.reviewsLast30d,
    })
    .from(businesses)
    .orderBy(desc(businesses.reviewCount), asc(businesses.name), asc(businesses.id))
    .limit(Math.max(0, limit));
  return rows.map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating) }));
}
