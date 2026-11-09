// Yelp Fusion v3 types (subset used by the CRM). Shapes per architecture §Interfaces.

export type YelpSearchParams = {
  term?: string;
  location: string;
  categories?: string;
  radius?: number;
  limit?: number;
  offset?: number;
  sort_by?: "best_match" | "rating" | "review_count" | "distance";
};

export type YelpBusiness = {
  id: string;
  alias: string;
  name: string;
  image_url?: string;
  is_closed: boolean;
  url: string;
  review_count: number;
  categories: { alias: string; title: string }[];
  rating: number;
  coordinates: { latitude: number | null; longitude: number | null };
  transactions: string[];
  price?: string;
  location: {
    address1?: string | null;
    address2?: string | null;
    address3?: string | null;
    city: string;
    zip_code: string;
    country: string;
    state: string;
    display_address: string[];
  };
  phone: string;
  display_phone: string;
  distance?: number;
};

export type YelpBusinessDetails = YelpBusiness & { is_claimed?: boolean; photos?: string[]; hours?: unknown[] };

export type YelpSearchResponse = { businesses: YelpBusiness[]; total: number; region?: unknown };

export interface YelpClient {
  search(params: YelpSearchParams): Promise<YelpSearchResponse>;
  details(idOrAlias: string): Promise<YelpBusinessDetails>;
  /** Number of API requests made so far (every HTTP request, including retries). */
  readonly callCount: number;
}

/** Yelp Fusion page size cap and the `offset + limit <= 1000` window. */
export const YELP_PAGE_LIMIT = 50;
export const YELP_MAX_WINDOW = 1000;
export const YELP_MAX_RADIUS = 40000;

export class YelpApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body = "") {
    super(message);
    this.name = "YelpApiError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when a client exceeds its per-instance request budget. */
export class YelpBudgetError extends YelpApiError {
  constructor(maxCalls: number) {
    super(`Yelp request budget of ${maxCalls} calls exhausted`, 0);
    this.name = "YelpBudgetError";
  }
}

/** Thrown on first use when Yelp is not configured (no YELP_API_KEY). */
export class YelpUnavailable extends Error {
  constructor(message = "YELP_API_KEY is not set") {
    super(message);
    this.name = "YelpUnavailable";
  }
}
