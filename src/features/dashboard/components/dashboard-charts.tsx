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
import type { OutcomeDayDatum } from "../chart-data";

/**
 * Stacked columns per day, one segment per outcome group. Segments are
 * separated by a 2px gap in the surface colour (a stroke that matches the
 * card), so neighbours read as distinct without an outline. A visually
 * hidden table carries the same numbers for screen readers.
 */
export function OutcomesByDayChart({
  data,
  outcomes,
}: {
  data: OutcomeDayDatum[];
  outcomes: { key: string; label: string; color: string }[];
}) {
  if (outcomes.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="No calls in the last 7 days"
        description="Outcomes show up here as soon as calls are logged."
        className="h-full"
      />
    );
  }
  const config = Object.fromEntries(outcomes.map((o) => [o.key, { label: o.label, color: o.color }])) satisfies ChartConfig;
  return (
    // `relative` keeps the visually hidden table inside this box. Without a positioned ancestor it is laid out
    // against the document, outside the app's scroll area, and makes the whole page scroll past the shell.
    <div className="relative size-full">
      <ChartContainer config={config} className="aspect-auto size-full" data-testid="chart-outcomes" aria-hidden>
        <BarChart data={data} margin={{ left: -16, right: 4, top: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} interval={0} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<ChartTooltipContent className="min-w-56" />} />
          <ChartLegend itemSorter={null} content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
          {outcomes.map((o, i) => (
            <Bar
              key={o.key}
              dataKey={o.key}
              stackId="calls"
              fill={`var(--color-${o.key})`}
              stroke="var(--surface)"
              strokeWidth={2}
              radius={i === outcomes.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
      {/* The wrapper carries sr-only: a table ignores the 1px box and would widen the page. */}
      <div className="sr-only">
        <table data-testid="chart-outcomes-table">
          <caption>Calls by outcome, last 7 days</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {outcomes.map((o) => (
                <th key={o.key} scope="col">
                  {o.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <th scope="row">{d.label}</th>
                {outcomes.map((o) => (
                  <td key={o.key}>{d[o.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
