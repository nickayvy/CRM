// Builds QualifyContext values from the database: one row at a time for
// ingestion (qualifyOne) and in bulk for requalifyAll.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type Business, type SearchJob, businesses, searchJobs } from "@/db/schema";
import { type QualifyContext, parseLocationState } from "@/lib/qualify";

/** Radius used when a business's source job no longer exists. */
export const FALLBACK_RADIUS_M = 20000;

type JobLike = Pick<SearchJob, "categoryAliases" | "radiusM" | "location">;

/** The search-dependent part of the context: from the business's source job, else its own searchCategory/searchLocation. */
export function searchContext(
  b: Pick<Business, "searchCategory" | "searchLocation" | "primaryCategory"> & { source?: Business["source"] },
  job: JobLike | null,
): Pick<QualifyContext, "searchCategory" | "categoryAliases" | "radiusM" | "locationState"> {
  // Trustpilot rows have no Yelp category aliases and no search area: no category or area rules apply.
  if (b.source === "trustpilot") {
    return { searchCategory: b.primaryCategory ?? "", categoryAliases: [], radiusM: FALLBACK_RADIUS_M, locationState: null };
  }
  if (job) {
    const aliases = job.categoryAliases.length ? job.categoryAliases : b.searchCategory ? [b.searchCategory] : [];
    return {
      searchCategory: aliases[0] ?? "",
      categoryAliases: aliases,
      radiusM: job.radiusM,
      locationState: parseLocationState(job.location),
    };
  }
  const category = b.searchCategory ?? b.primaryCategory ?? "";
  return {
    searchCategory: category,
    categoryAliases: category ? [category] : [],
    radiusM: FALLBACK_RADIUS_M,
    locationState: parseLocationState(b.searchLocation),
  };
}

/** Distinct (city, state) pairs among rows sharing this nameNormalized, including the row itself. */
export async function sameNameCityCount(db: Db, nameNormalized: string): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`count(DISTINCT (lower(coalesce(${businesses.city}, '')), lower(coalesce(${businesses.state}, ''))))`,
    })
    .from(businesses)
    .where(eq(businesses.nameNormalized, nameNormalized));
  return Number(row?.n ?? 0);
}

/**
 * Stable per-row ordering key for the duplicate-phone tie-break: the Yelp id,
 * else the Trustpilot slug, else the row id (yelpId is null on Trustpilot rows).
 */
export const ORDER_KEY = sql`coalesce(${businesses.yelpId}, ${businesses.trustpilotId}, ${businesses.id}::text)`;

/**
 * True when an earlier-ingested other business has the same phoneDigits.
 * "Earlier" = (createdAt, ORDER_KEY) ordering compared in SQL at full
 * precision, so the first record of a duplicate pair stays clean and
 * re-qualification never flips it.
 */
export async function hasEarlierPhoneDuplicate(db: Db, b: Pick<Business, "id" | "phoneDigits">): Promise<boolean> {
  if (!b.phoneDigits) return false;
  const self = db
    .select({ createdAt: businesses.createdAt, key: sql<string>`${ORDER_KEY}`.as("key") })
    .from(businesses)
    .where(eq(businesses.id, b.id))
    .as("self");
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .innerJoin(self, sql`true`)
    .where(
      and(
        eq(businesses.phoneDigits, b.phoneDigits),
        sql`${businesses.id} <> ${b.id}`,
        sql`(${businesses.createdAt}, ${ORDER_KEY}) < (${self.createdAt}, ${self.key})`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function loadJob(db: Db, id: string | null): Promise<SearchJob | null> {
  if (!id) return null;
  const [job] = await db.select().from(searchJobs).where(eq(searchJobs.id, id));
  return job ?? null;
}

export async function buildContext(db: Db, b: Business, job?: JobLike | null): Promise<QualifyContext> {
  const j = job === undefined ? await loadJob(db, b.sourceJobId) : job;
  const [cities, dup] = await Promise.all([sameNameCityCount(db, b.nameNormalized), hasEarlierPhoneDuplicate(db, b)]);
  return { ...searchContext(b, j), sameNameCityCount: cities, phoneDuplicate: dup };
}

/** Bulk lookups for requalifyAll: city counts per name, duplicate ids, and jobs by id — three queries total. */
export async function buildContextIndex(db: Db, rows: Pick<Business, "sourceJobId">[]) {
  const cityRows = await db
    .select({
      name: businesses.nameNormalized,
      n: sql<number>`count(DISTINCT (lower(coalesce(${businesses.city}, '')), lower(coalesce(${businesses.state}, ''))))`,
    })
    .from(businesses)
    .groupBy(businesses.nameNormalized);
  const citiesByName = new Map(cityRows.map((r) => [r.name, Number(r.n)]));

  // Earliest (createdAt, yelpId) per phone stays clean; every later one is a duplicate.
  const dupRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM (SELECT ${businesses.id} AS id, row_number() OVER (PARTITION BY ${businesses.phoneDigits} ORDER BY ${businesses.createdAt}, ${ORDER_KEY}) AS rn FROM ${businesses} WHERE ${businesses.phoneDigits} IS NOT NULL) t WHERE rn > 1`,
  );
  const duplicateIds = new Set(rowsOf<{ id: string }>(dupRows).map((r) => r.id));

  const jobIds = [...new Set(rows.map((r) => r.sourceJobId).filter((x): x is string => !!x))];
  const jobs = jobIds.length ? await db.select().from(searchJobs).where(inArray(searchJobs.id, jobIds)) : [];
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  return {
    contextFor(b: Business): QualifyContext {
      return {
        ...searchContext(b, b.sourceJobId ? (jobsById.get(b.sourceJobId) ?? null) : null),
        sameNameCityCount: citiesByName.get(b.nameNormalized) ?? 1,
        phoneDuplicate: duplicateIds.has(b.id),
      };
    },
  };
}

/** `db.execute` returns `{ rows }` on PGlite and an array on postgres-js. */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
