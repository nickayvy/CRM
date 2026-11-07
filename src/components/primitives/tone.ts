import type { Tone } from "@/lib/labels";

export type { Tone };

/** Foreground color per tone (text, icons). */
export const toneText: Record<Tone, string> = {
  neutral: "text-tone-neutral",
  info: "text-tone-info",
  success: "text-tone-success",
  warning: "text-tone-warning",
  danger: "text-tone-danger",
};

/** Soft background + matching foreground (badges, chips, icon wells). */
export const toneSoft: Record<Tone, string> = {
  neutral: "bg-tone-neutral-soft text-tone-neutral",
  info: "bg-tone-info-soft text-tone-info",
  success: "bg-tone-success-soft text-tone-success",
  warning: "bg-tone-warning-soft text-tone-warning",
  danger: "bg-tone-danger-soft text-tone-danger",
};

/** Solid fill (dots, progress bars). */
export const toneFill: Record<Tone, string> = {
  neutral: "bg-tone-neutral",
  info: "bg-tone-info",
  success: "bg-tone-success",
  warning: "bg-tone-warning",
  danger: "bg-tone-danger",
};

/** SVG stroke per tone (score ring). */
export const toneStroke: Record<Tone, string> = {
  neutral: "stroke-tone-neutral",
  info: "stroke-tone-info",
  success: "stroke-tone-success",
  warning: "stroke-tone-warning",
  danger: "stroke-tone-danger",
};
