// WP-05 tests for the calling server actions, form schema, time/script helpers
// and the two route handlers.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import type { Db } from "@/db/client";
import {
  addBusinessesToCampaign,
  claimNext,
  createCallCampaign,
  getCallCampaign,
  getQueueItem,
  listCallCampaigns,
  listQueue,
  recordOutcome,
} from "@/db/repo/call-campaigns";
import { addLead } from "@/db/repo/leads";
import {
  type Business,
  type CallCampaign,
  type NewBusiness,
  type NewCallCampaign,
  activities,
  businesses,
  callQueueItems,
  leads,
} from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { normalizeName, phoneDigits } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import { parseCampaignForm } from "@/features/calling/schema";
import {
  TIME_STEP_MINUTES,
  defaultCallbackValue,
  isWithinHours,
  localDayBounds,
  parseLocalDateTime,
  timeOptions,
} from "@/features/calling/time";
import { fillScript } from "@/features/calling/script-tokens";
import type { CampaignStatusPayload, DialerClaim } from "@/features/calling/types";

// ---------------------------------------------------------------- mocks

const cookieJar = vi.hoisted(() => new Map<string, string>());

// AI dispatch from Start/Resume goes through this fake instead of ElevenLabs.
const aiPlacer = vi.hoisted(() => ({
  calls: [] as { toNumber: string }[],
  fail: undefined as string | undefined,
  missing: [] as string[],
}));
vi.mock("@/lib/elevenlabs/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/elevenlabs/client")>();
  return {
    ...real,
    missingElevenLabsConfig: () => aiPlacer.missing,
    createElevenLabsCaller: () => ({
      async placeCall(input: { toNumber: string }) {
        if (aiPlacer.fail) throw new Error(aiPlacer.fail);
        aiPlacer.calls.push(input);
        return { conversationId: `conv_${aiPlacer.calls.length}_${Date.now()}`, callSid: `CA${aiPlacer.calls.length}` };
      },
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void cookieJar.set(name, value),
    delete: (name: string) => void cookieJar.delete(name),
  }),
}));

const {
  addBusinessesAction,
  claimNextAction,
  createCampaignAction,
  deleteCampaignAction,
  pauseAction,
  previewAddAction,
  recordOutcomeAction,
  removeQueueItemAction,
  resumeAction,
  setAgentAction,
  skipAction,
  startAction,
  updateCampaignAction,
} = await import("@/features/calling/actions");
const cronRoute = await import("@/app/api/cron/campaigns/route");
const statusRoute = await import("@/app/api/calling/[id]/status/route");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  // Actions and route handlers call getDb(); point the process-wide handle at the test DB.
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  vi.unstubAllEnvs();
  await close();
});
beforeEach(async () => {
  cookieJar.clear();
  aiPlacer.calls.length = 0;
  aiPlacer.fail = undefined;
  aiPlacer.missing = [];
  vi.unstubAllEnvs();
  await db.execute(sql`TRUNCATE TABLE call_queue_items, call_campaigns, activities, businesses RESTART IDENTITY CASCADE`);
});

// ---------------------------------------------------------------- fixtures

let seq = 0;

async function makeBusiness(overrides: Partial<NewBusiness> = {}): Promise<Business> {
  seq += 1;
  const name = overrides.name ?? `Calling Biz ${seq}`;
  const phone = overrides.phone === undefined ? `+1713555${String(1000 + seq).slice(-4)}` : overrides.phone;
  const [row] = await db
    .insert(businesses)
    .values({
      yelpId: `call-act-yelp-${seq}`,
      name,
      nameNormalized: normalizeName(name),
      phone,
      phoneDigits: phoneDigits(phone),
      rating: "4.5",
      reviewCount: 40,
      categories: [{ alias: "plumbing", title: "Plumbing" }],
      primaryCategory: "plumbing",
      city: "Houston",
      state: "TX",
      qualification: "qualified",
      score: 80,
      raw: {},
      ...overrides,
    })
    .returning();
  return row;
}

/** A running campaign (no hours, no cap unless overridden) with `n` fresh businesses queued in order. */
async function makeCampaign(
  n: number,
  overrides: Partial<NewCallCampaign> = {},
): Promise<{ campaign: CallCampaign; biz: Business[] }> {
  const campaign = await createCallCampaign(db, {
    name: `Campaign ${++seq}`,
    status: "running",
    timezone: "America/Chicago",
    ...overrides,
  });
  const biz: Business[] = [];
  for (let i = 0; i < n; i++) biz.push(await makeBusiness());
  await addBusinessesToCampaign(
    db,
    campaign.id,
    biz.map((b) => b.id),
  );
  return { campaign, biz };
}

function form(fields: Record<string, string | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v);
  return f;
}

/** A valid campaign form; pass `undefined` for a key to omit it. */
function campaignForm(overrides: Record<string, string | undefined> = {}): FormData {
  return form({ name: "Houston plumbers", timezone: "America/Chicago", ...overrides });
}

function setAgent(name: string | null) {
  if (name === null) cookieJar.delete("crm_agent");
  else cookieJar.set("crm_agent", name);
}

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.message ?? "(no message)"}`);
  return r.data;
}

async function redirectUrl(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const m = /^REDIRECT:(.*)$/.exec((err as Error).message);
    if (m) return m[1];
    throw err;
  }
  throw new Error("expected a redirect");
}

function claimedOf(d: DialerClaim) {
  if (!d.ok) throw new Error(`expected a claim, got ${d.reason}`);
  return d;
}

/** Field errors for a form, or null when it parses. */
function formErrors(fd: FormData): Record<string, string[]> | null {
  const r = parseCampaignForm(fd);
  if (r.success) return null;
  const out: Record<string, string[]> = {};
  for (const issue of r.error.issues) (out[String(issue.path[0])] ??= []).push(issue.message);
  return out;
}

// ---------------------------------------------------------------- 1. form validation

describe("campaign form validation", () => {
  it("requires a name", () => {
    expect(formErrors(campaignForm({ name: "   " }))?.name).toBeTruthy();
    expect(formErrors(campaignForm({ name: undefined }))?.name).toBeTruthy();
    expect(formErrors(campaignForm())).toBeNull();
  });

  it("dailyCap: empty → no cap, 0 rejected, 5 accepted", () => {
    const empty = parseCampaignForm(campaignForm({ dailyCap: "" }));
    expect(empty.success && empty.data.dailyCap).toBeUndefined();
    const absent = parseCampaignForm(campaignForm());
    expect(absent.success && absent.data.dailyCap).toBeUndefined();
    expect(formErrors(campaignForm({ dailyCap: "0" }))?.dailyCap).toBeTruthy();
    expect(formErrors(campaignForm({ dailyCap: "abc" }))?.dailyCap).toBeTruthy();
    expect(formErrors(campaignForm({ dailyCap: "2.5" }))?.dailyCap).toBeTruthy();
    const five = parseCampaignForm(campaignForm({ dailyCap: "5" }));
    expect(five.success && five.data.dailyCap).toBe(5);
  });

  it("calling hours must be both or neither, and start must differ from end", () => {
    expect(formErrors(campaignForm({ callingHoursStart: "09:00" }))).toEqual({
      callingHoursEnd: expect.any(Array),
    });
    expect(formErrors(campaignForm({ callingHoursEnd: "17:00" }))).toEqual({
      callingHoursStart: expect.any(Array),
    });
    expect(formErrors(campaignForm({ callingHoursStart: "09:00", callingHoursEnd: "17:00" }))).toBeNull();
    expect(formErrors(campaignForm({ callingHoursStart: "", callingHoursEnd: "" }))).toBeNull();
    expect(formErrors(campaignForm({ callingHoursStart: "09:00", callingHoursEnd: "09:00" }))?.callingHoursEnd).toBeTruthy();
    expect(formErrors(campaignForm({ callingHoursStart: "9am", callingHoursEnd: "17:00" }))?.callingHoursStart).toBeTruthy();
  });

  it("normalises hours to HH:mm (a wrapping window is allowed)", () => {
    const r = parseCampaignForm(campaignForm({ callingHoursStart: "9:00", callingHoursEnd: "17:30:00" }));
    expect(r.success && [r.data.callingHoursStart, r.data.callingHoursEnd]).toEqual(["09:00", "17:30"]);
    expect(formErrors(campaignForm({ callingHoursStart: "22:00", callingHoursEnd: "02:00" }))).toBeNull();
  });

  it("timezone must be a valid IANA zone", () => {
    expect(formErrors(campaignForm({ timezone: "Mars/Olympus" }))?.timezone).toBeTruthy();
    expect(formErrors(campaignForm({ timezone: undefined }))?.timezone).toBeTruthy();
    expect(formErrors(campaignForm({ timezone: "America/Chicago" }))).toBeNull();
  });

  it("maxConcurrentAgents is 1–50 (default 5)", () => {
    expect(formErrors(campaignForm({ maxConcurrentAgents: "0" }))?.maxConcurrentAgents).toBeTruthy();
    expect(formErrors(campaignForm({ maxConcurrentAgents: "51" }))?.maxConcurrentAgents).toBeTruthy();
    for (const ok of ["1", "50"]) expect(formErrors(campaignForm({ maxConcurrentAgents: ok }))).toBeNull();
    const def = parseCampaignForm(campaignForm({ maxConcurrentAgents: "" }));
    expect(def.success && def.data.maxConcurrentAgents).toBe(5);
  });

  it("maxAttempts is 1–10 (default 3)", () => {
    expect(formErrors(campaignForm({ maxAttempts: "0" }))?.maxAttempts).toBeTruthy();
    expect(formErrors(campaignForm({ maxAttempts: "11" }))?.maxAttempts).toBeTruthy();
    for (const ok of ["1", "10"]) expect(formErrors(campaignForm({ maxAttempts: ok }))).toBeNull();
    const def = parseCampaignForm(campaignForm());
    expect(def.success && def.data.maxAttempts).toBe(3);
  });

  it("autoResume: 'on' → true, absent → false", () => {
    const on = parseCampaignForm(campaignForm({ autoResume: "on" }));
    expect(on.success && on.data.autoResume).toBe(true);
    const off = parseCampaignForm(campaignForm());
    expect(off.success && off.data.autoResume).toBe(false);
  });

  it("createCampaignAction returns field errors and creates nothing when invalid", async () => {
    const r = await createCampaignAction(
      null,
      campaignForm({ name: "", dailyCap: "0", timezone: "Mars/Olympus", maxAttempts: "11", callingHoursStart: "08:00" }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["callingHoursEnd", "dailyCap", "maxAttempts", "name", "timezone"]);
    expect(await listCallCampaigns(db)).toHaveLength(0);
  });

  it("a valid create redirects to /calling/<uuid> and inserts a draft campaign", async () => {
    const url = await redirectUrl(
      createCampaignAction(
        null,
        campaignForm({
          name: "  Houston plumbers ",
          description: "Q4 push",
          script: "Hi {{owner_first_name}}",
          dailyCap: "",
          callingHoursStart: "09:00",
          callingHoursEnd: "17:00",
          maxConcurrentAgents: "3",
          maxAttempts: "4",
          autoResume: "on",
        }),
      ),
    );
    const m = /^\/calling\/([0-9a-f-]{36})$/.exec(url);
    expect(m).not.toBeNull();
    const c = await getCallCampaign(db, m![1]);
    expect(c).toMatchObject({
      name: "Houston plumbers",
      description: "Q4 push",
      script: "Hi {{owner_first_name}}",
      status: "draft",
      dailyCap: null,
      callingHoursStart: "09:00:00",
      callingHoursEnd: "17:00:00",
      timezone: "America/Chicago",
      maxConcurrentAgents: 3,
      maxAttempts: 4,
      autoResume: true,
    });
  });
});

// ---------------------------------------------------------------- 2. update

describe("updateCampaignAction", () => {
  it("saves changes", async () => {
    const c = await createCallCampaign(db, { name: "Old", status: "draft", timezone: "America/Chicago" });
    const r = await updateCampaignAction(
      c.id,
      null,
      campaignForm({ name: "New name", dailyCap: "7", maxAttempts: "2", autoResume: "on", timezone: "America/New_York" }),
    );
    expect(unwrap(r)).toEqual({ id: c.id });
    const after = await getCallCampaign(db, c.id);
    expect(after).toMatchObject({
      name: "New name",
      dailyCap: 7,
      maxAttempts: 2,
      autoResume: true,
      timezone: "America/New_York",
      status: "draft",
    });
  });

  it("returns field errors for bad input and does not save", async () => {
    const c = await createCallCampaign(db, { name: "Keep", status: "draft", timezone: "America/Chicago" });
    const r = await updateCampaignAction(c.id, null, campaignForm({ name: "Changed", maxAttempts: "0" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.maxAttempts).toBeTruthy();
    expect((await getCallCampaign(db, c.id))?.name).toBe("Keep");
  });

  it("fails for an unknown campaign", async () => {
    const r = await updateCampaignAction("00000000-0000-4000-8000-000000000000", null, campaignForm());
    expect(r).toMatchObject({ ok: false, message: "Campaign not found." });
  });

  it("re-evaluates after saving: new hours that exclude 'now' pause a running campaign", async () => {
    const { campaign } = await makeCampaign(1);
    const nowHour = new Date().getUTCHours();
    const start = `${String((nowHour + 6) % 24).padStart(2, "0")}:00`;
    const end = `${String((nowHour + 7) % 24).padStart(2, "0")}:00`;
    // UTC window that starts 6 hours from now, so it excludes the current hour.
    const r = await updateCampaignAction(
      campaign.id,
      null,
      campaignForm({ timezone: "UTC", callingHoursStart: start, callingHoursEnd: end }),
    );
    expect(r.ok).toBe(true);
    expect(await getCallCampaign(db, campaign.id)).toMatchObject({ status: "paused", pauseReason: "outside_hours" });
  });
});

// ---------------------------------------------------------------- 3. agent cookie

describe("agent cookie", () => {
  it("setAgentAction stores a cleaned name", async () => {
    const r = await setAgentAction(null, form({ name: "   Ann    Marie \n Lee  " }));
    expect(unwrap(r)).toEqual({ name: "Ann Marie Lee" });
    expect(cookieJar.get("crm_agent")).toBe("Ann Marie Lee");
  });

  it("setAgentAction caps the name at 60 characters", async () => {
    const r = await setAgentAction(null, form({ name: "x".repeat(100) }));
    expect(unwrap(r).name).toHaveLength(60);
    expect(cookieJar.get("crm_agent")).toHaveLength(60);
  });

  it("setAgentAction rejects a blank name and sets no cookie", async () => {
    const r = await setAgentAction(null, form({ name: "  \t " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors?.name).toBeTruthy();
    expect(cookieJar.has("crm_agent")).toBe(false);
  });

  it("claimNextAction / recordOutcomeAction / skipAction fail with a message when no agent is set", async () => {
    const { campaign } = await makeCampaign(1);
    const item = (await listQueue(db, campaign.id)).rows[0];
    const results = [
      await claimNextAction(campaign.id),
      await recordOutcomeAction(item.id, null, form({ outcome: "busy" })),
      await skipAction(item.id),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, message: "Enter your name first." });
    expect((await getQueueItem(db, item.id))?.state).toBe("pending");
  });
});

// ---------------------------------------------------------------- 4. dialer

describe("claimNextAction", () => {
  it("claims the next item with the business, history and recent arrays", async () => {
    const { campaign, biz } = await makeCampaign(2);
    setAgent("ann");
    const d = claimedOf(unwrap(await claimNextAction(campaign.id)));
    expect(d.business.id).toBe(biz[0].id);
    expect(d.item).toMatchObject({ state: "claimed", claimedBy: "ann", position: 1 });
    expect(Array.isArray(d.history)).toBe(true);
    expect(Array.isArray(d.recent)).toBe(true);
  });

  it("history lists earlier calls to the same business in this campaign", async () => {
    const { campaign } = await makeCampaign(1);
    setAgent("ann");
    const first = claimedOf(unwrap(await claimNextAction(campaign.id)));
    unwrap(await recordOutcomeAction(first.item.id, null, form({ outcome: "no_answer", notes: "rang out" })));
    const again = claimedOf(unwrap(await claimNextAction(campaign.id)));
    expect(again.business.id).toBe(first.business.id);
    expect(again.history).toHaveLength(1);
    expect(again.history[0]).toMatchObject({ outcome: "no_answer", body: "rang out", agent: "ann" });
    expect(again.recent.length).toBeGreaterThanOrEqual(1);
  });

  it("a malformed campaign id fails cleanly", async () => {
    setAgent("ann");
    expect(await claimNextAction("not-a-uuid")).toMatchObject({ ok: false, message: "Campaign not found." });
  });

  it("reports an empty queue as data.ok === false", async () => {
    const { campaign } = await makeCampaign(1);
    setAgent("ann");
    claimedOf(unwrap(await claimNextAction(campaign.id)));
    setAgent("bob");
    const d = unwrap(await claimNextAction(campaign.id));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe("empty");
  });
});

describe("recordOutcomeAction", () => {
  async function claimOne(overrides: Partial<NewCallCampaign> = {}) {
    const { campaign } = await makeCampaign(1, overrides);
    setAgent("ann");
    const d = claimedOf(unwrap(await claimNextAction(campaign.id)));
    return { campaign, item: d.item, business: d.business };
  }

  it("busy succeeds: the item goes back to pending and an attempt is recorded", async () => {
    const { item } = await claimOne();
    const updated = unwrap(await recordOutcomeAction(item.id, null, form({ outcome: "busy", notes: " line busy " })));
    expect(updated).toMatchObject({ state: "pending", attempts: 1, lastOutcome: "busy", notes: "line busy" });
  });

  it("an invalid or missing outcome → fieldErrors.outcome", async () => {
    const { item } = await claimOne();
    for (const fd of [form({ outcome: "nope" }), form({}), form({ outcome: "" })]) {
      const r = await recordOutcomeAction(item.id, null, fd);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.outcome).toBeTruthy();
    }
    expect((await getQueueItem(db, item.id))?.state).toBe("claimed");
  });

  it("callback without callbackAt → fieldErrors.callbackAt", async () => {
    const { item } = await claimOne();
    for (const fd of [form({ outcome: "callback" }), form({ outcome: "callback", callbackAt: "" }), form({ outcome: "callback", callbackAt: "tomorrow" })]) {
      const r = await recordOutcomeAction(item.id, null, fd);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.callbackAt).toBeTruthy();
    }
    expect((await getQueueItem(db, item.id))?.state).toBe("claimed");
  });

  it("callback in the past → error", async () => {
    const { item } = await claimOne();
    const r = await recordOutcomeAction(item.id, null, form({ outcome: "callback", callbackAt: "2020-01-15T10:00" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors?.callbackAt).toBeTruthy();
      expect(r.message).toMatch(/future/i);
    }
    expect((await getQueueItem(db, item.id))?.state).toBe("claimed");
  });

  it.each([
    ["winter (CST, UTC-6)", "2099-01-15T14:30"],
    ["summer (CDT, UTC-5)", "2099-07-15T14:30"],
  ])("callback in the future is interpreted in the campaign's time zone: %s", async (_label, value) => {
    const { item } = await claimOne({ timezone: "America/Chicago" });
    const updated = unwrap(await recordOutcomeAction(item.id, null, form({ outcome: "callback", callbackAt: value })));
    const expected = fromZonedTime(`${value}:00`, "America/Chicago");
    expect(updated.state).toBe("callback");
    expect(updated.callbackAt?.toISOString()).toBe(expected.toISOString());
    // Sanity: the instant really is shifted from naive UTC by the zone offset.
    expect(expected.getTime()).not.toBe(new Date(`${value}:00Z`).getTime());
    expect(expected.getUTCHours()).toBe(value.includes("-01-") ? 20 : 19);
  });

  it("uses a different campaign time zone when the campaign has one", async () => {
    const { item } = await claimOne({ timezone: "Asia/Tokyo" });
    const updated = unwrap(await recordOutcomeAction(item.id, null, form({ outcome: "callback", callbackAt: "2099-03-10T09:00" })));
    expect(updated.callbackAt?.toISOString()).toBe("2099-03-10T00:00:00.000Z");
  });

  it("refuses an outcome on an item held by another agent", async () => {
    const { item } = await claimOne();
    setAgent("bob");
    const r = await recordOutcomeAction(item.id, null, form({ outcome: "busy" }));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.message).toMatch(/ann/);
  });

  it("unknown item → not found", async () => {
    setAgent("ann");
    const r = await recordOutcomeAction("00000000-0000-4000-8000-000000000000", null, form({ outcome: "busy" }));
    expect(r).toMatchObject({ ok: false, message: "Queue item not found." });
  });
});

describe("skipAction", () => {
  it("fails for another agent, succeeds for the owner (item back to pending)", async () => {
    const { campaign } = await makeCampaign(2);
    setAgent("ann");
    const d = claimedOf(unwrap(await claimNextAction(campaign.id)));

    setAgent("bob");
    const denied = await skipAction(d.item.id);
    expect(denied).toMatchObject({ ok: false, message: "This call is not yours to skip." });
    expect((await getQueueItem(db, d.item.id))?.state).toBe("claimed");

    setAgent("ann");
    expect((await skipAction(d.item.id)).ok).toBe(true);
    const after = await getQueueItem(db, d.item.id);
    expect(after).toMatchObject({ state: "pending", claimedBy: null, leaseExpiresAt: null });
    expect(after!.position).toBe(3); // moved to the end of a 2-item queue
  });

  it("fails for a pending item and an unknown item", async () => {
    const { campaign } = await makeCampaign(1);
    const item = (await listQueue(db, campaign.id)).rows[0];
    setAgent("ann");
    expect(await skipAction(item.id)).toMatchObject({ ok: false });
    expect(await skipAction("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, message: "Queue item not found." });
  });
});

// ---------------------------------------------------------------- 5. status controls + queue

describe("pause / resume / start", () => {
  it("pauseAction makes claims return paused/manual; resumeAction runs it again", async () => {
    const { campaign } = await makeCampaign(2);
    setAgent("ann");
    expect((await pauseAction(campaign.id)).ok).toBe(true);
    expect(await getCallCampaign(db, campaign.id)).toMatchObject({ status: "paused", pauseReason: "manual" });

    const d = unwrap(await claimNextAction(campaign.id));
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.reason).toBe("paused");
      expect(d.pauseReason).toBe("manual");
      expect(d.campaign).toMatchObject({ id: campaign.id, status: "paused", pauseReason: "manual" });
    }

    const resumed = unwrap(await resumeAction(campaign.id));
    expect(resumed).toEqual({ status: "running", pauseReason: null, aiCalls: null });
    expect(claimedOf(unwrap(await claimNextAction(campaign.id))).item.state).toBe("claimed");
  });

  it("resumeAction applies the hours rule at once", async () => {
    const nowHour = new Date().getUTCHours();
    const start = `${String((nowHour + 6) % 24).padStart(2, "0")}:00:00`;
    const end = `${String((nowHour + 7) % 24).padStart(2, "0")}:00:00`;
    const { campaign } = await makeCampaign(1, { timezone: "UTC", callingHoursStart: start, callingHoursEnd: end });
    await pauseAction(campaign.id);
    const r = unwrap(await resumeAction(campaign.id));
    expect(r).toEqual({ status: "paused", pauseReason: "outside_hours", aiCalls: null });
  });

  it("startAction on a draft with an empty queue fails; after adding businesses it starts", async () => {
    const c = await createCallCampaign(db, { name: "Draft", status: "draft", timezone: "America/Chicago" });
    const empty = await startAction(c.id);
    expect(empty).toMatchObject({ ok: false });
    expect((await getCallCampaign(db, c.id))?.status).toBe("draft");

    const b = await makeBusiness();
    expect(unwrap(await addBusinessesAction(c.id, { ids: [b.id] }))).toEqual({ added: 1, skipped: 0 });
    expect(unwrap(await startAction(c.id))).toEqual({ status: "running", pauseReason: null, aiCalls: null });
    expect((await getCallCampaign(db, c.id))?.status).toBe("running");
  });

  it("startAction on an AI campaign places the first calls at once", async () => {
    const c = await createCallCampaign(db, { name: "AI", mode: "ai", status: "draft", timezone: "America/Chicago", maxConcurrentAgents: 2 });
    const biz = [await makeBusiness(), await makeBusiness(), await makeBusiness()];
    unwrap(await addBusinessesAction(c.id, { ids: biz.map((b) => b.id) }));
    const r = unwrap(await startAction(c.id));
    expect(r).toEqual({ status: "running", pauseReason: null, aiCalls: { placed: 2, message: "Placed 2 AI calls.", error: false } });
    expect(aiPlacer.calls).toHaveLength(2);
  });

  it("startAction on an AI campaign still starts when dialing fails or is not configured", async () => {
    const c1 = await createCallCampaign(db, { name: "AI fail", mode: "ai", status: "draft", timezone: "America/Chicago" });
    unwrap(await addBusinessesAction(c1.id, { ids: [(await makeBusiness()).id] }));
    aiPlacer.fail = "ElevenLabs said no";
    expect(unwrap(await startAction(c1.id))).toMatchObject({ status: "running", aiCalls: { placed: 0, message: "ElevenLabs said no", error: true } });
    expect((await getCallCampaign(db, c1.id))?.status).toBe("running");

    aiPlacer.fail = undefined;
    aiPlacer.missing = ["ELEVENLABS_API_KEY"];
    const c2 = await createCallCampaign(db, { name: "AI unconfigured", mode: "ai", status: "draft", timezone: "America/Chicago" });
    unwrap(await addBusinessesAction(c2.id, { ids: [(await makeBusiness()).id] }));
    expect(unwrap(await startAction(c2.id))).toMatchObject({ status: "running", aiCalls: { placed: 0, error: true } });
    expect(aiPlacer.calls).toHaveLength(0);
  });

  it("resumeAction on a manually paused AI campaign places calls again", async () => {
    const c = await createCallCampaign(db, { name: "AI resume", mode: "ai", status: "draft", timezone: "America/Chicago", maxConcurrentAgents: 1 });
    unwrap(await addBusinessesAction(c.id, { ids: [(await makeBusiness()).id, (await makeBusiness()).id] }));
    aiPlacer.missing = ["ELEVENLABS_API_KEY"];
    unwrap(await startAction(c.id));
    unwrap(await pauseAction(c.id));
    aiPlacer.missing = [];
    expect(unwrap(await resumeAction(c.id)).aiCalls).toEqual({ placed: 1, message: "Placed 1 AI call.", error: false });
    expect(aiPlacer.calls).toHaveLength(1);
  });

  it("startAction refuses a campaign that is not a draft or does not exist", async () => {
    const { campaign } = await makeCampaign(1);
    expect(await startAction(campaign.id)).toMatchObject({ ok: false, message: "Only a draft campaign can be started." });
    expect(await startAction("00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false, message: "Campaign not found." });
  });
});

describe("addBusinessesAction / previewAddAction / removeQueueItemAction", () => {
  const filter = { qualification: ["qualified" as const], hasPhone: true, excludeDoNotCall: true, city: "Houston" };

  async function seedMix() {
    const match1 = await makeBusiness({ city: "Houston" });
    const match2 = await makeBusiness({ city: "Houston" });
    await makeBusiness({ city: "Houston", phone: null }); // no phone
    await makeBusiness({ city: "Houston", doNotCall: true }); // do not call
    await makeBusiness({ city: "Houston", qualification: "review" }); // wrong qualification
    await makeBusiness({ city: "Dallas" }); // wrong city
    return [match1, match2];
  }

  it("adds the businesses matching a filter and returns {added, skipped}", async () => {
    const [m1, m2] = await seedMix();
    const c = await createCallCampaign(db, { name: "F", status: "draft", timezone: "America/Chicago" });
    expect(unwrap(await addBusinessesAction(c.id, { filter }))).toEqual({ added: 2, skipped: 0 });
    const { rows } = await listQueue(db, c.id);
    expect(rows.map((r) => r.businessId).sort()).toEqual([m1.id, m2.id].sort());
    // Re-adding skips duplicates.
    expect(unwrap(await addBusinessesAction(c.id, { filter }))).toEqual({ added: 0, skipped: 2 });
  });

  it("adds by ids, skipping do-not-call, phoneless and unknown ids", async () => {
    const good = await makeBusiness();
    const dnc = await makeBusiness({ doNotCall: true });
    const noPhone = await makeBusiness({ phone: null });
    const c = await createCallCampaign(db, { name: "I", status: "draft", timezone: "America/Chicago" });
    const r = await addBusinessesAction(c.id, {
      ids: [good.id, dnc.id, noPhone.id, "00000000-0000-4000-8000-000000000000"],
    });
    expect(unwrap(r)).toEqual({ added: 1, skipped: 3 });
  });

  it("rejects empty or malformed input and an unknown campaign", async () => {
    const c = await createCallCampaign(db, { name: "X", status: "draft", timezone: "America/Chicago" });
    expect(await addBusinessesAction(c.id, { ids: [] })).toMatchObject({ ok: false, message: "Nothing to add." });
    expect(await addBusinessesAction(c.id, { ids: ["nope"] })).toMatchObject({ ok: false, message: "Nothing to add." });
    const b = await makeBusiness();
    expect(await addBusinessesAction("00000000-0000-4000-8000-000000000000", { ids: [b.id] })).toMatchObject({
      ok: false,
      message: "Campaign not found.",
    });
  });

  it("previewAddAction is consistent with adding: addable drops to 0 afterwards", async () => {
    await seedMix();
    const c = await createCallCampaign(db, { name: "P", status: "draft", timezone: "America/Chicago" });
    expect(unwrap(await previewAddAction(c.id, filter))).toEqual({ matching: 2, addable: 2 });
    const added = unwrap(await addBusinessesAction(c.id, { filter }));
    expect(added.added).toBe(2);
    expect(unwrap(await previewAddAction(c.id, filter))).toEqual({ matching: 2, addable: 0 });
    // Without the phone/DNC guards the filter matches more, but those still are not addable.
    expect(unwrap(await previewAddAction(c.id, { qualification: ["qualified"], city: "Houston" }))).toEqual({
      matching: 4,
      addable: 0,
    });
  });

  it("previewAddAction rejects an invalid filter", async () => {
    const c = await createCallCampaign(db, { name: "P", status: "draft", timezone: "America/Chicago" });
    const bad = { qualification: ["bogus"] } as unknown as Parameters<typeof previewAddAction>[1];
    expect(await previewAddAction(c.id, bad)).toMatchObject({ ok: false, message: "Invalid filter." });
  });

  it("removeQueueItemAction removes a pending item and refuses a non-pending one", async () => {
    const { campaign } = await makeCampaign(2);
    const [first, second] = (await listQueue(db, campaign.id)).rows;

    expect((await removeQueueItemAction(first.id)).ok).toBe(true);
    expect(await getQueueItem(db, first.id)).toBeNull();

    setAgent("ann");
    const d = claimedOf(unwrap(await claimNextAction(campaign.id)));
    expect(d.item.id).toBe(second.id);
    expect(await removeQueueItemAction(second.id)).toMatchObject({ ok: false, message: "Only pending items can be removed." });
    expect((await getQueueItem(db, second.id))?.state).toBe("claimed");

    expect(await removeQueueItemAction("00000000-0000-4000-8000-000000000000")).toMatchObject({
      ok: false,
      message: "Queue item not found.",
    });
  });

  it("addBusinessesAction restarts a completed campaign (via the repo rule)", async () => {
    const { campaign } = await makeCampaign(1);
    await db.update(callQueueItems).set({ state: "completed" }).where(eq(callQueueItems.campaignId, campaign.id));
    await db.execute(sql`UPDATE call_campaigns SET status = 'completed' WHERE id = ${campaign.id}`);
    const b = await makeBusiness();
    expect(unwrap(await addBusinessesAction(campaign.id, { ids: [b.id] })).added).toBe(1);
    expect((await getCallCampaign(db, campaign.id))?.status).toBe("running");
  });
});

// ---------------------------------------------------------------- 6. cron route

describe("GET /api/cron/campaigns", () => {
  const url = "http://x/api/cron/campaigns";
  const withAuth = (token: string) => new Request(url, { headers: { authorization: `Bearer ${token}` } });

  it("requires the bearer token when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", "x");
    const none = await cronRoute.GET(new Request(url));
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    expect((await cronRoute.GET(withAuth("wrong"))).status).toBe(401);
    expect((await cronRoute.GET(withAuth("xx"))).status).toBe(401);
    expect((await cronRoute.GET(new Request(url, { headers: { authorization: "x" } }))).status).toBe(401);
  });

  it("evaluates running and paused campaigns and returns the count", async () => {
    vi.stubEnv("CRON_SECRET", "x");
    await makeCampaign(1, { status: "running" });
    await makeCampaign(1, { status: "paused", pauseReason: "manual" });
    await makeCampaign(1, { status: "draft" });
    // (created directly: adding items to a completed campaign would reopen it)
    await createCallCampaign(db, { name: "Done", status: "completed", timezone: "America/Chicago" });
    const res = await cronRoute.GET(withAuth("x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ evaluated: 2 });
  });

  it("returns { evaluated: 0 } with no campaigns", async () => {
    vi.stubEnv("CRON_SECRET", "x");
    const res = await cronRoute.GET(withAuth("x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ evaluated: 0 });
  });

  it("is open when CRON_SECRET is unset or empty", async () => {
    vi.stubEnv("CRON_SECRET", "");
    await makeCampaign(1, { status: "running" });
    const res = await cronRoute.GET(new Request(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ evaluated: 1 });
  });

  it("applies the evaluation (completes a running campaign with an empty queue)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const c = await createCallCampaign(db, { name: "Empty", status: "running", timezone: "America/Chicago" });
    await cronRoute.GET(new Request(url));
    expect((await getCallCampaign(db, c.id))?.status).toBe("completed");
  });
});

// ---------------------------------------------------------------- 7. status route

describe("GET /api/calling/[id]/status", () => {
  const call = (id: string) => statusRoute.GET(new Request(`http://x/api/calling/${id}/status`), { params: Promise.resolve({ id }) });

  it("returns campaign status and queue stats", async () => {
    const { campaign } = await makeCampaign(3, { dailyCap: 10 });
    const res = await call(campaign.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as CampaignStatusPayload;
    expect(body.campaign).toMatchObject({ id: campaign.id, name: campaign.name, status: "running", pauseReason: null, dailyCap: 10 });
    expect(body.stats).toMatchObject({ pending: 3, claimed: 0, completed: 0, completedToday: 0, activeAgents: 0 });
    expect(Number.isNaN(Date.parse(body.at))).toBe(false);
  });

  it("evaluates before reporting (a drained campaign shows completed)", async () => {
    const c = await createCallCampaign(db, { name: "Empty", status: "running", timezone: "America/Chicago" });
    const body = (await (await call(c.id)).json()) as CampaignStatusPayload;
    expect(body.campaign.status).toBe("completed");
  });

  it("reflects claimed items in the stats", async () => {
    const { campaign } = await makeCampaign(2);
    setAgent("ann");
    claimedOf(unwrap(await claimNextAction(campaign.id)));
    const body = (await (await call(campaign.id)).json()) as CampaignStatusPayload;
    expect(body.stats).toMatchObject({ pending: 1, claimed: 1, activeAgents: 1 });
  });

  it("returns 404 for a malformed id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("returns 404 for an unknown uuid", async () => {
    const res = await call("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------- 8. time helpers

describe("time helpers", () => {
  const TZ = "America/Chicago";

  describe("isWithinHours", () => {
    it("is always true without a window", () => {
      expect(isWithinHours(new Date("2026-06-15T03:00:00Z"), TZ, null, null)).toBe(true);
      expect(isWithinHours(new Date("2026-06-15T03:00:00Z"), TZ, "09:00", null)).toBe(true);
      expect(isWithinHours(new Date("2026-06-15T03:00:00Z"), TZ, "09:00:00", "09:00")).toBe(true);
    });

    it("evaluates in the given zone, start inclusive and end exclusive", () => {
      // 15:00Z = 10:00 CDT
      expect(isWithinHours(new Date("2026-06-15T15:00:00Z"), TZ, "09:00", "17:00")).toBe(true);
      expect(isWithinHours(new Date("2026-06-15T14:00:00Z"), TZ, "09:00", "17:00")).toBe(true); // 09:00 CDT
      expect(isWithinHours(new Date("2026-06-15T13:59:00Z"), TZ, "09:00", "17:00")).toBe(false); // 08:59 CDT
      expect(isWithinHours(new Date("2026-06-15T21:59:00Z"), TZ, "09:00", "17:00")).toBe(true); // 16:59 CDT
      expect(isWithinHours(new Date("2026-06-15T22:00:00Z"), TZ, "09:00", "17:00")).toBe(false); // 17:00 CDT
      // Same instant, other zone: 00:00 JST is outside the window.
      expect(isWithinHours(new Date("2026-06-15T15:00:00Z"), "Asia/Tokyo", "09:00", "17:00")).toBe(false); // 00:00 JST
    });

    it("handles a window wrapping midnight (22:00–02:00)", () => {
      const at = (iso: string) => isWithinHours(new Date(iso), TZ, "22:00", "02:00");
      expect(at("2026-06-16T03:00:00Z")).toBe(true); // 22:00 CDT
      expect(at("2026-06-16T05:00:00Z")).toBe(true); // 00:00 CDT
      expect(at("2026-06-16T06:59:00Z")).toBe(true); // 01:59 CDT
      expect(at("2026-06-16T07:00:00Z")).toBe(false); // 02:00 CDT
      expect(at("2026-06-15T15:00:00Z")).toBe(false); // 10:00 CDT
      expect(at("2026-06-16T02:59:00Z")).toBe(false); // 21:59 CDT
    });

    it("accepts DB-style HH:mm:ss times", () => {
      expect(isWithinHours(new Date("2026-06-15T15:00:00Z"), TZ, "09:00:00", "17:00:00")).toBe(true);
    });
  });

  describe("localDayBounds", () => {
    const hours = (b: { start: Date; end: Date }) => (b.end.getTime() - b.start.getTime()) / 3_600_000;

    it("is 24 h on an ordinary day, bounded by local midnights", () => {
      const b = localDayBounds(new Date("2026-06-15T15:00:00Z"), TZ);
      expect(b.start.toISOString()).toBe("2026-06-15T05:00:00.000Z");
      expect(b.end.toISOString()).toBe("2026-06-16T05:00:00.000Z");
      expect(hours(b)).toBe(24);
    });

    it("is 23 h on the spring-forward day (2026-03-08)", () => {
      const b = localDayBounds(new Date("2026-03-08T18:00:00Z"), TZ);
      expect(b.start.toISOString()).toBe("2026-03-08T06:00:00.000Z"); // 00:00 CST
      expect(b.end.toISOString()).toBe("2026-03-09T05:00:00.000Z"); // 00:00 CDT
      expect(hours(b)).toBe(23);
    });

    it("is 25 h on the fall-back day (2026-11-01)", () => {
      const b = localDayBounds(new Date("2026-11-01T18:00:00Z"), TZ);
      expect(b.start.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // 00:00 CDT
      expect(b.end.toISOString()).toBe("2026-11-02T06:00:00.000Z"); // 00:00 CST
      expect(hours(b)).toBe(25);
    });

    it("uses the local day, not the UTC day", () => {
      // 03:00Z on Jun 16 is still Jun 15 (22:00) in Chicago.
      const b = localDayBounds(new Date("2026-06-16T03:00:00Z"), TZ);
      expect(b.start.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    });

    it("includes `now` in [start, end)", () => {
      const now = new Date("2026-03-08T07:30:00Z");
      const b = localDayBounds(now, TZ);
      expect(b.start.getTime() <= now.getTime() && now.getTime() < b.end.getTime()).toBe(true);
    });
  });

  describe("parseLocalDateTime", () => {
    it("interprets wall time in the zone", () => {
      expect(parseLocalDateTime("2026-01-15T09:30", TZ)?.toISOString()).toBe("2026-01-15T15:30:00.000Z");
      expect(parseLocalDateTime("2026-07-15T09:30", TZ)?.toISOString()).toBe("2026-07-15T14:30:00.000Z");
      expect(parseLocalDateTime("2026-07-15T09:30:45", TZ)?.toISOString()).toBe("2026-07-15T14:30:45.000Z");
      expect(parseLocalDateTime("2026-07-15T09:30", "UTC")?.toISOString()).toBe("2026-07-15T09:30:00.000Z");
    });

    it("rejects malformed values", () => {
      for (const bad of ["", "2026-07-15", "2026-07-15 09:30", "07/15/2026 09:30", "2026-07-15T9:30", "2026-07-15T09:30Z", "nope"]) {
        expect(parseLocalDateTime(bad, TZ)).toBeNull();
      }
    });
  });

  describe("defaultCallbackValue", () => {
    it("is tomorrow at 10:00 local", () => {
      expect(defaultCallbackValue(new Date("2026-06-15T15:00:00Z"), TZ)).toBe("2026-06-16T10:00");
    });

    it("uses the local date when UTC has already rolled over", () => {
      // 03:00Z Jun 16 = 22:00 CDT Jun 15 → tomorrow is Jun 16.
      expect(defaultCallbackValue(new Date("2026-06-16T03:00:00Z"), TZ)).toBe("2026-06-16T10:00");
    });

    it("rolls over month and DST boundaries", () => {
      expect(defaultCallbackValue(new Date("2026-03-07T18:00:00Z"), TZ)).toBe("2026-03-08T10:00");
      expect(defaultCallbackValue(new Date("2026-03-08T18:00:00Z"), TZ)).toBe("2026-03-09T10:00");
      expect(defaultCallbackValue(new Date("2026-12-31T18:00:00Z"), TZ)).toBe("2027-01-01T10:00");
    });

    it("round-trips through parseLocalDateTime", () => {
      const v = defaultCallbackValue(new Date("2026-06-15T15:00:00Z"), TZ);
      expect(parseLocalDateTime(v, TZ)?.toISOString()).toBe("2026-06-16T15:00:00.000Z");
    });
  });
});

// ---------------------------------------------------------------- 8b. script tokens

describe("fillScript", () => {
  const biz = {
    name: "Acme Plumbing",
    ownerName: "Jane Q. Smith",
    city: "Houston",
    state: "TX",
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    primaryCategory: "plumbing",
    rating: "4.5",
    reviewCount: 120,
    phone: "+17135551234",
  } as Parameters<typeof fillScript>[1];

  it("fills every token", () => {
    const script =
      "Hi {{owner_first_name}}, {{agent}} here. I saw {{business_name}} in {{city}} ({{category}}), rated {{rating}} on {{review_count}} reviews.";
    expect(fillScript(script, biz, "Ann")).toBe(
      "Hi Jane, Ann here. I saw Acme Plumbing in Houston (Plumbing), rated 4\\.5 on 120 reviews.",
    );
  });

  it("matches tokens case-insensitively and with inner whitespace", () => {
    expect(fillScript("{{ City }} / {{BUSINESS_NAME}}", biz)).toBe("Houston / Acme Plumbing");
  });

  it("falls back to the primary category when there are no category titles", () => {
    expect(fillScript("{{category}}", { ...biz, categories: [] })).toBe("plumbing");
  });

  it("shows a placeholder when a value is missing", () => {
    expect(fillScript("Hi {{owner_first_name}}", { ...biz, ownerName: null })).toBe("Hi \\[owner first name\\]");
    expect(fillScript("Hi {{owner_first_name}}", { ...biz, ownerName: "   " })).toBe("Hi \\[owner first name\\]");
    expect(fillScript("{{city}}", { ...biz, city: null })).toBe("\\[city\\]");
    expect(fillScript("{{rating}}", { ...biz, rating: null })).toBe("\\[rating\\]");
    expect(fillScript("Hi {{agent}}", biz)).toBe("Hi \\[agent\\]");
    expect(fillScript("Hi {{agent}}", biz, "  ")).toBe("Hi \\[agent\\]");
  });

  it("escapes markdown characters in values", () => {
    const out = fillScript("{{business_name}}", { ...biz, name: "A*B_C [1] #1 `x` \\ Plumbing & Co." });
    expect(out).toBe("A\\*B\\_C \\[1\\] \\#1 \\`x\\` \\\\ Plumbing & Co\\.");
    expect(fillScript("{{agent}}", biz, "*Ann*")).toBe("\\*Ann\\*");
  });

  it("does not escape the script text itself", () => {
    expect(fillScript("**Say:** hi {{city}}!", biz)).toBe("**Say:** hi Houston!");
  });

  it("leaves unknown tokens unchanged", () => {
    expect(fillScript("Hello {{nope}} and {{ Other_Thing }} and {not_a_token}", biz)).toBe(
      "Hello {{nope}} and {{ Other_Thing }} and {not_a_token}",
    );
  });

  it("fills every occurrence", () => {
    expect(fillScript("{{city}} {{city}}", biz)).toBe("Houston Houston");
  });
});

// ---------------------------------------------------------------- delete campaign + hours dropdown

describe("deleteCampaignAction", () => {
  it("removes the campaign and its queue items", async () => {
    const { campaign, biz } = await makeCampaign(2);
    const before = await listQueue(db, campaign.id, { limit: 10 });
    expect(before.total).toBe(2);
    unwrap(await deleteCampaignAction(campaign.id));
    expect(await getCallCampaign(db, campaign.id)).toBeNull();
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(callQueueItems)) as { n: number }[];
    expect(n).toBe(0);
    // Businesses survive; only the campaign membership goes.
    const left = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, biz[0].id));
    expect(left).toHaveLength(1);
    expect(await listCallCampaigns(db)).toHaveLength(0);
  });

  it("fails for an unknown or malformed id", async () => {
    const r1 = await deleteCampaignAction("00000000-0000-4000-8000-000000000000");
    expect(r1.ok).toBe(false);
    const r2 = await deleteCampaignAction("nope");
    expect(r2.ok).toBe(false);
  });
});

describe("timeOptions", () => {
  it("lists every half hour on a 24-hour clock", () => {
    const opts = timeOptions();
    expect(opts).toHaveLength((24 * 60) / TIME_STEP_MINUTES);
    expect(opts[0]).toBe("00:00");
    expect(opts[1]).toBe("00:30");
    expect(opts).toContain("13:00");
    expect(opts.at(-1)).toBe("23:30");
    expect(opts.every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true);
  });

  it("keeps an off-grid stored value in order", () => {
    const opts = timeOptions("09:15:00");
    expect(opts).toContain("09:15");
    expect(opts.indexOf("09:15")).toBe(opts.indexOf("09:00") + 1);
    expect(timeOptions("09:00")).toHaveLength(48);
    expect(timeOptions(null)).toHaveLength(48);
  });
});

// ---------------------------------------------------------------- delete campaign: everything it did goes with it

describe("deleteCampaignAction rolls back what the campaign did", () => {
  const USER = "11111111-1111-4111-8111-111111111111";

  async function callOnce(campaignId: string, outcome: "busy" | "interested" | "voicemail" | "callback" | "do_not_call", at: Date, callbackAt?: Date) {
    const claim = await claimNext(db, campaignId, "qa", at);
    if (!claim.ok) throw new Error(`claim failed: ${claim.reason}`);
    await recordOutcome(db, claim.item.id, { outcome, agent: "qa", callbackAt }, at);
    return claim.business.id;
  }
  const biz = async (id: string) => (await db.select().from(businesses).where(eq(businesses.id, id)))[0];
  const callActivities = async (id: string) =>
    db.select().from(activities).where(eq(activities.businessId, id));

  it("deletes its call activities and resets businesses and leads it alone had touched", async () => {
    const t0 = new Date("2026-03-02T15:00:00Z");
    const { campaign, biz: [b1, b2] } = await makeCampaign(2);
    await addLead(db, USER, b2.id);
    const first = await callOnce(campaign.id, "busy", t0);
    const second = await callOnce(campaign.id, "interested", new Date(t0.getTime() + 60_000));
    const busyId = first === b1.id ? b1.id : b2.id;
    const interestedId = second === b2.id ? b2.id : b1.id;
    expect((await biz(busyId)).status).toBe("contacted");
    expect((await biz(interestedId)).status).toBe("interested");
    expect((await db.select().from(leads).where(eq(leads.businessId, b2.id)))[0].status).toMatch(/success|contacted/);

    unwrap(await deleteCampaignAction(campaign.id));

    expect(await getCallCampaign(db, campaign.id)).toBeNull();
    expect(await callActivities(b1.id)).toHaveLength(0);
    expect(await callActivities(b2.id)).toHaveLength(0);
    for (const id of [b1.id, b2.id]) {
      const b = await biz(id);
      expect(b.status).toBe("new");
      expect(b.lastContactedAt).toBeNull();
    }
    expect((await db.select().from(leads).where(eq(leads.businessId, b2.id)))[0].status).toBe("queued");
  });

  it("falls back to the history another campaign left, keeps manual statuses, and never undoes do-not-call", async () => {
    const tA = new Date("2026-03-03T15:00:00Z");
    const tB = new Date("2026-03-04T15:00:00Z");
    const { campaign: older, biz: [shared] } = await makeCampaign(1);
    await callOnce(older.id, "voicemail", tA); // shared → contacted, lastContactedAt tA

    const manual = await makeBusiness({ status: "interested" });
    const dnc = await makeBusiness();
    const newer = await createCallCampaign(db, { name: "Newer", status: "running", timezone: "America/Chicago" });
    await addBusinessesToCampaign(db, newer.id, [shared.id, manual.id, dnc.id]);
    const outcomes: Record<string, "callback" | "busy" | "do_not_call"> = {
      [shared.id]: "callback",
      [manual.id]: "busy",
      [dnc.id]: "do_not_call",
    };
    for (let i = 0; i < 3; i++) {
      const at = new Date(tB.getTime() + i * 60_000);
      const claim = await claimNext(db, newer.id, "qa", at);
      if (!claim.ok) throw new Error(claim.reason);
      const outcome = outcomes[claim.business.id];
      await recordOutcome(db, claim.item.id, { outcome, agent: "qa", callbackAt: outcome === "callback" ? new Date("2026-03-05T16:00:00Z") : undefined }, at);
    }
    expect((await biz(shared.id)).status).toBe("callback");
    expect((await biz(manual.id)).status).toBe("interested"); // busy does not downgrade a manual status
    expect((await biz(dnc.id)).doNotCall).toBe(true);

    unwrap(await deleteCampaignAction(newer.id));

    const s = await biz(shared.id);
    expect(s.status).toBe("contacted"); // from the older campaign's voicemail
    expect(s.lastContactedAt?.toISOString()).toBe(tA.toISOString());
    expect(s.nextFollowUpAt).toBeNull();
    expect(await callActivities(shared.id)).toHaveLength(1);

    const m = await biz(manual.id);
    expect(m.status).toBe("interested");
    expect(m.lastContactedAt).toBeNull();

    const d = await biz(dnc.id);
    expect(d.doNotCall).toBe(true);
    expect(d.status).toBe("do_not_call");

    // The older campaign is untouched.
    expect(await getCallCampaign(db, older.id)).not.toBeNull();
  });
});
