// WP-16: /businesses Source filter + L30D sort + Trustpilot detail panel (AC-16.3), the Yelp
// not-configured state (AC-16.4) and the command palette page list.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import type { Db } from "@/db/client";
import { listBusinesses } from "@/db/repo/businesses";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { createTestDb } from "@/db/test-utils";
import { parseBusinessesQuery } from "@/features/businesses/search-params";
import { insertBusiness, makeTrustpilotRow } from "./helpers/builders";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({ id: USER_ID, email: "sdr@example.test" }),
  requireUser: async () => ({ id: USER_ID, email: "sdr@example.test" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/businesses",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { default: BusinessesPage } = await import("@/app/businesses/page");
const { default: BusinessPage } = await import("@/app/businesses/[id]/page");
const { default: SearchesPage } = await import("@/app/searches/page");
const { default: NewSearchPage } = await import("@/app/searches/new/page");
const { PAGES } = await import("@/components/command-palette");
const { TooltipProvider } = await import("@/components/ui/tooltip");

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
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs RESTART IDENTITY CASCADE`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function trustpilot(overrides: Parameters<typeof makeTrustpilotRow>[0] = {}) {
  return (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow(overrides))).business;
}

/** 2 Yelp rows and 2 Trustpilot rows (L30D 5 and 80). */
async function seedMixed() {
  await insertBusiness(db, { name: "Yelp Alpha Plumbing" });
  await insertBusiness(db, { name: "Yelp Beta Plumbing" });
  await trustpilot({ name: "Quiet Widgets", reviewsLast30d: 5 });
  await trustpilot({ name: "Busy Gadgets", reviewsLast30d: 80 });
}

async function html(el: ReactNode): Promise<string> {
  const { prelude } = await prerender(createElement(TooltipProvider, null, el));
  return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("AC-16.3 businesses Source filter and L30D sort", () => {
  it("source=trustpilot lists only Trustpilot rows; an invalid source is ignored", async () => {
    await seedMixed();
    const { filter, sort } = parseBusinessesQuery({ source: "trustpilot" });
    expect(filter.source).toBe("trustpilot");
    const { rows, total } = await listBusinesses(db, filter, { sort, limit: 50, offset: 0 });
    expect(total).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual(["Busy Gadgets", "Quiet Widgets"]);

    const yelpOnly = await listBusinesses(db, parseBusinessesQuery({ source: "yelp" }).filter, { limit: 50, offset: 0 });
    expect(yelpOnly.rows.map((r) => r.name).sort()).toEqual(["Yelp Alpha Plumbing", "Yelp Beta Plumbing"]);

    const bad = parseBusinessesQuery({ source: "foo" });
    expect(bad.filter.source).toBeUndefined();
    const all = await listBusinesses(db, bad.filter, { sort: bad.sort, limit: 50, offset: 0 });
    expect(all.total).toBe(4);
  });

  it("sort=reviewsLast30d&dir=desc orders by L30D descending", async () => {
    await seedMixed();
    const { filter, sort } = parseBusinessesQuery({ sort: "reviewsLast30d", dir: "desc" });
    expect(sort).toEqual({ field: "reviewsLast30d", dir: "desc" });
    const { rows } = await listBusinesses(db, filter, { sort, limit: 50, offset: 0 });
    expect(rows.slice(0, 2).map((r) => [r.name, r.reviewsLast30d])).toEqual([
      ["Busy Gadgets", 80],
      ["Quiet Widgets", 5],
    ]);
    const asc = parseBusinessesQuery({ sort: "reviewsLast30d", dir: "asc" });
    const ascRows = (await listBusinesses(db, asc.filter, { sort: asc.sort, limit: 50, offset: 0 })).rows;
    expect(ascRows.at(-1)?.name).toBe("Busy Gadgets");
  });

  it("/businesses?source=trustpilot&sort=reviewsLast30d&dir=desc renders the Trustpilot rows in L30D order", async () => {
    await seedMixed();
    const out = await html(
      await BusinessesPage({ searchParams: Promise.resolve({ source: "trustpilot", sort: "reviewsLast30d", dir: "desc" }) }),
    );
    expect(out).toContain("Busy Gadgets");
    expect(out).toContain("Quiet Widgets");
    expect(out.indexOf("Busy Gadgets")).toBeLessThan(out.indexOf("Quiet Widgets"));
    expect(out).not.toContain("Yelp Alpha Plumbing");
    expect(out).not.toContain("Yelp Beta Plumbing");
    expect(out).toContain("Source");
    expect(out).toContain("L30D");
    expect(out).toContain("HIGH");
  });
});

describe("AC-16.3 /businesses/[id] source panels", () => {
  it("a Trustpilot row shows trust score, socials, logo and last scraped, not the Yelp panel", async () => {
    const lastScrapedAt = new Date("2026-11-01T15:00:00Z");
    const b = await trustpilot({
      name: "Acme Gadgets",
      trustScore: "4.3",
      socialLinks: { facebook: "https://facebook.com/acme" },
      logoUrl: "https://logo.example.test/acme.png",
      lastScrapedAt,
    });
    const out = await html(await BusinessPage(idParams(b.id)));
    expect(out).toContain('data-testid="trustpilot-panel"');
    expect(out).not.toContain('data-testid="yelp-panel"');
    expect(out).toMatch(/data-testid="trust-score"[^>]*>4\.3</);
    expect(out).toContain('href="https://facebook.com/acme"');
    expect(out).toContain("Facebook");
    expect(out).toContain('src="https://logo.example.test/acme.png"');
    expect(out).toContain("Last scraped");
  });

  it("a Yelp row shows the Yelp panel, not the Trustpilot one", async () => {
    const b = await insertBusiness(db, { name: "Bayou Plumbing Co" });
    const out = await html(await BusinessPage(idParams(b.id)));
    expect(out).toContain('data-testid="yelp-panel"');
    expect(out).not.toContain('data-testid="trustpilot-panel"');
  });
});

describe("AC-16.4 Yelp not-configured state", () => {
  it("/searches/new without YELP_API_KEY explains how to enable Yelp and has no form", async () => {
    vi.stubEnv("YELP_API_KEY", "");
    const out = await html(await NewSearchPage());
    expect(out).toContain("Yelp search is not configured");
    expect(out).toContain("YELP_API_KEY");
    expect(out).not.toContain("<form");
  });

  it("/searches/new with YELP_API_KEY renders the form", async () => {
    vi.stubEnv("YELP_API_KEY", "test-key");
    const out = await html(await NewSearchPage());
    expect(out).toContain("<form");
    expect(out).not.toContain("Yelp search is not configured");
  });

  it("/searches hides the New search link and shows the notice without the key", async () => {
    vi.stubEnv("YELP_API_KEY", "");
    const out = await html(await SearchesPage());
    expect(out).toContain("Yelp search is not configured");
    expect(out).not.toContain("New search");
    expect(out).not.toContain('href="/searches/new"');
  });

  it("/searches shows the New search link with the key", async () => {
    vi.stubEnv("YELP_API_KEY", "test-key");
    const out = await html(await SearchesPage());
    expect(out).toContain("New search");
    expect(out).toContain('href="/searches/new"');
    expect(out).not.toContain("Yelp search is not configured");
  });
});

describe("command palette pages", () => {
  it("lists Lookup, Leads, Calling, Email, Overview, Settings, Design in order", () => {
    expect(PAGES.map((p) => p.label)).toEqual(["Lookup", "Leads", "Calling", "Email", "Overview", "Settings", "Design"]);
    expect(PAGES.map((p) => p.href)).toEqual(["/lookup", "/leads", "/calling", "/email", "/overview", "/settings", "/design"]);
  });
});
