import { GridSkeleton } from "@/components/lookup/grid-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

const PANEL = "rounded-lg bg-surface-elevated shadow-[var(--shadow-elevated)]";

/** Three-panel outline of /lookup shown while the page renders. */
export default function Loading() {
  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 lg:h-full lg:flex-row" role="status" aria-label="Loading lookup" data-testid="page-skeleton">
      <div className={`hidden lg:block lg:w-[30%] ${PANEL}`}>
        <Skeleton className="m-3 h-5 w-40" />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <div className={`min-w-0 overflow-hidden lg:flex-[5] ${PANEL}`}>
          <div className="flex justify-center border-b border-white/5 px-4 py-4">
            <Skeleton className="h-8 w-full max-w-xl" />
          </div>
          <GridSkeleton />
        </div>
        <div className={`order-first flex flex-col gap-4 p-6 lg:order-none lg:flex-[2] ${PANEL}`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
