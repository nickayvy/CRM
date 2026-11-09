import { asc, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { logActivity } from "@/db/repo/activities";
import {
  countByQualification,
  getBusiness,
  setQualification,
  upsertBusinessByYelpId,
} from "@/db/repo/businesses";
import { getRules } from "@/db/repo/rules";
import { getSearchJob, updateSearchJob } from "@/db/repo/search-jobs";
import { type Business, type Qualification, type QualificationRules, type SearchJob, businesses } from "@/db/schema";
import { type QualifyResult, qualify } from "@/lib/qualify";
import { type YelpClient, normalizeYelpBusiness, searchAll } from "@/lib/yelp";
import { ORDER_KEY, buildContext, buildContextIndex } from "./context";

/** Job counters are persisted after every this-many fetched businesses (one Yelp page). */
const PROGRESS_EVERY = 50;
/** Rows per bulk UPDATE in requalifyAll. */
const REQUALIFY_CHUNK = 500;

export type ProgressCallback = (job: SearchJob) => void;

/** Builds a QualifyContext for this business from the DB, qualifies it, and stores the result. */
export async function qualifyOne(db: Db, business: Business, rules?: QualificationRules): Promise<QualifyResult> {
  const r = rules ?? (await getRules(db));
  const ctx = await buildContext(db, business);
  const result = qualify(business, ctx, r);
  await setQualification(db, business.id, result);
  return result;
}

/**
 * Runs a search job: pages Yelp, upserts every business by
 * Yelp id, qualifies each one with a fresh context, and persists counters
 * after every page. Status goes running → completed, or failed with `error`.
 * Never throws for Yelp/DB failures during the run; returns the final job.
 */
export async function runSearchJob(
  db: Db,
  jobId: string,
  client: YelpClient,
  opts: { onProgress?: ProgressCallback } = {},
): Promise<SearchJob> {
  const job = await getSearchJob(db, jobId);
  if (!job) throw new Error(`Search job not found: ${jobId}`);

  const startCalls = client.callCount;
  const counts = { fetchedCount: 0, qualifiedCount: 0, reviewCount: 0, rejectedCount: 0 };
  const persist = async (extra: Partial<SearchJob> = {}) => {
    await updateSearchJob(db, jobId, { ...counts, apiCalls: client.callCount - startCalls, ...extra });
    if (opts.onProgress) {
      const fresh = await getSearchJob(db, jobId);
      if (fresh) opts.onProgress(fresh);
    }
  };

  await updateSearchJob(db, jobId, {
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    ...counts,
    apiCalls: 0,
  });

  try {
    const rules = await getRules(db);
    const searchCategory = job.categoryAliases[0] ?? "";
    const seen = new Set<string>();
    const params = {
      location: job.location,
      categories: job.categoryAliases.join(","),
      radius: job.radiusM,
      ...(job.term ? { term: job.term } : {}),
    };
    for await (const y of searchAll(client, params, job.maxResults)) {
      if (seen.has(y.id)) continue;
      seen.add(y.id);
      const row = normalizeYelpBusiness(y, { jobId, searchCategory, searchLocation: job.location });
      const { business } = await upsertBusinessByYelpId(db, row);
      const result = await qualifyOne(db, business, rules);
      counts.fetchedCount++;
      counts[`${result.qualification}Count` as const]++;
      if (counts.fetchedCount % PROGRESS_EVERY === 0) await persist();
    }
    await persist({ status: "completed", finishedAt: new Date() });
  } catch (err) {
    console.error(`[ingest] search job ${jobId} failed`, err);
    await persist({
      status: "failed",
      finishedAt: new Date(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return (await getSearchJob(db, jobId))!;
}

/** Fetches Yelp details, stores hours/photos/isClaimed/enrichedAt, logs a system activity, and re-qualifies. */
export async function enrichBusiness(db: Db, id: string, client: YelpClient): Promise<Business> {
  const b = await getBusiness(db, id);
  if (!b) throw new Error(`Business not found: ${id}`);
  if (!b.yelpId) throw new Error("Only Yelp businesses can be enriched from Yelp.");
  const d = await client.details(b.yelpId);
  const now = new Date();
  const photos = Array.isArray(d.photos) ? d.photos : [];
  const isClaimed = typeof d.is_claimed === "boolean" ? d.is_claimed : null;
  await db
    .update(businesses)
    .set({
      hours: Array.isArray(d.hours) ? d.hours : null,
      photos,
      isClaimed,
      enrichedAt: now,
      updatedAt: now,
    })
    .where(sql`${businesses.id} = ${id}`);
  const updated = (await getBusiness(db, id))!;
  const before = { qualification: b.qualification, score: b.score };
  const result = await qualifyOne(db, updated);
  await logActivity(db, {
    businessId: id,
    type: "system",
    body: `Enriched from Yelp: ${isClaimed === null ? "claim status unknown" : isClaimed ? "claimed" : "unclaimed"}, ${photos.length} photo${photos.length === 1 ? "" : "s"}. Score ${before.score} → ${result.score}.`,
    metadata: { kind: "enrich", before, after: { qualification: result.qualification, score: result.score } },
  });
  return (await getBusiness(db, id))!;
}

/**
 * Re-runs the engine over every business with the current rules. Rules are
 * loaded once; context lookups are batched (three queries), and results are
 * written with chunked bulk UPDATEs. Returns `countByQualification`.
 */
export async function requalifyAll(db: Db): Promise<Record<Qualification, number>> {
  const rules = await getRules(db);
  const rows = await db.select().from(businesses).orderBy(asc(businesses.createdAt), asc(ORDER_KEY));
  const index = await buildContextIndex(db, rows);
  const results = rows.map((b) => ({ id: b.id, r: qualify(b, index.contextFor(b), rules) }));

  const now = new Date().toISOString();
  for (let i = 0; i < results.length; i += REQUALIFY_CHUNK) {
    const chunk = results.slice(i, i + REQUALIFY_CHUNK).map(({ id, r }) => ({
      id,
      q: r.qualification,
      s: r.score,
      r: r.reasons.join(","),
    }));
    await db.execute(sql`
      UPDATE ${businesses} AS b SET
        qualification = v.q::qualification,
        score = v.s,
        rejection_reasons = CASE WHEN v.r = '' THEN '{}'::text[] ELSE string_to_array(v.r, ',') END,
        qualified_at = ${now}::timestamptz,
        updated_at = ${now}::timestamptz
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS v(id uuid, q text, s integer, r text)
      WHERE b.id = v.id`);
  }
  return countByQualification(db);
}
