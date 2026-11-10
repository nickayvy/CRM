// @vitest-environment jsdom
// WP-20 component tests: the Google form (AC-20.4), the Google job page
// (AC-20.5, AC-20.12 Run again on a failed job) and the Lookup additions (AC-20.6).
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { GooglePreview } from "@/features/google/server-actions";
import type { LookupBusiness } from "@/features/lookup/types";
import type { SearchJobJson } from "@/features/searches/format";
import { NICHES } from "@/lib/google-places/niches";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/lookup",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

const google = vi.hoisted(() => ({
  previewGoogleSearchAction: vi.fn(),
  startGoogleSearchAction: vi.fn(),
  continueGoogleSearchAction: vi.fn(),
  rerunGoogleSearchAction: vi.fn(),
}));
vi.mock("@/features/google/server-actions", () => google);

const discovery = vi.hoisted(() => ({ scrapeUrlAction: vi.fn(), seedCategoryAction: vi.fn(), enrichTrustpilotAction: vi.fn() }));
vi.mock("@/features/discovery/actions", () => ({ ...discovery, discoveryConfigured: () => true }));
const lookupActions = vi.hoisted(() => ({
  addToLeadsAction: vi.fn(),
  getDossierAction: vi.fn(),
  createCallCampaignAction: vi.fn(),
  queueBusinessForCallsAction: vi.fn(),
  deleteBusinessFromLookupAction: vi.fn(),
}));
vi.mock("@/features/lookup/actions", () => lookupActions);

const { GoogleSearchForm, planLine } = await import("@/features/google/components/google-search-form");
const { GoogleJobProgress } = await import("@/features/google/components/google-job-progress");
const { AUTO_CONTINUE_INTERVAL_MS, isCapPause } = await import("@/features/google/job-status");
const { capMessage, RATE_LIMIT_MESSAGE } = await import("@/features/google/run");
const { FilterPanel } = await import("@/components/lookup/filter-panel");
const { ManualScrapeInput } = await import("@/components/lookup/manual-scrape-input");
const { BusinessCard } = await import("@/components/lookup/business-card");
const { DossierModal } = await import("@/components/lookup/dossier-modal");

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
  for (const f of [...Object.values(toasts), ...Object.values(google), ...Object.values(discovery), ...Object.values(lookupActions)])
    f.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ------------------------------------------------------------ form

function previewOk(over: Partial<GooglePreview["preview"]> = {}, usedThisMonth = 108, cap = 1000): GooglePreview {
  return {
    preview: {
      location: "Dallas, TX",
      term: "Roofing",
      queries: 36,
      maxRequests: 108,
      estMaxUsd: 3.78,
      terms: ["roofer", "roofing contractor", "roofing company"],
      zipCount: 12,
      areaLabel: "Dallas, TX",
      ...over,
    },
    usedThisMonth,
    cap,
  };
}

const startButton = () => screen.getByRole("button", { name: "Start Google search" }) as HTMLButtonElement;

describe("AC-20.4 Google form", () => {
  it("choosing a niche fills the terms", async () => {
    render(<GoogleSearchForm />);
    const terms = screen.getByLabelText("Search terms") as HTMLInputElement;
    expect(terms.value).toBe("roofer, roofing contractor, roofing company");
    await userEvent.click(screen.getByRole("combobox", { name: "Niche" }));
    const plumbing = NICHES.find((n) => n.id === "plumbing")!;
    await userEvent.click(screen.getByRole("option", { name: plumbing.label }));
    expect(terms.value).toBe(plumbing.terms.join(", "));
    // Without an area there is no preview call and start is disabled with a reason.
    expect(google.previewGoogleSearchAction).not.toHaveBeenCalled();
    expect(startButton().disabled).toBe(true);
    expect(screen.getByTestId("google-plan-reason").textContent).toMatch(/Enter an area/);
    // The area field explains the three accepted forms.
    expect(screen.getByText(/Zip codes \("75201, 75202"\), a city \("Dallas, TX"\), or a zip and a radius/)).toBeTruthy();
  });

  it("shows searches, requests, cost and requests left from the preview, and enables start", async () => {
    google.previewGoogleSearchAction.mockResolvedValue({ ok: true, data: previewOk() });
    render(<GoogleSearchForm />);
    await userEvent.type(screen.getByLabelText("Area"), "Dallas, TX");
    const line = await screen.findByTestId("google-plan-line", {}, { timeout: 2000 });
    expect(line.textContent).toBe(
      "3 terms × 12 zips = 36 searches · up to 108 requests · about $3.78 at most · 892 of 1,000 requests left this month",
    );
    expect(startButton().disabled).toBe(false);
    expect(screen.queryByTestId("google-plan-reason")).toBeNull();
    // Debounced: one call for the final text, not one per keystroke.
    expect(google.previewGoogleSearchAction).toHaveBeenCalledTimes(1);
    expect(google.previewGoogleSearchAction).toHaveBeenCalledWith({
      nicheId: "roofing",
      terms: ["roofer", "roofing contractor", "roofing company"],
      area: "Dallas, TX",
      maxPagesPerQuery: 3,
    });
  });

  it("disables start and explains when the plan needs more requests than are left", async () => {
    google.previewGoogleSearchAction.mockResolvedValue({ ok: true, data: previewOk({}, 950, 1000) });
    render(<GoogleSearchForm />);
    await userEvent.type(screen.getByLabelText("Area"), "Dallas, TX");
    const reason = await screen.findByTestId("google-plan-reason", {}, { timeout: 2000 });
    await waitFor(() => expect(reason.textContent).toMatch(/up to 108 requests, but only 50 are left this month/));
    expect(screen.getByTestId("google-plan-line").textContent).toContain("50 of 1,000 requests left this month");
    expect(startButton().disabled).toBe(true);
  });

  it("disables start and explains when the month is at the cap", async () => {
    google.previewGoogleSearchAction.mockResolvedValue({ ok: true, data: previewOk({}, 1000, 1000) });
    render(<GoogleSearchForm />);
    await userEvent.type(screen.getByLabelText("Area"), "75201");
    await waitFor(() => expect(screen.getByTestId("google-plan-reason").textContent).toMatch(/cap of 1,000 Google requests is used up/), {
      timeout: 2000,
    });
    expect(startButton().disabled).toBe(true);
  });

  it("disables start and shows the limit when the preview is over a limit", async () => {
    const message = "348 zip codes is over the limit of 200 per job; use a smaller area.";
    google.previewGoogleSearchAction.mockResolvedValue({ ok: false, message: "Please fix", fieldErrors: { area: [message] } });
    render(<GoogleSearchForm />);
    await userEvent.type(screen.getByLabelText("Area"), "75201 +60mi");
    await waitFor(() => expect(screen.getByTestId("google-plan-reason").textContent).toBe(message), { timeout: 2000 });
    expect(startButton().disabled).toBe(true);
    // The same message sits under the area field.
    expect(screen.getAllByText(message).length).toBeGreaterThanOrEqual(2);
  });

  it("submits the fields to the start action and opens the job", async () => {
    google.previewGoogleSearchAction.mockResolvedValue({ ok: true, data: previewOk() });
    google.startGoogleSearchAction.mockResolvedValue({ ok: true, data: { jobId: "job-1" } });
    render(<GoogleSearchForm />);
    await userEvent.type(screen.getByLabelText("Area"), "Dallas, TX");
    await waitFor(() => expect(startButton().disabled).toBe(false), { timeout: 2000 });
    await userEvent.click(startButton());
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/searches/job-1"));
    const fd = google.startGoogleSearchAction.mock.calls[0][1] as FormData;
    expect(Object.fromEntries(fd.entries())).toEqual({
      nicheId: "roofing",
      maxPagesPerQuery: "3",
      terms: "roofer, roofing contractor, roofing company",
      area: "Dallas, TX",
    });
  });

  it("planLine pluralises single values", () => {
    expect(planLine(previewOk({ terms: ["roofer"], zipCount: 1, queries: 1, maxRequests: 1, estMaxUsd: 0.04 }, 0, 1000))).toBe(
      "1 term × 1 zip = 1 search · up to 1 request · about $0.04 at most · 1,000 of 1,000 requests left this month",
    );
  });
});

// ------------------------------------------------------------ job page

const JOB_ID = "33333333-3333-4333-8333-333333333333";

function job(over: Partial<SearchJobJson> = {}): SearchJobJson {
  return {
    id: JOB_ID,
    term: "Roofing",
    location: "Dallas, TX",
    categoryAliases: ["roofing_contractor"],
    radiusM: 20000,
    maxResults: 200,
    status: "running",
    fetchedCount: 41,
    qualifiedCount: 12,
    reviewCount: 9,
    rejectedCount: 20,
    apiCalls: 48,
    error: null,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    finishedAt: null,
    createdAt: new Date(Date.now() - 61_000).toISOString(),
    source: "google",
    plan: {
      nicheId: "roofing",
      terms: ["roofer", "roofing contractor", "roofing company"],
      zips: Array.from({ length: 12 }, (_, i) => String(75201 + i)),
      areaLabel: "Dallas, TX",
      acceptTypes: ["roofing_contractor", "general_contractor"],
      maxPagesPerQuery: 3,
      saturated: [
        { term: "roofer", zip: "75201" },
        { term: "roofer", zip: "75202" },
      ],
      errors: [{ term: "roofing company", zip: "75203", message: "Google Places 500 INTERNAL" }],
    },
    queriesTotal: 36,
    queriesDone: 14,
    newCount: 30,
    matchedCount: 3,
    leaseExpiresAt: null,
    ...over,
  };
}

/** Polling answers with `current()`; returns the fetch spy. */
function stubPolling(current: () => SearchJobJson) {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(current()), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("AC-20.5 Google job page", () => {
  it("a running job shows N of M searches, the counts, requests and cost, saturated and skipped searches", () => {
    stubPolling(() => job({ leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }));
    render(<GoogleJobProgress initial={job({ leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() })} pricePer1000={35} />);
    expect(screen.getByText("14 of 36 searches")).toBeTruthy();
    const root = screen.getByTestId("google-job-progress");
    for (const label of ["New", "Matched", "Qualified", "Review", "Rejected"]) expect(within(root).getByText(label)).toBeTruthy();
    expect(within(root).getByText("48 of up to 108")).toBeTruthy();
    expect(within(root).getByText("about $1.68")).toBeTruthy();
    expect(screen.getByTestId("saturated").textContent).toMatch(/2 saturated searches — these returned the full 60; more may exist, try narrower terms/);
    expect(screen.getByTestId("skipped").textContent).toMatch(/1 skipped search/);
    expect(screen.getByRole("link", { name: /Open Google businesses in Lookup/ }).getAttribute("href")).toBe("/lookup?source=google");
    // A live lease: a slice runs now, so Continue is disabled and nothing is auto-continued.
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(google.continueGoogleSearchAction).not.toHaveBeenCalled();
  });

  it("a running job with an error shows the pause message", () => {
    stubPolling(() => job({ error: RATE_LIMIT_MESSAGE }));
    google.continueGoogleSearchAction.mockResolvedValue({ ok: true, data: { outcome: "queued" } });
    render(<GoogleJobProgress initial={job({ error: RATE_LIMIT_MESSAGE })} pricePer1000={35} />);
    expect(screen.getByTestId("pause-reason").textContent).toBe(RATE_LIMIT_MESSAGE);
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("a cap pause does not auto-continue", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    const capped = job({ error: capMessage(1000) });
    expect(isCapPause(capped.error)).toBe(true);
    stubPolling(() => capped);
    render(<GoogleJobProgress initial={capped} pricePer1000={35} />);
    expect(screen.getByTestId("pause-reason").textContent).toBe(capMessage(1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CONTINUE_INTERVAL_MS * 3);
    });
    expect(google.continueGoogleSearchAction).not.toHaveBeenCalled();
    // The button still lets the user try (e.g. after raising the cap).
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an idle running job triggers one continue call and not a second inside 20 s, then one more after", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date"] });
    google.continueGoogleSearchAction.mockResolvedValue({ ok: true, data: { outcome: "queued" } });
    const idle = job({ leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
    stubPolling(() => idle);
    render(<GoogleJobProgress initial={idle} pricePer1000={35} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(google.continueGoogleSearchAction).toHaveBeenCalledTimes(1);
    expect(google.continueGoogleSearchAction).toHaveBeenCalledWith(JOB_ID);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_CONTINUE_INTERVAL_MS - 1000);
    });
    expect(google.continueGoogleSearchAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(google.continueGoogleSearchAction).toHaveBeenCalledTimes(2);
  });

  it("a completed job shows Run again, which opens the new job", async () => {
    const done = job({ status: "completed", queriesDone: 36, finishedAt: new Date().toISOString() });
    stubPolling(() => done);
    google.rerunGoogleSearchAction.mockResolvedValue({ ok: true, data: { jobId: "job-2" } });
    render(<GoogleJobProgress initial={done} pricePer1000={35} />);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/searches/job-2"));
    expect(google.rerunGoogleSearchAction).toHaveBeenCalledWith(JOB_ID);
    expect(google.continueGoogleSearchAction).not.toHaveBeenCalled();
  });

  it("AC-20.12 a failed job shows its error and Run again", () => {
    const failed = job({ status: "failed", error: "connection terminated", finishedAt: new Date().toISOString() });
    stubPolling(() => failed);
    render(<GoogleJobProgress initial={failed} pricePer1000={35} />);
    expect(screen.getByRole("alert").textContent).toContain("connection terminated");
    expect(screen.getByRole("button", { name: "Run again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

// ------------------------------------------------------------ lookup

function googleRow(over: Partial<LookupBusiness> = {}): LookupBusiness {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    source: "google",
    name: "Best Roofing",
    slug: "bestroofing.com",
    trustpilotId: null,
    website: "https://bestroofing.com",
    phone: "+12145550101",
    email: null,
    logoUrl: null,
    imageUrl: null,
    socialLinks: {},
    category: "home_services",
    categoryTitle: "Home Services",
    subcategory: "Roofing Contractor",
    city: "Dallas",
    country: "US",
    rating: 4.7,
    reviewCount: 88,
    reviewsLast30d: 3,
    aiSummary: null,
    hasMetaAds: false,
    yelpUrl: null,
    googleMapsUrl: "https://maps.google.com/?cid=12345",
    address: "1 Elm St, Dallas, TX 75201",
    qualification: "qualified",
    rejectionReasons: [],
    lastSyncedAt: new Date().toISOString(),
    ...over,
  };
}

describe("AC-20.6 Lookup", () => {
  it("the source filter lists Google and sets source=google", async () => {
    render(<FilterPanel categories={[]} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Source" }));
    await userEvent.click(screen.getByRole("option", { name: "Google" }));
    expect(nav.push.mock.calls.at(-1)?.[0]).toBe("/lookup?source=google");
  });

  it("a Google row's card shows the Google badge, the address and a Maps link", () => {
    render(<BusinessCard business={googleRow()} onSelect={() => {}} />);
    const card = screen.getByTestId("business-card");
    expect(card.querySelector('[data-source="google"]')?.textContent).toBe("Google");
    expect(screen.getByTestId("card-address").textContent).toBe("1 Elm St, Dallas, TX 75201");
    expect(screen.getByRole("link", { name: "Open Best Roofing on Google Maps" }).getAttribute("href")).toBe(
      "https://maps.google.com/?cid=12345",
    );
  });

  it("its dossier has a Google Maps link to the row's googleMapsUrl and shows the address; Refresh links reads the website", async () => {
    lookupActions.getDossierAction.mockResolvedValue({ ok: true, data: { business: googleRow(), related: [] } });
    discovery.enrichTrustpilotAction.mockResolvedValue({ ok: true, data: {} });
    render(
      <TooltipProvider>
        <DossierModal businessId={googleRow().id} onClose={() => {}} />
      </TooltipProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("heading", { name: "Best Roofing" });
    const tiles = within(dialog).getAllByTestId("link-tile");
    const maps = tiles.find((t) => t.querySelector("p")!.textContent === "GOOGLE MAPS")!;
    expect(maps.querySelector("a")!.getAttribute("href")).toBe("https://maps.google.com/?cid=12345");
    expect(within(dialog).getByRole("link", { name: "Google Maps" }).getAttribute("href")).toBe("https://maps.google.com/?cid=12345");
    expect(within(dialog).getByTestId("dossier-address").textContent).toBe("1 Elm St, Dallas, TX 75201");
    expect(within(dialog).getByText("Google")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Refresh links" }));
    await waitFor(() => expect(discovery.enrichTrustpilotAction).toHaveBeenCalledWith(googleRow().id));
    await waitFor(() => expect(lookupActions.getDossierAction).toHaveBeenCalledTimes(2));
    expect(toasts.success).toHaveBeenCalledWith("Links refreshed", expect.anything());
  });

  it("the discovery strip has the Google Maps button and the Search history link, even without Firecrawl", () => {
    render(<ManualScrapeInput enabled={false} />);
    expect(screen.getByRole("link", { name: "Google Maps" }).getAttribute("href")).toBe("/searches/new?source=google");
    expect(screen.getByRole("link", { name: "Search history" }).getAttribute("href")).toBe("/searches");
  });
});
