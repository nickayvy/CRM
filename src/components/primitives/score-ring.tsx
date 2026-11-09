import * as React from "react";
import { cn } from "@/lib/utils";
import { toneStroke, type Tone } from "./tone";

export type ScoreRingProps = {
  /** Score from 0 to 100. Clamped and rounded. */
  value: number;
  /** Outer diameter in px. Default 40. */
  size?: number;
  /** Ring stroke width in px. Default 4. */
  thickness?: number;
  /** Arc color. Default automatic: 70 and up `success`, 40 and up `warning`, else `danger`. */
  tone?: Tone;
  /** Shows the number centered in the ring. Default true. */
  showValue?: boolean;
  /** Accessible name. Default `Score {value} of 100`. */
  label?: string;
  className?: string;
};

function autoTone(score: number): Tone {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

/**
 * Radial gauge for a 0-100 score (lead score, health), starting at 12 o'clock.
 *
 * ```tsx
 * <ScoreRing value={lead.score} />
 * ```
 */
export function ScoreRing({ value, size = 40, thickness = 4, tone, showValue = true, label, className }: ScoreRingProps) {
  const score = Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 100));
  const t: Tone = tone ?? autoTone(score);
  const radius = Math.max((size - thickness) / 2, 0);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);
  return (
    <span
      role="img"
      aria-label={label ?? `Score ${score} of 100`}
      data-slot="score-ring"
      data-tone={t}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden focusable="false">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={thickness} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("transition-[stroke-dashoffset] duration-300 ease-out", toneStroke[t])}
        />
      </svg>
      {showValue ? (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center font-serif tabular-nums"
          style={{ fontSize: size * 0.32 }}
        >
          {score}
        </span>
      ) : null}
    </span>
  );
}
