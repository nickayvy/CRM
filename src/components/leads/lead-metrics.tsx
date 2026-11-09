import type { LeadMetricsData } from "@/features/leads/types";

const TILES: { key: keyof LeadMetricsData; label: string }[] = [
  { key: "total", label: "Leads" },
  { key: "queued", label: "Queued" },
  { key: "success", label: "Success" },
  { key: "calls7d", label: "Calls (7d)" },
];

/** Four metric tiles: Leads, Queued, Success, Calls (7d). Two columns below sm. */
export function LeadMetrics({ metrics }: { metrics: LeadMetricsData }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4" data-testid="lead-metrics">
      {TILES.map((t) => (
        <div
          key={t.key}
          data-metric={t.key}
          className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-surface px-4 py-4 shadow-[var(--shadow-elevated)]"
        >
          <span className="text-[10px] tracking-wider text-muted-foreground uppercase">{t.label}</span>
          <span className="font-serif text-3xl tracking-tight tabular-nums sm:text-4xl">{metrics[t.key]}</span>
        </div>
      ))}
    </div>
  );
}
