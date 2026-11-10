// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { GraphNode } from "@/db/repo/discovery";
import type { LookupBusiness } from "@/features/lookup/types";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  usePathname: () => "/lookup",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const discovery = vi.hoisted(() => ({ scrapeUrlAction: vi.fn(), seedCategoryAction: vi.fn() }));
vi.mock("@/features/discovery/actions", () => ({ ...discovery, discoveryConfigured: () => true }));

const lookupActions = vi.hoisted(() => ({
  addToLeadsAction: vi.fn(),
  getDossierAction: vi.fn(),
  createCallCampaignAction: vi.fn(),
  queueBusinessForCallsAction: vi.fn(),
  deleteBusinessFromLookupAction: vi.fn(),
}));
vi.mock("@/features/lookup/actions", () => lookupActions);

const { FilterPanel } = await import("@/components/lookup/filter-panel");
const { ManualScrapeInput } = await import("@/components/lookup/manual-scrape-input");
const { DossierModal } = await import("@/components/lookup/dossier-modal");
const { LookupView } = await import("@/components/lookup/lookup-view");
const { GridIsland } = await import("@/components/lookup/grid-island");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

beforeEach(() => {
  nav.qs = "";
  nav.push.mockReset();
  nav.refresh.mockReset();
  for (const f of [...Object.values(toasts), ...Object.values(discovery), ...Object.values(lookupActions)]) f.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function biz(overrides: Partial<LookupBusiness> = {}): LookupBusiness {
  return {
    id: ID_A,
    source: "trustpilot",
    name: "Acme Gadgets",
    slug: "acmegadgets.com",
    trustpilotId: "acmegadgets.com",
    website: "https://www.acmegadgets.com",
    phone: "+15125550123",
    email: "hello@acmegadgets.com",
    logoUrl: null,
    imageUrl: null,
    socialLinks: { facebook: "https://facebook.com/acmegadgets" },
    category: "electronics_technology",
    categoryTitle: "Electronics & Technology",
    subcategory: "Gadget Store",
    city: "Austin",
    country: "US",
    rating: 4.6,
    reviewCount: 1234,
    reviewsLast30d: 57,
    aiSummary: null,
    hasMetaAds: false,
    yelpUrl: null,
    qualification: "qualified",
    rejectionReasons: [],
    lastSyncedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    ...overrides,
  };
}

const CATEGORIES = [
  { alias: "electronics_technology", count: 3 },
  { alias: "plumbing", count: 1 },
];

describe("FilterPanel", () => {
  function lastHref(): string {
    return nav.push.mock.calls.at(-1)?.[0] as string;
  }

  it("debounces search into the URL and drops offset", async () => {
    nav.qs = "category=plumbing&offset=100";
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<FilterPanel categories={CATEGORIES} />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "acme" } });
    expect(nav.push).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(310);
    });
    expect(lastHref()).toBe("/lookup?category=plumbing&search=acme");
  });

  it("does not overwrite what the user is typing when the URL catches up to an earlier search", async () => {
    nav.qs = "";
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<FilterPanel categories={CATEGORIES} />);
    const input = () => screen.getByLabelText("Search") as HTMLInputElement;
    const pause = () => act(async () => void vi.advanceTimersByTime(310));
    const urlBecomes = (qs: string) => {
      nav.qs = qs;
      rerender(<FilterPanel categories={CATEGORIES} />);
    };

    // A pause after a space sends the trimmed "home"; its echo must not eat the space.
    fireEvent.change(input(), { target: { value: "home " } });
    await pause();
    expect(lastHref()).toBe("/lookup?search=home");
    urlBecomes("search=home");
    expect(input().value).toBe("home ");

    // Two pauses send "home d" then "home dep"; the older URL lands while the user is on "home depo".
    fireEvent.change(input(), { target: { value: "home d" } });
    await pause();
    fireEvent.change(input(), { target: { value: "home dep" } });
    await pause();
    fireEvent.change(input(), { target: { value: "home depo" } });
    urlBecomes("search=home+d");
    expect(input().value).toBe("home depo");
    urlBecomes("search=home+dep");
    expect(input().value).toBe("home depo");

    // A URL change the box did not make (back button, another control) still wins.
    urlBecomes("search=acme");
    expect(input().value).toBe("acme");
  });

  it("has-phone checkbox writes hasPhone=true and resets offset; unchecking removes it", async () => {
    nav.qs = "offset=50";
    const { unmount } = render(<FilterPanel categories={CATEGORIES} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Has phone number" }));
    expect(lastHref()).toBe("/lookup?hasPhone=true");
    unmount();
    nav.qs = "hasPhone=true&search=x";
    render(<FilterPanel categories={CATEGORIES} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Has phone number" }));
    expect(lastHref()).toBe("/lookup?search=x");
  });

  it("source, category and rating selects write their params and reset offset", async () => {
    nav.qs = "offset=150";
    render(<FilterPanel categories={CATEGORIES} titles={{ electronics_technology: "Electronics & Technology" }} />);

    await userEvent.click(screen.getByRole("combobox", { name: "Source" }));
    await userEvent.click(await screen.findByRole("option", { name: "Trustpilot" }));
    expect(lastHref()).toBe("/lookup?source=trustpilot");

    await userEvent.click(screen.getByRole("button", { name: "Category" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "Plumbing (1)" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Electronics & Technology (3)" }));
    expect(lastHref()).toBe("/lookup?category=electronics_technology");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("combobox", { name: "Min rating" }));
    await userEvent.click(await screen.findByRole("option", { name: "4+ stars" }));
    expect(lastHref()).toBe("/lookup?minRating=4");
  });

  it("category is a multi-select: ticking adds to the list, unticking removes, All clears", async () => {
    nav.qs = "category=plumbing&offset=50";
    render(<FilterPanel categories={CATEGORIES} titles={{ electronics_technology: "Electronics & Technology" }} />);
    expect(screen.getByRole("button", { name: "Category" }).textContent).toContain("Plumbing");

    await userEvent.click(screen.getByRole("button", { name: "Category" }));
    const plumbing = await screen.findByRole("menuitemcheckbox", { name: "Plumbing (1)" });
    expect(plumbing.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Electronics & Technology (3)" }));
    expect(lastHref()).toBe("/lookup?category=plumbing%2Celectronics_technology");
    // The menu stays open so several categories can be ticked in a row.
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Plumbing (1)" }));
    expect(lastHref()).toBe("/lookup");
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "All categories" }));
    expect(lastHref()).toBe("/lookup");
  });

  it("sliders commit minReviews / minL30d on release via keyboard", async () => {
    nav.qs = "offset=50";
    render(<FilterPanel categories={CATEGORIES} />);
    const [reviews, l30d] = screen.getAllByRole("slider");
    fireEvent.keyDown(reviews, { key: "ArrowRight" });
    expect(lastHref()).toBe("/lookup?minReviews=50");
    fireEvent.keyDown(l30d, { key: "ArrowRight" });
    expect(lastHref()).toBe("/lookup?minL30d=5");
  });

  it("Clear navigates to the bare path and reflects URL values", async () => {
    nav.qs = "search=acme&minReviews=500&minL30d=25&hasPhone=true";
    render(<FilterPanel categories={CATEGORIES} />);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("acme");
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Has phone number" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(lastHref()).toBe("/lookup");
  });
});

describe("ManualScrapeInput", () => {
  it("is disabled with the FIRECRAWL notice when discovery is not configured", () => {
    render(<ManualScrapeInput enabled={false} />);
    expect((screen.getByLabelText("Trustpilot review URL") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Search" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "Seed category" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Set FIRECRAWL_API_KEY to enable discovery")).toBeTruthy();
  });

  it("scrapes a pasted Trustpilot URL, toasts and refreshes", async () => {
    discovery.scrapeUrlAction.mockResolvedValue({ ok: true, data: { businessId: ID_A, name: "Acme Gadgets" } });
    const onSuccess = vi.fn();
    render(<ManualScrapeInput enabled onSuccess={onSuccess} />);
    expect(screen.queryByText("Set FIRECRAWL_API_KEY to enable discovery")).toBeNull();
    const input = screen.getByLabelText("Trustpilot review URL") as HTMLInputElement;
    const button = screen.getByRole("button", { name: "Search" }) as HTMLButtonElement;
    await userEvent.type(input, "https://example.com/x");
    expect(button.disabled).toBe(true);
    await userEvent.clear(input);
    await userEvent.type(input, "https://www.trustpilot.com/review/acmegadgets.com{Enter}");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(discovery.scrapeUrlAction).toHaveBeenCalledWith("https://www.trustpilot.com/review/acmegadgets.com");
    expect(toasts.success).toHaveBeenCalledWith("Business scraped", { description: "Acme Gadgets" });
    expect(input.value).toBe("");
  });

  it("toasts the action's error and does not refresh", async () => {
    discovery.scrapeUrlAction.mockResolvedValue({ ok: false, message: "Discovery is not configured: set FIRECRAWL_API_KEY" });
    const onSuccess = vi.fn();
    render(<ManualScrapeInput enabled onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText("Trustpilot review URL"), "https://www.trustpilot.com/review/x.com");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith("Scrape failed", { description: "Discovery is not configured: set FIRECRAWL_API_KEY" }),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("queues a category seed from the 22-item select and toasts that it started", async () => {
    discovery.seedCategoryAction.mockResolvedValue({ ok: true, data: { queued: true, category: "home_services" } });
    const onSuccess = vi.fn();
    render(<ManualScrapeInput enabled onSuccess={onSuccess} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Seed category" }));
    expect(await screen.findAllByRole("option")).toHaveLength(22);
    await userEvent.click(screen.getByRole("option", { name: "Home Services" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(discovery.seedCategoryAction).toHaveBeenCalledWith("home_services");
    expect(toasts.success).toHaveBeenCalledWith("Seeding started", {
      description: "Home Services: up to 50 businesses land in the next minute. Refresh to see them.",
    });
  });
});

describe("DossierModal", () => {
  function renderDossier(id: string | null = ID_A) {
    return render(
      <TooltipProvider>
        <DossierModal businessId={id} onClose={() => {}} />
      </TooltipProvider>,
    );
  }

  it("Delete asks for confirmation, deletes, closes and reports it", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    lookupActions.deleteBusinessFromLookupAction.mockResolvedValue({ ok: true, data: null });
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <TooltipProvider>
        <DossierModal businessId={ID_A} onClose={onClose} onDeleted={onDeleted} />
      </TooltipProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Acme Gadgets" });

    // Cancelling the confirm deletes nothing.
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete Acme Gadgets" }));
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(screen.getByRole("alertdialog").textContent).toContain("cannot be undone");
    await userEvent.click(cancel);
    expect(lookupActions.deleteBusinessFromLookupAction).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete Acme Gadgets" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(ID_A));
    expect(lookupActions.deleteBusinessFromLookupAction).toHaveBeenCalledWith(ID_A);
    expect(onClose).toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith("Business deleted", { description: "Acme Gadgets" });
  });

  it("renders header, overview, metrics, links with NO DATA tiles, and real Last synced", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    renderDossier();
    expect(screen.getByTestId("dossier-skeleton")).toBeTruthy();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Acme Gadgets" });
    expect(within(dialog).getByTestId("last-synced").textContent).toBe("Last synced: 3 h ago");
    expect(within(dialog).getByText("Electronics & Technology / Gadget Store")).toBeTruthy();
    expect(within(dialog).getByText("Austin, US")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Trustpilot" }).getAttribute("href")).toBe(
      "https://www.trustpilot.com/review/acmegadgets.com",
    );
    const metrics = within(dialog).getByTestId("metrics");
    expect(metrics.textContent).toContain("4.6");
    expect(metrics.textContent).toContain("1,234");
    expect(metrics.textContent).toContain("+57/30d");
    expect(within(dialog).queryByTestId("reason-chips")).toBeNull();
    expect(within(dialog).queryByText(/INTEL BRIEF/)).toBeNull();

    const tiles = within(dialog).getAllByTestId("link-tile");
    const byLabel = Object.fromEntries(tiles.map((t) => [t.querySelector("p")!.textContent, t]));
    expect(Object.keys(byLabel)).toEqual(["WEBSITE", "FACEBOOK", "META ADS", "X / TWITTER", "FOUNDER", "EMAIL", "PHONE"]);
    expect(byLabel.WEBSITE.textContent).toContain("www.acmegadgets.com");
    expect(byLabel.FACEBOOK.querySelector("a")!.getAttribute("href")).toBe("https://facebook.com/acmegadgets");
    expect(byLabel["META ADS"].querySelector("a")!.getAttribute("href")).toContain("q=acmegadgets.com");
    expect(byLabel["X / TWITTER"].textContent).toContain("NO DATA");
    expect(byLabel.FOUNDER.textContent).toContain("NO DATA");
    expect(byLabel.EMAIL.querySelector("a")!.getAttribute("href")).toBe("mailto:hello@acmegadgets.com");
    expect(byLabel.PHONE.textContent).toContain("(512) 555-0123");
  });

  it("shows every tile as NO DATA for a bare business, reason chips when not qualified, and the intel brief", async () => {
    lookupActions.getDossierAction.mockResolvedValue({
      ok: true,
      data: {
        business: biz({
          website: null,
          phone: null,
          email: null,
          socialLinks: {},
          rating: null,
          qualification: "rejected",
          rejectionReasons: ["low_rating", "no_phone"],
          aiSummary: "Fast-growing gadget retailer.",
        }),
        related: [],
      },
    });
    renderDossier();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Acme Gadgets" });
    const tiles = within(dialog).getAllByTestId("link-tile");
    expect(tiles.every((t) => t.textContent!.includes("NO DATA"))).toBe(true);
    expect(within(dialog).getByTestId("metrics").textContent).toContain("N/A");
    expect(within(dialog).getByTestId("reason-chips").children.length).toBe(2);
    expect(within(dialog).getByText("INTEL BRIEF // AUTOMATED ASSESSMENT")).toBeTruthy();
    expect(within(dialog).getByText("Fast-growing gadget retailer.")).toBeTruthy();
  });

  it("Add to Lead List toasts 'Lead added', then shows the next steps instead of the button", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    lookupActions.addToLeadsAction.mockResolvedValueOnce({ ok: true, data: { created: true } });
    renderDossier();
    await userEvent.click(await screen.findByRole("button", { name: "Add to Lead List" }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Lead added", { description: "Acme Gadgets" }));
    const next = await screen.findByTestId("lead-next-steps");
    expect(next.textContent).toContain("In your leads");
    expect(within(next).getByRole("link", { name: /Open Leads/ }).getAttribute("href")).toEqual("/leads");
    expect(screen.queryByRole("button", { name: "Add to Lead List" })).toBeNull();
    expect(lookupActions.addToLeadsAction).toHaveBeenCalledTimes(1);
    expect(lookupActions.addToLeadsAction).toHaveBeenCalledWith(ID_A);
  });

  it("a business that was already a lead toasts 'Already in your leads' and still shows the next steps", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    lookupActions.addToLeadsAction.mockResolvedValueOnce({ ok: true, data: { created: false } });
    renderDossier();
    await userEvent.click(await screen.findByRole("button", { name: "Add to Lead List" }));
    await waitFor(() => expect(toasts.info).toHaveBeenCalledWith("Already in your leads", { description: "Acme Gadgets" }));
    expect(await screen.findByTestId("lead-next-steps")).toBeTruthy();
  });

  it("a known lead opens with the next steps; a new campaign can be created and the business queued from the dossier", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz({ phone: "+17135550100" }), related: [] } });
    lookupActions.createCallCampaignAction.mockResolvedValue({ ok: true, data: { id: ID_B, name: "Gadget shops" } });
    lookupActions.queueBusinessForCallsAction.mockResolvedValue({ ok: true, data: { added: 1, skipped: 0, campaignName: "Gadget shops" } });
    render(
      <TooltipProvider>
        <DossierModal businessId={ID_A} onClose={() => {}} leadIds={new Set([ID_A])} callCampaigns={[]} />
      </TooltipProvider>,
    );
    const next = await screen.findByTestId("lead-next-steps");
    expect(screen.queryByRole("button", { name: "Add to Lead List" })).toBeNull();
    await userEvent.click(within(next).getByRole("button", { name: /Add to call campaign/ }));
    const picker = await screen.findByRole("dialog", { name: "Add to call campaign" });
    // No campaigns yet: the name field is offered straight away, no trip to /calling/new.
    await userEvent.type(within(picker).getByLabelText("New campaign name"), "Gadget shops");
    await userEvent.click(within(picker).getByRole("button", { name: "Create and add" }));
    await waitFor(() => expect(lookupActions.queueBusinessForCallsAction).toHaveBeenCalledWith(ID_B, ID_A));
    expect(lookupActions.createCallCampaignAction).toHaveBeenCalledWith("Gadget shops");
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Queued in Gadget shops", { description: "Acme Gadgets" }));
    const link = await screen.findByRole("link", { name: "Gadget shops" });
    expect(link.getAttribute("href")).toEqual(`/calling/${ID_B}`);
  });

  it("opens at once from the row already on screen while the full dossier loads", async () => {
    let resolve: (v: unknown) => void = () => {};
    lookupActions.getDossierAction.mockReturnValue(new Promise((r) => (resolve = r)));
    render(
      <TooltipProvider>
        <DossierModal businessId={ID_A} preview={biz()} onClose={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.getByRole("heading", { name: "Acme Gadgets" })).toBeTruthy();
    expect(screen.queryByTestId("dossier-skeleton")).toBeNull();
    expect(screen.getByTestId("related-loading")).toBeTruthy();
    resolve({ ok: true, data: { business: biz(), related: [biz({ id: ID_B, name: "Beta Corp" })] } });
    expect(await screen.findByText("Beta Corp")).toBeTruthy();
    expect(screen.queryByTestId("related-loading")).toBeNull();
  });

  it("navigates in place to a similar company, and adds that one", async () => {
    const beta = biz({ id: ID_B, name: "Beta Devices", reviewsLast30d: 25, website: "https://beta.io", slug: "beta.io", trustpilotId: "beta.io" });
    lookupActions.getDossierAction.mockImplementation(async (id: string) =>
      id === ID_A
        ? { ok: true, data: { business: biz(), related: [beta] } }
        : { ok: true, data: { business: beta, related: [biz()] } },
    );
    lookupActions.addToLeadsAction.mockResolvedValue({ ok: true, data: { created: true } });
    renderDossier();
    await screen.findByRole("heading", { name: "Acme Gadgets" });
    expect(screen.getByText("Similar to this company [01 FOUND]")).toBeTruthy();
    const row = screen.getByTestId("related-row");
    expect(row.textContent).toContain("Beta Devices");
    expect(row.textContent).toContain("beta.io");
    expect(row.textContent).toContain("MED");
    await userEvent.click(row);
    await screen.findByRole("heading", { name: "Beta Devices" });
    expect(lookupActions.getDossierAction).toHaveBeenLastCalledWith(ID_B);
    await userEvent.click(screen.getByRole("button", { name: "Add to Lead List" }));
    await waitFor(() => expect(lookupActions.addToLeadsAction).toHaveBeenCalledWith(ID_B));
  });

  it("shows an unavailable message when the business is missing", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: false, message: "Business not found" });
    renderDossier();
    expect(await screen.findByText("Business unavailable")).toBeTruthy();
    expect(screen.getByText("Business not found")).toBeTruthy();
  });
});

describe("LookupView", () => {
  const nodes: GraphNode[] = [
    { id: ID_A, name: "Acme Gadgets International", category: "electronics_technology", totalReviews: 3000, rating: 4.6, reviewsLast30d: 57 },
    { id: ID_B, name: "Beta", category: "plumbing", totalReviews: 4, rating: null, reviewsLast30d: 0 },
  ];

  function renderView(graph: { nodes: GraphNode[]; links: { source: string; target: string }[] }, enabled = false, rows: LookupBusiness[] = []) {
    return render(
      <TooltipProvider>
        <LookupView graph={graph} categories={CATEGORIES} categoryTitles={{ electronics_technology: "Electronics & Technology" }} discoveryEnabled={enabled}>
          <GridIsland rows={rows} total={rows.length} offset={0} filtered={false} />
        </LookupView>
      </TooltipProvider>,
    );
  }

  it("cards show lead status and add a lead in one click without opening the dossier", async () => {
    lookupActions.addToLeadsAction.mockResolvedValue({ ok: true, data: { created: true } });
    render(
      <TooltipProvider>
        <LookupView graph={{ nodes: [], links: [] }} categories={[]} categoryTitles={{}} discoveryEnabled leadBusinessIds={[ID_B]}>
          <GridIsland rows={[biz(), biz({ id: ID_B, name: "Beta Corp" })]} total={2} offset={0} filtered={false} />
        </LookupView>
      </TooltipProvider>,
    );
    const cards = screen.getAllByTestId("business-card");
    expect(within(cards[1]).getByTestId("lead-chip").textContent).toContain("In leads");
    await userEvent.click(within(cards[0]).getByRole("button", { name: "Add Acme Gadgets to leads" }));
    await waitFor(() => expect(lookupActions.addToLeadsAction).toHaveBeenCalledWith(ID_A));
    await waitFor(() => expect(within(screen.getAllByTestId("business-card")[0]).getByTestId("lead-chip")).toBeTruthy());
    expect(lookupActions.getDossierAction).not.toHaveBeenCalled();
    expect(toasts.success).toHaveBeenCalledWith("Lead added", expect.objectContaining({ description: "Acme Gadgets" }));
  });

  it("empty DB: graph and grid empty states with the discovery hint, no sample nodes", () => {
    renderView({ nodes: [], links: [] });
    const graph = screen.getByTestId("graph-empty");
    expect(graph.textContent).toContain("No businesses yet");
    expect(graph.textContent).toContain("Set FIRECRAWL_API_KEY to enable discovery");
    expect(screen.queryByTestId("category-bubbles")).toBeNull();
    expect(screen.getByTestId("grid-empty").textContent).toContain("No businesses yet");
    expect(screen.queryByTestId("pagination")).toBeNull();
    expect(document.querySelectorAll("circle[data-node-id]")).toHaveLength(0);
  });

  it("draws one circle per node colored by category, labels big nodes, opens the dossier on click and shows a tooltip on hover", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    renderView({ nodes, links: [{ source: ID_A, target: ID_B }] }, true, [biz()]);
    expect(screen.queryByText(/FIRECRAWL/)).toBeNull();
    const circles = document.querySelectorAll<SVGCircleElement>("circle[data-node-id]");
    expect(circles).toHaveLength(2);
    const a = document.querySelector<SVGCircleElement>(`circle[data-node-id="${ID_A}"]`)!;
    const b = document.querySelector<SVGCircleElement>(`circle[data-node-id="${ID_B}"]`)!;
    expect(a.getAttribute("fill")).not.toBe(b.getAttribute("fill"));
    expect(Number(a.getAttribute("r"))).toBe(30);
    expect(Number(b.getAttribute("r"))).toBe(6);
    const labels = [...document.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels).toEqual(["Acme Gadgets I..."]);
    expect(document.querySelectorAll("line")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Electronics & Technology/ })).toBeTruthy();

    fireEvent.mouseOver(a, { clientX: 100, clientY: 200 });
    const tip = await screen.findByRole("tooltip", { name: /Acme Gadgets International/ });
    expect(tip.textContent).toContain("3,000 reviews");
    expect(tip.textContent).toContain("4.6");
    fireEvent.mouseOut(a);
    await waitFor(() => expect(screen.queryByRole("tooltip", { name: /Acme Gadgets International/ })).toBeNull());

    fireEvent.click(a);
    expect(await screen.findByRole("heading", { name: "Acme Gadgets" })).toBeTruthy();
    expect(lookupActions.getDossierAction).toHaveBeenCalledWith(ID_A);
  });

  it("opens the dossier from a grid card", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: biz(), related: [] } });
    renderView({ nodes, links: [] }, true, [biz()]);
    await userEvent.click(screen.getByTestId("business-card"));
    expect(await screen.findByRole("heading", { name: "Acme Gadgets" })).toBeTruthy();
  });

  it("clicking a bubble writes category and resets offset", async () => {
    nav.qs = "offset=50&search=a";
    renderView({ nodes, links: [] });
    await userEvent.click(screen.getByRole("button", { name: /Plumbing/ }));
    expect(nav.push).toHaveBeenLastCalledWith("/lookup?search=a&category=plumbing", { scroll: false });
  });

  it("filters the graph to the selected category", () => {
    nav.qs = "category=plumbing";
    renderView({ nodes, links: [{ source: ID_A, target: ID_B }] });
    expect(document.querySelectorAll("circle[data-node-id]")).toHaveLength(1);
    expect(document.querySelectorAll("line")).toHaveLength(0);
  });

  it("375 px layout: panels stack and the network collapses behind a toggle", async () => {
    renderView({ nodes, links: [] });
    const view = screen.getByTestId("lookup-view");
    expect(view.className).toContain("flex-col");
    expect(view.className).toContain("lg:flex-row");
    expect(view.className).toContain("min-w-0");
    expect(screen.getByTestId("graph-panel").className).toContain("lg:w-[30%]");
    expect(screen.getByTestId("grid-panel").className).toContain("lg:flex-[5]");
    const body = document.getElementById("lookup-graph-body")!;
    expect(body.className).toContain("hidden");
    expect(body.className).toContain("lg:flex");
    const toggle = screen.getByRole("button", { name: "Show network" });
    expect(toggle.className).toContain("lg:hidden");
    await userEvent.click(toggle);
    expect(body.className).not.toMatch(/(^| )hidden( |$)/);
    expect(screen.getByRole("button", { name: "Hide network" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("pagination writes offset and keeps filters", async () => {
    nav.qs = "search=a";
    const rows = Array.from({ length: 50 }, (_, i) => biz({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Biz ${i}` }));
    render(
      <TooltipProvider>
        <LookupView graph={{ nodes: [], links: [] }} categories={[]} categoryTitles={{}} discoveryEnabled>
          <GridIsland rows={rows} total={120} offset={0} filtered />
        </LookupView>
      </TooltipProvider>,
    );
    expect(screen.getAllByTestId("business-card")).toHaveLength(50);
    expect(screen.getByText("1–50 of 120")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(nav.push).toHaveBeenLastCalledWith("/lookup?search=a&offset=50", { scroll: false });
  });
});
