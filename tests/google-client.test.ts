// AC-18.3: Places client request shape, field mask and typed errors; env (AC-18.2 support).
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import {
  GOOGLE_NOT_CONFIGURED,
  GooglePlacesError,
  GoogleRateLimited,
  PLACES_TEXT_SEARCH_URL,
  TEXT_SEARCH_FIELD_MASK,
  createPlacesClient,
  toPlacesError,
} from "@/lib/google-places/client";
import { createGeocoder } from "@/lib/google-places/geocode";

const KEY = "AIzaTESTKEY0000000000000000000000000000"; // fake, 39 chars like a real key

function stubFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("createPlacesClient", () => {
  it("POSTs Text Search with the key and field mask headers and the documented body", async () => {
    const fetch = stubFetch(200, { places: [{ id: "a" }, { id: "b" }], nextPageToken: "tok2" });
    const client = createPlacesClient(KEY, { fetch: fetch as unknown as typeof globalThis.fetch });
    const res = await client.searchText({
      textQuery: "roofer 75201",
      pageToken: "tok1",
      locationBias: { latitude: 32.78, longitude: -96.8, radiusM: 8000 },
      regionCode: "US",
    });
    expect(res).toEqual({ places: [{ id: "a" }, { id: "b" }], nextPageToken: "tok2" });
    expect(client.callCount).toBe(1);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(PLACES_TEXT_SEARCH_URL);
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(String(url)).not.toContain(KEY);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(headers["X-Goog-FieldMask"]).toBe(TEXT_SEARCH_FIELD_MASK);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({
      textQuery: "roofer 75201",
      pageSize: 20,
      pageToken: "tok1",
      locationBias: { circle: { center: { latitude: 32.78, longitude: -96.8 }, radius: 8000 } },
      regionCode: "US",
    });
  });

  it("omits pageToken and locationBias when not given; an empty body is no places and no token", async () => {
    const fetch = stubFetch(200, {});
    const client = createPlacesClient(KEY, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await client.searchText({ textQuery: "x" })).toEqual({ places: [], nextPageToken: null });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ textQuery: "x", pageSize: 20 });
  });

  it("field mask lists every GooglePlace field plus nextPageToken and no Atmosphere field", () => {
    const fields = TEXT_SEARCH_FIELD_MASK.split(",");
    expect(fields).toContain("nextPageToken");
    for (const f of [
      "id",
      "displayName",
      "formattedAddress",
      "addressComponents",
      "location",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "googleMapsUri",
      "rating",
      "userRatingCount",
      "businessStatus",
      "primaryType",
      "primaryTypeDisplayName",
      "types",
      "pureServiceAreaBusiness",
    ])
      expect(fields).toContain(`places.${f}`);
    expect(TEXT_SEARCH_FIELD_MASK).not.toMatch(/reviews|editorialSummary|reviewSummary|generativeSummary|photos/);
  });

  it("403 → fatal GooglePlacesError PERMISSION_DENIED; 429 → GoogleRateLimited; key never in the message", async () => {
    const forbidden = stubFetch(403, {
      error: { code: 403, message: `Requests from this API key ${KEY} are blocked.`, status: "PERMISSION_DENIED" },
    });
    const c1 = createPlacesClient(KEY, { fetch: forbidden as unknown as typeof globalThis.fetch });
    const e1 = await c1.searchText({ textQuery: "x" }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(GooglePlacesError);
    expect(e1).not.toBeInstanceOf(GoogleRateLimited);
    expect(e1).toMatchObject({ fatal: true, status: "PERMISSION_DENIED", httpStatus: 403 });
    expect((e1 as Error).message).not.toContain(KEY);
    expect(String(e1)).not.toContain(KEY);

    const limited = stubFetch(429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } });
    const c2 = createPlacesClient(KEY, { fetch: limited as unknown as typeof globalThis.fetch });
    const e2 = await c2.searchText({ textQuery: "x" }).catch((e: unknown) => e);
    expect(e2).toBeInstanceOf(GoogleRateLimited);
    expect(e2).toMatchObject({ fatal: false, status: "RESOURCE_EXHAUSTED", httpStatus: 429 });
  });

  it("an invalid key (400 INVALID_ARGUMENT / API_KEY_INVALID, as Google answers it live) is fatal", () => {
    // Body shape recorded from a live request with an invalid key (2026-11-10).
    const body = JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" },
        ],
      },
    });
    const e = toPlacesError(400, body, KEY);
    expect(e).toMatchObject({ fatal: true, status: "INVALID_ARGUMENT", reason: "API_KEY_INVALID" });
  });

  it("5xx and network failures are not fatal and are not retried by the client", async () => {
    const fivehundred = stubFetch(500, { error: { code: 500, message: "boom", status: "INTERNAL" } });
    const c = createPlacesClient(KEY, { fetch: fivehundred as unknown as typeof globalThis.fetch });
    await expect(c.searchText({ textQuery: "x" })).rejects.toMatchObject({ fatal: false, status: "INTERNAL" });
    expect(fivehundred).toHaveBeenCalledTimes(1);

    const broken = vi.fn(async () => {
      throw new Error(`connect failed for key=${KEY}`);
    });
    const c2 = createPlacesClient(KEY, { fetch: broken as unknown as typeof globalThis.fetch });
    const e = await c2.searchText({ textQuery: "x" }).catch((x: unknown) => x);
    expect(e).toMatchObject({ fatal: false, status: "NETWORK" });
    expect((e as Error).message).not.toContain(KEY);
  });
});

describe("geocoder", () => {
  it("sends the key only as the documented query parameter, counts through reserve, and maps results", async () => {
    const fetch = stubFetch(200, { status: "OK", results: [{ geometry: { location: { lat: 32.7, lng: -96.8 } } }] });
    const reserve = vi.fn(async () => true);
    const geo = createGeocoder(KEY, { fetch: fetch as unknown as typeof globalThis.fetch, reserve });
    expect(await geo("Deep Ellum, Dallas")).toEqual({ latitude: 32.7, longitude: -96.8 });
    expect(reserve).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("Deep Ellum, Dallas");
    expect(geo.callCount).toBe(1);
  });

  it("sends nothing when the geocoding cap is reached; errors never carry the key", async () => {
    const fetch = stubFetch(200, { status: "REQUEST_DENIED", error_message: `bad key ${KEY}` });
    const capped = createGeocoder(KEY, { fetch: fetch as unknown as typeof globalThis.fetch, reserve: async () => false });
    await expect(capped("x")).rejects.toThrow(/cap/);
    expect(fetch).not.toHaveBeenCalled();
    const denied = createGeocoder(KEY, { fetch: fetch as unknown as typeof globalThis.fetch });
    const e = await denied("x").catch((x: unknown) => x);
    expect((e as Error).message).toMatch(/REQUEST_DENIED/);
    expect((e as Error).message).not.toContain(KEY);
  });
});

describe("env", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("reads the Google variables with their defaults and fallback", () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP;
    expect(env.GOOGLE_PLACES_API_KEY).toBeUndefined();
    expect(env.GOOGLE_GEOCODING_API_KEY).toBeUndefined();
    expect(env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP).toBe(1000);

    process.env.GOOGLE_PLACES_API_KEY = "places-key";
    expect(env.GOOGLE_GEOCODING_API_KEY).toBe("places-key");
    process.env.GOOGLE_GEOCODING_API_KEY = "geo-key";
    expect(env.GOOGLE_GEOCODING_API_KEY).toBe("geo-key");

    process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP = "-5";
    expect(env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP).toBe(0);
    process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP = "250";
    expect(env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP).toBe(250);
    process.env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP = "lots";
    expect(env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP).toBe(1000);
  });

  it("has the documented not-configured message", () => {
    expect(GOOGLE_NOT_CONFIGURED).toBe("Google Maps search is not configured: set GOOGLE_PLACES_API_KEY");
  });
});
