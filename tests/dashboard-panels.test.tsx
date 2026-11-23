// @vitest-environment jsdom
// The overview's panels render what the page tells them: one filled button, links that
// go where the row says, times a person can act on, and honest empty states.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AttentionItem } from "@/features/dashboard/attention";
import type { PipelineStage } from "@/features/dashboard/chart-data";
import {
  BarList,
  DiscoveryPanel,
  DueCallbacksPanel,
  GettingStartedPanel,
  PipelinePanel,
  UpNextPanel,
} from "@/features/dashboard/components/dashboard-panels";
import { OutcomesByDayChart } from "@/features/dashboard/components/dashboard-charts";
import type { Business, CallQueueItem } from "@/db/schema";

afterEach(cleanup);

const item = (o: Partial<AttentionItem>): AttentionItem => ({
  key: "k",
  tone: "info",
  icon: "dial",
  title: "Continue Houston roofers",
  detail: "12 waiting in the queue",
  href: "/calling/c1/dial",
  cta: "Open dialer",
  ...o,
});

describe("UpNextPanel", () => {
  it("gives only the first row the filled button and links each row to its target", () => {
    render(
      <UpNextPanel
        items={[item({}), item({ key: "review", title: "28 businesses need a decision", href: "/businesses?qualification=review", cta: "Review" })]}
      />,
    );
    const links = within(screen.getByTestId("up-next")).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href"), l.getAttribute("data-variant")])).toEqual([
      ["Open dialer", "/calling/c1/dial", "default"],
      ["Review", "/businesses?qualification=review", "outline"],
    ]);
    expect(screen.getByText("28 businesses need a decision")).toBeTruthy();
  });

  it("says so when nothing is waiting, with a way to keep going", () => {
    render(<UpNextPanel items={[]} />);
    expect(screen.getByText("You are all caught up")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Lookup" }).getAttribute("href")).toBe("/lookup");
  });
});

describe("DueCallbacksPanel", () => {
  const NOW = new Date("2026-11-07T18:30:00Z"); // 12:30 in Chicago
  const callback = (id: string, callbackAt: Date, phone: string | null = "+17135551011") =>
    ({
      id,
      campaignId: "camp-1",
      callbackAt,
      campaignName: "Houston roofers",
      business: { id: `b-${id}`, name: `Business ${id}`, phone } as Business,
    }) as CallQueueItem & { business: Business; campaignName: string };

  it("shows how late an overdue callback is and the clock time of one still to come", () => {
    render(
      <DueCallbacksPanel
        items={[callback("late", new Date("2026-11-07T15:30:00Z")), callback("soon", new Date("2026-11-07T21:15:00Z"), null)]}
        overdueTotal={3}
        now={NOW}
        tz="America/Chicago"
      />,
    );
    const panel = within(screen.getByTestId("due-callbacks"));
    // The badge counts every overdue callback, not only the rows listed.
    expect(screen.getByTestId("overdue-count").textContent).toBe("3 overdue");
    expect(panel.getByText("3 h ago")).toBeTruthy();
    expect(panel.getByText("3:15 PM")).toBeTruthy();
    expect(panel.getByRole("link", { name: "(713) 555-1011" }).getAttribute("href")).toBe("tel:+17135551011");
    const dialers = panel.getAllByRole("link", { name: "Open the dialer for Houston roofers" });
    expect(dialers.map((l) => l.getAttribute("href"))).toEqual(["/calling/camp-1/dial", "/calling/camp-1/dial"]);
  });

  it("only offers the dialer when the callback's campaign can dial right now", () => {
    const at = new Date("2026-11-07T15:30:00Z");
    const row = (id: string, campaignId: string) => ({ ...callback(id, at), campaignId });
    render(
      <DueCallbacksPanel
        items={[row("human", "running-dialer"), row("ai", "ai-campaign"), row("paused", "paused-dialer")]}
        overdueTotal={3}
        campaigns={{
          "running-dialer": { mode: "human", status: "running" },
          "ai-campaign": { mode: "ai", status: "running" },
          "paused-dialer": { mode: "human", status: "paused" },
        }}
        now={NOW}
        tz="America/Chicago"
      />,
    );
    const panel = within(screen.getByTestId("due-callbacks"));
    expect(panel.getByRole("link", { name: "Open the dialer for Houston roofers" }).getAttribute("href")).toBe("/calling/running-dialer/dial");
    // An AI campaign has no dialer and a paused one refuses to dial: both open the campaign page instead.
    expect(panel.getByRole("link", { name: "Open Houston roofers (called by the AI agent)" }).getAttribute("href")).toBe("/calling/ai-campaign");
    expect(panel.getByRole("link", { name: "Open Houston roofers (not running)" }).getAttribute("href")).toBe("/calling/paused-dialer");
  });

  it("has no overdue badge and an empty state when nothing is due", () => {
    render(<DueCallbacksPanel items={[]} overdueTotal={0} now={NOW} tz="America/Chicago" />);
    expect(screen.queryByTestId("overdue-count")).toBeNull();
    expect(screen.getByText("No callbacks due")).toBeTruthy();
  });
});

describe("PipelinePanel", () => {
  const stage = (key: PipelineStage["key"], label: string, count: number, shareOfPrevious: number | null): PipelineStage => ({
    key,
    label,
    asBase: label === "Reached out" ? "those reached" : label.toLowerCase(),
    count,
    hint: `${label} hint`,
    href: `/${key}`,
    shareOfPrevious,
  });

  it("captions each stage with its share of the stage before, or its hint when there is none", () => {
    render(
      <PipelinePanel
        stages={[
          stage("discovered", "Discovered", 1200, null),
          stage("qualified", "Qualified", 300, 0.25),
          stage("leads", "Leads", 400, null),
          stage("contacted", "Reached out", 100, 0.25),
          stage("won", "Success", 20, 0.2),
        ]}
      />,
    );
    const text = (key: string) => document.querySelector(`[data-stage="${key}"]`)?.textContent ?? "";
    expect(text("discovered")).toContain("1,200");
    expect(text("discovered")).toContain("Discovered hint");
    expect(text("qualified")).toContain("25% of discovered");
    expect(text("leads")).toContain("Leads hint");
    // The share names the previous stage in words that read as a sentence.
    expect(text("won")).toContain("20% of those reached");
    expect(document.querySelector('[data-stage="qualified"] a')?.getAttribute("href")).toBe("/qualified");
  });
});

describe("BarList and DiscoveryPanel", () => {
  it("prints every value and scales bars to the largest row", () => {
    render(
      <BarList
        testId="bars"
        empty="none"
        rows={[
          { key: "a", label: "Google", count: 70 },
          { key: "b", label: "Yelp", count: 35 },
          { key: "c", label: "Trustpilot", count: 0 },
        ]}
      />,
    );
    const row = (key: string) => document.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
    expect([...document.querySelectorAll('[data-slot="bar-value"]')].map((n) => n.textContent)).toEqual(["70", "35", "0"]);
    expect(row("a").querySelector<HTMLElement>(".bg-primary")?.style.width).toContain("100%");
    expect(row("b").querySelector<HTMLElement>(".bg-primary")?.style.width).toContain("50%");
    expect(row("c").querySelector<HTMLElement>(".bg-primary")?.style.width).toBe("0px");
  });

  it("shows the empty text instead of a list of zeros", () => {
    render(<BarList empty="Nothing has been rejected." rows={[{ key: "a", label: "Chain", count: 0 }]} />);
    expect(screen.getByText("Nothing has been rejected.")).toBeTruthy();
  });

  it("splits businesses into qualified, review and rejected and links to the rules", () => {
    render(
      <DiscoveryPanel
        qualification={{ qualified: 70, review: 28, rejected: 42 }}
        sources={[{ key: "google", label: "Google", count: 140 }]}
        rejections={[{ key: "chain", label: "Chain", count: 10 }]}
      />,
    );
    expect(screen.getByText("140 businesses found")).toBeTruthy();
    const split = screen.getByTestId("qualification-split");
    expect([...split.querySelectorAll("[data-key]")].map((n) => n.textContent)).toEqual(["Qualified70", "Review28", "Rejected42"]);
    expect(screen.getByRole("link", { name: "Edit rules" }).getAttribute("href")).toBe("/settings/rules");
  });
});

describe("GettingStartedPanel", () => {
  it("offers only the step that can be done now", () => {
    render(<GettingStartedPanel discoveryConfigured />);
    const panel = within(screen.getByTestId("getting-started"));
    for (const title of ["Find businesses", "Build your lead list", "Call and email them"]) expect(panel.getByText(title)).toBeTruthy();
    expect(panel.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([["Open Lookup", "/lookup"]]);
    expect(screen.queryByTestId("no-sources")).toBeNull();
  });

  it("points at Settings when Lookup has no source to search", () => {
    render(<GettingStartedPanel discoveryConfigured={false} />);
    const panel = within(screen.getByTestId("getting-started"));
    expect(screen.getByTestId("no-sources").textContent).toContain("No source is connected yet");
    expect(panel.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/settings"]);
  });
});

describe("OutcomesByDayChart", () => {
  it("keeps its screen-reader table inside a positioned box, so it cannot stretch the page", () => {
    render(
      <OutcomesByDayChart
        data={[{ day: "2026-11-07", label: "Sat 7", interested: 2, no_contact: 4 }]}
        outcomes={[
          { key: "interested", label: "Interested", color: "var(--series-1)" },
          { key: "no_contact", label: "No contact", color: "var(--series-3)" },
        ]}
      />,
    );
    const table = screen.getByTestId("chart-outcomes-table");
    // sr-only is position:absolute. With no positioned ancestor it is placed against the document, outside
    // the app's scroll area, and the whole page (top bar included) becomes scrollable.
    const hidden = table.parentElement!;
    expect(hidden.className).toContain("sr-only");
    expect(hidden.parentElement!.className).toContain("relative");
    expect([...table.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(["Sat 724"]);
    expect([...table.querySelectorAll("thead th")].map((c) => c.textContent)).toEqual(["Day", "Interested", "No contact"]);
  });

  it("explains an empty week instead of drawing empty axes", () => {
    render(<OutcomesByDayChart data={[]} outcomes={[]} />);
    expect(screen.getByText("No calls in the last 7 days")).toBeTruthy();
    expect(screen.queryByTestId("chart-outcomes-table")).toBeNull();
  });
});
