"use client";

import { useState, useTransition } from "react";
import { Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DISCOVERY_DISABLED_HINT } from "@/features/lookup/copy";
import { TRUSTPILOT_CATEGORIES, scrapeUrlAction, seedCategoryAction } from "@/features/lookup/discovery-bridge";
import { TRUSTPILOT_REVIEW_PREFIX, isTrustpilotReviewUrl } from "@/features/lookup/links";

type Props = {
  /** `discoveryConfigured()` from the server; false disables both controls. */
  enabled: boolean;
  /** Called after a successful scrape or seed (the page refreshes its data). */
  onSuccess?: () => void;
  /** Called instead of `onSuccess` after a seed starts (its rows land over the next minute). */
  onSeeded?: () => void;
};

/**
 * Top strip of the grid panel (gtm manual-scrape-input.tsx): paste a
 * Trustpilot review URL → `scrapeUrlAction`; pick one of the 22 categories →
 * `seedCategoryAction`. Both are disabled with a notice without a key.
 */
export function ManualScrapeInput({ enabled, onSuccess, onSeeded }: Props) {
  const [url, setUrl] = useState("");
  const [seedSlug, setSeedSlug] = useState("");
  const [scraping, startScrape] = useTransition();
  const [seeding, startSeed] = useTransition();
  const valid = isTrustpilotReviewUrl(url);

  function submit() {
    if (!enabled || scraping) return;
    if (!valid) {
      toast.error("Invalid URL", { description: `URL must start with ${TRUSTPILOT_REVIEW_PREFIX}` });
      return;
    }
    startScrape(async () => {
      const res = await scrapeUrlAction(url.trim());
      if (res.ok) {
        toast.success("Business scraped", { description: res.data.name });
        setUrl("");
        onSuccess?.();
      } else {
        toast.error("Scrape failed", { description: res.message ?? "Unknown error" });
      }
    });
  }

  function seed(slug: string) {
    setSeedSlug(slug);
    if (!enabled || !slug) return;
    const label = TRUSTPILOT_CATEGORIES.find((c) => c.slug === slug)?.label ?? slug;
    startSeed(async () => {
      const res = await seedCategoryAction(slug);
      if (res.ok) {
        toast.success("Seeding started", {
          description: `${label}: up to 50 businesses land in the next minute${onSeeded ? " and appear here on their own." : ". Refresh to see them."}`,
        });
        (onSeeded ?? onSuccess)?.();
      } else {
        toast.error("Seed failed", { description: res.message ?? "Unknown error" });
      }
      setSeedSlug("");
    });
  }

  return (
    <div className="flex w-full flex-col gap-1.5" data-testid="discovery-controls">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Globe className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Trustpilot review URL"
              placeholder={`${TRUSTPILOT_REVIEW_PREFIX}...`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              className="h-8 pl-8 text-xs"
              disabled={!enabled || scraping}
            />
          </div>
          <Button size="sm" className="h-8 text-xs" disabled={!enabled || !valid || scraping} onClick={submit}>
            {scraping ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Scraping" /> : "Search"}
          </Button>
        </div>
        <Select value={seedSlug} onValueChange={seed} disabled={!enabled || seeding}>
          <SelectTrigger className="h-8 w-full text-xs sm:w-48" aria-label="Seed category">
            {seeding ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Seeding…
              </span>
            ) : (
              <SelectValue placeholder="Seed category" />
            )}
          </SelectTrigger>
          <SelectContent>
            {TRUSTPILOT_CATEGORIES.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {!enabled && (
        <p className="text-[11px] text-muted-foreground" data-testid="discovery-disabled">
          {DISCOVERY_DISABLED_HINT}
        </p>
      )}
    </div>
  );
}
