import { ReasonChip } from "@/components/primitives";
import { REASON_LABELS, SOFT_REASONS, type ReasonCode } from "@/lib/qualify";

export function reasonLabel(code: string): string {
  return REASON_LABELS[code as ReasonCode] ?? code;
}

export function isSoftReason(code: string): boolean {
  return SOFT_REASONS.includes(code as ReasonCode);
}

/** One `ReasonChip` per reason code: hard rejections red, soft flags amber. */
export function ReasonChips({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <>
      {reasons.map((r) => (
        <ReasonChip key={r} code={r} label={reasonLabel(r)} tone={isSoftReason(r) ? "warning" : "danger"} />
      ))}
    </>
  );
}
