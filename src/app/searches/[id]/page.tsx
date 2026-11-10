import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader, PageSection, PageShell } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getSearchJob } from "@/db/repo/search-jobs";
import { GoogleJobProgress } from "@/features/google/components/google-job-progress";
import { JobProgress } from "@/features/searches/components/job-progress";
import { toJobJson } from "@/features/searches/format";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { PRICE_PER_1000_REQUESTS_USD } from "@/lib/google-places/plan";
import { requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// Continue and Run again run up to 240 s of a Google job behind after() on this page's function.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Search" };

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  await requireUser();
  const { id } = await params;
  const job = await getSearchJob(getDb(), id);
  if (!job) notFound();
  const google = job.source === "google";
  return (
    <PageShell width="narrow">
      <PageHeader
        breadcrumbs={[{ label: "Searches", href: "/searches" }, { label: job.location }]}
        title={google ? `${job.term ?? "Google Maps"} in ${job.location}` : `${job.categoryAliases.join(", ")} in ${job.location}`}
        description={`${google ? "Google Maps search. " : ""}Started ${formatDate(job.createdAt, env.APP_TIMEZONE)}`}
      />
      <PageSection className="rounded-lg bg-surface p-5 shadow-[var(--shadow-elevated)]" title="Progress">
        {google ? (
          <GoogleJobProgress initial={toJobJson(job)} pricePer1000={PRICE_PER_1000_REQUESTS_USD} />
        ) : (
          <JobProgress initial={toJobJson(job)} />
        )}
      </PageSection>
    </PageShell>
  );
}
