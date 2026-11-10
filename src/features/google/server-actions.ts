"use server";

// Server actions for Google Maps search (architecture §Actions and routes).
// Import them from ./actions, which also exports the synchronous
// googleConfigured() (a "use server" module may only export async functions).
// Every action calls requireUser() first. Start, continue and rerun answer at
// once and run the job behind after() inside a 240 s budget.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { GOOGLE_PLACES_PROVIDER, createGoogleJob, getUsage, reserveUsage } from "@/db/repo/google";
import { getSearchJob } from "@/db/repo/search-jobs";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { env } from "@/lib/env";
import { GOOGLE_NOT_CONFIGURED, createPlacesClient } from "@/lib/google-places/client";
import { GEOCODING_PROVIDER, createGeocoder } from "@/lib/google-places/geocode";
import { type PlanInput, type PlanPreview, PlanError, estimateUsd, planGoogleSearch } from "@/lib/google-places/plan";
import type { Geocode } from "@/lib/google-places/zips";
import { requireUser } from "@/lib/supabase/server";
import { GOOGLE_RUN_BUDGET_MS, driveGoogleJob } from "./drive";
import type { SliceOutcome } from "./run";

export type GooglePreview = {
  preview: Omit<PlanPreview, "plan"> & { terms: string[]; zipCount: number; areaLabel: string };
  usedThisMonth: number;
  cap: number;
};

// ------------------------------------------------------------ input

const termsField = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(z.string().max(100, "Each search term must be at most 100 characters")).max(50).optional(),
);

const planSchema = z.object({
  nicheId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().max(64).nullish()),
  terms: termsField,
  area: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ error: "Enter an area" }).min(1, "Enter an area").max(500, "The area is too long"),
  ),
  maxPagesPerQuery: z.preprocess(
    (v) => (v === undefined || v === null || v === "" ? undefined : Number(v)),
    z.union([z.literal(1), z.literal(2), z.literal(3)], { error: "Pages per search must be 1, 2 or 3" }).optional(),
  ),
});

function fieldErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) (out[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
  return out;
}

const isUuid = (id: unknown): id is string => typeof id === "string" && z.uuid().safeParse(id).success;

// ------------------------------------------------------------ helpers

/** Geocoded points by text for the life of the server process, so preview and start do not pay twice. */
const geocodeMemo = new Map<string, { latitude: number; longitude: number } | null>();
const GEOCODE_MEMO_MAX = 200;

function geocoderFor(db: Db): Geocode | undefined {
  const key = env.GOOGLE_GEOCODING_API_KEY;
  if (!key) return undefined;
  const cap = env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP;
  const geocode = createGeocoder(key, { reserve: () => reserveUsage(db, GEOCODING_PROVIDER, cap) });
  return async (text) => {
    const k = text.trim().toLowerCase();
    if (geocodeMemo.has(k)) return geocodeMemo.get(k)!;
    const point = await geocode(text);
    if (geocodeMemo.size >= GEOCODE_MEMO_MAX) geocodeMemo.delete(geocodeMemo.keys().next().value!);
    geocodeMemo.set(k, point);
    return point;
  };
}

function planFailure(err: unknown) {
  if (err instanceof PlanError) return fail(err.message, err.field ? { [err.field]: [err.message] } : undefined);
  console.error("[google] plan failed", err);
  return fail("Could not plan the search.");
}

/** Refusal when this month's Google requests are already at the cap; null when there is room. */
async function capRefusal(db: Db) {
  const cap = env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP;
  const used = await getUsage(db, GOOGLE_PLACES_PROVIDER);
  if (used < cap) return null;
  return fail(
    `This month's Google request cap of ${cap.toLocaleString("en-US")} is reached (${used.toLocaleString("en-US")} used). Raise GOOGLE_PLACES_MONTHLY_REQUEST_CAP or wait until next month.`,
  );
}

/** Runs the job after the response is sent, inside the 240 s budget. */
function runInBackground(jobId: string, apiKey: string) {
  after(async () => {
    try {
      const r = await driveGoogleJob(getDb(), createPlacesClient(apiKey), jobId, { budgetMs: GOOGLE_RUN_BUDGET_MS });
      console.info(`[google] job ${jobId}: ${r.outcome} after ${r.searches} searches in ${r.slices} slices`);
    } catch (err) {
      console.error(`[google] background run of job ${jobId} failed`, err instanceof Error ? err.message : err);
    }
  });
}

function startJob(db: Db, preview: PlanPreview, apiKey: string) {
  return createGoogleJob(db, preview).then((job) => {
    runInBackground(job.id, apiKey);
    revalidatePath("/searches");
    return job;
  });
}

// ------------------------------------------------------------ actions

/**
 * The plan and its cost for the form's plan line: terms × zips = searches, the
 * maximum requests and dollars, and this month's usage against the cap. Makes
 * no Places request (an area that needs geocoding may make one Geocoding
 * request, remembered for the process).
 */
export async function previewGoogleSearchAction(input: PlanInput): Promise<ActionResult<GooglePreview>> {
  await requireUser();
  const parsed = planSchema.safeParse(input ?? {});
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  try {
    const db = getDb();
    const { plan, ...rest } = await planGoogleSearch(parsed.data, { geocode: geocoderFor(db) });
    return ok({
      preview: { ...rest, terms: plan.terms, zipCount: plan.zips.length, areaLabel: plan.areaLabel },
      usedThisMonth: await getUsage(db, GOOGLE_PLACES_PROVIDER),
      cap: env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP,
    });
  } catch (err) {
    return planFailure(err);
  }
}

/**
 * Form action. Fields: nicheId, terms (comma-separated), area,
 * maxPagesPerQuery (1–3, default 3). Refuses without GOOGLE_PLACES_API_KEY
 * and when the month is already at the request cap (a plan larger than what
 * is left still starts: the runner pauses at the cap by itself). Creates the
 * job and runs it behind after().
 */
export async function startGoogleSearchAction(
  _prev: ActionResult<{ jobId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ jobId: string }>> {
  await requireUser();
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return fail(GOOGLE_NOT_CONFIGURED);
  const parsed = planSchema.safeParse({
    nicheId: formData.get("nicheId") ?? undefined,
    terms: formData.get("terms") ?? undefined,
    area: formData.get("area") ?? undefined,
    maxPagesPerQuery: formData.get("maxPagesPerQuery") ?? undefined,
  });
  if (!parsed.success) return fail("Please fix the highlighted fields.", fieldErrors(parsed.error));
  const db = getDb();
  let preview: PlanPreview;
  try {
    preview = await planGoogleSearch(parsed.data, { geocode: geocoderFor(db) });
  } catch (err) {
    return planFailure(err);
  }
  try {
    const refused = await capRefusal(db);
    if (refused) return refused;
    const job = await startJob(db, preview, apiKey);
    return ok({ jobId: job.id });
  } catch (err) {
    console.error("[google] startGoogleSearchAction failed", err);
    return fail("Could not start the search.");
  }
}

/**
 * Continues an unfinished Google job behind after() and answers `queued` at
 * once. A slice already running for the job holds its lease, so the
 * background slice simply finds it busy.
 */
export async function continueGoogleSearchAction(jobId: string): Promise<ActionResult<{ outcome: SliceOutcome | "queued" }>> {
  await requireUser();
  if (!isUuid(jobId)) return fail("Invalid search id");
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return fail(GOOGLE_NOT_CONFIGURED);
  try {
    const job = await getSearchJob(getDb(), jobId);
    if (!job || job.source !== "google") return fail("Google search not found.");
    if (job.status === "completed") return fail("This search has finished. Use Run again to search the same area again.");
    if (job.status === "failed") return fail("This search failed and cannot be continued. Use Run again to start it over.");
    runInBackground(job.id, apiKey);
    return ok({ outcome: "queued" });
  } catch (err) {
    console.error("[google] continueGoogleSearchAction failed", err);
    return fail("Could not continue the search.");
  }
}

/**
 * Starts a new job with a finished (completed or failed) job's plan: the same
 * terms, zips, place types and pages per search; saturation and errors start
 * empty. Same key and cap checks as start.
 */
export async function rerunGoogleSearchAction(jobId: string): Promise<ActionResult<{ jobId: string }>> {
  await requireUser();
  if (!isUuid(jobId)) return fail("Invalid search id");
  const apiKey = env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return fail(GOOGLE_NOT_CONFIGURED);
  try {
    const db = getDb();
    const old = await getSearchJob(db, jobId);
    if (!old || old.source !== "google" || !old.plan) return fail("Google search not found.");
    if (old.status !== "completed" && old.status !== "failed") return fail("This search is still running. Continue it instead.");
    const refused = await capRefusal(db);
    if (refused) return refused;
    const plan = { ...old.plan, saturated: [], errors: [] };
    const queries = plan.terms.length * plan.zips.length;
    const maxRequests = queries * plan.maxPagesPerQuery;
    const job = await startJob(
      db,
      { plan, location: old.location, term: old.term ?? plan.terms[0], queries, maxRequests, estMaxUsd: estimateUsd(maxRequests) },
      apiKey,
    );
    return ok({ jobId: job.id });
  } catch (err) {
    console.error("[google] rerunGoogleSearchAction failed", err);
    return fail("Could not run the search again.");
  }
}
