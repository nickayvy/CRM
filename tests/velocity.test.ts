import { describe, expect, it } from "vitest";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import { leadStatusEnum } from "@/db/schema";
import { velocityTier } from "@/lib/velocity";

describe("velocityTier", () => {
  it.each([
    [0, "LOW"],
    [19, "LOW"],
    [20, "MED"],
    [49, "MED"],
    [50, "HIGH"],
    [500, "HIGH"],
  ] as const)("%i reviews/30d → %s", (n, tier) => {
    expect(velocityTier(n)).toBe(tier);
  });
});

describe("LEAD_STATUS_LABELS", () => {
  it("labels every lead status with a tone", () => {
    expect(Object.keys(LEAD_STATUS_LABELS).sort()).toEqual([...leadStatusEnum.enumValues].sort());
    expect(LEAD_STATUS_LABELS.success).toEqual({ label: "Success", tone: "success" });
    expect(LEAD_STATUS_LABELS.failed.tone).toBe("danger");
    expect(LEAD_STATUS_LABELS.callback.tone).toBe("warning");
  });
});
