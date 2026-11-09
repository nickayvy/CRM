import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusinessByTrustpilotId, upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { createTestDb } from "@/db/test-utils";
import { TRUSTPILOT_CATEGORIES, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { makeTrustpilotProfile, makeTrustpilotRow } from "./helpers/builders";
import { type FakeFirecrawl, createFakeFirecrawl, makeCategoryCard } from "./helpers/fake-firecrawl";

let fake: FakeFirecrawl = createFakeFirecrawl();
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Never reach the network: with a key, every entry point gets the in-memory fake;
// without one, the real factory's DiscoveryUnavailable behaviour is kept.
vi.mock("@/lib/firecrawl/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/firecrawl/client")>();
  return { ...real, createFirecrawl: (key?: string) => (key ? fake : real.createFirecrawl(key)) };
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

  it("seedCategoryAction seeds a known category and rejects unknown slugs", async () => {
    fake.setCategoryPage("sports", 1, [makeCategoryCard("a.com"), makeCategoryCard("b.com")]);
    fake.setCategoryPage("sports", 2, []);
    expect(await seedCategoryAction("sports")).toEqual({ ok: true, data: { inserted: 2, seen: 2 } });
    expect(await seedCategoryAction("nope")).toMatchObject({ ok: false });
  });

  it("enrichTrustpilotAction enriches from the website and validates the id", async () => {
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ trustpilotId: "acme.com", website: "https://acme.com", email: null }),
    );
    fake.set("https://acme.com", { email: "sales@acme.com" });
    const res = await enrichTrustpilotAction(business.id);
    expect(res.ok && res.data.email).toBe("sales@acme.com");
    expect(await enrichTrustpilotAction("not-a-uuid")).toEqual({ ok: false, message: "Invalid business id" });
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
    fake.setProfile("stale.com", makeTrustpilotProfile());

    const body = await (await call()).json();

    expect(body).toEqual({ campaigns: 0, emails: 0, sync: { scraped: 1, failed: 0, remaining: 0 }, seeded: null });
    expect(fake.calls).toEqual([trustpilotReviewUrl("stale.com")]);
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
      seeded: { skipped: "FIRECRAWL_API_KEY not set" },
    });
  });
});
