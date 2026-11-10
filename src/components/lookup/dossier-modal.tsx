"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  BriefcaseBusiness,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AddToCampaignDialog } from "@/components/leads/add-to-campaign-dialog";
import { useConfirm } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ReasonChips } from "@/features/businesses/components/reason-chips";
import type { CampaignTarget } from "@/features/leads/types";
import {
  addToLeadsAction,
  createCallCampaignAction,
  deleteBusinessFromLookupAction,
  getDossierAction,
  queueBusinessForCallsAction,
} from "@/features/lookup/actions";
import type { Dossier } from "@/features/lookup/data";
import { enrichTrustpilotAction } from "@/features/lookup/discovery-bridge";
import { categoryLabel } from "@/features/lookup/graph-utils";
import { absoluteUrl, hostOf, metaAdsLibraryUrl, socialLink, trustpilotUrl } from "@/features/lookup/links";
import type { LookupBusiness } from "@/features/lookup/types";
import type { ActionResult } from "@/lib/action-result";
import { formatPhone, formatRelative } from "@/lib/format";
import { velocityTier } from "@/lib/velocity";
import { BusinessLogo, SourceChip } from "./badges";

type Props = {
  /** The business to open; null closes the dialog. */
  businessId: string | null;
  onClose: () => void;
  /** The row already on screen for `businessId`: shown at once while the full dossier loads. */
  preview?: LookupBusiness | null;
  /** Business ids already on the user's lead list. */
  leadIds?: ReadonlySet<string>;
  /** Told when this dossier adds a lead, so cards behind it update. */
  onLeadAdded?: (businessId: string) => void;
  /** Open call campaigns the lead can be queued in from here. */
  callCampaigns?: CampaignTarget[];
  /** Told after this dossier deletes the business (the dialog has already asked to close). */
  onDeleted?: (businessId: string) => void;
};

function SectionDot() {
  return <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />;
}

/**
 * Intel dossier (gtm dossier-modal.tsx): header with the real "Last synced",
 * overview + metrics box, "Add to Lead List" (then the next steps: queue for
 * calls, open Leads), intel brief, external-link tiles ("NO DATA" when empty)
 * and similar companies that switch the dossier in place.
 */
export function DossierModal({ businessId, onClose, preview = null, leadIds, onLeadAdded, callCampaigns, onDeleted }: Props) {
  const [viewingId, setViewingId] = useState(businessId);
  const [openedFor, setOpenedFor] = useState(businessId);
  if (openedFor !== businessId) {
    setOpenedFor(businessId);
    setViewingId(businessId);
  }

  const [loaded, setLoaded] = useState<{ id: string; result: ActionResult<Dossier> } | null>(null);
  /** Bumped after "Refresh links" so the dossier reloads with what was found. */
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!viewingId) return;
    let cancelled = false;
    getDossierAction(viewingId).then(
      (result) => !cancelled && setLoaded({ id: viewingId, result }),
      () => !cancelled && setLoaded({ id: viewingId, result: { ok: false, message: "Could not load this business" } }),
    );
    return () => {
      cancelled = true;
    };
  }, [viewingId, version]);

  const fetched = loaded && loaded.id === viewingId ? loaded.result : null;
  // Until the server answers, a card's own row fills the dossier (similar companies follow).
  const fromPreview = !fetched && preview && preview.id === viewingId;
  const current: ActionResult<Dossier> | null = fromPreview ? { ok: true, data: { business: preview, related: [] } } : fetched;

  return (
    <Dialog open={businessId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-0 overflow-hidden bg-surface-elevated p-0 shadow-[var(--shadow-floating)] sm:max-w-4xl">
        {!current ? (
          <>
            <DialogTitle className="sr-only">Loading business details</DialogTitle>
            <DialogDescription className="sr-only">The dossier is loading.</DialogDescription>
            <div className="p-4">
              <DossierSkeleton />
            </div>
          </>
        ) : !current.ok ? (
          <div className="p-6">
            <DialogTitle className="text-sm">Business unavailable</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-muted-foreground">{current.message ?? "Not found"}</DialogDescription>
          </div>
        ) : (
          <DossierBody
            key={current.data.business.id}
            dossier={current.data}
            relatedLoading={Boolean(fromPreview)}
            isLead={leadIds?.has(current.data.business.id) ?? false}
            onLeadAdded={onLeadAdded}
            callCampaigns={callCampaigns}
            onNavigate={setViewingId}
            onRefreshed={() => setVersion((v) => v + 1)}
            onDeleted={(id) => {
              onClose();
              onDeleted?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = {
  dossier: Dossier;
  onNavigate: (id: string) => void;
  relatedLoading?: boolean;
  isLead?: boolean;
  onLeadAdded?: (businessId: string) => void;
  callCampaigns?: CampaignTarget[];
  onDeleted?: (businessId: string) => void;
  /** Told after "Refresh links" succeeds, so the dossier reloads. */
  onRefreshed?: () => void;
};

function DossierBody({
  dossier,
  onNavigate,
  relatedLoading = false,
  isLead = false,
  onLeadAdded,
  callCampaigns,
  onDeleted,
  onRefreshed,
}: BodyProps) {
  const { business: b, related } = dossier;
  const [relatedOpen, setRelatedOpen] = useState(true);
  const [adding, startAdding] = useTransition();
  const [addedHere, setAddedHere] = useState(false);
  const [picking, setPicking] = useState(false);
  const [queuedIn, setQueuedIn] = useState<{ id: string; name: string } | null>(null);
  const [deleting, startDeleting] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const inLeads = isLead || addedHere;
  const category = b.categoryTitle ?? (b.category ? categoryLabel(b.category) : null);
  const host = hostOf(b.website);
  const tp = trustpilotUrl(b);
  const location = b.address ?? [b.city, b.country].filter(Boolean).join(", ");
  const [refreshing, startRefresh] = useTransition();

  function refreshLinks() {
    startRefresh(async () => {
      const res = await enrichTrustpilotAction(b.id);
      if (res.ok) {
        toast.success("Links refreshed", { description: `${b.name}: read again from its website.` });
        onRefreshed?.();
      } else {
        toast.error("Could not refresh links", { description: res.message ?? "Unknown error" });
      }
    });
  }

  function addToLeads() {
    startAdding(async () => {
      const res = await addToLeadsAction(b.id);
      if (!res.ok) {
        toast.error("Failed to add lead", { description: res.message ?? "Unknown error" });
        return;
      }
      setAddedHere(true);
      onLeadAdded?.(b.id);
      if (res.data.created) toast.success("Lead added", { description: b.name });
      else toast.info("Already in your leads", { description: b.name });
    });
  }

  async function remove() {
    const yes = await confirm({
      title: `Delete ${b.name}?`,
      description:
        "This permanently removes the business from your network, along with its activity history, lead entries and campaign memberships. It cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!yes) return;
    startDeleting(async () => {
      const res = await deleteBusinessFromLookupAction(b.id);
      if (!res.ok) {
        toast.error("Could not delete", { description: res.message ?? "Unknown error" });
        return;
      }
      toast.success("Business deleted", { description: b.name });
      onDeleted?.(b.id);
    });
  }

  async function createCampaign(name: string): Promise<string | null> {
    const res = await createCallCampaignAction(name);
    if (!res.ok) {
      toast.error(res.message ?? "Could not create the campaign.");
      return null;
    }
    return res.data.id;
  }

  async function queueForCalls(campaignId: string): Promise<boolean> {
    const res = await queueBusinessForCallsAction(campaignId, b.id);
    if (!res.ok) {
      toast.error(res.message ?? "Could not add to the campaign.");
      return false;
    }
    setQueuedIn({ id: campaignId, name: res.data.campaignName });
    if (res.data.added) toast.success(`Queued in ${res.data.campaignName}`, { description: b.name });
    else toast.info(`Not added to ${res.data.campaignName}`, { description: "Already in its queue, or marked do not call." });
    return true;
  }

  const twitter = socialLink(b.socialLinks, "twitter", "x");
  const facebook = socialLink(b.socialLinks, "facebook");
  const linkedin = socialLink(b.socialLinks, "linkedin");
  const tiles: { label: string; icon: typeof Globe; value: string | null; href: string | null }[] = [
    { label: "WEBSITE", icon: Globe, value: host ? `www.${host}` : null, href: b.website ? absoluteUrl(b.website) : null },
    { label: "FACEBOOK", icon: ExternalLink, value: facebook, href: facebook },
    { label: "META ADS", icon: Megaphone, value: host ? "Ad Library Search" : null, href: host ? metaAdsLibraryUrl(b.website) : null },
    { label: "X / TWITTER", icon: ExternalLink, value: twitter, href: twitter },
    { label: "FOUNDER", icon: BriefcaseBusiness, value: linkedin, href: linkedin },
    { label: "EMAIL", icon: Mail, value: b.email, href: b.email ? `mailto:${b.email}` : null },
    { label: "PHONE", icon: Phone, value: b.phone ? formatPhone(b.phone) : null, href: b.phone ? `tel:${b.phone}` : null },
    { label: "GOOGLE MAPS", icon: MapPin, value: b.googleMapsUrl ? "View listing" : null, href: b.googleMapsUrl },
  ];

  return (
    <>
      <DialogDescription className="sr-only">Dossier for {b.name}</DialogDescription>
      <div className="flex shrink-0 items-center justify-between border-l-[3px] border-l-primary px-6 py-3 pr-12">
        <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground uppercase tabular-nums" data-testid="last-synced">
          <SectionDot />
          Last synced: <time dateTime={b.lastSyncedAt}>{formatRelative(b.lastSyncedAt)}</time>
        </div>
        <div className="flex items-center gap-2">
          <SourceChip source={b.source} />
          <Button
            size="sm"
            className="h-7 rounded-md bg-destructive px-2.5 text-xs text-white hover:bg-destructive/85"
            onClick={() => void remove()}
            disabled={deleting}
            aria-label={`Delete ${b.name}`}
          >
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Trash2 className="h-3.5 w-3.5" aria-hidden />}
            Delete
          </Button>
        </div>
      </div>
      {confirmDialog}

      <div className="dossier-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex w-full flex-col gap-0 p-4">
          <section className="w-full pb-2" aria-label="Overview">
            <div className="flex w-full flex-col items-stretch gap-4 md:flex-row md:items-start">
              <BusinessLogo
                business={b}
                className="h-28 w-28 rounded-xl border border-black/10 shadow-lg md:self-start md:rounded-2xl"
                imgClassName="object-cover"
                initialsClassName="text-2xl font-bold md:text-3xl"
                initialsLength={2}
              />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 md:justify-start">
                {(category || b.subcategory) && (
                  <span className="mt-1 mb-1 text-[11px] font-bold tracking-widest text-primary uppercase">
                    {[category, b.subcategory].filter(Boolean).join(" / ")}
                  </span>
                )}
                <DialogTitle className="mb-1 font-serif text-2xl leading-tight font-bold tracking-tight text-foreground md:text-3xl">{b.name}</DialogTitle>
                <div className="mt-1 mb-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground md:text-sm">
                  {b.website && host && (
                    <a href={absoluteUrl(b.website)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-medium transition-colors hover:text-foreground">
                      <Globe className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{host}</span>
                    </a>
                  )}
                  {tp && (
                    <a href={tp} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-medium transition-colors hover:text-foreground">
                      <Star className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>Trustpilot</span>
                    </a>
                  )}
                  {b.yelpUrl && (
                    <a href={b.yelpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-medium transition-colors hover:text-foreground">
                      <Star className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>Yelp</span>
                    </a>
                  )}
                  {b.googleMapsUrl && (
                    <a href={b.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-medium transition-colors hover:text-foreground">
                      <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span>Google Maps</span>
                    </a>
                  )}
                  {location && (
                    <span className="flex min-w-0 items-center gap-1" data-testid="dossier-address">
                      <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="truncate">{location}</span>
                    </span>
                  )}
                </div>
              </div>

              <div
                className="flex min-w-[12rem] shrink-0 flex-col justify-center gap-3 rounded-xl border border-black/10 bg-gradient-to-br from-surface to-stone-100/10 px-4 py-2 shadow-md md:max-w-[15rem] md:self-start md:justify-start"
                data-testid="metrics"
              >
                <Metric label="Rating">
                  {b.rating !== null ? (
                    <span className="flex items-center gap-1 text-lg font-bold text-foreground tabular-nums">
                      <Star className="h-4 w-4 shrink-0 fill-current text-primary" aria-hidden />
                      {b.rating.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-[13px] font-semibold text-muted-foreground">N/A</span>
                  )}
                </Metric>
                <Metric label="Reviews">
                  <span className="text-lg font-bold text-foreground tabular-nums">{b.reviewCount.toLocaleString("en-US")}</span>
                </Metric>
                <Metric label="Velocity">
                  <span className="text-lg font-bold text-primary tabular-nums">+{b.reviewsLast30d}/30d</span>
                </Metric>
                {b.qualification !== "qualified" && b.rejectionReasons.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-t border-white/5 pt-2" data-testid="reason-chips">
                    <ReasonChips reasons={b.rejectionReasons} />
                  </div>
                )}
              </div>
            </div>
          </section>

          {inLeads ? (
            <div
              className="mt-2 flex flex-col gap-3 rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              data-testid="lead-next-steps"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  In your leads
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {queuedIn ? (
                    <>
                      Queued for calls in{" "}
                      <Link href={`/calling/${queuedIn.id}`} className="text-primary underline underline-offset-2">
                        {queuedIn.name}
                      </Link>
                      .
                    </>
                  ) : b.phone ? (
                    "Next: queue it in a call campaign, or work it from Leads."
                  ) : (
                    "No phone number on file, so it cannot be queued for calls yet."
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {b.phone && !queuedIn && (
                  <Button size="sm" onClick={() => setPicking(true)}>
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                    Add to call campaign…
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild>
                  <Link href="/leads">
                    Open Leads
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <Button className="mt-2 w-full" onClick={addToLeads} disabled={adding}>
              {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
              Add to Lead List
            </Button>
          )}
          {picking && (
            <AddToCampaignDialog
              kind="call"
              count={1}
              subject={b.name}
              campaigns={callCampaigns ?? []}
              onClose={() => setPicking(false)}
              onCreate={createCampaign}
              onSubmit={queueForCalls}
            />
          )}

          {b.aiSummary && (
            <section className="py-6" aria-label="Intel brief">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs tracking-wider text-foreground uppercase">
                  <SectionDot />
                  INTEL BRIEF // AUTOMATED ASSESSMENT
                </div>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary uppercase">• DATA AVAILABLE</span>
              </div>
              <div className="border-l-2 border-l-primary pr-2 pl-3 text-sm leading-relaxed text-muted-foreground">
                <p>{b.aiSummary}</p>
              </div>
            </section>
          )}

          <section className="py-6" aria-label="External links">
            <div className="mb-2 flex items-center gap-2 text-xs tracking-wider text-foreground uppercase">
              <SectionDot />
              EXTERNAL LINKS
              {host && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-[11px] tracking-normal normal-case"
                  onClick={refreshLinks}
                  disabled={refreshing}
                  title="Read the business's website again for email, phone and social links"
                >
                  {refreshing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                  Refresh links
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {tiles.map(({ label, icon: Icon, value, href }) => (
                <div key={label} className="flex min-w-0 items-center gap-2 rounded-md bg-surface px-2.5 py-2" data-testid="link-tile">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
                    {href && value ? (
                      <a
                        href={href}
                        target={href.startsWith("http") ? "_blank" : undefined}
                        rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="block truncate text-xs font-medium text-foreground hover:underline"
                      >
                        {value}
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">NO DATA</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {relatedLoading && related.length === 0 && (
            <div className="flex flex-col gap-1.5 py-6" data-testid="related-loading" aria-busy="true">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          )}
          {related.length > 0 && (
            <section className="w-full py-6" aria-label="Similar companies">
              <button
                type="button"
                className="mb-2 flex w-full items-center gap-2 text-xs tracking-wider text-foreground uppercase"
                aria-expanded={relatedOpen}
                onClick={() => setRelatedOpen((o) => !o)}
              >
                <SectionDot />
                Similar to this company [{String(related.length).padStart(2, "0")} FOUND]
                <ChevronDown
                  className="ml-auto h-4 w-4 text-muted-foreground transition-transform duration-300 ease-out"
                  style={{ transform: relatedOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                  aria-hidden
                />
              </button>
              {relatedOpen && (
                <div className="flex w-full flex-col gap-1.5">
                  {related.map((rel) => (
                    <RelatedRow key={rel.id} business={rel} onClick={() => onNavigate(rel.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm font-medium">
      <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  );
}

function RelatedRow({ business: rel, onClick }: { business: LookupBusiness; onClick: () => void }) {
  const tier = velocityTier(rel.reviewsLast30d);
  const category = rel.categoryTitle ?? (rel.category ? categoryLabel(rel.category) : "—");
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-md bg-surface px-3 py-2 text-left transition-colors hover:bg-muted/60"
      onClick={onClick}
      data-testid="related-row"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BusinessLogo business={rel} className="h-9 w-9 rounded-full" initialsClassName="text-[10px] uppercase" initialsLength={2} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{rel.name}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {hostOf(rel.website) ?? "—"} · {category}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-right sm:gap-8">
        <div className="w-14 text-right sm:w-16">
          <p className="text-xs font-semibold text-foreground tabular-nums">{rel.reviewCount.toLocaleString("en-US")}</p>
          <p className="text-[10px] text-muted-foreground uppercase">REVIEWS</p>
        </div>
        <div className="hidden w-12 text-right sm:block">
          <p className="flex items-center justify-end gap-0.5 text-xs font-semibold text-primary tabular-nums">
            <Star className="h-3 w-3 fill-current" aria-hidden />
            {rel.rating !== null ? rel.rating.toFixed(1) : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase">RATING</p>
        </div>
        <span
          className={`w-10 shrink-0 rounded px-2 py-0.5 text-center text-[10px] font-medium uppercase ${
            tier === "HIGH" ? "bg-primary/20 text-primary" : tier === "MED" ? "bg-primary/10 text-primary/90" : "bg-muted text-muted-foreground"
          }`}
        >
          {tier}
        </span>
      </div>
    </button>
  );
}

function DossierSkeleton() {
  return (
    <div className="space-y-4" data-testid="dossier-skeleton">
      <div className="flex items-start gap-3">
        <Skeleton className="h-14 w-14 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-4 w-40" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
    </div>
  );
}
