import { describe, expect, it } from "vitest";
import { DEFAULT_CHAIN_PATTERNS } from "@/db/repo/rules";
import type { QualificationRules } from "@/db/schema";
import {
  type BusinessLike,
  type QualifyContext,
  type ReasonCode,
  REASON_LABELS,
  isChain,
  parseLocationState,
  qualify,
  scoreBusiness,
} from "@/lib/qualify";

const RULES: QualificationRules = {
  id: 1,
  minRating: "3.5",
  minReviews: 5,
  maxReviews: null,
  requirePhone: true,
  rejectClosed: true,
  rejectChains: true,
  chainPatterns: DEFAULT_CHAIN_PATTERNS,
  categoryStrict: true,
  distanceTolerancePct: 10,
  multiLocationThreshold: 3,
  reviewScoreBelow: 40,
  updatedAt: new Date(),
};

const CTX: QualifyContext = {
  searchCategory: "plumbing",
  categoryAliases: ["plumbing"],
  radiusM: 20000,
  locationState: "TX",
  sameNameCityCount: 1,
  phoneDuplicate: false,
};

/** A clean, qualified plumber, claim unknown (score 50+15+10+5+0+10+5 = 95). */
function biz(over: Partial<BusinessLike> = {}): BusinessLike {
  return {
    name: "Bayou Plumbing",
    isClosed: false,
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    primaryCategory: "plumbing",
    phoneDigits: "17135550100",
    distanceM: 3000,
    state: "TX",
    rating: "4.5",
    reviewCount: 120,
    isClaimed: null,
    ...over,
  };
}

const rules = (over: Partial<QualificationRules> = {}) => ({ ...RULES, ...over });
const ctx = (over: Partial<QualifyContext> = {}) => ({ ...CTX, ...over });

describe("scoreBusiness — worked examples (§Score)", () => {
  // The architecture lists example 1 as "50+15+10+5+10+10+5 = 95", but those terms sum to 105
  // (clamped to 100). The formula is frozen and the other three examples match it, so this test
  // asserts the formula's own result for the stated inputs, and asserts 95 for the same business
  // with claim status unknown (claimedPart 0), the only one-term reading that gives 95.
  // Reported to the PM in the WP-03 completion report.
  it("example 1: rating 4.5, 120 reviews, phone, claimed, primary match, 3000/20000 → terms sum 105 → 100", () => {
    expect(scoreBusiness(biz({ isClaimed: true }), CTX)).toBe(100);
  });
  it("example 1 with claim unknown → 95", () => {
    expect(scoreBusiness(biz({ isClaimed: null }), CTX)).toBe(95);
  });

  it("rating 3.0, 4 reviews, phone, claim unknown, secondary match, 15000/20000 → 63", () => {
    const b = biz({
      rating: 3.0,
      reviewCount: 4,
      isClaimed: null,
      categories: [
        { alias: "handyman", title: "Handyman" },
        { alias: "plumbing", title: "Plumbing" },
      ],
      primaryCategory: "handyman",
      distanceM: 15000,
    });
    expect(scoreBusiness(b, CTX)).toBe(63);
  });

  it("rating null, 0 reviews, no phone, unclaimed, no match, no distance → 15", () => {
    const b = biz({
      rating: null,
      reviewCount: 0,
      phoneDigits: null,
      isClaimed: false,
      categories: [{ alias: "landscaping", title: "Landscaping" }],
      primaryCategory: "landscaping",
      distanceM: null,
    });
    expect(scoreBusiness(b, CTX)).toBe(15);
  });

  it("rating 5.0, 2000 reviews, phone, claimed, primary match, 100 m → 117 clamped to 100", () => {
    expect(scoreBusiness(biz({ rating: 5, reviewCount: 2000, isClaimed: true, distanceM: 100 }), CTX)).toBe(100);
  });

  it("reviewPart follows round(5·log10(n+1)) capped at 20", () => {
    const base = biz({ isClaimed: null, distanceM: null, rating: 3 }); // 50+0+r+5+0+10+0
    const at = (n: number) => scoreBusiness({ ...base, reviewCount: n }, CTX) - 65;
    expect([0, 9, 99, 999, 9999, 99999].map(at)).toEqual([0, 5, 10, 15, 20, 20]);
  });
});

describe("isChain", () => {
  it("matches case-insensitively as a substring", () => {
    expect(isChain("ROTO-ROOTER Plumbing & Water Cleanup", DEFAULT_CHAIN_PATTERNS)).toBe(true);
    expect(isChain("mr. rooter plumbing of houston", DEFAULT_CHAIN_PATTERNS)).toBe(true);
    expect(isChain("Aspen Dental - South Lamar", DEFAULT_CHAIN_PATTERNS)).toBe(true);
    expect(isChain("One Hour Heating & Air Conditioning of Dallas", ["ONE HOUR HEATING"])).toBe(true);
  });
  it("does not match independent names or blank patterns", () => {
    expect(isChain("Bayou Plumbing", DEFAULT_CHAIN_PATTERNS)).toBe(false);
    expect(isChain("Rooter Brothers", DEFAULT_CHAIN_PATTERNS)).toBe(false);
    expect(isChain("Anything", ["", "   "])).toBe(false);
  });
});

describe("parseLocationState", () => {
  it("reads a trailing two-letter state", () => {
    expect(parseLocationState("Houston, TX")).toBe("TX");
    expect(parseLocationState("austin, tx ")).toBe("TX");
    expect(parseLocationState("Houston")).toBeNull();
    expect(parseLocationState("77002")).toBeNull();
    expect(parseLocationState(null)).toBeNull();
  });
});

describe("qualify — every rule has a positive and a negative case", () => {
  it("baseline business qualifies with no reasons", () => {
    expect(qualify(biz(), CTX, RULES)).toEqual({ qualification: "qualified", score: 95, reasons: [] });
  });

  type Case = { code: ReasonCode; hit: () => ReturnType<typeof qualify>; miss: () => ReturnType<typeof qualify> };
  const cases: Case[] = [
    {
      code: "closed",
      hit: () => qualify(biz({ isClosed: true }), CTX, RULES),
      miss: () => qualify(biz({ isClosed: true }), CTX, rules({ rejectClosed: false })),
    },
    {
      code: "category_mismatch",
      hit: () =>
        qualify(biz({ categories: [{ alias: "landscaping", title: "L" }], primaryCategory: "landscaping" }), CTX, RULES),
      miss: () =>
        qualify(
          biz({ categories: [{ alias: "landscaping", title: "L" }], primaryCategory: "landscaping" }),
          CTX,
          rules({ categoryStrict: false }),
        ),
    },
    {
      code: "chain",
      hit: () => qualify(biz({ name: "Roto-Rooter Plumbing" }), CTX, RULES),
      miss: () => qualify(biz({ name: "Roto-Rooter Plumbing" }), CTX, rules({ rejectChains: false })),
    },
    {
      code: "multi_location",
      hit: () => qualify(biz(), ctx({ sameNameCityCount: 3 }), RULES),
      miss: () => qualify(biz(), ctx({ sameNameCityCount: 2 }), RULES),
    },
    {
      code: "no_phone",
      hit: () => qualify(biz({ phoneDigits: null }), CTX, RULES),
      miss: () => qualify(biz({ phoneDigits: null }), CTX, rules({ requirePhone: false })),
    },
    {
      code: "out_of_area",
      hit: () => qualify(biz({ distanceM: 22001 }), CTX, RULES),
      miss: () => qualify(biz({ distanceM: 22000 }), CTX, RULES),
    },
    {
      code: "low_rating",
      hit: () => qualify(biz({ rating: "3.0" }), CTX, RULES),
      miss: () => qualify(biz({ rating: "3.5" }), CTX, RULES),
    },
    {
      code: "too_few_reviews",
      hit: () => qualify(biz({ reviewCount: 4 }), CTX, RULES),
      miss: () => qualify(biz({ reviewCount: 5 }), CTX, RULES),
    },
    {
      code: "too_many_reviews",
      hit: () => qualify(biz({ reviewCount: 301 }), CTX, rules({ maxReviews: 300 })),
      miss: () => qualify(biz({ reviewCount: 300 }), CTX, rules({ maxReviews: 300 })),
    },
    {
      code: "duplicate_phone",
      hit: () => qualify(biz(), ctx({ phoneDuplicate: true }), RULES),
      miss: () => qualify(biz(), ctx({ phoneDuplicate: false }), RULES),
    },
  ];

  it.each(cases)("$code", ({ code, hit, miss }) => {
    const h = hit();
    expect(h.qualification).toBe("rejected");
    expect(h.reasons).toEqual([code]);
    const m = miss();
    expect(m.reasons).not.toContain(code);
    expect(m.qualification).not.toBe("rejected");
  });

  it("out_of_area also fires on a different state, case-insensitively, and not when locationState is unset", () => {
    expect(qualify(biz({ state: "LA" }), CTX, RULES).reasons).toEqual(["out_of_area"]);
    expect(qualify(biz({ state: "tx" }), CTX, RULES).reasons).toEqual([]);
    expect(qualify(biz({ state: "LA" }), ctx({ locationState: null }), RULES).reasons).toEqual([]);
  });

  it("multi_location is gated by rejectChains", () => {
    expect(qualify(biz(), ctx({ sameNameCityCount: 5 }), rules({ rejectChains: false })).reasons).toEqual([]);
  });

  it("null rating counts as 0 for low_rating", () => {
    expect(qualify(biz({ rating: null }), CTX, RULES).reasons).toContain("low_rating");
  });

  it("missing distance never triggers out_of_area", () => {
    expect(qualify(biz({ distanceM: null }), CTX, RULES).reasons).not.toContain("out_of_area");
  });

  it("collects every hard reason in rule order", () => {
    const b = biz({
      name: "Roto-Rooter",
      isClosed: true,
      categories: [{ alias: "landscaping", title: "L" }],
      primaryCategory: "landscaping",
      phoneDigits: null,
      distanceM: 50000,
      rating: "2.0",
      reviewCount: 1,
      isClaimed: false,
    });
    const r = qualify(b, ctx({ sameNameCityCount: 4, phoneDuplicate: true }), rules({ maxReviews: 0 }));
    expect(r.qualification).toBe("rejected");
    expect(r.reasons).toEqual([
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
      "unclaimed",
    ]);
  });
});

describe("soft flags", () => {
  it("unclaimed is listed but never rejects", () => {
    const r = qualify(biz({ isClaimed: false }), CTX, RULES);
    expect(r).toEqual({ qualification: "qualified", score: 85, reasons: ["unclaimed"] });
    expect(qualify(biz({ isClaimed: true }), CTX, RULES).reasons).toEqual([]);
  });

  it("review (low_score) when reviewScoreBelow is raised above a qualified business's score", () => {
    // Architecture example: rating 3.5, 5 reviews, claim unknown, secondary category, phone, 19000 m → 69.
    const dusty = biz({
      rating: "3.5",
      reviewCount: 5,
      isClaimed: null,
      categories: [
        { alias: "handyman", title: "Handyman" },
        { alias: "plumbing", title: "Plumbing" },
      ],
      primaryCategory: "handyman",
      distanceM: 19000,
    });
    expect(qualify(dusty, CTX, RULES)).toEqual({ qualification: "qualified", score: 69, reasons: [] });
    expect(qualify(dusty, CTX, rules({ reviewScoreBelow: 70 }))).toEqual({
      qualification: "review",
      score: 69,
      reasons: ["low_score"],
    });
    expect(qualify(dusty, CTX, rules({ reviewScoreBelow: 69 })).qualification).toBe("qualified");
  });

  it("low_score is not added to a rejected business", () => {
    const r = qualify(biz({ isClosed: true }), CTX, rules({ reviewScoreBelow: 100 }));
    expect(r.qualification).toBe("rejected");
    expect(r.reasons).toEqual(["closed"]);
  });

  it("unclaimed comes before low_score", () => {
    const r = qualify(biz({ isClaimed: false }), CTX, rules({ reviewScoreBelow: 90 }));
    expect(r.reasons).toEqual(["unclaimed", "low_score"]);
  });
});

describe("REASON_LABELS", () => {
  it("has a plain-English label for every code", () => {
    const codes: ReasonCode[] = [
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
      "unclaimed",
      "low_score",
    ];
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...codes].sort());
    for (const c of codes) expect(REASON_LABELS[c]).toMatch(/^[A-Z][a-z].*[^.]$/);
    expect(REASON_LABELS.chain).toBe("Matches a known chain or franchise name");
  });
});
