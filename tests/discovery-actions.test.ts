import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusinessByTrustpilotId, upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { createTestDb } from "@/db/test-utils";
import { TRUSTPILOT_CATEGORIES, trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { makeTrustpilotProfile, makeTrustpilotRow } from "./helpers/builders";
import { DiscoveryUnavailable, FirecrawlRateLimited } from "@/lib/firecrawl/client";
import { type FakeFirecrawl, createFakeFirecrawl, makeCategoryCard, makeSitePage } from "./helpers/fake-firecrawl";

let fake: FakeFirecrawl = createFakeFirecrawl();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// after() needs a request scope; collect the callbacks and run them explicitly.
const afterQueue = vi.hoisted(() => [] as (() => Promise<unknown> | unknown)[]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => Promise<unknown> | unknown) => void afterQueue.push(fn),
}));
async function drainAfter() {
  while (afterQueue.length) await afterQueue.shift()!();
}
// Never reach the network: with a key, every entry point gets the in-memory fake;
// without one, the real factory's DiscoveryUnavailable behaviour is kept.
vi.mock("@/lib/firecrawl/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/firecrawl/client")>();
  return { ...real, createFirecrawl: (key?: string) => (key ? fake : real.createFirecrawl(key)) };
});

// Pass-through spy so tests can see the budget each caller hands the drain.
const drainSpy = vi.hoisted(() => ({ calls: [] as { limit: number; budgetMs: number }[] }));
vi.mock("@/lib/firecrawl/enrich", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/firecrawl/enrich")>();
  return {
    ...real,
    enrichPendingLinks: (...args: Parameters<typeof real.enrichPendingLinks>) => {
      drainSpy.calls.push({ limit: args[2].limit, budgetMs: args[2].budgetMs });
      return real.enrichPendingLinks(...args);
    },
  };
});

const { discoveryConfigured, enrichTrustpilotAction, scrapeUrlAction, seedCategoryAction } = await import(
  "@/features/discovery/actions"
);
const { GET, maxDuration } = await import("@/app/api/cron/daily/route");

const NOT_CONFIGURED = "Discovery is not configured: set FIRECRAWL_API_KEY";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses RESTART IDENTITY CASCADE`);
  fake = createFakeFirecrawl();
  drainSpy.calls.length = 0;
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test");
  vi.stubEnv("CRON_SECRET", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("AC-13.5 without FIRECRAWL_API_KEY", () => {
  beforeEach(() => vi.stubEnv("FIRECRAWL_API_KEY", ""));

  it("discoveryConfigured() is false and every action fails clearly without scraping", async () => {
    expect(discoveryConfigured()).toBe(false);
    expect(await scrapeUrlAction("https://www.trustpilot.com/review/acme.com")).toEqual({ ok: false, message: NOT_CONFIGURED });
    expect(await seedCategoryAction("sports")).toMatchObject({ ok: false, message: NOT_CONFIGURED });
    expect(await enrichTrustpilotAction("00000000-0000-4000-8000-000000000000")).toMatchObject({
      ok: false,
      message: NOT_CONFIGURED,
    });
    expect(fake.calls).toEqual([]);
  });
});

describe("discovery actions with a key", () => {
  it("discoveryConfigured() is true", () => {
    expect(discoveryConfigured()).toBe(true);
  });

  it("scrapeUrlAction stores the profile and returns its id and name", async () => {
    fake.setProfile("acme.com", makeTrustpilotProfile({ displayName: "Acme" }));
    const res = await scrapeUrlAction("https://www.trustpilot.com/review/acme.com");
    const stored = await getBusinessByTrustpilotId(db, "acme.com");
    expect(res).toEqual({ ok: true, data: { businessId: stored!.id, name: "Acme" } });
  });

  it("scrapeUrlAction rejects non-Trustpilot URLs and reports scrape failures", async () => {
    const bad = await scrapeUrlAction("https://acme.com/reviews");
    expect(bad.ok).toBe(false);
    expect(fake.calls).toEqual([]);
    fake.setProfile("down.com", new Error("Firecrawl 502"));
    expect(await scrapeUrlAction(trustpilotReviewUrl("down.com"))).toEqual({
      ok: false,
      message: "Scrape failed: Firecrawl 502",
    });
  });

  it("seedCategoryAction queues the scrape behind after() and rejects unknown slugs inline", async () => {
    fake.setCategoryPage("sports", 1, [makeCategoryCard("a.com"), makeCategoryCard("b.com")]);
    fake.setCategoryPage("sports", 2, []);
    expect(await seedCategoryAction("sports")).toEqual({ ok: true, data: { queued: true, category: "sports" } });
    // Nothing scraped until the response is done.
    expect(fake.calls).toEqual([]);
    expect(afterQueue).toHaveLength(1);
    await drainAfter();
    expect(await getBusinessByTrustpilotId(db, "a.com")).not.toBeNull();
    expect(await getBusinessByTrustpilotId(db, "b.com")).not.toBeNull();
    expect(await seedCategoryAction("nope")).toMatchObject({ ok: false });
    expect(afterQueue).toHaveLength(0);
  });

  it("a failing queued seed is logged, not thrown", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.setCategoryPage("sports", 1, [makeCategoryCard("a.com")]);
    vi.spyOn(fake, "scrapeJson").mockRejectedValue(new Error("Firecrawl 502"));
    expect(await seedCategoryAction("sports")).toMatchObject({ ok: true });
    await expect(drainAfter()).resolves.toBeUndefined();
    err.mockRestore();
  });

  it("enrichTrustpilotAction enriches from the website and validates the id", async () => {
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "acme.com", website: "https://acme.com", email: null }),
    );
    fake.setSite("https://acme.com", { links: ["mailto:sales@acme.com", "https://www.facebook.com/acme"] });
    const res = await enrichTrustpilotAction(business.id);
    expect(res.ok && res.data.email).toBe("sales@acme.com");
    expect(res.ok && res.data.socialLinks).toEqual({ facebook: "https://www.facebook.com/acme" });
    expect(await enrichTrustpilotAction("not-a-uuid")).toEqual({ ok: false, message: "Invalid business id" });
  });

  it("enrichTrustpilotAction reports a site that cannot be loaded or a row with no website", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "down.com", website: "https://down.com" }));
    fake.setSite("https://down.com", new Error("Firecrawl 502"));
    expect(await enrichTrustpilotAction(business.id)).toEqual({ ok: false, message: "Enrichment failed: could not load https://down.com" });
    const { business: bare } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "nodomain", slug: "nodomain", website: null, name: "Bare" }),
    );
    expect(await enrichTrustpilotAction(bare.id)).toEqual({ ok: false, message: "Enrichment failed: Bare has no website to enrich from" });
    warn.mockRestore();
  });
});

describe("WP-17 links pulled at add time", () => {
  it("AC-17.4 scrapeUrlAction stores a clean website, social links and enrichedAt", async () => {
    fake.setProfile(
      "acme.com",
      makeTrustpilotProfile({
        displayName: "Acme",
        websiteUrl: "https://www.acme.com?utm_medium=company_profile&utm_source=trustpilot",
        email: undefined,
        phone: undefined,
      }),
    );
    fake.setSite("https://www.acme.com", makeSitePage("https://www.acme.com"));

    const res = await scrapeUrlAction("https://www.trustpilot.com/review/acme.com");

    expect(res.ok).toBe(true);
    const stored = (await getBusinessByTrustpilotId(db, "acme.com"))!;
    expect(stored).toMatchObject({
      website: "https://www.acme.com",
      email: "hello@acme.com",
      phone: "+1-512-555-0142",
      phoneDigits: "15125550142",
      socialLinks: {
        facebook: "https://www.facebook.com/acme",
        twitter: "https://twitter.com/acme",
        linkedin: "https://www.linkedin.com/company/acme",
        instagram: "https://www.instagram.com/acme",
      },
    });
    expect(stored.enrichedAt).toBeInstanceOf(Date);
    // Email and phone both came from the homepage: no contact-page scrape.
    expect(fake.pageCalls).toEqual(["https://www.acme.com"]);
  });

  it("AC-17.4 a rejecting page scrape still returns ok and keeps the profile data", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.setProfile("acme.com", makeTrustpilotProfile({ displayName: "Acme", websiteUrl: "https://acme.com", phone: "+1 512 555 0101" }));
    fake.setSite("https://acme.com", new Error("Firecrawl 502"));

    const res = await scrapeUrlAction("https://www.trustpilot.com/review/acme.com");

    const stored = (await getBusinessByTrustpilotId(db, "acme.com"))!;
    expect(res).toEqual({ ok: true, data: { businessId: stored.id, name: "Acme" } });
    expect(stored).toMatchObject({ name: "Acme", website: "https://acme.com", phone: "+1 512 555 0101", socialLinks: {} });
    expect(stored.enrichedAt).toBeInstanceOf(Date); // the failed attempt is stamped
    warn.mockRestore();
  });

  it("the seed enriches the inserted rows first, inside the same after() task", async () => {
    const { business: older } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "older.com", website: "https://older.com", socialLinks: {} }),
    );
    fake.setCategoryPage("sports", 1, [makeCategoryCard("a.com"), makeCategoryCard("b.com")]);
    fake.setCategoryPage("sports", 2, []);
    fake.setSite("https://a.com", makeSitePage("https://a.com"));
    fake.setSite("https://b.com", { links: [] , markdown: "nothing here" });
    fake.setSite("https://older.com", makeSitePage("https://older.com"));

    await seedCategoryAction("sports");
    expect(fake.pageCalls).toEqual([]);
    await drainAfter();

    // New rows first (in insert order), then the older pending row.
    expect(fake.pageCalls.slice(0, 2).sort()).toEqual(["https://a.com", "https://b.com"]);
    expect(fake.pageCalls[2]).toBe("https://older.com");
    const a = (await getBusinessByTrustpilotId(db, "a.com"))!;
    expect(a.website).toBe("https://a.com");
    expect(a.socialLinks.facebook).toBe("https://www.facebook.com/a");
    const b = (await getBusinessByTrustpilotId(db, "b.com"))!;
    expect(b.enrichedAt).toBeInstanceOf(Date);
    expect(b.socialLinks).toEqual({});
    expect((await getBusinessByTrustpilotId(db, "older.com"))!.id).toBe(older.id);
    expect((await getBusinessByTrustpilotId(db, "older.com"))!.socialLinks.twitter).toBe("https://twitter.com/older");
  });
});

describe("GET /api/cron/daily", () => {
  const call = (auth?: string) =>
    GET(new Request("http://localhost:3300/api/cron/daily", auth ? { headers: { authorization: auth } } : {}));

  it("declares maxDuration 300", () => {
    expect(maxDuration).toBe(300);
  });

  it("AC-13.6 requires the bearer when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    const ok = await call("Bearer s3cret");
    expect(ok.status).toBe(200);
  });

  it("runs campaigns, emails and the stale sync on a weekday; no seed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T13:00:00Z")); // Monday
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "stale.com", lastScrapedAt: null }));
    fake.setProfile("stale.com", makeTrustpilotProfile({ websiteUrl: "https://stale.com" }));
    fake.setSite("https://stale.com", makeSitePage("https://stale.com"));

    const body = await (await call()).json();

    expect(body).toEqual({
      campaigns: 0,
      emails: 0,
      sync: { scraped: 1, failed: 0, remaining: 0 },
      links: { enriched: 1, empty: 0, failed: 0, remaining: 0, rateLimited: false },
      seeded: null,
    });
    expect(fake.calls).toEqual([trustpilotReviewUrl("stale.com")]);
    expect(fake.pageCalls).toEqual(["https://stale.com"]);
  });

  it("seeds every category with max 20 on Sundays (UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T13:00:00Z")); // Sunday
    for (const c of TRUSTPILOT_CATEGORIES) fake.setCategoryPage(c.slug, 1, [makeCategoryCard(`${c.slug}.example.com`)]);

    const body = await (await call()).json();

    expect(body.sync).toEqual({ scraped: 0, failed: 0, remaining: 0 }); // sync runs before the seed
    expect(body.seeded).toMatchObject({ categories: 22, inserted: 22, seen: 22, errors: [] });
    // max 20 = one page per category, never ?page=2
    expect(fake.calls.filter((u) => u.includes("/categories/"))).toHaveLength(22);
    expect(fake.calls.some((u) => u.includes("page=2"))).toBe(false);
  });

  it("skips sync and seed when discovery is unconfigured", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T13:00:00Z")); // Sunday
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      campaigns: 0,
      emails: 0,
      sync: { skipped: "FIRECRAWL_API_KEY not set" },
      links: { skipped: "FIRECRAWL_API_KEY not set" },
      seeded: { skipped: "FIRECRAWL_API_KEY not set" },
    });
  });

  it("AC-17.8 the links stage drains at most 40 pending rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T13:00:00Z")); // Monday
    const now = new Date();
    for (let i = 0; i < 45; i++) {
      await upsertBusinessByTrustpilotId(
        db,
        makeTrustpilotRow({ trustpilotId: `site${i}.com`, lastScrapedAt: now, enrichedAt: null }),
      );
      fake.setSite(`https://site${i}.com`, { links: [], markdown: "x" });
    }
    const body = await (await call()).json();
    expect(body.sync).toEqual({ scraped: 0, failed: 0, remaining: 0 });
    expect(body.links).toEqual({ enriched: 0, empty: 40, failed: 0, remaining: 5, rateLimited: false });
    expect(fake.pageCalls).toHaveLength(40);
  });

  it("AC-17.8 a throwing links stage leaves campaigns, emails and sync intact", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T13:00:00Z")); // Monday
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "stale.com", lastScrapedAt: null }));
    fake.setProfile("stale.com", makeTrustpilotProfile({ websiteUrl: "https://stale.com" }));
    vi.spyOn(fake, "scrapePage").mockRejectedValue(new DiscoveryUnavailable("Firecrawl credits exhausted"));

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      campaigns: 0,
      emails: 0,
      sync: { scraped: 1, failed: 0, remaining: 0 },
      links: { error: "Firecrawl credits exhausted" },
      seeded: null,
    });
    err.mockRestore();
  });
});

describe("WP-17 round 1: rate limits in the actions and the cron", () => {
  const call = () => GET(new Request("http://localhost:3300/api/cron/daily"));

  it("AC-17.17 a rate-limited profile scrape fails with a rate-limit message", async () => {
    fake.setProfile("acme.com", new FirecrawlRateLimited(50_000));
    const res = await scrapeUrlAction("https://www.trustpilot.com/review/acme.com");
    expect(res).toEqual({ ok: false, message: "Scrape failed: Firecrawl rate limit reached, try again in 50 s" });
    expect(res.ok === false && res.message).toMatch(/rate limit/);
    expect(await getBusinessByTrustpilotId(db, "acme.com")).toBeNull();
  });

  it("AC-17.17 a rate-limited link step still returns ok and leaves the row unstamped (pending)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.setProfile("acme.com", makeTrustpilotProfile({ displayName: "Acme", websiteUrl: "https://acme.com" }));
    fake.setSite("https://acme.com", new FirecrawlRateLimited(60_000));

    const res = await scrapeUrlAction("https://www.trustpilot.com/review/acme.com");

    const stored = (await getBusinessByTrustpilotId(db, "acme.com"))!;
    expect(res).toEqual({ ok: true, data: { businessId: stored.id, name: "Acme" } });
    expect(stored.enrichedAt).toBeNull();
    expect(stored.website).toBe("https://acme.com");
    warn.mockRestore();
  });

  it("AC-17.17 the seed's after() task survives rate limits on a category page and in the drain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fake.setCategoryPage("sports", 1, [makeCategoryCard("a.com")]);
    fake.set(trustpilotCategoryUrl("sports", 2), new FirecrawlRateLimited(60_000));
    // Longer than the whole 240 s budget: the drain stops instead of waiting.
    fake.setSite("https://a.com", new FirecrawlRateLimited(300_000));

    expect(await seedCategoryAction("sports")).toMatchObject({ ok: true });
    await expect(drainAfter()).resolves.toBeUndefined();

    const a = (await getBusinessByTrustpilotId(db, "a.com"))!;
    expect(a.enrichedAt).toBeNull(); // still pending
    expect(drainSpy.calls).toHaveLength(1);
    expect(drainSpy.calls[0].limit).toBe(60);
    expect(drainSpy.calls[0].budgetMs).toBeLessThanOrEqual(240_000);
    warn.mockRestore();
  });

  it("AC-17.18 weekday: the links stage gets the remaining discovery budget capped at 180 s, and reports rateLimited", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T13:00:00Z")); // Monday; Date stands still
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "busy.com", lastScrapedAt: new Date(), enrichedAt: null }));
    fake.setSite("https://busy.com", new FirecrawlRateLimited(300_000));

    const body = await (await call()).json();

    expect(drainSpy.calls).toEqual([{ limit: 40, budgetMs: 180_000 }]);
    expect(body.links).toEqual({ enriched: 0, empty: 0, failed: 0, remaining: 1, rateLimited: true });
    expect(body.campaigns).toBe(0);
    expect(body.sync).toEqual({ scraped: 0, failed: 0, remaining: 0 });
    warn.mockRestore();
  });

  it("AC-17.18 Sunday: the links stage is capped at 60 s so the seed keeps the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T13:00:00Z")); // Sunday
    for (const c of TRUSTPILOT_CATEGORIES) fake.setCategoryPage(c.slug, 1, []);

    const body = await (await call()).json();

    expect(drainSpy.calls).toEqual([{ limit: 40, budgetMs: 60_000 }]);
    expect(body.links).toEqual({ enriched: 0, empty: 0, failed: 0, remaining: 0, rateLimited: false });
    expect(body.seeded).toMatchObject({ categories: 22, errors: [] });
  });
});
