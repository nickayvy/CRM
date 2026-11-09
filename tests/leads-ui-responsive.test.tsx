// @vitest-environment jsdom
// AC-15.5 (class-level proof until a signed-in browser check is possible):
// the lead table scrolls inside its own container and the filter and
// selection rows wrap at phone widths.
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeadRow } from "@/features/leads/types";

vi.mock("@/features/leads/actions", () => ({}));
const { LeadQueueTable } = await import("@/components/leads/lead-queue-table");

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.scrollIntoView ??= () => {};
});
afterEach(cleanup);

const row = (id: string, name: string): LeadRow => ({
  id,
  businessId: id,
  status: "queued",
  notes: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  name,
  phone: "+17135550100",
  website: null,
  email: null,
  category: "Plumbing",
  city: "Houston",
  rating: 4.5,
  reviews: 10,
  l30d: 3,
});

describe("LeadQueueTable at 375 px", () => {
  it("scrolls the table inside its container and wraps the filter and selection rows", async () => {
    render(
      <LeadQueueTable
        leads={[row("11111111-1111-4111-8111-111111111111", "Acme"), row("22222222-2222-4222-8222-222222222222", "Bayou")]}
        campaigns={{ call: [], email: [] }}
        onUpdateStatus={vi.fn()}
        onSaveNotes={vi.fn()}
        onRemove={vi.fn()}
        onBulkRemove={vi.fn(async () => true)}
        onAddToCampaign={vi.fn(async () => true)}
      />,
    );
    const table = screen.getByRole("table");
    // shadcn Table wraps the <table> in an overflow-x-auto container; the table keeps a min width.
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    expect(table.className).toContain("min-w-[960px]");
    expect(screen.getByTestId("lead-table-scroll").className).toContain("min-w-0");

    const filters = screen.getByTestId("lead-filters");
    expect(filters.className).toContain("flex-wrap");
    expect(filters.className).toContain("min-w-0");

    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Select all visible leads" }));
    const actions = screen.getByTestId("selection-actions");
    expect(actions.className).toContain("flex-wrap");
    // The reserved 280 px only applies from sm up, so it never forces overflow on phones.
    expect(actions.className).toContain("sm:min-w-[280px]");
    expect(actions.className.split(" ")).not.toContain("min-w-[280px]");
    expect(screen.getByRole("button", { name: /Add to call campaign/ })).toBeTruthy();
  });
});
