// Storage for Google Places ingest: upsert by place id with cross-source
// matching, the monthly usage counter, Google jobs and their slice lease.
import { and, asc, desc, eq, getTableColumns, inArray, isNull, ne, sql } from "drizzle-orm";
import { matchableDomain } from "@/lib/domain";
import type { PlanPreview } from "@/lib/google-places/plan";
import type { Db } from "../client";
import {
  type Business,
  type NewBusiness,
  type SearchJob,
  apiUsage,
  businesses,
  reviewSnapshots,
  searchJobs,
} from "../schema";
import { CRM_FIELDS, guardEditedOnConflict, withoutEdited } from "./businesses";

export const GOOGLE_PLACES_PROVIDER = "google_places";
/** Slice lease length; renewed after every search. */
export const JOB_LEASE_MS = 120_000;

// ------------------------------------------------------------ upsert

export type GoogleUpsert = { business: Business; outcome: "created" | "updated" | "matched" };

/** Columns a match (or a refresh of a matched non-Google row) must never change. */
const MATCH_KEEP = new Set<string>([
  "source",
  "name",
  "nameNormalized",
  "rating",
  "reviewCount",
  "categories",
  "primaryCategory",
  "subcategory",
  "isClosed",
  "raw",
]);
const NEVER_WRITE = new Set<string>([...CRM_FIELDS, "id", "createdAt", "updatedAt", "googlePlaceId", "websiteDomain"]);

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Patch that fills only the existing row's empty columns (plus the Maps URL), for matched rows. */
function fillEmpty(existing: Business, row: NewBusiness): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || NEVER_WRITE.has(k) || MATCH_KEEP.has(k)) continue;
    if (k === "googleMapsUrl") {
      if (v !== null) set[k] = v;
      continue;
    }
    if (isEmpty((existing as Record<string, unknown>)[k]) && !isEmpty(v)) set[k] = v;
  }
  return set;
}

/** Patch that refreshes every Google-owned column of a Google row. */
function refresh(row: NewBusiness): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || NEVER_WRITE.has(k)) continue;
    set[k] = v;
  }
  return set;
}

async function findMatch(db: Db, row: NewBusiness): Promise<Business | null> {
  const candidates = and(ne(businesses.source, "google"), isNull(businesses.googlePlaceId));
  const oldest = [asc(businesses.createdAt), asc(businesses.id)];
  if (row.phoneDigits) {
    const [hit] = await db
      .select()
      .from(businesses)
      .where(and(candidates, eq(businesses.phoneDigits, row.phoneDigits)))
      .orderBy(...oldest)
      .limit(1);
    if (hit) return hit;
  }
  const domain = matchableDomain(row.website ?? null);
  if (domain) {
    const [hit] = await db
      .select()
      .from(businesses)
      .where(and(candidates, eq(businesses.websiteDomain, domain)))
      .orderBy(...oldest)
      .limit(1);
    if (hit) return hit;
  }
  return null;
}

/**
 * created: no row had this place id and nothing matched; inserted.
 * updated: a row already had this place id; Google-owned columns refreshed.
 *          (A matched Yelp/Trustpilot row that carries the place id keeps the
 *          match rules on refresh: only empty columns and the Maps URL.)
 * matched: a non-Google row without a place id matched on phoneDigits or
 *          websiteDomain (never a shared host); place id and Maps URL
 *          attached, only empty columns filled; source, name, rating,
 *          reviewCount, categories unchanged. Ties: the oldest row.
 * CRM fields are never written.
 */
export async function upsertGooglePlace(db: Db, row: NewBusiness & { googlePlaceId: string }): Promise<GoogleUpsert> {
  const now = new Date();
  const [existing] = await db.select().from(businesses).where(eq(businesses.googlePlaceId, row.googlePlaceId));
  if (existing) {
    const set = withoutEdited(existing.source === "google" ? refresh(row) : fillEmpty(existing, row), existing.editedFields);
    const [business] = await db
      .update(businesses)
      .set({ ...set, updatedAt: now })
      .where(eq(businesses.id, existing.id))
      .returning();
    return { business, outcome: "updated" };
  }

  const match = await findMatch(db, row);
  if (match) {
    const [business] = await db
      .update(businesses)
      .set({ ...withoutEdited(fillEmpty(match, row), match.editedFields), googlePlaceId: row.googlePlaceId, updatedAt: now })
      // Guard against a concurrent attach of another place to the same row.
      .where(and(eq(businesses.id, match.id), isNull(businesses.googlePlaceId)))
      .returning();
    if (business) return { business, outcome: "matched" };
  }

  const values: NewBusiness = { ...row, source: "google" };
  const [res] = await db
    .insert(businesses)
    .values(values)
    .onConflictDoUpdate({ target: businesses.googlePlaceId, set: { ...guardEditedOnConflict(refresh(row)), updatedAt: now } })
    .returning({ ...getTableColumns(businesses), __inserted: sql<boolean>`(xmax = 0)` });
  const { __inserted, ...business } = res;
  return { business: business as Business, outcome: __inserted ? "created" : "updated" };
}

export async function getBusinessByPlaceId(db: Db, placeId: string): Promise<Business | null> {
  const [row] = await db.select().from(businesses).where(eq(businesses.googlePlaceId, placeId));
  return row ?? null;
}

// ------------------------------------------------------------ usage

/** "YYYY-MM" in UTC. */
export function usagePeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Atomically adds one request to this month's counter when it is below
 *  `cap`; false (nothing counted) when the cap is reached. */
export async function reserveUsage(db: Db, provider: string, cap: number, now: Date = new Date()): Promise<boolean> {
  const period = usagePeriod(now);
  const limit = Math.max(0, Math.floor(cap));
  if (limit <= 0) return false;
  const res = await db.execute<{ requests: number }>(sql`
    INSERT INTO ${apiUsage} (provider, period, requests, updated_at)
    VALUES (${provider}, ${period}, 1, now())
    ON CONFLICT (provider, period) DO UPDATE
      SET requests = ${apiUsage}.requests + 1, updated_at = now()
      WHERE ${apiUsage}.requests < ${limit}
    RETURNING requests`);
  return rowsOf(res).length > 0;
}

export async function getUsage(db: Db, provider: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: apiUsage.requests })
    .from(apiUsage)
    .where(and(eq(apiUsage.provider, provider), eq(apiUsage.period, usagePeriod(now))));
  return row?.n ?? 0;
}

// ------------------------------------------------------------ jobs

export async function createGoogleJob(db: Db, preview: PlanPreview): Promise<SearchJob> {
  const [row] = await db
    .insert(searchJobs)
    .values({
      source: "google",
      term: preview.term,
      location: preview.location,
      categoryAliases: preview.plan.acceptTypes,
      plan: preview.plan,
      queriesTotal: preview.queries,
    })
    .returning();
  return row;
}

/** Google jobs with status pending or running, oldest first. */
export async function listUnfinishedGoogleJobs(db: Db, limit = 20): Promise<SearchJob[]> {
  return db
    .select()
    .from(searchJobs)
    .where(and(eq(searchJobs.source, "google"), inArray(searchJobs.status, ["pending", "running"])))
    .orderBy(asc(searchJobs.createdAt), asc(searchJobs.id))
    .limit(limit);
}

/** Newest Google jobs first. */
export async function listGoogleJobs(db: Db, limit = 50): Promise<SearchJob[]> {
  return db
    .select()
    .from(searchJobs)
    .where(eq(searchJobs.source, "google"))
    .orderBy(desc(searchJobs.createdAt), desc(searchJobs.id))
    .limit(limit);
}

// ------------------------------------------------------------ lease

/**
 * Takes the job's slice lease when it is free or expired. Returns the lease
 * token (its expiry time) or null when another slice holds it. The token is
 * compared on renew/release so an expired holder never frees a newer lease.
 */
export async function acquireJobLease(db: Db, jobId: string, now: Date = new Date(), ms = JOB_LEASE_MS): Promise<Date | null> {
  const until = new Date(now.getTime() + ms);
  const rows = await db
    .update(searchJobs)
    .set({ leaseExpiresAt: until })
    .where(
      and(
        eq(searchJobs.id, jobId),
        sql`(${searchJobs.leaseExpiresAt} IS NULL OR ${searchJobs.leaseExpiresAt} <= ${now.toISOString()}::timestamptz)`,
      ),
    )
    .returning({ id: searchJobs.id });
  return rows.length ? until : null;
}

/** Extends a held lease; returns the new token, or null when the lease was lost. */
export async function renewJobLease(db: Db, jobId: string, token: Date, now: Date = new Date(), ms = JOB_LEASE_MS): Promise<Date | null> {
  const until = new Date(now.getTime() + ms);
  const rows = await db
    .update(searchJobs)
    .set({ leaseExpiresAt: until })
    .where(and(eq(searchJobs.id, jobId), eq(searchJobs.leaseExpiresAt, token)))
    .returning({ id: searchJobs.id });
  return rows.length ? until : null;
}

export async function releaseJobLease(db: Db, jobId: string, token: Date): Promise<void> {
  await db
    .update(searchJobs)
    .set({ leaseExpiresAt: null })
    .where(and(eq(searchJobs.id, jobId), eq(searchJobs.leaseExpiresAt, token)));
}

// ------------------------------------------------------------ review snapshots (R17)

export const SNAPSHOT_MIN_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * Stores a review-count snapshot unless the business already has one from the
 * last 24 h. Returns whether one was stored.
 */
export async function addDailySnapshot(db: Db, businessId: string, totalReviews: number, now: Date = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - SNAPSHOT_MIN_GAP_MS);
  const [recent] = await db
    .select({ id: reviewSnapshots.id })
    .from(reviewSnapshots)
    .where(
      and(
        eq(reviewSnapshots.businessId, businessId),
        sql`${reviewSnapshots.capturedAt} > ${since.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  if (recent) return false;
  await db.insert(reviewSnapshots).values({ businessId, totalReviews, capturedAt: now });
  return true;
}

/** `db.execute` returns `{ rows }` on PGlite and an array on postgres-js. */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
