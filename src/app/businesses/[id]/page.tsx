import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLinkIcon, MapPinIcon } from "lucide-react";
import {
  EmptyState,
  KeyValue,
  KeyValueList,
  PageHeader,
  PageSection,
  PageShell,
  ScoreRing,
  StatusBadge,
  Timeline,
  TimelineItem,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listActivities } from "@/db/repo/activities";
import { getBusiness } from "@/db/repo/businesses";
import { getSearchJob } from "@/db/repo/search-jobs";
import type { Activity } from "@/db/schema";
import { BusinessHeaderActions } from "@/features/businesses/components/business-actions";
import { CrmForm } from "@/features/businesses/components/crm-form";
import { NoteForm } from "@/features/businesses/components/note-form";
import { ReasonChips, isSoftReason, reasonLabel } from "@/features/businesses/components/reason-chips";
import { hoursRows, isOpenNow, mapsUrl, toDateTimeLocal, transactionLabel } from "@/features/businesses/detail-format";
import { env } from "@/lib/env";
import { formatDate, formatPhone, formatRating } from "@/lib/format";
import { OUTCOME_LABELS, QUALIFICATION_LABELS, STATUS_LABELS } from "@/lib/labels";
import type { CallOutcome } from "@/db/schema";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const b = await getBusiness(getDb(), id);
  return { title: b?.name ?? "Business" };
}

const ACTIVITY_TITLES: Record<Activity["type"], string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  status_change: "Status change",
  system: "System",
};

function activityTitle(a: Activity): string {
  const base = ACTIVITY_TITLES[a.type];
  if (a.outcome) {
    const label = OUTCOME_LABELS[a.outcome as CallOutcome]?.label ?? a.outcome;
    return `${base} · ${label}`;
  }
  return base;
}

function Panel({ title, description, actions, children }: React.ComponentProps<typeof PageSection>) {
  return (
    <PageSection
      title={title}
      description={description}
      actions={actions}
      className="rounded-xl border bg-card p-4 text-card-foreground"
    >
      {children}
    </PageSection>
  );
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  const db = getDb();
  const business = await getBusiness(db, id);
  if (!business) notFound();
  const [activities, job] = await Promise.all([
    listActivities(db, id, { limit: 200 }),
    business.sourceJobId ? getSearchJob(db, business.sourceJobId) : Promise.resolve(null),
  ]);

  const b = business;
  const hours = hoursRows(b.hours);
  const openNow = isOpenNow(b.hours);
  const address = [b.address1, b.address2, [b.city, b.state, b.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const map = mapsUrl(b.latitude, b.longitude, address || undefined);
  const photos = b.photos ?? [];
  const transactions = b.transactions ?? [];
  const hardReasons = b.rejectionReasons.filter((r) => !isSoftReason(r));
  const softReasons = b.rejectionReasons.filter((r) => isSoftReason(r));

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[{ label: "Businesses", href: "/businesses" }, { label: b.name }]}
        title={b.name}
        meta={
          <>
            <StatusBadge label={QUALIFICATION_LABELS[b.qualification]} />
            <StatusBadge variant="dot" label={STATUS_LABELS[b.status]} />
            {b.doNotCall ? <StatusBadge tone="danger">Do not call</StatusBadge> : null}
            {b.doNotEmail ? <StatusBadge tone="danger">Do not email</StatusBadge> : null}
          </>
        }
        description={[b.categories.map((c) => c.title).join(", "), [b.city, b.state].filter(Boolean).join(", ")]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <ScoreRing value={b.score} size={36} label="Lead score" />
            {b.yelpUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={b.yelpUrl} target="_blank" rel="noreferrer">
                  <ExternalLinkIcon /> Yelp
                </a>
              </Button>
            ) : null}
            <BusinessHeaderActions id={b.id} name={b.name} enriched={b.enrichedAt !== null} />
          </>
        }
      />

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Why this result" description={`Score ${b.score} of 100`}>
            <div className="flex items-center gap-3">
              <ScoreRing value={b.score} size={48} thickness={5} />
              <div className="flex flex-col gap-1 text-sm">
                <span>
                  <StatusBadge label={QUALIFICATION_LABELS[b.qualification]} />
                </span>
                <span className="text-muted-foreground">
                  {b.qualification === "qualified"
                    ? "Passes every rule."
                    : b.qualification === "rejected"
                      ? "Rejected by the rules below."
                      : "Needs a human look."}
                </span>
              </div>
            </div>
            {b.rejectionReasons.length > 0 ? (
              <ul className="flex flex-col gap-2" aria-label="Reasons">
                {[...hardReasons, ...softReasons].map((r) => (
                  <li key={r} className="flex flex-wrap items-center gap-2 text-sm">
                    <ReasonChips reasons={[r]} />
                    <span>{reasonLabel(r)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {b.qualifiedAt ? (
              <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                Last qualified {formatDate(b.qualifiedAt, env.APP_TIMEZONE)}
              </p>
            ) : null}
          </Panel>

          <Panel title="Yelp data" description={b.enrichedAt ? `Enriched ${formatDate(b.enrichedAt, env.APP_TIMEZONE)}` : "Not enriched yet: Enrich adds hours, photos and claim status."}>
            <KeyValueList>
              <KeyValue label="Categories">{b.categories.map((c) => c.title).join(", ")}</KeyValue>
              <KeyValue label="Rating">
                {formatRating(b.rating)} · {b.reviewCount} review{b.reviewCount === 1 ? "" : "s"}
              </KeyValue>
              <KeyValue label="Price">{b.price}</KeyValue>
              <KeyValue label="Address">
                {address ? (
                  map ? (
                    <a href={map} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                      <MapPinIcon className="size-3.5" aria-hidden /> {address}
                    </a>
                  ) : (
                    address
                  )
                ) : null}
              </KeyValue>
              <KeyValue label="Phone" mono>
                {b.phone ? (
                  <a href={`tel:${b.phone}`} className="hover:underline">
                    {formatPhone(b.phone)}
                  </a>
                ) : null}
              </KeyValue>
              <KeyValue label="Website">
                {b.website ? (
                  <a href={b.website} target="_blank" rel="noreferrer" className="break-all hover:underline">
                    {b.website}
                  </a>
                ) : null}
              </KeyValue>
              <KeyValue label="Claimed">
                {b.isClaimed === null ? "Unknown" : b.isClaimed ? "Yes" : "No"}
              </KeyValue>
              <KeyValue label="Status">{b.isClosed ? "Closed" : openNow === null ? "Open" : openNow ? "Open now" : "Closed now"}</KeyValue>
              <KeyValue label="Transactions">{transactions.map(transactionLabel).join(", ")}</KeyValue>
              <KeyValue label="Source search">
                {job ? (
                  <Link href={`/searches/${job.id}`} className="hover:underline">
                    {job.categoryAliases.join(", ")} in {job.location}
                  </Link>
                ) : null}
              </KeyValue>
            </KeyValueList>
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Hours</h3>
              {hours ? (
                <table className="w-full max-w-sm text-sm" aria-label="Opening hours">
                  <tbody>
                    {hours.map((h) => (
                      <tr key={h.day} className="border-b last:border-0">
                        <th scope="row" className="py-1 pr-4 text-left font-normal text-muted-foreground">
                          {h.day}
                        </th>
                        <td className="py-1 tabular-nums">{h.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-muted-foreground">No hours yet.</p>
              )}
            </div>
            {photos.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Photos</h3>
                <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
                  {photos.map((src) => (
                    <a key={src} href={src} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote Yelp CDN, no image config */}
                      <img src={src} alt="" className="size-24 rounded-md border object-cover" loading="lazy" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="CRM">
            <CrmForm
              values={{
                id: b.id,
                status: b.status,
                ownerName: b.ownerName,
                ownerEmail: b.ownerEmail,
                tags: b.tags,
                doNotCall: b.doNotCall,
                doNotEmail: b.doNotEmail,
                notes: b.notes,
                nextFollowUpLocal: toDateTimeLocal(b.nextFollowUpAt, env.APP_TIMEZONE),
              }}
            />
          </Panel>
          <Panel title="Activity" description={`${activities.length} entr${activities.length === 1 ? "y" : "ies"}`}>
            <NoteForm businessId={b.id} />
            {activities.length > 0 ? (
              <Timeline>
                {activities.map((a) => (
                  <TimelineItem key={a.id} type={a.type} time={a.occurredAt} agent={a.agent} title={activityTitle(a)}>
                    {a.body || null}
                  </TimelineItem>
                ))}
              </Timeline>
            ) : (
              <EmptyState size="compact" title="No activity yet" description="Notes, calls and emails show up here." />
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
