"use server";
// TODO(PM, at WP-13 merge): delete this file; `discovery-bridge.ts` then
// re-exports the real actions from "@/features/discovery/actions".
// Stubs with the frozen signatures (architecture §Discovery). They never fake
// a result: both report that discovery is not configured.
import type { ActionResult } from "@/lib/action-result";

const NOT_CONFIGURED = "Discovery is not configured: set FIRECRAWL_API_KEY";

export async function scrapeUrlAction(url: string): Promise<ActionResult<{ businessId: string; name: string }>> {
  void url;
  return { ok: false, message: NOT_CONFIGURED };
}

export async function seedCategoryAction(slug: string): Promise<ActionResult<{ inserted: number; seen: number }>> {
  void slug;
  return { ok: false, message: NOT_CONFIGURED };
}
