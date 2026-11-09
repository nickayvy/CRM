"use server";

// Server actions for Trustpilot discovery. Import them from ./actions, which
// also exports the synchronous discoveryConfigured() (a "use server" module may
// only export async functions).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Business } from "@/db/schema";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { env } from "@/lib/env";
import { DISCOVERY_NOT_CONFIGURED, DiscoveryUnavailable, createFirecrawl } from "@/lib/firecrawl/client";
import {
  enrichFromWebsite,
  scrapeTrustpilotBusiness,
  scrapeTrustpilotCategory,
  slugFromTrustpilotUrl,
} from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

const SEED_MAX = 50;

function errorResult(prefix: string, err: unknown) {
  if (err instanceof DiscoveryUnavailable) return fail(DISCOVERY_NOT_CONFIGURED);
  console.error(`[discovery] ${prefix}`, err);
  return fail(`${prefix}: ${err instanceof Error ? err.message : "unknown error"}`);
}

/** Scrapes one Trustpilot profile (`https://www.trustpilot.com/review/<slug>`) into the CRM. */
export async function scrapeUrlAction(url: string): Promise<ActionResult<{ businessId: string; name: string }>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (typeof url !== "string" || !slugFromTrustpilotUrl(url)) {
    return fail("Enter a Trustpilot review URL, e.g. https://www.trustpilot.com/review/example.com", {
      url: ["Must be a https://www.trustpilot.com/review/<domain> URL"],
    });
  }
  try {
    const b = await scrapeTrustpilotBusiness(getDb(), createFirecrawl(env.FIRECRAWL_API_KEY), url);
    revalidatePath("/lookup");
    return ok({ businessId: b.id, name: b.name });
  } catch (err) {
    return errorResult("Scrape failed", err);
  }
}

/** Seeds up to 50 new basic rows from one of the 22 Trustpilot categories. */
export async function seedCategoryAction(slug: string): Promise<ActionResult<{ inserted: number; seen: number }>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (!TRUSTPILOT_CATEGORIES.some((c) => c.slug === slug)) return fail(`Unknown Trustpilot category: ${String(slug)}`);
  try {
    const res = await scrapeTrustpilotCategory(getDb(), createFirecrawl(env.FIRECRAWL_API_KEY), slug, { max: SEED_MAX });
    revalidatePath("/lookup");
    return ok(res);
  } catch (err) {
    return errorResult("Category seed failed", err);
  }
}

/** Fills missing phone/email and social links from the business's own website. */
export async function enrichTrustpilotAction(businessId: string): Promise<ActionResult<Business>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (!z.uuid().safeParse(businessId).success) return fail("Invalid business id");
  try {
    const b = await enrichFromWebsite(getDb(), createFirecrawl(env.FIRECRAWL_API_KEY), businessId);
    revalidatePath("/lookup");
    revalidatePath(`/businesses/${businessId}`);
    return ok(b);
  } catch (err) {
    return errorResult("Enrichment failed", err);
  }
}
