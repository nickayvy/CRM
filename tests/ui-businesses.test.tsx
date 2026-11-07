// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setHydratedForTests } from "@/lib/motion/hydration";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { BusinessRow } from "@/features/businesses/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/businesses",
  useSearchParams: () => new URLSearchParams(),
}));

// Keep server code and the DB out of the client component test.
vi.mock("@/features/businesses/actions", () => ({
  bulkUpdateStatusAction: vi.fn(async () => ({ ok: true, data: { updated: 0 } })),
  bulkAddTagAction: vi.fn(async () => ({ ok: true, data: { updated: 0 } })),
  bulkDoNotCallAction: vi.fn(async () => ({ ok: true, data: { updated: 0 } })),
}));

const { BusinessesTable } = await import("@/features/businesses/components/businesses-table");

// jsdom lacks a few browser APIs that Radix touches.
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

afterEach(() => {
  cleanup();
  setHydratedForTests(false);
  vi.useRealTimers();
});

const ID_QUALIFIED = "11111111-1111-4111-8111-111111111111";
const ID_REJECTED = "22222222-2222-4222-8222-222222222222";
const ID_SOFT = "33333333-3333-4333-8333-333333333333";

function makeRow(overrides: Partial<BusinessRow>): BusinessRow {
  return {
    id: ID_QUALIFIED,
    name: "Row",
    score: 50,
    qualification: "qualified",
    rejectionReasons: [],
    status: "new",
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    primaryCategory: "Plumbing",
    city: "Houston",
    state: "TX",
    rating: "4.5",
    reviewCount: 42,
    phone: "+17135550123",
    displayPhone: "(713) 555-0123",
    lastContactedAt: null,
    doNotCall: false,
    tags: [],
    ...overrides,
  };
}

const ROWS: BusinessRow[] = [
  makeRow({ id: ID_QUALIFIED, name: "Acme Plumbing", score: 82, qualification: "qualified", rejectionReasons: [] }),
  makeRow({
    id: ID_REJECTED,
    name: "Chain Pipes Franchise",
    score: 10,
    qualification: "rejected",
    rejectionReasons: ["chain", "low_rating"],
    phone: "+17135550999",
  }),
  makeRow({
    id: ID_SOFT,
    name: "Unclaimed Drains",
    score: 40,
    qualification: "review",
    rejectionReasons: ["unclaimed"],
    phone: null,
    displayPhone: null,
  }),
];

function renderTable(bulkActions?: React.ComponentProps<typeof BusinessesTable>["bulkActions"]) {
  return render(
    <TooltipProvider>
      <BusinessesTable rows={ROWS} total={ROWS.length} page={1} pageSize={25} sort={null} bulkActions={bulkActions} />
    </TooltipProvider>,
  );
}

describe("BusinessesTable", () => {
  it("renders every column header", () => {
    renderTable();
    for (const header of [
      "Name",
      "Score",
      "Qualification",
      "Status",
      "Category",
      "City",
      "Rating · reviews",
      "Phone",
      "Last contacted",
    ]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(`^${header}`) })).not.toBeNull();
    }
  });

  it("renders business names as links to their detail pages", () => {
    renderTable();
    expect(screen.getByRole("link", { name: "Acme Plumbing" }).getAttribute("href")).toEqual(`/businesses/${ID_QUALIFIED}`);
    expect(screen.getByRole("link", { name: "Chain Pipes Franchise" }).getAttribute("href")).toEqual(`/businesses/${ID_REJECTED}`);
    expect(screen.getByRole("link", { name: "Unclaimed Drains" }).getAttribute("href")).toEqual(`/businesses/${ID_SOFT}`);
  });

  it("renders reason chips with their explanations as accessible names", () => {
    renderTable();
    expect(screen.getByText("chain")).not.toBeNull();
    expect(screen.getByText("low_rating")).not.toBeNull();
    expect(screen.getByText("unclaimed")).not.toBeNull();
    expect(screen.getByText("chain").getAttribute("aria-label")).toEqual(expect.stringContaining("Matches a known chain or franchise name"));

    // The qualified row has no reason chips; the rejected row has two; the soft row has one.
    const cells = screen.getAllByTestId("qualification-cell");
    expect(cells).toHaveLength(3);
    expect(cells[0].querySelectorAll('[data-slot="reason-chip"]')).toHaveLength(0);
    expect(cells[1].querySelectorAll('[data-slot="reason-chip"]')).toHaveLength(2);
    expect(cells[2].querySelectorAll('[data-slot="reason-chip"]')).toHaveLength(1);
    // Hard rejections are danger-toned, soft flags are warning-toned.
    expect(screen.getByText("chain").getAttribute("data-tone")).toEqual("danger");
    expect(screen.getByText("unclaimed").getAttribute("data-tone")).toEqual("warning");
  });

  it("renders the phone formatted inside a tel: link", () => {
    renderTable();
    const link = screen.getByRole("link", { name: "(713) 555-0123" });
    expect(link.getAttribute("href")).toEqual("tel:+17135550123");
  });

  it("shows the bulk bar with built-in and extra actions once a row is selected", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderTable([{ label: "Add to campaign", onSelect }]);

    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();

    const rowEl = screen.getByRole("link", { name: "Chain Pipes Franchise" }).closest("tr");
    expect(rowEl).not.toBeNull();
    await user.click(within(rowEl as HTMLElement).getByRole("checkbox", { name: "Select row" }));

    const bar = await screen.findByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("1 selected")).not.toBeNull();
    expect(within(bar).getByRole("button", { name: /Set status…/ })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: /Add tag…/ })).not.toBeNull();
    expect(within(bar).getByRole("button", { name: /Mark do-not-call/ })).not.toBeNull();

    await user.click(within(bar).getByRole("button", { name: /Add to campaign/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith([ID_REJECTED]);
  });
});
