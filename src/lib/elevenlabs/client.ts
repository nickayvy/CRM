// ElevenLabs Agents: outbound calls through an imported Twilio number, and
// verification of post-call webhooks. Server only.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

const API_BASE = "https://api.elevenlabs.io";
/** ElevenLabs rejects webhook timestamps older than this; we do the same. */
export const SIGNATURE_TOLERANCE_SECS = 30 * 60;

export type OutboundCallInput = {
  toNumber: string;
  /** Agent to place the call with; defaults to the shared template agent (ELEVENLABS_AGENT_ID). */
  agentId?: string;
  /** Values for the agent prompt's {{variables}}. All values must be strings. */
  dynamicVariables: Record<string, string>;
};

export type OutboundCallResult = { conversationId: string | null; callSid: string | null };

export interface CallPlacer {
  placeCall(input: OutboundCallInput): Promise<OutboundCallResult>;
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

/** Which of the env vars AI calling needs are missing (empty → ready). */
export function missingElevenLabsConfig(): string[] {
  const missing: string[] = [];
  if (!env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!env.ELEVENLABS_AGENT_ID) missing.push("ELEVENLABS_AGENT_ID");
  if (!env.ELEVENLABS_PHONE_NUMBER_ID) missing.push("ELEVENLABS_PHONE_NUMBER_ID");
  if (!env.ELEVENLABS_WEBHOOK_SECRET) missing.push("ELEVENLABS_WEBHOOK_SECRET");
  return missing;
}

/** Places calls with POST /v1/convai/twilio/outbound-call. Throws ElevenLabsError when unconfigured or rejected. */
export function createElevenLabsCaller(fetchImpl: typeof fetch = fetch): CallPlacer {
  return {
    async placeCall(input) {
      const { toNumber, dynamicVariables } = input;
      const apiKey = env.ELEVENLABS_API_KEY;
      const agentId = input.agentId || env.ELEVENLABS_AGENT_ID;
      const phoneId = env.ELEVENLABS_PHONE_NUMBER_ID;
      if (!apiKey || !agentId || !phoneId) throw new ElevenLabsError("ElevenLabs is not configured.");
      const res = await fetchImpl(`${API_BASE}/v1/convai/twilio/outbound-call`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: phoneId,
          to_number: toNumber,
          conversation_initiation_client_data: { dynamic_variables: dynamicVariables },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        conversation_id?: string | null;
        callSid?: string | null;
        detail?: unknown;
      };
      if (!res.ok || body.success === false) {
        const detail = body.message ?? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? ""));
        throw new ElevenLabsError(`ElevenLabs refused the call (${res.status}): ${detail}`.slice(0, 500), res.status);
      }
      return { conversationId: body.conversation_id ?? null, callSid: body.callSid ?? null };
    },
  };
}

// ------------------------------------------------------------------ agents

/** Per-campaign agents: each AI campaign gets a copy of the template agent, deleted with the campaign. */
export interface AgentManager {
  /** POST /v1/convai/agents/{template}/duplicate → the new agent's id. */
  duplicateAgent(templateAgentId: string, name: string): Promise<string>;
  /** PATCH /v1/convai/agents/{id} with a new name. */
  renameAgent(agentId: string, name: string): Promise<void>;
  /** DELETE /v1/convai/agents/{id}. Resolves when the agent is gone, including when it already was (404). */
  deleteAgent(agentId: string): Promise<void>;
}

/** Env vars agent management needs (empty → ready). Calls also need the phone number and webhook secret. */
export function missingAgentConfig(): string[] {
  const missing: string[] = [];
  if (!env.ELEVENLABS_API_KEY) missing.push("ELEVENLABS_API_KEY");
  if (!env.ELEVENLABS_AGENT_ID) missing.push("ELEVENLABS_AGENT_ID");
  return missing;
}

/** Where to open an agent in the ElevenLabs dashboard. */
export function agentDashboardUrl(agentId: string): string {
  return `https://elevenlabs.io/app/agents/${encodeURIComponent(agentId)}`;
}

async function errorDetail(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; detail?: unknown };
  return (body.message ?? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? ""))).slice(0, 400);
}

export function createElevenLabsAgents(fetchImpl: typeof fetch = fetch): AgentManager {
  const headers = () => {
    const apiKey = env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new ElevenLabsError("ElevenLabs is not configured.");
    return { "xi-api-key": apiKey, "content-type": "application/json" };
  };
  const agentPath = (id: string) => `${API_BASE}/v1/convai/agents/${encodeURIComponent(id)}`;
  return {
    async duplicateAgent(templateAgentId, name) {
      const res = await fetchImpl(`${agentPath(templateAgentId)}/duplicate`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new ElevenLabsError(`ElevenLabs could not copy the agent (${res.status}): ${await errorDetail(res)}`, res.status);
      const body = (await res.json().catch(() => ({}))) as { agent_id?: string };
      if (!body.agent_id) throw new ElevenLabsError("ElevenLabs returned no agent id.");
      return body.agent_id;
    },
    async renameAgent(agentId, name) {
      const res = await fetchImpl(agentPath(agentId), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new ElevenLabsError(`ElevenLabs could not rename the agent (${res.status}): ${await errorDetail(res)}`, res.status);
    },
    async deleteAgent(agentId) {
      const res = await fetchImpl(agentPath(agentId), {
        method: "DELETE",
        headers: { "xi-api-key": headers()["xi-api-key"] },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok || res.status === 404) return;
      throw new ElevenLabsError(`ElevenLabs could not delete the agent (${res.status}): ${await errorDetail(res)}`, res.status);
    },
  };
}

/**
 * Verifies an `ElevenLabs-Signature` header (`t=<unix>,v0=<hex>[,v0=<hex>]`):
 * each v0 is HMAC-SHA256(secret, `${t}.${rawBody}`) in hex, and `t` must be
 * within the tolerance of `now`.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now: Date = new Date(),
): boolean {
  if (!header || !secret) return false;
  let t: string | null = null;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t") t = v ?? null;
    else if (k === "v0" && v) sigs.push(v);
  }
  if (!t || !/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SECS) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Test helper and docs: the header ElevenLabs would send for `rawBody` at `t`. */
export function signWebhook(rawBody: string, secret: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

/** Best-effort E.164 for a US/CA-centric dataset: keeps a leading +, else 10 digits → +1. */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
