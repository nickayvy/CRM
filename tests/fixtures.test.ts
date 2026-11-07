import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CHAIN_PATTERNS } from "@/db/repo/chain-patterns";

// ---- types ----------------------------------------------------------------

interface YelpCategory {
  alias: string;
  title: string;
}

interface YelpBusiness {
  id: string;
  alias: string;
  name: string;
  image_url: string;
  is_closed: boolean;
  url: string;
  review_count: number;
  categories: YelpCategory[];
  rating: number;
  coordinates: { latitude: number; longitude: number };
  transactions: string[];
  price?: string;
  location: {
    address1: string;
    address2: string | null;
    address3: string | null;
    city: string;
    zip_code: string;
    country: string;
    state: string;
    display_address: string[];
  };
  phone: string;
  display_phone: string;
  distance: number;
}

interface Trap {
  id: string;
  name: string;
  trap: string;
  expected: "rejected" | "qualified";
  reason: string | null;
}

interface SearchFile {
  _traps: Trap[];
  businesses: YelpBusiness[];
  total: number;
}

interface HoursEntry {
  is_overnight: boolean;
  start: string;
  end: string;
  day: number;
}

interface YelpDetail extends Omit<YelpBusiness, "distance"> {
  is_claimed: boolean;
  photos: string[];
  hours: { open: HoursEntry[]; hours_type: string; is_open_now: boolean }[];
}

// ---- loading --------------------------------------------------------------

const FIXTURE_DIR = path.resolve(fileURLToPath(new URL("../fixtures/yelp", import.meta.url)));

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as T;
}

const SETS = {
  houston: { file: "search-plumbing-houston.json", category: "plumbing", city: "Houston", areaPrefix: "+1713555", size: 40 },
  dallas: { file: "search-hvac-dallas.json", category: "hvac", city: "Dallas", areaPrefix: "+1214555", size: 30 },
  austin: { file: "search-dentists-austin.json", category: "dentists", city: "Austin", areaPrefix: "+1512555", size: 30 },
} as const;
type SetKey = keyof typeof SETS;

const files: Record<SetKey, SearchFile> = {
  houston: readJson<SearchFile>(SETS.houston.file),
  dallas: readJson<SearchFile>(SETS.dallas.file),
  austin: readJson<SearchFile>(SETS.austin.file),
};
const SET_KEYS = Object.keys(SETS) as SetKey[];
const allBusinesses = SET_KEYS.flatMap((k) => files[k].businesses);

// ---- helpers --------------------------------------------------------------

const matchesChainPattern = (name: string): boolean =>
  DEFAULT_CHAIN_PATTERNS.some((p) => name.toLowerCase().includes(p.toLowerCase()));

const VALID_RATINGS = [3.5, 4, 4.5, 5];

/**
 * Which "ordinary qualifying record" rules does this business violate?
 * An ordinary record violates none; each trap is built to violate exactly one
 * (or none, for the stateful / tolerance traps).
 */
function violations(b: YelpBusiness, key: SetKey): string[] {
  const set = SETS[key];
  const out: string[] = [];
  if (b.is_closed) out.push("closed");
  if (b.categories[0]?.alias !== set.category) out.push("category");
  if (!(b.phone.length === 12 && b.phone.startsWith(set.areaPrefix))) out.push("phone");
  if (b.location.state !== "TX") out.push("state");
  if (!VALID_RATINGS.includes(b.rating)) out.push("rating");
  if (!(b.review_count >= 5 && b.review_count <= 450)) out.push("reviews");
  if (!(b.distance <= 19500)) out.push("distance");
  if (matchesChainPattern(b.name)) out.push("chain");
  return out;
}

function named(key: SetKey, name: string): YelpBusiness[] {
  return files[key].businesses.filter((b) => b.name === name);
}

function one(key: SetKey, name: string): YelpBusiness {
  const found = named(key, name);
  expect(found, `exactly one "${name}"`).toHaveLength(1);
  return found[0];
}

function trapFor(key: SetKey, id: string): Trap | undefined {
  return files[key]._traps.find((t) => t.id === id);
}

// ---- plumbing-houston -----------------------------------------------------

describe("search-plumbing-houston.json", () => {
  const f = files.houston;

  it("has 40 businesses and total = 40", () => {
    expect(f.businesses).toHaveLength(40);
    expect(f.total).toBe(40);
  });

  it("lists 13 trap records (12 named rows, Reliable twice) that each match a business", () => {
    expect(f._traps).toHaveLength(13);
    for (const t of f._traps) {
      const b = f.businesses.find((x) => x.id === t.id);
      expect(b, t.name).toBeDefined();
      expect(b!.name).toBe(t.name);
    }
  });

  it("expects qualified 31 / rejected 9 with the right reason counts", () => {
    const trapIds = new Set(f._traps.map((t) => t.id));
    const ordinaryCount = f.businesses.filter((b) => !trapIds.has(b.id)).length;
    expect(ordinaryCount).toBe(27);

    const qualified = ordinaryCount + f._traps.filter((t) => t.expected === "qualified").length;
    const rejected = f._traps.filter((t) => t.expected === "rejected");
    expect(qualified).toBe(31);
    expect(rejected).toHaveLength(9);

    const reasons: Record<string, number> = {};
    for (const t of rejected) reasons[t.reason ?? "null"] = (reasons[t.reason ?? "null"] ?? 0) + 1;
    expect(reasons).toEqual({
      chain: 2,
      category_mismatch: 1,
      closed: 1,
      out_of_area: 1,
      no_phone: 1,
      low_rating: 1,
      too_few_reviews: 1,
      duplicate_phone: 1,
    });
    // qualified traps never carry a reason
    for (const t of f._traps.filter((x) => x.expected === "qualified")) expect(t.reason).toBeNull();
  });

  it("Roto-Rooter and Mr. Rooter are chain traps, otherwise ordinary", () => {
    for (const name of ["Roto-Rooter Plumbing & Water Cleanup", "Mr. Rooter Plumbing of Houston"]) {
      const b = one("houston", name);
      expect(violations(b, "houston")).toEqual(["chain"]);
      expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "chain" });
    }
  });

  it("Bayou City Lawn & Landscape has only the landscaping category", () => {
    const b = one("houston", "Bayou City Lawn & Landscape");
    expect(b.categories).toEqual([{ alias: "landscaping", title: "Landscaping" }]);
    expect(violations(b, "houston")).toEqual(["category"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "category_mismatch" });
  });

  it("Gulf Coast Plumbing is closed", () => {
    const b = one("houston", "Gulf Coast Plumbing");
    expect(b.is_closed).toBe(true);
    expect(violations(b, "houston")).toEqual(["closed"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "closed" });
  });

  it("Katy Drain Pros is in Katy, TX at exactly 31000 m", () => {
    const b = one("houston", "Katy Drain Pros");
    expect(b.location.city).toBe("Katy");
    expect(b.location.state).toBe("TX");
    expect(b.distance).toBe(31000);
    expect(violations(b, "houston")).toEqual(["distance"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "out_of_area" });
  });

  it("Handy Hank Plumbing has no phone", () => {
    const b = one("houston", "Handy Hank Plumbing");
    expect(b.phone).toBe("");
    expect(b.display_phone).toBe("");
    expect(violations(b, "houston")).toEqual(["phone"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "no_phone" });
  });

  it("Quick Fix Plumbing has rating 2.5 and 40 reviews", () => {
    const b = one("houston", "Quick Fix Plumbing");
    expect(b.rating).toBe(2.5);
    expect(b.review_count).toBe(40);
    expect(violations(b, "houston")).toEqual(["rating"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "low_rating" });
  });

  it("New Guy Plumbing LLC has rating 5.0 and 2 reviews", () => {
    const b = one("houston", "New Guy Plumbing LLC");
    expect(b.rating).toBe(5);
    expect(b.review_count).toBe(2);
    expect(violations(b, "houston")).toEqual(["reviews"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "rejected", reason: "too_few_reviews" });
  });

  it("has two Reliable Plumbing Co records sharing a phone, qualified one first", () => {
    const idxs = f.businesses.map((b, i) => (b.name === "Reliable Plumbing Co" ? i : -1)).filter((i) => i >= 0);
    expect(idxs).toHaveLength(2);
    const [first, second] = idxs.map((i) => f.businesses[i]);
    expect(first.id).not.toBe(second.id);
    expect(first.phone).not.toBe("");
    expect(first.phone).toBe(second.phone);
    expect(trapFor("houston", first.id)).toMatchObject({ expected: "qualified", reason: null });
    expect(trapFor("houston", second.id)).toMatchObject({ expected: "rejected", reason: "duplicate_phone" });
    expect(violations(first, "houston")).toEqual([]);
    expect(violations(second, "houston")).toEqual([]);
  });

  it("Sugar Land Pipe Masters is in Sugar Land, TX at exactly 21500 m", () => {
    const b = one("houston", "Sugar Land Pipe Masters");
    expect(b.location.city).toBe("Sugar Land");
    expect(b.location.state).toBe("TX");
    expect(b.distance).toBe(21500);
    expect(violations(b, "houston")).toEqual(["distance"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "qualified", reason: null });
  });

  it("Dusty Wrench Plumbing is the borderline record (plumbing secondary only)", () => {
    const b = one("houston", "Dusty Wrench Plumbing");
    expect(b.rating).toBe(3.5);
    expect(b.review_count).toBe(5);
    expect(b.phone).not.toBe("");
    expect(b.distance).toBe(19000);
    expect(b.categories).toEqual([
      { alias: "handyman", title: "Handyman" },
      { alias: "plumbing", title: "Plumbing" },
    ]);
    expect(violations(b, "houston")).toEqual(["category"]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "qualified", reason: null });
  });

  it("ABC Plumbing is an ordinary Houston record", () => {
    const b = one("houston", "ABC Plumbing");
    expect(b.location.city).toBe("Houston");
    expect(violations(b, "houston")).toEqual([]);
    expect(trapFor("houston", b.id)).toMatchObject({ expected: "qualified", reason: null });
  });
});

// ---- hvac-dallas ----------------------------------------------------------

describe("search-hvac-dallas.json", () => {
  const f = files.dallas;

  it("has 30 businesses, total = 30, and exactly 4 traps matching businesses", () => {
    expect(f.businesses).toHaveLength(30);
    expect(f.total).toBe(30);
    expect(f._traps).toHaveLength(4);
    for (const t of f._traps) {
      const b = f.businesses.find((x) => x.id === t.id);
      expect(b, t.name).toBeDefined();
      expect(b!.name).toBe(t.name);
    }
  });

  it("expects 26 qualified / 4 rejected with the right reasons", () => {
    expect(f._traps.every((t) => t.expected === "rejected")).toBe(true);
    expect(f._traps.map((t) => t.reason).sort()).toEqual(["category_mismatch", "chain", "closed", "low_rating"]);
  });

  it("each trap trips exactly its own rule", () => {
    const expectedViolation: Record<string, string> = {
      category_mismatch: "category",
      chain: "chain",
      closed: "closed",
      low_rating: "rating",
    };
    for (const t of f._traps) {
      const b = f.businesses.find((x) => x.id === t.id)!;
      expect(violations(b, "dallas"), t.name).toEqual([expectedViolation[t.reason!]]);
    }
  });

  it("trap details", () => {
    const abc = one("dallas", "ABC Plumbing");
    expect(abc.categories).toEqual([{ alias: "plumbing", title: "Plumbing" }]);
    expect(abc.location.city).toBe("Dallas");
    expect(abc.phone.startsWith("+1214555")).toBe(true);

    one("dallas", "One Hour Heating & Air Conditioning of Dallas");

    const closed = f.businesses.find((b) => trapFor("dallas", b.id)?.reason === "closed")!;
    expect(closed.is_closed).toBe(true);

    const low = f.businesses.find((b) => trapFor("dallas", b.id)?.reason === "low_rating")!;
    expect(low.rating).toBe(3);
    expect(low.review_count).toBeGreaterThanOrEqual(10);
  });
});

// ---- dentists-austin ------------------------------------------------------

describe("search-dentists-austin.json", () => {
  const f = files.austin;

  it("has 30 businesses, total = 30, and exactly 4 traps matching businesses", () => {
    expect(f.businesses).toHaveLength(30);
    expect(f.total).toBe(30);
    expect(f._traps).toHaveLength(4);
    for (const t of f._traps) {
      const b = f.businesses.find((x) => x.id === t.id);
      expect(b, t.name).toBeDefined();
      expect(b!.name).toBe(t.name);
    }
  });

  it("expects 26 qualified / 4 rejected with the right reasons", () => {
    expect(f._traps.every((t) => t.expected === "rejected")).toBe(true);
    expect(f._traps.map((t) => t.reason).sort()).toEqual(["category_mismatch", "chain", "no_phone", "out_of_area"]);
  });

  it("each trap trips exactly its own rule", () => {
    const expectedViolation: Record<string, string> = {
      category_mismatch: "category",
      chain: "chain",
      no_phone: "phone",
      out_of_area: "distance",
    };
    for (const t of f._traps) {
      const b = f.businesses.find((x) => x.id === t.id)!;
      expect(violations(b, "austin"), t.name).toEqual([expectedViolation[t.reason!]]);
    }
  });

  it("trap details", () => {
    const abc = one("austin", "ABC Plumbing");
    expect(abc.categories).toEqual([{ alias: "plumbing", title: "Plumbing" }]);
    expect(abc.location.city).toBe("Austin");
    expect(abc.phone.startsWith("+1512555")).toBe(true);

    const aspen = f.businesses.find((b) => b.name.startsWith("Aspen Dental"))!;
    expect(aspen).toBeDefined();
    expect(trapFor("austin", aspen.id)?.reason).toBe("chain");

    const noPhone = f.businesses.find((b) => trapFor("austin", b.id)?.reason === "no_phone")!;
    expect(noPhone.phone).toBe("");
    expect(noPhone.display_phone).toBe("");

    const far = f.businesses.find((b) => trapFor("austin", b.id)?.reason === "out_of_area")!;
    expect(far.location.city).toBe("Georgetown");
    expect(far.location.state).toBe("TX");
    expect(far.distance).toBe(41000);
  });
});

// ---- cross-file -----------------------------------------------------------

describe("cross-file properties", () => {
  it("ABC Plumbing appears exactly once per file with distinct ids and cities Houston/Dallas/Austin", () => {
    const abcs = SET_KEYS.map((k) => {
      const found = files[k].businesses.filter((b) => b.name === "ABC Plumbing");
      expect(found, k).toHaveLength(1);
      return found[0];
    });
    expect(new Set(abcs.map((b) => b.id)).size).toBe(3);
    expect(abcs.map((b) => b.location.city)).toEqual(["Houston", "Dallas", "Austin"]);
    expect(allBusinesses.filter((b) => b.name.toLowerCase() === "abc plumbing")).toHaveLength(3);
  });

  it("ids and aliases are unique across all files", () => {
    const ids = allBusinesses.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(100);
    const aliases = allBusinesses.map((b) => b.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("names are unique (case-insensitive) except ABC Plumbing and the Reliable pair", () => {
    const counts = new Map<string, number>();
    for (const b of allBusinesses) counts.set(b.name.toLowerCase(), (counts.get(b.name.toLowerCase()) ?? 0) + 1);
    const dups = [...counts].filter(([, n]) => n > 1).map(([name, n]) => [name, n]);
    expect(dups.sort()).toEqual([
      ["abc plumbing", 3],
      ["reliable plumbing co", 2],
    ]);
  });

  it("non-empty phones are unique except the Reliable pair, and E.164 with the right area code", () => {
    const phones = allBusinesses.map((b) => b.phone).filter((p) => p !== "");
    const counts = new Map<string, number>();
    for (const p of phones) counts.set(p, (counts.get(p) ?? 0) + 1);
    const dupPhones = [...counts].filter(([, n]) => n > 1);
    expect(dupPhones).toHaveLength(1);
    const reliable = named("houston", "Reliable Plumbing Co");
    expect(dupPhones[0]).toEqual([reliable[0].phone, 2]);

    for (const k of SET_KEYS) {
      for (const b of files[k].businesses) {
        if (b.phone === "") continue;
        expect(b.phone, b.name).toMatch(/^\+1\d{10}$/);
        expect(b.phone.startsWith(SETS[k].areaPrefix), `${b.name} area code`).toBe(true);
      }
    }
  });

  it("every non-trap record is ordinary", () => {
    for (const k of SET_KEYS) {
      const trapIds = new Set(files[k]._traps.map((t) => t.id));
      const ordinary = files[k].businesses.filter((b) => !trapIds.has(b.id));
      expect(ordinary.length).toBe(SETS[k].size - files[k]._traps.length);
      for (const b of ordinary) {
        expect(violations(b, k), b.name).toEqual([]);
        expect(b.is_closed).toBe(false);
        expect(b.categories[0].alias).toBe(SETS[k].category);
        expect(b.phone).not.toBe("");
        expect(b.location.state).toBe("TX");
        expect(VALID_RATINGS).toContain(b.rating);
        expect(b.review_count).toBeGreaterThanOrEqual(5);
        expect(b.review_count).toBeLessThanOrEqual(450);
        expect(b.distance).toBeGreaterThanOrEqual(300);
        expect(b.distance).toBeLessThanOrEqual(19500);
        expect(matchesChainPattern(b.name), `${b.name} chain pattern`).toBe(false);
      }
    }
  });

  it("primary category titles match the search category", () => {
    const titles = { plumbing: "Plumbing", hvac: "Heating & Air Conditioning/HVAC", dentists: "General Dentistry" } as const;
    for (const k of SET_KEYS) {
      const trapIds = new Set(files[k]._traps.map((t) => t.id));
      for (const b of files[k].businesses.filter((x) => !trapIds.has(x.id))) {
        expect(b.categories[0]).toEqual({ alias: SETS[k].category, title: titles[SETS[k].category] });
      }
    }
  });

  it("chain-trap names match a chain pattern; every other trap name does not", () => {
    for (const k of SET_KEYS) {
      for (const t of files[k]._traps) {
        if (t.reason === "chain") expect(matchesChainPattern(t.name), t.name).toBe(true);
        else expect(matchesChainPattern(t.name), t.name).toBe(false);
      }
    }
  });

  it("every record has all required keys with the right types", () => {
    for (const b of allBusinesses) {
      const label = b.name;
      expect(b.id, label).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(typeof b.alias).toBe("string");
      expect(b.alias, label).toMatch(/^[a-z0-9-]+$/);
      expect(typeof b.name).toBe("string");
      expect(typeof b.image_url).toBe("string");
      if (b.image_url !== "") {
        expect(b.image_url, label).toMatch(/^https:\/\/s3-media0\.fl\.yelpcdn\.com\/bphoto\/[A-Za-z0-9_-]+\/o\.jpg$/);
      }
      expect(typeof b.is_closed).toBe("boolean");
      expect(b.url).toBe(`https://www.yelp.com/biz/${b.alias}`);
      expect(Number.isInteger(b.review_count)).toBe(true);
      expect(Array.isArray(b.categories)).toBe(true);
      expect(b.categories.length).toBeGreaterThanOrEqual(1);
      for (const c of b.categories) {
        expect(typeof c.alias).toBe("string");
        expect(typeof c.title).toBe("string");
      }
      expect(typeof b.rating).toBe("number");
      expect(typeof b.coordinates.latitude).toBe("number");
      expect(typeof b.coordinates.longitude).toBe("number");
      expect(Array.isArray(b.transactions)).toBe(true);
      if ("price" in b) expect(["$", "$$", "$$$"]).toContain(b.price);
      expect(typeof b.location.address1).toBe("string");
      expect(b.location.address2 === null || typeof b.location.address2 === "string").toBe(true);
      expect(b.location.address3 === null || typeof b.location.address3 === "string").toBe(true);
      expect(typeof b.location.city).toBe("string");
      expect(b.location.zip_code, label).toMatch(/^\d{5}$/);
      expect(b.location.country).toBe("US");
      expect(b.location.state).toBe("TX");
      expect(Array.isArray(b.location.display_address)).toBe(true);
      expect(typeof b.phone).toBe("string");
      expect(typeof b.display_phone).toBe("string");
      if (b.phone === "") expect(b.display_phone).toBe("");
      else expect(b.display_phone, label).toMatch(/^\(\d{3}\) 555-\d{4}$/);
      expect(typeof b.distance).toBe("number");

      const keys = Object.keys(b).filter((k) => k !== "price").sort();
      expect(keys).toEqual(
        [
          "alias", "categories", "coordinates", "display_phone", "distance", "id", "image_url", "is_closed",
          "location", "name", "phone", "rating", "review_count", "transactions", "url",
        ].sort(),
      );
    }
  });

  it("price is present on most records and omitted on a few", () => {
    const withPrice = allBusinesses.filter((b) => b.price !== undefined).length;
    expect(withPrice).toBeGreaterThan(allBusinesses.length * 0.7);
    expect(withPrice).toBeLessThan(allBusinesses.length);
  });
});

// ---- detail files ---------------------------------------------------------

describe("business detail files", () => {
  const detailFiles = readdirSync(FIXTURE_DIR).filter((f) => /^business-.+\.json$/.test(f));
  const details = detailFiles.map((f) => ({ file: f, data: readJson<YelpDetail>(f) }));

  it("has exactly six detail files named after their ids", () => {
    expect(details).toHaveLength(6);
    for (const { file, data } of details) expect(file).toBe(`business-${data.id}.json`);
  });

  it("each matches an existing search record (minus distance), two per search file", () => {
    const perFile: Record<SetKey, number> = { houston: 0, dallas: 0, austin: 0 };
    for (const { data } of details) {
      const key = SET_KEYS.find((k) => files[k].businesses.some((b) => b.id === data.id));
      expect(key, data.id).toBeDefined();
      const search = files[key!].businesses.find((b) => b.id === data.id)!;
      perFile[key!] += 1;

      const { distance: _distance, ...searchWithoutDistance } = search;
      void _distance;
      const { is_claimed: _c, photos: _p, hours: _h, ...base } = data;
      void _c;
      void _p;
      void _h;
      expect(base).toEqual(searchWithoutDistance);
      expect("distance" in data).toBe(false);

      // ordinary: not a trap and not ABC Plumbing
      expect(files[key!]._traps.some((t) => t.id === data.id)).toBe(false);
      expect(data.name).not.toBe("ABC Plumbing");
    }
    expect(perFile).toEqual({ houston: 2, dallas: 2, austin: 2 });
  });

  it("exactly two are unclaimed", () => {
    expect(details.filter((d) => d.data.is_claimed === false)).toHaveLength(2);
    expect(details.filter((d) => d.data.is_claimed === true)).toHaveLength(4);
  });

  it("each has 3 https photos and non-empty hours", () => {
    for (const { data } of details) {
      expect(data.photos).toHaveLength(3);
      for (const p of data.photos) expect(p).toMatch(/^https:\/\//);
      expect(Array.isArray(data.hours)).toBe(true);
      expect(data.hours.length).toBeGreaterThan(0);
      for (const h of data.hours) {
        expect(h.hours_type).toBe("REGULAR");
        expect(typeof h.is_open_now).toBe("boolean");
        expect(h.open.length).toBeGreaterThan(0);
        for (const o of h.open) {
          expect(o.is_overnight).toBe(false);
          expect(o.start).toMatch(/^\d{4}$/);
          expect(o.end).toMatch(/^\d{4}$/);
          expect(o.day).toBeGreaterThanOrEqual(0);
          expect(o.day).toBeLessThanOrEqual(6);
        }
      }
    }
  });
});
