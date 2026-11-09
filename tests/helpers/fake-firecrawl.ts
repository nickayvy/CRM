// In-memory FirecrawlLike serving pages keyed by exact URL. A value is returned
// as the extracted JSON; an Error is thrown; an unknown URL throws too (so a
// test never silently scrapes something it did not set up). Records every call.
import type { FirecrawlLike } from "@/lib/firecrawl/client";
import { trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import type { TrustpilotProfile } from "./builders";

export type FakePage = object | null | Error;

export type FakeFirecrawl = FirecrawlLike & {
  readonly calls: string[];
  set(url: string, page: FakePage): void;
  /** Serves `profile` at https://www.trustpilot.com/review/<slug>. */
  setProfile(slug: string, profile: TrustpilotProfile | Error | null): void;
  /** Serves `{ businesses: cards }` at the category URL for `page`. */
  setCategoryPage(categorySlug: string, page: number, cards: object[]): void;
};

export function createFakeFirecrawl(
  pages: Record<string, FakePage> = {},
  opts: { onCall?: (url: string) => void } = {},
): FakeFirecrawl {
  const map = new Map<string, FakePage>(Object.entries(pages));
  const calls: string[] = [];
  return {
    calls,
    set: (url, page) => void map.set(url, page),
    setProfile: (slug, profile) => void map.set(trustpilotReviewUrl(slug), profile),
    setCategoryPage: (categorySlug, page, cards) =>
      void map.set(trustpilotCategoryUrl(categorySlug, page), { businesses: cards }),
    async scrapeJson<T>(url: string): Promise<T | null> {
      calls.push(url);
      opts.onCall?.(url);
      if (!map.has(url)) throw new Error(`fake firecrawl: no page for ${url}`);
      const page = map.get(url)!;
      if (page instanceof Error) throw page;
      return page === null ? null : (structuredClone(page) as T);
    },
  };
}

/** A category listing card as Firecrawl extracts it. */
export function makeCategoryCard(slug: string, overrides: Record<string, unknown> = {}): object {
  return { name: `Listed ${slug}`, slug, starRating: 4.1, numberOfReviews: 50, location: "United States", ...overrides };
}
