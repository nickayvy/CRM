// Per-campaign ElevenLabs agents: created with an AI campaign, renamed with
// it, used for its calls and deleted with it. The ElevenLabs API is a fetch
// stub that records every request.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { addBusinessesToCampaign, createCallCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { type NewCallCampaign, businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import type { ActionResult } from "@/lib/action-result";
import { createElevenLabsCaller } from "@/lib/elevenlabs/client";
import { agentNameFor } from "@/features/calling/agents";
import { dispatchAiCalls } from "@/features/calling/ai";
import { normalizeName, phoneDigits } from "@/lib/format";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { createCampaignAction, deleteCampaignAction, updateCampaignAction } = await import("@/features/calling/actions");

let db: Db;
let close: () => Promise<void>;

type Recorded = { method: string; url: string; body: Record<string, unknown> | null; headers: Record<string, string> };
let requests: Recorded[];
/** Per-URL-suffix responders; default is 200 `{}`. */
let respond: (req: Recorded) => { status: number; body?: unknown } | undefined;

function stubFetch() {
  requests = [];
  respond = () => undefined;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const rec: Recorded = {
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      headers: (init?.headers as Record<string, string>) ?? {},
    };
    requests.push(rec);
    const r = respond(rec) ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  });
}

function configure() {
  vi.stubEnv("ELEVENLABS_API_KEY", "key-test");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "agent_template");
  vi.stubEnv("ELEVENLABS_PHONE_NUMBER_ID", "phone_1");
  vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", "whsec");
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const campaignForm = (o: Record<string, string> = {}) => form({ name: "Houston plumbers", timezone: "America/Chicago", mode: "ai", ...o });

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
const idFrom = (url: string) => url.replace("/calling/", "");

function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.message ?? "(no message)"}`);
  return r.data;
}

async function makeCampaign(overrides: Partial<NewCallCampaign> = {}) {
  return createCallCampaign(db, { name: "Direct", status: "running", mode: "ai", timezone: "America/Chicago", ...overrides });
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  globalThis.__db = { db, driver: "pglite", close };
});
afterAll(async () => {
  globalThis.__db = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await close();
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  stubFetch();
  await db.execute(sql`TRUNCATE TABLE ai_calls, call_queue_items, call_campaigns, activities, businesses RESTART IDENTITY CASCADE`);
});
afterEach(() => vi.unstubAllGlobals());

const duplicates = () => requests.filter((r) => r.method === "POST" && r.url.endsWith("/duplicate"));
const deletes = () => requests.filter((r) => r.method === "DELETE");
const patches = () => requests.filter((r) => r.method === "PATCH");

describe("agentNameFor", () => {
  it("prefixes and trims to 100 characters", () => {
    expect(agentNameFor("  Houston plumbers ")).toBe("LAR · Houston plumbers");
    expect(agentNameFor("x".repeat(200))).toHaveLength(100);
  });
});

describe("creating a campaign", () => {
  it("copies the template agent for an AI campaign and stores the copy's id", async () => {
    configure();
    respond = (r) => (r.url.endsWith("/duplicate") ? { status: 200, body: { agent_id: "agent_copy_1" } } : undefined);
    const id = idFrom(await redirectUrl(createCampaignAction(null, campaignForm())));
    const c = await getCallCampaign(db, id);
    expect(c?.elevenlabsAgentId).toBe("agent_copy_1");
    expect(duplicates()).toHaveLength(1);
    expect(duplicates()[0].url).toBe("https://api.elevenlabs.io/v1/convai/agents/agent_template/duplicate");
    expect(duplicates()[0].body).toEqual({ name: "LAR · Houston plumbers" });
    expect(duplicates()[0].headers["xi-api-key"]).toBe("key-test");
  });

  it("makes no agent for a human campaign", async () => {
    configure();
    const id = idFrom(await redirectUrl(createCampaignAction(null, campaignForm({ mode: "human" }))));
    expect((await getCallCampaign(db, id))?.elevenlabsAgentId).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("without ElevenLabs config, or when the API refuses, the campaign is still created on the shared agent", async () => {
    const id1 = idFrom(await redirectUrl(createCampaignAction(null, campaignForm())));
    expect((await getCallCampaign(db, id1))?.elevenlabsAgentId).toBeNull();
    expect(requests).toHaveLength(0);

    configure();
    respond = () => ({ status: 500, body: { detail: "boom" } });
    const id2 = idFrom(await redirectUrl(createCampaignAction(null, campaignForm())));
    expect((await getCallCampaign(db, id2))?.elevenlabsAgentId).toBeNull();
    expect(duplicates()).toHaveLength(1);
  });
});

describe("updating a campaign", () => {
  it("renames the agent with the campaign, and provisions one when a human campaign becomes AI", async () => {
    configure();
    const withAgent = await makeCampaign({ elevenlabsAgentId: "agent_copy_2" });
    unwrap(await updateCampaignAction(withAgent.id, null, campaignForm({ name: "Dallas roofers" })));
    expect(patches()).toHaveLength(1);
    expect(patches()[0].url).toBe("https://api.elevenlabs.io/v1/convai/agents/agent_copy_2");
    expect(patches()[0].body).toEqual({ name: "LAR · Dallas roofers" });
    expect(duplicates()).toHaveLength(0);

    stubFetch();
    respond = (r) => (r.url.endsWith("/duplicate") ? { status: 200, body: { agent_id: "agent_copy_3" } } : undefined);
    const human = await makeCampaign({ mode: "human", name: "Direct" });
    unwrap(await updateCampaignAction(human.id, null, campaignForm({ name: "Direct", mode: "ai" })));
    expect((await getCallCampaign(db, human.id))?.elevenlabsAgentId).toBe("agent_copy_3");
    expect(patches()).toHaveLength(0);
  });

  it("saving with the same name sends nothing", async () => {
    configure();
    const c = await makeCampaign({ name: "Houston plumbers", elevenlabsAgentId: "agent_copy_4" });
    unwrap(await updateCampaignAction(c.id, null, campaignForm()));
    expect(requests).toHaveLength(0);
  });
});

describe("deleting a campaign", () => {
  it("deletes the agent then the campaign; an already-missing agent (404) does not block", async () => {
    configure();
    const a = await makeCampaign({ elevenlabsAgentId: "agent_copy_5" });
    unwrap(await deleteCampaignAction(a.id));
    expect(deletes().map((r) => r.url)).toEqual(["https://api.elevenlabs.io/v1/convai/agents/agent_copy_5"]);
    expect(await getCallCampaign(db, a.id)).toBeNull();

    stubFetch();
    respond = () => ({ status: 404, body: { detail: "gone" } });
    const b = await makeCampaign({ elevenlabsAgentId: "agent_copy_6" });
    unwrap(await deleteCampaignAction(b.id));
    expect(await getCallCampaign(db, b.id)).toBeNull();
  });

  it("keeps the campaign when the agent cannot be deleted", async () => {
    configure();
    respond = () => ({ status: 500, body: { detail: "down" } });
    const c = await makeCampaign({ elevenlabsAgentId: "agent_copy_7" });
    const r = await deleteCampaignAction(c.id);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toMatch(/kept/);
    expect(await getCallCampaign(db, c.id)).not.toBeNull();

    vi.unstubAllEnvs();
    stubFetch();
    const r2 = await deleteCampaignAction(c.id);
    expect(r2.ok).toBe(false);
    expect(requests).toHaveLength(0);
    expect(await getCallCampaign(db, c.id)).not.toBeNull();
  });

  it("a campaign without its own agent deletes without touching ElevenLabs", async () => {
    configure();
    const c = await makeCampaign({ elevenlabsAgentId: null });
    unwrap(await deleteCampaignAction(c.id));
    expect(requests).toHaveLength(0);
    expect(await getCallCampaign(db, c.id)).toBeNull();
  });
});

describe("placing calls", () => {
  async function queued(agentId: string | null) {
    const c = await makeCampaign({ elevenlabsAgentId: agentId, maxConcurrentAgents: 1 });
    const [b] = await db
      .insert(businesses)
      .values({
        yelpId: `agent-biz-${Math.random()}`,
        name: "Biz",
        nameNormalized: normalizeName("Biz"),
        phone: "+17135550100",
        phoneDigits: phoneDigits("+17135550100"),
        qualification: "qualified",
        categories: [],
        raw: {},
      })
      .returning();
    await addBusinessesToCampaign(db, c.id, [b.id]);
    return c;
  }

  it("uses the campaign's own agent, or the template when it has none", async () => {
    configure();
    let n = 0;
    respond = () => ({ status: 200, body: { success: true, conversation_id: `conv_${++n}`, callSid: `CA${n}` } });
    const own = await queued("agent_copy_8");
    expect(await dispatchAiCalls(db, own.id, createElevenLabsCaller())).toEqual({ placed: 1, stopped: "at_capacity" });
    const shared = await queued(null);
    expect(await dispatchAiCalls(db, shared.id, createElevenLabsCaller())).toEqual({ placed: 1, stopped: "at_capacity" });
    const calls = requests.filter((r) => r.url.endsWith("/outbound-call"));
    expect(calls.map((r) => r.body?.agent_id)).toEqual(["agent_copy_8", "agent_template"]);
  });
});
