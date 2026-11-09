import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ilike, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { searchAll } from "@/db/repo/search";
import { createCallCampaign } from "@/db/repo/call-campaigns";
import { createEmailCampaign } from "@/db/repo/email-campaigns";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { insertBusiness } from "./helpers/builders";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  // Three ABC Plumbing locations (713555 phones), ten other Houston plumbers with distinct scores,
  // and one dentist whose phone, name and city match none of the queries below.
  const abc = [
    { city: "Houston", phone: "+17135550101", score: 70 },
    { city: "Dallas", phone: "+17135550102", score: 75 },
    { city: "Austin", phone: "+17135550103", score: 65 },
  ];
  for (const a of abc) await insertBusiness(db, { name: "ABC Plumbing", ...a, state: "TX" });
  for (let i = 1; i <= 10; i++) {
    await insertBusiness(db, { name: `Bayou Plumbing ${i}`, city: "Houston", state: "TX", score: 50 + i * 3 });
  }
  await insertBusiness(db, {
    name: "Lone Star Dental",
    city: "Dallas",
    state: "TX",
    phone: "+12145550199",
    categories: [{ alias: "dentists", title: "Dentists" }],
    primaryCategory: "dentists",
  });

  await createCallCampaign(db, { name: "Houston plumbers — Q4 outreach", status: "running" });
  await createCallCampaign(db, { name: "Dallas HVAC — spring tune-ups", status: "draft" });
  await createEmailCampaign(db, {
    name: "Owner intro sequence",
    status: "running",
    fromName: "Alex",
    fromEmail: "alex@example.com",
    steps: [{ stepOrder: 1, delayDays: 0, subject: "Hello", body: "Hi." }],
  });
});
afterAll(async () => {
  await close();
});

/** Independent ground truth: businesses whose name contains `s`, case-insensitive. */
async function idsByName(s: string): Promise<string[]> {
  const rows = await db.select({ id: businesses.id }).from(businesses).where(ilike(businesses.name, `%${s}%`));
  return rows.map((r) => r.id).sort();
}

/** Independent ground truth: businesses whose name or city contains `s`, case-insensitive. */
async function countByNameOrCity(s: string): Promise<number> {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(or(ilike(businesses.name, `%${s}%`), ilike(businesses.city, `%${s}%`)));
  return rows.length;
}

describe("searchAll: business matching", () => {
  it("'abc' returns every ABC Plumbing business, and each hit matches by name, city or phone", async () => {
    const expected = await idsByName("ABC Plumbing");
    // Built data: the same name exists in three cities.
    expect(expected).toHaveLength(3);

    const res = await searchAll(db, "abc");
    const got = res.businesses.map((b) => b.id);
    for (const id of expected) expect(got).toContain(id);

    const q = "abc";
    for (const b of res.businesses) {
      const byName = b.name.toLowerCase().includes(q);
      const byCity = (b.city ?? "").toLowerCase().includes(q);
      const byPhone = q.replace(/\D/g, "").length >= 3 && (b.phoneDigits ?? "").includes(q.replace(/\D/g, ""));
      expect(byName || byCity || byPhone, `${b.name} (${b.city}) should match "abc"`).toBe(true);
    }
  });

  it("the ABC Plumbing rows span multiple cities", async () => {
    const res = await searchAll(db, "ABC Plumbing");
    const cities = new Set(res.businesses.map((b) => b.city));
    expect(cities.size).toBeGreaterThanOrEqual(3);
    expect(cities).toEqual(new Set(["Houston", "Dallas", "Austin"]));
  });

  it("matches by city, case-insensitively", async () => {
    const res = await searchAll(db, "hOuStOn", 50);
    expect(res.businesses).toHaveLength(11); // 1 ABC Plumbing + 10 Bayou Plumbing in Houston
    for (const b of res.businesses) {
      expect(`${b.name} ${b.city}`.toLowerCase()).toContain("houston");
    }
  });

  it("'713555' matches by phone digits", async () => {
    const res = await searchAll(db, "713555", 50);
    expect(res.businesses).toHaveLength(13); // 3 ABC Plumbing + 10 Bayou Plumbing, all 713555; the dentist is 214555
    for (const b of res.businesses) expect(b.phoneDigits).toContain("713555");
    expect(res.businesses.map((b) => b.name)).not.toContain("Lone Star Dental");
  });

  it("a formatted query '(713) 555' matches the same way", async () => {
    const formatted = await searchAll(db, "(713) 555");
    const plain = await searchAll(db, "713555");
    expect(formatted.businesses.length).toBeGreaterThan(0);
    for (const b of formatted.businesses) expect(b.phoneDigits).toContain("713555");
    expect(formatted.businesses.map((b) => b.id)).toEqual(plain.businesses.map((b) => b.id));
  });
});

describe("searchAll: campaigns", () => {
  it("matches call campaign names case-insensitively", async () => {
    const res = await searchAll(db, "HOUSTON PLUMBERS");
    expect(res.callCampaigns.map((c) => c.name)).toEqual(["Houston plumbers — Q4 outreach"]);
    expect(res.emailCampaigns).toEqual([]);
  });

  it("matches email campaign names case-insensitively", async () => {
    const res = await searchAll(db, "owner INTRO");
    expect(res.emailCampaigns.map((c) => c.name)).toEqual(["Owner intro sequence"]);
    expect(res.callCampaigns).toEqual([]);
  });

  it("matches the other call campaign too", async () => {
    const res = await searchAll(db, "dallas hvac");
    expect(res.callCampaigns.map((c) => c.name)).toEqual(["Dallas HVAC — spring tune-ups"]);
  });

  it("a business-only query returns no campaigns", async () => {
    const res = await searchAll(db, "ABC Plumbing");
    expect(res.businesses.length).toBeGreaterThan(0);
    expect(res.callCampaigns).toEqual([]);
    expect(res.emailCampaigns).toEqual([]);
  });
});

describe("searchAll: limits", () => {
  it("defaults to 8 per group when more than 8 businesses match", async () => {
    const total = await countByNameOrCity("plumb");
    expect(total).toBeGreaterThan(8);
    const res = await searchAll(db, "plumb");
    expect(res.businesses).toHaveLength(8);
  });

  it("an explicit limit of 3 returns at most 3 per group", async () => {
    const res = await searchAll(db, "plumb", 3);
    expect(res.businesses).toHaveLength(3);
    expect(res.callCampaigns.length).toBeLessThanOrEqual(3);
    expect(res.emailCampaigns.length).toBeLessThanOrEqual(3);
  });

  it("applies the limit to campaign groups too", async () => {
    // "e" matches every campaign name; with limit 1 each group is capped at 1.
    const all = await searchAll(db, "e", 50);
    expect(all.callCampaigns.length).toBeGreaterThan(1);
    const res = await searchAll(db, "e", 1);
    expect(res.businesses.length).toBeLessThanOrEqual(1);
    expect(res.callCampaigns).toHaveLength(1);
    expect(res.emailCampaigns.length).toBeLessThanOrEqual(1);
  });
});

describe("searchAll: edge cases", () => {
  it.each(["", "   ", "\t\n "])("empty/whitespace query %j returns three empty arrays", async (q) => {
    expect(await searchAll(db, q)).toEqual({ businesses: [], callCampaigns: [], emailCampaigns: [] });
  });

  it("treats % literally (does not match everything)", async () => {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(businesses)) as { n: number }[];
    expect(n).toBeGreaterThan(0);
    const res = await searchAll(db, "%", 50);
    expect(res.businesses).toEqual([]);
    expect(res.callCampaigns).toEqual([]);
    expect(res.emailCampaigns).toEqual([]);
  });

  it("treats _ literally (does not match every single character)", async () => {
    const res = await searchAll(db, "_", 50);
    expect(res.businesses).toEqual([]);
    expect(res.callCampaigns).toEqual([]);
    expect(res.emailCampaigns).toEqual([]);
  });

  it("a wildcard embedded in a real term does not widen the match", async () => {
    // As a LIKE pattern, "ABC%Plumbing" and "AB_ Plumbing" would match "ABC Plumbing".
    expect((await searchAll(db, "ABC%Plumbing")).businesses).toEqual([]);
    expect((await searchAll(db, "AB_ Plumbing")).businesses).toEqual([]);
  });
});

describe("searchAll: ordering", () => {
  it("returns businesses by score descending", async () => {
    const res = await searchAll(db, "plumb", 50);
    expect(res.businesses.length).toBeGreaterThan(1);
    const scores = res.businesses.map((b) => b.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});
