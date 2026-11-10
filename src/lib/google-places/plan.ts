// Plan and cost for a Google search job (spec R4). SERVER ONLY (imports the
// zip dataset through zips.ts).
import { getNiche } from "./niches";
import type { GooglePlan } from "./types";
import { type Geocode, resolveArea } from "./zips";

export type { GooglePlan } from "./types";
export { AreaError, type ResolvedArea, resolveArea, zipCentre } from "./zips";

export const MAX_ZIPS_PER_JOB = 200;
export const MAX_QUERIES_PER_JOB = 500;
export const MAX_TERMS_PER_JOB = 12;
/** Estimated USD per 1,000 Text Search requests with the Enterprise field mask (from memory; shown as an estimate). */
export const PRICE_PER_1000_REQUESTS_USD = 35;
export const DEFAULT_MAX_PAGES: 1 | 2 | 3 = 3;
/** Location bias radius around each zip centre (architecture default: an 8 km circle). */
export const ZIP_BIAS_RADIUS_M = 8000;

export type PlanInput = { nicheId?: string | null; terms?: string[]; area: string; maxPagesPerQuery?: 1 | 2 | 3 };
export type PlanPreview = {
  plan: GooglePlan;
  location: string; // value for search_jobs.location
  term: string; // value for search_jobs.term
  queries: number;
  maxRequests: number; // queries × maxPagesPerQuery
  estMaxUsd: number; // maxRequests × PRICE / 1000, 2 decimals
};

/** User-facing validation error; `field` names the input it is about. */
export class PlanError extends Error {
  readonly field?: "nicheId" | "terms" | "area" | "maxPagesPerQuery";
  constructor(message: string, field?: PlanError["field"]) {
    super(message);
    this.name = "PlanError";
    this.field = field;
  }
}

/** Trimmed, lower case, inner whitespace collapsed, unique, in input order. */
export function normalizeTerms(terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) {
    const n = t.replace(/\s+/g, " ").trim().toLowerCase();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Search `i` of a plan: `zips[floor(i / terms.length)]` with `terms[i % terms.length]`. */
export function searchAt(plan: Pick<GooglePlan, "terms" | "zips">, i: number): { term: string; zip: string } {
  return { term: plan.terms[i % plan.terms.length], zip: plan.zips[Math.floor(i / plan.terms.length)] };
}

/** The Text Search query for a term and zip (architecture default `"<term> <zip>"`). */
export function textQueryFor(term: string, zip: string): string {
  return `${term} ${zip}`;
}

export function estimateUsd(requests: number): number {
  return Math.round(((requests * PRICE_PER_1000_REQUESTS_USD) / 1000) * 100) / 100;
}

/** Validates and builds the plan. Throws PlanError (user-facing message,
 *  optional field name) over the limits or with no terms/zips. */
export async function planGoogleSearch(input: PlanInput, opts?: { geocode?: Geocode }): Promise<PlanPreview> {
  const niche = input.nicheId ? getNiche(input.nicheId) : null;
  if (input.nicheId && !niche) throw new PlanError(`Unknown niche: ${input.nicheId}`, "nicheId");

  const customTerms = input.terms ? normalizeTerms(input.terms) : [];
  const terms = customTerms.length ? customTerms : niche ? normalizeTerms(niche.terms) : [];
  if (terms.length === 0) throw new PlanError("Choose a niche or enter at least one search term.", "terms");
  if (terms.length > MAX_TERMS_PER_JOB) throw new PlanError(`At most ${MAX_TERMS_PER_JOB} search terms per job.`, "terms");

  const maxPages = input.maxPagesPerQuery ?? DEFAULT_MAX_PAGES;
  if (![1, 2, 3].includes(maxPages)) throw new PlanError("Pages per search must be 1, 2 or 3.", "maxPagesPerQuery");

  let area;
  try {
    area = await resolveArea(input.area, opts);
  } catch (err) {
    if (err instanceof Error && err.name === "AreaError") throw new PlanError(err.message, "area");
    throw err;
  }
  if (area.zips.length === 0) throw new PlanError("The area has no zip codes.", "area");
  if (area.zips.length > MAX_ZIPS_PER_JOB)
    throw new PlanError(`${area.zips.length} zip codes is over the limit of ${MAX_ZIPS_PER_JOB} per job; use a smaller area.`, "area");

  const queries = terms.length * area.zips.length;
  if (queries > MAX_QUERIES_PER_JOB)
    throw new PlanError(
      `${terms.length} terms × ${area.zips.length} zips = ${queries} searches, over the limit of ${MAX_QUERIES_PER_JOB} per job.`,
      area.zips.length > 1 ? "area" : "terms",
    );

  // A niche keeps its place types even when its terms were edited; terms without a niche have no category rule.
  const acceptTypes = niche ? [...niche.acceptTypes] : [];
  const plan: GooglePlan = {
    nicheId: niche?.id ?? null,
    terms,
    zips: area.zips,
    areaLabel: area.label,
    acceptTypes,
    maxPagesPerQuery: maxPages,
    saturated: [],
    errors: [],
  };
  const maxRequests = queries * maxPages;
  return {
    plan,
    location: area.label,
    term: niche ? niche.label : terms[0],
    queries,
    maxRequests,
    estMaxUsd: estimateUsd(maxRequests),
  };
}
