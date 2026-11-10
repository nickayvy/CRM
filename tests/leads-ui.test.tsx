// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CallHistoryRow, CampaignTarget, LeadMetricsData, LeadRow } from "@/features/leads/types";
import { buildLeadsCsv } from "@/features/leads/csv";
import { escapeCsv, toCsv } from "@/lib/export-csv";

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep server code and the DB out of the client component test.
vi.mock("@/features/leads/actions", () => ({
  updateLeadAction: vi.fn(),
  removeLeadAction: vi.fn(),
  bulkRemoveLeadsAction: vi.fn(),
  addLeadsToCallCampaignAction: vi.fn(),
  addLeadsToEmailCampaignAction: vi.fn(),
}));

const actions = await import("@/features/leads/actions");
const { toast } = await import("sonner");
const { LeadQueueTable } = await import("@/components/leads/lead-queue-table");
const { LeadsPanel } = await import("@/components/leads/leads-panel");
const { StatusBadge } = await import("@/components/leads/status-badge");
const { LeadMetrics } = await import("@/components/leads/lead-metrics");
const { CallHistoryTable } = await import("@/components/leads/call-history-table");

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";
const ID_D = "44444444-4444-4444-8444-444444444444";
const ID_E = "55555555-5555-4555-8555-555555555555";

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: ID_A,
    businessId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    status: "queued",
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    name: "Acme Plumbing",
    phone: "+17135550101",
    website: "https://acme.example",
    email: null,
    category: "Plumbing",
    city: "Houston",
    rating: 4.5,
    reviews: 42,
    l30d: 3,
    ...overrides,
  };
}

const LEADS: LeadRow[] = [
  makeLead({ id: ID_A, name: "Acme Plumbing", status: "queued", phone: "+17135550101", category: "Plumbing", rating: 4.5, l30d: 3 }),
  makeLead({ id: ID_B, name: "Bayou Electric", status: "contacted", phone: "+17135550202", category: "Electrical", rating: 4, l30d: 0 }),
  makeLead({ id: ID_C, name: "Citrus HVAC", status: "callback", phone: "+12815550303", category: "HVAC", rating: 3.2, l30d: 7 }),
  makeLead({ id: ID_D, name: "Delta Roofing", status: "success", phone: "+17135550404", category: "Plumbing", rating: 5, l30d: 1 }),
  makeLead({ id: ID_E, name: "Echo Drains", status: "failed", phone: null, category: null, rating: null, l30d: 0 }),
];

const CALL_CAMPAIGNS: CampaignTarget[] = [
  { id: "c0000000-0000-4000-8000-000000000001", name: "Spring Blitz", status: "running" },
  { id: "c0000000-0000-4000-8000-000000000002", name: "Fall Push", status: "draft" },
];
const EMAIL_CAMPAIGNS: CampaignTarget[] = [
  { id: "e0000000-0000-4000-8000-000000000001", name: "Intro Sequence", status: "paused" },
  { id: "e0000000-0000-4000-8000-000000000002", name: "Winback", status: "running" },
];
const CAMPAIGNS = { call: CALL_CAMPAIGNS, email: EMAIL_CAMPAIGNS };

function rowOf(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`tr[data-lead-id="${id}"]`);
  if (!el) throw new Error(`No row for lead ${id}`);
  return el;
}

function visibleIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>("tr[data-lead-id]")].map((r) => r.dataset.leadId as string);
}

type TableProps = React.ComponentProps<typeof LeadQueueTable>;

function renderTable(overrides: Partial<TableProps> = {}) {
  const props: TableProps = {
    leads: LEADS,
    campaigns: CAMPAIGNS,
    onUpdateStatus: vi.fn(),
    onSaveNotes: vi.fn(),
    onRemove: vi.fn(),
    onBulkRemove: vi.fn(async () => true),
    onAddToCampaign: vi.fn(async () => true),
    onExport: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <LeadQueueTable {...props} />
    </TooltipProvider>,
  );
  return props;
}

async function pickOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionName: string) {
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("LeadQueueTable rendering", () => {
  it("renders one row per lead with phone, name, category, status badge, rating and L30D", () => {
    renderTable();
    expect(visibleIds()).toEqual([ID_A, ID_B, ID_C, ID_D, ID_E]);

    const a = within(rowOf(ID_A));
    expect(a.getByText("(713) 555-0101")).not.toBeNull();
    expect(a.getByText("Acme Plumbing")).not.toBeNull();
    expect(a.getByText("Plumbing")).not.toBeNull();
    expect(rowOf(ID_A).querySelector('[data-status="queued"]')?.textContent).toEqual("Queued");
    expect(a.getByText("4.5")).not.toBeNull();
    expect(a.getByText("3")).not.toBeNull();

    // Whole-number rating is shown with a decimal.
    expect(within(rowOf(ID_B)).getByText("4.0")).not.toBeNull();
    expect(rowOf(ID_C).querySelector('[data-status="callback"]')?.textContent).toEqual("Callback");
    expect(rowOf(ID_D).querySelector('[data-status="success"]')?.textContent).toEqual("Success");

    // Missing phone / category / rating degrade gracefully.
    const e = within(rowOf(ID_E));
    expect(e.getByText("No phone")).not.toBeNull();
    expect(e.getAllByText("—")).toHaveLength(2); // category + rating
    expect(rowOf(ID_E).querySelector('[data-status="failed"]')?.textContent).toEqual("Failed");
  });

  it("shows the lead count with correct pluralization", () => {
    renderTable();
    expect(screen.getByTestId("lead-count").textContent).toEqual("5 leads");
  });

  it("uses the singular for one lead", () => {
    renderTable({ leads: [LEADS[0]] });
    expect(screen.getByTestId("lead-count").textContent).toEqual("1 lead");
  });
});

describe("LeadQueueTable filtering", () => {
  it("filters rows by status tab (Contacted also shows callback)", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole("tab", { name: "Queued" }));
    expect(visibleIds()).toEqual([ID_A]);
    expect(screen.getByTestId("lead-count").textContent).toEqual("1 lead");

    await user.click(screen.getByRole("tab", { name: "Contacted" }));
    expect(visibleIds()).toEqual([ID_B, ID_C]);
    expect(screen.getByTestId("lead-count").textContent).toEqual("2 leads");

    await user.click(screen.getByRole("tab", { name: "Success" }));
    expect(visibleIds()).toEqual([ID_D]);

    await user.click(screen.getByRole("tab", { name: "Failed" }));
    expect(visibleIds()).toEqual([ID_E]);

    await user.click(screen.getByRole("tab", { name: "All" }));
    expect(visibleIds()).toHaveLength(5);
  });

  it("filters by name search (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByRole("searchbox", { name: "Search leads" }), "bayou");
    expect(visibleIds()).toEqual([ID_B]);
  });

  it("filters by phone digits regardless of formatting", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByRole("searchbox", { name: "Search leads" }), "(281) 555");
    expect(visibleIds()).toEqual([ID_C]);
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.type(screen.getByRole("searchbox", { name: "Search leads" }), "zzzz");
    expect(visibleIds()).toEqual([]);
    expect(screen.getByText("No leads match this filter")).not.toBeNull();
    expect(screen.getByTestId("lead-count").textContent).toEqual("0 leads");
    expect((screen.getByRole("button", { name: /Export CSV/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the category select only when there is more than one distinct category, and filters by it", async () => {
    const user = userEvent.setup();
    renderTable();
    await pickOption(user, screen.getByRole("combobox", { name: "Filter by category" }), "Plumbing");
    expect(visibleIds()).toEqual([ID_A, ID_D]);

    // Combines with the status tab.
    await user.click(screen.getByRole("tab", { name: "Success" }));
    expect(visibleIds()).toEqual([ID_D]);

    await user.click(screen.getByRole("tab", { name: "All" }));
    await pickOption(user, screen.getByRole("combobox", { name: "Filter by category" }), "All categories");
    expect(visibleIds()).toHaveLength(5);
  });

  it("hides the category select with a single category", () => {
    renderTable({ leads: [LEADS[0], LEADS[3], LEADS[4]] }); // Plumbing, Plumbing, none
    expect(screen.queryByRole("combobox", { name: "Filter by category" })).toBeNull();
  });

  it("hides the category select with no categories", () => {
    renderTable({ leads: [LEADS[4]] });
    expect(screen.queryByRole("combobox", { name: "Filter by category" })).toBeNull();
  });
});

describe("LeadQueueTable selection", () => {
  it("shows selection actions only when something is selected", async () => {
    const user = userEvent.setup();
    renderTable();
    expect(screen.queryByRole("button", { name: /Add to call campaign/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to email sequence/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove$/ })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    expect(screen.getByText("1 selected")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Add to call campaign…/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Add to email sequence…/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Remove$/ })).not.toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    expect(screen.queryByRole("button", { name: /Add to call campaign/ })).toBeNull();
  });

  it("select-all selects every visible row only", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("tab", { name: "Contacted" }));
    await user.click(screen.getByRole("checkbox", { name: "Select all visible leads" }));

    expect(screen.getByText("2 selected")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select Bayou Electric" }).getAttribute("aria-checked")).toEqual("true");
    expect(screen.getByRole("checkbox", { name: "Select Citrus HVAC" }).getAttribute("aria-checked")).toEqual("true");

    // Toggling again clears.
    await user.click(screen.getByRole("checkbox", { name: "Select all visible leads" }));
    expect(screen.queryByText("2 selected")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to call campaign/ })).toBeNull();
  });

  it("select-all on All selects all rows", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("checkbox", { name: "Select all visible leads" }));
    expect(screen.getByText("5 selected")).not.toBeNull();
  });

  it("Remove calls onBulkRemove with the selected ids and clears the selection on success", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Delta Roofing" }));
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));

    expect(props.onBulkRemove).toHaveBeenCalledWith([ID_A, ID_D]);
    await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
  });
});

describe("LeadQueueTable add to campaign", () => {
  it("adds the selected leads to a chosen call campaign", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Citrus HVAC" }));
    await user.click(screen.getByRole("button", { name: /Add to call campaign…/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add to call campaign" })).not.toBeNull();
    expect(within(dialog).getByText(/2 selected leads/)).not.toBeNull();
    expect(within(dialog).getByRole("radio", { name: /Spring Blitz/ })).not.toBeNull();
    expect(within(dialog).getByRole("radio", { name: /Fall Push/ })).not.toBeNull();
    expect(within(dialog).queryByRole("radio", { name: /Intro Sequence/ })).toBeNull();

    // Nothing chosen yet: submit is disabled.
    const submit = within(dialog).getByRole("button", { name: "Add to queue" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.click(within(dialog).getByRole("radio", { name: /Fall Push/ }));
    expect(submit.disabled).toBe(false);
    await user.click(submit);

    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledTimes(1));
    expect(props.onAddToCampaign).toHaveBeenCalledWith("call", CALL_CAMPAIGNS[1].id, [ID_A, ID_C]);
    // Dialog closes and the selection clears on success.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("enrolls the selected leads in a chosen email sequence", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole("checkbox", { name: "Select Bayou Electric" }));
    await user.click(screen.getByRole("button", { name: /Add to email sequence…/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Add to email sequence" })).not.toBeNull();
    expect(within(dialog).getByText(/1 selected lead\./)).not.toBeNull();
    expect(within(dialog).getByRole("radio", { name: /Intro Sequence/ })).not.toBeNull();
    expect(within(dialog).queryByRole("radio", { name: /Spring Blitz/ })).toBeNull();

    await user.click(within(dialog).getByRole("radio", { name: /Winback/ }));
    await user.click(within(dialog).getByRole("button", { name: "Enroll" }));

    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledTimes(1));
    expect(props.onAddToCampaign).toHaveBeenCalledWith("email", EMAIL_CAMPAIGNS[1].id, [ID_B]);
  });

  it("keeps the dialog open and the selection when the add fails", async () => {
    const user = userEvent.setup();
    const props = renderTable({ onAddToCampaign: vi.fn(async () => false) });
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    await user.click(screen.getByRole("button", { name: /Add to call campaign…/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: /Spring Blitz/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add to queue" }));

    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(screen.getByText("1 selected")).not.toBeNull();
  });

  it("preselects the only campaign and links to create one when there are none", async () => {
    const user = userEvent.setup();
    const props = renderTable({ campaigns: { call: [CALL_CAMPAIGNS[0]], email: [] } });
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));

    await user.click(screen.getByRole("button", { name: /Add to call campaign…/ }));
    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: /Spring Blitz/ }).getAttribute("aria-checked")).toEqual("true");
    await user.click(within(dialog).getByRole("button", { name: "Add to queue" }));
    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledWith("call", CALL_CAMPAIGNS[0].id, [ID_A]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The first add succeeded, which cleared the selection; select again.
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    await user.click(screen.getByRole("button", { name: /Add to email sequence…/ }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Create one" }).getAttribute("href")).toEqual("/email/new");
    expect((within(dialog).getByRole("button", { name: "Enroll" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("LeadQueueTable row actions", () => {
  it("Skip calls onUpdateStatus(id, 'skipped')", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(within(rowOf(ID_B)).getByRole("button", { name: "Skip Bayou Electric" }));
    expect(props.onUpdateStatus).toHaveBeenCalledTimes(1);
    expect(props.onUpdateStatus).toHaveBeenCalledWith(ID_B, "skipped");
  });

  it("a row's phone button opens the call-campaign dialog for that one lead, with no selection needed", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(within(rowOf(ID_B)).getByRole("button", { name: "Add Bayou Electric to a call campaign" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Bayou Electric\./)).not.toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: /Spring Blitz/ }));
    await user.click(within(dialog).getByRole("button", { name: "Add to queue" }));
    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledWith("call", CALL_CAMPAIGNS[0].id, [ID_B]));
  });

  it("the row call action is disabled for a lead without a phone", () => {
    renderTable({ leads: [makeLead({ id: ID_A, name: "Acme Plumbing", phone: null })] });
    expect((screen.getByRole("button", { name: "Add Acme Plumbing to a call campaign" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the call campaigns a lead is queued in, linked to each campaign", () => {
    renderTable({ leads: [makeLead({ id: ID_A, name: "Acme Plumbing", callCampaigns: [{ id: ID_E, name: "Spring Blitz" }] })] });
    const link = within(rowOf(ID_A)).getByRole("link", { name: "Spring Blitz" });
    expect(link.getAttribute("href")).toEqual(`/calling/${ID_E}`);
  });

  it("with no call campaigns, one can be named and created in the dialog instead of leaving the page", async () => {
    const user = userEvent.setup();
    const onCreateCallCampaign = vi.fn().mockResolvedValue(ID_E);
    const props = renderTable({ campaigns: { call: [], email: [] }, onCreateCallCampaign });
    await user.click(screen.getByRole("checkbox", { name: "Select Acme Plumbing" }));
    await user.click(screen.getByRole("button", { name: /Add to call campaign…/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: "Create one" })).toBeNull();
    const submit = within(dialog).getByRole("button", { name: "Create and add" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText("New campaign name"), "Roofers");
    await user.click(submit);
    await waitFor(() => expect(props.onAddToCampaign).toHaveBeenCalledWith("call", ID_E, [ID_A]));
    expect(onCreateCallCampaign).toHaveBeenCalledWith("Roofers");
  });

  it("disables Skip for an already skipped lead", () => {
    renderTable({ leads: [makeLead({ id: ID_A, status: "skipped" })] });
    expect((screen.getByRole("button", { name: "Skip Acme Plumbing" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Remove calls onRemove(id)", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(within(rowOf(ID_C)).getByRole("button", { name: "Remove Citrus HVAC" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onRemove).toHaveBeenCalledWith(ID_C);
  });

  it("changing the status select calls onUpdateStatus(id, newStatus)", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await pickOption(user, screen.getByRole("combobox", { name: "Status for Acme Plumbing" }), "Success");
    expect(props.onUpdateStatus).toHaveBeenCalledTimes(1);
    expect(props.onUpdateStatus).toHaveBeenCalledWith(ID_A, "success");
  });

  it("picking the current status does not call onUpdateStatus", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await pickOption(user, screen.getByRole("combobox", { name: "Status for Acme Plumbing" }), "Queued");
    expect(props.onUpdateStatus).not.toHaveBeenCalled();
  });
});

describe("LeadQueueTable notes", () => {
  it("saves typed text on blur", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.type(screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }), "call back friday");
    expect(props.onSaveNotes).not.toHaveBeenCalled();
    await user.tab();
    expect(props.onSaveNotes).toHaveBeenCalledTimes(1);
    expect(props.onSaveNotes).toHaveBeenCalledWith(ID_A, "call back friday");
  });

  it("saves on Enter", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.type(screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }), "hello{Enter}");
    expect(props.onSaveNotes).toHaveBeenCalledTimes(1);
    expect(props.onSaveNotes).toHaveBeenCalledWith(ID_A, "hello");
  });

  it("trims whitespace before saving", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.type(screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }), "  padded  {Enter}");
    expect(props.onSaveNotes).toHaveBeenCalledWith(ID_A, "padded");
  });

  it("Escape reverts the value and does not save", async () => {
    const user = userEvent.setup();
    const props = renderTable({ leads: [makeLead({ notes: "original" })] });
    const input = screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "changed");
    await user.keyboard("{Escape}");
    expect(props.onSaveNotes).not.toHaveBeenCalled();
    expect(input.value).toEqual("original");
    // A later unchanged blur still does not save.
    await user.click(input);
    await user.tab();
    expect(props.onSaveNotes).not.toHaveBeenCalled();
  });

  it("does not save when the value is unchanged", async () => {
    const user = userEvent.setup();
    const props = renderTable({ leads: [makeLead({ notes: "same" })] });
    const input = screen.getByRole("textbox", { name: "Notes for Acme Plumbing" });
    await user.click(input);
    await user.tab();
    expect(props.onSaveNotes).not.toHaveBeenCalled();
  });

  it("does not save an empty value when there were no notes", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.type(screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }), "   ");
    await user.tab();
    expect(props.onSaveNotes).not.toHaveBeenCalled();
  });

  it("clearing existing notes saves null", async () => {
    const user = userEvent.setup();
    const props = renderTable({ leads: [makeLead({ notes: "old note" })] });
    const input = screen.getByRole("textbox", { name: "Notes for Acme Plumbing" }) as HTMLInputElement;
    expect(input.value).toEqual("old note");
    await user.clear(input);
    await user.tab();
    expect(props.onSaveNotes).toHaveBeenCalledTimes(1);
    expect(props.onSaveNotes).toHaveBeenCalledWith(ID_A, null);
  });
});

describe("LeadQueueTable export", () => {
  it("passes all rows to onExport when nothing is filtered", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onExport).toHaveBeenCalledWith(LEADS);
  });

  it("exports exactly the visible rows after a filter", async () => {
    const user = userEvent.setup();
    const props = renderTable();
    await user.click(screen.getByRole("tab", { name: "Contacted" }));
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(props.onExport).toHaveBeenCalledWith([LEADS[1], LEADS[2]]);

    await user.click(screen.getByRole("tab", { name: "All" }));
    await user.type(screen.getByRole("searchbox", { name: "Search leads" }), "echo");
    await user.click(screen.getByRole("button", { name: /Export CSV/ }));
    expect(props.onExport).toHaveBeenLastCalledWith([LEADS[4]]);
  });
});

describe("CSV helpers", () => {
  it("escapeCsv quotes only when needed", () => {
    expect(escapeCsv("plain")).toEqual("plain");
    expect(escapeCsv("a,b")).toEqual('"a,b"');
    expect(escapeCsv('say "hi"')).toEqual('"say ""hi"""');
    expect(escapeCsv("line1\nline2")).toEqual('"line1\nline2"');
    expect(escapeCsv("line1\r\nline2")).toEqual('"line1\r\nline2"');
    expect(escapeCsv("")).toEqual("");
  });

  it("toCsv writes a header, one CRLF line per row, and empty cells for null/undefined", () => {
    type R = { a: string | null; b?: number };
    const csv = toCsv<R>(
      [
        { header: "A", accessor: (r) => r.a },
        { header: "B", accessor: (r) => r.b },
      ],
      [{ a: "x", b: 1 }, { a: null }, { a: "y,z", b: 0 }],
    );
    expect(csv).toEqual('A,B\r\nx,1\r\n,\r\n"y,z",0\r\n');
  });

  it("toCsv with no rows is just the header", () => {
    expect(toCsv([{ header: "Only", accessor: () => "x" }], [])).toEqual("Only\r\n");
  });

  it("buildLeadsCsv has the expected header and one line per lead", () => {
    const lines = buildLeadsCsv(LEADS).split("\r\n");
    expect(lines[0]).toEqual("Name,Phone,Website,Category,City,Rating,Reviews,L30D,Status,Notes");
    expect(lines).toHaveLength(LEADS.length + 2); // header + rows + trailing empty
    expect(lines.at(-1)).toEqual("");
    expect(lines[1]).toEqual("Acme Plumbing,+17135550101,https://acme.example,Plumbing,Houston,4.5,42,3,Queued,");
    // Whole-number ratings keep one decimal; status uses the human label.
    expect(lines[2]).toContain(",Electrical,Houston,4.0,42,0,Contacted,");
  });

  it("buildLeadsCsv renders null cells as empty and quotes commas, quotes and newlines", () => {
    const csv = buildLeadsCsv([
      makeLead({
        name: 'Smith, "Bob" & Sons',
        phone: null,
        website: null,
        category: null,
        city: null,
        rating: null,
        notes: "line1\nline2, with comma",
      }),
    ]);
    const body = csv.slice(csv.indexOf("\r\n") + 2);
    expect(body).toEqual('"Smith, ""Bob"" & Sons",,,,,,42,3,Queued,"line1\nline2, with comma"\r\n');
  });

  it("buildLeadsCsv of no leads is only the header", () => {
    expect(buildLeadsCsv([])).toEqual("Name,Phone,Website,Category,City,Rating,Reviews,L30D,Status,Notes\r\n");
  });
});

describe("StatusBadge and LeadMetrics", () => {
  it("renders the human label and data-status for every status", () => {
    const expected = {
      queued: "Queued",
      contacted: "Contacted",
      callback: "Callback",
      success: "Success",
      failed: "Failed",
      skipped: "Skipped",
    } as const;
    render(
      <div>
        {(Object.keys(expected) as (keyof typeof expected)[]).map((s) => (
          <StatusBadge key={s} status={s} />
        ))}
      </div>,
    );
    for (const [status, label] of Object.entries(expected)) {
      expect(document.querySelector(`[data-status="${status}"]`)?.textContent).toEqual(label);
    }
  });

  it("LeadMetrics renders the four tiles", () => {
    const metrics: LeadMetricsData = { total: 12, queued: 5, success: 2, calls7d: 9 };
    render(<LeadMetrics metrics={metrics} />);
    const tile = (key: string) => within(document.querySelector(`[data-metric="${key}"]`) as HTMLElement);
    expect(tile("total").getByText("Leads")).not.toBeNull();
    expect(tile("total").getByText("12")).not.toBeNull();
    expect(tile("queued").getByText("5")).not.toBeNull();
    expect(tile("success").getByText("2")).not.toBeNull();
    expect(tile("calls7d").getByText("Calls (7d)")).not.toBeNull();
    expect(tile("calls7d").getByText("9")).not.toBeNull();
  });
});

describe("CallHistoryTable", () => {
  it("shows the empty state", () => {
    render(<CallHistoryTable calls={[]} />);
    expect(screen.getByText("No conversations yet")).not.toBeNull();
  });

  it("renders business, outcome, agent, notes and relative time; dashes for missing values", () => {
    const calls: CallHistoryRow[] = [
      {
        id: "a1",
        businessId: ID_A,
        businessName: "Acme Plumbing",
        outcome: "interested",
        agent: "Dana",
        notes: "wants a quote",
        occurredAt: "2026-05-01T10:00:00.000Z",
        relative: "3 h ago",
      },
      {
        id: "a2",
        businessId: ID_B,
        businessName: "Bayou Electric",
        outcome: null,
        agent: null,
        notes: "",
        occurredAt: "2026-04-30T10:00:00.000Z",
        relative: "1 d ago",
      },
    ];
    render(<CallHistoryTable calls={calls} />);
    const rows = within(screen.getByTestId("history-table")).getAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    const first = within(rows[1]);
    expect(first.getByText("Acme Plumbing")).not.toBeNull();
    expect(first.getByText("Interested")).not.toBeNull();
    expect(first.getByText("Dana")).not.toBeNull();
    expect(first.getByText("wants a quote")).not.toBeNull();
    expect(first.getByText("3 h ago")).not.toBeNull();
    const second = within(rows[2]);
    expect(second.getByText("Bayou Electric")).not.toBeNull();
    expect(second.getAllByText("—")).toHaveLength(3); // outcome, agent, notes
    expect(second.getByText("1 d ago")).not.toBeNull();
  });
});

describe("LeadsPanel", () => {
  type UpdateResult = Awaited<ReturnType<typeof actions.updateLeadAction>>;
  const METRICS: LeadMetricsData = { total: 999, queued: 999, success: 999, calls7d: 17 };
  const HISTORY: CallHistoryRow[] = [
    {
      id: "h1",
      businessId: ID_A,
      businessName: "Acme Plumbing",
      outcome: "callback",
      agent: "Dana",
      notes: "ring tomorrow",
      occurredAt: "2026-05-01T10:00:00.000Z",
      relative: "2 h ago",
    },
  ];

  function renderPanel(props: Partial<React.ComponentProps<typeof LeadsPanel>> = {}) {
    return render(
      <TooltipProvider>
        <LeadsPanel leads={LEADS} metrics={METRICS} history={[]} campaigns={CAMPAIGNS} {...props} />
      </TooltipProvider>,
    );
  }

  function metric(key: string): string {
    return (document.querySelector(`[data-metric="${key}"]`) as HTMLElement).lastElementChild?.textContent ?? "";
  }

  function badgeStatus(id: string): string | undefined {
    return rowOf(id).querySelector<HTMLElement>("[data-status]")?.dataset.status;
  }

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  beforeEach(() => {
    vi.mocked(actions.updateLeadAction).mockResolvedValue({ ok: true, data: { id: ID_A, status: "queued", notes: null } });
    vi.mocked(actions.removeLeadAction).mockResolvedValue({ ok: true, data: null });
  });

  it("shows 'Pipeline empty' with a link to /lookup when there are no leads", () => {
    renderPanel({ leads: [] });
    expect(screen.getByText("Pipeline empty")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Lookup" }).getAttribute("href")).toEqual("/lookup");
    expect(screen.queryByTestId("lead-count")).toBeNull();
    expect(metric("total")).toEqual("0");
  });

  it("derives Leads/Queued/Success from the leads and Calls (7d) from metrics", () => {
    renderPanel();
    expect(metric("total")).toEqual("5");
    expect(metric("queued")).toEqual("1");
    expect(metric("success")).toEqual("1");
    expect(metric("calls7d")).toEqual("17");
  });

  it("History tab lists call rows", async () => {
    const user = userEvent.setup();
    renderPanel({ history: HISTORY });
    await user.click(screen.getByRole("tab", { name: "History" }));
    const table = await screen.findByTestId("history-table");
    expect(within(table).getByText("Acme Plumbing")).not.toBeNull();
    expect(within(table).getByText("Callback")).not.toBeNull();
    expect(within(table).getByText("Dana")).not.toBeNull();
    expect(within(table).getByText("2 h ago")).not.toBeNull();
  });

  it("History tab shows 'No conversations yet' when empty", async () => {
    const user = userEvent.setup();
    renderPanel({ history: [] });
    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(await screen.findByText("No conversations yet")).not.toBeNull();
  });

  it("changing a status calls updateLeadAction(id, { status }) and refreshes", async () => {
    const user = userEvent.setup();
    renderPanel();
    await pickOption(user, screen.getByRole("combobox", { name: "Status for Acme Plumbing" }), "Contacted");
    await waitFor(() => expect(actions.updateLeadAction).toHaveBeenCalledTimes(1));
    expect(actions.updateLeadAction).toHaveBeenCalledWith(ID_A, { status: "contacted" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    // Optimistic overlay is applied and metrics follow it.
    expect(badgeStatus(ID_A)).toEqual("contacted");
    expect(metric("queued")).toEqual("0");
  });

  it("Skip optimistically updates the badge before the action resolves", async () => {
    const user = userEvent.setup();
    const d = deferred<UpdateResult>();
    vi.mocked(actions.updateLeadAction).mockReturnValue(d.promise);
    renderPanel();
    expect(badgeStatus(ID_A)).toEqual("queued");

    await user.click(within(rowOf(ID_A)).getByRole("button", { name: "Skip Acme Plumbing" }));
    expect(actions.updateLeadAction).toHaveBeenCalledWith(ID_A, { status: "skipped" });
    // Still pending, but already shown as skipped.
    expect(badgeStatus(ID_A)).toEqual("skipped");
    expect(rowOf(ID_A).querySelector('[data-status="skipped"]')?.textContent).toEqual("Skipped");
    expect(metric("queued")).toEqual("0");
    expect(router.refresh).not.toHaveBeenCalled();

    d.resolve({ ok: true, data: { id: ID_A, status: "skipped", notes: null } });
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(badgeStatus(ID_A)).toEqual("skipped");
  });

  it("rolls the badge back when updateLeadAction fails", async () => {
    const user = userEvent.setup();
    const d = deferred<UpdateResult>();
    vi.mocked(actions.updateLeadAction).mockReturnValue(d.promise);
    renderPanel();

    await user.click(within(rowOf(ID_A)).getByRole("button", { name: "Skip Acme Plumbing" }));
    expect(badgeStatus(ID_A)).toEqual("skipped");

    d.resolve({ ok: false, message: "x" });
    await waitFor(() => expect(badgeStatus(ID_A)).toEqual("queued"));
    expect(metric("queued")).toEqual("1");
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("x");
  });

  it("saving notes calls updateLeadAction(id, { notes })", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole("textbox", { name: "Notes for Bayou Electric" }), "hi{Enter}");
    await waitFor(() => expect(actions.updateLeadAction).toHaveBeenCalledWith(ID_B, { notes: "hi" }));
  });

  it("Remove optimistically drops the row and calls removeLeadAction", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(within(rowOf(ID_A)).getByRole("button", { name: "Remove Acme Plumbing" }));
    await waitFor(() => expect(actions.removeLeadAction).toHaveBeenCalledWith(ID_A));
    expect(document.querySelector(`tr[data-lead-id="${ID_A}"]`)).toBeNull();
    expect(metric("total")).toEqual("4");
  });

  it("a failed remove brings the row back", async () => {
    const user = userEvent.setup();
    vi.mocked(actions.removeLeadAction).mockResolvedValue({ ok: false, message: "nope" });
    renderPanel();
    await user.click(within(rowOf(ID_A)).getByRole("button", { name: "Remove Acme Plumbing" }));
    await waitFor(() => expect(actions.removeLeadAction).toHaveBeenCalledWith(ID_A));
    await waitFor(() => expect(document.querySelector(`tr[data-lead-id="${ID_A}"]`)).not.toBeNull());
    expect(metric("total")).toEqual("5");
  });
});
