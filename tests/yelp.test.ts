import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createYelpClient,
  normalizeYelpBusiness,
  searchAll,
  YelpApiError,
  YelpBudgetError,
  YelpUnavailable,
  type YelpBusiness,
  type YelpBusinessDetails,
} from "@/lib/yelp";
import { makeYelpBusiness } from "./helpers/builders";
import { createFakeYelp } from "./helpers/fake-yelp";

type Call = { url: string; init?: RequestInit };

function makeBusiness(i: number, overrides: Partial<YelpBusiness> = {}): YelpBusiness {
  return {
    id: `biz-${i}`,
    alias: `biz-${i}-houston`,
    name: `Business ${i}`,
    is_closed: false,
    url: `https://www.yelp.com/biz/biz-${i}`,
    review_count: 10,
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    rating: 4.5,
    coordinates: { latitude: 29.76, longitude: -95.37 },
    transactions: [],
    location: {
      address1: "1 Main St",
      city: "Houston",
      zip_code: "77002",
      country: "US",
      state: "TX",
      display_address: ["1 Main St", "Houston, TX 77002"],
    },
    phone: "+17135550100",
    display_phone: "(713) 555-0100",
    ...overrides,
  };
}

function page(count: number, total: number, startIndex = 0) {
  return { businesses: Array.from({ length: count }, (_, i) => makeBusiness(startIndex + i)), total };
}

/** Fake fetch: records every call and answers via `respond(callIndex, url)`. */
function fakeFetch(respond: (n: number, url: URL) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const n = calls.length;
    calls.push({ url, init });
    const { status = 200, body = {} } = respond(n, new URL(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

/** Large-total server: always serves full pages of 50 businesses. */
function bigServer(total = 5000) {
  return fakeFetch((_n, url) => {
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return { body: page(50, total, offset) };
  });
}

/** Sleep stub that records requested delays and resolves immediately. */
function sleeper() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

const SEARCH = { location: "Houston, TX", categories: "plumbing" };

function offsets(calls: Call[]): number[] {
  return calls.map((c) => Number(new URL(c.url).searchParams.get("offset")));
}

describe("searchAll paging", () => {
  it("requests limit=50 with strictly increasing offsets and stops at maxResults", async () => {
    const { fetch, calls } = bigServer();
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    const results = await collect(searchAll(client, SEARCH, 120));
    expect(results).toHaveLength(120);
    expect(calls).toHaveLength(3);
    expect(client.callCount).toBe(3);
    for (const c of calls) expect(new URL(c.url).searchParams.get("limit")).toBe("50");
    expect(offsets(calls)).toEqual([0, 50, 100]);
  });

  it.each([1000, 5000])("never requests offset > 950 with maxResults %i", async (maxResults) => {
    const { fetch, calls } = bigServer(5000);
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    const results = await collect(searchAll(client, SEARCH, maxResults));
    const offs = offsets(calls);
    expect(results).toHaveLength(1000);
    expect(calls).toHaveLength(20);
    expect(client.callCount).toBe(20);
    expect(offs[0]).toBe(0);
    expect(offs.at(-1)).toBe(950);
    expect(Math.max(...offs)).toBeLessThanOrEqual(950);
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThan(offs[i - 1]!);
    expect(offs).toEqual(Array.from({ length: 20 }, (_, i) => i * 50));
    for (const c of calls) expect(new URL(c.url).searchParams.get("limit")).toBe("50");
  });

  it("stops on a short page", async () => {
    const { fetch, calls } = fakeFetch((_n, url) => {
      const offset = Number(url.searchParams.get("offset"));
      return { body: page(offset === 0 ? 50 : 30, 5000, offset) };
    });
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    const results = await collect(searchAll(client, SEARCH, 500));
    expect(results).toHaveLength(80);
    expect(calls).toHaveLength(2);
    expect(client.callCount).toBe(2);
  });

  it("stops when total is reached", async () => {
    const { fetch, calls } = bigServer(100);
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    const results = await collect(searchAll(client, SEARCH, 500));
    expect(results).toHaveLength(100);
    expect(calls).toHaveLength(2);
    expect(offsets(calls)).toEqual([0, 50]);
    expect(client.callCount).toBe(2);
  });
});

describe("request retry and errors", () => {
  it("retries 429 three times with exponential backoff, then throws YelpApiError", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 429, body: { error: "rate limited" } }));
    const { sleep, delays } = sleeper();
    const client = createYelpClient({ apiKey: "test", fetch, sleep });
    const err = await client.search(SEARCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpApiError);
    expect((err as YelpApiError).status).toBe(429);
    expect(calls).toHaveLength(4);
    expect(delays).toEqual([500, 1000, 2000]);
    expect(client.callCount).toBe(4);
  });

  it("succeeds when 429 clears after two retries", async () => {
    const { fetch, calls } = fakeFetch((n) => (n < 2 ? { status: 429 } : { body: page(2, 2) }));
    const { sleep, delays } = sleeper();
    const client = createYelpClient({ apiKey: "test", fetch, sleep });
    const res = await client.search(SEARCH);
    expect(res.businesses).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
    expect(client.callCount).toBe(3);
  });

  it("does not retry a 400", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 400, body: { error: "bad" } }));
    const { sleep, delays } = sleeper();
    const client = createYelpClient({ apiKey: "test", fetch, sleep });
    const err = await client.search(SEARCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpApiError);
    expect((err as YelpApiError).status).toBe(400);
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(client.callCount).toBe(1);
  });

  it("retries 5xx like 429", async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 503 }));
    const { sleep, delays } = sleeper();
    const client = createYelpClient({ apiKey: "test", fetch, sleep });
    const err = await client.search(SEARCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpApiError);
    expect((err as YelpApiError).status).toBe(503);
    expect(calls).toHaveLength(4);
    expect(delays).toEqual([500, 1000, 2000]);
    expect(client.callCount).toBe(4);
  });

  it("succeeds when a 503 clears", async () => {
    const { fetch, calls } = fakeFetch((n) => (n === 0 ? { status: 503 } : { body: page(1, 1) }));
    const { sleep, delays } = sleeper();
    const client = createYelpClient({ apiKey: "test", fetch, sleep });
    await client.search(SEARCH);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([500]);
    expect(client.callCount).toBe(2);
  });
});

describe("request shape", () => {
  it("sends the bearer token to the search endpoint with query params", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: page(1, 1) }));
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    await client.search({ location: "Houston, TX", categories: "plumbing", radius: 20000 });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.yelp.com/v3/businesses/search");
    expect(url.searchParams.get("location")).toBe("Houston, TX");
    expect(url.searchParams.get("categories")).toBe("plumbing");
    expect(url.searchParams.get("radius")).toBe("20000");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test");
  });

  it("details() hits /v3/businesses/{id}", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: makeBusiness(1) }));
    const client = createYelpClient({ apiKey: "test", fetch, sleep: sleeper().sleep });
    await client.details("abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.yelp.com/v3/businesses/abc");
    expect(new Headers(calls[0]!.init?.headers).get("Authorization")).toBe("Bearer test");
    expect(client.callCount).toBe(1);
  });
});

describe("maxCalls budget", () => {
  it("throws YelpBudgetError on the request after the budget is spent", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: page(1, 1) }));
    const client = createYelpClient({ apiKey: "test", fetch, maxCalls: 2 });
    await client.search(SEARCH);
    await client.search(SEARCH);
    const err = await client.search(SEARCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpBudgetError);
    expect(err).toBeInstanceOf(YelpApiError);
    expect(calls).toHaveLength(2);
    expect(client.callCount).toBe(2);
  });
});

describe("without an API key", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function keyless() {
    vi.stubEnv("YELP_API_KEY", "");
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    // Constructing the client must not throw, and must not touch the network.
    const client = createYelpClient({ fetch: fetch as unknown as typeof globalThis.fetch });
    return { client, fetch };
  }

  it("search rejects with YelpUnavailable and never calls fetch", async () => {
    const { client, fetch } = keyless();
    const err = await client.search(SEARCH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpUnavailable);
    expect((err as Error).message).toBe("YELP_API_KEY is not set");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("details rejects with YelpUnavailable and never calls fetch", async () => {
    const { client, fetch } = keyless();
    const err = await client.details("any-id").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YelpUnavailable);
    expect((err as Error).message).toBe("YELP_API_KEY is not set");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("constructing the client does not throw", () => {
    expect(() => keyless()).not.toThrow();
  });
});

describe("searchAll with an in-memory client", () => {
  it("pages through a fake client serving 40 built records in one call", async () => {
    const records = Array.from({ length: 40 }, () => makeYelpBusiness());
    const client = createFakeYelp({ results: records });
    const results = await collect(searchAll(client, SEARCH, 200));
    expect(results).toHaveLength(40);
    expect(results.map((r) => r.id)).toEqual(records.map((r) => r.id));
    expect(client.callCount).toBe(1);
  });
});

describe("normalizeYelpBusiness", () => {
  const ctx = { searchCategory: "plumbing", searchLocation: "Houston, TX" };

  it("maps a search record", () => {
    const b = makeBusiness(1, {
      name: "Reliable Plumbing Co.",
      phone: "",
      display_phone: "",
      rating: 4,
      categories: [
        { alias: "plumbing", title: "Plumbing" },
        { alias: "waterheaterinstallrepair", title: "Water Heater Installation/Repair" },
      ],
    });
    const row = normalizeYelpBusiness(b, ctx);
    expect(row.source).toBe("yelp");
    expect(row.yelpId).toBe("biz-1");
    expect(row.phone).toBeNull();
    expect(row.phoneDigits).toBeNull();
    expect(row.rating).toBe("4.0");
    expect(row.primaryCategory).toBe("plumbing");
    expect(row.nameNormalized).toBe("reliable plumbing");
    expect(row.searchCategory).toBe("plumbing");
    expect(row.searchLocation).toBe("Houston, TX");
  });

  it("omits details-only columns for a search record", () => {
    const row = normalizeYelpBusiness(makeBusiness(2), ctx);
    expect("isClaimed" in row).toBe(false);
    expect("photos" in row).toBe(false);
    expect("hours" in row).toBe(false);
  });

  it("includes details-only columns for a details record", () => {
    const d: YelpBusinessDetails = { ...makeBusiness(3), is_claimed: false, photos: ["a", "b"], hours: [{}] };
    const row = normalizeYelpBusiness(d, ctx);
    expect(row.isClaimed).toBe(false);
    expect(row.photos).toEqual(["a", "b"]);
    expect(row.hours).toEqual([{}]);
  });

  it("sets sourceJobId only when a jobId is given", () => {
    expect("sourceJobId" in normalizeYelpBusiness(makeBusiness(4), ctx)).toBe(false);
    expect(normalizeYelpBusiness(makeBusiness(4), { ...ctx, jobId: "job-1" }).sourceJobId).toBe("job-1");
  });
});
