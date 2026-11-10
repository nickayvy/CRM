// AC-18.4: niches, offline area resolution, plan limits and cost.
import { describe, expect, it, vi } from "vitest";
import { NICHES, getNiche } from "@/lib/google-places/niches";
import {
  MAX_QUERIES_PER_JOB,
  MAX_TERMS_PER_JOB,
  MAX_ZIPS_PER_JOB,
  PRICE_PER_1000_REQUESTS_USD,
  PlanError,
  planGoogleSearch,
  searchAt,
} from "@/lib/google-places/plan";
import { AreaError, resolveArea, zipCentre } from "@/lib/google-places/zips";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

describe("NICHES", () => {
  it("has at least 20 niches covering the article's groups, each with 2–5 terms, accept types and a top-level slug", () => {
    expect(NICHES.length).toBeGreaterThanOrEqual(20);
    const slugs = new Set(TRUSTPILOT_CATEGORIES.map((c) => c.slug));
    for (const n of NICHES) {
      expect(n.terms.length, n.id).toBeGreaterThanOrEqual(2);
      expect(n.terms.length, n.id).toBeLessThanOrEqual(5);
      expect(n.acceptTypes.length, n.id).toBeGreaterThan(0);
      expect(slugs.has(n.category), n.id).toBe(true);
      for (const t of n.terms) expect(t).toBe(t.trim().toLowerCase());
    }
    expect(new Set(NICHES.map((n) => n.id)).size).toBe(NICHES.length);
    for (const id of [
      "roofing", "plumbing", "hvac", "landscaping", "electrical", "pest_control", "cleaning",
      "dentist", "chiropractor", "med_spa", "veterinary",
      "restaurant", "coffee_shop", "bakery",
      "gym", "yoga_pilates", "martial_arts",
      "law_firm", "accountant", "real_estate", "auto_repair", "hair_salon",
    ])
      expect(getNiche(id), id).not.toBeNull();
  });
});

describe("resolveArea", () => {
  it("resolves zip lists separated by commas or spaces", async () => {
    for (const input of ["75201, 75202", "75201 75202", "75202,75201,75201"]) {
      const a = await resolveArea(input);
      expect(a.zips).toEqual(["75201", "75202"]);
      expect(a.states).toEqual(["TX"]);
      expect(a.label).toBe("2 zips, TX");
    }
  });

  it("resolves \"Dallas, TX\" offline to more than 20 zips, labelled Dallas, TX", async () => {
    const geocode = vi.fn();
    for (const input of ["Dallas, TX", "dallas tx", "Dallas, Texas"]) {
      const a = await resolveArea(input, { geocode });
      expect(a.zips.length).toBeGreaterThan(20);
      expect(a.zips).toContain("75201");
      expect(a.label).toBe("Dallas, TX");
      expect(a.states).toEqual(["TX"]);
    }
    expect(geocode).not.toHaveBeenCalled();
    expect((await resolveArea("New York, NY")).zips.length).toBeGreaterThan(20);
  });

  it("resolves \"<zip> +<n>mi\" around the zip centre", async () => {
    const five = await resolveArea("75201 +5mi");
    expect(five.zips).toContain("75201");
    expect(five.zips.length).toBeGreaterThanOrEqual(6);
    expect(five.label).toBe("75201 +5mi, TX");
    const ten = await resolveArea("75201 +10mi");
    expect(ten.zips.length).toBeGreaterThan(five.zips.length);
  });

  it("knows zip centres", () => {
    const c = zipCentre("75201");
    expect(c?.latitude).toBeCloseTo(32.79, 0);
    expect(c?.longitude).toBeCloseTo(-96.8, 0);
    expect(zipCentre("00000")).toBeNull();
  });

  it("refuses unknown text without a geocoder, and uses the geocoder when given", async () => {
    await expect(resolveArea("Deep Ellum arts district")).rejects.toBeInstanceOf(AreaError);
    await expect(resolveArea("")).rejects.toBeInstanceOf(AreaError);
    await expect(resolveArea("99999")).rejects.toThrow(/Unknown zip code: 99999/);
    const geocode = vi.fn(async () => ({ latitude: 32.784, longitude: -96.784 }));
    const a = await resolveArea("Deep Ellum arts district", { geocode });
    expect(geocode).toHaveBeenCalledWith("Deep Ellum arts district");
    expect(a.zips.length).toBeGreaterThan(0);
    expect(a.states).toEqual(["TX"]);
    expect(a.label).toBe("Deep Ellum arts district, TX");
    await expect(resolveArea("Nowhere at all", { geocode: async () => null })).rejects.toBeInstanceOf(AreaError);
  });
});

describe("planGoogleSearch", () => {
  it("roofing in 75201, 75202: 2 zips × the niche's terms, 3 pages each, cost at $35 / 1,000", async () => {
    const roofing = getNiche("roofing")!;
    const p = await planGoogleSearch({ nicheId: "roofing", area: "75201, 75202" });
    expect(p.plan.zips).toEqual(["75201", "75202"]);
    expect(p.plan.terms).toEqual(roofing.terms);
    expect(p.queries).toBe(roofing.terms.length * 2);
    expect(p.maxRequests).toBe(p.queries * 3);
    expect(PRICE_PER_1000_REQUESTS_USD).toBe(35);
    expect(p.estMaxUsd).toBeCloseTo(p.maxRequests * 0.035, 2);
    expect(p.plan).toMatchObject({
      nicheId: "roofing",
      areaLabel: "2 zips, TX",
      acceptTypes: roofing.acceptTypes,
      maxPagesPerQuery: 3,
      saturated: [],
      errors: [],
    });
    expect(p.location).toBe("2 zips, TX");
    expect(p.term).toBe("Roofing");
  });

  it("Dallas, TX gives more than 20 zips and the Dallas, TX label", async () => {
    const p = await planGoogleSearch({ nicheId: "roofing", area: "Dallas, TX", maxPagesPerQuery: 1 });
    expect(p.plan.zips.length).toBeGreaterThan(20);
    expect(p.location).toBe("Dallas, TX");
    expect(p.maxRequests).toBe(p.queries);
  });

  it("custom terms are trimmed, lower-cased and unique; without a niche there is no category rule", async () => {
    const p = await planGoogleSearch({ terms: [" Metal Roofing ", "metal roofing", "Gutters"], area: "75201" });
    expect(p.plan.terms).toEqual(["metal roofing", "gutters"]);
    expect(p.plan.acceptTypes).toEqual([]);
    expect(p.plan.nicheId).toBeNull();
    expect(p.term).toBe("metal roofing");
    expect(p.location).toBe("75201, TX");
  });

  it("201 zips and 501 searches each throw PlanError", async () => {
    // A radius wide enough for more than 200 zips.
    const wide = await planGoogleSearch({ terms: ["roofer"], area: "75201 +60mi" }).catch((e: unknown) => e);
    expect(wide).toBeInstanceOf(PlanError);
    expect((wide as PlanError).field).toBe("area");
    expect((wide as Error).message).toMatch(new RegExp(`limit of ${MAX_ZIPS_PER_JOB}`));

    // Exactly 201 zips from a list.
    const area = await resolveArea("75201 +60mi");
    const z201 = area.zips.slice(0, 201).join(",");
    await expect(planGoogleSearch({ terms: ["roofer"], area: z201 })).rejects.toThrow(/201 zip codes/);
    // 200 zips with one term is allowed.
    const z200 = area.zips.slice(0, 200).join(",");
    expect((await planGoogleSearch({ terms: ["roofer"], area: z200, maxPagesPerQuery: 1 })).queries).toBe(200);

    // 3 terms × 167 zips = 501 searches.
    const z167 = area.zips.slice(0, 167).join(",");
    const over = await planGoogleSearch({ terms: ["a", "b", "c"], area: z167 }).catch((e: unknown) => e);
    expect(over).toBeInstanceOf(PlanError);
    expect((over as Error).message).toMatch(new RegExp(`501 searches, over the limit of ${MAX_QUERIES_PER_JOB}`));
    // 3 × 166 = 498 is allowed.
    expect((await planGoogleSearch({ terms: ["a", "b", "c"], area: area.zips.slice(0, 166).join(",") })).queries).toBe(498);
  });

  it("refuses no terms, too many terms, an unknown niche and an unresolvable area", async () => {
    await expect(planGoogleSearch({ area: "75201" })).rejects.toMatchObject({ name: "PlanError", field: "terms" });
    const many = Array.from({ length: MAX_TERMS_PER_JOB + 1 }, (_, i) => `t${i}`);
    await expect(planGoogleSearch({ terms: many, area: "75201" })).rejects.toMatchObject({ field: "terms" });
    await expect(planGoogleSearch({ nicheId: "nope", area: "75201" })).rejects.toMatchObject({ field: "nicheId" });
    await expect(planGoogleSearch({ nicheId: "roofing", area: "Atlantis under the sea" })).rejects.toMatchObject({
      name: "PlanError",
      field: "area",
    });
    // With a fake geocoder the same text resolves.
    const p = await planGoogleSearch(
      { nicheId: "roofing", area: "Atlantis under the sea" },
      { geocode: async () => ({ latitude: 32.787, longitude: -96.799 }) },
    );
    expect(p.plan.zips.length).toBeGreaterThan(0);
  });

  it("search i is zips[floor(i / terms)] with terms[i % terms]", () => {
    const plan = { terms: ["a", "b", "c"], zips: ["1", "2"] };
    expect([0, 1, 2, 3, 4, 5].map((i) => searchAt(plan, i))).toEqual([
      { term: "a", zip: "1" },
      { term: "b", zip: "1" },
      { term: "c", zip: "1" },
      { term: "a", zip: "2" },
      { term: "b", zip: "2" },
      { term: "c", zip: "2" },
    ]);
  });
});
