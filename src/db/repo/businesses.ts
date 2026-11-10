import {
  type AnyColumn,
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { QualifyResult } from "@/lib/qualify";
import type { Db } from "../client";
import {
  type Business,
  type BusinessSource,
  type BusinessStatus,
  type NewBusiness,
  type Qualification,
  businessStatusEnum,
  businesses,
  qualificationEnum,
} from "../schema";

export type BusinessFilter = {
  q?: string;
  qualification?: Qualification[];
  status?: BusinessStatus[];
  city?: string;
  state?: string;
  category?: string;
  /** Any of these category aliases (OR). Combined with `category` by AND when both are set. */
  categories?: string[];
  minScore?: number;
  maxScore?: number;
  hasPhone?: boolean;
  hasEmail?: boolean;
  excludeDoNotCall?: boolean;
  excludeDoNotEmail?: boolean;
  sourceJobId?: string;
  ids?: string[];
  tag?: string;
  source?: BusinessSource;
  minReviews?: number;
  maxReviews?: number;
  /** Bounds on `reviewsLast30d` (review velocity). */
  minL30d?: number;
  maxL30d?: number;
  minRating?: number;
};

export type BusinessSort = {
  field:
    | "name"
    | "score"
    | "rating"
    | "reviewCount"
    | "reviewsLast30d"
    | "city"
    | "status"
    | "createdAt"
    | "lastContactedAt";
  dir: "asc" | "desc";
};

/** CRM-owned columns that a Yelp or Trustpilot upsert must never write on conflict. */
export const CRM_FIELDS = [
  "status",
  "ownerName",
  "ownerEmail",
  "notes",
  "tags",
  "doNotCall",
  "doNotEmail",
  "lastContactedAt",
  "nextFollowUpAt",
] as const satisfies readonly (keyof Business)[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function buildWhere(f: BusinessFilter = {}): SQL | undefined {
  const c: (SQL | undefined)[] = [];
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const like = `%${escapeLike(q)}%`;
    c.push(
      or(
        ilike(businesses.name, like),
        ilike(businesses.slug, like),
        ilike(businesses.website, like),
        digits.length >= 3 ? sql`${businesses.phoneDigits} LIKE ${`%${digits}%`}` : undefined,
      ),
    );
  }
  if (f.qualification?.length) c.push(inArray(businesses.qualification, f.qualification));
  if (f.status?.length) c.push(inArray(businesses.status, f.status));
  if (f.city?.trim()) c.push(sql`lower(${businesses.city}) = ${f.city.trim().toLowerCase()}`);
  if (f.state?.trim()) c.push(sql`lower(${businesses.state}) = ${f.state.trim().toLowerCase()}`);
  if (f.category?.trim())
    c.push(sql`${businesses.categories} @> ${JSON.stringify([{ alias: f.category.trim() }])}::jsonb`);
  const anyOf = (f.categories ?? []).map((a) => a.trim()).filter(Boolean);
  if (anyOf.length)
    c.push(or(...anyOf.map((a) => sql`${businesses.categories} @> ${JSON.stringify([{ alias: a }])}::jsonb`)));
  if (f.minScore !== undefined) c.push(gte(businesses.score, f.minScore));
  if (f.maxScore !== undefined) c.push(lte(businesses.score, f.maxScore));
  if (f.hasPhone === true) c.push(isNotNull(businesses.phoneDigits));
  if (f.hasPhone === false) c.push(isNull(businesses.phoneDigits));
  if (f.hasEmail === true) c.push(and(isNotNull(businesses.ownerEmail), ne(businesses.ownerEmail, "")));
  if (f.hasEmail === false) c.push(or(isNull(businesses.ownerEmail), eq(businesses.ownerEmail, "")));
  if (f.excludeDoNotCall) c.push(eq(businesses.doNotCall, false));
  if (f.excludeDoNotEmail) c.push(eq(businesses.doNotEmail, false));
  if (f.sourceJobId) c.push(UUID_RE.test(f.sourceJobId) ? eq(businesses.sourceJobId, f.sourceJobId) : sql`false`);
  if (f.ids) {
    const ids = f.ids.filter((id) => UUID_RE.test(id));
    c.push(ids.length ? inArray(businesses.id, ids) : sql`false`);
  }
  if (f.tag?.trim()) c.push(sql`${f.tag.trim()} = ANY(${businesses.tags})`);
  if (f.source) c.push(eq(businesses.source, f.source));
  if (f.minReviews !== undefined) c.push(gte(businesses.reviewCount, f.minReviews));
  if (f.maxReviews !== undefined) c.push(lte(businesses.reviewCount, f.maxReviews));
  if (f.minL30d !== undefined) c.push(gte(businesses.reviewsLast30d, f.minL30d));
  if (f.maxL30d !== undefined) c.push(lte(businesses.reviewsLast30d, f.maxL30d));
  if (f.minRating !== undefined) c.push(sql`${businesses.rating} >= ${String(f.minRating)}::numeric`);
  const parts = c.filter((x): x is SQL => x !== undefined);
  return parts.length ? and(...parts) : undefined;
}

const SORT_COLUMNS: Record<BusinessSort["field"], AnyColumn> = {
  name: businesses.name,
  score: businesses.score,
  rating: businesses.rating,
  reviewCount: businesses.reviewCount,
  reviewsLast30d: businesses.reviewsLast30d,
  city: businesses.city,
  status: businesses.status,
  createdAt: businesses.createdAt,
  lastContactedAt: businesses.lastContactedAt,
};

function orderBy(sort?: BusinessSort): SQL[] {
  const s = sort ?? { field: "score", dir: "desc" };
  const col = SORT_COLUMNS[s.field] ?? businesses.score;
  const primary = s.dir === "asc" ? sql`${col} ASC NULLS LAST` : sql`${col} DESC NULLS LAST`;
  // Stable tie-breakers so paging never repeats or skips rows.
  return [primary, asc(businesses.name), asc(businesses.id)];
}

/** Filtered, sorted page of businesses; `total` counts all matches ignoring limit/offset. Default sort: score desc. */
export async function listBusinesses(
  db: Db,
  f: BusinessFilter,
  opts: { sort?: BusinessSort; limit?: number; offset?: number } = {},
): Promise<{ rows: Business[]; total: number }> {
  const where = buildWhere(f);
  const limit = Math.max(0, Math.min(opts.limit ?? 50, 1000));
  const offset = Math.max(0, opts.offset ?? 0);
  const [rows, [{ n }]] = await Promise.all([
    db
      .select()
      .from(businesses)
      .where(where)
      .orderBy(...orderBy(opts.sort))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(businesses).where(where),
  ]);
  return { rows, total: Number(n) };
}

/** Every matching id (no paging), score desc then name. */
export async function listBusinessIds(db: Db, f: BusinessFilter): Promise<string[]> {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(buildWhere(f))
    .orderBy(...orderBy());
  return rows.map((r) => r.id);
}

export async function getBusiness(db: Db, id: string): Promise<Business | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(businesses).where(eq(businesses.id, id));
  return row ?? null;
}

/**
 * Insert by `yelpId`, or update the Yelp-owned columns of the existing row.
 * CRM fields (status, owner*, notes, tags, doNot*, lastContactedAt,
 * nextFollowUpAt) are never written on conflict; keys absent from `row` are
 * left untouched.
 */
export async function upsertBusinessByYelpId(
  db: Db,
  row: NewBusiness,
): Promise<{ business: Business; created: boolean }> {
  const set: Record<string, unknown> = {};
  const skip = new Set<string>([...CRM_FIELDS, "id", "yelpId", "createdAt", "updatedAt"]);
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined || skip.has(k)) continue;
    set[k] = v;
  }
  set.updatedAt = new Date();
  const [res] = await db
    .insert(businesses)
    .values(row)
    .onConflictDoUpdate({ target: businesses.yelpId, set })
    .returning({ ...getTableColumns(businesses), __inserted: sql<boolean>`(xmax = 0)` });
  const { __inserted, ...business } = res;
  return { business: business as Business, created: Boolean(__inserted) };
}

export async function updateBusinessCrm(
  db: Db,
  id: string,
  patch: Partial<
    Pick<Business, "status" | "ownerName" | "ownerEmail" | "notes" | "tags" | "doNotCall" | "doNotEmail" | "nextFollowUpAt">
  >,
): Promise<Business | null> {
  if (!UUID_RE.test(id)) return null;
  const allowed = ["status", "ownerName", "ownerEmail", "notes", "tags", "doNotCall", "doNotEmail", "nextFollowUpAt"];
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && allowed.includes(k)) set[k] = v;
  set.updatedAt = new Date();
  const [row] = await db.update(businesses).set(set).where(eq(businesses.id, id)).returning();
  return row ?? null;
}

export async function setQualification(db: Db, id: string, r: QualifyResult): Promise<void> {
  const now = new Date();
  await db
    .update(businesses)
    .set({ qualification: r.qualification, score: r.score, rejectionReasons: r.reasons, qualifiedAt: now, updatedAt: now })
    .where(eq(businesses.id, id));
}

export async function countByQualification(db: Db, f?: BusinessFilter): Promise<Record<Qualification, number>> {
  const rows = await db
    .select({ k: businesses.qualification, n: count() })
    .from(businesses)
    .where(buildWhere(f))
    .groupBy(businesses.qualification);
  const out = Object.fromEntries(qualificationEnum.enumValues.map((v) => [v, 0])) as Record<Qualification, number>;
  for (const r of rows) out[r.k] = Number(r.n);
  return out;
}

/** Every reason code (hard and soft) with the number of businesses carrying it, most common first. */
export async function countByReason(db: Db): Promise<{ reason: string; count: number }[]> {
  const res = await db.execute<{ reason: string; n: number | string }>(
    sql`SELECT r AS reason, count(*) AS n FROM ${businesses}, unnest(${businesses.rejectionReasons}) AS r GROUP BY r ORDER BY count(*) DESC, r ASC`,
  );
  return rowsOf<{ reason: string; n: number | string }>(res).map((r) => ({ reason: r.reason, count: Number(r.n) }));
}

export async function countByStatus(db: Db): Promise<Record<BusinessStatus, number>> {
  const rows = await db.select({ k: businesses.status, n: count() }).from(businesses).groupBy(businesses.status);
  const out = Object.fromEntries(businessStatusEnum.enumValues.map((v) => [v, 0])) as Record<BusinessStatus, number>;
  for (const r of rows) out[r.k] = Number(r.n);
  return out;
}

/** Cities with at least one business, most businesses first. */
export async function listCities(db: Db): Promise<{ city: string; state: string; count: number }[]> {
  const rows = await db
    .select({ city: businesses.city, state: businesses.state, n: count() })
    .from(businesses)
    .where(isNotNull(businesses.city))
    .groupBy(businesses.city, businesses.state)
    .orderBy(desc(count()), asc(businesses.city));
  return rows.map((r) => ({ city: r.city ?? "", state: r.state ?? "", count: Number(r.n) }));
}

/** Every category alias across all businesses' categories, most common first. */
export async function listCategories(db: Db): Promise<{ alias: string; count: number }[]> {
  const res = await db.execute<{ alias: string; n: number | string }>(
    sql`SELECT c->>'alias' AS alias, count(*) AS n FROM ${businesses}, jsonb_array_elements(${businesses.categories}) AS c GROUP BY 1 ORDER BY count(*) DESC, 1 ASC`,
  );
  return rowsOf<{ alias: string; n: number | string }>(res).map((r) => ({ alias: r.alias, count: Number(r.n) }));
}

export async function deleteBusiness(db: Db, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const rows = await db.delete(businesses).where(eq(businesses.id, id)).returning({ id: businesses.id });
  return rows.length > 0;
}

/** `db.execute` returns `{ rows }` on PGlite and an array on postgres-js. */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
