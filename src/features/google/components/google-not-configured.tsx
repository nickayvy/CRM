import Link from "next/link";
import { KeyRoundIcon } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { GOOGLE_NOT_CONFIGURED } from "@/lib/google-places/client";

/** Shown instead of the Google form when `GOOGLE_PLACES_API_KEY` is unset (same style as the Yelp notice). */
export function GoogleNotConfigured() {
  return (
    <EmptyState
      bordered
      icon={<KeyRoundIcon />}
      title={GOOGLE_NOT_CONFIGURED}
      description={
        <>
          Add <code className="rounded-sm bg-muted px-1 font-mono text-xs text-foreground">GOOGLE_PLACES_API_KEY</code> to
          the environment and redeploy to search Google Maps by niche and zip code. No Google request is made without it.
        </>
      }
      action={
        <Button asChild size="sm" variant="outline">
          <Link href="/lookup">Open Lookup</Link>
        </Button>
      }
      className="bg-surface"
    />
  );
}
