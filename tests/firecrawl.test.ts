import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness, updateBusinessCrm } from "@/db/repo/businesses";
import {
  addSnapshot,
  getBusinessByTrustpilotId,
  listSnapshots,
  relatedBusinesses,
  upsertBusinessByTrustpilotId,
} from "@/db/repo/discovery";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { DiscoveryUnavailable, createFirecrawl } from "@/lib/firecrawl/client";
import { RateLimiter } from "@/lib/firecrawl/rate-limiter";
import {
  computeVelocity,
  enrichFromWebsite,
  scrapeTrustpilotBusiness,
  scrapeTrustpilotCategory,
  slugFromTrustpilotUrl,
  syncStale,
} from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES, trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { makeTrustpilotProfile, makeTrustpilotRow } from "./helpers/builders";
import { createFakeFirecrawl, makeCategoryCard } from "./helpers/fake-firecrawl";

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
afterEach(() => {
  vi.restoreAllMocks();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const snap = (totalReviews: number, capturedAt: Date) => ({ totalReviews, capturedAt });
const url = (slug: string) => trustpilotReviewUrl(slug);

describe("slugFromTrustpilotUrl", () => {
  it("extracts the slug from review URLs and rejects everything else", () => {
    expect(slugFromTrustpilotUrl("https://www.trustpilot.com/review/acme.com")).toBe("acme.com");
    expect(slugFromTrustpilotUrl("https://www.trustpilot.com/review/Acme.com/?page=2#x")).toBe("acme.com");
    expect(slugFromTrustpilotUrl("https://uk.trustpilot.com/review/www.acme.co.uk")).toBe("www.acme.co.uk");
    expect(slugFromTrustpilotUrl("https://www.trustpilot.com/categories/sports")).toBeNull();
    expect(slugFromTrustpilotUrl("https://www.trustpilot.com/review/")).toBeNull();
    expect(slugFromTrustpilotUrl("https://evil.com/review/acme.com")).toBeNull();
    expect(slugFromTrustpilotUrl("not a url")).toBeNull();
  });
});

describe("computeVelocity", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("AC-13.1 worked examples", () => {
    expect(computeVelocity({ snapshots: [snap(100, ago(31 * DAY))], current: 130, now })).toBe(30);
    expect(computeVelocity({ snapshots: [snap(100, ago(2 * DAY))], current: 110, now })).toBe(150);
    expect(
      computeVelocity({ snapshots: [], current: 500, now, visible: 40, oldestVisibleDate: ago(10 * DAY).toISOString() }),
    ).toBe(120);
    expect(computeVelocity({ snapshots: [], current: 500, now })).toBe(0);
  });

  it("uses the newest snapshot at least 30 days old for the delta", () => {
    const snapshots = [snap(10, ago(90 * DAY)), snap(100, ago(31 * DAY)), snap(120, ago(5 * DAY))];
    expect(computeVelocity({ snapshots, current: 130, now })).toBe(30);
  });

  it("extrapolates from the oldest snapshot at least 1 hour old and ignores fresher ones", () => {
    expect(computeVelocity({ snapshots: [snap(100, ago(10 * DAY)), snap(105, ago(3 * DAY))], current: 110, now })).toBe(30);
    expect(computeVelocity({ snapshots: [snap(100, ago(30 * 60_000))], current: 200, now })).toBe(0);
  });

  it("falls back to the rate method when the snapshot method yields 0, with a 7-day floor", () => {
    const snapshots = [snap(110, ago(31 * DAY))];
    expect(
      computeVelocity({ snapshots, current: 110, now, visible: 20, oldestVisibleDate: ago(2 * DAY).toISOString() }),
    ).toBe(Math.round((20 / 7) * 30));
  });

  it("clamps shrinking review counts to 0 and ignores bad rate inputs", () => {
    expect(computeVelocity({ snapshots: [snap(200, ago(40 * DAY))], current: 150, now })).toBe(0);
    expect(computeVelocity({ snapshots: [], current: 1, now, visible: 10, oldestVisibleDate: "not a date" })).toBe(0);
    expect(computeVelocity({ snapshots: [], current: 1, now, visible: 0, oldestVisibleDate: ago(DAY).toISOString() })).toBe(0);
  });
});

describe("scrapeTrustpilotBusiness", () => {
  it("maps every field, writes a snapshot, velocity 0 on first scrape, and qualifies", async () => {
    const fc = createFakeFirecrawl();
    const profile = makeTrustpilotProfile({
      displayName: "Acme Widgets LLC",
      websiteUrl: "https://acme.com",
      phone: "+1 (512) 555-0101",
      email: "hi@acme.com",
      locationCity: "Austin",
      locationCountry: "United States",
      categories: ["Electronics & Technology", "Computer Store"],
      numberOfReviews: 321,
      stars: 4.4,
      trustScore: 4.3,
      socialLinks: { facebook: "https://facebook.com/acme", twitter: "" },
    });
    fc.setProfile("acme.com", profile);
    const now = new Date();

    const b = await scrapeTrustpilotBusiness(db, fc, "https://www.trustpilot.com/review/acme.com", now);

    expect(fc.calls).toEqual([url("acme.com")]);
    expect(b).toMatchObject({
      source: "trustpilot",
      trustpilotId: "acme.com",
      slug: "acme.com",
      yelpId: null,
      name: "Acme Widgets LLC",
      nameNormalized: "acme widgets",
      phone: "+1 (512) 555-0101",
      phoneDigits: "15125550101",
      website: "https://acme.com",
      email: "hi@acme.com",
      city: "Austin",
      country: "United States",
      primaryCategory: "Electronics & Technology",
      subcategory: "Computer Store",
      categories: [
        { alias: "electronics_technology", title: "Electronics & Technology" },
        { alias: "computer_store", title: "Computer Store" },
      ],
      rating: "4.4",
      reviewCount: 321,
      trustScore: "4.3",
      socialLinks: { facebook: "https://facebook.com/acme" },
      logoUrl:
        "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://acme.com&size=128",
      reviewsLast30d: 0,
    });
    expect(b.raw).toMatchObject({ displayName: "Acme Widgets LLC", numberOfReviews: 321 });
    expect(b.lastScrapedAt?.getTime()).toBe(now.getTime());
    expect(b.qualifiedAt).not.toBeNull();
    const snaps = await listSnapshots(db, b.id);
    expect(snaps.map((s) => s.totalReviews)).toEqual([321]);
  });

  it("uses the rate method on the first scrape when the page shows recent reviews", async () => {
    const fc = createFakeFirecrawl();
    const now = new Date();
    fc.setProfile(
      "fast.com",
      makeTrustpilotProfile({
        numberOfVisibleReviews: 40,
        oldestVisibleReviewDate: new Date(now.getTime() - 10 * DAY).toISOString(),
      }),
    );
    const b = await scrapeTrustpilotBusiness(db, fc, url("fast.com"), now);
    expect(b.reviewsLast30d).toBe(120);
  });

  it("creates relations only to slugs that already exist, never to itself", async () => {
    const { business: existing } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "known.com" }));
    const fc = createFakeFirecrawl();
    fc.setProfile(
      "acme.com",
      makeTrustpilotProfile({
        relatedBusinessSlugs: ["known.com", "/review/known.com/", "unknown.com", "acme.com", ""],
      }),
    );
    const b = await scrapeTrustpilotBusiness(db, fc, url("acme.com"));
    const related = await relatedBusinesses(db, b.id);
    expect(related.map((r) => r.id)).toEqual([existing.id]);
    expect(await getBusinessByTrustpilotId(db, "unknown.com")).toBeNull();
    const [{ n }] = await db.select({ n: count() }).from(businesses);
    expect(n).toBe(2);
  });

  it("AC-13.2 rescrape keeps CRM fields, adds a second snapshot, and computes velocity from the first", async () => {
    const fc = createFakeFirecrawl();
    fc.setProfile("acme.com", makeTrustpilotProfile({ numberOfReviews: 100 }));
    const t1 = new Date(Date.now() - 2 * DAY);
    const first = await scrapeTrustpilotBusiness(db, fc, url("acme.com"), t1);
    await updateBusinessCrm(db, first.id, {
      status: "contacted",
      ownerEmail: "rep@example.com",
      notes: "Call after lunch",
      tags: ["vip"],
      doNotCall: true,
    });

    fc.setProfile("acme.com", makeTrustpilotProfile({ displayName: "Acme Renamed", numberOfReviews: 110, phone: undefined }));
    const second = await scrapeTrustpilotBusiness(db, fc, url("acme.com"), new Date());

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      status: "contacted",
      ownerEmail: "rep@example.com",
      notes: "Call after lunch",
      tags: ["vip"],
      doNotCall: true,
      name: "Acme Renamed",
      reviewCount: 110,
      phone: first.phone, // absent on the page → kept
      reviewsLast30d: 150, // (110 - 100) / 2 days * 30
    });
    expect((await listSnapshots(db, first.id)).map((s) => s.totalReviews)).toEqual([100, 110]);
  });

  it("rejects non-Trustpilot URLs before calling Firecrawl and fails on an empty extract", async () => {
    const fc = createFakeFirecrawl();
    await expect(scrapeTrustpilotBusiness(db, fc, "https://acme.com")).rejects.toThrow(/Not a Trustpilot review URL/);
    expect(fc.calls).toEqual([]);
    fc.set(url("empty.com"), null);
    await expect(scrapeTrustpilotBusiness(db, fc, url("empty.com"))).rejects.toThrow(/no data/);
    expect(await getBusinessByTrustpilotId(db, "empty.com")).toBeNull();
  });
});

describe("scrapeTrustpilotCategory", () => {
  const cards = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => makeCategoryCard(`biz${from + i}.com`, { numberOfReviews: from + i }));

  it("AC-13.3 two pages of 20 insert 40 basic rows with lastScrapedAt null", async () => {
    const fc = createFakeFirecrawl();
    fc.setCategoryPage("sports", 1, cards(1, 20));
    fc.setCategoryPage("sports", 2, cards(21, 20));

    const res = await scrapeTrustpilotCategory(db, fc, "sports", { max: 40 });

    expect(res).toEqual({ inserted: 40, seen: 40 });
    expect(fc.calls).toEqual([trustpilotCategoryUrl("sports"), `${trustpilotCategoryUrl("sports")}?page=2`]);
    const rows = await db.select().from(businesses);
    expect(rows).toHaveLength(40);
    for (const r of rows) {
      expect(r.source).toBe("trustpilot");
      expect(r.lastScrapedAt).toBeNull();
      expect(r.categories).toEqual([{ alias: "sports", title: "Sports" }]);
    }
    const one = rows.find((r) => r.trustpilotId === "biz7.com")!;
    expect(one).toMatchObject({ name: "Listed biz7.com", slug: "biz7.com", rating: "4.1", reviewCount: 7, country: "United States" });
    expect(one.logoUrl).toContain("url=https://biz7.com&size=128");
  });

  it("dedupes slugs across pages, skips existing slugs untouched, and caps at max", async () => {
    const { business: existing } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "biz3.com", name: "Already Here", reviewCount: 999 }),
    );
    const fc = createFakeFirecrawl();
    fc.setCategoryPage("sports", 1, [...cards(1, 5), makeCategoryCard("/review/BIZ2.com/"), { name: "no slug" }]);
    fc.setCategoryPage("sports", 2, cards(4, 30));

    const res = await scrapeTrustpilotCategory(db, fc, "sports", { max: 25, limiter: new RateLimiter(1, 0) });

    expect(res.seen).toBe(25);
    expect(res.inserted).toBe(24); // biz3.com existed
    const kept = await getBusiness(db, existing.id);
    expect(kept).toMatchObject({ name: "Already Here", reviewCount: 999 });
    expect(fc.calls).toHaveLength(2);
  });

  it("stops at the first empty page", async () => {
    const fc = createFakeFirecrawl();
    fc.setCategoryPage("sports", 1, cards(1, 3));
    fc.setCategoryPage("sports", 2, []);
    expect(await scrapeTrustpilotCategory(db, fc, "sports", { max: 60 })).toEqual({ inserted: 3, seen: 3 });
    expect(fc.calls).toHaveLength(2);
  });
});

describe("enrichFromWebsite", () => {
  it("fills missing phone/email, merges social links, and stamps enrichedAt", async () => {
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "acme.com", website: "https://acme.com", phone: null, socialLinks: { facebook: "fb" } }),
    );
    const fc = createFakeFirecrawl({
      "https://acme.com": { phone: "512-555-0199", email: "sales@acme.com", socialLinks: { linkedin: "li" } },
    });
    const b = await enrichFromWebsite(db, fc, business.id);
    expect(b).toMatchObject({
      phone: "512-555-0199",
      phoneDigits: "5125550199",
      email: "sales@acme.com",
      socialLinks: { facebook: "fb", linkedin: "li" },
    });
    expect(b.enrichedAt).not.toBeNull();
  });

  it("never overwrites an existing phone and refuses rows without a website", async () => {
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "acme.com", website: "https://acme.com", phone: "111" }),
    );
    const fc = createFakeFirecrawl({ "https://acme.com": { phone: "222" } });
    expect((await enrichFromWebsite(db, fc, business.id)).phone).toBe("111");

    const { business: bare } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "bare.com", website: null }));
    await expect(enrichFromWebsite(db, fc, bare.id)).rejects.toThrow(/no website/);
  });
});

describe("syncStale", () => {
  async function seedRow(slug: string, lastScrapedAt: Date | null) {
    const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: slug, lastScrapedAt }));
    return business;
  }

  it("AC-13.4 picks never-scraped first, then oldest, and respects limit", async () => {
    const now = Date.now();
    await seedRow("fresh.com", new Date(now - 2 * HOUR));
    await seedRow("old.com", new Date(now - 10 * DAY));
    await seedRow("older.com", new Date(now - 20 * DAY));
    await seedRow("never.com", null);
    const fc = createFakeFirecrawl();
    for (const s of ["fresh.com", "old.com", "older.com", "never.com"]) fc.setProfile(s, makeTrustpilotProfile());

    const res = await syncStale(db, fc, { limit: 2, budgetMs: 60_000 });

    expect(fc.calls).toEqual([url("never.com"), url("older.com")]);
    expect(res).toEqual({ scraped: 2, failed: 0, remaining: 1 });
    expect((await getBusinessByTrustpilotId(db, "never.com"))!.lastScrapedAt).not.toBeNull();
  });

  it("stops starting scrapes once the budget is spent", async () => {
    for (const s of ["a.com", "b.com", "c.com", "d.com"]) await seedRow(s, null);
    let clock = 1_000_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const fc = createFakeFirecrawl({}, { onCall: () => void (clock += 20_000) });
    for (const s of ["a.com", "b.com", "c.com", "d.com"]) fc.setProfile(s, makeTrustpilotProfile());

    const res = await syncStale(db, fc, { limit: 12, budgetMs: 30_000, now: new Date() });

    expect(fc.calls).toHaveLength(2); // starts at 0 s and 20 s; 40 s is over budget
    expect(res.scraped).toBe(2);
    expect(res.remaining).toBe(2);
  });

  it("counts per-row failures and keeps going; ignores Yelp rows", async () => {
    await seedRow("bad.com", null);
    await seedRow("good.com", new Date(Date.now() - 5 * DAY));
    const { upsertBusinessByYelpId } = await import("@/db/repo/businesses");
    const { makeBusinessRow } = await import("./helpers/builders");
    await upsertBusinessByYelpId(db, makeBusinessRow());
    const fc = createFakeFirecrawl();
    fc.setProfile("bad.com", new Error("boom"));
    fc.setProfile("good.com", makeTrustpilotProfile());

    expect(await syncStale(db, fc, { limit: 12, budgetMs: 60_000 })).toEqual({ scraped: 1, failed: 1, remaining: 1 });
  });
});

describe("DiscoveryUnavailable", () => {
  it("the client without a key rejects on use; every entry point propagates it", async () => {
    const fc = createFirecrawl(undefined);
    await expect(fc.scrapeJson("https://x", {})).rejects.toBeInstanceOf(DiscoveryUnavailable);
    await expect(createFirecrawl("  ").scrapeJson("https://x", {})).rejects.toThrow("FIRECRAWL_API_KEY is not set");

    await expect(scrapeTrustpilotBusiness(db, fc, url("acme.com"))).rejects.toBeInstanceOf(DiscoveryUnavailable);
    await expect(scrapeTrustpilotCategory(db, fc, "sports", { max: 20 })).rejects.toBeInstanceOf(DiscoveryUnavailable);
    const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "acme.com" }));
    await expect(enrichFromWebsite(db, fc, business.id)).rejects.toBeInstanceOf(DiscoveryUnavailable);
    await expect(syncStale(db, fc, { limit: 5, budgetMs: 1000 })).rejects.toBeInstanceOf(DiscoveryUnavailable);
    const [{ n }] = await db.select({ n: count() }).from(businesses).where(eq(businesses.source, "trustpilot"));
    expect(n).toBe(1);
  });
});

describe("RateLimiter", () => {
  it("runs one at a time with the delay between calls and propagates errors", async () => {
    const limiter = new RateLimiter(1, 30);
    let active = 0;
    let maxActive = 0;
    const starts: number[] = [];
    const task = (fail = false) => async () => {
      starts.push(performance.now());
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      if (fail) throw new Error("nope");
      return starts.length;
    };
    const results = await Promise.allSettled([limiter.run(task()), limiter.run(task(true)), limiter.run(task())]);
    expect(maxActive).toBe(1);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(30);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(30);
  });
});

describe("TRUSTPILOT_CATEGORIES", () => {
  it("has the 22 gtm categories with unique slugs", () => {
    expect(TRUSTPILOT_CATEGORIES).toHaveLength(22);
    expect(new Set(TRUSTPILOT_CATEGORIES.map((c) => c.slug)).size).toBe(22);
  });
});

describe("velocity over stored snapshots", () => {
  it("a 31-day-old stored snapshot drives the next scrape's velocity", async () => {
    const fc = createFakeFirecrawl();
    fc.setProfile("acme.com", makeTrustpilotProfile({ numberOfReviews: 130 }));
    const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "acme.com" }));
    await addSnapshot(db, business.id, 100, new Date(Date.now() - 31 * DAY));
    expect((await scrapeTrustpilotBusiness(db, fc, url("acme.com"))).reviewsLast30d).toBe(30);
  });
});
