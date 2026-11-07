"use client";

import * as React from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useReducedMotionConfig,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";
import { getNumberFormatter, type NumberFormat } from "./format-number";
import { useCanAnimateMount, useHasMounted } from "./hydration";
import { durations, easings } from "./tokens";
import { fadeIn, fadeInUp, listContainer, listItem, scaleIn, slideInRight } from "./variants";

/**
 * True when animations should be skipped: the OS asks for reduced motion
 * (`prefers-reduced-motion: reduce`) or an ancestor `<MotionConfig
 * reducedMotion="always">` forces it (`"never"` forces motion on). `false`
 * on the server. This is motion's `useReducedMotionConfig`, exported under
 * the familiar name so the app-wide override is respected everywhere.
 */
export function useReducedMotion(): boolean {
  return useReducedMotionConfig() ?? false;
}

/**
 * Wraps children so every motion descendant completes instantly when
 * `reduced` is true. Always renders a `MotionConfig` so toggling reduced
 * motion never remounts the subtree.
 */
function StaticWhen({ reduced, children }: { reduced: boolean; children: React.ReactNode }) {
  return reduced ? <MotionConfig skipAnimations>{children}</MotionConfig> : <MotionConfig>{children}</MotionConfig>;
}

const FADE_VARIANTS = { fade: fadeIn, up: fadeInUp, scale: scaleIn, right: slideInRight } satisfies Record<
  string,
  Variants
>;

function withEnterDelay(variants: Variants, delay: number | undefined): Variants {
  if (!delay) return variants;
  const visible = variants.visible as Record<string, unknown> & { transition?: Record<string, unknown> };
  return { ...variants, visible: { ...visible, transition: { ...visible.transition, delay } } };
}

export type FadeInProps = Omit<HTMLMotionProps<"div">, "variants" | "initial" | "animate" | "exit"> & {
  /** Enter style: `up` (default, fade + 6px rise), `fade`, `scale`, `right` (slide from right). */
  variant?: keyof typeof FADE_VARIANTS;
  /** Delay before the enter starts, in seconds. */
  delay?: number;
};

/**
 * Fades its content in when it mounts after hydration (client navigation,
 * conditional render). On the server-rendered first paint and under reduced
 * motion it renders static, with no inline opacity/transform.
 */
export function FadeIn({ variant = "up", delay, ...props }: FadeInProps) {
  const reduced = useReducedMotion();
  const animateIn = useCanAnimateMount() && !reduced;
  // A variant's own transition outranks the `transition` prop, so the delay goes into the variant.
  const variants = React.useMemo(() => withEnterDelay(FADE_VARIANTS[variant], delay), [variant, delay]);
  return (
    <StaticWhen reduced={reduced}>
      <motion.div
        variants={variants}
        // Static branch: no initial and no animate target, so motion writes no inline opacity/transform at all.
        initial={animateIn ? "hidden" : false}
        animate={animateIn ? "visible" : undefined}
        exit="exit"
        {...props}
      />
    </StaticWhen>
  );
}

type ListTag = "ul" | "ol" | "div";

export type AnimatedListProps = {
  /** Element to render. Default `div`; use `ul`/`ol` with `AnimatedItem as="li"`. */
  as?: ListTag;
  className?: string;
  /** `AnimatedItem`s, each with a stable `key` (required for enter/exit and reorder animations). */
  children: React.ReactNode;
  /** `AnimatePresence` mode for removed items. Default `popLayout` so siblings slide into place immediately. */
  presenceMode?: "sync" | "popLayout" | "wait";
} & Omit<React.HTMLAttributes<HTMLElement>, "children" | "className">;

/**
 * List whose items stagger in (0.03 s apart) on mount, fade in when added,
 * fade out when removed, and animate to new positions on reorder (layout
 * animations). Renders static under reduced motion and on the first SSR paint.
 */
export function AnimatedList({ as = "div", className, children, presenceMode = "popLayout", ...rest }: AnimatedListProps) {
  const reduced = useReducedMotion();
  const canAnimate = useCanAnimateMount();
  const mounted = useHasMounted();
  // After mount, newly added children start from `hidden` even when the list itself hydrated statically.
  const initial = (canAnimate || mounted) && !reduced ? "hidden" : false;
  const Comp = motion[as] as typeof motion.div;
  return (
    <StaticWhen reduced={reduced}>
      <Comp
        className={className}
        variants={listContainer}
        initial={initial}
        animate="visible"
        {...(rest as HTMLMotionProps<"div">)}
      >
        <AnimatePresence mode={presenceMode} initial={!reduced}>
          {children}
        </AnimatePresence>
      </Comp>
    </StaticWhen>
  );
}

type ItemTag = "li" | "div" | "tr";

export type AnimatedItemProps = Omit<HTMLMotionProps<"div">, "variants" | "layout"> & {
  /** Element to render. Default `div`; `li` inside `AnimatedList as="ul"`. */
  as?: ItemTag;
  /** Layout animation on reorder/resize. Default `true` (`"position"` animates position only). Off under reduced motion. */
  layout?: boolean | "position";
};

/** One child of `AnimatedList`. Give it a stable `key`. */
export const AnimatedItem = React.forwardRef<HTMLElement, AnimatedItemProps>(function AnimatedItem(
  { as = "div", layout = true, ...props },
  ref,
) {
  const reduced = useReducedMotion();
  const Comp = motion[as] as typeof motion.div;
  return (
    <Comp
      ref={ref as React.Ref<HTMLDivElement>}
      variants={listItem}
      exit="exit"
      layout={reduced ? false : layout}
      transition={reduced ? { duration: 0 } : undefined}
      {...props}
    />
  );
});

export type PresenceProps = {
  /** Conditionally rendered motion children with stable keys, e.g. `{open && <FadeIn key="x" />}`. */
  children: React.ReactNode;
  /** Animate children present on first render. Default `false`. */
  initial?: boolean;
  /** `AnimatePresence` mode. Default `sync`. */
  mode?: "sync" | "popLayout" | "wait";
  /** Called when all exiting children have finished animating out. */
  onExitComplete?: () => void;
};

/**
 * `AnimatePresence` wrapper: children animate out (their `exit` variant)
 * before unmounting. Under reduced motion exits complete instantly.
 */
export function Presence({ children, initial = false, mode = "sync", onExitComplete }: PresenceProps) {
  const reduced = useReducedMotion();
  return (
    <StaticWhen reduced={reduced}>
      <AnimatePresence initial={initial && !reduced} mode={mode} onExitComplete={onExitComplete}>
        {children}
      </AnimatePresence>
    </StaticWhen>
  );
}

export type AnimatedNumberProps = {
  /** Target value. Changes animate from the currently displayed value. */
  value: number;
  /**
   * How to print the number, including intermediate frames. A preset
   * (`integer` default, `decimal`, `percent` (fraction in), `currency` (USD),
   * `compact`), an `Intl.NumberFormatOptions` object, or a function (client
   * components only; functions cannot cross the server→client boundary).
   */
  format?: NumberFormat;
  /** Start value for the count-up when the component mounts after hydration. Default `0`. */
  from?: number;
  /** Count duration in seconds. Default `durations.slow` (0.32). */
  duration?: number;
  /** BCP 47 locale for presets/options. Default `en-US`. */
  locale?: string;
  className?: string;
};

/**
 * Counts to `value` with the standard easing. On the first SSR paint and
 * under reduced motion the final formatted value is rendered immediately.
 * Always ends on exactly `format(value)`.
 */
export function AnimatedNumber({
  value,
  format = "integer",
  from = 0,
  duration = durations.slow,
  locale = "en-US",
  className,
}: AnimatedNumberProps) {
  const formatKey = typeof format === "function" ? format : JSON.stringify(format);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fmt = React.useMemo(() => getNumberFormatter(format, locale), [formatKey, locale]);
  const reduced = useReducedMotion();
  const canAnimate = useCanAnimateMount();
  const ref = React.useRef<HTMLSpanElement>(null);
  // The value currently on screen; null means "nothing animated yet, start from `from` if allowed".
  const shown = React.useRef<number | null>(null);
  const [initialText] = React.useState(() => fmt(canAnimate && !reduced ? from : value));

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = shown.current ?? (canAnimate ? from : value);
    if (reduced || start === value) {
      el.textContent = fmt(value);
      shown.current = value;
      return;
    }
    const controls = animate(start, value, {
      duration,
      ease: easings.standard,
      onUpdate: (v) => {
        shown.current = v;
        el.textContent = fmt(v);
      },
      onComplete: () => {
        shown.current = value;
        el.textContent = fmt(value);
      },
    });
    return () => {
      controls.stop();
    };
    // `canAnimate`/`from` only matter for the first run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fmt, reduced, duration]);

  return (
    <span ref={ref} data-slot="animated-number" className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {initialText}
    </span>
  );
}

export type PageTransitionProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Route enter transition used by `src/app/template.tsx` (templates remount
 * on every navigation): a quick fade + 6px rise. No animation on hard loads
 * (the SSR paint is shown as is) or under reduced motion.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const reduced = useReducedMotion();
  const animateIn = useCanAnimateMount() && !reduced;
  return (
    <StaticWhen reduced={reduced}>
      <motion.div
        className={className}
        variants={fadeInUp}
        initial={animateIn ? "hidden" : false}
        animate={animateIn ? "visible" : undefined}
      >
        {children}
      </motion.div>
    </StaticWhen>
  );
}
