// WP-16 item A: Trustpilot rows store the category alias (slug) in
// primaryCategory, so the Lookup bubble → `category=<alias>` filter finds them,
// while bubbles and cards still show the human title from categories[].title.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Db } from "@/db/client";
import { createTestDb } from "@/db/test-utils";
import { CategoryBubbles } from "@/components/lookup/category-bubbles";
import { categoryOrder } from "@/features/lookup/graph-utils";
import { loadCategoryTitles, loadGraph, loadGrid } from "@/features/lookup/data";
import { parseLookupQuery } from "@/features/lookup/search-params";
import { toLookupBusiness } from "@/features/lookup/types";
import { categoryAlias, scrapeTrustpilotBusiness, scrapeTrustpilotCategory } from "@/lib/firecrawl/trustpilot";
import { trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { makeTrustpilotProfile } from "./helpers/builders";
import { createFakeFirecrawl, makeCategoryCard } from "./helpers/fake-firecrawl";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses RESTART IDENTITY CASCADE`);
});

function bubblesHtml(nodes: { category: string | null }[], titles: Record<string, string>): string {
  return renderToStaticMarkup(
    createElement(CategoryBubbles, { nodes, order: categoryOrder(nodes), selectedCategory: null, titles, onCategoryClick: () => {} }),
  ).replaceAll("<!-- -->", "");
}

describe("Trustpilot category alias alignment", () => {
  it("a scraped profile is found by category=<alias> and its bubble shows the title", async () => {
    // A title outside the 22 top-level labels, so the display must come from the stored {alias, title}.
    const title = "Pet Stores & Grooming";
    const alias = categoryAlias(title);
    expect(alias).toBe("pet_stores_grooming");
    const fc = createFakeFirecrawl();
    fc.setProfile("pawsome.com", makeTrustpilotProfile({ displayName: "Pawsome", categories: [title, "Dog Groomer"] }));

    const b = await scrapeTrustpilotBusiness(db, fc, trustpilotReviewUrl("pawsome.com"));
    expect(b.primaryCategory).toBe(alias);
    expect(b.categories[0]).toEqual({ alias, title });
    expect(b.subcategory).toBe("Dog Groomer");

    // The bubble a user clicks carries the alias; filtering by it returns the row.
    const grid = await loadGrid(db, parseLookupQuery({ category: alias }));
    expect(grid.rows.map((r) => r.name)).toEqual(["Pawsome"]);
    // Filtering by the old title value matches nothing (that was the bug).
    expect((await loadGrid(db, parseLookupQuery({ category: title }))).total).toBe(0);

    const { nodes } = await loadGraph(db);
    expect(nodes.map((n) => n.category)).toEqual([alias]);
    const html = bubblesHtml(nodes, await loadCategoryTitles(db));
    expect(html).toContain(`${title.replace("&", "&amp;")} <span`);
    expect(html).toContain(`title="${title.replace("&", "&amp;")}: 1 business. Click to filter."`);

    // Cards and the dossier read the title through toLookupBusiness.
    expect(toLookupBusiness(b)).toMatchObject({ category: alias, categoryTitle: title });
  });

  it("a category seed stores the category slug as primaryCategory", async () => {
    const fc = createFakeFirecrawl();
    fc.setCategoryPage("home_services", 1, [makeCategoryCard("fixit.com", { name: "Fixit" })]);
    await scrapeTrustpilotCategory(db, fc, "home_services", { max: 20 });

    const grid = await loadGrid(db, parseLookupQuery({ category: "home_services" }));
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0]).toMatchObject({ name: "Fixit", category: "home_services", categoryTitle: "Home Services" });
    const { nodes } = await loadGraph(db);
    expect(bubblesHtml(nodes, await loadCategoryTitles(db))).toContain("Home Services <span");
  });
});
