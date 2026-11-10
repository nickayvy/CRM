// Client-safe shapes for the Lookup screen. Server code maps DB rows through
// `toLookupBusiness` so client islands never receive raw/CRM-only columns.
import type { Business, BusinessSource, Qualification } from "@/db/schema";

export type LookupBusiness = {
  id: string;
  source: BusinessSource;
  name: string;
  slug: string | null;
  trustpilotId: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  imageUrl: string | null;
  socialLinks: Record<string, string>;
  /** Category alias (matches the `category` URL filter). */
  category: string | null;
  /** Human title for `category` when the row carries one. */
  categoryTitle: string | null;
  subcategory: string | null;
  city: string | null;
  country: string | null;
  rating: number | null;
  reviewCount: number;
  reviewsLast30d: number;
  aiSummary: string | null;
  hasMetaAds: boolean;
  yelpUrl: string | null;
  /** Google Maps listing (Google rows and rows matched to a Google place). */
  googleMapsUrl: string | null;
  /** "street, city, state zip" from whichever parts the row has; null when it has none. */
  address: string | null;
  qualification: Qualification;
  rejectionReasons: string[];
  /** ISO timestamp of the last scrape, else of the last update. */
  lastSyncedAt: string;
};

export type GraphLink = { source: string; target: string };

/** "1 Elm St, Dallas, TX 75201" from the parts present; null when there are none. */
export function formatAddress(b: Pick<Business, "address1" | "city" | "state" | "zip">): string | null {
  const clean = (s: string | null | undefined) => (s ?? "").trim();
  const stateZip = [clean(b.state), clean(b.zip)].filter(Boolean).join(" ");
  const parts = [clean(b.address1), clean(b.city), stateZip].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function toLookupBusiness(b: Business): LookupBusiness {
  const category = b.primaryCategory ?? b.categories[0]?.alias ?? null;
  const title = b.categories.find((c) => c.alias === category)?.title ?? null;
  const rating = b.rating === null ? null : Number(b.rating);
  const synced = b.lastScrapedAt ?? b.updatedAt;
  return {
    id: b.id,
    source: b.source,
    name: b.name,
    slug: b.slug,
    trustpilotId: b.trustpilotId,
    website: b.website,
    phone: b.phone,
    email: b.email,
    logoUrl: b.logoUrl,
    imageUrl: b.imageUrl,
    socialLinks: b.socialLinks ?? {},
    category,
    categoryTitle: title,
    subcategory: b.subcategory,
    city: b.city,
    country: b.country,
    rating: rating !== null && Number.isFinite(rating) ? rating : null,
    reviewCount: b.reviewCount,
    reviewsLast30d: b.reviewsLast30d,
    aiSummary: b.aiSummary,
    hasMetaAds: b.hasMetaAds,
    yelpUrl: b.yelpUrl,
    googleMapsUrl: b.googleMapsUrl,
    address: formatAddress(b),
    qualification: b.qualification,
    rejectionReasons: b.rejectionReasons,
    lastSyncedAt: new Date(synced).toISOString(),
  };
}
