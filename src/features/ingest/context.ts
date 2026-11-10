// Builds QualifyContext values from the database: one row at a time for
// ingestion (qualifyOne) and in bulk for requalifyAll.
import { type SQL, and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type Business, type SearchJob, businesses, searchJobs } from "@/db/schema";
import { isSharedHost } from "@/lib/domain";
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
  // Google rows: the job's accepted place types as stored (empty for custom terms → no category rule).
  // Without the job the category rule is skipped rather than guessed from searchCategory.
  if (b.source === "google") {
    return {
      searchCategory: b.searchCategory ?? b.primaryCategory ?? "",
      categoryAliases: job ? job.categoryAliases : [],
      radiusM: job ? job.radiusM : FALLBACK_RADIUS_M,
      locationState: parseLocationState(job ? job.location : b.searchLocation),
    };
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
 * Stable per-row ordering key for the duplicate tie-breaks: the Yelp id, else
 * the Trustpilot slug, else the Google place id, else the row id (yelpId is
 * null on Trustpilot and Google rows).
 */
export const ORDER_KEY = sql`coalesce(${businesses.yelpId}, ${businesses.trustpilotId}, ${businesses.googlePlaceId}, ${businesses.id}::text)`;

/** Case-insensitive email key; the same expression as the `businesses_email_lower_idx` index. */
const EMAIL_KEY = sql`lower(${businesses.email})`;

/**
 * True when an earlier-ingested other business matches `where`. "Earlier" =
 * (createdAt, ORDER_KEY) ordering compared in SQL at full precision, so the
 * first record of a duplicate pair stays clean and re-qualification never
 * flips it.
 */
async function hasEarlierMatch(db: Db, id: string, where: SQL): Promise<boolean> {
  const self = db
    .select({ createdAt: businesses.createdAt, key: sql<string>`${ORDER_KEY}`.as("key") })
    .from(businesses)
    .where(eq(businesses.id, id))
    .as("self");
  const [row] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .innerJoin(self, sql`true`)
    .where(
      and(
        where,
        sql`${businesses.id} <> ${id}`,
        sql`(${businesses.createdAt}, ${ORDER_KEY}) < (${self.createdAt}, ${self.key})`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** True when an earlier-ingested other business has the same phoneDigits. */
export async function hasEarlierPhoneDuplicate(db: Db, b: Pick<Business, "id" | "phoneDigits">): Promise<boolean> {
  if (!b.phoneDigits) return false;
  return hasEarlierMatch(db, b.id, eq(businesses.phoneDigits, b.phoneDigits));
}

/** True when an earlier-ingested other business has the same websiteDomain; never for a shared host. */
export async function hasEarlierWebsiteDuplicate(db: Db, b: Pick<Business, "id" | "websiteDomain">): Promise<boolean> {
  if (!b.websiteDomain || isSharedHost(b.websiteDomain)) return false;
  return hasEarlierMatch(db, b.id, eq(businesses.websiteDomain, b.websiteDomain));
}

/** True when an earlier-ingested other business has the same email, compared as lower(email). */
export async function hasEarlierEmailDuplicate(db: Db, b: Pick<Business, "id" | "email">): Promise<boolean> {
  const email = b.email?.trim();
  if (!email) return false;
  return hasEarlierMatch(db, b.id, sql`${EMAIL_KEY} = ${email.toLowerCase()}`);
}

export async function loadJob(db: Db, id: string | null): Promise<SearchJob | null> {
  if (!id) return null;
  const [job] = await db.select().from(searchJobs).where(eq(searchJobs.id, id));
  return job ?? null;
}

export async function buildContext(db: Db, b: Business, job?: JobLike | null): Promise<QualifyContext> {
  const j = job === undefined ? await loadJob(db, b.sourceJobId) : job;
  const [cities, phone, website, email] = await Promise.all([
    sameNameCityCount(db, b.nameNormalized),
    hasEarlierPhoneDuplicate(db, b),
    hasEarlierWebsiteDuplicate(db, b),
    hasEarlierEmailDuplicate(db, b),
  ]);
  return {
    ...searchContext(b, j),
    sameNameCityCount: cities,
    phoneDuplicate: phone,
    websiteDuplicate: website,
    emailDuplicate: email,
  };
}

/**
 * Bulk lookups for requalifyAll: city counts per name, duplicate ids per
 * phone, website domain and email, and jobs by id — five queries total.
 */
export async function buildContextIndex(db: Db, rows: Pick<Business, "sourceJobId">[]) {
  const cityRows = await db
    .select({
      name: businesses.nameNormalized,
      n: sql<number>`count(DISTINCT (lower(coalesce(${businesses.city}, '')), lower(coalesce(${businesses.state}, ''))))`,
    })
    .from(businesses)
    .groupBy(businesses.nameNormalized);
  const citiesByName = new Map(cityRows.map((r) => [r.name, Number(r.n)]));

  // Earliest (createdAt, ORDER_KEY) per phone stays clean; every later one is a duplicate.
  const dupRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM (SELECT ${businesses.id} AS id, row_number() OVER (PARTITION BY ${businesses.phoneDigits} ORDER BY ${businesses.createdAt}, ${ORDER_KEY}) AS rn FROM ${businesses} WHERE ${businesses.phoneDigits} IS NOT NULL) t WHERE rn > 1`,
  );
  const duplicateIds = new Set(rowsOf<{ id: string }>(dupRows).map((r) => r.id));

  // Same rule per website domain; shared hosts are filtered out here (the list lives in TS).
  const siteRows = await db.execute<{ id: string; d: string }>(
    sql`SELECT id, d FROM (SELECT ${businesses.id} AS id, ${businesses.websiteDomain} AS d, row_number() OVER (PARTITION BY ${businesses.websiteDomain} ORDER BY ${businesses.createdAt}, ${ORDER_KEY}) AS rn FROM ${businesses} WHERE ${businesses.websiteDomain} IS NOT NULL) t WHERE rn > 1`,
  );
  const websiteDuplicateIds = new Set(
    rowsOf<{ id: string; d: string }>(siteRows)
      .filter((r) => !isSharedHost(r.d))
      .map((r) => r.id),
  );

  // And per email, case-insensitive (same key and emptiness rule as hasEarlierEmailDuplicate).
  const emailRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM (SELECT ${businesses.id} AS id, row_number() OVER (PARTITION BY ${EMAIL_KEY} ORDER BY ${businesses.createdAt}, ${ORDER_KEY}) AS rn FROM ${businesses} WHERE btrim(coalesce(${businesses.email}, '')) <> '') t WHERE rn > 1`,
  );
  const emailDuplicateIds = new Set(rowsOf<{ id: string }>(emailRows).map((r) => r.id));

  const jobIds = [...new Set(rows.map((r) => r.sourceJobId).filter((x): x is string => !!x))];
  const jobs = jobIds.length ? await db.select().from(searchJobs).where(inArray(searchJobs.id, jobIds)) : [];
  const jobsById = new Map(jobs.map((j) => [j.id, j]));

  return {
    contextFor(b: Business): QualifyContext {
      return {
        ...searchContext(b, b.sourceJobId ? (jobsById.get(b.sourceJobId) ?? null) : null),
        sameNameCityCount: citiesByName.get(b.nameNormalized) ?? 1,
        phoneDuplicate: duplicateIds.has(b.id),
        websiteDuplicate: websiteDuplicateIds.has(b.id),
        emailDuplicate: emailDuplicateIds.has(b.id),
      };
    },
  };
}

/** `db.execute` returns `{ rows }` on PGlite and an array on postgres-js. */
export function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
