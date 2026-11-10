import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Route-level loading UI (`loading.tsx`): shown the instant a nav link is
 * clicked, while the server renders the page. `variant` roughly matches the
 * page that is coming so the swap does not jump.
 */
export function PageSkeleton({ variant = "list", label }: { variant?: "list" | "cards" | "detail" | "panel"; label: string }) {
  if (variant === "panel") {
    return (
      <div className="flex h-full min-h-[560px] min-w-0 flex-col p-2 sm:p-4" role="status" aria-label={label} data-testid="page-skeleton">
        <div className="flex min-h-0 flex-1 flex-col gap-6 rounded-lg bg-surface-elevated p-4 shadow-[var(--shadow-elevated)] sm:p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-8 w-56" />
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8" role="status" aria-label={label} data-testid="page-skeleton">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {variant === "detail" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      )}
      <div className={cn("grid gap-4", variant === "cards" ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
        {Array.from({ length: variant === "cards" ? 6 : 5 }).map((_, i) => (
          <Skeleton key={i} className={cn("rounded-lg", variant === "cards" ? "h-64" : "h-14")} />
        ))}
      </div>
    </div>
  );
}
