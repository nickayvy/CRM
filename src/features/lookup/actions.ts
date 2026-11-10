"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { logActivity } from "@/db/repo/activities";
import { type ContactPatch, type EditableField, deleteBusiness, getBusiness, updateBusinessContact } from "@/db/repo/businesses";
import { addBusinessesToCampaign, getCallCampaign } from "@/db/repo/call-campaigns";
import { addLead } from "@/db/repo/leads";
import { quickCreateCallCampaign } from "@/features/calling/quick-create";
import { qualifyOne } from "@/features/ingest/run";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { toE164 } from "@/lib/elevenlabs/client";
import { formatPhone } from "@/lib/format";
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

// ------------------------------------------------------------ edit contact details

/**
 * What the dossier's edit form sends: only the fields the user changed, each
 * a string ("" clears it). Absent fields are left as they are.
 */
export type ContactDetailsInput = Partial<{
  phone: string;
  email: string;
  website: string;
  facebook: string;
  twitter: string;
  linkedin: string;
  googleMapsUrl: string;
}>;

/** undefined stays undefined (untouched); "" / whitespace → null (clear); else trimmed. */
const blankToNull = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v);

/** "example.com/x" → "https://example.com/x"; anything that is not an http(s) URL with a dotted host fails. */
const urlField = z.preprocess(
  blankToNull,
  z
    .string()
    .max(2048, "At most 2,048 characters")
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined) return v;
      const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
      try {
        const u = new URL(withScheme);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")) return withScheme;
      } catch {}
      ctx.addIssue({ code: "custom", message: "Enter a valid web address" });
      return z.NEVER;
    }),
);

const contactSchema = z.object({
  phone: z.preprocess(
    blankToNull,
    z
      .string()
      .max(40, "At most 40 characters")
      .nullable()
      .optional()
      .transform((v, ctx) => {
        if (v === null || v === undefined) return v;
        const e164 = toE164(v);
        if (!e164) {
          ctx.addIssue({ code: "custom", message: "Enter a dialable number, e.g. (800) 383-6008 or +44 20 7946 0958" });
          return z.NEVER;
        }
        return e164;
      }),
  ),
  email: z.preprocess(blankToNull, z.email({ error: "Enter a valid email" }).max(320).nullable().optional()),
  website: urlField,
  facebook: urlField,
  twitter: urlField,
  linkedin: urlField,
  googleMapsUrl: urlField,
});

const FIELD_LABELS: Record<EditableField, string> = {
  phone: "phone",
  email: "email",
  website: "website",
  socialLinks: "social links",
  googleMapsUrl: "Google Maps link",
};

/**
 * Saves the user's edits to a business's contact details from the dossier.
 * Edited fields are kept through later syncs; a new phone number is what the
 * AI dialer and the manual dialer call from then on (they read it at dial
 * time). A phone change re-qualifies the business. Logs one system activity.
 */
export async function updateContactDetailsAction(
  businessId: string,
  input: ContactDetailsInput,
): Promise<ActionResult<{ changed: EditableField[] }>> {
  await requireUser();
  if (typeof businessId !== "string" || !UUID_RE.test(businessId)) return fail("Business not found");
  const parsed = contactSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
    return fail("Please fix the highlighted fields.", fieldErrors);
  }
  const v = parsed.data;
  const socialLinks: Record<string, string | null> = {};
  if (v.facebook !== undefined) socialLinks.facebook = v.facebook;
  if (v.linkedin !== undefined) socialLinks.linkedin = v.linkedin;
  // "x" is an older key for the same profile; an edit replaces it.
  if (v.twitter !== undefined) Object.assign(socialLinks, { twitter: v.twitter, x: null });
  const patch: ContactPatch = {
    phone: v.phone,
    email: v.email,
    website: v.website,
    googleMapsUrl: v.googleMapsUrl,
    socialLinks: Object.keys(socialLinks).length > 0 ? socialLinks : undefined,
  };
  try {
    const db = getDb();
    const res = await updateBusinessContact(db, businessId, patch, formatPhone);
    if (!res) return fail("Business not found");
    const { before, after, changed } = res;
    if (changed.length === 0) return ok({ changed });
    if (changed.includes("phone")) await qualifyOne(db, after);
    const parts = changed.map((f) =>
      f === "phone"
        ? `phone ${before.phone ? formatPhone(before.phone) : "(none)"} → ${after.phone ? formatPhone(after.phone) : "(none)"}`
        : FIELD_LABELS[f],
    );
    await logActivity(db, {
      businessId,
      type: "system",
      body: `Contact details edited: ${parts.join(", ")}.`,
      metadata: {
        kind: "contact_edit",
        changed,
        before: Object.fromEntries(changed.map((f) => [f, before[f]])),
        after: Object.fromEntries(changed.map((f) => [f, after[f]])),
      },
    });
    revalidatePath("/lookup");
    revalidatePath("/leads");
    revalidatePath("/businesses");
    revalidatePath(`/businesses/${businessId}`);
    revalidatePath("/calling", "layout");
    return ok({ changed });
  } catch (err) {
    console.error("updateContactDetailsAction failed", err);
    return fail("Could not save the changes");
  }
}
