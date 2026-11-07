import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

const LINKS = [
  {
    href: "/settings/rules",
    title: "Qualification rules",
    description: "Decide which businesses count as qualified, need review or get rejected.",
  },
];

export default function Page() {
  return (
    <PageShell width="narrow">
      <PageHeader title="Settings" description="Configure how the CRM works." />
      <PageSection>
        <ul className="flex flex-col gap-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
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
    </PageShell>
  );
}
