// External-links enrichment: read the business's own website (non-LLM page
// scrape), pick out website, social profiles, email and phone, persist them
// under the write rules, and drain the pending backlog inside a time budget.
// See docs/team/links/architecture.md §Write rules, §Budgets.
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import { countPendingLinks, listPendingLinkIds } from "@/db/repo/discovery";
import { type Business, type NewBusiness, businesses } from "@/db/schema";
import { qualifyOne } from "@/features/ingest/run";
import { phoneDigits } from "@/lib/format";
import {
  DiscoveryUnavailable,
  type FirecrawlLike,
  FirecrawlRateLimited,
  PAGE_TIMEOUT_MS,
  WEBSITE_CONCURRENCY,
} from "./client";
import { type ExternalLinks, cleanWebsiteUrl, extractExternalLinks, websiteFromSlug } from "./external-links";

export type EnrichStatus = "enriched" | "empty" | "skipped" | "failed";

/** Overall cap for one business (homepage + contact page). */
export const ENRICH_ROW_TIMEOUT_MS = 45_000;
/** Below this much time left, the contact page is not attempted. */
const MIN_PAGE_MS = 5_000;
/** The last row a drain starts still gets at least this long. */
const MIN_ROW_MS = 10_000;
/** A drain only waits out a rate limit when this much budget is left beyond the wait. */
export const RATE_LIMIT_MARGIN_MS = 10_000;

/**
 * Our own time cap ran out (queue wait included) before the row reached a
 * verdict. Not the site's fault: nothing is written and the row stays pending.
 * A site that is slow to answer fails through the seam's per-request timeout.
 */
export class EnrichTimeout extends Error {
  constructor(ms: number) {
    super(`link enrichment timed out after ${ms} ms`);
    this.name = "EnrichTimeout";
  }
}

/** Rejects with EnrichTimeout once `ms` has passed; the timer never outlives the promise. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EnrichTimeout(ms)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** The URL to start from: the cleaned stored website, else `https://<slug>`. */
function startUrl(target: { website: string | null; slug: string | null }): string | null {
  return cleanWebsiteUrl(target.website) ?? websiteFromSlug(target.slug);
}

/**
 * Network only. Scrapes the homepage, then at most ONE same-host contact page
 * when email or phone is still missing. Null = no usable website. Rejects when
 * the homepage scrape fails (site errors and the seam's per-request timeout),
 * with FirecrawlRateLimited / DiscoveryUnavailable from the seam, and with
 * EnrichTimeout when `timeoutMs` (default 45 s, queue wait included) runs out.
 * A failing or rate-limited contact page only loses what it would have added.
 */
export async function resolveExternalLinks(
  fc: FirecrawlLike,
  target: { website: string | null; slug: string | null },
  opts: { timeoutMs?: number } = {},
): Promise<ExternalLinks | null> {
  const start = startUrl(target);
  if (!start) return null;
  const total = opts.timeoutMs ?? ENRICH_ROW_TIMEOUT_MS;
  return withTimeout(resolveFrom(fc, start, Date.now() + total), total);
}

async function resolveFrom(fc: FirecrawlLike, start: string, deadline: number): Promise<ExternalLinks> {
  const left = () => deadline - Date.now();
  const home = await fc.scrapePage(start, { timeoutMs: PAGE_TIMEOUT_MS });
  const fallbackSite = new URL(start).origin;
  if (!home) return { website: fallbackSite, socialLinks: {}, email: null, phone: null };

  const found = extractExternalLinks(home);
  let { socialLinks, email, phone } = found;
  if ((!email || !phone) && found.contactUrl && left() >= MIN_PAGE_MS) {
    try {
      const contact = await fc.scrapePage(found.contactUrl, { timeoutMs: Math.min(PAGE_TIMEOUT_MS, left()) });
      if (contact) {
        const more = extractExternalLinks(contact);
        email ??= more.email;
        phone ??= more.phone;
        socialLinks = { ...more.socialLinks, ...socialLinks };
      }
    } catch (err) {
      if (err instanceof DiscoveryUnavailable) throw err;
      // Includes FirecrawlRateLimited: the homepage already gave a verdict.
      console.warn(`[discovery] contact page ${found.contactUrl} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return { website: found.website ?? fallbackSite, socialLinks, email, phone };
}

/** Errors that say nothing about the site: they propagate and nothing is written. */
const notTheSite = (err: unknown) =>
  err instanceof DiscoveryUnavailable || err instanceof FirecrawlRateLimited || err instanceof EnrichTimeout;

const blank = (v: string | null | undefined) => !v || v.trim() === "";

/**
 * Resolves and persists one business's external links, then re-qualifies it.
 * Write rules: website set when empty (final URL's origin, else
 * `https://<slug>`), an existing website only replaced by its cleaned form;
 * phone and email only when empty; social links merged; `enrichedAt` stamped
 * on enriched, empty and failed. CRM and scrape columns are never written.
 * Never throws for a per-site failure ("failed"). DiscoveryUnavailable,
 * FirecrawlRateLimited and EnrichTimeout (the `timeoutMs` cap ran out) propagate
 * and write nothing, so the row stays pending.
 * "skipped" = no website and no domain-like slug (nothing is written).
 */
export async function enrichBusinessLinks(
  db: Db,
  fc: FirecrawlLike,
  businessId: string,
  opts: { now?: Date; timeoutMs?: number } = {},
): Promise<{ status: EnrichStatus; business: Business }> {
  const b = await getBusiness(db, businessId);
  if (!b) throw new Error(`Business not found: ${businessId}`);

  let status: EnrichStatus;
  let links: ExternalLinks | null = null;
  if (!startUrl(b)) {
    // A stored website that is not a usable URL is a verdict too: stamp it so
    // the drain does not pick the row again every run.
    if (blank(b.website)) return { status: "skipped", business: b };
    status = "failed";
  } else {
    try {
      links = await resolveExternalLinks(fc, b, { timeoutMs: opts.timeoutMs ?? ENRICH_ROW_TIMEOUT_MS });
    } catch (err) {
      if (notTheSite(err)) throw err;
      console.warn(`[discovery] links ${b.website ?? b.slug} failed:`, err instanceof Error ? err.message : err);
    }
    const foundSomething =
      !!links && (Object.keys(links.socialLinks).length > 0 || !!links.email || !!links.phone);
    status = !links ? "failed" : foundSomething ? "enriched" : "empty";
  }

  const now = opts.now ?? new Date();
  const patch: Partial<NewBusiness> = { enrichedAt: now, updatedAt: now };
  if (blank(b.website)) {
    const website = links?.website ?? websiteFromSlug(b.slug);
    if (website) patch.website = website;
  } else {
    const cleaned = cleanWebsiteUrl(b.website);
    if (cleaned && cleaned !== b.website) patch.website = cleaned;
  }
  if (links) {
    if (blank(b.phone) && links.phone) {
      patch.phone = links.phone;
      patch.phoneDigits = phoneDigits(links.phone);
    }
    if (blank(b.email) && links.email) patch.email = links.email;
    if (Object.keys(links.socialLinks).length > 0) patch.socialLinks = { ...(b.socialLinks ?? {}), ...links.socialLinks };
  }
  await db.update(businesses).set(patch).where(eq(businesses.id, b.id));

  const updated = (await getBusiness(db, b.id))!;
  await qualifyOne(db, updated);
  return { status, business: (await getBusiness(db, b.id))! };
}

/**
 * Drains rows pending link enrichment: `ids` first (those still pending, in
 * the given order), then never-enriched rows (oldest first), then stale-empty
 * rows, up to `limit`, `concurrency` (default 2) at a time. No new row starts
 * once `budgetMs` has elapsed on the `now` clock. On FirecrawlRateLimited the
 * drain waits `retryAfterMs` (via `sleep`) and retries that row when the wait
 * plus 10 s still fits the budget, else it stops starting rows; rate-limited
 * rows are not counted and stay pending (`rateLimited: true`). A row that hits
 * its own time cap is not counted either and stays pending.
 * DiscoveryUnavailable stops the drain and propagates. `remaining` = rows
 * still pending afterwards.
 */
export async function enrichPendingLinks(
  db: Db,
  fc: FirecrawlLike,
  opts: {
    limit: number;
    budgetMs: number;
    ids?: string[];
    concurrency?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ enriched: number; empty: number; failed: number; remaining: number; rateLimited: boolean }> {
  const clock = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = clock();
  const left = () => opts.budgetMs - (clock() - started);
  const limit = Math.max(0, Math.floor(opts.limit));
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? WEBSITE_CONCURRENCY));

  let queue: string[] = [];
  if (limit > 0) {
    const given = [...new Set(opts.ids ?? [])];
    const pendingGiven = given.length
      ? new Set(await listPendingLinkIds(db, { ids: given, limit: given.length }))
      : new Set<string>();
    queue = given.filter((id) => pendingGiven.has(id)).slice(0, limit);
    if (queue.length < limit) {
      queue.push(...(await listPendingLinkIds(db, { limit: limit - queue.length, exclude: queue })));
    }
  }

  const counts = { enriched: 0, empty: 0, failed: 0 };
  let rateLimited = false;
  let stopped = false;
  let fatal: unknown = null;
  /** One shared wait after a 429, so no worker starts a row while it runs. */
  let pause: Promise<void> | null = null;
  const worker = async () => {
    while (fatal === null && !stopped) {
      if (pause) await pause;
      if (left() <= 0) return;
      const id = queue.shift();
      if (id === undefined) return;
      const timeoutMs = Math.min(ENRICH_ROW_TIMEOUT_MS, Math.max(MIN_ROW_MS, left()));
      try {
        const { status } = await enrichBusinessLinks(db, fc, id, { timeoutMs });
        if (status !== "skipped") counts[status]++;
      } catch (err) {
        if (err instanceof DiscoveryUnavailable) {
          fatal = err;
          return;
        }
        if (err instanceof FirecrawlRateLimited) {
          rateLimited = true;
          if (err.retryAfterMs + RATE_LIMIT_MARGIN_MS <= left()) {
            console.warn(`[discovery] rate limited; waiting ${err.retryAfterMs} ms`);
            queue.unshift(id);
            pause ??= sleep(err.retryAfterMs).finally(() => {
              pause = null;
            });
          } else {
            console.warn(`[discovery] rate limited; stopping the drain (${queue.length + 1} rows left in this run)`);
            stopped = true;
          }
          continue;
        }
        if (err instanceof EnrichTimeout) {
          console.warn(`[discovery] enrich ${id} ran out of time; left pending`);
          continue;
        }
        // A DB error on one row: count it and carry on.
        counts.failed++;
        console.warn(`[discovery] enrich ${id} failed:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, worker));
  if (fatal !== null) throw fatal;

  return { ...counts, remaining: await countPendingLinks(db), rateLimited };
}
