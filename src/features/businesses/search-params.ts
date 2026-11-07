// URL search-param <-> BusinessFilter/sort/paging mapping for /businesses.
// Pure: used by the server page (parse) and the client table/filters (build).
import type { BusinessStatus, Qualification } from "@/db/schema";
import type { BusinessFilter, BusinessSort } from "@/db/repo/businesses";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const DEFAULT_SORT: BusinessSort = { field: "score", dir: "desc" };

const QUALIFICATIONS: readonly Qualification[] = ["qualified", "review", "rejected"];
const STATUSES: readonly BusinessStatus[] = [
  "new",
  "contacted",
  "interested",
  "callback",
  "not_interested",
  "do_not_call",
  "converted",
];
export const SORT_FIELDS: readonly BusinessSort["field"][] = [
  "name",
  "score",
  "rating",
  "reviewCount",
  "city",
  "status",
  "createdAt",
  "lastContactedAt",
];

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

/** Accepts `a,b` and repeated params (`?x=a&x=b`). */
function list(v: string | string[] | undefined): string[] {
  const parts = (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => s.split(","));
  return [...new Set(parts.map((s) => s.trim()).filter(Boolean))];
}

function int(v: string | string[] | undefined, min: number, max: number): number | undefined {
  const s = first(v);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: string | string[] | undefined): boolean | undefined {
  const s = first(v)?.toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "no") return false;
  return undefined;
}

export type BusinessesQuery = {
  filter: BusinessFilter;
  sort: BusinessSort;
  page: number;
  pageSize: number;
};

export function parseBusinessesQuery(sp: RawSearchParams): BusinessesQuery {
  const filter: BusinessFilter = {};
  const q = first(sp.q);
  if (q) filter.q = q;
  const qual = list(sp.qualification).filter((x): x is Qualification => QUALIFICATIONS.includes(x as Qualification));
  if (qual.length) filter.qualification = qual;
  const status = list(sp.status).filter((x): x is BusinessStatus => STATUSES.includes(x as BusinessStatus));
  if (status.length) filter.status = status;
  const city = first(sp.city);
  if (city) filter.city = city;
  const state = first(sp.state);
  if (state) filter.state = state;
  const category = first(sp.category);
  if (category) filter.category = category;
  const minScore = int(sp.minScore, 0, 100);
  if (minScore !== undefined) filter.minScore = minScore;
  const maxScore = int(sp.maxScore, 0, 100);
  if (maxScore !== undefined) filter.maxScore = maxScore;
  const hasPhone = bool(sp.hasPhone);
  if (hasPhone !== undefined) filter.hasPhone = hasPhone;
  const hasEmail = bool(sp.hasEmail);
  if (hasEmail !== undefined) filter.hasEmail = hasEmail;
  const sourceJobId = first(sp.sourceJobId);
  if (sourceJobId) filter.sourceJobId = sourceJobId;
  const tag = first(sp.tag);
  if (tag) filter.tag = tag;

  const sortField = first(sp.sort);
  const dir = first(sp.dir) === "asc" ? "asc" : first(sp.dir) === "desc" ? "desc" : undefined;
  const sort: BusinessSort =
    sortField && SORT_FIELDS.includes(sortField as BusinessSort["field"])
      ? { field: sortField as BusinessSort["field"], dir: dir ?? "desc" }
      : DEFAULT_SORT;

  const sizeRaw = int(sp.pageSize, 1, 100);
  const pageSize = PAGE_SIZES.includes(sizeRaw as (typeof PAGE_SIZES)[number]) ? (sizeRaw as number) : DEFAULT_PAGE_SIZE;
  const page = int(sp.page, 1, 100000) ?? 1;
  return { filter, sort, page, pageSize };
}

/**
 * Returns a new query string with `patch` applied to `current`. `null`/`""`/`[]`
 * removes a key. Any change except to `page` resets `page` to 1.
 */
export function patchSearchParams(
  current: URLSearchParams | string,
  patch: Record<string, string | number | boolean | string[] | null | undefined>,
): string {
  const next = new URLSearchParams(typeof current === "string" ? current : current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) next.delete(key);
    else if (Array.isArray(value)) next.set(key, value.join(","));
    else if (typeof value === "boolean") next.set(key, value ? "1" : "0");
    else next.set(key, String(value));
  }
  if (!("page" in patch)) next.delete("page");
  const s = next.toString();
  return s ? `?${s}` : "";
}
