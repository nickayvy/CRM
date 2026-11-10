// Google Places API (New) Text Search client. One function per endpoint used,
// behind the PlacesClient interface so tests inject a fake
// (tests/helpers/fake-places.ts). The API key travels only in the
// X-Goog-Api-Key header and never appears in a URL, a log line or an error.
//
// No retries here: every request must be reserved against the monthly cap
// before it is sent, so the single retry for 5xx/network errors lives in the
// runner (src/features/google/run.ts), which reserves each attempt.
import type { GooglePlace, PlacesClient, TextSearchRequest } from "./types";

export type { GooglePlace, PlacesClient, TextSearchRequest } from "./types";

export const PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
/** Results per page; Google's maximum for Text Search. */
export const PLACES_PAGE_SIZE = 20;
/** Text Search returns at most 3 pages (60 places) per query. */
export const PLACES_MAX_PAGES = 3;

export const GOOGLE_NOT_CONFIGURED = "Google Maps search is not configured: set GOOGLE_PLACES_API_KEY";

/** Every GooglePlace field. No Atmosphere field (reviews, editorialSummary, …): see the spec's SKU decision. */
export const PLACE_FIELDS = [
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
] as const satisfies readonly (keyof GooglePlace)[];

export const TEXT_SEARCH_FIELD_MASK: string = [...PLACE_FIELDS.map((f) => `places.${f}`), "nextPageToken"].join(",");

export class GooglePlacesError extends Error {
  readonly httpStatus: number;
  /** google.rpc status, e.g. "PERMISSION_DENIED"; "NETWORK" for transport failures, "UNKNOWN" when absent. */
  readonly status: string;
  /** True when retrying cannot help: bad or restricted key, API not enabled, billing off, invalid request. */
  readonly fatal: boolean;
  /** google.rpc.ErrorInfo reason when present, e.g. "API_KEY_INVALID". */
  readonly reason: string | null;

  constructor(message: string, opts: { httpStatus: number; status: string; fatal: boolean; reason?: string | null }) {
    super(message);
    this.name = "GooglePlacesError";
    this.httpStatus = opts.httpStatus;
    this.status = opts.status;
    this.fatal = opts.fatal;
    this.reason = opts.reason ?? null;
  }
}

/** HTTP 429 / RESOURCE_EXHAUSTED. Never fatal: the same search is retried later. */
export class GoogleRateLimited extends GooglePlacesError {
  constructor(message: string, opts: { httpStatus: number; status: string; reason?: string | null }) {
    super(message, { ...opts, fatal: false });
    this.name = "GoogleRateLimited";
  }
}

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; reason?: string }[];
  };
};

/** Removes anything that looks like the key from text Google echoes back. */
function redact(text: string, apiKey: string): string {
  let out = text;
  if (apiKey) out = out.split(apiKey).join("[redacted]");
  // Google API keys: "AIza" + 35 characters.
  return out.replace(/AIza[0-9A-Za-z_-]{35}/g, "[redacted]");
}

/** Maps a non-2xx response to a typed error. */
export function toPlacesError(httpStatus: number, bodyText: string, apiKey = ""): GooglePlacesError {
  let body: GoogleErrorBody = {};
  try {
    body = JSON.parse(bodyText) as GoogleErrorBody;
  } catch {
    // Non-JSON error page.
  }
  const status = body.error?.status ?? (httpStatus === 429 ? "RESOURCE_EXHAUSTED" : "UNKNOWN");
  const reason = body.error?.details?.find((d) => typeof d.reason === "string")?.reason ?? null;
  const detail = redact((body.error?.message ?? bodyText.slice(0, 200)).trim(), apiKey);
  const message = `Google Places ${httpStatus} ${status}${detail ? `: ${detail}` : ""}`;
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") return new GoogleRateLimited(message, { httpStatus, status, reason });
  // 400 (invalid request, and also an invalid key: API_KEY_INVALID), 401, 403 (key, API, billing), 404: retrying cannot help.
  const fatal = httpStatus >= 400 && httpStatus < 500;
  return new GooglePlacesError(message, { httpStatus, status, fatal, reason });
}

function requestBody(req: TextSearchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { textQuery: req.textQuery, pageSize: PLACES_PAGE_SIZE };
  if (req.pageToken) body.pageToken = req.pageToken;
  if (req.locationBias) {
    body.locationBias = {
      circle: {
        center: { latitude: req.locationBias.latitude, longitude: req.locationBias.longitude },
        radius: req.locationBias.radiusM,
      },
    };
  }
  if (req.regionCode) body.regionCode = req.regionCode;
  return body;
}

/** `POST https://places.googleapis.com/v1/places:searchText`, headers
 *  `X-Goog-Api-Key` and `X-Goog-FieldMask: TEXT_SEARCH_FIELD_MASK`. */
export function createPlacesClient(apiKey: string, opts: { fetch?: typeof fetch } = {}): PlacesClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let calls = 0;
  return {
    get callCount() {
      return calls;
    },
    async searchText(req) {
      calls++;
      let res: Response;
      try {
        res = await doFetch(PLACES_TEXT_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": TEXT_SEARCH_FIELD_MASK,
          },
          body: JSON.stringify(requestBody(req)),
        });
      } catch (err) {
        const msg = redact(err instanceof Error ? err.message : String(err), apiKey);
        throw new GooglePlacesError(`Google Places request failed: ${msg}`, { httpStatus: 0, status: "NETWORK", fatal: false });
      }
      const text = await res.text().catch(() => "");
      if (!res.ok) throw toPlacesError(res.status, text, apiKey);
      let json: { places?: GooglePlace[]; nextPageToken?: string };
      try {
        json = text ? (JSON.parse(text) as typeof json) : {};
      } catch {
        throw new GooglePlacesError("Google Places returned a response that is not JSON", {
          httpStatus: res.status,
          status: "UNKNOWN",
          fatal: false,
        });
      }
      const places = Array.isArray(json.places) ? json.places.filter((p) => p && typeof p.id === "string") : [];
      return { places, nextPageToken: json.nextPageToken || null };
    },
  };
}
