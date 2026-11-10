import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { PageHeader, PageSection, PageShell, StatusBadge } from "@/components/primitives";
import { getDb } from "@/db/client";
import { GOOGLE_PLACES_PROVIDER, getUsage } from "@/db/repo/google";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

const LINKS = [
  {
    href: "/settings/rules",
    title: "Qualification rules",
    description: "Decide which businesses count as qualified, need review or get rejected.",
  },
  {
    href: "/businesses",
    title: "All businesses",
    description: "The full table: filter by source, sort by L30D, bulk-edit CRM fields.",
  },
  {
    href: "/searches",
    title: "Searches",
    description: "Search Google Maps by niche and zip code, or Yelp by category and location.",
  },
];

/** Every key is read on the server; only whether it is set reaches the page. */
function sources() {
  return [
    { key: "GOOGLE_PLACES_API_KEY", label: "Google Maps search", on: !!env.GOOGLE_PLACES_API_KEY },
    { key: "FIRECRAWL_API_KEY", label: "Trustpilot discovery", on: !!env.FIRECRAWL_API_KEY },
    { key: "YELP_API_KEY", label: "Yelp search", on: !!env.YELP_API_KEY },
    { key: "RESEND_API_KEY", label: "Email sending", on: !!env.RESEND_API_KEY, offLabel: "Dry run" },
  ];
}

/** This month's Google Places requests against the cap; null when the counter cannot be read. */
async function googleUsage(): Promise<{ used: number; cap: number } | null> {
  try {
    return { used: await getUsage(getDb(), GOOGLE_PLACES_PROVIDER), cap: env.GOOGLE_PLACES_MONTHLY_REQUEST_CAP };
  } catch (err) {
    console.error("[settings] could not read Google usage", err);
    return null;
  }
}

export default async function Page() {
  await requireUser();
  const usage = await googleUsage();
  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Rules, data and the sources LAR pulls from." />
      <PageSection title="Workspace">
        <ul className="flex flex-col gap-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="card-glow flex items-center justify-between gap-3 rounded-lg bg-surface p-4 shadow-[var(--shadow-elevated)] transition-all duration-300 ease-out"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{l.title}</span>
                  <span className="text-sm text-muted-foreground">{l.description}</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </PageSection>
      <PageSection title="Sources" description="Set in the deployment environment.">
        <ul className="flex flex-col divide-y divide-white/5 rounded-lg bg-surface px-4 shadow-[var(--shadow-elevated)]" data-testid="sources">
          {sources().map((s) => (
            <li key={s.key} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{s.label}</span>
                <code className="font-mono text-[11px] text-muted-foreground">{s.key}</code>
              </span>
              {s.on ? (
                <StatusBadge tone="info">Configured</StatusBadge>
              ) : (
                <StatusBadge tone="neutral">{s.offLabel ?? "Not configured"}</StatusBadge>
              )}
            </li>
          ))}
          {usage ? (
            <li className="flex flex-wrap items-center justify-between gap-2 py-3" data-testid="google-usage">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">Google Maps requests this month</span>
                <span className="text-[11px] text-muted-foreground">
                  Searches pause when the cap (<code className="font-mono">GOOGLE_PLACES_MONTHLY_REQUEST_CAP</code>) is reached. The
                  count resets on the 1st (UTC).
                </span>
              </span>
              <StatusBadge tone={usage.used >= usage.cap ? "warning" : "neutral"}>
                {`${usage.used.toLocaleString("en-US")} of ${usage.cap.toLocaleString("en-US")} requests used`}
              </StatusBadge>
            </li>
          ) : null}
        </ul>
      </PageSection>
    </PageShell>
  );
}
