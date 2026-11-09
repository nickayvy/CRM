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

/**
 * Businesses never scraped or last scraped more than `olderThanHours` ago:
 * never-scraped first, then oldest `lastScrapedAt`. `source` narrows the set.
 */
export async function listStaleBusinesses(
  db: Db,
  opts: { olderThanHours: number; limit: number; source?: BusinessSource },
): Promise<Business[]> {
  const cutoff = new Date(Date.now() - opts.olderThanHours * 3_600_000);
  const stale = or(isNull(businesses.lastScrapedAt), lt(businesses.lastScrapedAt, cutoff));
  return db
    .select()
    .from(businesses)
    .where(opts.source ? and(stale, eq(businesses.source, opts.source)) : stale)
    .orderBy(sql`${businesses.lastScrapedAt} ASC NULLS FIRST`, asc(businesses.createdAt), asc(businesses.id))
    .limit(Math.max(0, opts.limit));
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
