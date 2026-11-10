// Direct HTTP fetch of one business web page as a ScrapedPage, so link
// enrichment does not spend Firecrawl credits (or its 10-a-minute window) on
// plain HTML sites. Every hop (the first URL and each redirect target) passes
// the SSRF guard before a connection is made, and the default transport
// re-checks the address it actually connects to. See
// docs/team/links/architecture.md §Direct fetch.
import { PAGE_TIMEOUT_MS, type ScrapedPage } from "@/lib/firecrawl/client";
import { HostLimiter } from "./host-limiter";
import { charsetOf, decodeBody, extractLinks, extractText } from "./html";
import { createPinnedFetch } from "./pinned-fetch";
import { type Lookup, UnsafeUrlError, assertSafeUrl, bareHostname, systemLookup } from "./ssrf";

export { UnsafeUrlError } from "./ssrf";

/** Redirects followed by hand; one more is a failure. */
export const MAX_REDIRECTS = 5;
/** Bytes of body read; the rest is never downloaded and the page is parsed as cut. */
export const MAX_BODY_BYTES = 1_500_000;
/** Requests in flight to one host at once, across every caller in the process. */
export const PER_HOST_CONCURRENCY = 2;
/** Browser-like, generic: names no person, project or contact address. */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The site answered with an HTTP error status. */
export class PageHttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`${url} answered HTTP ${status}`);
    this.name = "PageHttpError";
    this.status = status;
  }
}

const hostLimiter = new HostLimiter(PER_HOST_CONCURRENCY);

export type FetchPageOptions = {
  /** Whole-page deadline (every hop and the body), default PAGE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Transport; default is a node:http(s) fetch pinned to vetted addresses. */
  fetch?: typeof fetch;
  /** Resolver for the SSRF check (and for the default transport's connection). */
  lookup?: Lookup;
};

/**
 * Direct GET of an HTML page as a ScrapedPage (links + text in `markdown`).
 * Null when the response is not usable HTML (another content type, or a page
 * with no links and no text). Rejects on transport failure, non-2xx
 * (PageHttpError), more than MAX_REDIRECTS redirects, timeout, or a refused
 * address (UnsafeUrlError, checked on every hop before the request is sent).
 */
export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<ScrapedPage | null> {
  const timeoutMs = opts.timeoutMs ?? PAGE_TIMEOUT_MS;
  const lookup = opts.lookup ?? systemLookup;
  const doFetch = opts.fetch ?? createPinnedFetch({ resolve: lookup });
  const controller = new AbortController();
  // The race also bounds work the signal cannot interrupt (DNS, the host queue).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${url} timed out after ${timeoutMs} ms`);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchHops(url, doFetch, lookup, controller.signal), timedOut]);
  } catch (err) {
    // An abort surfaces as an AbortError from the transport; report the timeout itself.
    if (controller.signal.aborted && !(err instanceof UnsafeUrlError)) throw controller.signal.reason;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHops(url: string, doFetch: typeof fetch, lookup: Lookup, signal: AbortSignal): Promise<ScrapedPage | null> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new UnsafeUrlError(`refused unparsable URL ${url}`);
  }
  for (let hop = 0; ; hop++) {
    await assertSafeUrl(current, lookup);
    const here = current;
    const outcome = await hostLimiter.run(bareHostname(here), async () => {
      const res = await doFetch(here.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "en-US,en;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location) throw new Error(`${here} answered HTTP ${res.status} without a Location`);
        return { done: false, next: new URL(location, here) } as const;
      }
      if (res.status < 200 || res.status > 299) {
        await res.body?.cancel().catch(() => {});
        throw new PageHttpError(here.toString(), res.status);
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!HTML_TYPES.has(type)) {
        await res.body?.cancel().catch(() => {});
        return { done: true, page: null } as const;
      }
      const bytes = await readCapped(res, MAX_BODY_BYTES);
      const html = decodeBody(bytes, charsetOf(res.headers.get("content-type"), bytes));
      return { done: true, page: toPage(url, here.toString(), html) } as const;
    });
    if (outcome.done) return outcome.page;
    if (hop >= MAX_REDIRECTS) throw new Error(`${url}: more than ${MAX_REDIRECTS} redirects`);
    current = outcome.next;
  }
}

function toPage(url: string, finalUrl: string, html: string): ScrapedPage | null {
  const links = extractLinks(html, finalUrl);
  const markdown = extractText(html);
  if (links.length === 0 && markdown === null) return null;
  return { url, finalUrl, links, markdown };
}

/** Reads at most `cap` bytes of the body, then stops the download. */
async function readCapped(res: Response, cap: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.byteLength > cap - total ? value.subarray(0, cap - total) : value;
      chunks.push(take);
      total += take.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
