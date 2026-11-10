import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness, updateBusinessCrm } from "@/db/repo/businesses";
import { countPendingLinks, upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { type Business, businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { DiscoveryUnavailable, FirecrawlRateLimited } from "@/lib/firecrawl/client";
import { EnrichTimeout, enrichBusinessLinks, enrichPendingLinks, resolveExternalLinks } from "@/lib/firecrawl/enrich";
import { socialLink } from "@/features/lookup/links";
import { toLookupBusiness } from "@/features/lookup/types";
import { makeTrustpilotRow } from "./helpers/builders";
import { createFakeFirecrawl, makeSitePage } from "./helpers/fake-firecrawl";

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
  vi.restoreAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const DAY = 86_400_000;

async function row(slug: string, overrides: Parameters<typeof makeTrustpilotRow>[0] = {}): Promise<Business> {
  const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: slug, ...overrides }));
  return business;
}

/** Sets createdAt / enrichedAt directly (the repos stamp them). */
async function stamp(id: string, set: { createdAt?: Date; enrichedAt?: Date | null }) {
  await db.update(businesses).set(set).where(eq(businesses.id, id));
}

describe("resolveExternalLinks", () => {
  it("returns null without a usable website or domain-like slug", async () => {
    const fc = createFakeFirecrawl();
    expect(await resolveExternalLinks(fc, { website: null, slug: "nodot" })).toBeNull();
    expect(await resolveExternalLinks(fc, { website: "javascript:alert(1)", slug: null })).toBeNull();
    expect(fc.pageCalls).toEqual([]);
  });

  it("cleans the stored website before scraping and falls back to https://<slug>", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("http://www.acme.com", { links: ["https://www.facebook.com/acme"] });
    fc.setSite("https://slug.com", { links: [], markdown: "hi" });
    expect(await resolveExternalLinks(fc, { website: "http://www.acme.com/?utm_source=trustpilot", slug: "acme.com" })).toEqual({
      website: "http://www.acme.com",
      socialLinks: { facebook: "https://www.facebook.com/acme" },
      email: null,
      phone: null,
    });
    expect((await resolveExternalLinks(fc, { website: null, slug: "slug.com" }))?.website).toBe("https://slug.com");
    expect(fc.pageCalls).toEqual(["http://www.acme.com", "https://slug.com"]);
  });

  it("uses the final URL's origin and scrapes ONE contact page when email or phone is missing", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://old.com", {
      finalUrl: "https://www.new.com/",
      links: [
        "https://www.new.com/about-us",
        "https://www.new.com/pages/contact-us",
        "https://www.new.com/support",
        "https://www.instagram.com/newco",
      ],
    });
    fc.setSite("https://www.new.com/pages/contact-us", {
      links: ["mailto:Sales@New.com?subject=Hi", "tel:+1 (512) 555-0199", "https://www.facebook.com/newco", "https://www.instagram.com/other"],
    });
    expect(await resolveExternalLinks(fc, { website: "https://old.com", slug: null })).toEqual({
      website: "https://www.new.com",
      socialLinks: { facebook: "https://www.facebook.com/newco", instagram: "https://www.instagram.com/newco" },
      email: "sales@new.com",
      phone: "+1 (512) 555-0199",
    });
    expect(fc.pageCalls).toEqual(["https://old.com", "https://www.new.com/pages/contact-us"]);
  });

  it("a failing contact page keeps what the homepage gave; a failing homepage rejects", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://acme.com", { links: ["https://acme.com/contact", "https://twitter.com/acme"] });
    fc.setSite("https://acme.com/contact", new Error("HTTP 500"));
    expect((await resolveExternalLinks(fc, { website: "https://acme.com", slug: null }))?.socialLinks).toEqual({
      twitter: "https://twitter.com/acme",
    });
    fc.setSite("https://down.com", new Error("HTTP 502"));
    await expect(resolveExternalLinks(fc, { website: "https://down.com", slug: null })).rejects.toThrow("HTTP 502");
  });

  it("times out a hanging homepage", async () => {
    const fc = createFakeFirecrawl({}, { onPage: () => new Promise(() => {}) });
    await expect(resolveExternalLinks(fc, { website: "https://slow.com", slug: null }, { timeoutMs: 30 })).rejects.toThrow(/timed out/);
  });
});

describe("AC-17.7 enrichBusinessLinks write rules", () => {
  it("never overwrites phone or email, merges socialLinks, leaves CRM fields, stamps enrichedAt", async () => {
    const b = await row("acme.com", {
      website: "https://acme.com",
      phone: "111-222-3333",
      phoneDigits: "1112223333",
      email: "owner@acme.com",
      socialLinks: { facebook: "https://www.facebook.com/old", pinterest: "https://pinterest.com/acme" },
    });
    await updateBusinessCrm(db, b.id, { status: "contacted", ownerEmail: "rep@example.com", notes: "n", tags: ["vip"], doNotCall: true });
    const before = (await getBusiness(db, b.id))!;
    const fc = createFakeFirecrawl();
    fc.setSite("https://acme.com", makeSitePage("https://acme.com"));
    const now = new Date("2026-11-09T12:00:00Z");

    const { status, business } = await enrichBusinessLinks(db, fc, b.id, { now });

    expect(status).toBe("enriched");
    expect(business).toMatchObject({
      phone: "111-222-3333",
      phoneDigits: "1112223333",
      email: "owner@acme.com",
      website: "https://acme.com",
      socialLinks: {
        facebook: "https://www.facebook.com/acme",
        pinterest: "https://pinterest.com/acme",
        twitter: "https://twitter.com/acme",
        linkedin: "https://www.linkedin.com/company/acme",
        instagram: "https://www.instagram.com/acme",
      },
      status: "contacted",
      ownerEmail: "rep@example.com",
      notes: "n",
      tags: ["vip"],
      doNotCall: true,
      lastScrapedAt: before.lastScrapedAt,
      scrapeAttempts: before.scrapeAttempts,
      scrapeFailedAt: before.scrapeFailedAt,
    });
    expect(business.enrichedAt?.toISOString()).toBe(now.toISOString());
  });

  it("fills empty phone, phoneDigits and email; sets an empty website from the final origin", async () => {
    const b = await row("fill.com", { website: null, phone: null, phoneDigits: null, email: null });
    const fc = createFakeFirecrawl();
    fc.setSite("https://fill.com", { ...makeSitePage("https://www.fill.com"), finalUrl: "https://www.fill.com/" });
    const { status, business } = await enrichBusinessLinks(db, fc, b.id);
    expect(status).toBe("enriched");
    expect(business).toMatchObject({
      website: "https://www.fill.com",
      phone: "+1-512-555-0142",
      phoneDigits: "15125550142",
      email: "hello@fill.com",
    });
  });

  it("replaces a stored website only by its own cleaned form", async () => {
    const b = await row("utm.com", { website: "https://utm.com/?utm_medium=company_profile&utm_source=trustpilot" });
    const fc = createFakeFirecrawl();
    fc.setSite("https://utm.com", { finalUrl: "https://elsewhere.com/", links: [], markdown: "x" });
    const { status, business } = await enrichBusinessLinks(db, fc, b.id);
    expect(status).toBe("empty");
    expect(business.website).toBe("https://utm.com");
  });

  it("stamps enrichedAt on empty and failed; failed keeps every link column", async () => {
    const empty = await row("empty.com", { website: "https://empty.com" });
    const failed = await row("failed.com", { website: "https://failed.com", email: null, socialLinks: { facebook: "https://www.facebook.com/f" } });
    const fc = createFakeFirecrawl();
    fc.setSite("https://empty.com", null);
    fc.setSite("https://failed.com", new Error("HTTP 503"));

    const e = await enrichBusinessLinks(db, fc, empty.id);
    const f = await enrichBusinessLinks(db, fc, failed.id);

    expect(e.status).toBe("empty");
    expect(e.business.enrichedAt).toBeInstanceOf(Date);
    expect(f.status).toBe("failed");
    expect(f.business.enrichedAt).toBeInstanceOf(Date);
    expect(f.business).toMatchObject({ website: "https://failed.com", email: null, socialLinks: { facebook: "https://www.facebook.com/f" } });
  });

  it("skips (writes nothing) without a website or domain-like slug; propagates DiscoveryUnavailable", async () => {
    const bare = await row("nodot", { slug: "nodot", website: null });
    const fc = createFakeFirecrawl();
    const res = await enrichBusinessLinks(db, fc, bare.id);
    expect(res.status).toBe("skipped");
    expect(res.business.enrichedAt).toBeNull();
    expect(fc.pageCalls).toEqual([]);

    const b = await row("acme.com", { website: "https://acme.com" });
    vi.spyOn(fc, "scrapePage").mockRejectedValue(new DiscoveryUnavailable());
    await expect(enrichBusinessLinks(db, fc, b.id)).rejects.toBeInstanceOf(DiscoveryUnavailable);
    expect((await getBusiness(db, b.id))!.enrichedAt).toBeNull();
  });

  it("a stored website that is not a URL, with no domain slug, is stamped failed so it is not retried forever", async () => {
    const b = await row("junk", { slug: "junk", website: "n/a" });
    const fc = createFakeFirecrawl();
    const res = await enrichBusinessLinks(db, fc, b.id);
    expect(res.status).toBe("failed");
    expect(res.business.enrichedAt).toBeInstanceOf(Date);
    expect(fc.pageCalls).toEqual([]);
  });
});

describe("AC-17.6 enrichPendingLinks", () => {
  /** Rows: never-enriched (two, by createdAt), stale-empty, fresh-empty, stale-with-links, no target. */
  async function seedBacklog() {
    const now = Date.now();
    const newer = await row("newer.com");
    const older = await row("older.com");
    await stamp(older.id, { createdAt: new Date(now - 5 * DAY) });
    await stamp(newer.id, { createdAt: new Date(now - 1 * DAY) });
    const stale = await row("stale.com", { socialLinks: {} });
    await stamp(stale.id, { enrichedAt: new Date(now - 8 * DAY) });
    const fresh = await row("fresh.com", { socialLinks: {} });
    await stamp(fresh.id, { enrichedAt: new Date(now - 2 * DAY) });
    const done = await row("done.com", { socialLinks: { facebook: "https://www.facebook.com/done" } });
    await stamp(done.id, { enrichedAt: new Date(now - 30 * DAY) });
    await row("nodot", { slug: "nodot", website: null });
    const given = await row("given.com");
    await stamp(given.id, { createdAt: new Date(now - 1000) });
    const fc = createFakeFirecrawl();
    for (const s of ["newer.com", "older.com", "stale.com", "fresh.com", "done.com", "given.com"]) {
      fc.setSite(`https://${s}`, makeSitePage(`https://${s}`));
    }
    return { fc, newer, older, stale, given, done };
  }

  it("handles ids first, then never-enriched oldest first, then stale-empty; counts add up", async () => {
    const { fc, done } = await seedBacklog();
    const pendingBefore = await countPendingLinks(db);
    expect(pendingBefore).toBe(4); // newer, older, stale, given

    const given = (await db.select().from(businesses).where(eq(businesses.trustpilotId, "given.com")))[0];
    const res = await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000, ids: [given.id, done.id], concurrency: 1 });

    // done.com is not pending, so its id is ignored.
    expect(fc.pageCalls).toEqual(["https://given.com", "https://older.com", "https://newer.com", "https://stale.com"]);
    expect(res).toEqual({ enriched: 4, empty: 0, failed: 0, remaining: 0, rateLimited: false });
  });

  it("respects limit and reports what is still pending", async () => {
    const { fc } = await seedBacklog();
    const res = await enrichPendingLinks(db, fc, { limit: 2, budgetMs: 60_000, concurrency: 1 });
    expect(fc.pageCalls).toEqual(["https://older.com", "https://newer.com"]);
    expect(res).toEqual({ enriched: 2, empty: 0, failed: 0, remaining: 2, rateLimited: false });
  });

  it("starts no scrape after budgetMs on the injected clock", async () => {
    for (const s of ["a.com", "b.com", "c.com", "d.com", "e.com"]) await row(s);
    let clock = 1_000_000;
    const fc = createFakeFirecrawl({}, { onPage: () => void (clock += 20_000) });
    for (const s of ["a.com", "b.com", "c.com", "d.com", "e.com"]) fc.setSite(`https://${s}`, { links: [], markdown: "x" });

    const res = await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 50_000, concurrency: 1, now: () => clock });

    expect(fc.pageCalls).toHaveLength(3); // starts at 0 s, 20 s, 40 s; 60 s is over budget
    expect(res).toEqual({ enriched: 0, empty: 3, failed: 0, remaining: 2, rateLimited: false });
  });

  it("counts failures with enriched and empty, and runs two at a time", async () => {
    for (const s of ["ok.com", "none.com", "bad.com", "ok2.com"]) await row(s);
    let active = 0;
    let maxActive = 0;
    const fc = createFakeFirecrawl({}, {
      onPage: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      },
    });
    fc.setSite("https://ok.com", makeSitePage("https://ok.com"));
    fc.setSite("https://ok2.com", makeSitePage("https://ok2.com"));
    fc.setSite("https://none.com", { links: [], markdown: "x" });
    fc.setSite("https://bad.com", new Error("HTTP 500"));

    const res = await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000 });

    expect(res).toEqual({ enriched: 2, empty: 1, failed: 1, remaining: 0, rateLimited: false });
    expect(maxActive).toBe(2);
  });

  it("stops and propagates DiscoveryUnavailable", async () => {
    for (const s of ["a.com", "b.com", "c.com"]) await row(s);
    const fc = createFakeFirecrawl();
    vi.spyOn(fc, "scrapePage").mockRejectedValue(new DiscoveryUnavailable());
    await expect(enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000 })).rejects.toBeInstanceOf(DiscoveryUnavailable);
    expect(fc.scrapePage).toHaveBeenCalledTimes(2); // one per worker, then the drain stops
  });
});

describe("AC-17.12 an enriched row resolves the dossier's social tiles", () => {
  it("facebook, twitter/x and linkedin are non-null https URLs after toLookupBusiness", async () => {
    const b = await row("tiles.com", { socialLinks: {} });
    const fc = createFakeFirecrawl();
    fc.setSite("https://tiles.com", {
      links: ["https://facebook.com/tiles/", "http://x.com/tiles?lang=en", "https://www.linkedin.com/company/tiles/about/"],
    });
    const { business } = await enrichBusinessLinks(db, fc, b.id);
    const links = toLookupBusiness(business).socialLinks;
    for (const url of [socialLink(links, "facebook"), socialLink(links, "twitter", "x"), socialLink(links, "linkedin")]) {
      expect(url).not.toBeNull();
      expect(url).toMatch(/^https:\/\//);
    }
    expect(socialLink(links, "twitter", "x")).toBe("https://x.com/tiles");
  });
});

describe("AC-17.15 a rate limit is not a site failure", () => {
  it("resolve and enrichBusinessLinks propagate it and write nothing", async () => {
    const b = await row("busy.com", { website: "https://busy.com", email: null });
    const fc = createFakeFirecrawl();
    fc.setSite("https://busy.com", new FirecrawlRateLimited(42_000));

    await expect(resolveExternalLinks(fc, { website: "https://busy.com", slug: null })).rejects.toBeInstanceOf(FirecrawlRateLimited);
    await expect(enrichBusinessLinks(db, fc, b.id)).rejects.toMatchObject({ retryAfterMs: 42_000 });

    const after = (await getBusiness(db, b.id))!;
    expect(after.enrichedAt).toBeNull();
    expect(after.updatedAt.getTime()).toBe(b.updatedAt.getTime());
    expect(await countPendingLinks(db)).toBe(1);
  });

  it("a 429 on the contact page keeps the homepage result and does not throw", async () => {
    const b = await row("half.com", { website: "https://half.com", email: null, phone: null, phoneDigits: null });
    const fc = createFakeFirecrawl();
    fc.setSite("https://half.com", { links: ["https://half.com/contact", "https://www.facebook.com/half"] });
    fc.setSite("https://half.com/contact", new FirecrawlRateLimited(60_000));

    const { status, business } = await enrichBusinessLinks(db, fc, b.id);

    expect(status).toBe("enriched");
    expect(business.socialLinks).toEqual({ facebook: "https://www.facebook.com/half" });
    expect(business.enrichedAt).toBeInstanceOf(Date);
    expect(fc.pageCalls).toEqual(["https://half.com", "https://half.com/contact"]);
  });

  it("our own time cap (EnrichTimeout) is not stamped either", async () => {
    const b = await row("slow.com", { website: "https://slow.com" });
    const fc = createFakeFirecrawl({}, { onPage: () => new Promise(() => {}) });
    await expect(enrichBusinessLinks(db, fc, b.id, { timeoutMs: 20 })).rejects.toBeInstanceOf(EnrichTimeout);
    expect((await getBusiness(db, b.id))!.enrichedAt).toBeNull();
  });
});

describe("AC-17.16 the drain waits or stops on a rate limit", () => {
  async function three() {
    for (const s of ["r1.com", "r2.com", "r3.com"]) {
      const b = await row(s);
      await stamp(b.id, { createdAt: new Date(Date.now() - (10 - Number(s[1])) * DAY) });
    }
  }

  it("waits retryAfterMs and retries the row when the wait plus 10 s fits the budget", async () => {
    await three();
    let clock = 0;
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    };
    const fc = createFakeFirecrawl();
    for (const s of ["r1.com", "r2.com", "r3.com"]) fc.setSite(`https://${s}`, makeSitePage(`https://${s}`));
    let limitedOnce = false;
    const real = fc.scrapePage.bind(fc);
    vi.spyOn(fc, "scrapePage").mockImplementation(async (u, o) => {
      if (u === "https://r2.com" && !limitedOnce) {
        limitedOnce = true;
        throw new FirecrawlRateLimited(30_000);
      }
      return real(u, o);
    });

    const res = await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000, concurrency: 1, now: () => clock, sleep });

    expect(sleeps).toEqual([30_000]);
    // r2 was asked twice: the 429, then the retry after the wait.
    expect(vi.mocked(fc.scrapePage).mock.calls.map(([u]) => u)).toEqual([
      "https://r1.com",
      "https://r2.com",
      "https://r2.com",
      "https://r3.com",
    ]);
    expect(res).toEqual({ enriched: 3, empty: 0, failed: 0, remaining: 0, rateLimited: true });
  });

  it("stops starting rows when the wait does not fit; rate-limited rows stay pending and uncounted", async () => {
    await three();
    const clock = 0;
    const sleep = vi.fn(async () => {});
    const fc = createFakeFirecrawl();
    fc.setSite("https://r1.com", makeSitePage("https://r1.com"));
    fc.setSite("https://r2.com", new FirecrawlRateLimited(55_000));
    fc.setSite("https://r3.com", makeSitePage("https://r3.com"));

    // 55 s + 10 s margin > 60 s budget: stop.
    const res = await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000, concurrency: 1, now: () => clock, sleep });

    expect(sleep).not.toHaveBeenCalled();
    expect(fc.pageCalls).toEqual(["https://r1.com", "https://r2.com"]);
    expect(res).toEqual({ enriched: 1, empty: 0, failed: 0, remaining: 2, rateLimited: true });
    const r2 = (await db.select().from(businesses).where(eq(businesses.trustpilotId, "r2.com")))[0];
    expect(r2.enrichedAt).toBeNull();
  });

  it("with two workers, one shared wait holds both before any new row starts", async () => {
    await three();
    let clock = 0;
    let release!: () => void;
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return new Promise<void>((r) => {
        release = () => {
          clock += ms;
          r();
        };
      });
    };
    const fc = createFakeFirecrawl();
    for (const s of ["r1.com", "r2.com", "r3.com"]) fc.setSite(`https://${s}`, { links: [], markdown: "x" });
    let limited = 0;
    const real = fc.scrapePage.bind(fc);
    vi.spyOn(fc, "scrapePage").mockImplementation(async (u, o) => {
      if (limited < 1) {
        limited++;
        throw new FirecrawlRateLimited(20_000);
      }
      return real(u, o);
    });

    const done = enrichPendingLinks(db, fc, { limit: 10, budgetMs: 120_000, now: () => clock, sleep });
    await new Promise((r) => setTimeout(r, 30));
    const startedDuringWait = fc.pageCalls.length;
    release();
    const res = await done;

    expect(sleeps).toEqual([20_000]);
    // Before the wait: the rate-limited attempt and at most the other worker's in-flight row.
    expect(startedDuringWait).toBeLessThanOrEqual(1);
    expect(res).toMatchObject({ empty: 3, failed: 0, remaining: 0, rateLimited: true });
  });
});
