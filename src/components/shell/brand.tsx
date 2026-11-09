import Link from "next/link";
import { cn } from "@/lib/utils";

export const BRAND_NAME = "LAR";
export const BRAND_TAGLINE = "Turn market noise into signal.";

/**
 * Logo + "LAR" serif wordmark + tagline. Shared by the top bar and the
 * auth pages. The tagline hides on narrow screens.
 */
export function Brand({ href, className }: { href?: string; className?: string }) {
  const body = (
    <>
      {/* Plain img (as in gtm): a tiny static asset, no optimisation needed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt=""
        width={72}
        height={72}
        className="size-10 shrink-0 rounded-lg sm:size-14 lg:size-18"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-serif text-xl leading-none tracking-tight text-foreground sm:text-2xl">{BRAND_NAME}</span>
        <span className="hidden truncate font-serif text-base leading-tight tracking-tight text-foreground/85 lg:block">
          {BRAND_TAGLINE}
        </span>
      </span>
    </>
  );
  const cls = cn("flex min-w-0 items-center gap-3 rounded-lg", className);
  return href ? (
    <Link href={href} aria-label={`${BRAND_NAME}, home`} className={cls} data-testid="brand">
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid="brand">
      {body}
    </div>
  );
}
