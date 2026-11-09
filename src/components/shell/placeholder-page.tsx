import { ConstructionIcon } from "lucide-react";
import { PageHeader, PageShell } from "@/components/primitives";

/** Styled stand-in for a route whose owning package has not landed yet. */
export function PlaceholderPage({ title, description, wp }: { title: string; description?: string; wp: string }) {
  return (
    <PageShell>
      <PageHeader title={title} description={description} />
      <div
        data-testid="placeholder"
        className="flex flex-col items-center justify-center gap-3 rounded-lg bg-surface py-16 text-center shadow-[var(--shadow-elevated)]"
      >
        <ConstructionIcon className="size-6 text-primary" aria-hidden />
        <p className="font-serif text-2xl tracking-tight">Under construction</p>
        <p className="text-xs tracking-wider text-muted-foreground uppercase">{`Built in ${wp}`}</p>
      </div>
    </PageShell>
  );
}
