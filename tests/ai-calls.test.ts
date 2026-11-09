// AI calling (ElevenLabs): dispatch, webhook handling, signature checks, the webhook route.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { AI_AGENT, countActiveAiClaims, getAiCall, listAiCalls } from "@/db/repo/ai-calls";
import { addBusinessesToCampaign, createCallCampaign, getQueueItem } from "@/db/repo/call-campaigns";
import {
  type Business,
  type CallCampaign,
  type NewBusiness,
  type NewCallCampaign,
  activities,
  businesses,
  callQueueItems,
} from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { type ElevenLabsWebhook, dispatchAiCalls, handleWebhook, outcomeFromAnalysis } from "@/features/calling/ai";
import { parseCampaignForm } from "@/features/calling/schema";
import { parseLocalDateTime } from "@/features/calling/time";
import { type CallPlacer, type OutboundCallInput, signWebhook, toE164, verifyWebhookSignature } from "@/lib/elevenlabs/client";
import { normalizeName, phoneDigits } from "@/lib/format";

const afterFns = vi.hoisted(() => [] as (() => Promise<void> | void)[]);
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void> | void) => void afterFns.push(fn),
}));

const route = await import("@/app/api/webhooks/elevenlabs/route");

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  vi.unstubAllEnvs();
  await close();
});
beforeEach(async () => {
  afterFns.length = 0;
  vi.unstubAllEnvs();
  await db.execute(sql`TRUNCATE TABLE ai_calls, call_queue_items, call_campaigns, activities, businesses RESTART IDENTITY CASCADE`);
});

// ---------------------------------------------------------------- fixtures

let seq = 0;

async function makeBusiness(overrides: Partial<NewBusiness> = {}): Promise<Business> {
  seq += 1;
  const name = overrides.name ?? `AI Biz ${seq}`;
  const phone = overrides.phone === undefined ? `+1713555${String(1000 + seq).slice(-4)}` : overrides.phone;
  const [row] = await db
    .insert(businesses)
    .values({
      yelpId: `ai-yelp-${seq}`,
      name,
      nameNormalized: normalizeName(name),
      phone,
      phoneDigits: phoneDigits(phone),
      reviewCount: 10,
      categories: [{ alias: "plumbing", title: "Plumbing" }],
      primaryCategory: "plumbing",
      city: "Houston",
      state: "TX",
      ownerName: "Dana Reyes",
      raw: {},
      ...overrides,
    })
    .returning();
  return row;
}

async function makeCampaign(n: number, overrides: Partial<NewCallCampaign> = {}): Promise<{ campaign: CallCampaign; biz: Business[] }> {
  const campaign = await createCallCampaign(db, {
    name: `AI Campaign ${++seq}`,
    status: "running",
    mode: "ai",
    timezone: "America/Chicago",
    maxConcurrentAgents: 2,
    script: "We help {{category}} shops in {{city}} get more reviews.",
    ...overrides,
  });
  const biz: Business[] = [];
  for (let i = 0; i < n; i++) biz.push(await makeBusiness());
  await addBusinessesToCampaign(db, campaign.id, biz.map((b) => b.id));
  return { campaign, biz };
}

function fakePlacer(fail?: string): CallPlacer & { calls: OutboundCallInput[] } {
  const calls: OutboundCallInput[] = [];
  return {
    calls,
    async placeCall(input) {
      if (fail) throw new Error(fail);
      calls.push(input);
      return { conversationId: `conv_${calls.length}_${seq}`, callSid: `CA${calls.length}` };
    },
  };
}

function transcription(conversationId: string, results: Record<string, unknown>, extra: Partial<NonNullable<ElevenLabsWebhook["data"]>> = {}): ElevenLabsWebhook {
  return {
    type: "post_call_transcription",
    event_timestamp: 1,
    data: {
      conversation_id: conversationId,
      status: "done",
      transcript: [
        { role: "agent", message: "Hi, is this the shop?" },
        { role: "user", message: "Yes, who's calling?" },
        { role: "agent", message: null as unknown as string },
      ],
      metadata: { call_duration_secs: 74.4 },
      analysis: {
        transcript_summary: "Owner wants a follow-up next week.",
        data_collection_results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, { value: v, rationale: "x" }])),
      },
      ...extra,
    },
  };
}

// ---------------------------------------------------------------- helpers

describe("toE164", () => {
  it("normalizes US numbers and keeps + numbers", () => {
    expect(toE164("(657) 334-6245")).toBe("+16573346245");
    expect(toE164("1-657-334-6245")).toBe("+16573346245");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("555-1234")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "wsec_test";
  const body = JSON.stringify({ type: "post_call_transcription" });
  const now = new Date("2026-11-09T12:00:00Z");
  const t = Math.floor(now.getTime() / 1000);

  it("accepts a correct signature, including among several v0 values", () => {
    const header = signWebhook(body, secret, t);
    expect(verifyWebhookSignature(body, header, secret, now)).toBe(true);
    expect(verifyWebhookSignature(body, `${header.split(",")[0]},v0=deadbeef,${header.split(",")[1]}`, secret, now)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, a stale timestamp and a malformed header", () => {
    const header = signWebhook(body, secret, t);
    expect(verifyWebhookSignature(body + " ", header, secret, now)).toBe(false);
    expect(verifyWebhookSignature(body, header, "other", now)).toBe(false);
    expect(verifyWebhookSignature(body, signWebhook(body, secret, t - 31 * 60), secret, now)).toBe(false);
    expect(verifyWebhookSignature(body, "garbage", secret, now)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret, now)).toBe(false);
  });
});

describe("outcomeFromAnalysis", () => {
  it("accepts known outcomes and falls back to no_answer", () => {
    expect(outcomeFromAnalysis({ call_outcome: { value: "interested" } })).toBe("interested");
    expect(outcomeFromAnalysis({ call_outcome: { value: " Do_Not_Call " } })).toBe("do_not_call");
    expect(outcomeFromAnalysis({ call_outcome: { value: "maybe" } })).toBe("no_answer");
    expect(outcomeFromAnalysis(undefined)).toBe("no_answer");
  });
});

describe("campaign form mode", () => {
  it("parses ai and defaults anything else to human", () => {
    const fd = (mode?: string) => {
      const f = new FormData();
      f.set("name", "X");
      f.set("timezone", "America/Chicago");
      if (mode !== undefined) f.set("mode", mode);
      return f;
    };
    expect(parseCampaignForm(fd("ai")).data?.mode).toBe("ai");
    expect(parseCampaignForm(fd("weird")).data?.mode).toBe("human");
    expect(parseCampaignForm(fd()).data?.mode).toBe("human");
  });
});

// ---------------------------------------------------------------- dispatch

describe("dispatchAiCalls", () => {
  it("fills maxConcurrentAgents slots with calls, passing the business and script to the agent", async () => {
    const { campaign, biz } = await makeCampaign(3);
    const placer = fakePlacer();
    const r = await dispatchAiCalls(db, campaign.id, placer);
    expect(r).toEqual({ placed: 2, stopped: "at_capacity" });
    expect(placer.calls).toHaveLength(2);
    const vars = placer.calls[0].dynamicVariables;
    expect(placer.calls[0].toNumber).toBe(toE164(biz[0].phone));
    expect(vars.business_name).toBe(biz[0].name);
    expect(vars.business_city).toBe("Houston, TX");
    expect(vars.contact_name).toBe("Dana Reyes");
    expect(vars.campaign_script).toBe("We help Plumbing shops in Houston get more reviews.");
    expect(Object.values(vars).every((v) => typeof v === "string")).toBe(true);
    expect(await countActiveAiClaims(db, campaign.id)).toBe(2);
    const calls = await listAiCalls(db, campaign.id);
    expect(calls.map((c) => c.status)).toEqual(["initiated", "initiated"]);
    expect(calls.every((c) => c.conversationId?.startsWith("conv_"))).toBe(true);
    expect(vars.leadwire_call_id).toBe(calls.find((c) => c.businessId === biz[0].id)?.id);
    // A second dispatch has no free slot.
    expect(await dispatchAiCalls(db, campaign.id, placer)).toEqual({ placed: 0, stopped: "at_capacity" });
  });

  it("refuses human campaigns and campaigns that are not running", async () => {
    const human = await makeCampaign(1, { mode: "human" });
    expect((await dispatchAiCalls(db, human.campaign.id, fakePlacer())).stopped).toBe("not_ai");
    const draft = await makeCampaign(1, { status: "draft" });
    expect((await dispatchAiCalls(db, draft.campaign.id, fakePlacer())).stopped).toBe("not_running");
  });

  it("on an API error marks the call failed and puts the item back in the queue", async () => {
    const { campaign } = await makeCampaign(2);
    const r = await dispatchAiCalls(db, campaign.id, fakePlacer("ElevenLabs refused the call (422): bad number"));
    expect(r.stopped).toBe("error");
    expect(r.placed).toBe(0);
    const [call] = await listAiCalls(db, campaign.id);
    expect(call.status).toBe("failed");
    expect(call.error).toContain("422");
    const item = await getQueueItem(db, call.queueItemId!);
    expect(item?.state).toBe("pending");
    expect(item?.claimedBy).toBeNull();
  });
});

// ---------------------------------------------------------------- webhooks

describe("handleWebhook", () => {
  async function oneCall() {
    const { campaign, biz } = await makeCampaign(1, { maxConcurrentAgents: 1 });
    await dispatchAiCalls(db, campaign.id, fakePlacer());
    const [call] = await listAiCalls(db, campaign.id);
    return { campaign, business: biz[0], call };
  }

  it("records an interested outcome, the summary and the transcript", async () => {
    const { business, call } = await oneCall();
    const r = await handleWebhook(db, transcription(call.conversationId!, { call_outcome: "interested", notes: "Uses a competitor today.", contact_name: "Dana" }));
    expect(r).toMatchObject({ handled: true, outcome: "interested" });
    const item = await getQueueItem(db, call.queueItemId!);
    expect(item?.state).toBe("completed");
    expect(item?.lastOutcome).toBe("interested");
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(biz.status).toBe("interested");
    const [act] = await db.select().from(activities).where(eq(activities.businessId, business.id));
    expect(act.agent).toBe(AI_AGENT);
    expect(act.body).toContain("Owner wants a follow-up next week.");
    expect(act.body).toContain("Uses a competitor today.");
    expect(act.body).toContain("Spoke with Dana.");
    const saved = await getAiCall(db, call.id);
    expect(saved).toMatchObject({ status: "completed", outcome: "interested", durationSecs: 74 });
    expect(saved?.transcript).toEqual([
      { role: "agent", message: "Hi, is this the shop?" },
      { role: "user", message: "Yes, who's calling?" },
    ]);
  });

  it("schedules a callback at the requested local time, or tomorrow 10:00 when none is usable", async () => {
    const { campaign, call } = await oneCall();
    const now = new Date("2026-11-09T18:00:00Z");
    await handleWebhook(db, transcription(call.conversationId!, { call_outcome: "callback", callback_at: "2026-11-12T14:30" }), now);
    const item = await getQueueItem(db, call.queueItemId!);
    expect(item?.state).toBe("callback");
    expect(item?.callbackAt?.toISOString()).toBe(parseLocalDateTime("2026-11-12T14:30", campaign.timezone)?.toISOString());

    const second = await oneCall();
    await handleWebhook(db, transcription(second.call.conversationId!, { call_outcome: "callback", callback_at: "" }), now);
    const item2 = await getQueueItem(db, second.call.queueItemId!);
    expect(item2?.callbackAt?.toISOString()).toBe(parseLocalDateTime("2026-11-10T10:00", "America/Chicago")?.toISOString());
  });

  it("an unreadable outcome counts as no_answer and the item is retried", async () => {
    const { call } = await oneCall();
    await handleWebhook(db, transcription(call.conversationId!, { call_outcome: "???" }));
    const item = await getQueueItem(db, call.queueItemId!);
    expect(item).toMatchObject({ state: "pending", lastOutcome: "no_answer", attempts: 1, claimedBy: AI_AGENT });
  });

  it("call_initiation_failure maps busy, and finds the call by leadwire_call_id", async () => {
    const { call } = await oneCall();
    const r = await handleWebhook(db, {
      type: "call_initiation_failure",
      data: {
        conversation_id: "conv_unknown_to_us",
        failure_reason: "busy",
        conversation_initiation_client_data: { dynamic_variables: { leadwire_call_id: call.id } },
      },
    });
    expect(r).toMatchObject({ handled: true, outcome: "busy" });
    const saved = await getAiCall(db, call.id);
    expect(saved).toMatchObject({ status: "failed", outcome: "busy" });
    expect((await getQueueItem(db, call.queueItemId!))?.lastOutcome).toBe("busy");
  });

  it("ignores repeats, unknown calls and other event types", async () => {
    const { call } = await oneCall();
    const ev = transcription(call.conversationId!, { call_outcome: "not_interested" });
    expect((await handleWebhook(db, ev)).handled).toBe(true);
    expect(await handleWebhook(db, ev)).toEqual({ handled: false, reason: "duplicate" });
    expect(await handleWebhook(db, transcription("conv_nope", {}))).toEqual({ handled: false, reason: "unknown_call" });
    expect(await handleWebhook(db, { type: "post_call_audio", data: {} })).toEqual({ handled: false, reason: "ignored_type" });
    const acts = await db.select().from(activities);
    expect(acts).toHaveLength(1);
  });

  it("do_not_call marks the business and removes it from other queues", async () => {
    const { business, call } = await oneCall();
    const other = await createCallCampaign(db, { name: "Other", status: "running", timezone: "America/Chicago" });
    await addBusinessesToCampaign(db, other.id, [business.id]);
    await handleWebhook(db, transcription(call.conversationId!, { call_outcome: "do_not_call" }));
    const [biz] = await db.select().from(businesses).where(eq(businesses.id, business.id));
    expect(biz.doNotCall).toBe(true);
    expect(await db.select().from(callQueueItems).where(eq(callQueueItems.campaignId, other.id))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- route

describe("POST /api/webhooks/elevenlabs", () => {
  const secret = "wsec_route";
  const post = (body: string, header: string | null) =>
    route.POST(
      new Request("http://localhost/api/webhooks/elevenlabs", {
        method: "POST",
        body,
        headers: header ? { "elevenlabs-signature": header, "content-type": "application/json" } : {},
      }),
    );

  it("is 503 without a secret and 401 with a bad signature", async () => {
    expect((await post("{}", "t=1,v0=x")).status).toBe(503);
    vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", secret);
    expect((await post("{}", "t=1,v0=x")).status).toBe(401);
  });

  it("applies a signed event and schedules the next dispatch", async () => {
    vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", secret);
    const { campaign } = await makeCampaign(2, { maxConcurrentAgents: 1 });
    await dispatchAiCalls(db, campaign.id, fakePlacer());
    const [call] = await listAiCalls(db, campaign.id);
    const body = JSON.stringify(transcription(call.conversationId!, { call_outcome: "interested" }));
    const res = await post(body, signWebhook(body, secret));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, handled: true, outcome: "interested" });
    expect(afterFns).toHaveLength(1);
    expect((await getAiCall(db, call.id))?.status).toBe("completed");
  });
});
