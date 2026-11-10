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
import { SdkError } from "@mendable/firecrawl-js";
import {
  DEFAULT_RETRY_AFTER_MS,
  DiscoveryUnavailable,
  FirecrawlRateLimited,
  createFirecrawl,
  rateLimitFrom,
  requestPacer,
  resetRequestPacer,
} from "@/lib/firecrawl/client";
import { enrichBusinessLinks } from "@/lib/firecrawl/enrich";
import { RateLimiter, WindowLimiter } from "@/lib/firecrawl/rate-limiter";
import {
  computeVelocity,
  scrapeTrustpilotBusiness,
  scrapeTrustpilotCategory,
  slugFromTrustpilotUrl,
  syncStale,
} from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES, trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { makeTrustpilotProfile, makeTrustpilotRow } from "./helpers/builders";
import { createFakeFirecrawl, makeCategoryCard } from "./helpers/fake-firecrawl";

// The real client is exercised against a stubbed SDK (never the network).
const sdkScrape = vi.hoisted(() => vi.fn());
vi.mock("@mendable/firecrawl-js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@mendable/firecrawl-js")>();
  class FakeSdk {
    scrape = sdkScrape;
  }
  return { ...real, default: FakeSdk, Firecrawl: FakeSdk };
});

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
  vi.useRealTimers();
  vi.unstubAllEnvs();
  sdkScrape.mockReset();
  resetRequestPacer();
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
      primaryCategory: "electronics_technology",
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

    expect(res).toMatchObject({ inserted: 40, seen: 40 });
    expect(res.insertedIds).toHaveLength(40);
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
    expect(await scrapeTrustpilotCategory(db, fc, "sports", { max: 60 })).toMatchObject({ inserted: 3, seen: 3 });
    expect(fc.calls).toHaveLength(2);
  });
});

describe("WP-17 website at scrape time", () => {
  it("AC-17.5 seeded rows get https://<slug> for domain-like slugs and the result lists insertedIds", async () => {
    const { business: existing } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "old.com" }));
    const fc = createFakeFirecrawl();
    fc.setCategoryPage("sports", 1, [makeCategoryCard("acme.com"), makeCategoryCard("www.shop.co.uk"), makeCategoryCard("nodot"), makeCategoryCard("old.com")]);
    fc.setCategoryPage("sports", 2, []);

    const res = await scrapeTrustpilotCategory(db, fc, "sports", { max: 40 });

    const acme = (await getBusinessByTrustpilotId(db, "acme.com"))!;
    const shop = (await getBusinessByTrustpilotId(db, "www.shop.co.uk"))!;
    const nodot = (await getBusinessByTrustpilotId(db, "nodot"))!;
    expect(acme.website).toBe("https://acme.com");
    expect(shop.website).toBe("https://www.shop.co.uk");
    expect(nodot.website).toBeNull();
    expect(res).toEqual({ inserted: 3, seen: 4, insertedIds: [acme.id, shop.id, nodot.id] });
    expect(res.insertedIds).not.toContain(existing.id);
  });

  it("a profile scrape stores the website without Trustpilot tracking parameters", async () => {
    const fc = createFakeFirecrawl();
    fc.setProfile(
      "acme.com",
      makeTrustpilotProfile({
        websiteUrl: "http://www.acme.com/?utm_medium=company_profile&utm_source=trustpilot&utm_campaign=domain_click#top",
      }),
    );
    expect((await scrapeTrustpilotBusiness(db, fc, url("acme.com"))).website).toBe("http://www.acme.com");
  });

  it("falls back to https://<slug> when the profile has no website, but keeps a stored one", async () => {
    const fc = createFakeFirecrawl();
    fc.setProfile("bare.com", makeTrustpilotProfile({ websiteUrl: undefined }));
    expect((await scrapeTrustpilotBusiness(db, fc, url("bare.com"))).website).toBe("https://bare.com");

    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "kept.com", website: "https://shop.kept.com" }));
    fc.setProfile("kept.com", makeTrustpilotProfile({ websiteUrl: "" }));
    expect((await scrapeTrustpilotBusiness(db, fc, url("kept.com"))).website).toBe("https://shop.kept.com");
  });

  it("keeps only valid profile social links from the extract, X under twitter", async () => {
    const fc = createFakeFirecrawl();
    fc.setProfile(
      "acme.com",
      makeTrustpilotProfile({
        socialLinks: {
          facebook: "https://www.facebook.com/sharer/sharer.php?u=x",
          twitter: "https://x.com/acme",
          linkedin: "javascript:alert(1)",
          instagram: "https://instagram.com.evil.test/acme",
        },
      }),
    );
    expect((await scrapeTrustpilotBusiness(db, fc, url("acme.com"))).socialLinks).toEqual({ twitter: "https://x.com/acme" });
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

    // The failed row enters its back-off window, so it no longer counts as remaining.
    expect(await syncStale(db, fc, { limit: 12, budgetMs: 60_000 })).toEqual({ scraped: 1, failed: 1, remaining: 0 });
    const bad = await getBusinessByTrustpilotId(db, "bad.com");
    expect(bad?.scrapeAttempts).toBe(1);
    expect(bad?.scrapeFailedAt).toBeInstanceOf(Date);
  });

  it("WP-16 C: a failure increments attempts and backs off; a later success resets both", async () => {
    const t0 = new Date("2026-11-01T12:00:00Z");
    await seedRow("flaky.com", null);
    const fc = createFakeFirecrawl();
    fc.setProfile("flaky.com", new Error("boom"));
    expect(await syncStale(db, fc, { limit: 5, budgetMs: 60_000, now: t0 })).toMatchObject({ scraped: 0, failed: 1 });
    // Inside the 24 h window: not picked.
    expect(await syncStale(db, fc, { limit: 5, budgetMs: 60_000, now: new Date(t0.getTime() + 23 * HOUR) })).toEqual({
      scraped: 0,
      failed: 0,
      remaining: 0,
    });
    // After 25 h it is retried and fails again: attempts 2 → 48 h window.
    const t1 = new Date(t0.getTime() + 25 * HOUR);
    expect(await syncStale(db, fc, { limit: 5, budgetMs: 60_000, now: t1 })).toMatchObject({ failed: 1 });
    expect((await getBusinessByTrustpilotId(db, "flaky.com"))?.scrapeAttempts).toBe(2);
    expect(await syncStale(db, fc, { limit: 5, budgetMs: 60_000, now: new Date(t1.getTime() + 47 * HOUR) })).toMatchObject({ failed: 0, scraped: 0 });
    // Now it succeeds: back-off cleared.
    fc.setProfile("flaky.com", makeTrustpilotProfile());
    expect(await syncStale(db, fc, { limit: 5, budgetMs: 60_000, now: new Date(t1.getTime() + 49 * HOUR) })).toMatchObject({ scraped: 1, failed: 0 });
    const ok = await getBusinessByTrustpilotId(db, "flaky.com");
    expect(ok?.scrapeAttempts).toBe(0);
    expect(ok?.scrapeFailedAt).toBeNull();
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
    await expect(enrichBusinessLinks(db, fc, business.id)).rejects.toBeInstanceOf(DiscoveryUnavailable);
    await expect(fc.scrapePage("https://acme.com")).rejects.toBeInstanceOf(DiscoveryUnavailable);
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

// ------------------------------------------------------------ WP-17 round 1: rate limit

/** A manual clock whose timers fire when time is advanced past them. */
function manualClock(start = 0) {
  let t = start;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => void timers.push({ at: t + ms, fn }),
    advance(ms: number) {
      t += ms;
      for (const timer of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn();
      }
    },
    pendingTimers: () => timers.length,
  };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

describe("AC-17.13 WindowLimiter: request starts per rolling 60 s", () => {
  it("lets 10 starts through at once and makes the 11th wait for the window", async () => {
    const clock = manualClock(1_000);
    const limiter = new WindowLimiter(10, 60_000, clock);
    const started: number[] = [];
    for (let i = 0; i < 12; i++) void limiter.acquire().then(() => started.push(i));
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    clock.advance(59_999);
    await flush();
    expect(started).toHaveLength(10); // still inside the window

    clock.advance(1); // the first start leaves the window
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(limiter.inWindow()).toBe(2);
  });

  it("is rolling, not fixed: starts spread over the minute free up one by one", async () => {
    const clock = manualClock(0);
    const limiter = new WindowLimiter(2, 60_000, clock);
    await limiter.acquire(); // t=0
    clock.advance(30_000);
    await limiter.acquire(); // t=30 s
    let third = false;
    void limiter.acquire().then(() => (third = true));
    await flush();
    expect(third).toBe(false);
    clock.advance(30_000); // t=60 s: the t=0 start has left
    await flush();
    expect(third).toBe(true);
    expect(clock.pendingTimers()).toBe(0);
  });

  it("rejects bad settings", () => {
    expect(() => new WindowLimiter(0, 60_000)).toThrow(RangeError);
    expect(() => new WindowLimiter(1, 0)).toThrow(RangeError);
  });

  it("FIRECRAWL_REQUESTS_PER_MINUTE defaults to 10, floors at 1", async () => {
    const { env } = await import("@/lib/env");
    expect(env.FIRECRAWL_REQUESTS_PER_MINUTE).toBe(10);
    vi.stubEnv("FIRECRAWL_REQUESTS_PER_MINUTE", "25");
    expect(env.FIRECRAWL_REQUESTS_PER_MINUTE).toBe(25);
    vi.stubEnv("FIRECRAWL_REQUESTS_PER_MINUTE", "0");
    expect(env.FIRECRAWL_REQUESTS_PER_MINUTE).toBe(1);
    vi.stubEnv("FIRECRAWL_REQUESTS_PER_MINUTE", "lots");
    expect(env.FIRECRAWL_REQUESTS_PER_MINUTE).toBe(10);
  });

  it("the real client paces scrapePage and scrapeJson through one shared window", async () => {
    vi.useFakeTimers();
    const pacer = requestPacer();
    expect(pacer.maxStarts).toBe(10);
    expect(pacer.windowMs).toBe(60_000);
    // Fill the window with 9 starts so the 10th request of the test is the last allowed.
    for (let i = 0; i < 9; i++) await pacer.acquire();
    sdkScrape.mockResolvedValue({ links: ["https://www.facebook.com/acme"], metadata: { statusCode: 200 } });
    const fc = createFirecrawl("fc-test");

    const first = fc.scrapePage("https://acme.com");
    const second = fc.scrapeJson("https://www.trustpilot.com/review/acme.com", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(sdkScrape).toHaveBeenCalledTimes(1); // 10th start went through; the 11th waits
    expect(await first).toMatchObject({ links: ["https://www.facebook.com/acme"] });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sdkScrape).toHaveBeenCalledTimes(2);
    await second;
    // Let the Trustpilot limiter's 1.5 s gap elapse so its slot is free for later tests.
    await vi.advanceTimersByTimeAsync(2_000);
  });
});

describe("AC-17.14 HTTP 429 maps to FirecrawlRateLimited", () => {
  const LIVE_MESSAGE =
    "Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0. Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits or please retry after 50s, resets at Tue Nov 10 2026 02:14:32 GMT+0000 (Coordinated Universal Time)";

  it("reads retry_after_seconds from the SdkError body (shape observed live on 2026-11-09)", () => {
    const err = new SdkError(LIVE_MESSAGE, 429, "ERR_BAD_REQUEST", { success: false, error: LIVE_MESSAGE, retry_after_seconds: 50 });
    const mapped = rateLimitFrom(err);
    expect(mapped).toBeInstanceOf(FirecrawlRateLimited);
    expect(mapped?.retryAfterMs).toBe(50_000);
    expect(mapped?.message).toBe("Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0");
  });

  it("prefers a Retry-After header, else 60 s; the status decides, not the text", () => {
    expect(rateLimitFrom({ status: 429, response: { status: 429, headers: { "retry-after": "58" } } })?.retryAfterMs).toBe(58_000);
    expect(rateLimitFrom(new SdkError("Too many", 429))?.retryAfterMs).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(rateLimitFrom(new SdkError(LIVE_MESSAGE, 500))).toBeNull();
    expect(rateLimitFrom(new SdkError("Payment required", 402))).toBeNull();
    // No status at all: the text is the only signal.
    expect(rateLimitFrom(new Error("Rate limit exceeded. please retry after 7s"))?.retryAfterMs).toBe(7_000);
    expect(rateLimitFrom(new Error("boom"))).toBeNull();
    expect(rateLimitFrom(new DiscoveryUnavailable())).toBeNull();
    expect(rateLimitFrom(null)).toBeNull();
  });

  it("both seam methods reject with FirecrawlRateLimited on a 429", async () => {
    sdkScrape.mockRejectedValue(new SdkError(LIVE_MESSAGE, 429, "ERR_BAD_REQUEST", { retry_after_seconds: 12 }));
    const fc = createFirecrawl("fc-test");
    await expect(fc.scrapePage("https://ratelimited-a.com")).rejects.toMatchObject({ name: "FirecrawlRateLimited", retryAfterMs: 12_000 });
    await expect(fc.scrapeJson("https://www.trustpilot.com/review/x.com", {})).rejects.toBeInstanceOf(FirecrawlRateLimited);
    sdkScrape.mockRejectedValue(new SdkError("Bad gateway", 502));
    await expect(fc.scrapePage("https://ratelimited-b.com")).rejects.not.toBeInstanceOf(FirecrawlRateLimited);
  });
});

describe("AC-17.17 syncStale stops on a rate limit", () => {
  it("stops at the rate-limited row without recording a failure against it", async () => {
    for (const s of ["a.com", "b.com", "c.com"]) {
      await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: s, lastScrapedAt: null }));
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fc = createFakeFirecrawl();
    fc.setProfile("a.com", makeTrustpilotProfile());
    fc.setProfile("b.com", new FirecrawlRateLimited(30_000));
    fc.setProfile("c.com", makeTrustpilotProfile());

    const res = await syncStale(db, fc, { limit: 12, budgetMs: 60_000 });

    expect(fc.calls).toEqual([url("a.com"), url("b.com")]);
    expect(res).toEqual({ scraped: 1, failed: 0, remaining: 2 });
    const b = await getBusinessByTrustpilotId(db, "b.com");
    expect(b).toMatchObject({ scrapeAttempts: 0, scrapeFailedAt: null, lastScrapedAt: null });
  });
});
