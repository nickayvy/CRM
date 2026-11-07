import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getSearchJob } from "@/db/repo/search-jobs";
import { JobProgress } from "@/features/searches/components/job-progress";
import { toJobJson } from "@/features/searches/format";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Search" };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const { id } = await params;
  const job = await getSearchJob(getDb(), id);
  if (!job) notFound();
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: job.location }]}
        title={`${job.categoryAliases.join(", ")} in ${job.location}`}
        description={`Started ${formatDate(job.createdAt, env.APP_TIMEZONE)}`}
      />
      <PageSection className="rounded-xl border bg-card p-4 text-card-foreground" title="Progress">
        <JobProgress initial={toJobJson(job)} />
      </PageSection>
    </PageShell>
  );
}
