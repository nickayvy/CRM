import type { Variants } from "motion/react";
import { durations, easings, springs, stagger } from "./tokens";

/**
 * Shared variants. Every set uses the labels `hidden` → `visible`, plus
 * `exit`, so they compose:
 * `<motion.div variants={fadeInUp} initial="hidden" animate="visible" exit="exit" />`.
 */

/** Opacity only. */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.base, ease: easings.enter } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easings.exit } },
};

/** Opacity plus a 6px rise. The default enter for content blocks. */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easings.enter } },
  exit: { opacity: 0, y: 4, transition: { duration: durations.fast, ease: easings.exit } },
};

/** Opacity plus scale from 0.96. Popovers, chips, small surfaces. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: durations.base, ease: easings.enter } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: durations.fast, ease: easings.exit } },
};

/** Parent of `listItem`: staggers its children by 0.03 s. */
export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: stagger } },
  exit: {},
};

/** Child of `listContainer`. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: { duration: durations.base, ease: easings.enter } },
  exit: { opacity: 0, transition: { duration: durations.fast, ease: easings.exit } },
};

/** Enters from the right: side panels, bulk bars, inline drawers. */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: springs.gentle },
  exit: { opacity: 0, x: 24, transition: { duration: durations.fast, ease: easings.exit } },
};

/** Height 0 ↔ auto for disclosure content. Give the element `overflow: hidden`. */
export const collapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: "auto",
    opacity: 1,
    transition: {
      height: { duration: durations.base, ease: easings.standard },
      opacity: { duration: durations.fast, ease: easings.enter },
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: durations.fast, ease: easings.exit },
      opacity: { duration: durations.fast, ease: easings.exit },
    },
  },
};
