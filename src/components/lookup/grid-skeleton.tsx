/** Six pulsing tiles shown while the grid page loads (gtm GridSkeleton). */
export function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2" data-testid="grid-skeleton" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg bg-surface" />
      ))}
    </div>
  );
}
