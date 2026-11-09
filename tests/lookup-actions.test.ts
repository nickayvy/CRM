import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createElement } from "react";
import { prerender } from "react-dom/static";
import type { Db } from "@/db/client";
import { addRelation, upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { listLeads } from "@/db/repo/leads";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness, makeTrustpilotRow } from "./helpers/builders";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const auth = vi.hoisted(() => ({ user: null as { id: string; email: string | null } | null }));

vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => auth.user,
  requireUser: async () => {
    if (!auth.user) throw new Error("NEXT_REDIRECT /login");
    return auth.user;
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/lookup",
  useSearchParams: () => new URLSearchParams(),
}));

const { addToLeadsAction, getDossierAction } = await import("@/features/lookup/actions");
const { loadGraph, loadGrid } = await import("@/features/lookup/data");
const { GET } = await import("@/app/api/lookup/graph/route");
const { default: LookupPage } = await import("@/app/lookup/page");
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
  auth.user = { id: USER_ID, email: "sdr@example.test" };
  await db.execute(sql`TRUNCATE TABLE businesses, leads, business_relations RESTART IDENTITY CASCADE`);
});

async function trustpilot(overrides: Parameters<typeof makeTrustpilotRow>[0] = {}) {
  return (await upsertBusinessByTrustpilotId(db, makeTrustpilotRow(overrides))).business;
}

describe("addToLeadsAction", () => {
  it("creates a lead for the signed-in user, then reports it as existing", async () => {
    const b = await trustpilot({ name: "Acme Gadgets" });
    expect(await addToLeadsAction(b.id)).toEqual({ ok: true, data: { created: true } });
    expect(await addToLeadsAction(b.id)).toEqual({ ok: true, data: { created: false } });
    const leads = await listLeads(db, USER_ID);
    expect(leads.map((l) => l.businessId)).toEqual([b.id]);
  });
  it("fails for unknown or malformed ids without writing", async () => {
    expect(await addToLeadsAction("11111111-1111-4111-8111-111111111111")).toMatchObject({ ok: false, message: "Business not found" });
    expect(await addToLeadsAction("nope")).toMatchObject({ ok: false });
    expect(await listLeads(db, USER_ID)).toEqual([]);
  });
  it("requires a user", async () => {
    auth.user = null;
    const b = await trustpilot();
    await expect(addToLeadsAction(b.id)).rejects.toThrow(/login/);
  });
});

describe("getDossierAction", () => {
  it("returns the business with its real sync time and similar companies in both directions", async () => {
    const scraped = new Date("2026-11-01T12:00:00Z");
    const a = await trustpilot({ name: "Alpha", lastScrapedAt: scraped, reviewsLast30d: 60, rating: "4.7" });
    const b = await trustpilot({ name: "Beta" });
    const c = await trustpilot({ name: "Gamma" });
    await addRelation(db, a.id, b.id);
    await addRelation(db, c.id, a.id);
    const res = await getDossierAction(a.id);
    if (!res.ok) throw new Error(res.message);
    expect(res.data.business).toMatchObject({ name: "Alpha", source: "trustpilot", rating: 4.7, reviewsLast30d: 60 });
    expect(res.data.business.lastSyncedAt).toBe(scraped.toISOString());
    expect(res.data.related.map((r) => r.name)).toEqual(["Beta", "Gamma"]);
  });
  it("falls back to updatedAt when never scraped, and fails for unknown ids", async () => {
    const y = await insertBusiness(db, { name: "Yelp Plumbing" });
    const res = await getDossierAction(y.id);
    if (!res.ok) throw new Error(res.message);
    expect(res.data.business.lastSyncedAt).toBe(new Date(y.updatedAt).toISOString());
    expect(res.data.business.source).toBe("yelp");
    expect(await getDossierAction("11111111-1111-4111-8111-111111111111")).toMatchObject({ ok: false });
  });
});

describe("loaders", () => {
  it("loads graph nodes with only the links among them", async () => {
    const a = await trustpilot({ reviewCount: 900 });
    const b = await trustpilot({ reviewCount: 10 });
    await addRelation(db, a.id, b.id);
    const g = await loadGraph(db);
    expect(g.nodes.map((n) => n.id)).toEqual([a.id, b.id]);
    expect(g.links).toEqual([{ source: a.id, target: b.id }]);
  });
  it("pages and filters the grid by URL query, most reviews first", async () => {
    await trustpilot({ name: "Big TP", reviewCount: 5000, reviewsLast30d: 80 });
    await trustpilot({ name: "Small TP", reviewCount: 30 });
    await insertBusiness(db, { name: "Yelp One", reviewCount: 100 });
    const all = await loadGrid(db, { filter: {}, offset: 0 });
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.name)).toEqual(["Big TP", "Yelp One", "Small TP"]);
    expect((await loadGrid(db, { filter: { source: "yelp" }, offset: 0 })).rows.map((r) => r.name)).toEqual(["Yelp One"]);
    expect((await loadGrid(db, { filter: { minL30d: 50 }, offset: 0 })).rows.map((r) => r.name)).toEqual(["Big TP"]);
    expect((await loadGrid(db, { filter: {}, offset: 50 })).rows).toEqual([]);
  });
});

describe("GET /api/lookup/graph", () => {
  it("401 without a user, nodes and links with one", async () => {
    auth.user = null;
    expect((await GET()).status).toBe(401);
    auth.user = { id: USER_ID, email: null };
    await trustpilot({ name: "Node" });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: { name: string }[]; links: unknown[] };
    expect(body.nodes.map((n) => n.name)).toEqual(["Node"]);
    expect(body.links).toEqual([]);
  });
});

describe("/lookup page (server render)", () => {
  async function render(sp: Record<string, string> = {}) {
    // The root layout provides TooltipProvider; prerender waits for the suspended grid section.
    const el = await LookupPage({ searchParams: Promise.resolve(sp) });
    const { prelude } = await prerender(createElement(TooltipProvider, null, el));
    return (await new Response(prelude).text()).replaceAll("<!-- -->", "");
  }
  it("renders the empty state with the discovery notice and no sample data", async () => {
    const html = await render();
    expect(html).toContain("Business network");
    expect(html).toContain("No businesses yet");
    expect(html).toContain("Set FIRECRAWL_API_KEY to enable discovery");
    expect(html).toContain("grid-empty");
    expect(html).not.toContain("business-card");
    expect(html).not.toContain("network-graph");
  });
  it("renders with rows and filters from the URL", async () => {
    await trustpilot({ name: "Acme Gadgets", reviewCount: 800 });
    const html = await render({ category: "electronics_technology" });
    expect(html).toContain("category-bubbles");
    expect(html).toContain("title=\"Electronics &amp; Technology: 1 business. Click to filter.\"");
    expect(html).toContain("Acme Gadgets");
    expect(html).toContain("1–1 of 1");
    expect(html).toContain("Page 1 of 1");
  });
});
