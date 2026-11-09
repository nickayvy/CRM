// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BusinessCard } from "@/components/lookup/business-card";
import { BusinessGrid } from "@/components/lookup/business-grid";
import { Pagination } from "@/components/lookup/pagination";
import { CategoryBubbles } from "@/components/lookup/category-bubbles";
import { BusinessLogo, SourceChip, VelocityBadge } from "@/components/lookup/badges";
import { categoryOrder } from "@/features/lookup/graph-utils";
import type { LookupBusiness } from "@/features/lookup/types";

afterEach(() => {
  cleanup();
});

const LOGO_URL = "https://cdn.acme-plumbing.com/logo.png";
const IMAGE_URL = "https://s3-media.yelp.com/photo/acme.jpg";
const FAVICON_FRAGMENT = "domain=acme-plumbing.com";

function makeBusiness(overrides: Partial<LookupBusiness> = {}): LookupBusiness {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    source: "trustpilot",
    name: "Acme Plumbing",
    slug: "acme-plumbing.com",
    trustpilotId: null,
    website: "https://www.acme-plumbing.com",
    phone: null,
    email: null,
    logoUrl: null,
    imageUrl: null,
    socialLinks: {},
    category: "home_services",
    categoryTitle: "Home Services",
    subcategory: null,
    city: null,
    country: null,
    rating: 4.6,
    reviewCount: 1234,
    reviewsLast30d: 57,
    aiSummary: null,
    hasMetaAds: false,
    yelpUrl: null,
    qualification: "qualified",
    rejectionReasons: [],
    lastSyncedAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

function logoImg(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector("img");
}

describe("VelocityBadge", () => {
  it.each([
    [50, "HIGH"],
    [49, "MED"],
    [20, "MED"],
    [19, "LOW"],
    [0, "LOW"],
  ])("l30d %i renders tier %s", (l30d, tier) => {
    render(<VelocityBadge l30d={l30d} />);
    const badge = screen.getByText(tier);
    expect(badge.getAttribute("data-tier")).toBe(tier);
  });
});

describe("SourceChip", () => {
  it("renders the source label", () => {
    const { rerender } = render(<SourceChip source="trustpilot" />);
    expect(screen.getByText("Trustpilot").getAttribute("data-source")).toBe("trustpilot");
    rerender(<SourceChip source="yelp" />);
    expect(screen.getByText("Yelp").getAttribute("data-source")).toBe("yelp");
  });
});

describe("BusinessLogo", () => {
  it("walks logoUrl -> favicon -> initial when every image errors", () => {
    const { container } = render(<BusinessLogo business={makeBusiness({ logoUrl: LOGO_URL })} />);
    expect(logoImg(container)!.getAttribute("src")).toBe(LOGO_URL);

    fireEvent.error(logoImg(container)!);
    const favicon = logoImg(container)!.getAttribute("src");
    expect(favicon).toContain(FAVICON_FRAGMENT);

    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)).toBeNull();
    expect(screen.getByText("A")).not.toBeNull();
  });

  it("uses imageUrl as the second step when set", () => {
    const { container } = render(<BusinessLogo business={makeBusiness({ logoUrl: LOGO_URL, imageUrl: IMAGE_URL })} />);
    expect(logoImg(container)!.getAttribute("src")).toBe(LOGO_URL);

    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)!.getAttribute("src")).toBe(IMAGE_URL);

    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)!.getAttribute("src")).toContain(FAVICON_FRAGMENT);

    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)).toBeNull();
    expect(screen.getByText("A")).not.toBeNull();
  });

  it("starts at imageUrl when there is no logoUrl", () => {
    const { container } = render(<BusinessLogo business={makeBusiness({ imageUrl: IMAGE_URL })} />);
    expect(logoImg(container)!.getAttribute("src")).toBe(IMAGE_URL);
  });

  it("renders the initial immediately with no logoUrl, imageUrl, slug or website", () => {
    const { container } = render(<BusinessLogo business={makeBusiness({ slug: null, website: null })} />);
    expect(logoImg(container)).toBeNull();
    expect(screen.getByText("A")).not.toBeNull();
  });

  it("honours initialsLength", () => {
    render(<BusinessLogo business={makeBusiness({ slug: null, website: null })} initialsLength={2} />);
    expect(screen.getByText("AC")).not.toBeNull();
  });
});

describe("BusinessCard", () => {
  it("renders name, category, reviews, L30D, rating, website link and source chip", () => {
    render(<BusinessCard business={makeBusiness()} onSelect={vi.fn()} />);

    expect(screen.getByText("Acme Plumbing")).not.toBeNull();
    expect(screen.getByText("Home Services")).not.toBeNull();
    expect(screen.getByText("1,234 reviews")).not.toBeNull();
    expect(screen.getByTestId("l30d").textContent).toContain("57");
    expect(within(screen.getByTestId("rating")).getByText("4.6")).not.toBeNull();
    expect(screen.getByText("Trustpilot")).not.toBeNull();

    const link = screen.getByRole("link", { name: /acme-plumbing\.com/ });
    expect(link.textContent).toContain("acme-plumbing.com");
    expect(link.textContent).not.toContain("www.");
    expect(link.getAttribute("href")).toBe("https://www.acme-plumbing.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders the Yelp source chip", () => {
    render(<BusinessCard business={makeBusiness({ source: "yelp" })} onSelect={vi.fn()} />);
    expect(screen.getByText("Yelp")).not.toBeNull();
    expect(screen.queryByText("Trustpilot")).toBeNull();
  });

  it("humanises the category alias when categoryTitle is null", () => {
    render(<BusinessCard business={makeBusiness({ categoryTitle: null, category: "home_services" })} onSelect={vi.fn()} />);
    expect(screen.getByText("Home Services")).not.toBeNull();
  });

  it("prefers categoryTitle over the alias", () => {
    render(<BusinessCard business={makeBusiness({ categoryTitle: "Plumbers & Co", category: "home_services" })} onSelect={vi.fn()} />);
    expect(screen.getByText("Plumbers & Co")).not.toBeNull();
    expect(screen.queryByText("Home Services")).toBeNull();
  });

  it("hides the rating when rating is null", () => {
    render(<BusinessCard business={makeBusiness({ rating: null })} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("rating")).toBeNull();
    expect(screen.queryByText("4.6")).toBeNull();
  });

  it("hides the website link when website is null", () => {
    render(<BusinessCard business={makeBusiness({ website: null })} onSelect={vi.fn()} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides the category badge when category is null", () => {
    render(<BusinessCard business={makeBusiness({ category: null, categoryTitle: null })} onSelect={vi.fn()} />);
    expect(screen.queryByText("Home Services")).toBeNull();
  });

  it.each([
    [50, "HIGH"],
    [49, "MED"],
    [20, "MED"],
    [19, "LOW"],
    [0, "LOW"],
  ])("renders velocity tier for l30d %i as %s", (l30d, tier) => {
    render(<BusinessCard business={makeBusiness({ reviewsLast30d: l30d })} onSelect={vi.fn()} />);
    expect(screen.getByTestId("l30d").textContent).toContain(String(l30d));
    const badge = screen.getByTestId("business-card").querySelector("[data-tier]")!;
    expect(badge.getAttribute("data-tier")).toBe(tier);
    expect(badge.textContent).toContain(tier);
  });

  it("falls back through the logo chain inside the card", () => {
    const { container } = render(<BusinessCard business={makeBusiness({ logoUrl: LOGO_URL })} onSelect={vi.fn()} />);
    expect(logoImg(container)!.getAttribute("src")).toBe(LOGO_URL);
    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)!.getAttribute("src")).toContain(FAVICON_FRAGMENT);
    fireEvent.error(logoImg(container)!);
    expect(logoImg(container)).toBeNull();
    expect(within(screen.getByTestId("business-card")).getByText("A")).not.toBeNull();
  });

  it("shows the initial immediately when nothing can supply a logo", () => {
    const { container } = render(<BusinessCard business={makeBusiness({ slug: null, website: null })} onSelect={vi.fn()} />);
    expect(logoImg(container)).toBeNull();
    expect(within(screen.getByTestId("business-card")).getByText("A")).not.toBeNull();
  });

  it("calls onSelect with the id on click", async () => {
    const onSelect = vi.fn();
    const b = makeBusiness();
    render(<BusinessCard business={b} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId("business-card"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(b.id);
  });

  it("calls onSelect with the id on Enter", async () => {
    const onSelect = vi.fn();
    const b = makeBusiness();
    render(<BusinessCard business={b} onSelect={onSelect} />);
    screen.getByTestId("business-card").focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(b.id);
  });

  it("does not call onSelect when the website link is clicked", async () => {
    const onSelect = vi.fn();
    render(<BusinessCard business={makeBusiness()} onSelect={onSelect} />);
    const link = screen.getByRole("link");
    // Keep jsdom from attempting to navigate.
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("BusinessGrid", () => {
  it("renders one card per business", async () => {
    const onSelect = vi.fn();
    const businesses = [
      makeBusiness({ id: "a", name: "Acme Plumbing" }),
      makeBusiness({ id: "b", name: "Bolt Electric" }),
      makeBusiness({ id: "c", name: "Cedar Roofing" }),
    ];
    render(<BusinessGrid businesses={businesses} onSelect={onSelect} />);
    expect(screen.getAllByTestId("business-card")).toHaveLength(3);
    expect(screen.getByText("Bolt Electric")).not.toBeNull();

    await userEvent.click(screen.getAllByTestId("business-card")[1]);
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("shows the filtered empty state with a working Clear all filters button", async () => {
    const onClearFilters = vi.fn();
    render(<BusinessGrid businesses={[]} onSelect={vi.fn()} onClearFilters={onClearFilters} filtered />);
    expect(screen.getByText("No businesses match your filters")).not.toBeNull();
    expect(screen.queryAllByTestId("business-card")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("shows the unfiltered empty state without a clear button", () => {
    render(<BusinessGrid businesses={[]} onSelect={vi.fn()} onClearFilters={vi.fn()} filtered={false} />);
    expect(screen.getByText("No businesses yet")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all filters" })).toBeNull();
    expect(screen.queryByText("No businesses match your filters")).toBeNull();
  });
});

describe("Pagination", () => {
  it("first page: range, page count, Previous disabled, Next pages forward", async () => {
    const onPage = vi.fn();
    render(<Pagination offset={0} total={120} onPage={onPage} />);
    expect(screen.getByText("1–50 of 120")).not.toBeNull();
    expect(screen.getByText("Page 1 of 3")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(50);
  });

  it("last page: partial range, Next disabled, Previous pages back", async () => {
    const onPage = vi.fn();
    render(<Pagination offset={100} total={120} onPage={onPage} />);
    expect(screen.getByText("101–120 of 120")).not.toBeNull();
    expect(screen.getByText("Page 3 of 3")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Next page" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage).toHaveBeenCalledWith(50);
  });

  it("renders nothing when total is 0", () => {
    const { container } = render(<Pagination offset={0} total={0} onPage={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("formats large totals with a thousands separator", () => {
    render(<Pagination offset={0} total={1234} onPage={vi.fn()} />);
    expect(screen.getByText(/of 1,234/)).not.toBeNull();
  });
});

describe("CategoryBubbles", () => {
  // Counts: home_services 5, plumbing 4, auto-repair 3, dental 3, hvac 2, legal 2,
  // roofing 2, landscaping 1, zeta_last 1 (9th, so it is cut), plus null-category nodes.
  const spec: [string | null, number][] = [
    ["home_services", 5],
    ["plumbing", 4],
    ["auto-repair", 3],
    ["dental", 3],
    ["hvac", 2],
    ["legal", 2],
    ["roofing", 2],
    ["landscaping", 1],
    ["zeta_last", 1],
    [null, 6],
  ];
  const nodes = spec.flatMap(([category, n]) => Array.from({ length: n }, () => ({ category })));
  const order = categoryOrder(nodes);

  function renderBubbles(selected: string | null = null, onCategoryClick = vi.fn()) {
    render(<CategoryBubbles nodes={nodes} order={order} selectedCategory={selected} onCategoryClick={onCategoryClick} />);
    return onCategoryClick;
  }

  function buttonTexts(): string[] {
    return screen.getAllByRole("button").map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
  }

  it("renders All plus at most 8 categories, ordered by count desc, with humanised labels and counts", () => {
    renderBubbles();
    expect(buttonTexts()).toEqual([
      "All",
      "Home Services (5)",
      "Plumbing (4)",
      "Auto Repair (3)",
      "Dental (3)",
      "Hvac (2)",
      "Legal (2)",
      "Roofing (2)",
      "Landscaping (1)",
    ]);
    expect(screen.queryByText(/Zeta Last/)).toBeNull();
  });

  it("does not show null categories", () => {
    renderBubbles();
    expect(screen.queryByText(/null|uncategorized|\(6\)/i)).toBeNull();
  });

  it("clicking a category calls onCategoryClick with its alias", async () => {
    const onCategoryClick = renderBubbles();
    await userEvent.click(screen.getByRole("button", { name: /Home Services/ }));
    expect(onCategoryClick).toHaveBeenCalledWith("home_services");
  });

  it("clicking the selected category clears it", async () => {
    const onCategoryClick = renderBubbles("plumbing");
    const selected = screen.getByRole("button", { name: /Plumbing/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(selected);
    expect(onCategoryClick).toHaveBeenCalledWith(null);
  });

  it("All calls onCategoryClick(null)", async () => {
    const onCategoryClick = renderBubbles("plumbing");
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onCategoryClick).toHaveBeenCalledWith(null);
  });

  it("renders nothing for an empty node list", () => {
    const { container } = render(<CategoryBubbles nodes={[]} order={[]} selectedCategory={null} onCategoryClick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
