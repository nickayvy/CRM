"use server";

// WP-07: "Add to call campaign…" / "Add to email campaign…" bulk actions on /businesses.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { addBusinessesToCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { enrollBusinesses, getEmailCampaign } from "@/db/repo/email-campaigns";
import { type ActionResult, fail, ok } from "@/lib/action-result";

const MAX_BULK = 1000;

const input = z.object({
  campaignId: z.uuid({ error: "Choose a campaign." }),
  ids: z.array(z.uuid()).min(1, "Select at least one business.").max(MAX_BULK, `At most ${MAX_BULK} at a time.`),
});

function parse(campaignId: unknown, ids: unknown) {
  const r = input.safeParse({ campaignId, ids });
  return r.success ? r.data : r.error.issues[0]?.message ?? "Invalid input.";
}

function revalidateMembership(prefix: "/calling" | "/email", campaignId: string) {
  revalidatePath("/");
  revalidatePath("/businesses");
  revalidatePath("/businesses/[id]", "page");
  revalidatePath(prefix);
  revalidatePath(`${prefix}/${campaignId}`);
}

/** Appends the businesses to a call campaign's queue (skips duplicates, do-not-call, no phone). */
export async function addToCallCampaignAction(
  campaignId: string,
  ids: string[],
): Promise<ActionResult<{ added: number; skipped: number; campaignName: string }>> {
  const p = parse(campaignId, ids);
  if (typeof p === "string") return fail(p);
  try {
    const db = getDb();
    const campaign = await getCallCampaign(db, p.campaignId);
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status === "completed") return fail("That campaign is completed.");
    const r = await addBusinessesToCampaign(db, p.campaignId, p.ids);
    revalidateMembership("/calling", p.campaignId);
    return ok({ ...r, campaignName: campaign.name });
  } catch (err) {
    console.error("[businesses] addToCallCampaignAction failed", err);
    return fail("Could not add to the campaign.");
  }
}

/** Enrolls the businesses in an email campaign (skips no owner email, do-not-email, already enrolled). */
export async function addToEmailCampaignAction(
  campaignId: string,
  ids: string[],
): Promise<ActionResult<{ added: number; skipped: number; campaignName: string }>> {
  const p = parse(campaignId, ids);
  if (typeof p === "string") return fail(p);
  try {
    const db = getDb();
    const campaign = await getEmailCampaign(db, p.campaignId);
    if (!campaign) return fail("Campaign not found.");
    if (campaign.status === "completed") return fail("That campaign is completed.");
    const r = await enrollBusinesses(db, p.campaignId, p.ids);
    revalidateMembership("/email", p.campaignId);
    return ok({ added: r.enrolled, skipped: r.skipped, campaignName: campaign.name });
  } catch (err) {
    console.error("[businesses] addToEmailCampaignAction failed", err);
    return fail("Could not enroll in the campaign.");
  }
}
