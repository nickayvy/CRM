/**
 * Animation system: tokens, variants and wrapper components.
 *
 * Rules for feature code:
 * - Use these wrappers (or the variants with `motion.*`) instead of ad-hoc
 *   durations/easings.
 * - Everything here renders static under `prefers-reduced-motion: reduce`
 *   and on the server-rendered first paint.
 */
export { durations, easings, springs, stagger } from "./tokens";
export type { DurationToken, EasingToken, SpringToken } from "./tokens";
export { fadeIn, fadeInUp, scaleIn, listContainer, listItem, slideInRight, collapse } from "./variants";
export {
  FadeIn,
  AnimatedList,
  AnimatedItem,
  Presence,
  AnimatedNumber,
  PageTransition,
  useReducedMotion,
} from "./components";
export type {
  FadeInProps,
  AnimatedListProps,
  AnimatedItemProps,
  PresenceProps,
  AnimatedNumberProps,
  PageTransitionProps,
} from "./components";
export { formatNumber, getNumberFormatter } from "./format-number";
export type { NumberFormat, NumberFormatPreset } from "./format-number";
export { useCanAnimateMount } from "./hydration";
