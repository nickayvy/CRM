"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/primitives";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** One row per category for the horizontal bar charts. */
export type CategoryDatum = { key: string; label: string; count: number };

/** One row per local day; outcome keys hold counts. */
export type OutcomeDayDatum = { day: string; label: string } & Record<string, number | string>;

function NoData({ text }: { text: string }) {
  return <EmptyState size="compact" title={text} className="h-full" />;
}

/** Horizontal bars, one per category; long labels get a wide Y axis. */
export function CategoryBarChart({
  data,
  color = "var(--chart-1)",
  name,
  emptyText,
  testId,
}: {
  data: CategoryDatum[];
  color?: string;
  name: string;
  emptyText: string;
  testId: string;
}) {
  if (data.every((d) => d.count === 0)) return <NoData text={emptyText} />;
  const config = { count: { label: name, color } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto size-full" data-testid={testId}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" dataKey="count" allowDecimals={false} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={104}
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={3} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/** Stacked bars per day, one segment per call outcome. */
export function OutcomesByDayChart({
  data,
  outcomes,
}: {
  data: OutcomeDayDatum[];
  outcomes: { key: string; label: string; color: string }[];
}) {
  if (outcomes.length === 0) return <NoData text="No calls in the last 7 days" />;
  const config = Object.fromEntries(outcomes.map((o) => [o.key, { label: o.label, color: o.color }])) satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="aspect-auto size-full" data-testid="chart-outcomes">
      <BarChart data={data} margin={{ left: -16, right: 4, top: 4, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} interval={0} tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-3 gap-y-1" />} />
        {outcomes.map((o, i) => (
          <Bar
            key={o.key}
            dataKey={o.key}
            stackId="calls"
            fill={`var(--color-${o.key})`}
            radius={i === outcomes.length - 1 ? [3, 3, 0, 0] : 0}
            maxBarSize={32}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
