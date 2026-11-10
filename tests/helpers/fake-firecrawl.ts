// In-memory FirecrawlLike serving pages keyed by exact URL. A value is returned
// as the extracted JSON; an Error is thrown; an unknown URL throws too (so a
// test never silently scrapes something it did not set up). Records every call.
// `scrapeJson` calls land in `calls`; `scrapePage` calls in `pageCalls`.
import type { FirecrawlLike, ScrapedPage } from "@/lib/firecrawl/client";
import { trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import type { TrustpilotProfile } from "./builders";

export type FakePage = object | null | Error;

/** What a fake website page serves: links/markdown/finalUrl (url is filled in), null, or an Error. */
export type FakeSitePage = { links?: string[]; markdown?: string | null; finalUrl?: string | null } | null | Error;

export type FakeFirecrawl = FirecrawlLike & {
  readonly calls: string[];
  readonly pageCalls: string[];
  set(url: string, page: FakePage): void;
  /** Serves `profile` at https://www.trustpilot.com/review/<slug>. */
  setProfile(slug: string, profile: TrustpilotProfile | Error | null): void;
  /** Serves `{ businesses: cards }` at the category URL for `page`. */
  setCategoryPage(categorySlug: string, page: number, cards: object[]): void;
  /** Serves a website page to `scrapePage(url)`. */
  setSite(url: string, page: FakeSitePage): void;
};

export function createFakeFirecrawl(
  pages: Record<string, FakePage> = {},
  opts: { onCall?: (url: string) => void; onPage?: (url: string) => void | Promise<void> } = {},
): FakeFirecrawl {
  const map = new Map<string, FakePage>(Object.entries(pages));
  const sites = new Map<string, FakeSitePage>();
  const calls: string[] = [];
  const pageCalls: string[] = [];
  return {
    calls,
    pageCalls,
    set: (url, page) => void map.set(url, page),
    setProfile: (slug, profile) => void map.set(trustpilotReviewUrl(slug), profile),
    setCategoryPage: (categorySlug, page, cards) =>
      void map.set(trustpilotCategoryUrl(categorySlug, page), { businesses: cards }),
    setSite: (url, page) => void sites.set(url, page),
    async scrapeJson<T>(url: string): Promise<T | null> {
      calls.push(url);
      opts.onCall?.(url);
      if (!map.has(url)) throw new Error(`fake firecrawl: no page for ${url}`);
      const page = map.get(url)!;
      if (page instanceof Error) throw page;
      return page === null ? null : (structuredClone(page) as T);
    },
    async scrapePage(url: string): Promise<ScrapedPage | null> {
      pageCalls.push(url);
      await opts.onPage?.(url);
      if (!sites.has(url)) throw new Error(`fake firecrawl: no site page for ${url}`);
      const page = sites.get(url)!;
      if (page instanceof Error) throw page;
      if (page === null) return null;
      return { url, finalUrl: page.finalUrl ?? null, links: [...(page.links ?? [])], markdown: page.markdown ?? null };
    },
  };
}

/** A category listing card as Firecrawl extracts it. */
export function makeCategoryCard(slug: string, overrides: Record<string, unknown> = {}): object {
  return { name: `Listed ${slug}`, slug, starRating: 4.1, numberOfReviews: 50, location: "United States", ...overrides };
}

/** A typical homepage: footer socials, a contact link, mailto and tel hrefs. */
export function makeSitePage(origin: string, overrides: { links?: string[]; markdown?: string | null; finalUrl?: string | null } = {}) {
  const host = new URL(origin).hostname.replace(/^www\./, "");
  const handle = host.split(".")[0];
  return {
    finalUrl: `${origin}/`,
    links: [
      `${origin}/`,
      `${origin}/pages/contact-us`,
      `https://www.facebook.com/${handle}`,
      `https://twitter.com/${handle}`,
      `https://www.linkedin.com/company/${handle}`,
      `https://www.instagram.com/${handle}/`,
      `mailto:hello@${host}`,
      "tel:+1-512-555-0142",
    ],
    markdown: `# ${handle}`,
    ...overrides,
  };
}
