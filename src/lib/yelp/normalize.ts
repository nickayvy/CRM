import type { NewBusiness } from "@/db/schema";
import { normalizeName, phoneDigits } from "@/lib/format";
import type { YelpBusiness, YelpBusinessDetails } from "./types";

/**
 * Yelp record → `businesses` insert row. Contains Yelp-owned columns only:
 * no CRM fields and no qualification fields. `isClaimed`, `photos` and
 * `hours` are included only when the record carries them (details
 * responses), so a later search upsert never clears enrichment data.
 */
export function normalizeYelpBusiness(
  b: YelpBusiness | YelpBusinessDetails,
  ctx: { jobId?: string; searchCategory: string; searchLocation: string },
): NewBusiness {
  const d = b as YelpBusinessDetails;
  const loc = b.location ?? ({} as YelpBusiness["location"]);
  const categories = Array.isArray(b.categories) ? b.categories.map((c) => ({ alias: c.alias, title: c.title })) : [];
  const rating = typeof b.rating === "number" && Number.isFinite(b.rating) ? b.rating.toFixed(1) : null;
  const row: NewBusiness = {
    source: "yelp",
    yelpId: b.id,
    yelpAlias: b.alias ?? null,
    name: b.name,
    nameNormalized: normalizeName(b.name),
    phone: b.phone || null,
    phoneDigits: phoneDigits(b.phone || null),
    displayPhone: b.display_phone || null,
    yelpUrl: b.url || null,
    imageUrl: b.image_url || null,
    rating,
    reviewCount: b.review_count ?? 0,
    price: b.price || null,
    categories,
    primaryCategory: categories[0]?.alias ?? null,
    isClosed: Boolean(b.is_closed),
    address1: loc.address1 || null,
    address2: loc.address2 || null,
    city: loc.city || null,
    state: loc.state || null,
    zip: loc.zip_code || null,
    country: loc.country || null,
    latitude: b.coordinates?.latitude ?? null,
    longitude: b.coordinates?.longitude ?? null,
    distanceM: typeof b.distance === "number" ? b.distance : null,
    transactions: b.transactions ?? [],
    raw: b,
    searchCategory: ctx.searchCategory,
    searchLocation: ctx.searchLocation,
  };
  if (ctx.jobId) row.sourceJobId = ctx.jobId;
  if (typeof d.is_claimed === "boolean") row.isClaimed = d.is_claimed;
  if (Array.isArray(d.photos)) row.photos = d.photos;
  if (Array.isArray(d.hours)) row.hours = d.hours;
  return row;
}
