"use server";

import { fromZonedTime } from "date-fns-tz";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db/client";
import { logActivity } from "@/db/repo/activities";
import { deleteBusiness, getBusiness, listBusinesses, updateBusinessCrm } from "@/db/repo/businesses";
import { type Activity, type Business, type BusinessStatus, businessStatusEnum } from "@/db/schema";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { STATUS_LABELS } from "@/lib/labels";

const MAX_BULK = 1000;

function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const trimOrNull = (v: unknown) => {
  if (typeof v !== "string") return v ?? null;
  const t = v.trim();
  return t === "" ? null : t;
};

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean());

function displayTimezone(): string {
  return process.env.APP_TIMEZONE?.trim() || "America/Chicago";
}

/** `datetime-local` ("2026-11-10T09:30") or date ("2026-11-10") in APP_TIMEZONE → Date. */
function parseLocalDateTime(v: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::\d{2})?)?$/.exec(v);
  if (!m) return null;
  const d = fromZonedTime(`${m[1]}T${m[2] ?? "09:00"}:00`, displayTimezone());
  return Number.isNaN(d.getTime()) ? null : d;
}

const crmSchema = z.object({
  status: z.enum(businessStatusEnum.enumValues, { error: "Choose a status" }),
  ownerName: z.preprocess(trimOrNull, z.string().max(200, "At most 200 characters").nullable()),
  ownerEmail: z.preprocess(trimOrNull, z.email({ error: "Enter a valid email" }).max(320).nullable()),
  tags: z.preprocess(
    (v) =>
      typeof v === "string"
        ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))]
        : [],
    z.array(z.string().max(50, "Each tag must be at most 50 characters")).max(50, "At most 50 tags"),
  ),
  doNotCall: checkbox,
  doNotEmail: checkbox,
  nextFollowUpAt: z.preprocess(trimOrNull, z.string().nullable()).transform((v, ctx) => {
    if (v === null) return null;
    const d = parseLocalDateTime(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date" });
      return z.NEVER;
    }
    return d;
  }),
  notes: z.preprocess(trimOrNull, z.string().max(10000, "At most 10,000 characters").nullable()),
});

/** Display name from the `crm_agent` cookie (set by the dialer); null outside a request. */
async function currentAgent(): Promise<string | null> {
  try {
    const v = (await cookies()).get("crm_agent")?.value?.trim();
    return v ? decodeURIComponent(v) : null;
  } catch {
    return null;
  }
}

function statusChangeBody(from: BusinessStatus, to: BusinessStatus): string {
  return `Status changed from ${STATUS_LABELS[from].label} to ${STATUS_LABELS[to].label}`;
}

function revalidateBusiness(id?: string) {
  revalidatePath("/businesses");
  if (id) revalidatePath(`/businesses/${id}`);
}

/**
 * Form action for the CRM panel on /businesses/[id]. Fields: status, ownerName,
 * ownerEmail, tags (comma-separated), doNotCall, doNotEmail (checkboxes),
 * nextFollowUpAt (datetime-local in APP_TIMEZONE), notes. A status change logs
 * an `activities(type: 'status_change', metadata: { from, to })` row.
 */
export async function updateBusinessCrmAction(
  id: string,
  _prev: ActionResult<Business> | null,
  formData: FormData,
): Promise<ActionResult<Business>> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(crmSchema.shape)) raw[key] = formData.get(key) ?? undefined;
  const parsed = crmSchema.safeParse(raw);
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const db = getDb();
    const before = await getBusiness(db, id);
    if (!before) return fail("Business not found.");
    const updated = await updateBusinessCrm(db, id, parsed.data);
    if (!updated) return fail("Business not found.");
    if (before.status !== updated.status) {
      await logActivity(db, {
        businessId: id,
        type: "status_change",
        body: statusChangeBody(before.status, updated.status),
        metadata: { from: before.status, to: updated.status },
        agent: (await currentAgent()) ?? undefined,
      });
    }
    revalidateBusiness(id);
    return ok(updated);
  } catch (err) {
    console.error("[businesses] updateBusinessCrmAction failed", err);
    return fail("Could not save changes.");
  }
}

const noteSchema = z.object({
  body: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z.string().min(1, "Body is required").max(10000, "At most 10,000 characters"),
  ),
});

/** Form action: adds a `note` activity. Field: body (required). */
export async function logNoteAction(
  id: string,
  _prev: ActionResult<Activity> | null,
  formData: FormData,
): Promise<ActionResult<Activity>> {
  const parsed = noteSchema.safeParse({ body: formData.get("body") ?? undefined });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const db = getDb();
    if (!(await getBusiness(db, id))) return fail("Business not found.");
    const activity = await logActivity(db, {
      businessId: id,
      type: "note",
      body: parsed.data.body,
      agent: (await currentAgent()) ?? undefined,
    });
    revalidateBusiness(id);
    return ok(activity);
  } catch (err) {
    console.error("[businesses] logNoteAction failed", err);
    return fail("Could not add the note.");
  }
}

async function loadMany(ids: string[]): Promise<Business[]> {
  const unique = [...new Set(ids)].slice(0, MAX_BULK);
  if (unique.length === 0) return [];
  const { rows } = await listBusinesses(getDb(), { ids: unique }, { limit: MAX_BULK });
  return rows;
}

/** Sets the status of every business in `ids`; logs one `status_change` activity per business whose status changed. */
export async function bulkUpdateStatusAction(
  ids: string[],
  status: BusinessStatus,
): Promise<ActionResult<{ updated: number }>> {
  if (!businessStatusEnum.enumValues.includes(status)) return fail("Unknown status.");
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one business.");
  try {
    const db = getDb();
    const agent = (await currentAgent()) ?? undefined;
    const rows = await loadMany(ids);
    let updated = 0;
    for (const b of rows) {
      if (b.status === status) continue;
      await updateBusinessCrm(db, b.id, { status });
      await logActivity(db, {
        businessId: b.id,
        type: "status_change",
        body: statusChangeBody(b.status, status),
        metadata: { from: b.status, to: status, bulk: true },
        agent,
      });
      updated++;
    }
    revalidateBusiness();
    return ok({ updated });
  } catch (err) {
    console.error("[businesses] bulkUpdateStatusAction failed", err);
    return fail("Could not update the status.");
  }
}

/** Adds `tag` to every business in `ids` (no duplicates). */
export async function bulkAddTagAction(ids: string[], tag: string): Promise<ActionResult<{ updated: number }>> {
  const t = typeof tag === "string" ? tag.trim() : "";
  if (!t) return fail("Tag is required.", { tag: ["Tag is required"] });
  if (t.length > 50 || t.includes(",")) return fail("Invalid tag.", { tag: ["At most 50 characters, no commas"] });
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one business.");
  try {
    const db = getDb();
    const rows = await loadMany(ids);
    let updated = 0;
    for (const b of rows) {
      if (b.tags.includes(t)) continue;
      await updateBusinessCrm(db, b.id, { tags: [...b.tags, t] });
      updated++;
    }
    revalidateBusiness();
    return ok({ updated });
  } catch (err) {
    console.error("[businesses] bulkAddTagAction failed", err);
    return fail("Could not add the tag.");
  }
}

/** Sets `doNotCall` on every business in `ids` and logs a system activity for each one that changed. */
export async function bulkDoNotCallAction(ids: string[]): Promise<ActionResult<{ updated: number }>> {
  if (!Array.isArray(ids) || ids.length === 0) return fail("Select at least one business.");
  try {
    const db = getDb();
    const agent = (await currentAgent()) ?? undefined;
    const rows = await loadMany(ids);
    let updated = 0;
    for (const b of rows) {
      if (b.doNotCall) continue;
      await updateBusinessCrm(db, b.id, { doNotCall: true });
      await logActivity(db, { businessId: b.id, type: "system", body: "Marked do not call", agent });
      updated++;
    }
    revalidateBusiness();
    return ok({ updated });
  } catch (err) {
    console.error("[businesses] bulkDoNotCallAction failed", err);
    return fail("Could not mark do not call.");
  }
}

/** Deletes the business (activities, queue items and enrollments cascade). */
export async function deleteBusinessAction(id: string): Promise<ActionResult> {
  try {
    const deleted = await deleteBusiness(getDb(), id);
    if (!deleted) return fail("Business not found.");
    revalidateBusiness();
    return ok(null);
  } catch (err) {
    console.error("[businesses] deleteBusinessAction failed", err);
    return fail("Could not delete the business.");
  }
}
