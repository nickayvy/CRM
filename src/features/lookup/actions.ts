"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { deleteBusiness, getBusiness } from "@/db/repo/businesses";
import { addBusinessesToCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { addLead } from "@/db/repo/leads";
import { quickCreateCallCampaign } from "@/features/calling/quick-create";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { requireUser } from "@/lib/supabase/server";
import { type Dossier, loadDossier } from "./data";

/**
 * Adds the business to the signed-in user's lead list (idempotent). The user
 * always comes from `requireUser()`, never from the client.
 */
export async function addToLeadsAction(businessId: string): Promise<ActionResult<{ created: boolean }>> {
  const user = await requireUser();
  const db = getDb();
  if (typeof businessId !== "string" || !(await getBusiness(db, businessId))) return fail("Business not found");
  try {
    const { created } = await addLead(db, user.id, businessId);
    return ok({ created });
  } catch (err) {
    console.error("addToLeadsAction failed", err);
    return fail("Could not add the lead");
  }
}

/**
 * Permanently deletes a business from the network. Its activities, call-queue
 * items, campaign enrollments, leads and relations go with it (FK cascades).
 */
export async function deleteBusinessFromLookupAction(businessId: string): Promise<ActionResult<null>> {
  await requireUser();
  if (typeof businessId !== "string") return fail("Business not found");
  try {
    if (!(await deleteBusiness(getDb(), businessId))) return fail("Business not found");
  } catch (err) {
    console.error("deleteBusinessFromLookupAction failed", err);
    return fail("Could not delete the business");
  }
  revalidatePath("/lookup");
  revalidatePath("/businesses");
  revalidatePath("/leads");
  return ok(null);
}

/** The dossier for one business and its similar companies; null data when it does not exist. */
export async function getDossierAction(businessId: string): Promise<ActionResult<Dossier>> {
  await requireUser();
  if (typeof businessId !== "string") return fail("Business not found");
  const dossier = await loadDossier(getDb(), businessId);
  return dossier ? ok(dossier) : fail("Business not found");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Creates a draft call campaign from just a name (the dossier's "New campaign" option). */
export async function createCallCampaignAction(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  await requireUser();
  try {
    const res = await quickCreateCallCampaign(getDb(), name);
    if (res.ok) revalidatePath("/calling");
    return res;
  } catch (err) {
    console.error("createCallCampaignAction failed", err);
    return fail("Could not create the campaign.");
  }
}

/** Appends one business to a call campaign's queue (skipped when already queued, do not call, or phoneless). */
export async function queueBusinessForCallsAction(
  campaignId: string,
  businessId: string,
): Promise<ActionResult<{ added: number; skipped: number; campaignName: string }>> {
  await requireUser();
  if (typeof campaignId !== "string" || !UUID_RE.test(campaignId)) return fail("Choose a campaign.");
  if (typeof businessId !== "string" || !UUID_RE.test(businessId)) return fail("Business not found");
  try {
    const db = getDb();
    const campaign = await getCallCampaign(db, campaignId);
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status === "completed") return fail("That campaign is completed.");
    const r = await addBusinessesToCampaign(db, campaign.id, [businessId]);
    revalidatePath("/calling");
    revalidatePath(`/calling/${campaign.id}`);
    return ok({ added: r.added, skipped: r.skipped, campaignName: campaign.name });
  } catch (err) {
    console.error("queueBusinessForCallsAction failed", err);
    return fail("Could not add to the campaign.");
  }
}
