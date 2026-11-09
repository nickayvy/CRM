import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listBusinesses, updateBusinessCrm } from "@/db/repo/businesses";
import {
  addRelation,
  addSnapshot,
  getBusinessByTrustpilotId,
  listGraphNodes,
  listRelations,
  listSnapshots,
  listStaleBusinesses,
  relatedBusinesses,
  upsertBusinessByTrustpilotId,
} from "@/db/repo/discovery";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness, makeTrustpilotRow } from "./helpers/builders";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses RESTART IDENTITY CASCADE`);
});

const HOUR = 3_600_000;

describe("upsertBusinessByTrustpilotId", () => {
  it("inserts a Trustpilot row without a yelpId, then updates scraped fields and preserves CRM fields", async () => {
    const row = makeTrustpilotRow({ trustpilotId: "acme.com", name: "Acme", reviewCount: 100 });
    const first = await upsertBusinessByTrustpilotId(db, row);
    expect(first.created).toBe(true);
    expect(first.business.source).toBe("trustpilot");
    expect(first.business.yelpId).toBeNull();
    expect(first.business.trustpilotId).toBe("acme.com");

    await updateBusinessCrm(db, first.business.id, {
      status: "interested",
      notes: "keep me",
      tags: ["vip"],
      ownerName: "Ann",
      doNotCall: true,
    });

    const second = await upsertBusinessByTrustpilotId(db, {
      ...row,
      reviewCount: 140,
      reviewsLast30d: 40,
      trustScore: "4.4",
      // A scraper must not be able to clobber CRM fields, even if it sends them.
      status: "new",
      notes: null,
      tags: [],
    });
    expect(second.created).toBe(false);
    expect(second.business.id).toBe(first.business.id);
    expect(second.business.reviewCount).toBe(140);
    expect(second.business.reviewsLast30d).toBe(40);
    expect(second.business.trustScore).toBe("4.4");
    expect(second.business.status).toBe("interested");
    expect(second.business.notes).toBe("keep me");
    expect(second.business.tags).toEqual(["vip"]);
    expect(second.business.ownerName).toBe("Ann");
    expect(second.business.doNotCall).toBe(true);
    expect(await db.select().from(businesses)).toHaveLength(1);

    expect((await getBusinessByTrustpilotId(db, "acme.com"))?.id).toBe(first.business.id);
    expect(await getBusinessByTrustpilotId(db, "missing.com")).toBeNull();
  });

  it("leaves keys absent from the row untouched", async () => {
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "b.com", email: "hi@b.com", aiSummary: "summary" }),
    );
    const { trustpilotId, name, nameNormalized, categories, raw } = makeTrustpilotRow({ trustpilotId: "b.com" });
    const after = await upsertBusinessByTrustpilotId(db, { trustpilotId, name, nameNormalized, categories, raw });
    expect(after.business.id).toBe(business.id);
    expect(after.business.email).toBe("hi@b.com");
    expect(after.business.aiSummary).toBe("summary");
  });
});

describe("relations", () => {
  it("deduplicates, ignores self-relations, and relatedBusinesses is bidirectional and distinct", async () => {
    const a = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Alpha" }))).business;
    const b = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Bravo" }))).business;
    const c = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Charlie" }))).business;
    const d = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Delta" }))).business;

    await addRelation(db, a.id, b.id);
    await addRelation(db, a.id, b.id); // duplicate
    await addRelation(db, b.id, a.id); // reverse: a distinct edge, still one related business
    await addRelation(db, c.id, a.id); // incoming
    await addRelation(db, a.id, a.id); // self: ignored

    const rels = await listRelations(db);
    expect(rels).toHaveLength(3);
    expect(rels).toContainEqual({ source: a.id, target: b.id });
    expect(rels).toContainEqual({ source: b.id, target: a.id });
    expect(rels).toContainEqual({ source: c.id, target: a.id });

    expect((await relatedBusinesses(db, a.id)).map((x) => x.name)).toEqual(["Bravo", "Charlie"]);
    expect((await relatedBusinesses(db, b.id)).map((x) => x.name)).toEqual(["Alpha"]);
    expect((await relatedBusinesses(db, c.id)).map((x) => x.name)).toEqual(["Alpha"]);
    expect(await relatedBusinesses(db, d.id)).toEqual([]);
  });

  it("relations cascade when a business is deleted", async () => {
    const a = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow())).business;
    const b = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow())).business;
    await addRelation(db, a.id, b.id);
    await db.delete(businesses).where(eq(businesses.id, b.id));
    expect(await listRelations(db)).toEqual([]);
  });
});

describe("snapshots", () => {
  it("are listed oldest first per business", async () => {
    const a = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow())).business;
    const b = (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow())).business;
    const t0 = new Date("2026-10-01T00:00:00Z");
    await addSnapshot(db, a.id, 130, new Date(t0.getTime() + 48 * HOUR));
    await addSnapshot(db, a.id, 100, t0);
    await addSnapshot(db, a.id, 115, new Date(t0.getTime() + 24 * HOUR));
    await addSnapshot(db, b.id, 7);
    const snaps = await listSnapshots(db, a.id);
    expect(snaps.map((s) => s.totalReviews)).toEqual([100, 115, 130]);
    expect(snaps[0].capturedAt.toISOString()).toBe(t0.toISOString());
    expect((await listSnapshots(db, b.id)).map((s) => s.totalReviews)).toEqual([7]);
    expect((await listSnapshots(db, b.id))[0].capturedAt).toBeInstanceOf(Date);
  });
});

describe("listStaleBusinesses", () => {
  it("returns never-scraped first, then oldest; respects the age cutoff, limit and source", async () => {
    const now = Date.now();
    const fresh = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Fresh", lastScrapedAt: new Date(now - 1 * HOUR) }));
    const old = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Old", lastScrapedAt: new Date(now - 72 * HOUR) }));
    const older = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Older", lastScrapedAt: new Date(now - 96 * HOUR) }));
    const never = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Never" }));
    const yelp = await insertBusiness(db, { name: "Yelp Row" }); // lastScrapedAt null, source yelp

    const all = await listStaleBusinesses(db, { olderThanHours: 24, limit: 10 });
    expect(all.map((b) => b.name)).toEqual(["Never", "Yelp Row", "Older", "Old"]);
    expect(all.map((b) => b.id)).not.toContain(fresh.business.id);

    const tp = await listStaleBusinesses(db, { olderThanHours: 24, limit: 10, source: "trustpilot" });
    expect(tp.map((b) => b.id)).toEqual([never.business.id, older.business.id, old.business.id]);
    expect(tp.map((b) => b.id)).not.toContain(yelp.id);

    expect((await listStaleBusinesses(db, { olderThanHours: 24, limit: 2, source: "trustpilot" })).map((b) => b.name)).toEqual([
      "Never",
      "Older",
    ]);
    expect((await listStaleBusinesses(db, { olderThanHours: 80, limit: 10, source: "trustpilot" })).map((b) => b.name)).toEqual([
      "Never",
      "Older",
    ]);
  });
});

describe("listGraphNodes", () => {
  it("returns the node shape, most-reviewed first, with numeric rating and a limit", async () => {
    await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ name: "Big", reviewCount: 900, rating: "4.6", reviewsLast30d: 55, primaryCategory: "travel_vacation" }),
    );
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Small", reviewCount: 10, rating: null }));
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ name: "Mid", reviewCount: 300 }));
    const nodes = await listGraphNodes(db);
    expect(nodes.map((n) => n.name)).toEqual(["Big", "Mid", "Small"]);
    expect(nodes[0]).toEqual({
      id: expect.any(String),
      name: "Big",
      category: "travel_vacation",
      totalReviews: 900,
      rating: 4.6,
      reviewsLast30d: 55,
    });
    expect(Object.keys(nodes[0]).sort()).toEqual(["category", "id", "name", "rating", "reviewsLast30d", "totalReviews"]);
    expect(nodes[2].rating).toBeNull();
    expect(await listGraphNodes(db, 2)).toHaveLength(2);
  });
});

describe("BusinessFilter v2 extensions", () => {
  beforeEach(async () => {
    await insertBusiness(db, { name: "Yelp Plumber", reviewCount: 30, rating: "4.0", reviewsLast30d: 0 });
    await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ name: "Acme Travel", trustpilotId: "acmetravel.com", reviewCount: 500, rating: "4.7", reviewsLast30d: 60 }),
    );
    await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({
        name: "Zed Shop",
        trustpilotId: "zed.example",
        website: "https://www.zedstore.io",
        reviewCount: 80,
        rating: "3.1",
        reviewsLast30d: 25,
      }),
    );
  });
  const names = async (f: Parameters<typeof listBusinesses>[1], sort?: Parameters<typeof listBusinesses>[2]) =>
    (await listBusinesses(db, f, sort)).rows.map((b) => b.name);

  it("filters by source", async () => {
    expect(await names({ source: "yelp" })).toEqual(["Yelp Plumber"]);
    expect((await names({ source: "trustpilot" })).sort()).toEqual(["Acme Travel", "Zed Shop"]);
  });

  it("filters by review count, L30D and rating bounds", async () => {
    expect((await names({ minReviews: 80 })).sort()).toEqual(["Acme Travel", "Zed Shop"]);
    expect(await names({ maxReviews: 79 })).toEqual(["Yelp Plumber"]);
    expect(await names({ minL30d: 50 })).toEqual(["Acme Travel"]);
    expect((await names({ maxL30d: 25 })).sort()).toEqual(["Yelp Plumber", "Zed Shop"]);
    expect((await names({ minL30d: 20, maxL30d: 49 }))).toEqual(["Zed Shop"]);
    expect((await names({ minRating: 4 })).sort()).toEqual(["Acme Travel", "Yelp Plumber"]);
    expect(await names({ minRating: 4.5 })).toEqual(["Acme Travel"]);
  });

  it("q matches slug and website as well as name", async () => {
    expect(await names({ q: "acmetravel.com" })).toEqual(["Acme Travel"]);
    expect(await names({ q: "zedstore" })).toEqual(["Zed Shop"]);
    expect(await names({ q: "Plumber" })).toEqual(["Yelp Plumber"]);
  });

  it("sorts by reviewsLast30d", async () => {
    expect(await names({}, { sort: { field: "reviewsLast30d", dir: "desc" } })).toEqual(["Acme Travel", "Zed Shop", "Yelp Plumber"]);
    expect(await names({}, { sort: { field: "reviewsLast30d", dir: "asc" } })).toEqual(["Yelp Plumber", "Zed Shop", "Acme Travel"]);
  });
});
