// Trustpilot discovery over Firecrawl, ported from gtm lib/firecrawl/* onto the
// Drizzle repos: profile scrape (upsert, snapshot, velocity, relations,
// qualification), category seed (basic rows), website enrichment, and the
// time-boxed stale sync. See docs/team/v2/architecture.md §Discovery.
import { and, count, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness } from "@/db/repo/businesses";
import {
  addRelation,
  addSnapshot,
  getBusinessByTrustpilotId,
  listSnapshots,
  listStaleBusinesses,
  upsertBusinessByTrustpilotId,
} from "@/db/repo/discovery";
import { type Business, type NewBusiness, type ReviewSnapshot, businesses } from "@/db/schema";
import { qualifyOne } from "@/features/ingest/run";
import { normalizeName, phoneDigits } from "@/lib/format";
import { TRUSTPILOT_CATEGORIES, trustpilotCategoryUrl, trustpilotReviewUrl } from "@/lib/trustpilot-categories";
import { DiscoveryUnavailable, type FirecrawlLike } from "./client";
import type { RateLimiter } from "./rate-limiter";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Trustpilot lists 20 businesses per category page. */
export const CATEGORY_PAGE_SIZE = 20;
/** A row is due for re-sync once its last scrape is this old. */
export const STALE_AFTER_HOURS = 24;

export type TrustpilotProfile = {
  displayName: string;
  websiteUrl?: string;
  phone?: string;
  email?: string;
  locationCity?: string;
  locationCountry?: string;
  categories: string[];
  numberOfReviews: number;
  stars?: number;
  trustScore?: number;
  relatedBusinessSlugs: string[];
  socialLinks: Record<string, string>;
  numberOfVisibleReviews?: number;
  oldestVisibleReviewDate?: string;
};

// ------------------------------------------------------------ extraction schemas
// The top-level `description` is sent to Firecrawl as the extraction prompt.

export const PROFILE_SCHEMA = {
  type: "object",
  description:
    "Extract the business shown on this Trustpilot profile page: display name, website URL, phone number, email address, " +
    "city and country (separately), every category listed (most specific last), the total number of reviews, the star rating (1-5), " +
    "the TrustScore (0-10), the slugs of related businesses from 'People also looked at' or similar sections (only the SLUG part of " +
    "/review/SLUG links), and social media links (facebook, twitter, linkedin, instagram). For velocity, also count the review cards " +
    "visible on this page (numberOfVisibleReviews) and give the date of the OLDEST visible review (the bottom card; reviews are " +
    "newest first) as YYYY-MM-DD (oldestVisibleReviewDate).",
  properties: {
    displayName: { type: "string" },
    websiteUrl: { type: "string" },
    phone: { type: "string" },
    email: { type: "string" },
    locationCity: { type: "string" },
    locationCountry: { type: "string" },
    categories: { type: "array", items: { type: "string" } },
    numberOfReviews: { type: "number" },
    stars: { type: "number" },
    trustScore: { type: "number" },
    relatedBusinessSlugs: { type: "array", items: { type: "string" } },
    socialLinks: {
      type: "object",
      properties: {
        facebook: { type: "string" },
        twitter: { type: "string" },
        linkedin: { type: "string" },
        instagram: { type: "string" },
      },
    },
    numberOfVisibleReviews: { type: "number" },
    oldestVisibleReviewDate: { type: "string" },
  },
  required: ["displayName", "numberOfReviews"],
} as const;

export const CATEGORY_SCHEMA = {
  type: "object",
  description:
    "Extract every business card listed on this Trustpilot category page. For each: the business name, the slug (the domain-like " +
    "identifier from its /review/SLUG link, e.g. 'example.com'), the star rating (1-5), the total number of reviews, and the " +
    "location/country if shown.",
  properties: {
    businesses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          starRating: { type: "number" },
          numberOfReviews: { type: "number" },
          location: { type: "string" },
        },
      },
    },
  },
} as const;

export const WEBSITE_SCHEMA = {
  type: "object",
  description:
    "Extract contact information from this business website: the main phone number, the main contact email address, and social " +
    "media profile links (facebook, twitter, linkedin, instagram).",
  properties: {
    phone: { type: "string" },
    email: { type: "string" },
    socialLinks: {
      type: "object",
      properties: {
        facebook: { type: "string" },
        twitter: { type: "string" },
        linkedin: { type: "string" },
        instagram: { type: "string" },
      },
    },
  },
} as const;

// ------------------------------------------------------------ pure helpers

const TRUSTPILOT_REVIEW_RE = /^https?:\/\/(?:www\.|[a-z]{2}\.)?trustpilot\.com\/review\/([^/?#\s]+)\/?(?:[?#].*)?$/i;

/** `https://www.trustpilot.com/review/<slug>` → `<slug>` (lowercased); anything else → null. */
export function slugFromTrustpilotUrl(url: string): string | null {
  const m = TRUSTPILOT_REVIEW_RE.exec(url.trim());
  if (!m) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  slug = slug.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._~-]*$/.test(slug) ? slug : null;
}

/** Cleans a slug as Firecrawl returns it ("/review/acme.com/", full URL, or bare). */
function cleanSlug(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return slugFromTrustpilotUrl(t);
  const bare = t.replace(/^\/?review\//i, "").replace(/\/+$/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9._~-]*$/.test(bare) ? bare : null;
}

/** Google favicon service; only for domain-like slugs. */
export function logoUrlForSlug(slug: string): string | null {
  if (!slug.includes(".")) return null;
  return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${slug}&size=128`;
}

/** "Electronics & Technology" → "electronics_technology". */
export function categoryAlias(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type SnapshotPoint = Pick<ReviewSnapshot, "totalReviews" | "capturedAt">;

/**
 * Reviews per 30 days (gtm rules):
 * 1. Snapshot method — prefer the newest snapshot at least 30 days old
 *    (`current - then`); otherwise extrapolate from the oldest snapshot at
 *    least 1 hour old (`delta / days * 30`). Negative deltas clamp to 0.
 * 2. If that yields 0, the rate method: `round(visible / max(daySpan, 7) * 30)`
 *    from the visible review count and the oldest visible review's date.
 * 3. Otherwise 0.
 */
export function computeVelocity(args: {
  snapshots: SnapshotPoint[];
  current: number;
  now: Date;
  visible?: number;
  oldestVisibleDate?: string;
}): number {
  const t = args.now.getTime();
  const usable = args.snapshots.filter((s) => s.capturedAt.getTime() <= t - HOUR_MS);

  let snapshotVelocity = 0;
  const monthOld = usable
    .filter((s) => s.capturedAt.getTime() <= t - 30 * DAY_MS)
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  if (monthOld) {
    snapshotVelocity = Math.max(0, args.current - monthOld.totalReviews);
  } else {
    const oldest = [...usable].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())[0];
    if (oldest) {
      const days = (t - oldest.capturedAt.getTime()) / DAY_MS;
      if (days > 0) snapshotVelocity = Math.max(0, Math.round(((args.current - oldest.totalReviews) / days) * 30));
    }
  }
  if (snapshotVelocity > 0) return snapshotVelocity;

  const visible = args.visible;
  if (typeof visible === "number" && Number.isFinite(visible) && visible > 0 && args.oldestVisibleDate) {
    const oldest = new Date(args.oldestVisibleDate).getTime();
    if (!Number.isNaN(oldest)) {
      const daySpan = (t - oldest) / DAY_MS;
      if (daySpan > 0) return Math.max(0, Math.round((visible / Math.max(daySpan, 7)) * 30));
    }
  }
  return 0;
}

// ------------------------------------------------------------ untrusted extract → typed values

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const inRange = (v: number | undefined, lo: number, hi: number) => (v !== undefined && v >= lo && v <= hi ? v : undefined);

function links(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) {
      const s = str(val);
      if (s) out[k] = s;
    }
  }
  return out;
}

/** Normalizes Firecrawl's JSON into a TrustpilotProfile; missing name → slug, missing count → 0, out-of-range scores dropped. */
export function toTrustpilotProfile(raw: unknown, slug: string): TrustpilotProfile {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reviews = num(r.numberOfReviews);
  return {
    displayName: str(r.displayName) ?? slug,
    websiteUrl: str(r.websiteUrl),
    phone: str(r.phone),
    email: str(r.email),
    locationCity: str(r.locationCity),
    locationCountry: str(r.locationCountry),
    categories: Array.isArray(r.categories) ? r.categories.map(str).filter((c): c is string => !!c) : [],
    numberOfReviews: reviews !== undefined && reviews >= 0 ? Math.round(reviews) : 0,
    stars: inRange(num(r.stars), 0, 5),
    trustScore: inRange(num(r.trustScore), 0, 10),
    relatedBusinessSlugs: Array.isArray(r.relatedBusinessSlugs)
      ? r.relatedBusinessSlugs.map(cleanSlug).filter((s): s is string => !!s)
      : [],
    socialLinks: links(r.socialLinks),
    numberOfVisibleReviews: num(r.numberOfVisibleReviews),
    oldestVisibleReviewDate: str(r.oldestVisibleReviewDate),
  };
}

// ------------------------------------------------------------ profile scrape

/**
 * Scrapes one Trustpilot profile and stores it: upsert by slug (CRM fields
 * untouched; contact fields absent from the page keep their stored value),
 * velocity from prior snapshots, a new snapshot, "similar" relations to slugs
 * already in the DB, then qualification. Returns the stored row.
 */
export async function scrapeTrustpilotBusiness(
  db: Db,
  fc: FirecrawlLike,
  url: string,
  now: Date = new Date(),
): Promise<Business> {
  const slug = slugFromTrustpilotUrl(url);
  if (!slug) throw new Error(`Not a Trustpilot review URL: ${url}`);

  const raw = await fc.scrapeJson<Record<string, unknown>>(trustpilotReviewUrl(slug), PROFILE_SCHEMA);
  if (!raw) throw new Error(`Firecrawl returned no data for ${slug}`);
  const p = toTrustpilotProfile(raw, slug);

  const existing = await getBusinessByTrustpilotId(db, slug);
  const snapshots = existing ? await listSnapshots(db, existing.id) : [];
  const reviewsLast30d = computeVelocity({
    snapshots,
    current: p.numberOfReviews,
    now,
    visible: p.numberOfVisibleReviews,
    oldestVisibleDate: p.oldestVisibleReviewDate,
  });

  const row: NewBusiness & { trustpilotId: string } = {
    trustpilotId: slug,
    source: "trustpilot",
    slug,
    name: p.displayName,
    nameNormalized: normalizeName(p.displayName),
    // Absent → undefined → the stored value is kept on rescrape.
    phone: p.phone,
    phoneDigits: p.phone ? phoneDigits(p.phone) : undefined,
    website: p.websiteUrl,
    email: p.email,
    city: p.locationCity,
    country: p.locationCountry,
    primaryCategory: p.categories[0],
    subcategory: p.categories[1],
    categories: p.categories.map((title) => ({ alias: categoryAlias(title), title })),
    rating: p.stars === undefined ? null : p.stars.toFixed(1),
    reviewCount: p.numberOfReviews,
    trustScore: p.trustScore === undefined ? null : p.trustScore.toFixed(1),
    socialLinks: { ...(existing?.socialLinks ?? {}), ...p.socialLinks },
    logoUrl: logoUrlForSlug(slug),
    raw: { ...raw },
    lastScrapedAt: now,
    reviewsLast30d,
  };
  const { business } = await upsertBusinessByTrustpilotId(db, row);
  await addSnapshot(db, business.id, p.numberOfReviews, now);

  for (const related of new Set(p.relatedBusinessSlugs)) {
    if (related === slug) continue;
    const target = await getBusinessByTrustpilotId(db, related);
    if (target) await addRelation(db, business.id, target.id, "similar");
  }

  await qualifyOne(db, business);
  return (await getBusiness(db, business.id))!;
}

// ------------------------------------------------------------ category seed

type CategoryCard = { name?: unknown; slug?: unknown; starRating?: unknown; numberOfReviews?: unknown; location?: unknown };

/**
 * Pages a Trustpilot category (`?page=N`, 20 per page) and inserts a basic row
 * (name, slug, rating, reviews, country, logo; `lastScrapedAt` null so the
 * sync picks it up first) for each new slug, up to `max` (default 50).
 * Existing slugs are left untouched. `seen` = distinct slugs considered.
 * Stops paging at the first empty or failed page; DiscoveryUnavailable propagates.
 */
export async function scrapeTrustpilotCategory(
  db: Db,
  fc: FirecrawlLike,
  categorySlug: string,
  opts: { max?: number; limiter?: RateLimiter } = {},
): Promise<{ inserted: number; seen: number }> {
  const max = Math.max(0, Math.floor(opts.max ?? 50));
  const pages = Math.ceil(max / CATEGORY_PAGE_SIZE);
  const label = TRUSTPILOT_CATEGORIES.find((c) => c.slug === categorySlug)?.label ?? categorySlug;

  const cards = new Map<string, CategoryCard>();
  for (let page = 1; page <= pages && cards.size < max; page++) {
    const url = trustpilotCategoryUrl(categorySlug, page);
    const call = () => fc.scrapeJson<{ businesses?: unknown }>(url, CATEGORY_SCHEMA);
    let data: { businesses?: unknown } | null;
    try {
      data = await (opts.limiter ? opts.limiter.run(call) : call());
    } catch (err) {
      if (err instanceof DiscoveryUnavailable) throw err;
      console.warn(`[discovery] category ${categorySlug} page ${page} failed:`, err);
      break;
    }
    const list = Array.isArray(data?.businesses) ? (data.businesses as CategoryCard[]) : [];
    if (list.length === 0) break;
    for (const card of list) {
      const slug = cleanSlug(card?.slug);
      if (slug && !cards.has(slug) && cards.size < max) cards.set(slug, card);
    }
  }

  let inserted = 0;
  for (const [slug, card] of cards) {
    if (await getBusinessByTrustpilotId(db, slug)) continue;
    const name = str(card.name) ?? slug;
    const stars = inRange(num(card.starRating), 0, 5);
    const reviews = num(card.numberOfReviews);
    const { created } = await upsertBusinessByTrustpilotId(db, {
      trustpilotId: slug,
      source: "trustpilot",
      slug,
      name,
      nameNormalized: normalizeName(name),
      rating: stars === undefined ? null : stars.toFixed(1),
      reviewCount: reviews !== undefined && reviews >= 0 ? Math.round(reviews) : 0,
      country: str(card.location) ?? null,
      primaryCategory: label,
      categories: [{ alias: categorySlug, title: label }],
      logoUrl: logoUrlForSlug(slug),
      raw: { ...card, categorySlug },
      lastScrapedAt: null,
    });
    if (created) inserted++;
  }
  return { inserted, seen: cards.size };
}

// ------------------------------------------------------------ website enrichment

/**
 * Scrapes the business's own website for contact details. Fills phone/email
 * only when missing, merges social links, stamps `enrichedAt`, re-qualifies.
 */
export async function enrichFromWebsite(db: Db, fc: FirecrawlLike, businessId: string): Promise<Business> {
  const b = await getBusiness(db, businessId);
  if (!b) throw new Error(`Business not found: ${businessId}`);
  if (!b.website) throw new Error(`${b.name} has no website to enrich from`);

  const raw = await fc.scrapeJson<Record<string, unknown>>(b.website, WEBSITE_SCHEMA);
  const r = raw ?? {};
  const phone = str(r.phone);
  const email = str(r.email);
  const social = links(r.socialLinks ?? r.social_links);

  const now = new Date();
  const patch: Partial<NewBusiness> = { enrichedAt: now, updatedAt: now };
  if (!b.phone && phone) {
    patch.phone = phone;
    patch.phoneDigits = phoneDigits(phone);
  }
  if (!b.email && email) patch.email = email;
  if (Object.keys(social).length > 0) patch.socialLinks = { ...b.socialLinks, ...social };
  await db.update(businesses).set(patch).where(eq(businesses.id, businessId));

  const updated = (await getBusiness(db, businessId))!;
  await qualifyOne(db, updated);
  return (await getBusiness(db, businessId))!;
}

// ------------------------------------------------------------ stale sync

async function countStale(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * HOUR_MS);
  const [r] = await db
    .select({ n: count() })
    .from(businesses)
    .where(
      and(
        eq(businesses.source, "trustpilot"),
        or(isNull(businesses.lastScrapedAt), lt(businesses.lastScrapedAt, cutoff)),
      ),
    );
  return Number(r?.n ?? 0);
}

/**
 * Re-scrapes up to `limit` stale Trustpilot rows (never-scraped first, then
 * oldest). No new scrape starts once `budgetMs` has elapsed. Per-row failures
 * are counted, not thrown; DiscoveryUnavailable propagates. `remaining` = stale
 * Trustpilot rows left afterwards (failed rows included).
 */
export async function syncStale(
  db: Db,
  fc: FirecrawlLike,
  opts: { limit: number; budgetMs: number; now?: Date },
): Promise<{ scraped: number; failed: number; remaining: number }> {
  const start = Date.now();
  const rows = await listStaleBusinesses(db, {
    olderThanHours: STALE_AFTER_HOURS,
    limit: opts.limit,
    source: "trustpilot",
  });
  let scraped = 0;
  let failed = 0;
  for (const b of rows) {
    if (Date.now() - start >= opts.budgetMs) break;
    if (!b.trustpilotId) continue;
    try {
      await scrapeTrustpilotBusiness(db, fc, trustpilotReviewUrl(b.trustpilotId), opts.now ?? new Date());
      scraped++;
    } catch (err) {
      if (err instanceof DiscoveryUnavailable) throw err;
      failed++;
      console.warn(`[discovery] sync ${b.trustpilotId} failed:`, err);
    }
  }
  return { scraped, failed, remaining: await countStale(db) };
}
