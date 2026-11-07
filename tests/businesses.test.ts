import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  type BusinessFilter,
  type BusinessSort,
  countByQualification,
  countByReason,
  countByStatus,
  deleteBusiness,
  getBusiness,
  listBusinessIds,
  listBusinesses,
  listCategories,
  listCities,
  setQualification,
  updateBusinessCrm,
  upsertBusinessByYelpId,
} from "@/db/repo/businesses";
import { createSearchJob } from "@/db/repo/search-jobs";
import type { NewBusiness } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { normalizeName, phoneDigits } from "@/lib/format";
import type { QualifyResult } from "@/lib/qualify";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function reset() {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, activities RESTART IDENTITY CASCADE`);
}

let seq = 0;
function makeRow(overrides: Partial<NewBusiness> = {}): NewBusiness {
  seq += 1;
  const name = overrides.name ?? `Business ${seq}`;
  const phone = overrides.phone === undefined ? `+1713555${String(1000 + seq).slice(-4)}` : overrides.phone;
  return {
    yelpId: `yelp-${seq}`,
    name,
    nameNormalized: normalizeName(name),
    phone,
    phoneDigits: phoneDigits(phone),
    rating: "4.0",
    reviewCount: 20,
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    city: "Houston",
    state: "TX",
    raw: {},
    ...overrides,
  };
}

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

// ---------------------------------------------------------------- upsert

describe("upsertBusinessByYelpId (AC-03.5)", () => {
  beforeAll(reset);

  it("creates on first call and updates on second, keeping the same id", async () => {
    const row = makeRow({ yelpId: "y-basic", name: "Basic Co" });
    const first = await upsertBusinessByYelpId(db, row);
    expect(first.created).toBe(true);
    expect(first.business.yelpId).toBe("y-basic");
    expect(first.business.status).toBe("new");

    const second = await upsertBusinessByYelpId(db, row);
    expect(second.created).toBe(false);
    expect(second.business.id).toBe(first.business.id);
  });

  it("updates Yelp-owned fields and leaves CRM fields untouched", async () => {
    const first = await upsertBusinessByYelpId(
      db,
      makeRow({
        yelpId: "y-crm",
        name: "Old Name",
        rating: "3.5",
        reviewCount: 5,
        phone: "+17135550001",
        city: "Houston",
      }),
    );
    expect(first.created).toBe(true);
    const id = first.business.id;

    await updateBusinessCrm(db, id, {
      status: "interested",
      ownerEmail: "owner@example.com",
      notes: "Called, wants a quote",
      tags: ["vip"],
      doNotCall: true,
    });

    const second = await upsertBusinessByYelpId(
      db,
      makeRow({
        yelpId: "y-crm",
        name: "New Name",
        rating: "4.5",
        reviewCount: 99,
        phone: "+12145550002",
        city: "Dallas",
      }),
    );
    expect(second.created).toBe(false);
    expect(second.business.id).toBe(id);

    const after = await getBusiness(db, id);
    expect(after).not.toBeNull();
    // Yelp-owned fields updated.
    expect(after?.name).toBe("New Name");
    expect(after?.nameNormalized).toBe("new name");
    expect(after?.rating).toBe("4.5");
    expect(after?.reviewCount).toBe(99);
    expect(after?.phone).toBe("+12145550002");
    expect(after?.phoneDigits).toBe("12145550002");
    expect(after?.city).toBe("Dallas");
    // CRM fields untouched.
    expect(after?.status).toBe("interested");
    expect(after?.ownerEmail).toBe("owner@example.com");
    expect(after?.notes).toBe("Called, wants a quote");
    expect(after?.tags).toEqual(["vip"]);
    expect(after?.doNotCall).toBe(true);
    // Row identity and creation time are stable.
    expect(after?.createdAt.toISOString()).toBe(first.business.createdAt.toISOString());
  });

  it("never overwrites CRM fields even when the upsert row contains them", async () => {
    const first = await upsertBusinessByYelpId(db, makeRow({ yelpId: "y-crm2", name: "Crm Two" }));
    const id = first.business.id;
    const followUp = new Date("2026-06-01T12:00:00Z");
    await updateBusinessCrm(db, id, {
      status: "callback",
      ownerName: "Pat Owner",
      ownerEmail: "pat@example.com",
      notes: "keep me",
      tags: ["vip", "hot"],
      doNotCall: true,
      doNotEmail: true,
      nextFollowUpAt: followUp,
    });

    await upsertBusinessByYelpId(
      db,
      makeRow({
        yelpId: "y-crm2",
        name: "Crm Two Renamed",
        status: "new",
        notes: "x",
        ownerName: "Someone Else",
        ownerEmail: "other@example.com",
        tags: [],
        doNotCall: false,
        doNotEmail: false,
        lastContactedAt: new Date("2030-01-01T00:00:00Z"),
        nextFollowUpAt: new Date("2030-01-02T00:00:00Z"),
      }),
    );

    const after = await getBusiness(db, id);
    expect(after?.name).toBe("Crm Two Renamed");
    expect(after?.status).toBe("callback");
    expect(after?.notes).toBe("keep me");
    expect(after?.ownerName).toBe("Pat Owner");
    expect(after?.ownerEmail).toBe("pat@example.com");
    expect(after?.tags).toEqual(["vip", "hot"]);
    expect(after?.doNotCall).toBe(true);
    expect(after?.doNotEmail).toBe(true);
    expect(after?.lastContactedAt).toBeNull();
    expect(after?.nextFollowUpAt?.toISOString()).toBe(followUp.toISOString());
  });

  it("leaves columns absent from the upsert row untouched", async () => {
    const first = await upsertBusinessByYelpId(
      db,
      makeRow({ yelpId: "y-partial", name: "Partial Co", website: "https://partial.example.com" }),
    );
    await upsertBusinessByYelpId(db, {
      yelpId: "y-partial",
      name: "Partial Co Renamed",
      nameNormalized: "partial co renamed",
      categories: [],
      raw: { v: 2 },
    });
    const after = await getBusiness(db, first.business.id);
    expect(after?.name).toBe("Partial Co Renamed");
    expect(after?.raw).toEqual({ v: 2 });
    expect(after?.categories).toEqual([]);
    expect(after?.website).toBe("https://partial.example.com");
    expect(after?.phone).toBe(first.business.phone);
    expect(after?.city).toBe("Houston");
  });

  it("advances updatedAt on update", async () => {
    const first = await upsertBusinessByYelpId(db, makeRow({ yelpId: "y-updated" }));
    await new Promise((r) => setTimeout(r, 5));
    const second = await upsertBusinessByYelpId(db, makeRow({ yelpId: "y-updated" }));
    expect(second.business.updatedAt.getTime()).toBeGreaterThan(first.business.updatedAt.getTime());
  });
});

// ---------------------------------------------------------------- get / delete / crm / qualification

describe("getBusiness / deleteBusiness / updateBusinessCrm / setQualification", () => {
  beforeAll(reset);

  it("getBusiness returns a row, or null for unknown and malformed ids", async () => {
    const { business } = await upsertBusinessByYelpId(db, makeRow({ name: "Findable Co" }));
    const found = await getBusiness(db, business.id);
    expect(found?.id).toBe(business.id);
    expect(found?.name).toBe("Findable Co");
    expect(await getBusiness(db, UNKNOWN_UUID)).toBeNull();
    expect(await getBusiness(db, "not-a-uuid")).toBeNull();
  });

  it("deleteBusiness returns true then false, and for invalid ids", async () => {
    const { business } = await upsertBusinessByYelpId(db, makeRow({ name: "Doomed Co" }));
    expect(await deleteBusiness(db, business.id)).toBe(true);
    expect(await getBusiness(db, business.id)).toBeNull();
    expect(await deleteBusiness(db, business.id)).toBe(false);
    expect(await deleteBusiness(db, "not-a-uuid")).toBe(false);
    expect(await deleteBusiness(db, UNKNOWN_UUID)).toBe(false);
  });

  it("updateBusinessCrm patches only the given fields and returns the row", async () => {
    const { business } = await upsertBusinessByYelpId(db, makeRow({ name: "Crm Patch Co" }));
    const updated = await updateBusinessCrm(db, business.id, { notes: "hello", tags: ["a", "b"] });
    expect(updated?.notes).toBe("hello");
    expect(updated?.tags).toEqual(["a", "b"]);
    expect(updated?.status).toBe("new");
    expect(updated?.doNotCall).toBe(false);
    expect(await updateBusinessCrm(db, UNKNOWN_UUID, { notes: "x" })).toBeNull();
    expect(await updateBusinessCrm(db, "not-a-uuid", { notes: "x" })).toBeNull();
  });

  it("setQualification stores qualification, score, reasons and sets qualifiedAt", async () => {
    const { business } = await upsertBusinessByYelpId(db, makeRow({ name: "Qualify Me Co" }));
    // Schema defaults before qualification.
    expect(business.qualification).toBe("review");
    expect(business.score).toBe(0);
    expect(business.rejectionReasons).toEqual([]);
    expect(business.qualifiedAt).toBeNull();

    const before = Date.now();
    const result: QualifyResult = { qualification: "rejected", score: 12, reasons: ["closed", "no_phone"] };
    await setQualification(db, business.id, result);
    const after = await getBusiness(db, business.id);
    expect(after?.qualification).toBe("rejected");
    expect(after?.score).toBe(12);
    expect(after?.rejectionReasons).toEqual(["closed", "no_phone"]);
    expect(after?.qualifiedAt).toBeInstanceOf(Date);
    expect(after?.qualifiedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // Re-qualifying overwrites, including clearing reasons.
    await setQualification(db, business.id, { qualification: "qualified", score: 88, reasons: [] });
    const again = await getBusiness(db, business.id);
    expect(again?.qualification).toBe("qualified");
    expect(again?.score).toBe(88);
    expect(again?.rejectionReasons).toEqual([]);
  });
});

// ---------------------------------------------------------------- listing dataset

type Seed = {
  key: string;
  row: Partial<NewBusiness>;
  q: QualifyResult;
  crm?: Parameters<typeof updateBusinessCrm>[2];
  job?: "A" | "B";
};

const SEEDS: Seed[] = [
  {
    key: "alpha",
    row: {
      name: "Alpha Electric",
      phone: "+17135550101",
      city: "Houston",
      state: "TX",
      categories: [{ alias: "electricians", title: "Electricians" }],
    },
    q: { qualification: "qualified", score: 90, reasons: [] },
    crm: { ownerEmail: "alpha@example.com", tags: ["vip"] },
    job: "A",
  },
  {
    key: "bravo",
    row: {
      name: "Bravo Dental",
      phone: "+12145550102",
      city: "Dallas",
      state: "TX",
      categories: [
        { alias: "dentists", title: "Dentists" },
        { alias: "cosmeticdentists", title: "Cosmetic Dentists" },
      ],
    },
    q: { qualification: "review", score: 50, reasons: [] },
    crm: { status: "contacted", doNotEmail: true },
    job: "A",
  },
  {
    key: "charlie",
    row: {
      name: "Charlie HVAC",
      phone: null,
      city: "Austin",
      state: "TX",
      categories: [{ alias: "hvac", title: "HVAC" }],
    },
    q: { qualification: "rejected", score: 10, reasons: ["no_phone", "closed"] },
    job: "B",
  },
  {
    key: "delta",
    row: {
      name: "Delta Roofing",
      phone: "+17135550104",
      city: "Houston",
      state: "TX",
      categories: [
        { alias: "roofing", title: "Roofing" },
        { alias: "hvac", title: "HVAC" },
      ],
    },
    q: { qualification: "qualified", score: 70, reasons: [] },
    crm: { status: "interested", doNotCall: true, ownerEmail: "" },
    job: "B",
  },
  {
    key: "echo",
    row: {
      name: "Echo Plumbing",
      phone: "+12145550105",
      city: "Dallas",
      state: "TX",
      categories: [{ alias: "plumbing", title: "Plumbing" }],
    },
    q: { qualification: "qualified", score: 80, reasons: [] },
    crm: { status: "callback" },
  },
  {
    key: "reliable",
    row: {
      name: "Reliable Plumbing",
      phone: "+17135550142",
      city: "Houston",
      state: "TX",
      categories: [{ alias: "plumbing", title: "Plumbing" }],
    },
    q: { qualification: "qualified", score: 85, reasons: [] },
    crm: { tags: ["vip", "hot"] },
  },
  {
    key: "golf",
    row: {
      name: "Golf Plumbing",
      phone: "+15125550107",
      city: "Austin",
      state: "TX",
      categories: [{ alias: "plumbing", title: "Plumbing" }],
    },
    q: { qualification: "rejected", score: 20, reasons: ["closed", "chain"] },
    crm: { status: "not_interested", ownerEmail: "golf@example.com" },
  },
  {
    key: "zulu",
    row: {
      name: "Zulu Services",
      phone: null,
      city: null,
      state: null,
      categories: [],
    },
    q: { qualification: "review", score: 40, reasons: ["no_phone"] },
    crm: { status: "converted" },
  },
];

describe("listing, filtering and aggregates (AC-03.6)", () => {
  const ids: Record<string, string> = {};
  const nameOf: Record<string, string> = {};
  let jobA: string;
  let jobB: string;

  beforeAll(async () => {
    await reset();
    jobA = (await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] })).id;
    jobB = (await createSearchJob(db, { location: "Dallas, TX", categoryAliases: ["hvac"] })).id;
    for (const s of SEEDS) {
      const row = makeRow({
        ...s.row,
        sourceJobId: s.job === "A" ? jobA : s.job === "B" ? jobB : undefined,
      });
      const { business } = await upsertBusinessByYelpId(db, row);
      await setQualification(db, business.id, s.q);
      if (s.crm) await updateBusinessCrm(db, business.id, s.crm);
      ids[s.key] = business.id;
      nameOf[s.key] = row.name;
    }
  });

  const idSet = (...keys: string[]) => keys.map((k) => ids[k]).sort();
  async function matches(f: BusinessFilter): Promise<string[]> {
    const { rows, total } = await listBusinesses(db, f, { limit: 1000 });
    expect(total).toBe(rows.length);
    return rows.map((r) => r.id).sort();
  }

  it("seeds 8 rows and no filter returns all of them", async () => {
    const { rows, total } = await listBusinesses(db, {});
    expect(total).toBe(8);
    expect(rows).toHaveLength(8);
  });

  describe("q", () => {
    it("matches name partially and case-insensitively", async () => {
      expect(await matches({ q: "rELia" })).toEqual(idSet("reliable"));
      expect(await matches({ q: "plumbing" })).toEqual(idSet("echo", "reliable", "golf"));
      expect(await matches({ q: "  ALPHA  " })).toEqual(idSet("alpha"));
    });

    it("returns nothing for a name that does not match", async () => {
      expect(await matches({ q: "nonexistent" })).toEqual([]);
    });

    it("matches phone digits regardless of formatting", async () => {
      expect(await matches({ q: "555-0142" })).toEqual(idSet("reliable"));
      expect(await matches({ q: "5550142" })).toEqual(idSet("reliable"));
      expect(await matches({ q: "(713) 555-0142" })).toEqual(idSet("reliable"));
      expect(await matches({ q: "555-0999" })).toEqual([]);
    });

    it("does not match phone for fewer than 3 digits", async () => {
      expect(await matches({ q: "01" })).toEqual([]);
    });

    it("treats LIKE wildcards literally", async () => {
      expect(await matches({ q: "%" })).toEqual([]);
      expect(await matches({ q: "_" })).toEqual([]);
    });

    it("ignores a blank q", async () => {
      expect(await matches({ q: "   " })).toHaveLength(8);
    });
  });

  it("filters by qualification (array)", async () => {
    expect(await matches({ qualification: ["qualified"] })).toEqual(idSet("alpha", "delta", "echo", "reliable"));
    expect(await matches({ qualification: ["review", "rejected"] })).toEqual(
      idSet("bravo", "zulu", "charlie", "golf"),
    );
    expect(await matches({ qualification: [] })).toHaveLength(8);
  });

  it("filters by status (array)", async () => {
    expect(await matches({ status: ["interested"] })).toEqual(idSet("delta"));
    expect(await matches({ status: ["contacted", "callback"] })).toEqual(idSet("bravo", "echo"));
    expect(await matches({ status: ["new"] })).toEqual(idSet("alpha", "charlie", "reliable"));
    expect(await matches({ status: ["do_not_call"] })).toEqual([]);
  });

  it("filters by city case-insensitively", async () => {
    expect(await matches({ city: "houston" })).toEqual(idSet("alpha", "delta", "reliable"));
    expect(await matches({ city: "  DALLAS " })).toEqual(idSet("bravo", "echo"));
    expect(await matches({ city: "Nowhere" })).toEqual([]);
  });

  it("filters by state case-insensitively", async () => {
    expect(await matches({ state: "tx" })).toEqual(idSet("alpha", "bravo", "charlie", "delta", "echo", "reliable", "golf"));
    expect(await matches({ state: "CA" })).toEqual([]);
  });

  it("filters by category alias anywhere in the categories array", async () => {
    expect(await matches({ category: "plumbing" })).toEqual(idSet("echo", "reliable", "golf"));
    expect(await matches({ category: "hvac" })).toEqual(idSet("charlie", "delta"));
    expect(await matches({ category: "cosmeticdentists" })).toEqual(idSet("bravo"));
    expect(await matches({ category: "florists" })).toEqual([]);
  });

  it("filters by minScore and maxScore", async () => {
    expect(await matches({ minScore: 80 })).toEqual(idSet("alpha", "echo", "reliable"));
    expect(await matches({ minScore: 91 })).toEqual([]);
    expect(await matches({ maxScore: 20 })).toEqual(idSet("charlie", "golf"));
    expect(await matches({ maxScore: 5 })).toEqual([]);
    expect(await matches({ minScore: 40, maxScore: 70 })).toEqual(idSet("bravo", "delta", "zulu"));
    expect(await matches({ minScore: 0 })).toHaveLength(8);
  });

  it("filters by hasPhone true/false", async () => {
    expect(await matches({ hasPhone: false })).toEqual(idSet("charlie", "zulu"));
    expect(await matches({ hasPhone: true })).toEqual(idSet("alpha", "bravo", "delta", "echo", "reliable", "golf"));
  });

  it("filters by hasEmail true/false (empty string counts as no email)", async () => {
    expect(await matches({ hasEmail: true })).toEqual(idSet("alpha", "golf"));
    expect(await matches({ hasEmail: false })).toEqual(idSet("bravo", "charlie", "delta", "echo", "reliable", "zulu"));
  });

  it("excludes do-not-call businesses", async () => {
    expect(await matches({ excludeDoNotCall: true })).toEqual(
      idSet("alpha", "bravo", "charlie", "echo", "reliable", "golf", "zulu"),
    );
    expect(await matches({ excludeDoNotCall: false })).toHaveLength(8);
    expect(await matches({ excludeDoNotCall: true, city: "houston" })).toEqual(idSet("alpha", "reliable"));
  });

  it("excludes do-not-email businesses", async () => {
    expect(await matches({ excludeDoNotEmail: true })).toEqual(
      idSet("alpha", "charlie", "delta", "echo", "reliable", "golf", "zulu"),
    );
  });

  it("filters by tag", async () => {
    expect(await matches({ tag: "vip" })).toEqual(idSet("alpha", "reliable"));
    expect(await matches({ tag: "hot" })).toEqual(idSet("reliable"));
    expect(await matches({ tag: "missing" })).toEqual([]);
  });

  it("filters by sourceJobId", async () => {
    expect(await matches({ sourceJobId: jobA })).toEqual(idSet("alpha", "bravo"));
    expect(await matches({ sourceJobId: jobB })).toEqual(idSet("charlie", "delta"));
    expect(await matches({ sourceJobId: UNKNOWN_UUID })).toEqual([]);
    expect(await matches({ sourceJobId: "not-a-uuid" })).toEqual([]);
  });

  it("filters by ids, including an empty list and malformed ids", async () => {
    expect(await matches({ ids: [ids.alpha, ids.golf] })).toEqual(idSet("alpha", "golf"));
    expect(await matches({ ids: [ids.alpha, UNKNOWN_UUID, "not-a-uuid"] })).toEqual(idSet("alpha"));
    expect(await matches({ ids: [] })).toEqual([]);
    expect(await matches({ ids: ["not-a-uuid"] })).toEqual([]);
    const { rows, total } = await listBusinesses(db, { ids: [] });
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  it("combines filters with AND", async () => {
    expect(await matches({ city: "houston", qualification: ["qualified"], minScore: 80 })).toEqual(
      idSet("alpha", "reliable"),
    );
    expect(await matches({ city: "houston", category: "plumbing", tag: "vip" })).toEqual(idSet("reliable"));
    expect(await matches({ city: "dallas", hasEmail: true })).toEqual([]);
  });

  describe("sorting", () => {
    const sorted = async (sort: BusinessSort) => (await listBusinesses(db, {}, { sort })).rows;

    it("defaults to score descending", async () => {
      const { rows } = await listBusinesses(db, {});
      expect(rows.map((r) => r.score)).toEqual([90, 85, 80, 70, 50, 40, 20, 10]);
    });

    it("sorts by score desc (non-increasing) and asc (non-decreasing)", async () => {
      const desc = (await sorted({ field: "score", dir: "desc" })).map((r) => r.score);
      expect(desc).toHaveLength(8);
      for (let i = 1; i < desc.length; i++) expect(desc[i]).toBeLessThanOrEqual(desc[i - 1]);
      const asc = (await sorted({ field: "score", dir: "asc" })).map((r) => r.score);
      for (let i = 1; i < asc.length; i++) expect(asc[i]).toBeGreaterThanOrEqual(asc[i - 1]);
      expect(asc[0]).toBe(10);
    });

    it("sorts by name ascending and descending", async () => {
      const expected = Object.values(nameOf).sort();
      const asc = (await sorted({ field: "name", dir: "asc" })).map((r) => r.name);
      expect(asc).toEqual(expected);
      const desc = (await sorted({ field: "name", dir: "desc" })).map((r) => r.name);
      expect(desc).toEqual([...expected].reverse());
    });

    it("puts NULL values last when sorting by city", async () => {
      const asc = await sorted({ field: "city", dir: "asc" });
      expect(asc[asc.length - 1].city).toBeNull();
      const desc = await sorted({ field: "city", dir: "desc" });
      expect(desc[desc.length - 1].city).toBeNull();
    });
  });

  describe("paging", () => {
    it("returns the requested page and a total that ignores paging", async () => {
      const page = await listBusinesses(db, {}, { limit: 2, offset: 2 });
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBe(8);
      const all = await listBusinesses(db, {}, { limit: 1000 });
      expect(page.rows.map((r) => r.id)).toEqual(all.rows.slice(2, 4).map((r) => r.id));
    });

    it("total reflects the filter, not the page size", async () => {
      const page = await listBusinesses(db, { city: "houston" }, { limit: 1 });
      expect(page.rows).toHaveLength(1);
      expect(page.total).toBe(3);
    });

    it("pages together contain every row exactly once", async () => {
      const seen: string[] = [];
      const limit = 3;
      for (let offset = 0; offset < 8; offset += limit) {
        const { rows, total } = await listBusinesses(db, {}, { limit, offset });
        expect(total).toBe(8);
        seen.push(...rows.map((r) => r.id));
      }
      expect(seen).toHaveLength(8);
      expect(new Set(seen).size).toBe(8);
      expect([...seen].sort()).toEqual(Object.values(ids).sort());
    });

    it("pages stay stable when sorting by a column with ties", async () => {
      // Several rows share a status, so ties must be broken by name/id for paging to be stable.
      const seen: string[] = [];
      for (let offset = 0; offset < 8; offset += 2) {
        const { rows } = await listBusinesses(db, {}, { sort: { field: "status", dir: "asc" }, limit: 2, offset });
        seen.push(...rows.map((r) => r.id));
      }
      expect(new Set(seen).size).toBe(8);
    });

    it("returns no rows past the end but still reports the total", async () => {
      const page = await listBusinesses(db, {}, { limit: 2, offset: 100 });
      expect(page.rows).toEqual([]);
      expect(page.total).toBe(8);
    });
  });

  describe("listBusinessIds", () => {
    it("returns the ids matching a filter (all of them, no paging)", async () => {
      const result = await listBusinessIds(db, { city: "houston" });
      expect([...result].sort()).toEqual(idSet("alpha", "delta", "reliable"));
      expect(await listBusinessIds(db, { city: "Nowhere" })).toEqual([]);
      expect(await listBusinessIds(db, {})).toHaveLength(8);
    });

    it("orders by score descending", async () => {
      const result = await listBusinessIds(db, { qualification: ["qualified"] });
      expect(result).toEqual([ids.alpha, ids.reliable, ids.echo, ids.delta]);
    });
  });

  describe("countByQualification", () => {
    it("has all three keys, counting everything without a filter", async () => {
      expect(await countByQualification(db)).toEqual({ qualified: 4, review: 2, rejected: 2 });
    });

    it("honours a filter and keeps zero keys", async () => {
      expect(await countByQualification(db, { city: "austin" })).toEqual({ qualified: 0, review: 0, rejected: 2 });
      expect(await countByQualification(db, { sourceJobId: jobA })).toEqual({ qualified: 1, review: 1, rejected: 0 });
      expect(await countByQualification(db, { ids: [] })).toEqual({ qualified: 0, review: 0, rejected: 0 });
    });
  });

  it("countByReason counts across rejectionReasons, most common first", async () => {
    // closed: charlie + golf, no_phone: charlie + zulu, chain: golf. Ties break alphabetically.
    expect(await countByReason(db)).toEqual([
      { reason: "closed", count: 2 },
      { reason: "no_phone", count: 2 },
      { reason: "chain", count: 1 },
    ]);
  });

  it("countByStatus has all 7 statuses, zeros included", async () => {
    const counts = await countByStatus(db);
    expect(Object.keys(counts).sort()).toEqual(
      ["callback", "contacted", "converted", "do_not_call", "interested", "new", "not_interested"].sort(),
    );
    expect(counts).toEqual({
      new: 3,
      contacted: 1,
      interested: 1,
      callback: 1,
      not_interested: 1,
      do_not_call: 0,
      converted: 1,
    });
  });

  it("listCities returns {city,state,count} most first and skips null cities", async () => {
    expect(await listCities(db)).toEqual([
      { city: "Houston", state: "TX", count: 3 },
      { city: "Austin", state: "TX", count: 2 },
      { city: "Dallas", state: "TX", count: 2 },
    ]);
  });

  it("listCategories counts every alias in the categories arrays, most common first", async () => {
    expect(await listCategories(db)).toEqual([
      { alias: "plumbing", count: 3 },
      { alias: "hvac", count: 2 },
      { alias: "cosmeticdentists", count: 1 },
      { alias: "dentists", count: 1 },
      { alias: "electricians", count: 1 },
      { alias: "roofing", count: 1 },
    ]);
  });

  it("deleting a business removes it from listings and aggregates", async () => {
    const { business } = await upsertBusinessByYelpId(db, makeRow({ name: "Yankee Temp", city: "Houston" }));
    expect((await listBusinesses(db, {})).total).toBe(9);
    expect((await listCities(db))[0]).toEqual({ city: "Houston", state: "TX", count: 4 });
    expect(await deleteBusiness(db, business.id)).toBe(true);
    expect((await listBusinesses(db, {})).total).toBe(8);
    expect((await listCities(db))[0]).toEqual({ city: "Houston", state: "TX", count: 3 });
  });
});
