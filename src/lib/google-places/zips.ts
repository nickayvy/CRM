// Offline US zip-code resolution for Google searches (spec R3).
//
// SERVER ONLY: this module loads the bundled zip dataset (the `zipcodes`
// package, ~5 MB of data). Never import it — or plan.ts, which imports it —
// from a client component; client code imports niches.ts / categories.ts
// directly instead.
import { codes } from "zipcodes/lib/codes.js";

export type ResolvedArea = { zips: string[]; label: string; states: string[] };
export type Geocode = (text: string) => Promise<{ latitude: number; longitude: number } | null>;

/** User-facing message when an area cannot be resolved. */
export class AreaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AreaError";
  }
}

/** Largest radius accepted by "<zip> +<n>mi". */
export const MAX_RADIUS_MILES = 100;
/** Radius around a geocoded point. */
export const GEOCODE_RADIUS_MILES = 5;

type ZipInfo = { zip: string; latitude: number; longitude: number; city: string; state: string };

let byZip: Map<string, ZipInfo> | null = null;
let byCity: Map<string, ZipInfo[]> | null = null;

const cityKey = (city: string, state: string) => `${city.trim().toLowerCase().replace(/\s+/g, " ")}|${state.toUpperCase()}`;

function load(): { byZip: Map<string, ZipInfo>; byCity: Map<string, ZipInfo[]> } {
  if (!byZip || !byCity) {
    byZip = new Map();
    byCity = new Map();
    for (const c of Object.values(codes)) {
      if (c.country !== "US" || !/^\d{5}$/.test(c.zip)) continue;
      if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;
      const info: ZipInfo = { zip: c.zip, latitude: c.latitude, longitude: c.longitude, city: c.city, state: c.state };
      byZip.set(c.zip, info);
      const k = cityKey(c.city, c.state);
      const list = byCity.get(k);
      if (list) list.push(info);
      else byCity.set(k, [info]);
    }
  }
  return { byZip, byCity };
}

/** Centre, city and state of a zip; null when the dataset does not have it. */
export function zipInfo(zip: string): ZipInfo | null {
  return load().byZip.get(zip.trim().slice(0, 5)) ?? null;
}

export function zipCentre(zip: string): { latitude: number; longitude: number } | null {
  const z = zipInfo(zip);
  return z ? { latitude: z.latitude, longitude: z.longitude } : null;
}

const EARTH_MILES = 3958.8;
function milesBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Every zip whose centre is within `miles` of the point. */
export function zipsNear(point: { latitude: number; longitude: number }, miles: number): string[] {
  const out: string[] = [];
  for (const z of load().byZip.values()) if (milesBetween(point, z) <= miles) out.push(z.zip);
  return out;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME",
  maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
  "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

function build(zips: string[], baseLabel: string): ResolvedArea {
  const unique = [...new Set(zips)].sort();
  const states = [...new Set(unique.map((z) => zipInfo(z)?.state).filter((s): s is string => !!s))].sort();
  const endsWithState = /,\s*[A-Za-z]{2}\s*$/.test(baseLabel);
  const label = states.length === 1 && !endsWithState ? `${baseLabel}, ${states[0]}` : baseLabel;
  return { zips: unique, label, states };
}

/** "Dallas, TX" / "dallas tx" / "Dallas, Texas" → the dataset's zips for that city. */
function resolveCity(text: string): ResolvedArea | null {
  const m = /^(.+?)[\s,]+([A-Za-z]{2}|[A-Za-z][A-Za-z ]+)$/.exec(text);
  if (!m) return null;
  const tries: [string, string][] = [];
  const tail = m[2].trim();
  if (/^[A-Za-z]{2}$/.test(tail)) tries.push([m[1], tail.toUpperCase()]);
  // Two-word state names ("New York"): try every split point.
  const words = text.replace(/,/g, " ").trim().split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const code = STATE_NAMES[words.slice(i).join(" ").toLowerCase()];
    if (code) tries.push([words.slice(0, i).join(" "), code]);
  }
  for (const [city, state] of tries) {
    const hits = load().byCity.get(cityKey(city.replace(/,$/, ""), state));
    if (hits?.length) return build(hits.map((h) => h.zip), `${hits[0].city}, ${state}`);
  }
  return null;
}

/** Offline for zip lists, "City, ST" and "<zip> +<n>mi". Other text is
 *  geocoded when `opts.geocode` is given. Throws AreaError with a user-facing
 *  message when nothing resolves. */
export async function resolveArea(input: string, opts: { geocode?: Geocode } = {}): Promise<ResolvedArea> {
  const text = (input ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw new AreaError("Enter an area: zip codes, a city such as \"Dallas, TX\", or a zip plus a radius (\"75201 +10mi\").");

  // "<zip> +<n>mi"
  const radius = /^(\d{5})\s*\+\s*(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)?$/i.exec(text);
  if (radius) {
    const centre = zipInfo(radius[1]);
    if (!centre) throw new AreaError(`Unknown zip code: ${radius[1]}`);
    const miles = Number(radius[2]);
    if (!(miles > 0) || miles > MAX_RADIUS_MILES) throw new AreaError(`The radius must be between 1 and ${MAX_RADIUS_MILES} miles.`);
    const zips = zipsNear(centre, miles);
    return build([radius[1], ...zips], `${radius[1]} +${radius[2]}mi`);
  }

  // A list of zips (ZIP+4 accepted), separated by commas, spaces or semicolons.
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length > 0 && tokens.every((t) => /^\d{5}(?:-\d{4})?$/.test(t))) {
    const zips = tokens.map((t) => t.slice(0, 5));
    const unknown = [...new Set(zips.filter((z) => !zipInfo(z)))];
    if (unknown.length) throw new AreaError(`Unknown zip code${unknown.length > 1 ? "s" : ""}: ${unknown.slice(0, 10).join(", ")}`);
    const unique = [...new Set(zips)];
    return build(unique, unique.length === 1 ? unique[0] : `${unique.length} zips`);
  }
  if (tokens.some((t) => /^\d{3,}/.test(t)) && tokens.every((t) => /^[\d-]+$/.test(t))) {
    throw new AreaError("Zip codes must have five digits.");
  }

  const city = resolveCity(text);
  if (city) return city;

  if (opts.geocode) {
    const point = await opts.geocode(text);
    if (point) {
      const zips = zipsNear(point, GEOCODE_RADIUS_MILES);
      if (zips.length === 0) {
        // The nearest zip, so a point between zip centres still resolves.
        let best: ZipInfo | null = null;
        let bestD = Infinity;
        for (const z of load().byZip.values()) {
          const d = milesBetween(point, z);
          if (d < bestD) [best, bestD] = [z, d];
        }
        if (best && bestD <= 50) zips.push(best.zip);
      }
      if (zips.length) return build(zips, text);
    }
    throw new AreaError(`Could not find "${text}". Try zip codes or "City, ST".`);
  }
  throw new AreaError(`Could not find "${text}" offline. Use zip codes, "City, ST" or "<zip> +<miles>mi".`);
}
