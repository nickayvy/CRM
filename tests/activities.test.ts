import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listActivities, listRecentActivities, logActivity } from "@/db/repo/activities";
import { activities, businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";

let db: Db;
let close: () => Promise<void>;
let bizA: string;
let bizB: string;
let bizC: string;

async function makeBusiness(yelpId: string, name: string): Promise<string> {
  const [row] = await db
    .insert(businesses)
    .values({ yelpId, name, nameNormalized: name.toLowerCase(), categories: [], raw: {} })
    .returning({ id: businesses.id });
  return row.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  bizA = await makeBusiness("act-a", "Alpha Plumbing");
  bizB = await makeBusiness("act-b", "Beta Plumbing");
  bizC = await makeBusiness("act-c", "Gamma Plumbing");
});
afterAll(async () => {
  await close();
});

const at = (iso: string) => new Date(iso);

describe("logActivity", () => {
  it("applies defaults for omitted fields", async () => {
    const a = await logActivity(db, { businessId: bizA, type: "note" });
    expect(a.id).toBeTruthy();
    expect(a.businessId).toBe(bizA);
    expect(a.type).toBe("note");
    expect(a.body).toBe("");
    expect(a.metadata).toEqual({});
    expect(a.outcome).toBeNull();
    expect(a.campaignType).toBeNull();
    expect(a.campaignId).toBeNull();
    expect(a.agent).toBeNull();
    expect(a.occurredAt).toBeInstanceOf(Date);
    expect(a.createdAt).toBeInstanceOf(Date);
  });

  it("persists all optional fields", async () => {
    const campaignId = "11111111-1111-4111-8111-111111111111";
    const when = at("2026-01-02T03:04:05Z");
    const a = await logActivity(db, {
      businessId: bizA,
      type: "call",
      body: "Left a voicemail",
      outcome: "voicemail",
      metadata: { durationSec: 42, nested: { ok: true } },
      campaignType: "call",
      campaignId,
      agent: "agent-7",
      occurredAt: when,
    });
    expect(a).toMatchObject({
      businessId: bizA,
      type: "call",
      body: "Left a voicemail",
      outcome: "voicemail",
      metadata: { durationSec: 42, nested: { ok: true } },
      campaignType: "call",
      campaignId,
      agent: "agent-7",
    });
    expect(a.occurredAt.toISOString()).toBe(when.toISOString());

    const [stored] = await db.select().from(activities).where(eq(activities.id, a.id));
    expect(stored).toEqual(a);
  });

  it("supports the email campaign type", async () => {
    const a = await logActivity(db, { businessId: bizA, type: "email", campaignType: "email" });
    expect(a.campaignType).toBe("email");
  });
});

describe("listActivities", () => {
  it("returns newest first by occurredAt, scoped to one business", async () => {
    const oldest = await logActivity(db, { businessId: bizB, type: "note", body: "old", occurredAt: at("2025-03-01T00:00:00Z") });
    const newest = await logActivity(db, { businessId: bizB, type: "note", body: "new", occurredAt: at("2025-03-03T00:00:00Z") });
    const middle = await logActivity(db, { businessId: bizB, type: "note", body: "mid", occurredAt: at("2025-03-02T00:00:00Z") });
    await logActivity(db, { businessId: bizC, type: "note", body: "other biz", occurredAt: at("2025-03-04T00:00:00Z") });

    const list = await listActivities(db, bizB);
    expect(list.map((x) => x.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(list.every((x) => x.businessId === bizB)).toBe(true);
  });

  it("respects limit", async () => {
    const list = await listActivities(db, bizB, { limit: 2 });
    expect(list.map((x) => x.body)).toEqual(["new", "mid"]);
  });

  it("returns an empty array for a business with no activities", async () => {
    const empty = await makeBusiness("act-empty", "Empty Plumbing");
    expect(await listActivities(db, empty)).toEqual([]);
  });
});

describe("listRecentActivities", () => {
  it("joins businessName and orders newest first across businesses", async () => {
    const x = await logActivity(db, { businessId: bizA, type: "system", body: "x", occurredAt: at("2030-01-01T00:00:00Z") });
    const y = await logActivity(db, { businessId: bizC, type: "system", body: "y", occurredAt: at("2030-01-03T00:00:00Z") });
    const z = await logActivity(db, { businessId: bizB, type: "system", body: "z", occurredAt: at("2030-01-02T00:00:00Z") });

    const recent = await listRecentActivities(db, 3);
    expect(recent.map((r) => r.id)).toEqual([y.id, z.id, x.id]);
    expect(recent.map((r) => r.businessName)).toEqual(["Gamma Plumbing", "Beta Plumbing", "Alpha Plumbing"]);
    // still carries the full activity row
    expect(recent[0]).toMatchObject({ body: "y", type: "system", businessId: bizC });
  });

  it("respects limit", async () => {
    const recent = await listRecentActivities(db, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0].body).toBe("y");
  });
});

describe("cascade delete", () => {
  it("removes a business's activities when the business is deleted", async () => {
    const doomed = await makeBusiness("act-doomed", "Doomed Plumbing");
    await logActivity(db, { businessId: doomed, type: "note" });
    await logActivity(db, { businessId: doomed, type: "call" });
    expect(await listActivities(db, doomed)).toHaveLength(2);
    const otherBefore = await listActivities(db, bizB);

    await db.delete(businesses).where(eq(businesses.id, doomed));

    expect(await db.select().from(activities).where(eq(activities.businessId, doomed))).toEqual([]);
    expect(await listActivities(db, bizB)).toEqual(otherBefore);
  });
});
