// Geocoding API fallback for areas the offline zip data cannot resolve
// (spec R3). This is the one Google endpoint that takes the key as a query
// parameter: the URL is never logged and never put in an error message.
import { AreaError, type Geocode } from "./zips";

export const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
export const GEOCODING_PROVIDER = "google_geocoding";

type GeocodeResponse = {
  status?: string;
  results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
};

/**
 * A `Geocode` for `resolveArea`. `reserve` is called before every request
 * (wire it to `reserveUsage(db, "google_geocoding", cap)`); when it returns
 * false no request is sent and the area is refused with a cap message.
 */
export function createGeocoder(
  apiKey: string,
  opts: { fetch?: typeof fetch; reserve?: () => Promise<boolean> } = {},
): Geocode & { readonly callCount: number } {
  const doFetch = opts.fetch ?? globalThis.fetch;
  let calls = 0;
  const geocode = async (text: string) => {
    if (opts.reserve && !(await opts.reserve()))
      throw new AreaError("The monthly geocoding cap is reached; use zip codes or \"City, ST\".");
    calls++;
    const q = new URLSearchParams({ address: text, components: "country:US", key: apiKey });
    let res: Response;
    try {
      res = await doFetch(`${GEOCODE_URL}?${q.toString()}`, { headers: { Accept: "application/json" } });
    } catch {
      throw new AreaError("Geocoding is unavailable right now; use zip codes or \"City, ST\".");
    }
    const body = (await res.json().catch(() => ({}))) as GeocodeResponse;
    if (body.status === "ZERO_RESULTS") return null;
    if (!res.ok || body.status !== "OK")
      throw new AreaError(`Geocoding failed (${body.status ?? `HTTP ${res.status}`}); use zip codes or "City, ST".`);
    const loc = body.results?.[0]?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    return { latitude: loc.lat, longitude: loc.lng };
  };
  Object.defineProperty(geocode, "callCount", { get: () => calls });
  return geocode as Geocode & { readonly callCount: number };
}
