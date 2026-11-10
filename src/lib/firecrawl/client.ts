// Thin seam over the Firecrawl v2 SDK so tests inject a fake (FirecrawlLike).
// Trustpilot requests go through one process-wide limiter (1 in flight, 1.5 s
// between requests). Business-website scrapes hit distinct hosts, so they use a
// second limiter: 2 in flight (the Firecrawl plan's concurrency), no gap. On
// top of both, every request start is paced by one process-wide rolling window
// (FIRECRAWL_REQUESTS_PER_MINUTE, default 10, the plan's req/min), and an API
// 429 surfaces as FirecrawlRateLimited.
import Firecrawl from "@mendable/firecrawl-js";
import { env } from "@/lib/env";
import { RateLimiter, WindowLimiter } from "./rate-limiter";

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

/**
 * The Firecrawl API answered HTTP 429 (plan requests-per-minute exhausted).
 * Not a failure of the scraped site: callers must not record it against a row.
 */
export class FirecrawlRateLimited extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message = "Firecrawl rate limit exceeded") {
    super(message);
    this.name = "FirecrawlRateLimited";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Retry wait when the 429 carries no hint. */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

const positiveSeconds = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Maps an SDK error to FirecrawlRateLimited when it is an API 429, else null.
 * SDK v4 throws `SdkError` with `status: 429` and the response body in
 * `details` (`retry_after_seconds`); response headers are not exposed, but a
 * raw axios-style `response.headers["retry-after"]` is honoured if present.
 * The message text is only consulted when the error carries no status at all.
 */
export function rateLimitFrom(err: unknown): FirecrawlRateLimited | null {
  if (err instanceof FirecrawlRateLimited) return err;
  if (!err || typeof err !== "object") return null;
  const e = err as {
    status?: unknown;
    message?: unknown;
    details?: unknown;
    response?: { status?: unknown; headers?: Record<string, unknown> };
  };
  const status = typeof e.status === "number" ? e.status : typeof e.response?.status === "number" ? e.response.status : null;
  const message = typeof e.message === "string" ? e.message : "";
  const is429 = status === 429 || (status === null && /rate limit exceeded/i.test(message));
  if (!is429) return null;

  const details = e.details && typeof e.details === "object" ? (e.details as Record<string, unknown>) : {};
  const seconds =
    positiveSeconds(e.response?.headers?.["retry-after"]) ??
    positiveSeconds(details.retry_after_seconds) ??
    positiveSeconds(details.retryAfterSeconds) ??
    positiveSeconds(/retry after (\d+(?:\.\d+)?)\s*s/i.exec(message)?.[1]);
  const retryAfterMs = seconds === null ? DEFAULT_RETRY_AFTER_MS : Math.ceil(seconds * 1000);
  return new FirecrawlRateLimited(retryAfterMs, message ? message.split(". Upgrade")[0] : undefined);
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
/** Grace on top of Firecrawl's own `timeout` before a request is abandoned. */
const REQUEST_GRACE_MS = 5_000;

let pacer: WindowLimiter | null = null;
/** The process-wide requests-per-minute window, created on first use from env. */
export function requestPacer(): WindowLimiter {
  pacer ??= new WindowLimiter(env.FIRECRAWL_REQUESTS_PER_MINUTE, 60_000);
  return pacer;
}

/** Drops the window so the next use re-reads env (tests only). */
export function resetRequestPacer(): void {
  pacer = null;
}

/**
 * Runs one Firecrawl request: the concurrency limiter for its host, then a
 * slot in the per-minute window, then the request itself with a timeout that
 * starts only now (queue time never counts against the scraped site). A 429
 * becomes FirecrawlRateLimited.
 */
async function paced<T>(url: string, timeoutMs: number, request: () => Promise<T>): Promise<T> {
  return limiterFor(url).run(async () => {
    await requestPacer().acquire();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${url} timed out after ${timeoutMs} ms`)), timeoutMs + REQUEST_GRACE_MS);
    });
    try {
      return await Promise.race([request(), timeout]);
    } catch (err) {
      throw rateLimitFrom(err) ?? err;
    } finally {
      clearTimeout(timer);
    }
  });
}

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
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const doc = await sharedLimiter.run(async () => {
        await requestPacer().acquire();
        try {
          return await fc.scrape(url, {
            formats: [{ type: "json", prompt: promptOf(schema), schema: schema as Record<string, unknown> }],
            timeout: timeoutMs,
          });
        } catch (err) {
          throw rateLimitFrom(err) ?? err;
        }
      });
      const json = (doc as { json?: unknown }).json;
      return json && typeof json === "object" ? (json as T) : null;
    },

    async scrapePage(url: string, opts?: { timeoutMs?: number }): Promise<ScrapedPage | null> {
      const timeoutMs = opts?.timeoutMs ?? PAGE_TIMEOUT_MS;
      const doc = await paced(url, timeoutMs, () =>
        fc.scrape(url, { formats: ["links", "markdown"], onlyMainContent: false, timeout: timeoutMs, autoResume: false }),
      );
      return toScrapedPage(url, doc);
    },
  };
}
