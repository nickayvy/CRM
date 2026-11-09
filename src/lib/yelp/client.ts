import { env } from "@/lib/env";
import {
  YELP_MAX_RADIUS,
  YELP_MAX_WINDOW,
  YELP_PAGE_LIMIT,
  YelpApiError,
  YelpBudgetError,
  YelpUnavailable,
  type YelpBusiness,
  type YelpBusinessDetails,
  type YelpClient,
  type YelpSearchParams,
  type YelpSearchResponse,
} from "./types";

export const YELP_API_BASE = "https://api.yelp.com/v3";
/** Retries after the first attempt for 429 and 5xx responses. */
export const YELP_MAX_RETRIES = 3;
export const YELP_BACKOFF_BASE_MS = 500;
/** Default per-client request budget (a 1000-result job needs 20 pages). */
export const YELP_DEFAULT_MAX_CALLS = 100;

export type CreateYelpClientOptions = {
  /** Defaults to `env.YELP_API_KEY`. */
  apiKey?: string;
  fetch?: typeof fetch;
  /** Injected sleep for backoff (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
  /** Maximum HTTP requests this client may make; exceeding it throws `YelpBudgetError`. */
  maxCalls?: number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function toQuery(params: YelpSearchParams): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, String(v));
  }
  return q.toString();
}

function createLiveClient(opts: CreateYelpClientOptions & { apiKey: string | undefined }): YelpClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxCalls = opts.maxCalls ?? YELP_DEFAULT_MAX_CALLS;
  let calls = 0;

  async function request<T>(pathAndQuery: string): Promise<T> {
    let attempt = 0;
    if (!opts.apiKey) throw new YelpUnavailable("YELP_API_KEY is not set");
    for (;;) {
      if (calls >= maxCalls) throw new YelpBudgetError(maxCalls);
      calls++;
      let res: Response | null = null;
      let networkError: unknown = null;
      try {
        res = await doFetch(`${YELP_API_BASE}${pathAndQuery}`, {
          headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" },
        });
      } catch (err) {
        networkError = err;
      }
      if (res && res.ok) return (await res.json()) as T;

      const retryable = networkError !== null || (res !== null && (res.status === 429 || res.status >= 500));
      if (retryable && attempt < YELP_MAX_RETRIES) {
        await sleep(YELP_BACKOFF_BASE_MS * 2 ** attempt);
        attempt++;
        continue;
      }
      if (networkError !== null) {
        throw new YelpApiError(`Yelp request failed: ${(networkError as Error)?.message ?? String(networkError)}`, 0);
      }
      const body = await res!.text().catch(() => "");
      throw new YelpApiError(`Yelp API ${res!.status} for ${pathAndQuery.split("?")[0]}`, res!.status, body);
    }
  }

  return {
    get callCount() {
      return calls;
    },
    search(params) {
      return request<YelpSearchResponse>(`/businesses/search?${toQuery(params)}`);
    },
    details(idOrAlias) {
      return request<YelpBusinessDetails>(`/businesses/${encodeURIComponent(idOrAlias)}`);
    },
  };
}

/**
 * Yelp Fusion client (live only). The key defaults to `env.YELP_API_KEY`; when
 * it is missing, construction succeeds and the first request throws
 * `YelpUnavailable('YELP_API_KEY is not set')`.
 */
export function createYelpClient(opts: CreateYelpClientOptions = {}): YelpClient {
  return createLiveClient({ ...opts, apiKey: opts.apiKey ?? env.YELP_API_KEY });
}

/**
 * Pages through `/businesses/search` with `limit=50`, increasing `offset`,
 * never past `offset + limit = 1000`. Stops at `maxResults`, on a short page,
 * or when `total` is reached.
 */
export async function* searchAll(
  client: YelpClient,
  params: YelpSearchParams,
  maxResults: number,
): AsyncGenerator<YelpBusiness> {
  const max = Math.min(Math.max(0, Math.floor(maxResults)), YELP_MAX_WINDOW);
  const limit = YELP_PAGE_LIMIT;
  const radius = params.radius === undefined ? undefined : Math.min(params.radius, YELP_MAX_RADIUS);
  let offset = Math.max(0, params.offset ?? 0);
  let yielded = 0;
  while (yielded < max && offset + limit <= YELP_MAX_WINDOW) {
    const page = await client.search({ ...params, radius, limit, offset });
    for (const b of page.businesses) {
      if (yielded >= max) return;
      yield b;
      yielded++;
    }
    if (page.businesses.length < limit) return;
    offset += limit;
    if (offset >= page.total) return;
  }
}
