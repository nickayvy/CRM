/** Temporary page body used by WP-01 placeholders until the owning package lands. */
export function PlaceholderPage({ title, wp }: { title: string; wp: string }) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{`Built in ${wp}.`}</p>
    </div>
  );
}
