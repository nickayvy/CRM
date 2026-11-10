// Shared Google Places types (docs/team/google/architecture.md §Interfaces).
// Type-only module: safe to import from the schema, client code and tests.

/** A place as returned by Text Search (New) with TEXT_SEARCH_FIELD_MASK. */
export type GooglePlace = {
  id: string;
  displayName?: { text: string; languageCode?: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[]; languageCode?: string }[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | string;
  primaryType?: string;
  primaryTypeDisplayName?: { text: string; languageCode?: string };
  types?: string[];
  pureServiceAreaBusiness?: boolean;
};

export type TextSearchRequest = {
  textQuery: string;
  pageToken?: string;
  /** Circle around the zip centre. */
  locationBias?: { latitude: number; longitude: number; radiusM: number };
  regionCode?: string; // "US"
};

export interface PlacesClient {
  searchText(req: TextSearchRequest): Promise<{ places: GooglePlace[]; nextPageToken: string | null }>;
  /** Requests sent by this client instance. */
  readonly callCount: number;
}

/** Stored in `search_jobs.plan` for Google jobs. */
export type GooglePlan = {
  nicheId: string | null;
  terms: string[]; // 1..12, trimmed, lower case, unique
  zips: string[]; // 1..200 five-digit strings, unique, sorted
  areaLabel: string;
  acceptTypes: string[]; // Google place types; [] = no category rule
  maxPagesPerQuery: 1 | 2 | 3;
  saturated: { term: string; zip: string }[]; // filled every page
  errors: { term: string; zip: string; message: string }[]; // skipped searches, last 50
};
