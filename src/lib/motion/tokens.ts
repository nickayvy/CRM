/**
 * Motion tokens. Every animation in the app draws its timing from here so the
 * product moves with one rhythm. Durations are in seconds (motion's unit).
 */

/** Durations in seconds. `fast` for hover/press feedback, `base` for most enter/exit, `slow` for panels, page transitions and number counts. */
export const durations = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
} as const;

/** Cubic-bezier control points, usable directly as motion `ease` values. */
export const easings = {
  /** Default for elements that move within the screen. */
  standard: [0.2, 0, 0, 1],
  /** Decelerate: elements entering the screen. */
  enter: [0, 0, 0.2, 1],
  /** Accelerate: elements leaving the screen. */
  exit: [0.4, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** Spring presets for layout animations and interactive elements. */
export const springs = {
  /** Quick, nearly critically damped: list reorders, toggles, layout shifts. */
  snappy: { type: "spring", stiffness: 520, damping: 40, mass: 0.8 },
  /** Softer settle: panels, cards, larger surfaces. */
  gentle: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
} as const;

/** Delay between list children, in seconds. */
export const stagger = 0.03;

export type DurationToken = keyof typeof durations;
export type EasingToken = keyof typeof easings;
export type SpringToken = keyof typeof springs;
