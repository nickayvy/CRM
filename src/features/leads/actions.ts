"use server";

// WP-15: /leads server actions. The user always comes from requireUser(),
// never from the client; every repo call is scoped by that user's id.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addBusinessesToCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { enrollBusinesses, getEmailCampaign } from "@/db/repo/email-campaigns";
import { addLead, listLeads, removeLead, updateLead } from "@/db/repo/leads";
import { leadStatusEnum } from "@/db/schema";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { requireUser } from "@/lib/supabase/server";

const MAX_BULK = 1000;
const MAX_NOTES = 5000;

const leadId = z.uuid({ error: "Invalid lead." });
const leadIds = z
  .array(z.uuid())
  .min(1, "Select at least one lead.")
  .max(MAX_BULK, `At most ${MAX_BULK} at a time.`);
const patchSchema = z
  .object({
    status: z.enum(leadStatusEnum.enumValues).optional(),
    notes: z.string().max(MAX_NOTES, `Notes are limited to ${MAX_NOTES} characters.`).nullable().optional(),
  })
  .strict()
  .refine((p) => p.status !== undefined || p.notes !== undefined, "Nothing to update.");

function firstIssue(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input.";
}

function revalidateLeads() {
  revalidatePath("/leads");
}

export type LeadPatch = z.input<typeof patchSchema>;

/** Adds a business to the signed-in user's leads (idempotent). */
export async function addLeadAction(businessId: string): Promise<ActionResult<{ leadId: string; created: boolean }>> {
  const user = await requireUser();
  const p = z.uuid().safeParse(businessId);
  if (!p.success) return fail("Invalid business.");
  try {
    const r = await addLead(getDb(), user.id, p.data);
    revalidateLeads();
    return ok({ leadId: r.lead.id, created: r.created });
  } catch (err) {
    console.error("[leads] addLeadAction failed", err);
    return fail("Could not add the lead.");
  }
}

/** Status and/or notes on one of the signed-in user's leads. Empty notes clear them. */
export async function updateLeadAction(
  id: string,
  patch: LeadPatch,
): Promise<ActionResult<{ id: string; status: string; notes: string | null }>> {
  const user = await requireUser();
  const idP = leadId.safeParse(id);
  if (!idP.success) return fail(firstIssue(idP.error));
  const p = patchSchema.safeParse(patch);
  if (!p.success) return fail(firstIssue(p.error));
  const notes = p.data.notes === undefined ? undefined : p.data.notes?.trim() ? p.data.notes.trim() : null;
  try {
    const row = await updateLead(getDb(), user.id, idP.data, { status: p.data.status, notes });
    if (!row) return fail("Lead not found.");
    revalidateLeads();
    return ok({ id: row.id, status: row.status, notes: row.notes });
  } catch (err) {
    console.error("[leads] updateLeadAction failed", err);
    return fail("Could not update the lead.");
  }
}

export async function removeLeadAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const p = leadId.safeParse(id);
  if (!p.success) return fail(firstIssue(p.error));
  try {
    const removed = await removeLead(getDb(), user.id, p.data);
    if (!removed) return fail("Lead not found.");
    revalidateLeads();
    return ok(null);
  } catch (err) {
    console.error("[leads] removeLeadAction failed", err);
    return fail("Could not remove the lead.");
  }
}

/** Removes the user's leads among `ids`; other users' ids are ignored (not counted). */
export async function bulkRemoveLeadsAction(ids: string[]): Promise<ActionResult<{ removed: number }>> {
  const user = await requireUser();
  const p = leadIds.safeParse(ids);
  if (!p.success) return fail(firstIssue(p.error));
  try {
    const db = getDb();
    let removed = 0;
    for (const id of new Set(p.data)) if (await removeLead(db, user.id, id)) removed += 1;
    revalidateLeads();
    return ok({ removed });
  } catch (err) {
    console.error("[leads] bulkRemoveLeadsAction failed", err);
    return fail("Could not remove the leads.");
  }
}

/** Business ids behind the user's own leads among `ids` (others' and unknown ids drop out). */
async function ownBusinessIds(userId: string, ids: string[]): Promise<string[]> {
  const wanted = new Set(ids);
  const mine = await listLeads(getDb(), userId);
  return mine.filter((l) => wanted.has(l.id)).map((l) => l.businessId);
}

const bulkInput = z.object({ campaignId: z.uuid({ error: "Choose a campaign." }), ids: leadIds });

type BulkResult = ActionResult<{ added: number; skipped: number; campaignName: string }>;

/** Appends the leads' businesses to a call campaign queue (skips queued, do-not-call, no phone). */
export async function addLeadsToCallCampaignAction(campaignId: string, ids: string[]): Promise<BulkResult> {
  const user = await requireUser();
  const p = bulkInput.safeParse({ campaignId, ids });
  if (!p.success) return fail(firstIssue(p.error));
  try {
    const db = getDb();
    const campaign = await getCallCampaign(db, p.data.campaignId);
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status === "completed") return fail("That campaign is completed.");
    const businessIds = await ownBusinessIds(user.id, p.data.ids);
    if (businessIds.length === 0) return fail("No matching leads.");
    const r = await addBusinessesToCampaign(db, campaign.id, businessIds);
    revalidatePath("/calling");
    revalidatePath(`/calling/${campaign.id}`);
    revalidateLeads();
    return ok({ added: r.added, skipped: r.skipped, campaignName: campaign.name });
  } catch (err) {
    console.error("[leads] addLeadsToCallCampaignAction failed", err);
    return fail("Could not add to the campaign.");
  }
}

/** Enrolls the leads' businesses in an email sequence (skips no owner email, do-not-email, enrolled). */
export async function addLeadsToEmailCampaignAction(campaignId: string, ids: string[]): Promise<BulkResult> {
  const user = await requireUser();
  const p = bulkInput.safeParse({ campaignId, ids });
  if (!p.success) return fail(firstIssue(p.error));
  try {
    const db = getDb();
    const campaign = await getEmailCampaign(db, p.data.campaignId);
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status === "completed") return fail("That campaign is completed.");
    const businessIds = await ownBusinessIds(user.id, p.data.ids);
    if (businessIds.length === 0) return fail("No matching leads.");
    const r = await enrollBusinesses(db, campaign.id, businessIds);
    revalidatePath("/email");
    revalidatePath(`/email/${campaign.id}`);
    revalidateLeads();
    return ok({ added: r.enrolled, skipped: r.skipped, campaignName: campaign.name });
  } catch (err) {
    console.error("[leads] addLeadsToEmailCampaignAction failed", err);
    return fail("Could not enroll in the campaign.");
  }
}
