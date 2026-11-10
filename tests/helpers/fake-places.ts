// In-memory PlacesClient. Pages a result list per text query like Text Search
// (20 per page, a nextPageToken while more remain, at most 3 pages), records
// every request, and can be told to fail. The pattern follows fake-yelp.ts.
import { GooglePlacesError, GoogleRateLimited, PLACES_MAX_PAGES, PLACES_PAGE_SIZE } from "@/lib/google-places/client";
import type { GooglePlace, PlacesClient, TextSearchRequest } from "@/lib/google-places/types";
import { nextSeq } from "./builders";

export type FakePlacesOptions = {
  /** Places for a text query: a map by query ("roofer 75201"), or computed from the query. Missing → no results. */
  results?: Record<string, GooglePlace[]> | ((textQuery: string) => GooglePlace[]);
  /**
   * Return an error to throw for this request instead of answering (`n` is the
   * 1-based count of requests for the same text query, so "fail the first two"
   * is `n <= 2`). Use `fakeError` for typed errors.
   */
  fail?: (req: TextSearchRequest, n: number) => Error | null | undefined;
  /** Called before every request is answered (e.g. to advance an injected clock). */
  onRequest?: (req: TextSearchRequest) => void;
};

export type FakePlacesClient = PlacesClient & { readonly requests: TextSearchRequest[] };

export function createFakePlaces(opts: FakePlacesOptions = {}): FakePlacesClient {
  const requests: TextSearchRequest[] = [];
  const perQuery = new Map<string, number>();
  const listFor = (q: string): GooglePlace[] => {
    if (!opts.results) return [];
    return typeof opts.results === "function" ? opts.results(q) : (opts.results[q] ?? []);
  };
  return {
    get callCount() {
      return requests.length;
    },
    requests,
    async searchText(req) {
      requests.push(req);
      const n = (perQuery.get(req.textQuery) ?? 0) + 1;
      perQuery.set(req.textQuery, n);
      opts.onRequest?.(req);
      const err = opts.fail?.(req, n);
      if (err) throw err;
      const page = req.pageToken ? Number(/^page-(\d+)$/.exec(req.pageToken)?.[1] ?? NaN) : 1;
      if (!Number.isInteger(page) || page < 1) {
        throw new GooglePlacesError("Google Places 400 INVALID_ARGUMENT: bad page token", {
          httpStatus: 400,
          status: "INVALID_ARGUMENT",
          fatal: true,
        });
      }
      const list = listFor(req.textQuery);
      const start = (page - 1) * PLACES_PAGE_SIZE;
      const places = list.slice(start, start + PLACES_PAGE_SIZE);
      const more = start + PLACES_PAGE_SIZE < list.length && page < PLACES_MAX_PAGES;
      return { places, nextPageToken: more ? `page-${page + 1}` : null };
    },
  };
}

/** Typed errors as the live client throws them. */
export function fakeError(kind: "500" | "429" | "403" | "network"): GooglePlacesError {
  if (kind === "429")
    return new GoogleRateLimited("Google Places 429 RESOURCE_EXHAUSTED: quota", { httpStatus: 429, status: "RESOURCE_EXHAUSTED" });
  if (kind === "403")
    return new GooglePlacesError("Google Places 403 PERMISSION_DENIED: API not enabled", {
      httpStatus: 403,
      status: "PERMISSION_DENIED",
      fatal: true,
    });
  if (kind === "network")
    return new GooglePlacesError("Google Places request failed: socket hang up", { httpStatus: 0, status: "NETWORK", fatal: false });
  return new GooglePlacesError("Google Places 500 INTERNAL: backend error", { httpStatus: 500, status: "INTERNAL", fatal: false });
}

/** A Google place: operational roofer in Dallas, TX 75201, rated 4.6 with 40 reviews, unique id, phone and website. */
export function makeGooglePlace(overrides: Partial<GooglePlace> = {}): GooglePlace {
  const n = nextSeq();
  const digits = String(n).padStart(4, "0").slice(-4);
  return {
    id: `ChIJfake${n}`,
    displayName: { text: `Fake Roofing ${n}`, languageCode: "en" },
    formattedAddress: `${n} Elm St, Dallas, TX 75201, USA`,
    addressComponents: [
      { longText: String(n), shortText: String(n), types: ["street_number"] },
      { longText: "Elm Street", shortText: "Elm St", types: ["route"] },
      { longText: "Dallas", shortText: "Dallas", types: ["locality", "political"] },
      { longText: "Dallas County", shortText: "Dallas County", types: ["administrative_area_level_2", "political"] },
      { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1", "political"] },
      { longText: "United States", shortText: "US", types: ["country", "political"] },
      { longText: "75201", shortText: "75201", types: ["postal_code"] },
    ],
    location: { latitude: 32.787, longitude: -96.799 },
    nationalPhoneNumber: `(214) 555-${digits}`,
    internationalPhoneNumber: `+1 214-555-${digits}`,
    websiteUri: `https://www.fakeroofing${n}.com/?utm_source=gmb`,
    googleMapsUri: `https://maps.google.com/?cid=${1000 + n}`,
    rating: 4.6,
    userRatingCount: 40,
    businessStatus: "OPERATIONAL",
    primaryType: "roofing_contractor",
    primaryTypeDisplayName: { text: "Roofing Contractor", languageCode: "en-US" },
    types: ["roofing_contractor", "general_contractor", "point_of_interest", "establishment"],
    pureServiceAreaBusiness: false,
    ...overrides,
  };
}
