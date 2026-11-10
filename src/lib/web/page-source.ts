// The page source link enrichment reads websites through: a FirecrawlLike
// whose scrapePage tries a direct HTTP fetch first and spends a Firecrawl
// request only when that fails or yields a shell. scrapeJson (Trustpilot) is
// Firecrawl's alone. See docs/team/links/architecture.md §Direct fetch.
import {
  DiscoveryUnavailable,
  type FirecrawlLike,
  FirecrawlRateLimited,
  PAGE_TIMEOUT_MS,
  type ScrapedPage,
} from "@/lib/firecrawl/client";
import { socialProfile } from "@/lib/firecrawl/external-links";
import { PageHttpError, UnsafeUrlError, fetchPage } from "./fetch-page";

/** Per-page cap on the direct attempt, so a slow site still leaves room for the fallback inside a row's 45 s. */
export const DIRECT_TIMEOUT_MS = 10_000;
/**
 * Rows a drain enriches at once through a page source. Direct fetches are not
 * paced by Firecrawl's window, and each host still gets at most 2 requests in
 * flight (fetch-page); Firecrawl fallbacks stay at 2 in flight and 10 a
 * minute inside the Firecrawl client whatever this number is.
 */
export const DIRECT_DRAIN_CONCURRENCY = 6;
/** A page with less visible text than this, and no contact or social link, is a shell. */
export const THIN_PAGE_TEXT_CHARS = 200;

/** HTTP statuses that are the site's own answer: Firecrawl would get the same, so it is not asked. */
const FINAL_STATUSES = new Set([404, 410]);

/**
 * True for a page that tells us nothing: under THIN_PAGE_TEXT_CHARS
 * characters of text and no `mailto:`, `tel:` or social-profile link (an app
 * shell rendered by script, a parking page, a bot wall).
 */
export function isThinPage(page: ScrapedPage): boolean {
  const text = (page.markdown ?? "").replace(/\s+/g, " ").trim();
  if (text.length >= THIN_PAGE_TEXT_CHARS) return false;
  return !page.links.some((l) => /^\s*(mailto|tel):/i.test(l) || socialProfile(l) !== null);
}

/** A FirecrawlLike that also tells a drain how many rows it may run at once. */
export type PageSource = FirecrawlLike & { readonly drainConcurrency: number };

/**
 * scrapePage: the direct fetch first (capped at DIRECT_TIMEOUT_MS). With a
 * `firecrawl`, its scrapePage is tried when the direct fetch rejects (except
 * UnsafeUrlError, which is final, and a 404/410, which is the site's answer),
 * resolves null, or resolves a thin page. A thin direct page is kept when the
 * fallback has nothing better (null or a non-rate-limit failure).
 * FirecrawlRateLimited and DiscoveryUnavailable from the fallback propagate.
 * Without a `firecrawl` the direct result, or its failure, stands.
 * scrapeJson passes through to Firecrawl and rejects with DiscoveryUnavailable
 * without one.
 */
export function createPageSource(opts: { firecrawl?: FirecrawlLike | null; direct?: typeof fetchPage }): PageSource {
  const fc = opts.firecrawl ?? null;
  const direct = opts.direct ?? fetchPage;
  return {
    drainConcurrency: DIRECT_DRAIN_CONCURRENCY,

    scrapeJson<T>(url: string, schema: object, o?: { timeoutMs?: number }): Promise<T | null> {
      return fc ? fc.scrapeJson<T>(url, schema, o) : Promise.reject(new DiscoveryUnavailable());
    },

    async scrapePage(url: string, o?: { timeoutMs?: number }): Promise<ScrapedPage | null> {
      const timeoutMs = Math.min(o?.timeoutMs ?? PAGE_TIMEOUT_MS, DIRECT_TIMEOUT_MS);
      let page: ScrapedPage | null = null;
      try {
        page = await direct(url, { timeoutMs });
      } catch (err) {
        if (!fc || err instanceof UnsafeUrlError) throw err;
        if (err instanceof PageHttpError && FINAL_STATUSES.has(err.status)) throw err;
        console.info(`[discovery] direct fetch of ${url} failed, trying Firecrawl:`, err instanceof Error ? err.message : err);
      }
      if (page && !isThinPage(page)) return page;
      if (!fc) return page;

      try {
        return (await fc.scrapePage(url, o)) ?? page;
      } catch (err) {
        if (page && !(err instanceof FirecrawlRateLimited) && !(err instanceof DiscoveryUnavailable)) return page;
        throw err;
      }
    },
  };
}
