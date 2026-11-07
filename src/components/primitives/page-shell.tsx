import * as React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageShellProps = React.ComponentProps<"div"> & {
  /**
   * Content width. `default` (max 72rem) for most pages, `narrow` (max 48rem)
   * for forms/settings, `full` for wide tables that should use the whole
   * viewport.
   */
  width?: "default" | "narrow" | "full";
};

/**
 * Outer wrapper of every page: horizontal centering, max width and the
 * vertical rhythm between header and sections. The app shell already adds
 * the outer gutter.
 */
export function PageShell({ width = "default", className, ...props }: PageShellProps) {
  return (
    <div
      data-slot="page-shell"
      data-width={width}
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-6",
        width === "default" && "max-w-6xl",
        width === "narrow" && "max-w-3xl",
        className,
      )}
      {...props}
    />
  );
}

export type Breadcrumb = {
  /** Visible text. */
  label: string;
  /** Link target; omit for the current page (last item). */
  href?: string;
};

export type PageHeaderProps = {
  /** Page title (rendered as the page's `h1`). */
  title: React.ReactNode;
  /** One line under the title. */
  description?: React.ReactNode;
  /** Right-aligned buttons. Wraps below the title on narrow screens. */
  actions?: React.ReactNode;
  /** Trail above the title, e.g. `[{ label: "Businesses", href: "/businesses" }, { label: name }]`. */
  breadcrumbs?: Breadcrumb[];
  /** Badges/inline facts next to the title, e.g. `<StatusBadge …/>`. */
  meta?: React.ReactNode;
  className?: string;
};

/** Page title block: breadcrumbs, title + meta badges, description, actions. */
export function PageHeader({ title, description, actions, breadcrumbs, meta, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-2", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {breadcrumbs.map((b, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <li key={`${b.label}-${i}`} className="flex items-center gap-1">
                  {b.href && !last ? (
                    <Link href={b.href} className="rounded-sm hover:text-foreground">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined} className={cn(last && "text-foreground")}>
                      {b.label}
                    </span>
                  )}
                  {!last ? <ChevronRightIcon className="size-3" aria-hidden /> : null}
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {meta ? <div className="flex flex-wrap items-center gap-1.5">{meta}</div> : null}
          </div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export type PageSectionProps = Omit<React.ComponentProps<"section">, "title"> & {
  /** Section heading (`h2`). Omit for an untitled section. */
  title?: React.ReactNode;
  /** One line under the heading. */
  description?: React.ReactNode;
  /** Right-aligned controls on the heading row. */
  actions?: React.ReactNode;
};

/** A titled block within a page. */
export function PageSection({ title, description, actions, className, children, ...props }: PageSectionProps) {
  return (
    <section data-slot="page-section" className={cn("flex min-w-0 flex-col gap-3", className)} {...props}>
      {title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
