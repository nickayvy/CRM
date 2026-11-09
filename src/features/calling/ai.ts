// AI calling: places ElevenLabs calls for an AI-mode campaign and turns
// post-call webhooks into queue outcomes. Server only; the caller passes the
// db and the CallPlacer so tests can swap both.
import { formatInTimeZone } from "date-fns-tz";
import {
  AI_AGENT,
  claimNextForAi,
  createAiCall,
  getAiCall,
  getAiCallByConversation,
  updateAiCall,
} from "@/db/repo/ai-calls";
import { type DbOrTx, QueueItemError, getCallCampaign, recordOutcome, releaseItem } from "@/db/repo/call-campaigns";
import type { AiCall, Business, CallCampaign, CallOutcome } from "@/db/schema";
import { type CallPlacer, toE164 } from "@/lib/elevenlabs/client";
import { tokenValues } from "./script-tokens";
import { defaultCallbackValue, parseLocalDateTime } from "./time";
import { CALL_OUTCOMES } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------ placing calls

/** Script with `{{tokens}}` replaced by plain values (blank when unknown); the agent reads it as context. */
export function plainScript(script: string, b: Business): string {
  const values = tokenValues(b, AI_AGENT);
  return script.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, raw: string) => {
    const key = raw.toLowerCase();
    return key in values ? (values[key] ?? "") : whole;
  });
}

/** Values for the ElevenLabs agent prompt. Every variable the prompt names must be present. */
export function dynamicVariables(c: CallCampaign, b: Business, aiCallId: string, now: Date): Record<string, string> {
  const v = tokenValues(b);
  return {
    business_name: b.name,
    business_city: [b.city, b.state].filter(Boolean).join(", ") || "unknown",
    business_category: v.category ?? "local business",
    contact_name: v.owner_name ?? "unknown",
    local_time: formatInTimeZone(now, c.timezone, "EEEE, yyyy-MM-dd HH:mm"),
    campaign_script: plainScript(c.script, b).trim() || "Introduce yourself and ask whether they would like a follow-up from the team.",
    leadwire_call_id: aiCallId,
  };
}

export type DispatchResult = {
  placed: number;
  /** Why dispatch stopped: capacity reached, queue empty, campaign not running, not an AI campaign, or an API error. */
  stopped: "at_capacity" | "empty" | "not_running" | "not_ai" | "error";
  error?: string;
};

/**
 * Fills the campaign's free AI slots (maxConcurrentAgents minus calls in
 * flight) with new calls. An item with no dialable number is closed as
 * wrong_number; an API failure releases the item to the end of the queue,
 * marks the call failed and stops.
 */
export async function dispatchAiCalls(
  db: DbOrTx,
  campaignId: string,
  placer: CallPlacer,
  now: Date = new Date(),
): Promise<DispatchResult> {
  const campaign = await getCallCampaign(db, campaignId);
  if (!campaign || campaign.mode !== "ai") return { placed: 0, stopped: "not_ai" };
  let placed = 0;
  // Bounded: at most one pass per slot, plus skipped undialable rows.
  for (let guard = 0; guard < campaign.maxConcurrentAgents + 20; guard++) {
    const claim = await claimNextForAi(db, campaignId, now);
    if (!claim.ok) return { placed, stopped: claim.reason };
    const { item, business } = claim;

    const to = toE164(business.phone);
    if (!to) {
      await recordOutcome(db, item.id, { outcome: "wrong_number", notes: "No dialable phone number.", agent: AI_AGENT }, now);
      continue;
    }

    const call = await createAiCall(db, {
      campaignId,
      queueItemId: item.id,
      businessId: business.id,
      toNumber: to,
      startedAt: now,
    });
    try {
      const r = await placer.placeCall({ toNumber: to, dynamicVariables: dynamicVariables(campaign, business, call.id, now) });
      await updateAiCall(db, call.id, { conversationId: r.conversationId, callSid: r.callSid });
      placed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateAiCall(db, call.id, { status: "failed", error: message.slice(0, 1000), endedAt: now });
      await releaseItem(db, item.id);
      return { placed, stopped: "error", error: message };
    }
  }
  return { placed, stopped: "at_capacity" };
}

// ------------------------------------------------------------------ webhooks

type Turn = { role?: unknown; message?: unknown };
type CollectionResult = { value?: unknown; rationale?: unknown };

export type ElevenLabsWebhook = {
  type?: string;
  event_timestamp?: number;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    failure_reason?: string;
    transcript?: Turn[];
    metadata?: { call_duration_secs?: number };
    analysis?: {
      transcript_summary?: string;
      call_successful?: string;
      data_collection_results?: Record<string, CollectionResult>;
    };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
};

export type WebhookResult =
  | { handled: true; callId: string; campaignId: string; outcome: CallOutcome; warning?: string }
  | { handled: false; reason: "ignored_type" | "unknown_call" | "duplicate" };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function findCall(db: DbOrTx, data: NonNullable<ElevenLabsWebhook["data"]>): Promise<AiCall | null> {
  const conv = str(data.conversation_id);
  if (conv) {
    const byConv = await getAiCallByConversation(db, conv);
    if (byConv) return byConv;
  }
  const id = str(data.conversation_initiation_client_data?.dynamic_variables?.leadwire_call_id);
  return UUID_RE.test(id) ? getAiCall(db, id) : null;
}

/** Maps the agent's data collection onto one queue outcome; anything unreadable counts as no_answer (a retry). */
export function outcomeFromAnalysis(results: Record<string, CollectionResult> | undefined): CallOutcome {
  const v = str(results?.call_outcome?.value).toLowerCase();
  return (CALL_OUTCOMES as readonly string[]).includes(v) ? (v as CallOutcome) : "no_answer";
}

const FAILURE_OUTCOME: Record<string, CallOutcome> = { busy: "busy", "no-answer": "no_answer" };

/**
 * Applies one verified ElevenLabs webhook. post_call_transcription records the
 * agent's outcome, summary and transcript; call_initiation_failure records
 * busy/no_answer. Each call is applied once; repeats are ignored.
 */
export async function handleWebhook(db: DbOrTx, event: ElevenLabsWebhook, now: Date = new Date()): Promise<WebhookResult> {
  const type = event.type;
  if (type !== "post_call_transcription" && type !== "call_initiation_failure") return { handled: false, reason: "ignored_type" };
  const data = event.data ?? {};
  const call = await findCall(db, data);
  if (!call) return { handled: false, reason: "unknown_call" };
  if (call.status !== "initiated") return { handled: false, reason: "duplicate" };
  const campaign = await getCallCampaign(db, call.campaignId);
  const tz = campaign?.timezone ?? "UTC";

  let outcome: CallOutcome;
  let notes: string;
  let callbackAt: Date | undefined;
  const patch: Parameters<typeof updateAiCall>[2] = { endedAt: now, conversationId: call.conversationId ?? (str(data.conversation_id) || null) };

  if (type === "call_initiation_failure") {
    const reason = str(data.failure_reason) || "unknown";
    outcome = FAILURE_OUTCOME[reason] ?? "no_answer";
    notes = `AI call did not connect (${reason}).`;
    Object.assign(patch, { status: "failed", outcome, error: `Call not connected: ${reason}` });
  } else {
    const results = data.analysis?.data_collection_results ?? {};
    outcome = outcomeFromAnalysis(results);
    const summary = str(data.analysis?.transcript_summary);
    const extra = str(results.notes?.value);
    const contact = str(results.contact_name?.value);
    notes = [summary, extra, contact ? `Spoke with ${contact}.` : ""].filter(Boolean).join("\n\n") || "AI call, no summary.";
    if (outcome === "callback") {
      const asked = parseLocalDateTime(str(results.callback_at?.value).slice(0, 16), tz);
      callbackAt = asked && asked.getTime() > now.getTime() ? asked : (parseLocalDateTime(defaultCallbackValue(now, tz), tz) ?? undefined);
    }
    const transcript = (Array.isArray(data.transcript) ? data.transcript : [])
      .filter((t) => typeof t?.message === "string" && t.message.trim())
      .slice(0, 300)
      .map((t) => ({ role: str(t.role) || "unknown", message: str(t.message).slice(0, 2000) }));
    Object.assign(patch, {
      status: "completed",
      outcome,
      summary: summary || null,
      transcript,
      analysis: results as Record<string, unknown>,
      durationSecs: typeof data.metadata?.call_duration_secs === "number" ? Math.round(data.metadata.call_duration_secs) : null,
    });
  }

  let warning: string | undefined;
  if (call.queueItemId) {
    try {
      await recordOutcome(db, call.queueItemId, { outcome, notes, callbackAt, agent: AI_AGENT }, now);
    } catch (err) {
      if (!(err instanceof QueueItemError)) throw err;
      warning = err.message;
    }
  }
  if (warning) patch.error = [patch.error, `Outcome not applied: ${warning}`].filter(Boolean).join(" ");
  await updateAiCall(db, call.id, patch);
  return { handled: true, callId: call.id, campaignId: call.campaignId, outcome, warning };
}
