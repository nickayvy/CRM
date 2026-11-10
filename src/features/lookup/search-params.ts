// URL <-> filter mapping for /lookup. Pure; used by the server page (parse)
// and the client islands (build). Params: search, category (comma-separated
// aliases, any of them matches), source,
// minReviews, minL30d, minRating, hasPhone, offset.
import type { BusinessFilter } from "@/db/repo/businesses";
import type { BusinessSource } from "@/db/schema";

export const PAGE_SIZE = 50;
export const FILTER_KEYS = ["search", "category", "source", "minReviews", "minL30d", "minRating", "hasPhone"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type LookupQuery = { filter: BusinessFilter; offset: number };

const SOURCES: readonly BusinessSource[] = ["yelp", "trustpilot", "google"];

function first(v: string | string[] | null | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : undefined;
}

function positiveInt(v: string | undefined, max: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(max, Math.round(n));
}

/** `category` param value → distinct aliases, in order ("a,b" → ["a", "b"]). */
export function parseCategories(value: string | null | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
}

/** Adds `alias` to the selection, or removes it when already there. */
export function toggleCategory(selected: readonly string[], alias: string): string[] {
  return selected.includes(alias) ? selected.filter((a) => a !== alias) : [...selected, alias];
}

/** Aliases → `category` param value; empty clears the param. */
export function categoryParam(selected: readonly string[]): string {
  return selected.join(",");
}

/** Parses Next's `searchParams` (or a URLSearchParams) into a repo filter and a page offset. */
export function parseLookupQuery(sp: RawSearchParams | URLSearchParams): LookupQuery {
  const get = (k: string) => first(sp instanceof URLSearchParams ? sp.get(k) : sp[k]);
  const filter: BusinessFilter = {};
  const q = get("search");
  if (q) filter.q = q;
  const categories = parseCategories(get("category"));
  if (categories.length) filter.categories = categories;
  const source = get("source");
  if (source && (SOURCES as readonly string[]).includes(source)) filter.source = source as BusinessSource;
  const minReviews = positiveInt(get("minReviews"), 1_000_000);
  if (minReviews !== undefined) filter.minReviews = minReviews;
  const minL30d = positiveInt(get("minL30d"), 100_000);
  if (minL30d !== undefined) filter.minL30d = minL30d;
  const rating = Number(get("minRating"));
  if (Number.isFinite(rating) && rating >= 1 && rating <= 5) filter.minRating = rating;
  if (get("hasPhone") === "true") filter.hasPhone = true;
  const offsetRaw = Number(get("offset") ?? 0);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw / PAGE_SIZE) * PAGE_SIZE : 0;
  return { filter, offset };
}

/**
 * Applies `patch` to the current query string and returns the new one
 * (without "?"). Empty, "0" and "false" values remove the key. Any patch
 * without an `offset` key resets paging; pass `offset` itself to page.
 */
export function patchLookupParams(current: string, patch: Partial<Record<FilterKey | "offset", string | null>>): string {
  const params = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "" || v === "0" || v === "false") params.delete(k);
    else params.set(k, v);
  }
  if (!("offset" in patch)) params.delete("offset");
  return params.toString();
}

export function hrefFor(pathname: string, query: string): string {
  return query ? `${pathname}?${query}` : pathname;
}

export type PageInfo = { start: number; end: number; page: number; pages: number; hasPrev: boolean; hasNext: boolean };

/** Numbers for "start–end of total" and "Page page of pages". */
export function pageInfo(offset: number, total: number, size = PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.floor(offset / size) + 1;
  return {
    start: total === 0 ? 0 : Math.min(offset + 1, total),
    end: Math.min(offset + size, total),
    page,
    pages,
    hasPrev: offset > 0,
    hasNext: offset + size < total,
  };
}
