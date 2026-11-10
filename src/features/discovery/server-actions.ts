"use server";

// Server actions for Trustpilot discovery. Import them from ./actions, which
// also exports the synchronous discoveryConfigured() (a "use server" module may
// only export async functions).
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { Business } from "@/db/schema";
import { getDb } from "@/db/client";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { env } from "@/lib/env";
import { DISCOVERY_NOT_CONFIGURED, DiscoveryUnavailable, createFirecrawl } from "@/lib/firecrawl/client";
import { enrichBusinessLinks, enrichPendingLinks } from "@/lib/firecrawl/enrich";
import { scrapeTrustpilotBusiness, scrapeTrustpilotCategory, slugFromTrustpilotUrl } from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

const SEED_MAX = 50;
/** Paste-a-URL: cap on the link enrichment that follows the profile scrape. */
const ADD_ENRICH_TIMEOUT_MS = 45_000;
/** Category seed: wall-clock budget for seed + enrichment together. */
const SEED_TOTAL_BUDGET_MS = 240_000;
/** Category seed: at most this many rows enriched after the seed. */
const SEED_ENRICH_LIMIT = 60;

function errorResult(prefix: string, err: unknown) {
  if (err instanceof DiscoveryUnavailable) return fail(DISCOVERY_NOT_CONFIGURED);
  console.error(`[discovery] ${prefix}`, err);
  return fail(`${prefix}: ${err instanceof Error ? err.message : "unknown error"}`);
}

/**
 * Scrapes one Trustpilot profile (`https://www.trustpilot.com/review/<slug>`)
 * into the CRM, then pulls the business's external links from its own website
 * (capped at 45 s). A failed link step is logged; the add still succeeds.
 */
export async function scrapeUrlAction(url: string): Promise<ActionResult<{ businessId: string; name: string }>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (typeof url !== "string" || !slugFromTrustpilotUrl(url)) {
    return fail("Enter a Trustpilot review URL, e.g. https://www.trustpilot.com/review/example.com", {
      url: ["Must be a https://www.trustpilot.com/review/<domain> URL"],
    });
  }
  try {
    const db = getDb();
    const fc = createFirecrawl(env.FIRECRAWL_API_KEY);
    const b = await scrapeTrustpilotBusiness(db, fc, url);
    try {
      const { status } = await enrichBusinessLinks(db, fc, b.id, { timeoutMs: ADD_ENRICH_TIMEOUT_MS });
      console.info(`[discovery] links for ${b.trustpilotId}: ${status}`);
    } catch (err) {
      console.warn(`[discovery] links for ${b.trustpilotId} failed:`, err);
    }
    revalidatePath("/lookup");
    return ok({ businessId: b.id, name: b.name });
  } catch (err) {
    return errorResult("Scrape failed", err);
  }
}

/** Result of `seedCategoryAction`: the seed was accepted and runs after the response. */
export type SeedQueued = { queued: true; category: string };

/**
 * Seeds up to 50 new basic rows from one of the 22 Trustpilot categories.
 * Validation (key, slug) answers inline; the scrape itself (tens of seconds:
 * 3 pages, 1.5 s apart) runs behind `after()` so the request returns at once.
 * The same task then enriches external links: the new rows first, then other
 * pending rows (at most 60), all inside 240 s from the start of the seed.
 * Rows appear in Lookup as they land; failures are logged, not returned.
 */
export async function seedCategoryAction(slug: string): Promise<ActionResult<SeedQueued>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (!TRUSTPILOT_CATEGORIES.some((c) => c.slug === slug)) return fail(`Unknown Trustpilot category: ${String(slug)}`);
  const key = env.FIRECRAWL_API_KEY;
  after(async () => {
    const started = Date.now();
    const db = getDb();
    const fc = createFirecrawl(key);
    let insertedIds: string[] = [];
    try {
      const res = await scrapeTrustpilotCategory(db, fc, slug, { max: SEED_MAX });
      insertedIds = res.insertedIds;
      console.info(`[discovery] seeded ${slug}: ${res.inserted} new of ${res.seen}`);
    } catch (err) {
      console.error(`[discovery] Category seed failed for ${slug}`, err);
      if (err instanceof DiscoveryUnavailable) return;
    }
    const budgetMs = SEED_TOTAL_BUDGET_MS - (Date.now() - started);
    if (budgetMs <= 0) return;
    try {
      const links = await enrichPendingLinks(db, fc, { limit: SEED_ENRICH_LIMIT, budgetMs, ids: insertedIds });
      console.info(
        `[discovery] links after seeding ${slug}: ${links.enriched} enriched, ${links.empty} empty, ${links.failed} failed, ${links.remaining} pending`,
      );
    } catch (err) {
      console.error(`[discovery] Link enrichment failed after seeding ${slug}`, err);
    }
  });
  return ok({ queued: true, category: slug });
}

/**
 * Fills missing phone/email and merges social links from the business's own
 * website (the same deterministic pipeline as the add and the seed).
 */
export async function enrichTrustpilotAction(businessId: string): Promise<ActionResult<Business>> {
  if (!env.FIRECRAWL_API_KEY) return fail(DISCOVERY_NOT_CONFIGURED);
  if (!z.uuid().safeParse(businessId).success) return fail("Invalid business id");
  try {
    const { status, business: b } = await enrichBusinessLinks(getDb(), createFirecrawl(env.FIRECRAWL_API_KEY), businessId);
    if (status === "skipped") return fail(`Enrichment failed: ${b.name} has no website to enrich from`);
    revalidatePath("/lookup");
    revalidatePath(`/businesses/${businessId}`);
    if (status === "failed") return fail(`Enrichment failed: could not load ${b.website ?? "the website"}`);
    return ok(b);
  } catch (err) {
    return errorResult("Enrichment failed", err);
  }
}
