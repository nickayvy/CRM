"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import { updateRules } from "@/db/repo/rules";
import { createSearchJob } from "@/db/repo/search-jobs";
import type { Business, Qualification, QualificationRules } from "@/db/schema";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { createYelpClient } from "@/lib/yelp";
import { enrichBusiness, requalifyAll, runSearchJob } from "./run";

function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const intField = (min: number, max: number, label: string, fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: `${label} must be a number` })
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be at least ${min}`)
      .max(max, `${label} must be at most ${max}`)
      .default(fallback),
  );

const searchSchema = z.object({
  term: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  location: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ error: "Location is required" }).min(1, "Location is required").max(200),
  ),
  categoryAliases: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        : v,
    z
      .array(z.string().regex(/^[a-z0-9_-]+$/, "Category aliases may contain only letters, digits, _ and -"), {
        error: "At least one category alias is required",
      })
      .min(1, "At least one category alias is required")
      .max(20),
  ),
  radiusM: intField(500, 40000, "Radius", 20000),
  maxResults: intField(1, 1000, "Max results", 200),
});

/**
 * Form action: validates, creates the search job, and runs it after the
 * response is sent. Fields: term?, location, categoryAliases (comma-separated),
 * radiusM (500–40000, default 20000; `radius` also accepted), maxResults (1–1000, default 200).
 */
export async function startSearchAction(
  _prev: ActionResult<{ jobId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string }>> {
  const parsed = searchSchema.safeParse({
    term: formData.get("term") ?? undefined,
    location: formData.get("location") ?? undefined,
    categoryAliases: formData.get("categoryAliases") ?? formData.get("categories") ?? undefined,
    radiusM: formData.get("radiusM") ?? formData.get("radius") ?? undefined,
    maxResults: formData.get("maxResults") ?? undefined,
  });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const db = getDb();
    const job = await createSearchJob(db, parsed.data);
    after(async () => {
      try {
        await runSearchJob(db, job.id, createYelpClient());
      } catch (err) {
        console.error(`[ingest] background run of job ${job.id} failed`, err);
      }
    });
    revalidatePath("/searches");
    return ok({ jobId: job.id });
  } catch (err) {
    console.error("[ingest] startSearchAction failed", err);
    return fail("Could not start the search.");
  }
}

/** Fetches Yelp details for one business and re-qualifies it. */
export async function enrichAction(businessId: string): Promise<ActionResult<Business>> {
  try {
    const db = getDb();
    if (!(await getBusiness(db, businessId))) return fail("Business not found.");
    const business = await enrichBusiness(db, businessId, createYelpClient());
    revalidatePath(`/businesses/${businessId}`);
    revalidatePath("/businesses");
    return ok(business);
  } catch (err) {
    console.error("[ingest] enrichAction failed", err);
    return fail(err instanceof Error ? `Enrichment failed: ${err.message}` : "Enrichment failed.");
  }
}

/** Re-runs the engine over every business with the current rules. */
export async function requalifyAllAction(): Promise<ActionResult<Record<Qualification, number>>> {
  try {
    const counts = await requalifyAll(getDb());
    revalidatePath("/businesses");
    revalidatePath("/");
    return ok(counts);
  } catch (err) {
    console.error("[ingest] requalifyAllAction failed", err);
    return fail("Re-qualification failed.");
  }
}

const checkbox = z.preprocess(
  (v) => v === "on" || v === "true" || v === "1" || v === true,
  z.boolean(),
);

const rulesSchema = z.object({
  minRating: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "Minimum rating must be a number" })
      .min(0, "Minimum rating must be between 0 and 5")
      .max(5, "Minimum rating must be between 0 and 5")
      .refine((n) => Math.round(n * 10) === n * 10, "Use at most one decimal place")
      .default(3.5),
  ),
  minReviews: intField(0, 100000, "Minimum reviews", 5),
  maxReviews: z.preprocess(
    blankToUndefined,
    z.coerce
      .number({ error: "Maximum reviews must be a number" })
      .int("Maximum reviews must be a whole number")
      .min(0, "Maximum reviews must be at least 0")
      .nullable()
      .default(null),
  ),
  requirePhone: checkbox,
  rejectClosed: checkbox,
  rejectChains: checkbox,
  categoryStrict: checkbox,
  chainPatterns: z.preprocess(
    (v) =>
      typeof v === "string"
        ? [...new Set(v.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean))]
        : [],
    z.array(z.string().max(100, "Each chain pattern must be at most 100 characters")).max(2000),
  ),
  distanceTolerancePct: intField(0, 100, "Distance tolerance", 10),
  multiLocationThreshold: intField(2, 100, "Multi-location threshold", 3),
  reviewScoreBelow: intField(0, 100, "Review threshold", 40),
});

/**
 * Form action for /settings/rules. Every rule field is read from the form:
 * checkboxes absent → false; chainPatterns is a textarea, one pattern per line;
 * blank maxReviews → no maximum.
 */
export async function updateRulesAction(
  _prev: ActionResult<QualificationRules> | null,
  formData: FormData,
): Promise<ActionResult<QualificationRules>> {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(rulesSchema.shape)) raw[key] = formData.get(key) ?? undefined;
  const parsed = rulesSchema.safeParse(raw);
  if (parsed.error) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const { minRating, ...rest } = parsed.data;
    const rules = await updateRules(getDb(), { ...rest, minRating: minRating.toFixed(1) });
    revalidatePath("/settings/rules");
    return ok(rules);
  } catch (err) {
    console.error("[ingest] updateRulesAction failed", err);
    return fail("Could not save the rules.");
  }
}
