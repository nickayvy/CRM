// Thin seam over the Firecrawl v2 SDK so tests inject a fake (FirecrawlLike).
// Trustpilot requests go through one process-wide limiter (1 in flight, 1.5 s
// between requests). Business-website scrapes hit distinct hosts, so they use a
// second limiter: 2 in flight (the Firecrawl plan's concurrency), no gap.
import Firecrawl from "@mendable/firecrawl-js";
import { RateLimiter } from "./rate-limiter";

/** A non-LLM page scrape: every href plus the page markdown. */
export type ScrapedPage = {
  /** URL that was requested. */
  url: string;
  /** URL after redirects, when Firecrawl reports one. */
  finalUrl: string | null;
  /** Every href on the page, as Firecrawl returns them (may include mailto:/tel:). */
  links: string[];
  /** Page markdown (full page, not main-content only), or null. */
  markdown: string | null;
};

export interface FirecrawlLike {
  scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null>;
  /**
   * Non-LLM scrape. Resolves null when the page yields nothing; rejects on
   * transport/HTTP failure and with DiscoveryUnavailable without a key.
   */
  scrapePage(url: string, opts?: { timeoutMs?: number }): Promise<ScrapedPage | null>;
}

/** Thrown whenever discovery is used without FIRECRAWL_API_KEY. */
export class DiscoveryUnavailable extends Error {
  constructor(message = "FIRECRAWL_API_KEY is not set") {
    super(message);
    this.name = "DiscoveryUnavailable";
  }
}

/** User-facing message when FIRECRAWL_API_KEY is absent. */
export const DISCOVERY_NOT_CONFIGURED = "Discovery is not configured: set FIRECRAWL_API_KEY";

export const FIRECRAWL_CONCURRENCY = 1;
export const FIRECRAWL_DELAY_MS = 1500;
/** Concurrent website scrapes (Firecrawl plan limit: 2 concurrent jobs). */
export const WEBSITE_CONCURRENCY = 2;
/** Default per-page timeout for website scrapes. */
export const PAGE_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;

const sharedLimiter = new RateLimiter(FIRECRAWL_CONCURRENCY, FIRECRAWL_DELAY_MS);
const websiteLimiter = new RateLimiter(WEBSITE_CONCURRENCY, 0);

const TRUSTPILOT_HOST_RE = /(^|\.)trustpilot\.com$/i;

/** Trustpilot URLs keep the 1.5 s limiter; everything else uses the website limiter. */
function limiterFor(url: string): RateLimiter {
  try {
    return TRUSTPILOT_HOST_RE.test(new URL(url).hostname) ? sharedLimiter : websiteLimiter;
  } catch {
    return websiteLimiter;
  }
}

/** A JSON schema's top-level `description` doubles as the extraction prompt. */
function promptOf(schema: object): string | undefined {
  const d = (schema as { description?: unknown }).description;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

type RawDoc = {
  links?: unknown;
  markdown?: unknown;
  metadata?: { url?: unknown; sourceURL?: unknown; statusCode?: unknown; error?: unknown };
};

/** Maps a Firecrawl document to a ScrapedPage; throws on an HTTP error status, null when empty. */
export function toScrapedPage(url: string, doc: unknown): ScrapedPage | null {
  const d = (doc && typeof doc === "object" ? doc : {}) as RawDoc;
  const status = typeof d.metadata?.statusCode === "number" ? d.metadata.statusCode : null;
  if (status !== null && status >= 400) {
    throw new Error(`${url} answered HTTP ${status}`);
  }
  const links = Array.isArray(d.links) ? d.links.filter((l): l is string => typeof l === "string") : [];
  const markdown = typeof d.markdown === "string" && d.markdown.trim() !== "" ? d.markdown : null;
  if (links.length === 0 && markdown === null) return null;
  const finalUrl = typeof d.metadata?.url === "string" && d.metadata.url.trim() !== "" ? d.metadata.url : null;
  return { url, finalUrl, links, markdown };
}

/**
 * Real Firecrawl client. Without an API key it is still constructed, but every
 * call rejects with DiscoveryUnavailable, so callers fail clearly on use.
 */
export function createFirecrawl(apiKey?: string): FirecrawlLike {
  const key = apiKey?.trim();
  if (!key) {
    const unavailable = () => Promise.reject(new DiscoveryUnavailable("FIRECRAWL_API_KEY is not set"));
    return { scrapeJson: unavailable, scrapePage: unavailable };
  }
  const fc = new Firecrawl({ apiKey: key });
  return {
    async scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null> {
      const doc = await sharedLimiter.run(() =>
        fc.scrape(url, {
          formats: [{ type: "json", prompt: promptOf(schema), schema: schema as Record<string, unknown> }],
          timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      );
      const json = (doc as { json?: unknown }).json;
      return json && typeof json === "object" ? (json as T) : null;
    },

    async scrapePage(url: string, opts?: { timeoutMs?: number }): Promise<ScrapedPage | null> {
      const doc = await limiterFor(url).run(() =>
        fc.scrape(url, {
          formats: ["links", "markdown"],
          onlyMainContent: false,
          timeout: opts?.timeoutMs ?? PAGE_TIMEOUT_MS,
        }),
      );
      return toScrapedPage(url, doc);
    },
  };
}
