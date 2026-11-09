"use client";

import { useEffect, useState, useTransition } from "react";
import {
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
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ReasonChips } from "@/features/businesses/components/reason-chips";
import { addToLeadsAction, getDossierAction } from "@/features/lookup/actions";
import type { Dossier } from "@/features/lookup/data";
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
};

function SectionDot() {
  return <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />;
}

/**
 * Intel dossier (gtm dossier-modal.tsx): header with the real "Last synced",
 * overview + metrics box, "Add to Lead List", intel brief, external-link
 * tiles ("NO DATA" when empty) and similar companies that switch the dossier
 * in place.
 */
export function DossierModal({ businessId, onClose }: Props) {
  const [viewingId, setViewingId] = useState(businessId);
  const [openedFor, setOpenedFor] = useState(businessId);
  if (openedFor !== businessId) {
    setOpenedFor(businessId);
    setViewingId(businessId);
  }

  const [loaded, setLoaded] = useState<{ id: string; result: ActionResult<Dossier> } | null>(null);
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
  }, [viewingId]);

  const current = loaded && loaded.id === viewingId ? loaded.result : null;

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
          <DossierBody key={current.data.business.id} dossier={current.data} onNavigate={setViewingId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DossierBody({ dossier, onNavigate }: { dossier: Dossier; onNavigate: (id: string) => void }) {
  const { business: b, related } = dossier;
  const [relatedOpen, setRelatedOpen] = useState(true);
  const [adding, startAdding] = useTransition();
  const category = b.categoryTitle ?? (b.category ? categoryLabel(b.category) : null);
  const host = hostOf(b.website);
  const tp = trustpilotUrl(b);
  const location = [b.city, b.country].filter(Boolean).join(", ");

  function addToLeads() {
    startAdding(async () => {
      const res = await addToLeadsAction(b.id);
      if (!res.ok) toast.error("Failed to add lead", { description: res.message ?? "Unknown error" });
      else if (res.data.created) toast.success("Lead added", { description: b.name });
      else toast.info("Already in your leads", { description: b.name });
    });
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
  ];

  return (
    <>
      <DialogDescription className="sr-only">Dossier for {b.name}</DialogDescription>
      <div className="flex shrink-0 items-center justify-between border-l-[3px] border-l-primary px-6 py-3 pr-12">
        <div className="flex items-center gap-2 text-xs tracking-wider text-muted-foreground uppercase tabular-nums" data-testid="last-synced">
          <SectionDot />
          Last synced: <time dateTime={b.lastSyncedAt}>{formatRelative(b.lastSyncedAt)}</time>
        </div>
        <SourceChip source={b.source} />
      </div>

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
                  {location && (
                    <span className="flex min-w-0 items-center gap-1">
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

          <Button className="mt-2 w-full" onClick={addToLeads} disabled={adding}>
            {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
            Add to Lead List
          </Button>

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
