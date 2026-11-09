import Link from "next/link";
import { KeyRoundIcon } from "lucide-react";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";

/** Shown instead of the search form (and the "New search" button) when `YELP_API_KEY` is unset. */
export function YelpNotConfigured() {
  return (
    <EmptyState
      bordered
      icon={<KeyRoundIcon />}
      title="Yelp search is not configured"
      description={
        <>
          Set <code className="rounded-sm bg-muted px-1 font-mono text-xs text-foreground">YELP_API_KEY</code> in the
          environment and redeploy to pull businesses from Yelp. Trustpilot discovery works without it.
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
