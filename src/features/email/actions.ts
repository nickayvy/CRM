"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { type BusinessFilter, listBusinessIds } from "@/db/repo/businesses";
import {
  type ProcessResult,
  createEmailCampaign,
  enrollBusinesses,
  getEmailCampaign,
  listEnrolledBusinessIds,
  markReplied,
  pauseEmailCampaign,
  processDueSends,
  resumeEmailCampaign,
  startEmailCampaign,
  unsubscribe,
  updateEmailCampaign,
} from "@/db/repo/email-campaigns";
import { emailEnrollments } from "@/db/schema";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { createEmailSender } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { type CampaignInput, type EnrollFilter, campaignSchema, enrollFilterSchema, issuesToFieldErrors } from "./schema";

function revalidateCampaign(id?: string) {
  revalidatePath("/email");
  if (id) {
    revalidatePath(`/email/${id}`);
    revalidatePath(`/email/${id}/messages`);
  }
}

function unexpected(where: string, err: unknown) {
  console.error(`[email] ${where} failed:`, err);
  return fail("Something went wrong. Try again.");
}

export async function createCampaignAction(input: CampaignInput): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return fail("Fix the highlighted fields.", issuesToFieldErrors(parsed.error));
  try {
    const { steps, ...fields } = parsed.data;
    const c = await createEmailCampaign(getDb(), {
      ...fields,
      status: "draft",
      steps: steps.map((s, i) => ({ stepOrder: i + 1, subject: s.subject, body: s.body, delayDays: s.delayDays })),
    });
    revalidateCampaign();
    return ok({ id: c.id });
  } catch (err) {
    return unexpected("create campaign", err);
  }
}

export async function updateCampaignAction(id: string, input: CampaignInput): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) return fail("Fix the highlighted fields.", issuesToFieldErrors(parsed.error));
  try {
    const { steps, ...fields } = parsed.data;
    const c = await updateEmailCampaign(
      getDb(),
      id,
      fields,
      steps.map((s, i) => ({ stepOrder: i + 1, subject: s.subject, body: s.body, delayDays: s.delayDays })),
    );
    if (!c) return fail("Campaign not found.");
    revalidateCampaign(id);
    return ok({ id: c.id });
  } catch (err) {
    return unexpected("update campaign", err);
  }
}

function toBusinessFilter(f: EnrollFilter): BusinessFilter {
  const v = enrollFilterSchema.parse(f);
  return {
    ...(v.qualifiedOnly ? { qualification: ["qualified" as const] } : {}),
    ...(v.hasEmail ? { hasEmail: true } : {}),
    ...(v.excludeDoNotEmail ? { excludeDoNotEmail: true } : {}),
    ...(v.city ? { city: v.city } : {}),
    ...(v.category ? { category: v.category } : {}),
  };
}

/** Businesses matching the filter that are not yet enrolled in this campaign. */
async function enrollableIds(campaignId: string, filter: EnrollFilter): Promise<string[]> {
  const db = getDb();
  const [ids, enrolled] = await Promise.all([
    listBusinessIds(db, toBusinessFilter(filter)),
    listEnrolledBusinessIds(db, campaignId),
  ]);
  const skip = new Set(enrolled);
  return ids.filter((id) => !skip.has(id));
}

/** How many businesses the enroll panel's filter matches (excluding those already enrolled). */
export async function countEnrollableAction(campaignId: string, filter: EnrollFilter): Promise<ActionResult<{ count: number }>> {
  try {
    return ok({ count: (await enrollableIds(campaignId, filter)).length });
  } catch (err) {
    return unexpected("count enrollable", err);
  }
}

/** Enroll by filter (enroll panel) or by explicit business ids (businesses table bulk action). */
export async function enrollAction(
  campaignId: string,
  target: EnrollFilter | { ids: string[] },
): Promise<ActionResult<{ enrolled: number; skipped: number }>> {
  try {
    const db = getDb();
    if (!(await getEmailCampaign(db, campaignId))) return fail("Campaign not found.");
    const ids = "ids" in target ? target.ids : await enrollableIds(campaignId, target);
    const res = await enrollBusinesses(db, campaignId, ids);
    revalidateCampaign(campaignId);
    return ok(res);
  } catch (err) {
    return unexpected("enroll", err);
  }
}

export async function processNowAction(campaignId: string): Promise<ActionResult<ProcessResult>> {
  try {
    const res = await processDueSends(getDb(), campaignId, createEmailSender(env));
    revalidateCampaign(campaignId);
    return ok(res);
  } catch (err) {
    return unexpected("process now", err);
  }
}

/** draft → running, then sends what is due right away. */
export async function startAction(campaignId: string): Promise<ActionResult<ProcessResult>> {
  try {
    const db = getDb();
    if (!(await startEmailCampaign(db, campaignId))) return fail("Only a draft campaign with at least one step can be started.");
    const res = await processDueSends(db, campaignId, createEmailSender(env));
    revalidateCampaign(campaignId);
    return ok(res);
  } catch (err) {
    return unexpected("start", err);
  }
}

export async function pauseAction(campaignId: string): Promise<ActionResult> {
  try {
    await pauseEmailCampaign(getDb(), campaignId);
    revalidateCampaign(campaignId);
    return ok(null);
  } catch (err) {
    return unexpected("pause", err);
  }
}

export async function resumeAction(campaignId: string): Promise<ActionResult> {
  try {
    await resumeEmailCampaign(getDb(), campaignId);
    revalidateCampaign(campaignId);
    return ok(null);
  } catch (err) {
    return unexpected("resume", err);
  }
}

async function campaignOfEnrollment(enrollmentId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ campaignId: emailEnrollments.campaignId })
    .from(emailEnrollments)
    .where(eq(emailEnrollments.id, enrollmentId));
  return row?.campaignId;
}

export async function markRepliedAction(enrollmentId: string): Promise<ActionResult> {
  try {
    const campaignId = await campaignOfEnrollment(enrollmentId);
    if (!campaignId) return fail("Enrollment not found.");
    await markReplied(getDb(), enrollmentId);
    revalidateCampaign(campaignId);
    return ok(null);
  } catch (err) {
    return unexpected("mark replied", err);
  }
}

export async function unsubscribeAction(enrollmentId: string): Promise<ActionResult> {
  try {
    const campaignId = await campaignOfEnrollment(enrollmentId);
    if (!campaignId) return fail("Enrollment not found.");
    await unsubscribe(getDb(), enrollmentId);
    revalidateCampaign(campaignId);
    return ok(null);
  } catch (err) {
    return unexpected("unsubscribe", err);
  }
}
