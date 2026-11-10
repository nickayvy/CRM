import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import { countPendingLinks, listPendingLinkIds, upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { type Business, businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { DiscoveryUnavailable, FirecrawlRateLimited, type ScrapedPage } from "@/lib/firecrawl/client";
import { enrichPendingLinks } from "@/lib/firecrawl/enrich";
import { PageHttpError, UnsafeUrlError, type fetchPage } from "@/lib/web/fetch-page";
import { DIRECT_DRAIN_CONCURRENCY, DIRECT_TIMEOUT_MS, createPageSource, isThinPage } from "@/lib/web/page-source";
import { makeTrustpilotRow } from "./helpers/builders";
import { createFakeFirecrawl, makeSitePage } from "./helpers/fake-firecrawl";

type Direct = typeof fetchPage;

/** A direct fetcher serving pages by exact URL; unknown URLs reject. Records calls and options. */
function fakeDirect(pages: Record<string, ScrapedPage | null | Error> = {}, delayMs = 0) {
  const calls: { url: string; timeoutMs?: number }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn: Direct = async (url, opts) => {
    calls.push({ url, timeoutMs: opts?.timeoutMs });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (!(url in pages)) throw new Error(`fake direct: no page for ${url}`);
      const p = pages[url];
      if (p instanceof Error) throw p;
      return p;
    } finally {
      inFlight--;
    }
  };
  return { fn, calls, pages, maxInFlight: () => maxInFlight };
}

const LONG_TEXT = "Family-owned roofing contractor serving the whole metro area since 1994. ".repeat(4);
const page = (url: string, links: string[], markdown: string | null = LONG_TEXT): ScrapedPage => ({ url, finalUrl: url, links, markdown });

// ------------------------------------------------------------ AC-19.4

describe("AC-19.4 createPageSource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("direct success → Firecrawl is never called", async () => {
    const fc = createFakeFirecrawl();
    const direct = fakeDirect({ "https://acme.com": page("https://acme.com", ["mailto:hi@acme.com"]) });
    const src = createPageSource({ firecrawl: fc, direct: direct.fn });

    const got = await src.scrapePage("https://acme.com", { timeoutMs: 30_000 });

    expect(got?.links).toEqual(["mailto:hi@acme.com"]);
    expect(fc.pageCalls).toHaveLength(0);
    // The direct attempt is capped so a fallback still fits a row's budget.
    expect(direct.calls).toEqual([{ url: "https://acme.com", timeoutMs: DIRECT_TIMEOUT_MS }]);
  });

  it("direct rejects → Firecrawl is called once and its page is returned", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://acme.com", { links: ["mailto:fc@acme.com"], markdown: "from firecrawl" });
    const direct = fakeDirect({ "https://acme.com": new Error("ECONNRESET") });
    const got = await createPageSource({ firecrawl: fc, direct: direct.fn }).scrapePage("https://acme.com");
    expect(fc.pageCalls).toEqual(["https://acme.com"]);
    expect(got).toEqual({ url: "https://acme.com", finalUrl: null, links: ["mailto:fc@acme.com"], markdown: "from firecrawl" });
  });

  it("direct resolves null → Firecrawl is called", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://acme.com", { links: ["tel:+15125550100"] });
    const got = await createPageSource({ firecrawl: fc, direct: fakeDirect({ "https://acme.com": null }).fn }).scrapePage(
      "https://acme.com",
    );
    expect(fc.pageCalls).toHaveLength(1);
    expect(got?.links).toEqual(["tel:+15125550100"]);
  });

  it("thin direct page → Firecrawl is called; Firecrawl's page wins", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://spa.com", makeSitePage("https://spa.com"));
    const shell = page("https://spa.com", ["https://spa.com/app.js"], "Loading…");
    expect(isThinPage(shell)).toBe(true);
    const got = await createPageSource({ firecrawl: fc, direct: fakeDirect({ "https://spa.com": shell }).fn }).scrapePage(
      "https://spa.com",
    );
    expect(fc.pageCalls).toEqual(["https://spa.com"]);
    expect(got?.links).toContain("mailto:hello@spa.com");
  });

  it("a thin direct page is kept when the fallback has nothing better", async () => {
    const shell = page("https://spa.com", [], "Coming soon");
    const fcNull = createFakeFirecrawl();
    fcNull.setSite("https://spa.com", null);
    expect(await createPageSource({ firecrawl: fcNull, direct: fakeDirect({ "https://spa.com": shell }).fn }).scrapePage("https://spa.com")).toBe(shell);
    const fcErr = createFakeFirecrawl();
    fcErr.setSite("https://spa.com", new Error("Firecrawl 502"));
    expect(await createPageSource({ firecrawl: fcErr, direct: fakeDirect({ "https://spa.com": shell }).fn }).scrapePage("https://spa.com")).toBe(shell);
  });

  it("a short page with a mailto:, tel: or social link is not thin", () => {
    expect(isThinPage(page("https://a.com", ["mailto:a@a.com"], "Hi"))).toBe(false);
    expect(isThinPage(page("https://a.com", ["tel:+15125550100"], null))).toBe(false);
    expect(isThinPage(page("https://a.com", ["https://www.instagram.com/acme"], "Hi"))).toBe(false);
    expect(isThinPage(page("https://a.com", ["https://www.facebook.com/sharer/sharer.php"], "Hi"))).toBe(true);
    expect(isThinPage(page("https://a.com", [], "x".repeat(200)))).toBe(false);
    expect(isThinPage(page("https://a.com", [], "x".repeat(199)))).toBe(true);
  });

  it("no Firecrawl and direct rejects → rejects; no Firecrawl and null/thin → that result stands", async () => {
    const boom = new Error("ETIMEDOUT");
    await expect(createPageSource({ direct: fakeDirect({ "https://a.com": boom }).fn }).scrapePage("https://a.com")).rejects.toBe(boom);
    await expect(createPageSource({ firecrawl: null, direct: fakeDirect({ "https://a.com": null }).fn }).scrapePage("https://a.com")).resolves.toBeNull();
    const shell = page("https://a.com", [], "x");
    await expect(createPageSource({ direct: fakeDirect({ "https://a.com": shell }).fn }).scrapePage("https://a.com")).resolves.toBe(shell);
  });

  it("UnsafeUrlError → Firecrawl is not called", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("http://169.254.169.254/", { links: ["mailto:x@y.com"] });
    const unsafe = new UnsafeUrlError("refused 169.254.169.254: link-local");
    const src = createPageSource({ firecrawl: fc, direct: fakeDirect({ "http://169.254.169.254/": unsafe }).fn });
    await expect(src.scrapePage("http://169.254.169.254/")).rejects.toBe(unsafe);
    expect(fc.pageCalls).toEqual([]);
  });

  it("a 404/410 from the site is final; a 403 (bot wall) still falls back", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://walled.com", { links: ["mailto:hi@walled.com"] });
    const direct = fakeDirect({
      "https://gone.com": new PageHttpError("https://gone.com", 404),
      "https://walled.com": new PageHttpError("https://walled.com", 403),
    });
    const src = createPageSource({ firecrawl: fc, direct: direct.fn });
    await expect(src.scrapePage("https://gone.com")).rejects.toBeInstanceOf(PageHttpError);
    expect((await src.scrapePage("https://walled.com"))?.links).toEqual(["mailto:hi@walled.com"]);
    expect(fc.pageCalls).toEqual(["https://walled.com"]);
  });

  it("FirecrawlRateLimited from the fallback propagates, even over a thin page", async () => {
    const fc = createFakeFirecrawl();
    fc.setSite("https://a.com", new FirecrawlRateLimited(30_000));
    const src = createPageSource({ firecrawl: fc, direct: fakeDirect({ "https://a.com": page("https://a.com", [], "x") }).fn });
    await expect(src.scrapePage("https://a.com")).rejects.toBeInstanceOf(FirecrawlRateLimited);
  });

  it("scrapeJson passes through to Firecrawl, and rejects with DiscoveryUnavailable without one", async () => {
    const fc = createFakeFirecrawl({ "https://www.trustpilot.com/review/acme.com": { displayName: "Acme" } });
    expect(await createPageSource({ firecrawl: fc }).scrapeJson("https://www.trustpilot.com/review/acme.com", {})).toEqual({
      displayName: "Acme",
    });
    await expect(createPageSource({}).scrapeJson("https://www.trustpilot.com/review/acme.com", {})).rejects.toBeInstanceOf(
      DiscoveryUnavailable,
    );
  });
});

// ------------------------------------------------------------ DB-backed

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function row(slug: string, overrides: Parameters<typeof makeTrustpilotRow>[0] = {}): Promise<Business> {
  const { business } = await upsertBusinessByTrustpilotId(
    db,
    makeTrustpilotRow({ trustpilotId: slug, website: `https://${slug}`, enrichedAt: null, ...overrides }),
  );
  return business;
}

async function setQualification(id: string, qualification: "qualified" | "review" | "rejected", rejectionReasons: string[]) {
  await db.update(businesses).set({ qualification, rejectionReasons }).where(eq(businesses.id, id));
}

describe("AC-19.5 drain through a page source", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE businesses RESTART IDENTITY CASCADE`);
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  async function tenRows() {
    const pages: Record<string, ScrapedPage> = {};
    for (let i = 0; i < 10; i++) {
      const host = `shop${i}.com`;
      await row(host, { email: null, phone: null });
      pages[`https://${host}`] = page(`https://${host}`, [`mailto:owner@${host}`, "tel:+1-512-555-0142", `https://www.facebook.com/shop${i}`]);
    }
    return pages;
  }

  it("10 pending rows, succeeding direct fetcher: 10 enriched, zero Firecrawl calls", async () => {
    const direct = fakeDirect(await tenRows(), 5);
    const fc = createFakeFirecrawl();

    const res = await enrichPendingLinks(db, createPageSource({ firecrawl: fc, direct: direct.fn }), { limit: 50, budgetMs: 60_000 });

    expect(res).toEqual({ enriched: 10, empty: 0, failed: 0, remaining: 0, rateLimited: false });
    expect(fc.pageCalls).toHaveLength(0);
    expect(fc.calls).toHaveLength(0);
    expect(direct.calls).toHaveLength(10);
    // A page source runs more rows at once than Firecrawl's 2.
    expect(direct.maxInFlight()).toBe(DIRECT_DRAIN_CONCURRENCY);
    const b = (await getBusiness(db, (await listAll())[0].id))!;
    expect(b.email).toMatch(/^owner@shop\d\.com$/);
    expect(b.phone).toBe("+1-512-555-0142");
  });

  it("with no Firecrawl at all it still enriches 10", async () => {
    const direct = fakeDirect(await tenRows());
    const res = await enrichPendingLinks(db, createPageSource({ firecrawl: null, direct: direct.fn }), { limit: 50, budgetMs: 60_000 });
    expect(res).toEqual({ enriched: 10, empty: 0, failed: 0, remaining: 0, rateLimited: false });
  });

  it("a row whose direct fetch fails is retried through Firecrawl", async () => {
    await row("flaky.com", { email: null });
    const fc = createFakeFirecrawl();
    fc.setSite("https://flaky.com", { links: ["mailto:hi@flaky.com"] });
    const direct = fakeDirect({ "https://flaky.com": new Error("socket hang up") });

    const res = await enrichPendingLinks(db, createPageSource({ firecrawl: fc, direct: direct.fn }), { limit: 5, budgetMs: 60_000 });

    expect(res.enriched).toBe(1);
    expect(direct.calls.map((c) => c.url)).toEqual(["https://flaky.com"]);
    expect(fc.pageCalls).toEqual(["https://flaky.com"]);
    expect((await listAll())[0].email).toBe("hi@flaky.com");
  });

  it("an UnsafeUrlError is a site failure: the row is stamped and not picked again", async () => {
    await row("evil.com");
    const fc = createFakeFirecrawl();
    const direct = fakeDirect({ "https://evil.com": new UnsafeUrlError("refused evil.com: 10.0.0.5 is private") });
    const src = createPageSource({ firecrawl: fc, direct: direct.fn });

    expect(await enrichPendingLinks(db, src, { limit: 5, budgetMs: 60_000 })).toEqual({
      enriched: 0,
      empty: 0,
      failed: 1,
      remaining: 0,
      rateLimited: false,
    });
    expect((await listAll())[0].enrichedAt).toBeInstanceOf(Date);
    expect(fc.pageCalls).toEqual([]);
    expect(await listPendingLinkIds(db, { limit: 10 })).toEqual([]);
  });

  it("an explicit concurrency still wins, and nothing runs above 8", async () => {
    const pages = await tenRows();
    const one = fakeDirect(pages, 5);
    await enrichPendingLinks(db, createPageSource({ direct: one.fn }), { limit: 10, budgetMs: 60_000, concurrency: 1 });
    expect(one.maxInFlight()).toBe(1);

    // Pending again (the first drain re-qualified the rows; put them back in review).
    await db.update(businesses).set({ enrichedAt: null, qualification: "review", rejectionReasons: [] });
    expect(await countPendingLinks(db)).toBe(10);
    const many = fakeDirect(pages, 5);
    await enrichPendingLinks(db, createPageSource({ direct: many.fn }), { limit: 10, budgetMs: 60_000, concurrency: 50 });
    expect(many.maxInFlight()).toBe(8);
  });

  it("a bare Firecrawl client keeps the plan's 2 rows at a time", async () => {
    let inFlight = 0;
    let max = 0;
    const fc = createFakeFirecrawl({}, {
      onPage: async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
    });
    for (let i = 0; i < 6; i++) {
      await row(`fc${i}.com`);
      fc.setSite(`https://fc${i}.com`, { links: [], markdown: "x" });
    }
    await enrichPendingLinks(db, fc, { limit: 10, budgetMs: 60_000 });
    expect(max).toBe(2);
  });
});

async function listAll(): Promise<Business[]> {
  return db.select().from(businesses).orderBy(businesses.createdAt);
}

describe("AC-19.6 qualify before enrich", () => {
  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE businesses RESTART IDENTITY CASCADE`);
  });

  it("omits rows rejected for an incurable reason; keeps no_phone-only, soft-only and review rows", async () => {
    const mismatch = await row("mismatch.com");
    await setQualification(mismatch.id, "rejected", ["category_mismatch"]);
    const mixed = await row("mixed.com");
    await setQualification(mixed.id, "rejected", ["no_phone", "closed"]);
    const dupe = await row("dupe.com");
    await setQualification(dupe.id, "rejected", ["duplicate_website"]); // WP-18's code, same rule
    const noPhone = await row("nophone.com");
    await setQualification(noPhone.id, "rejected", ["no_phone"]);
    const soft = await row("soft.com");
    await setQualification(soft.id, "rejected", ["no_phone", "unclaimed", "low_score"]);
    const review = await row("review.com");
    await setQualification(review.id, "review", ["low_score"]);
    const qualified = await row("qualified.com");
    await setQualification(qualified.id, "qualified", []);
    const rejectedNoReasons = await row("bare.com");
    await setQualification(rejectedNoReasons.id, "rejected", []);

    const ids = await listPendingLinkIds(db, { limit: 50 });

    expect(new Set(ids)).toEqual(new Set([noPhone.id, soft.id, review.id, qualified.id, rejectedNoReasons.id]));
    expect(ids).not.toContain(mismatch.id);
    expect(ids).not.toContain(mixed.id);
    expect(ids).not.toContain(dupe.id);
    expect(await countPendingLinks(db)).toBe(ids.length);
    // `ids` narrowing honours the same rule.
    expect(await listPendingLinkIds(db, { limit: 10, ids: [mismatch.id, noPhone.id] })).toEqual([noPhone.id]);
  });

  it("the drain never fetches a row cut for good", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cut = await row("cut.com");
    await setQualification(cut.id, "rejected", ["category_mismatch"]);
    const direct = fakeDirect({});
    const res = await enrichPendingLinks(db, createPageSource({ direct: direct.fn }), { limit: 10, budgetMs: 60_000, ids: [cut.id] });
    expect(res).toEqual({ enriched: 0, empty: 0, failed: 0, remaining: 0, rateLimited: false });
    expect(direct.calls).toEqual([]);
  });
});
