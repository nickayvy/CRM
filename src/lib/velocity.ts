// Review-velocity tiers (reviews in the last 30 days), unified across the app.
export type VelocityTier = "HIGH" | "MED" | "LOW";

export const VELOCITY_HIGH = 50;
export const VELOCITY_MED = 20;

/** ≥ 50 → HIGH, ≥ 20 → MED, else LOW. */
export function velocityTier(l30d: number): VelocityTier {
  if (l30d >= VELOCITY_HIGH) return "HIGH";
  if (l30d >= VELOCITY_MED) return "MED";
  return "LOW";
}
