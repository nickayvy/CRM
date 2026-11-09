import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { evaluateAllCampaigns } from "@/db/repo/call-campaigns";
import { processAllDue } from "@/db/repo/email-campaigns";
import { createEmailSender } from "@/lib/email/sender";
import { env } from "@/lib/env";
import { DiscoveryUnavailable, createFirecrawl } from "@/lib/firecrawl/client";
import { scrapeTrustpilotCategory, syncStale } from "@/lib/firecrawl/trustpilot";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYNC_LIMIT = 12;
const SYNC_BUDGET_MS = 30_000;
const SEED_MAX_PER_CATEGORY = 20;
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

type Seeded =
  | { skipped: string }
  | { categories: number; inserted: number; seen: number; errors: string[]; outOfBudget?: number };

/**
 * The single Vercel cron (0 13 * * *): call-campaign evaluation, due email
 * steps, stale Trustpilot sync (12 rows / 30 s), and on Sundays (UTC) a
 * 20-per-category seed of all 22 categories inside the remaining budget.
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

  return Response.json({ campaigns, emails, sync, seeded });
}
