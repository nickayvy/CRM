import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { evaluateAllCampaigns } from "@/db/repo/call-campaigns";
import { processAllDue } from "@/db/repo/email-campaigns";
import { createEmailSender } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { DiscoveryUnavailable, createFirecrawl } from "@/lib/firecrawl/client";
import { enrichPendingLinks } from "@/lib/firecrawl/enrich";
import { scrapeTrustpilotCategory, syncStale } from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_LIMIT = 12;
const SYNC_BUDGET_MS = 30_000;
const SEED_MAX_PER_CATEGORY = 20;
const LINKS_LIMIT = 40;
/** Links stage cap: most of the discovery budget on weekdays; Sundays leave the rest to the seed. */
const LINKS_BUDGET_MS = 180_000;
const LINKS_BUDGET_SUNDAY_MS = 60_000;
/** Total wall-clock budget for discovery work; leaves headroom under maxDuration. */
const DISCOVERY_BUDGET_MS = 240_000;
const SKIPPED = "FIRECRAWL_API_KEY not set";

function authorized(req: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return true; // open when unset (local only)
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Links = Awaited<ReturnType<typeof enrichPendingLinks>> | { skipped: string } | { error: string };

type Seeded =
  | { skipped: string }
  | { categories: number; inserted: number; seen: number; errors: string[]; outOfBudget?: number };

/**
 * The single Vercel cron (0 13 * * *): call-campaign evaluation, due email
 * steps, stale Trustpilot sync (12 rows / 30 s), external-links enrichment of
 * pending rows (40 rows; the remaining discovery budget capped at 180 s, or
 * 60 s on Sundays), and on Sundays (UTC) a 20-per-category seed of all 22
 * categories inside the remaining budget. Firecrawl requests are paced to the
 * plan's requests per minute (see lib/firecrawl/client).
 * Each stage reports its own result or error; one failing stage does not stop the rest.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const start = Date.now();
  const db = getDb();

  let campaigns: number | { error: string };
  try {
    campaigns = await evaluateAllCampaigns(db);
  } catch (err) {
    console.error("[cron/daily] campaigns failed", err);
    campaigns = { error: message(err) };
  }

  let emails: number | { error: string };
  try {
    emails = await processAllDue(db, createEmailSender(env));
  } catch (err) {
    console.error("[cron/daily] emails failed", err);
    emails = { error: message(err) };
  }

  const sunday = new Date().getUTCDay() === 0;
  if (!env.FIRECRAWL_API_KEY) {
    return Response.json({
      campaigns,
      emails,
      sync: { skipped: SKIPPED },
      links: { skipped: SKIPPED },
      seeded: sunday ? { skipped: SKIPPED } : null,
    });
  }

  const fc = createFirecrawl(env.FIRECRAWL_API_KEY);
  let sync: Awaited<ReturnType<typeof syncStale>> | { error: string };
  try {
    sync = await syncStale(db, fc, { limit: SYNC_LIMIT, budgetMs: SYNC_BUDGET_MS });
  } catch (err) {
    console.error("[cron/daily] sync failed", err);
    sync = { error: message(err) };
  }

  let links: Links;
  const linksBudgetMs = Math.min(sunday ? LINKS_BUDGET_SUNDAY_MS : LINKS_BUDGET_MS, DISCOVERY_BUDGET_MS - (Date.now() - start));
  if (linksBudgetMs <= 0) {
    links = { skipped: "out of budget" };
  } else {
    try {
      links = await enrichPendingLinks(db, fc, { limit: LINKS_LIMIT, budgetMs: linksBudgetMs });
    } catch (err) {
      console.error("[cron/daily] links failed", err);
      links = { error: message(err) };
    }
  }

  let seeded: Seeded | null = null;
  if (sunday) {
    const s = { categories: 0, inserted: 0, seen: 0, errors: [] as string[], outOfBudget: 0 };
    for (const c of TRUSTPILOT_CATEGORIES) {
      if (Date.now() - start >= DISCOVERY_BUDGET_MS) {
        s.outOfBudget++;
        continue;
      }
      try {
        const r = await scrapeTrustpilotCategory(db, fc, c.slug, { max: SEED_MAX_PER_CATEGORY });
        s.categories++;
        s.inserted += r.inserted;
        s.seen += r.seen;
      } catch (err) {
        s.errors.push(`${c.slug}: ${message(err)}`);
        if (err instanceof DiscoveryUnavailable) break;
      }
    }
    seeded = s;
  }

  return Response.json({ campaigns, emails, sync, links, seeded });
}
