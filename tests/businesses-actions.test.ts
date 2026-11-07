import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listActivities, logActivity } from "@/db/repo/activities";
import { getBusiness, upsertBusinessByYelpId } from "@/db/repo/businesses";
import type { Business, NewBusiness } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { normalizeName, phoneDigits } from "@/lib/format";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { bulkAddTagAction, bulkDoNotCallAction, bulkUpdateStatusAction, deleteBusinessAction, logNoteAction, updateBusinessCrmAction } =
  await import("@/features/businesses/actions");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // Actions call getDb(); point the process-wide handle at the test DB.
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, activities RESTART IDENTITY CASCADE`);
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

let seq = 0;
function makeRow(overrides: Partial<NewBusiness> = {}): NewBusiness {
  seq += 1;
  const name = overrides.name ?? `Business ${seq}`;
  const phone = overrides.phone === undefined ? `+1713555${String(1000 + seq).slice(-4)}` : overrides.phone;
  return {
    yelpId: `yelp-${seq}`,
    name,
    nameNormalized: normalizeName(name),
    phone,
    phoneDigits: phoneDigits(phone),
    rating: "4.0",
    reviewCount: 20,
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    city: "Houston",
    state: "TX",
    raw: {},
    ...overrides,
  };
}

async function createBusiness(overrides: Partial<NewBusiness> = {}): Promise<Business> {
  return (await upsertBusinessByYelpId(db, makeRow(overrides))).business;
}

async function createMany(n: number): Promise<Business[]> {
  const out: Business[] = [];
  for (let i = 0; i < n; i++) out.push(await createBusiness());
  return out;
}

async function mustGet(id: string): Promise<Business> {
  const b = await getBusiness(db, id);
  if (!b) throw new Error(`business ${id} not found`);
  return b;
}

const statusChanges = async (id: string) => (await listActivities(db, id)).filter((a) => a.type === "status_change");

describe("updateBusinessCrmAction", () => {
  it("rejects an invalid owner email and saves nothing", async () => {
    const b = await createBusiness();
    const r = await updateBusinessCrmAction(
      b.id,
      null,
      form({ status: "contacted", ownerName: "Pat Owner", ownerEmail: "not-an-email" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.ownerEmail?.[0]).toBe("Enter a valid email");

    const after = await mustGet(b.id);
    expect(after.ownerEmail).toBeNull();
    expect(after.ownerName).toBeNull();
    expect(after.status).toBe("new");
    expect(await listActivities(db, b.id)).toHaveLength(0);
  });

  it("persists a valid save with normalized fields", async () => {
    const b = await createBusiness();
    const r = await updateBusinessCrmAction(
      b.id,
      null,
      form({
        status: "interested",
        ownerName: "  Pat Owner ",
        ownerEmail: "pat@example.com",
        tags: "a, b, a",
        doNotCall: "on",
        nextFollowUpAt: "2026-12-01T09:30",
        notes: "Prefers mornings",
      }),
    );
    expect(r.ok).toBe(true);

    const after = await mustGet(b.id);
    expect(after.ownerName).toBe("Pat Owner");
    expect(after.ownerEmail).toBe("pat@example.com");
    expect(after.tags).toEqual(["a", "b"]);
    expect(after.doNotCall).toBe(true);
    expect(after.doNotEmail).toBe(false);
    expect(after.status).toBe("interested");
    expect(after.notes).toBe("Prefers mornings");
    expect(after.nextFollowUpAt).toBeInstanceOf(Date);
    expect(Number.isNaN(after.nextFollowUpAt?.getTime())).toBe(false);
    // 09:30 local (America/Chicago by default) on 2026-12-01 falls on that calendar day in UTC too.
    expect(after.nextFollowUpAt?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("stores a blank owner email as null", async () => {
    const b = await createBusiness({});
    await updateBusinessCrmAction(b.id, null, form({ status: "new", ownerEmail: "pat@example.com" }));
    expect((await mustGet(b.id)).ownerEmail).toBe("pat@example.com");

    const r = await updateBusinessCrmAction(b.id, null, form({ status: "new", ownerEmail: "   " }));
    expect(r.ok).toBe(true);
    expect((await mustGet(b.id)).ownerEmail).toBeNull();
  });

  it("rejects an invalid status and an unparseable follow-up date", async () => {
    const b = await createBusiness();
    const r = await updateBusinessCrmAction(b.id, null, form({ status: "bogus", nextFollowUpAt: "tomorrow" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.status?.[0]).toBe("Choose a status");
    expect(r.fieldErrors?.nextFollowUpAt?.[0]).toBe("Enter a valid date");
    expect((await mustGet(b.id)).status).toBe("new");
  });

  it("returns ok:false for an unknown business", async () => {
    const r = await updateBusinessCrmAction("00000000-0000-4000-8000-000000000000", null, form({ status: "new" }));
    expect(r.ok).toBe(false);
  });

  it("logs exactly one status_change when the status changes, and none when it does not", async () => {
    const b = await createBusiness();
    const r = await updateBusinessCrmAction(b.id, null, form({ status: "contacted" }));
    expect(r.ok).toBe(true);

    const changes = await statusChanges(b.id);
    expect(changes).toHaveLength(1);
    expect(changes[0].metadata).toEqual({ from: "new", to: "contacted" });

    const again = await updateBusinessCrmAction(b.id, null, form({ status: "contacted", ownerName: "Someone" }));
    expect(again.ok).toBe(true);
    expect((await mustGet(b.id)).ownerName).toBe("Someone");
    expect(await statusChanges(b.id)).toHaveLength(1);
  });
});

describe("logNoteAction", () => {
  it.each([["empty", ""], ["whitespace", "  \n\t "]])("rejects an %s body and creates no activity", async (_label, body) => {
    const b = await createBusiness();
    const r = await logNoteAction(b.id, null, form({ body }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.body?.[0]).toBe("Body is required");
    expect(await listActivities(db, b.id)).toHaveLength(0);
  });

  it("rejects a missing body field", async () => {
    const b = await createBusiness();
    const r = await logNoteAction(b.id, null, new FormData());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.body?.[0]).toBe("Body is required");
  });

  it("stores a note with the trimmed body, newest first", async () => {
    const b = await createBusiness();
    // An older activity, so the ordering does not depend on same-millisecond timestamps.
    await logActivity(db, { businessId: b.id, type: "note", body: "older note", occurredAt: new Date("2020-01-01T00:00:00Z") });

    const r = await logNoteAction(b.id, null, form({ body: "  Called, left voicemail  " }));
    expect(r.ok).toBe(true);

    const acts = await listActivities(db, b.id);
    expect(acts).toHaveLength(2);
    expect(acts[0].type).toBe("note");
    expect(acts[0].body).toBe("Called, left voicemail");
    expect(acts[1].body).toBe("older note");
  });

  it("returns ok:false for an unknown business", async () => {
    const r = await logNoteAction("00000000-0000-4000-8000-000000000000", null, form({ body: "hello" }));
    expect(r.ok).toBe(false);
  });
});

describe("bulkUpdateStatusAction", () => {
  it("updates all selected businesses and logs one status_change each", async () => {
    const rows = await createMany(3);
    const ids = rows.map((r) => r.id);
    const r = await bulkUpdateStatusAction(ids, "contacted");
    expect(r).toEqual({ ok: true, data: { updated: 3 } });

    for (const id of ids) {
      expect((await mustGet(id)).status).toBe("contacted");
      const changes = await statusChanges(id);
      expect(changes).toHaveLength(1);
      expect(changes[0].metadata).toMatchObject({ from: "new", to: "contacted" });
    }
    const total = (await Promise.all(ids.map(statusChanges))).flat();
    expect(total).toHaveLength(3);
  });

  it("skips businesses that already have the status", async () => {
    const rows = await createMany(2);
    await bulkUpdateStatusAction([rows[0].id], "contacted");
    const r = await bulkUpdateStatusAction(
      rows.map((x) => x.id),
      "contacted",
    );
    expect(r).toEqual({ ok: true, data: { updated: 1 } });
    expect(await statusChanges(rows[0].id)).toHaveLength(1);
  });

  it("fails for an unknown status or empty ids", async () => {
    const [b] = await createMany(1);
    const bad = await bulkUpdateStatusAction([b.id], "bogus" as never);
    expect(bad.ok).toBe(false);
    expect((await mustGet(b.id)).status).toBe("new");

    const empty = await bulkUpdateStatusAction([], "contacted");
    expect(empty.ok).toBe(false);
  });
});

describe("bulkAddTagAction", () => {
  it("adds the tag once and never duplicates it", async () => {
    const rows = await createMany(3);
    const ids = rows.map((r) => r.id);
    await bulkAddTagAction([ids[0]], "existing");

    const first = await bulkAddTagAction(ids, "vip");
    expect(first).toEqual({ ok: true, data: { updated: 3 } });
    for (const id of ids) expect((await mustGet(id)).tags).toContain("vip");
    expect((await mustGet(ids[0])).tags).toEqual(["existing", "vip"]);

    const second = await bulkAddTagAction(ids, "vip");
    expect(second).toEqual({ ok: true, data: { updated: 0 } });
    for (const id of ids) expect((await mustGet(id)).tags.filter((t) => t === "vip")).toHaveLength(1);
  });

  it("rejects a blank tag with a tag field error", async () => {
    const [b] = await createMany(1);
    const r = await bulkAddTagAction([b.id], "   ");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.tag).toBeDefined();
    expect((await mustGet(b.id)).tags).toEqual([]);
  });

  it("rejects empty ids", async () => {
    const r = await bulkAddTagAction([], "vip");
    expect(r.ok).toBe(false);
  });
});

describe("bulkDoNotCallAction", () => {
  it("sets doNotCall on all selected businesses", async () => {
    const rows = await createMany(3);
    const ids = rows.map((r) => r.id);
    const r = await bulkDoNotCallAction(ids);
    expect(r).toEqual({ ok: true, data: { updated: 3 } });
    for (const id of ids) expect((await mustGet(id)).doNotCall).toBe(true);

    const again = await bulkDoNotCallAction(ids);
    expect(again).toEqual({ ok: true, data: { updated: 0 } });
  });

  it("rejects empty ids", async () => {
    const r = await bulkDoNotCallAction([]);
    expect(r.ok).toBe(false);
  });
});

describe("deleteBusinessAction", () => {
  it("removes the business, and a second call fails", async () => {
    const b = await createBusiness();
    await logNoteAction(b.id, null, form({ body: "will be removed with the business" }));

    const r = await deleteBusinessAction(b.id);
    expect(r.ok).toBe(true);
    expect(await getBusiness(db, b.id)).toBeNull();
    expect(await listActivities(db, b.id)).toHaveLength(0);

    const again = await deleteBusinessAction(b.id);
    expect(again.ok).toBe(false);
  });
});
