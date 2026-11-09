// In-memory YelpClient serving builder output. Pages with limit/offset like
// the real API and counts every call. `details` returns the override for an
// id when given, else the search record as claimed with no photos/hours.
import {
  YELP_PAGE_LIMIT,
  YelpApiError,
  type YelpBusiness,
  type YelpBusinessDetails,
  type YelpClient,
  type YelpSearchParams,
} from "@/lib/yelp";

export type FakeYelpOptions = {
  /** Records for a search: a fixed list, or computed from the params (e.g. by category/location). */
  results: YelpBusiness[] | ((params: YelpSearchParams) => YelpBusiness[]);
  /** Extra records `details` can find before any search has returned them. */
  catalog?: YelpBusiness[];
  /** Detail overrides by Yelp id, merged onto the search record. */
  details?: Record<string, Partial<YelpBusinessDetails>>;
};

export type FakeYelpClient = YelpClient & { readonly searches: YelpSearchParams[] };

export function createFakeYelp(opts: FakeYelpOptions): FakeYelpClient {
  let calls = 0;
  const searches: YelpSearchParams[] = [];
  const seen = new Map<string, YelpBusiness>();
  const resultsFor = (p: YelpSearchParams) => {
    const list = typeof opts.results === "function" ? opts.results(p) : opts.results;
    for (const b of list) seen.set(b.id, b);
    return list;
  };
  for (const b of opts.catalog ?? []) seen.set(b.id, b);
  if (Array.isArray(opts.results)) for (const b of opts.results) seen.set(b.id, b);

  return {
    get callCount() {
      return calls;
    },
    searches,
    async search(params) {
      calls++;
      searches.push(params);
      const list = resultsFor(params);
      const offset = Math.max(0, params.offset ?? 0);
      const limit = Math.max(0, params.limit ?? YELP_PAGE_LIMIT);
      return { businesses: list.slice(offset, offset + limit), total: list.length };
    },
    async details(idOrAlias) {
      calls++;
      const rec = seen.get(idOrAlias) ?? [...seen.values()].find((b) => b.alias === idOrAlias);
      if (!rec) throw new YelpApiError(`Fake Yelp business not found: ${idOrAlias}`, 404);
      const extra = opts.details?.[rec.id];
      return extra ? { ...rec, ...extra } : { ...rec, is_claimed: true, photos: [], hours: [] };
    },
  };
}
