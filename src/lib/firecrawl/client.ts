// Thin seam over the Firecrawl v2 SDK so tests inject a fake (FirecrawlLike).
// The real client sends every request through one process-wide limiter:
// 1 request in flight, 1.5 s between requests.
import Firecrawl from "@mendable/firecrawl-js";
import { RateLimiter } from "./rate-limiter";

export interface FirecrawlLike {
  scrapeJson<T>(url: string, schema: object, opts?: { timeoutMs?: number }): Promise<T | null>;
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
const DEFAULT_TIMEOUT_MS = 60_000;

const sharedLimiter = new RateLimiter(FIRECRAWL_CONCURRENCY, FIRECRAWL_DELAY_MS);

/** A JSON schema's top-level `description` doubles as the extraction prompt. */
function promptOf(schema: object): string | undefined {
  const d = (schema as { description?: unknown }).description;
  return typeof d === "string" && d.length > 0 ? d : undefined;
}

/**
 * Real Firecrawl client. Without an API key it is still constructed, but every
 * call rejects with DiscoveryUnavailable, so callers fail clearly on use.
 */
export function createFirecrawl(apiKey?: string): FirecrawlLike {
  const key = apiKey?.trim();
  if (!key) {
    return {
      scrapeJson: () => Promise.reject(new DiscoveryUnavailable("FIRECRAWL_API_KEY is not set")),
    };
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
  };
}
