import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { YelpBusiness, YelpBusinessDetails, YelpClient, YelpSearchParams, YelpSearchResponse } from "./types";
import { YELP_PAGE_LIMIT, YelpApiError } from "./types";

export const DEFAULT_FIXTURE_DIR = path.join(process.cwd(), "fixtures", "yelp");

type FixtureFile = { _traps?: unknown; businesses: YelpBusiness[]; total: number };

function slugPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Candidate fixture slugs for a search, most specific first.
 * Architecture rule: `${first category alias}-${location slug}`; e.g. "plumbing" + "Houston, TX" → "plumbing-houston-tx".
 * The committed fixtures are named by city only ("plumbing-houston"), so the
 * city part (location before the first comma) is tried second.
 */
export function fixtureSlugs(params: Pick<YelpSearchParams, "categories" | "location">): string[] {
  const category = slugPart((params.categories ?? "").split(",")[0] ?? "");
  const full = `${category}-${slugPart(params.location)}`;
  const city = `${category}-${slugPart(params.location.split(",")[0] ?? "")}`;
  return full === city ? [full] : [full, city];
}

export function createFixtureClient(opts: { fixtureDir?: string } = {}): YelpClient {
  const dir = opts.fixtureDir ?? DEFAULT_FIXTURE_DIR;
  let calls = 0;
  const cache = new Map<string, FixtureFile | null>();

  function load(file: string): FixtureFile | null {
    if (cache.has(file)) return cache.get(file)!;
    const p = path.join(dir, file);
    const data = existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as FixtureFile) : null;
    cache.set(file, data);
    return data;
  }

  function findInSearchFixtures(idOrAlias: string): YelpBusiness | null {
    if (!existsSync(dir)) return null;
    for (const file of readdirSync(dir).sort()) {
      if (!file.startsWith("search-") || !file.endsWith(".json")) continue;
      const hit = load(file)?.businesses.find((b) => b.id === idOrAlias || b.alias === idOrAlias);
      if (hit) return hit;
    }
    return null;
  }

  return {
    mode: "fixture",
    get callCount() {
      return calls;
    },
    async search(params: YelpSearchParams): Promise<YelpSearchResponse> {
      calls++;
      const file = fixtureSlugs(params)
        .map((s) => `search-${s}.json`)
        .find((f) => load(f) !== null);
      if (!file) return { businesses: [], total: 0 };
      const data = load(file)!;
      const offset = Math.max(0, params.offset ?? 0);
      const limit = Math.max(0, params.limit ?? YELP_PAGE_LIMIT);
      return { businesses: data.businesses.slice(offset, offset + limit), total: data.total ?? data.businesses.length };
    },
    async details(idOrAlias: string): Promise<YelpBusinessDetails> {
      calls++;
      const detail = load(`business-${idOrAlias}.json`) as unknown as YelpBusinessDetails | null;
      if (detail) return detail;
      const rec = findInSearchFixtures(idOrAlias);
      if (!rec) throw new YelpApiError(`Fixture business not found: ${idOrAlias}`, 404);
      return { ...rec, is_claimed: true, photos: [], hours: [] };
    },
  };
}
