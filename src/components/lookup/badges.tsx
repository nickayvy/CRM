"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { BusinessSource } from "@/db/schema";
import { initials, logoChain } from "@/features/lookup/links";
import { type VelocityTier, velocityTier } from "@/lib/velocity";
import { cn } from "@/lib/utils";

const TIER_CLASS: Record<VelocityTier, string> = {
  HIGH: "bg-primary/15 text-primary",
  MED: "bg-primary/10 text-primary/90",
  LOW: "bg-muted text-muted-foreground",
};

/** HIGH / MED / LOW from `velocityTier(l30d)`, styled as in gtm's card. */
export function VelocityBadge({ l30d, className }: { l30d: number; className?: string }) {
  const tier = velocityTier(l30d);
  return (
    <Badge data-tier={tier} className={cn("border-0 px-1.5 py-0 text-[10px]", TIER_CLASS[tier], className)}>
      {tier}
    </Badge>
  );
}

const SOURCE_LABEL: Record<BusinessSource, string> = { yelp: "Yelp", trustpilot: "Trustpilot", google: "Google" };

/** Small Yelp/Trustpilot provenance chip. */
export function SourceChip({ source, className }: { source: BusinessSource; className?: string }) {
  return (
    <span
      data-source={source}
      className={cn(
        "inline-flex h-4 items-center rounded-sm border border-white/10 px-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

type LogoProps = {
  business: { name: string; logoUrl: string | null; imageUrl?: string | null; slug: string | null; website: string | null };
  /** Classes for the round/rounded frame (size, radius, background). */
  className?: string;
  imgClassName?: string;
  initialsClassName?: string;
  initialsLength?: number;
};

/** Logo fallback chain: logoUrl → Yelp photo → Google favicon → initials. */
export function BusinessLogo({ business, className, imgClassName, initialsClassName, initialsLength = 1 }: LogoProps) {
  const chain = logoChain(business);
  const key = chain.join("|");
  const [failed, setFailed] = useState<{ key: string; n: number }>({ key, n: 0 });
  const step = failed.key === key ? failed.n : 0;
  const src = chain[step];
  return (
    <div className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-muted", className)} data-slot="business-logo">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote logos from arbitrary hosts
        <img
          src={src}
          alt=""
          className={cn("h-full w-full object-cover", imgClassName)}
          onError={() => setFailed({ key, n: step + 1 })}
        />
      ) : (
        <span className={cn("text-sm font-semibold text-muted-foreground", initialsClassName)}>
          {initials(business.name, initialsLength)}
        </span>
      )}
    </div>
  );
}
