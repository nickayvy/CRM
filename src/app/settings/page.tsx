import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { PageHeader, PageSection, PageShell, StatusBadge } from "@/components/primitives";
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
    title: "Yelp searches",
    description: "Pull businesses from Yelp by category and location.",
  },
];

/** Every key is read on the server; only whether it is set reaches the page. */
function sources() {
  return [
    { key: "FIRECRAWL_API_KEY", label: "Trustpilot discovery", on: !!env.FIRECRAWL_API_KEY },
    { key: "YELP_API_KEY", label: "Yelp search", on: !!env.YELP_API_KEY },
    { key: "RESEND_API_KEY", label: "Email sending", on: !!env.RESEND_API_KEY, offLabel: "Dry run" },
  ];
}

export default async function Page() {
  await requireUser();
  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Rules, data and the sources Leadwire pulls from." />
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
        </ul>
      </PageSection>
    </PageShell>
  );
}
