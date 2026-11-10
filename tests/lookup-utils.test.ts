import { describe, expect, it } from "vitest";
import type { GraphNode } from "@/db/repo/discovery";
import {
  CATEGORY_COLORS,
  UNCATEGORIZED_COLOR,
  categoryColor,
  categoryCounts,
  categoryLabel,
  categoryOrder,
  graphSubset,
  hasLabel,
  nodeRadius,
  trimLinks,
  truncateLabel,
} from "@/features/lookup/graph-utils";
import { faviconUrl, hostOf, isTrustpilotReviewUrl, logoChain, metaAdsLibraryUrl, socialLink, trustpilotUrl } from "@/features/lookup/links";
import { PAGE_SIZE, categoryParam, pageInfo, parseCategories, parseLookupQuery, patchLookupParams, toggleCategory } from "@/features/lookup/search-params";

function node(id: string, totalReviews: number, category: string | null = "plumbing"): GraphNode {
  return { id, name: `Biz ${id}`, category, totalReviews, rating: 4.2, reviewsLast30d: 0 };
}

describe("nodeRadius", () => {
  it("is sqrt(reviews)*0.5+5 clamped to [4, 30]", () => {
    expect(nodeRadius(0)).toBe(5);
    expect(nodeRadius(100)).toBe(10);
    expect(nodeRadius(400)).toBe(15);
    expect(nodeRadius(2500)).toBe(30);
    expect(nodeRadius(1_000_000)).toBe(30);
    expect(nodeRadius(-50)).toBe(5);
  });
  it("labels only nodes with radius ≥ 10 and truncates long names", () => {
    expect(hasLabel(99)).toBe(false);
    expect(hasLabel(100)).toBe(true);
    expect(truncateLabel("Short Name")).toBe("Short Name");
    expect(truncateLabel("Exactly16Chars!!")).toBe("Exactly16Chars!!");
    expect(truncateLabel("A Much Longer Business Name")).toBe("A Much Longer ...");
  });
});

describe("graphSubset", () => {
  const nodes = Array.from({ length: 60 }, (_, i) => node(`n${i}`, i * 10, i % 2 ? "plumbing" : "dental"));
  it("keeps the top 50 by reviews and reports the pre-cap total", () => {
    const r = graphSubset(nodes, []);
    expect(r.nodes).toHaveLength(50);
    expect(r.total).toBe(60);
    expect(r.nodes[0].id).toBe("n59");
    expect(r.nodes.some((n) => n.id === "n9")).toBe(false);
  });
  it("filters by category before capping", () => {
    const r = graphSubset(nodes, [], { category: "dental" });
    expect(r.total).toBe(30);
    expect(r.nodes.every((n) => n.category === "dental")).toBe(true);
  });
  it("keeps nodes in any of several categories", () => {
    const mixed = [...nodes, node("x", 1, "hvac"), node("y", 1, null)];
    const r = graphSubset(mixed, [], { categories: ["dental", "hvac"] });
    expect(r.total).toBe(31);
    expect(r.nodes.every((n) => n.category === "dental" || n.category === "hvac")).toBe(true);
  });
  it("drops links whose ends were cut, self-loops and duplicates", () => {
    const links = [
      { source: "n59", target: "n58" },
      { source: "n59", target: "n58" },
      { source: "n59", target: "n0" },
      { source: "n57", target: "n57" },
      { source: "ghost", target: "n59" },
    ];
    expect(graphSubset(nodes, links).links).toEqual([{ source: "n59", target: "n58" }]);
    expect(trimLinks(links, [node("n59", 1), node("n0", 1)])).toEqual([{ source: "n59", target: "n0" }]);
  });
});

describe("categories", () => {
  const nodes = [node("a", 1, "dental"), node("b", 1, "plumbing"), node("c", 1, "plumbing"), node("d", 1, null)];
  it("orders by count desc then name, ignoring null", () => {
    expect(categoryCounts(nodes)).toEqual([
      { category: "plumbing", count: 2 },
      { category: "dental", count: 1 },
    ]);
    expect(categoryOrder(nodes)).toEqual(["plumbing", "dental"]);
  });
  it("colors by position, gray for unknown/null, cycling past six", () => {
    const order = ["a", "b", "c", "d", "e", "f", "g"];
    expect(categoryColor("a", order)).toBe(CATEGORY_COLORS[0]);
    expect(categoryColor("g", order)).toBe(CATEGORY_COLORS[0]);
    expect(categoryColor(null, order)).toBe(UNCATEGORIZED_COLOR);
    expect(categoryColor("zzz", order)).toBe(UNCATEGORIZED_COLOR);
  });
  it("humanises aliases and keeps titles", () => {
    expect(categoryLabel("home_services")).toBe("Home Services");
    expect(categoryLabel("auto-repair")).toBe("Auto Repair");
    expect(categoryLabel("Electronics & Technology")).toBe("Electronics & Technology");
  });
});

describe("search params", () => {
  it("parses every filter, ignoring junk", () => {
    const q = parseLookupQuery({
      search: " acme ",
      category: "plumbing",
      source: "trustpilot",
      minReviews: "500",
      minL30d: "25",
      minRating: "4",
      hasPhone: "true",
      offset: "100",
    });
    expect(q).toEqual({
      filter: { q: "acme", categories: ["plumbing"], source: "trustpilot", minReviews: 500, minL30d: 25, minRating: 4, hasPhone: true },
      offset: 100,
    });
    expect(parseLookupQuery({ source: "google", minReviews: "-3", minRating: "9", hasPhone: "false", offset: "abc" })).toEqual({
      filter: {},
      offset: 0,
    });
    expect(parseLookupQuery(new URLSearchParams("offset=75")).offset).toBe(50);
  });
  it("patching a filter resets offset; empty/0/false remove the key; offset patches page", () => {
    expect(patchLookupParams("search=a&offset=100", { category: "dental" })).toBe("search=a&category=dental");
    expect(patchLookupParams("search=a&minReviews=50", { minReviews: "0", search: "" })).toBe("");
    expect(patchLookupParams("hasPhone=true", { hasPhone: "false" })).toBe("");
    expect(patchLookupParams("search=a", { offset: "50" })).toBe("search=a&offset=50");
  });
  it("page info gives correct ranges", () => {
    expect(pageInfo(0, 0)).toMatchObject({ start: 0, end: 0, page: 1, pages: 1, hasPrev: false, hasNext: false });
    expect(pageInfo(0, 120)).toMatchObject({ start: 1, end: 50, page: 1, pages: 3, hasNext: true });
    expect(pageInfo(100, 120)).toMatchObject({ start: 101, end: 120, page: 3, pages: 3, hasNext: false, hasPrev: true });
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("links", () => {
  it("derives hosts, favicons and the logo chain", () => {
    expect(hostOf("https://www.acme.com/about")).toBe("acme.com");
    expect(hostOf(null)).toBeNull();
    expect(faviconUrl("acme.com")).toContain("domain=acme.com");
    expect(faviconUrl(null, "http://shop.example.org")).toContain("domain=shop.example.org");
    expect(faviconUrl("not-a-domain", null)).toBeNull();
    expect(logoChain({ logoUrl: "L", imageUrl: "I", slug: "acme.com", website: null })).toEqual([
      "L",
      "I",
      "https://www.google.com/s2/favicons?domain=acme.com&sz=128",
    ]);
    expect(logoChain({ logoUrl: null, slug: null, website: null })).toEqual([]);
  });
  it("builds external links", () => {
    expect(socialLink({ x: "https://x.com/acme" }, "twitter", "x")).toBe("https://x.com/acme");
    expect(socialLink({ facebook: "  " }, "facebook")).toBeNull();
    expect(metaAdsLibraryUrl("https://www.acme.com")).toContain("q=acme.com");
    expect(trustpilotUrl({ trustpilotId: "acme.com", slug: null })).toBe("https://www.trustpilot.com/review/acme.com");
    expect(trustpilotUrl({ trustpilotId: null, slug: null })).toBeNull();
    expect(isTrustpilotReviewUrl("https://www.trustpilot.com/review/acme.com")).toBe(true);
    expect(isTrustpilotReviewUrl("https://www.trustpilot.com/review/")).toBe(false);
    expect(isTrustpilotReviewUrl("https://example.com")).toBe(false);
  });
});

describe("multi-category params", () => {
  it("parses a comma-separated category param into distinct aliases", () => {
    expect(parseCategories("dental, plumbing,,dental")).toEqual(["dental", "plumbing"]);
    expect(parseCategories(null)).toEqual([]);
    expect(parseLookupQuery({ category: "dental,plumbing" }).filter.categories).toEqual(["dental", "plumbing"]);
    expect(parseLookupQuery({}).filter.categories).toBeUndefined();
  });
  it("toggles aliases in and out and serialises them", () => {
    const one = toggleCategory([], "dental");
    const two = toggleCategory(one, "plumbing");
    expect(categoryParam(two)).toBe("dental,plumbing");
    expect(toggleCategory(two, "dental")).toEqual(["plumbing"]);
    expect(patchLookupParams("category=dental&offset=50", { category: categoryParam(two) })).toBe("category=dental%2Cplumbing");
    expect(patchLookupParams("category=dental", { category: categoryParam([]) })).toBe("");
  });
});
