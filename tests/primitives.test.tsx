// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig } from "motion/react";
import { AnimatedNumber, FadeIn, PageTransition } from "@/lib/motion";
import { setHydratedForTests } from "@/lib/motion/hydration";
import { STATUS_LABELS } from "@/lib/labels";
import { DataTable, dataTableColumnHelper } from "@/components/primitives/data-table";
import { FilterBar } from "@/components/primitives/filter-bar";
import { StatCard } from "@/components/primitives/stat-card";
import { StatusBadge } from "@/components/primitives/status-badge";
import { toneSoft, type Tone } from "@/components/primitives/tone";

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

type Row = { id: string; name: string; score: number };

const ROWS: Row[] = [
  { id: "a", name: "Charlie", score: 3 },
  { id: "b", name: "Alpha", score: 1 },
  { id: "c", name: "Bravo", score: 2 },
];

const col = dataTableColumnHelper<Row>();
const columns = col.columns([
  col.accessor("name", { header: "Name" }),
  col.accessor("score", { header: "Score", meta: { align: "right" } }),
]);

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row> aria-label="Rows" columns={columns} data={ROWS} getRowId={(r) => r.id} {...props} />,
  );
}

/** Body rows of the table (excludes the header row). */
function bodyRows() {
  const table = screen.getByRole("table", { name: "Rows" });
  return Array.from(table.querySelectorAll("tbody > tr")) as HTMLTableRowElement[];
}

function firstColumnTexts() {
  return bodyRows().map((r) => r.querySelector("td")?.textContent);
}

describe("DataTable sorting", () => {
  it("sorts ascending then descending when the header button is clicked (uncontrolled)", () => {
    renderTable();
    const header = screen.getByRole("columnheader", { name: /Name/ });
    expect(firstColumnTexts()).toEqual(["Charlie", "Alpha", "Bravo"]);

    fireEvent.click(within(header).getByRole("button", { name: /Name/ }));
    expect(firstColumnTexts()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(header.getAttribute("aria-sort")).toBe("ascending");

    fireEvent.click(within(header).getByRole("button", { name: /Name/ }));
    expect(firstColumnTexts()).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });

  it("calls onSortChange with { id, desc } for each click", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    const button = within(screen.getByRole("columnheader", { name: /Name/ })).getByRole("button", { name: /Name/ });

    fireEvent.click(button);
    expect(onSortChange).toHaveBeenNthCalledWith(1, { id: "name", desc: false });
    fireEvent.click(button);
    expect(onSortChange).toHaveBeenNthCalledWith(2, { id: "name", desc: true });
  });
});

describe("DataTable selection", () => {
  const bulkActions = ({ selectedIds }: { selectedIds: string[] }) => (
    <button type="button">Add to campaign ({selectedIds.join(",")})</button>
  );

  it("shows the bulk bar with the count and actions once rows are checked", () => {
    renderTable({ enableSelection: true, bulkActions });
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();

    const boxes = screen.getAllByRole("checkbox", { name: "Select row" });
    expect(boxes).toHaveLength(3);
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[2]);

    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Add to campaign (a,c)" })).toBeTruthy();
  });

  it("selects every row with the header checkbox", () => {
    renderTable({ enableSelection: true, bulkActions });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));

    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("3 selected")).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox", { name: "Select row" })) {
      expect(box.getAttribute("aria-checked")).toBe("true");
    }
  });
});

describe("DataTable empty and loading states", () => {
  it("renders the provided emptyState when there is no data", () => {
    renderTable({ data: [], emptyState: <div>Nothing to see here</div> });
    expect(screen.getByText("Nothing to see here")).toBeTruthy();
    expect(screen.queryByText("Charlie")).toBeNull();
  });

  it("renders skeleton rows while loading", () => {
    const { container } = renderTable({ loading: true, loadingRows: 4 });
    expect(container.querySelectorAll('[data-slot="data-table-skeleton-row"]')).toHaveLength(4);
    expect(screen.queryByText("Charlie")).toBeNull();
  });
});

describe("DataTable keyboard and row clicks", () => {
  it("moves focus with ArrowDown, j, k and ArrowUp", () => {
    renderTable({ onRowClick: vi.fn() });
    const rows = bodyRows();
    act(() => rows[0].focus());
    expect(document.activeElement).toBe(rows[0]);

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(document.activeElement).toBe(rows[2]);

    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement).toBe(rows[1]);

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
  });

  it("calls onRowClick with the focused row's original object on Enter", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });
    const rows = bodyRows();
    act(() => rows[0].focus());
    fireEvent.keyDown(rows[0], { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it("calls onRowClick when a row is clicked but not when its checkbox is clicked", () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick, enableSelection: true });

    fireEvent.click(screen.getByText("Bravo"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2]);

    onRowClick.mockClear();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Select row" })[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe("DataTable pagination", () => {
  it("shows the row range and pages forward", () => {
    const onPageChange = vi.fn();
    renderTable({ pagination: { page: 2, pageSize: 10, total: 35, onPageChange } });

    expect(screen.getByText("11–20 of 35")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

describe("StatusBadge", () => {
  it.each(["neutral", "info", "success", "warning", "danger"] satisfies Tone[])("renders the %s tone", (tone) => {
    render(<StatusBadge tone={tone}>Hello</StatusBadge>);
    const badge = screen.getByText("Hello");
    expect(badge.getAttribute("data-tone")).toBe(tone);
    for (const cls of toneSoft[tone].split(" ")) expect(badge.classList.contains(cls)).toBe(true);
  });

  it("takes text and tone from a label entry", () => {
    render(<StatusBadge label={STATUS_LABELS.callback} />);
    const badge = screen.getByText(STATUS_LABELS.callback.label);
    expect(badge.getAttribute("data-tone")).toBe(STATUS_LABELS.callback.tone);
    for (const cls of toneSoft[STATUS_LABELS.callback.tone].split(" ")) expect(badge.classList.contains(cls)).toBe(true);
  });

  it("renders a dot for the dot variant", () => {
    render(
      <StatusBadge tone="success" variant="dot">
        Active
      </StatusBadge>,
    );
    const badge = screen.getByText("Active");
    expect(badge.getAttribute("data-variant")).toBe("dot");
    expect(badge.getAttribute("data-tone")).toBe("success");
    const dot = badge.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains("rounded-full")).toBe(true);
  });
});

describe("AnimatedNumber", () => {
  const text = (container: HTMLElement) => container.querySelector('[data-slot="animated-number"]')?.textContent;

  it.each([
    [1234, "integer", "1,234"],
    [12400, "currency", "$12,400"],
    [0.423, "percent", "42%"],
  ] as const)("renders the exact final formatted value for %s as %s", (value, format, expected) => {
    const { container } = render(<AnimatedNumber value={value} format={format} />);
    expect(text(container)).toBe(expected);
  });

  it("counts up to a new value and ends exactly on it", async () => {
    const { container, rerender } = render(<AnimatedNumber value={1234} />);
    rerender(<AnimatedNumber value={1500} />);
    await waitFor(() => expect(text(container)).toBe("1,500"), { timeout: 2000 });
  });

  it("applies a new value immediately under reduced motion", () => {
    const { container, rerender } = render(
      <MotionConfig reducedMotion="always">
        <AnimatedNumber value={1234} />
      </MotionConfig>,
    );
    expect(text(container)).toBe("1,234");
    rerender(
      <MotionConfig reducedMotion="always">
        <AnimatedNumber value={1500} />
      </MotionConfig>,
    );
    expect(text(container)).toBe("1,500");
  });
});

describe("StatCard", () => {
  it("ends on the exact formatted value", async () => {
    const { container } = render(<StatCard label="Leads" value={1234} format="integer" />);
    await waitFor(() => expect(container.querySelector('[data-slot="stat-value"]')?.textContent).toBe("1,234"), {
      timeout: 2000,
    });
  });

  it("renders a skeleton instead of the value when loading", () => {
    const { container } = render(<StatCard label="Leads" value={1234} loading />);
    expect(container.querySelector('[data-slot="stat-skeleton"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="stat-value"]')).toBeNull();
    expect(screen.queryByText("1,234")).toBeNull();
  });
});

describe("FilterBar", () => {
  it("removes only the clicked filter and supports Clear all", () => {
    const onRemoveStatus = vi.fn();
    const onRemoveCity = vi.fn();
    const onClearAll = vi.fn();
    render(
      <FilterBar
        activeFilters={[
          { id: "status:new", label: "Status: New", onRemove: onRemoveStatus },
          { id: "city:austin", label: "City: Austin", onRemove: onRemoveCity },
        ]}
        onClearAll={onClearAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove filter Status: New" }));
    expect(onRemoveStatus).toHaveBeenCalledTimes(1);
    expect(onRemoveCity).not.toHaveBeenCalled();
    expect(onClearAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("calls search.onChange with the typed value", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    // The search box is controlled by the page (usually via URL params), so mirror that here.
    function Controlled() {
      const [value, setValue] = React.useState("");
      return (
        <FilterBar
          search={{
            value,
            debounceMs: 0,
            onChange: (v) => {
              onChange(v);
              setValue(v);
            },
          }}
        />
      );
    }
    render(<Controlled />);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "plumb");
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(onChange).toHaveBeenLastCalledWith("plumb");
  });

  it("keeps the typed draft when the page's value lags behind (URL round-trip)", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar search={{ value: "", onChange, debounceMs: 0 }} />);
    const input = screen.getByRole("searchbox", { name: "Search" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "pl" } });
    fireEvent.change(input, { target: { value: "plu" } });
    // The URL catches up with the first emitted value only after more typing.
    rerender(<FilterBar search={{ value: "pl", onChange, debounceMs: 0 }} />);
    expect(input.value).toBe("plu");
    // A genuinely external change (e.g. Clear all) is adopted.
    rerender(<FilterBar search={{ value: "roof", onChange, debounceMs: 0 }} />);
    expect(input.value).toBe("roof");
  });

  it("debounces search changes", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<FilterBar search={{ value: "", onChange, debounceMs: 250 }} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(onChange).toHaveBeenCalledWith("abc");
  });

  it("focuses the search input on Meta+/", () => {
    render(<FilterBar search={{ value: "", onChange: vi.fn(), debounceMs: 0 }} />);
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(document.activeElement).toBe(input);
  });
});

describe("reduced motion", () => {
  // Static branch: no inline opacity/transform at all, so nothing is hidden, offset or animating.
  function expectStatic(el: HTMLElement) {
    expect(el.style.opacity).toBe("");
    expect(el.style.transform).toBe("");
  }

  it("renders FadeIn without inline opacity or transform", () => {
    setHydratedForTests(true);
    render(
      <MotionConfig reducedMotion="always">
        <FadeIn data-testid="fade">content</FadeIn>
      </MotionConfig>,
    );
    expectStatic(screen.getByTestId("fade"));
  });

  it("renders PageTransition without inline opacity or transform", () => {
    setHydratedForTests(true);
    render(
      <MotionConfig reducedMotion="always">
        <PageTransition>
          <p>page</p>
        </PageTransition>
      </MotionConfig>,
    );
    expectStatic(screen.getByText("page").parentElement as HTMLElement);
  });

  it("starts FadeIn at opacity 0 when motion is allowed and the app is hydrated", () => {
    setHydratedForTests(true);
    render(
      <MotionConfig reducedMotion="never">
        <FadeIn data-testid="fade">content</FadeIn>
      </MotionConfig>,
    );
    expect(screen.getByTestId("fade").style.opacity).toBe("0");
  });
});
