// Qualification engine: pure, deterministic functions from a business, its
// search context and the rules row to { qualification, score, reasons }.
// Rules, order and score formula: docs/team/architecture.md §Qualification.
import type { Business, QualificationRules } from "@/db/schema";

export type QualifyContext = {
  searchCategory: string;
  categoryAliases: string[];
  radiusM: number;
  locationState?: string | null;
  /** Distinct cities in DB with the same nameNormalized, including this business. */
  sameNameCityCount: number;
  /** Another business (different yelpId) has the same phoneDigits. */
  phoneDuplicate: boolean;
};

export type ReasonCode =
  | "closed"
  | "category_mismatch"
  | "chain"
  | "multi_location"
  | "no_phone"
  | "out_of_area"
  | "low_rating"
  | "too_few_reviews"
  | "too_many_reviews"
  | "duplicate_phone"
  | "unclaimed"
  | "low_score";

export type QualifyResult = { qualification: "qualified" | "review" | "rejected"; score: number; reasons: ReasonCode[] };

/** The business fields the engine reads. `rating` accepts the numeric column's string form. */
export type BusinessLike = Pick<
  Business,
  "name" | "isClosed" | "categories" | "primaryCategory" | "phoneDigits" | "distanceM" | "state" | "reviewCount" | "isClaimed"
> & { rating: string | number | null };

/** Hard rejection codes, in rule order. */
export const HARD_REASONS: readonly ReasonCode[] = [
  "closed",
  "category_mismatch",
  "chain",
  "multi_location",
  "no_phone",
  "out_of_area",
  "low_rating",
  "too_few_reviews",
  "too_many_reviews",
  "duplicate_phone",
];
export const SOFT_REASONS: readonly ReasonCode[] = ["unclaimed", "low_score"];

export const REASON_LABELS: Record<ReasonCode, string> = {
  closed: "Marked permanently closed on Yelp",
  category_mismatch: "Not listed in any of the searched categories",
  chain: "Matches a known chain or franchise name",
  multi_location: "Same business name found in several cities",
  no_phone: "No phone number listed",
  out_of_area: "Outside the search area",
  low_rating: "Rating below the minimum",
  too_few_reviews: "Too few reviews",
  too_many_reviews: "More reviews than the maximum (likely a large operator)",
  duplicate_phone: "Shares a phone number with another business",
  unclaimed: "Yelp page not claimed by the owner",
  low_score: "Score below the review threshold",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function ratingOf(b: BusinessLike): number | null {
  if (b.rating === null || b.rating === undefined || b.rating === "") return null;
  const n = typeof b.rating === "number" ? b.rating : Number(b.rating);
  return Number.isFinite(n) ? n : null;
}

function aliasesOf(b: BusinessLike): string[] {
  return (b.categories ?? []).map((c) => c.alias.toLowerCase());
}

/** Two-letter state from a location ending in ", XX" ("Houston, TX" → "TX"), else null. */
export function parseLocationState(location: string | null | undefined): string | null {
  const m = /,\s*([A-Za-z]{2})\s*$/.exec(location ?? "");
  return m ? m[1].toUpperCase() : null;
}

/** Case-insensitive plain-substring match of any pattern against the raw name. */
export function isChain(name: string, patterns: string[]): boolean {
  const n = name.toLowerCase();
  return patterns.some((p) => {
    const q = p.trim().toLowerCase();
    return q.length > 0 && n.includes(q);
  });
}

/** Integer 0–100 per §Score. */
export function scoreBusiness(b: BusinessLike, ctx: QualifyContext): number {
  const rating = ratingOf(b);
  const reviews = Math.max(0, b.reviewCount ?? 0);
  const targets = new Set(ctx.categoryAliases.map((a) => a.toLowerCase()));
  const primary = b.primaryCategory?.toLowerCase() ?? null;

  const ratingPart = rating === null ? -20 : clamp((rating - 3) * 10, -20, 20);
  const reviewPart = Math.min(20, Math.round(5 * Math.log10(reviews + 1)));
  const phonePart = b.phoneDigits ? 5 : -5;
  const claimedPart = b.isClaimed === true ? 10 : b.isClaimed === false ? -10 : 0;
  const categoryPart = primary !== null && targets.has(primary) ? 10 : aliasesOf(b).some((a) => targets.has(a)) ? 5 : 0;
  const proximityPart = b.distanceM !== null && b.distanceM !== undefined && b.distanceM <= ctx.radiusM / 2 ? 5 : 0;

  return clamp(Math.round(50 + ratingPart + reviewPart + phonePart + claimedPart + categoryPart + proximityPart), 0, 100);
}

/** Applies every rule in §Rule order; reasons list hard codes first (rule order), then soft flags. */
export function qualify(b: BusinessLike, ctx: QualifyContext, rules: QualificationRules): QualifyResult {
  const hard = new Set<ReasonCode>();
  const targets = new Set(ctx.categoryAliases.map((a) => a.toLowerCase()));
  const rating = ratingOf(b) ?? 0;
  const minRating = Number(rules.minRating);

  if (b.isClosed && rules.rejectClosed) hard.add("closed");
  if (rules.categoryStrict && !aliasesOf(b).some((a) => targets.has(a))) hard.add("category_mismatch");
  if (rules.rejectChains && isChain(b.name, rules.chainPatterns ?? [])) hard.add("chain");
  if (rules.rejectChains && ctx.sameNameCityCount >= rules.multiLocationThreshold) hard.add("multi_location");
  if (rules.requirePhone && !b.phoneDigits) hard.add("no_phone");
  const tooFar =
    typeof b.distanceM === "number" && b.distanceM > ctx.radiusM * (1 + rules.distanceTolerancePct / 100);
  const wrongState =
    !!ctx.locationState && (b.state ?? "").trim().toLowerCase() !== ctx.locationState.trim().toLowerCase();
  if (tooFar || wrongState) hard.add("out_of_area");
  if (Number.isFinite(minRating) && rating < minRating) hard.add("low_rating");
  if ((b.reviewCount ?? 0) < rules.minReviews) hard.add("too_few_reviews");
  if (rules.maxReviews !== null && rules.maxReviews !== undefined && (b.reviewCount ?? 0) > rules.maxReviews)
    hard.add("too_many_reviews");
  if (ctx.phoneDuplicate) hard.add("duplicate_phone");

  const score = scoreBusiness(b, ctx);
  const reasons: ReasonCode[] = HARD_REASONS.filter((r) => hard.has(r));
  if (b.isClaimed === false) reasons.push("unclaimed");

  if (hard.size > 0) return { qualification: "rejected", score, reasons };
  if (score < rules.reviewScoreBelow) {
    reasons.push("low_score");
    return { qualification: "review", score, reasons };
  }
  return { qualification: "qualified", score, reasons };
}
