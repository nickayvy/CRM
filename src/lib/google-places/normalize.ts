// Google place → `businesses` insert row (architecture §Normalise, row
// contract). Google-owned columns only: no CRM and no qualification fields.
import type { NewBusiness } from "@/db/schema";
import { websiteDomain } from "@/lib/domain";
import { cleanWebsiteUrl } from "@/lib/firecrawl/external-links";
import { normalizeName, phoneDigits } from "@/lib/format";
import { categoryForTypes, categoryLabel, typeTitle } from "./categories";
import { cleanBusinessName } from "./clean-name";
import type { GooglePlace } from "./types";

type Component = NonNullable<GooglePlace["addressComponents"]>[number];

function component(place: GooglePlace, ...types: string[]): Component | null {
  const list = place.addressComponents ?? [];
  for (const t of types) {
    const hit = list.find((c) => Array.isArray(c.types) && c.types.includes(t));
    if (hit) return hit;
  }
  return null;
}

const text = (s: string | null | undefined) => (typeof s === "string" && s.trim() ? s.trim() : null);

/** Street address parts from addressComponents. */
export function addressOf(place: GooglePlace): {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
} {
  const number = text(component(place, "street_number")?.longText);
  const route = text(component(place, "route")?.shortText ?? component(place, "route")?.longText);
  const sub = text(component(place, "subpremise")?.longText);
  const street = [number, route].filter(Boolean).join(" ") || null;
  const stateC = component(place, "administrative_area_level_1");
  return {
    address1: street,
    address2: sub ? (/^\d/.test(sub) ? `#${sub}` : sub) : null,
    city: text(
      (component(place, "locality") ?? component(place, "postal_town") ?? component(place, "sublocality") ?? component(place, "administrative_area_level_3"))
        ?.longText,
    ),
    state: text(stateC?.shortText)?.toUpperCase() ?? null,
    zip: text(component(place, "postal_code")?.longText),
    country: text(component(place, "country")?.shortText)?.toUpperCase() ?? null,
  };
}

/** International number when present, else national; digits compare equal to a Yelp "+1…" number. */
export function phonesOf(place: GooglePlace, country: string | null): {
  phone: string | null;
  phoneDigits: string | null;
  displayPhone: string | null;
} {
  const intl = text(place.internationalPhoneNumber);
  const national = text(place.nationalPhoneNumber);
  const phone = intl ?? national;
  let digits = phoneDigits(phone);
  // A national-only US number ("(214) 555-0123") gets the country code, like the international form.
  if (!intl && digits && digits.length === 10 && (country ?? "US") === "US") digits = `1${digits}`;
  return { phone, phoneDigits: digits, displayPhone: national ?? intl };
}

export function normalizeGooglePlace(
  place: GooglePlace,
  ctx: { jobId?: string; searchCategory: string; searchLocation: string; now?: Date },
): NewBusiness & { googlePlaceId: string } {
  const now = ctx.now ?? new Date();
  const addr = addressOf(place);
  const rawName = text(place.displayName?.text) ?? text(place.formattedAddress) ?? place.id;
  const name = cleanBusinessName(rawName, { city: addr.city, state: addr.state });
  const website = cleanWebsiteUrl(place.websiteUri ?? null);
  const types = Array.isArray(place.types) ? place.types.filter((t) => typeof t === "string" && t) : [];
  const primaryType = text(place.primaryType);
  const slug = categoryForTypes(primaryType, types);

  const categories: { alias: string; title: string }[] = [];
  const seen = new Set<string>();
  const add = (alias: string, title: string) => {
    if (seen.has(alias)) return;
    seen.add(alias);
    categories.push({ alias, title });
  };
  if (slug) add(slug, categoryLabel(slug) ?? typeTitle(slug));
  if (primaryType) add(primaryType, text(place.primaryTypeDisplayName?.text) ?? typeTitle(primaryType));
  for (const t of types) add(t, typeTitle(t));

  const rating = typeof place.rating === "number" && Number.isFinite(place.rating) ? place.rating.toFixed(1) : null;
  const row: NewBusiness & { googlePlaceId: string } = {
    source: "google",
    googlePlaceId: place.id,
    googleMapsUrl: text(place.googleMapsUri),
    name,
    nameNormalized: normalizeName(name),
    ...phonesOf(place, addr.country),
    website,
    slug: websiteDomain(website),
    rating,
    reviewCount: typeof place.userRatingCount === "number" && place.userRatingCount > 0 ? Math.floor(place.userRatingCount) : 0,
    categories,
    primaryCategory: slug,
    subcategory: text(place.primaryTypeDisplayName?.text) ?? (primaryType ? typeTitle(primaryType) : null),
    isClosed: place.businessStatus === "CLOSED_PERMANENTLY",
    ...addr,
    latitude: typeof place.location?.latitude === "number" ? place.location.latitude : null,
    longitude: typeof place.location?.longitude === "number" ? place.location.longitude : null,
    raw: place,
    lastScrapedAt: now,
    searchCategory: ctx.searchCategory,
    searchLocation: ctx.searchLocation,
  };
  if (ctx.jobId) row.sourceJobId = ctx.jobId;
  return row;
}
