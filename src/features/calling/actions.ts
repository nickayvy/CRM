"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { listActivities } from "@/db/repo/activities";
import { listBusinessIds } from "@/db/repo/businesses";
import {
  QueueItemError,
  addBusinessesToCampaign,
  claimNext,
  countAddable,
  createCallCampaign,
  deleteCallCampaign,
  evaluateCampaign,
  getCallCampaign,
  getQueueItem,
  listItemHistory,
  listQueue,
  pauseCampaign,
  recordOutcome,
  releaseItem,
  removeQueueItem,
  resumeCampaign,
  startCampaign,
  updateCallCampaign,
} from "@/db/repo/call-campaigns";
import { getDb } from "@/db/client";
import type { CallCampaign, CallQueueItem } from "@/db/schema";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { cleanAgentName, getAgentName, setAgentName } from "@/lib/agent-cookie";
import {
  type AddFilter,
  addFilterSchema,
  addInputSchema,
  fieldErrors,
  outcomeSchema,
  parseCampaignForm,
  toBusinessFilter,
  toCampaignColumns,
} from "./schema";
import { createElevenLabsAgents, createElevenLabsCaller, missingElevenLabsConfig } from "@/lib/elevenlabs/client";
import { provisionCampaignAgent, releaseCampaignAgent, syncCampaignAgentName } from "./agents";
import { dispatchAiCalls } from "./ai";
import { parseLocalDateTime } from "./time";
import type { DialerCampaign, DialerClaim } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidateCampaign(id: string) {
  revalidatePath("/calling");
  revalidatePath(`/calling/${id}`);
  revalidatePath(`/calling/${id}/dial`);
}

function dialerCampaign(c: CallCampaign): DialerCampaign {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    pauseReason: c.pauseReason,
    script: c.script,
    timezone: c.timezone,
    maxAttempts: c.maxAttempts,
  };
}

// ------------------------------------------------------------------ campaign CRUD

/** Form action for /calling/new; redirects to the new campaign on success. */
export async function createCampaignAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseCampaignForm(formData);
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  let id: string;
  try {
    const db = getDb();
    const c = await createCallCampaign(db, { ...toCampaignColumns(parsed.data), status: "draft" });
    id = c.id;
    // Best effort: a failure here leaves the campaign on the shared agent.
    await provisionCampaignAgent(db, c, createElevenLabsAgents());
  } catch (err) {
    console.error("[calling] createCampaignAction failed", err);
    return fail("Could not create the campaign.");
  }
  revalidatePath("/calling");
  redirect(`/calling/${id}`);
}

/** Form action for /calling/[id]/settings (bind the id). */
export async function updateCampaignAction(
  id: string,
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseCampaignForm(formData);
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const db = getDb();
    const before = await getCallCampaign(db, id);
    if (!before) return fail("Campaign not found.");
    const c = await updateCallCampaign(db, id, toCampaignColumns(parsed.data));
    if (!c) return fail("Campaign not found.");
    const agents = createElevenLabsAgents();
    // Switched to (or saved as) AI without an agent yet → make one; renamed → rename it.
    await provisionCampaignAgent(db, c, agents);
    await syncCampaignAgentName(c, before.name, agents);
    // New hours/cap may change whether it should be running.
    await evaluateCampaign(db, id);
    revalidateCampaign(id);
    return ok({ id });
  } catch (err) {
    console.error("[calling] updateCampaignAction failed", err);
    return fail("Could not save the campaign.");
  }
}

/**
 * Deletes a campaign with everything it did (queue, AI call records, call
 * history, the business and lead state its outcomes set) and its own
 * ElevenLabs agent. When the agent cannot be deleted the campaign is kept so
 * nothing is orphaned. The client navigates back to /calling.
 */
export async function deleteCampaignAction(id: string): Promise<ActionResult> {
  if (!UUID_RE.test(id)) return fail("Campaign not found.");
  try {
    const db = getDb();
    const campaign = await getCallCampaign(db, id);
    if (!campaign) return fail("Campaign not found.");
    try {
      await releaseCampaignAgent(campaign, createElevenLabsAgents());
    } catch (err) {
      console.error(`[calling] agent delete failed for campaign ${id}`, err);
      return fail(`The campaign was kept because its ElevenLabs agent could not be deleted: ${err instanceof Error ? err.message : String(err)}`);
    }
    const deleted = await deleteCallCampaign(db, id);
    if (!deleted) return fail("Campaign not found.");
    revalidateCampaign(id);
    return ok(null);
  } catch (err) {
    console.error("[calling] deleteCampaignAction failed", err);
    return fail("Could not delete the campaign.");
  }
}

// ------------------------------------------------------------------ queue

/** Live count for the "Add businesses" panel: matches for the filter, and how many of those would be added. */
export async function previewAddAction(
  campaignId: string,
  filter: AddFilter,
): Promise<ActionResult<{ matching: number; addable: number }>> {
  const parsed = addFilterSchema.safeParse(filter);
  if (!parsed.success) return fail("Invalid filter.");
  try {
    const db = getDb();
    const ids = await listBusinessIds(db, toBusinessFilter(parsed.data));
    const addable = await countAddable(db, campaignId, ids);
    return ok({ matching: ids.length, addable });
  } catch (err) {
    console.error("[calling] previewAddAction failed", err);
    return fail("Could not count businesses.");
  }
}

/** Adds businesses by explicit ids or by filter. Skips duplicates, do-not-call and phoneless rows. */
export async function addBusinessesAction(
  campaignId: string,
  input: { filter: AddFilter } | { ids: string[] },
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const parsed = addInputSchema.safeParse(input);
  if (!parsed.success) return fail("Nothing to add.");
  try {
    const db = getDb();
    if (!(await getCallCampaign(db, campaignId))) return fail("Campaign not found.");
    const ids = "ids" in parsed.data ? parsed.data.ids : await listBusinessIds(db, toBusinessFilter(parsed.data.filter));
    const result = await addBusinessesToCampaign(db, campaignId, ids);
    revalidateCampaign(campaignId);
    return ok(result);
  } catch (err) {
    console.error("[calling] addBusinessesAction failed", err);
    return fail("Could not add businesses.");
  }
}

export async function removeQueueItemAction(itemId: string): Promise<ActionResult> {
  try {
    const db = getDb();
    const item = await getQueueItem(db, itemId);
    if (!item) return fail("Queue item not found.");
    if (item.state !== "pending") return fail("Only pending items can be removed.");
    await removeQueueItem(db, itemId);
    revalidateCampaign(item.campaignId);
    return ok(null);
  } catch (err) {
    console.error("[calling] removeQueueItemAction failed", err);
    return fail("Could not remove the item.");
  }
}

// ------------------------------------------------------------------ status controls

export async function pauseAction(campaignId: string): Promise<ActionResult> {
  try {
    await pauseCampaign(getDb(), campaignId);
    revalidateCampaign(campaignId);
    return ok(null);
  } catch (err) {
    console.error("[calling] pauseAction failed", err);
    return fail("Could not pause the campaign.");
  }
}

/** Resume, then evaluate at once so hours/cap rules apply immediately. */
export async function resumeAction(campaignId: string): Promise<ActionResult<CampaignStateResult>> {
  try {
    const db = getDb();
    await resumeCampaign(db, campaignId);
    const c = await evaluateCampaign(db, campaignId);
    const aiCalls = await autoPlaceAiCalls(c);
    revalidateCampaign(campaignId);
    return ok({ status: c.status, pauseReason: c.pauseReason, aiCalls });
  } catch (err) {
    console.error("[calling] resumeAction failed", err);
    return fail("Could not resume the campaign.");
  }
}

/** Outcome of the automatic AI dispatch after Start/Resume; null when nothing was attempted. */
export type AutoAiCalls = { placed: number; message: string; error: boolean } | null;
type CampaignStateResult = { status: string; pauseReason: string | null; aiCalls: AutoAiCalls };

/**
 * After an AI campaign starts or resumes, fill its free AI slots right away so
 * Start alone begins dialing. Never throws: a dispatch failure is reported
 * back without undoing the start.
 */
async function autoPlaceAiCalls(c: CallCampaign): Promise<AutoAiCalls> {
  if (c.mode !== "ai" || c.status !== "running") return null;
  const missing = missingElevenLabsConfig();
  if (missing.length) return { placed: 0, message: `AI calling is not configured. Missing: ${missing.join(", ")}.`, error: true };
  try {
    const r = await dispatchAiCalls(getDb(), c.id, createElevenLabsCaller());
    if (r.stopped === "error") {
      return { placed: r.placed, message: r.error ?? "The call could not be placed.", error: true };
    }
    if (r.placed === 0) return { placed: 0, message: DISPATCH_STOP_MESSAGES[r.stopped], error: false };
    return { placed: r.placed, message: `Placed ${r.placed} AI call${r.placed === 1 ? "" : "s"}.`, error: false };
  } catch (err) {
    console.error("[calling] autoPlaceAiCalls failed", err);
    return { placed: 0, message: "Could not place AI calls.", error: true };
  }
}

/** Draft → running. Refuses when the queue is empty. */
export async function startAction(campaignId: string): Promise<ActionResult<CampaignStateResult>> {
  try {
    const db = getDb();
    const c = await getCallCampaign(db, campaignId);
    if (!c) return fail("Campaign not found.");
    if (c.status !== "draft") return fail("Only a draft campaign can be started.");
    const { total } = await listQueue(db, campaignId, { state: ["pending", "callback"], limit: 0 });
    if (total === 0) return fail("Add businesses to the queue before starting.");
    await startCampaign(db, campaignId);
    const after = await evaluateCampaign(db, campaignId);
    const aiCalls = await autoPlaceAiCalls(after);
    revalidateCampaign(campaignId);
    return ok({ status: after.status, pauseReason: after.pauseReason, aiCalls });
  } catch (err) {
    console.error("[calling] startAction failed", err);
    return fail("Could not start the campaign.");
  }
}

// ------------------------------------------------------------------ dialer

/** Form action: stores the agent display name in the `crm_agent` cookie. */
export async function setAgentAction(
  _prev: ActionResult<{ name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ name: string }>> {
  const name = cleanAgentName(formData.get("name"));
  if (!name) return fail("Enter your name.", { name: ["Enter your name"] });
  await setAgentName(name);
  return ok({ name });
}

/** Claims the next item for the current agent and loads what the dialer shows. */
export async function claimNextAction(campaignId: string): Promise<ActionResult<DialerClaim>> {
  const agent = await getAgentName();
  if (!agent) return fail("Enter your name first.");
  if (!UUID_RE.test(campaignId)) return fail("Campaign not found.");
  try {
    const db = getDb();
    const r = await claimNext(db, campaignId, agent);
    if (!r.ok) {
      const c = await getCallCampaign(db, campaignId);
      if (!c) return fail("Campaign not found.");
      return ok({ ok: false, reason: r.reason, pauseReason: r.pauseReason, campaign: dialerCampaign(c) });
    }
    const [history, recent] = await Promise.all([
      listItemHistory(db, campaignId, r.business.id),
      listActivities(db, r.business.id, { limit: 5 }),
    ]);
    return ok({ ok: true, item: r.item, business: r.business, history, recent });
  } catch (err) {
    console.error("[calling] claimNextAction failed", err);
    return fail("Could not claim the next call.");
  }
}

/**
 * Records an outcome for a claimed item (bind the item id). Fields: outcome,
 * notes?, callbackAt (datetime-local in the campaign's time zone; required for callback).
 */
export async function recordOutcomeAction(
  itemId: string,
  _prev: ActionResult<CallQueueItem> | null,
  formData: FormData,
): Promise<ActionResult<CallQueueItem>> {
  const agent = await getAgentName();
  if (!agent) return fail("Enter your name first.");
  const outcome = outcomeSchema.safeParse(formData.get("outcome"));
  if (!outcome.success) return fail("Pick an outcome.", { outcome: ["Pick an outcome"] });
  const notesRaw = formData.get("notes");
  const notes = typeof notesRaw === "string" ? notesRaw.slice(0, 5000) : undefined;
  try {
    const db = getDb();
    const item = await getQueueItem(db, itemId);
    if (!item) return fail("Queue item not found.");
    let callbackAt: Date | undefined;
    if (outcome.data === "callback") {
      const c = await getCallCampaign(db, item.campaignId);
      const raw = formData.get("callbackAt");
      const parsed = typeof raw === "string" && c ? parseLocalDateTime(raw, c.timezone) : null;
      if (!parsed) return fail("Pick a callback date and time.", { callbackAt: ["Pick a date and time"] });
      if (parsed.getTime() <= Date.now()) return fail("The callback time must be in the future.", { callbackAt: ["Must be in the future"] });
      callbackAt = parsed;
    }
    const updated = await recordOutcome(db, itemId, { outcome: outcome.data, notes, callbackAt, agent });
    revalidateCampaign(item.campaignId);
    return ok(updated);
  } catch (err) {
    if (err instanceof QueueItemError) return fail(err.message);
    console.error("[calling] recordOutcomeAction failed", err);
    return fail("Could not record the outcome.");
  }
}

/** Skip: releases the item back to the end of the queue. */
export async function skipAction(itemId: string): Promise<ActionResult> {
  const agent = await getAgentName();
  if (!agent) return fail("Enter your name first.");
  try {
    const db = getDb();
    const item = await getQueueItem(db, itemId);
    if (!item) return fail("Queue item not found.");
    if (item.state !== "claimed" || item.claimedBy !== agent) return fail("This call is not yours to skip.");
    await releaseItem(db, itemId);
    revalidateCampaign(item.campaignId);
    return ok(null);
  } catch (err) {
    console.error("[calling] skipAction failed", err);
    return fail("Could not skip.");
  }
}

// ------------------------------------------------------------------ AI calling

const DISPATCH_STOP_MESSAGES: Record<string, string> = {
  at_capacity: "All AI call slots are busy.",
  empty: "Nothing in the queue is ready to call.",
  not_running: "The campaign is not running (draft, paused, outside calling hours or at its daily cap).",
  not_ai: "This campaign is not an AI campaign.",
};

/**
 * Fills the campaign's free AI call slots now. Further calls are placed
 * automatically as each call's webhook arrives.
 */
export async function placeAiCallsAction(campaignId: string): Promise<ActionResult<{ placed: number; message: string }>> {
  if (!UUID_RE.test(campaignId)) return fail("Campaign not found.");
  const missing = missingElevenLabsConfig();
  if (missing.length) return fail(`AI calling is not configured. Missing: ${missing.join(", ")}.`);
  try {
    const r = await dispatchAiCalls(getDb(), campaignId, createElevenLabsCaller());
    revalidateCampaign(campaignId);
    if (r.stopped === "error") return fail(r.placed ? `Placed ${r.placed}, then: ${r.error}` : (r.error ?? "The call could not be placed."));
    if (r.placed === 0) return fail(DISPATCH_STOP_MESSAGES[r.stopped]);
    return ok({ placed: r.placed, message: `Placed ${r.placed} AI call${r.placed === 1 ? "" : "s"}.` });
  } catch (err) {
    console.error("[calling] placeAiCallsAction failed", err);
    return fail("Could not place AI calls.");
  }
}
