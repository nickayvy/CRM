"use client";

import { ExternalLink, Star, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { categoryLabel } from "@/features/lookup/graph-utils";
import { absoluteUrl, hostOf } from "@/features/lookup/links";
import type { LookupBusiness } from "@/features/lookup/types";
import { BusinessLogo, SourceChip, VelocityBadge } from "./badges";

type Props = { business: LookupBusiness; onSelect: (id: string) => void };

/** Grid card (gtm business-card.tsx): logo, name, category, reviews · L30D + tier · rating, website. */
export function BusinessCard({ business: b, onSelect }: Props) {
  const host = hostOf(b.website);
  const category = b.categoryTitle ?? (b.category ? categoryLabel(b.category) : null);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open dossier for ${b.name}`}
      data-testid="business-card"
      className="relative cursor-pointer rounded-lg bg-surface p-4 shadow-[var(--shadow-elevated)] transition-all duration-300 ease-out hover:shadow-[0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      onClick={() => onSelect(b.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(b.id);
        }
      }}
    >
      <div className="flex items-start gap-3">
        <BusinessLogo business={b} className="h-10 w-10 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium">{b.name}</p>
            <SourceChip source={b.source} className="ml-auto" />
          </div>
          {category && (
            <Badge variant="secondary" className="mt-1 max-w-full truncate text-[10px]">
              {category}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="tabular-nums">{b.reviewCount.toLocaleString("en-US")} reviews</span>
        <span className="flex items-center gap-1" title="Reviews in the last 30 days">
          <TrendingUp className="h-3 w-3" aria-hidden />
          <span className="tabular-nums" data-testid="l30d">
            {b.reviewsLast30d}
          </span>
          <VelocityBadge l30d={b.reviewsLast30d} />
        </span>
        {b.rating !== null && (
          <span className="flex items-center gap-0.5" data-testid="rating">
            <Star className="h-3 w-3 fill-primary text-primary" aria-hidden />
            <span className="tabular-nums">{b.rating.toFixed(1)}</span>
          </span>
        )}
      </div>

      {b.website && host && (
        <a
          href={absoluteUrl(b.website)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          <span className="max-w-[180px] truncate">{host}</span>
        </a>
      )}
    </div>
  );
}
