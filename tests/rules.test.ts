import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import type { Db } from "@/db/client";
import { DEFAULT_CHAIN_PATTERNS, getRules, updateRules } from "@/db/repo/rules";
import { qualificationRules } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

const rowCount = async () => Number((await db.select({ n: count() }).from(qualificationRules))[0].n);

describe("DEFAULT_CHAIN_PATTERNS", () => {
  it("is non-empty and all lowercase", () => {
    expect(DEFAULT_CHAIN_PATTERNS.length).toBeGreaterThan(0);
    for (const p of DEFAULT_CHAIN_PATTERNS) expect(p, p).toBe(p.toLowerCase());
  });
  it("includes the plumbing chains from the architecture doc", () => {
    expect(DEFAULT_CHAIN_PATTERNS).toContain("roto-rooter");
    expect(DEFAULT_CHAIN_PATTERNS).toContain("mr. rooter");
  });
});

describe("rules repo", () => {
  it("starts with no rules row", async () => {
    expect(await rowCount()).toBe(0);
  });

  it("getRules auto-creates the id=1 row with defaults", async () => {
    const r = await getRules(db);
    expect(r.id).toBe(1);
    expect(r.minRating).toBe("3.5");
    expect(r.minReviews).toBe(5);
    expect(r.maxReviews).toBeNull();
    expect(r.requirePhone).toBe(true);
    expect(r.rejectClosed).toBe(true);
    expect(r.rejectChains).toBe(true);
    expect(r.categoryStrict).toBe(true);
    expect(r.distanceTolerancePct).toBe(10);
    expect(r.multiLocationThreshold).toBe(3);
    expect(r.reviewScoreBelow).toBe(40);
    expect(r.chainPatterns).toEqual(DEFAULT_CHAIN_PATTERNS);
    expect(r.updatedAt).toBeInstanceOf(Date);
    expect(await rowCount()).toBe(1);
  });

  it("calling getRules again keeps exactly one row", async () => {
    const a = await getRules(db);
    const b = await getRules(db);
    expect(b).toEqual(a);
    expect(await rowCount()).toBe(1);
  });

  it("updateRules persists a patch, bumps updatedAt, and getRules reflects it", async () => {
    const before = await getRules(db);
    await new Promise((r) => setTimeout(r, 15));
    const patch = { minRating: "4.5", maxReviews: 300, chainPatterns: ["acme", "foo bar"] };
    const updated = await updateRules(db, patch);

    expect(updated.id).toBe(1);
    expect(updated.minRating).toBe("4.5");
    expect(updated.maxReviews).toBe(300);
    expect(updated.chainPatterns).toEqual(["acme", "foo bar"]);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    // untouched fields keep their values
    expect(updated.minReviews).toBe(5);
    expect(updated.requirePhone).toBe(true);

    const reread = await getRules(db);
    expect(reread).toEqual(updated);
    expect(await rowCount()).toBe(1);
  });

  it("updateRules can set maxReviews back to null and toggle booleans", async () => {
    const updated = await updateRules(db, { maxReviews: null, rejectChains: false });
    expect(updated.maxReviews).toBeNull();
    expect(updated.rejectChains).toBe(false);
    expect(updated.minRating).toBe("4.5");
  });
});
