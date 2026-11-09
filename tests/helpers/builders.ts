// Test-data builders. Every test builds its own records; nothing is read from
// disk. Each builder returns a fresh, valid object with unique ids/phones and
// accepts overrides for the fields a test cares about.
import type { Db } from "@/db/client";
import { upsertBusinessByYelpId } from "@/db/repo/businesses";
import type { Business, NewBusiness } from "@/db/schema";
import { normalizeName, phoneDigits } from "@/lib/format";
import { type YelpBusiness, normalizeYelpBusiness } from "@/lib/yelp";

let seq = 0;
/** Monotonic counter shared by all builders (unique ids, names and phones per process). */
export function nextSeq(): number {
  return ++seq;
}

/** Shape from docs/team/v2/architecture.md §Discovery (WP-13 owns the real type). */
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

/** A Yelp search record: open, rated 4.5 with 25 reviews, plumbing, Houston TX, 5 km away, unique phone. */
export function makeYelpBusiness(overrides: Partial<YelpBusiness> = {}): YelpBusiness {
  const n = nextSeq();
  const digits = String(n).padStart(4, "0").slice(-4);
  const city = overrides.location?.city ?? "Houston";
  return {
    id: `yelp-${n}`,
    alias: `test-business-${n}-${city.toLowerCase().replace(/\s+/g, "-")}`,
    name: `Test Business ${n}`,
    image_url: `https://img.example.test/${n}.jpg`,
    is_closed: false,
    url: `https://www.yelp.com/biz/test-business-${n}`,
    review_count: 25,
    categories: [{ alias: "plumbing", title: "Plumbing" }],
    rating: 4.5,
    coordinates: { latitude: 29.76, longitude: -95.37 },
    transactions: [],
    location: {
      address1: `${n} Main St`,
      address2: null,
      address3: null,
      city: "Houston",
      zip_code: "77002",
      country: "US",
      state: "TX",
      display_address: [`${n} Main St`, "Houston, TX 77002"],
    },
    phone: `+1713555${digits}`,
    display_phone: `(713) 555-${digits}`,
    distance: 5000,
    ...overrides,
  };
}

/**
 * A `businesses` insert row for a Yelp business (via `normalizeYelpBusiness`),
 * searched as "plumbing" in "Houston, TX". Overrides win, so CRM fields,
 * qualification, or Trustpilot columns can be set directly.
 */
export function makeBusinessRow(overrides: Partial<NewBusiness> = {}): NewBusiness {
  const row = normalizeYelpBusiness(makeYelpBusiness(), { searchCategory: "plumbing", searchLocation: "Houston, TX" });
  const merged: NewBusiness = { ...row, ...overrides };
  if (overrides.name !== undefined && overrides.nameNormalized === undefined) {
    merged.nameNormalized = normalizeName(overrides.name);
  }
  if (overrides.phone !== undefined && overrides.phoneDigits === undefined) {
    merged.phoneDigits = phoneDigits(overrides.phone);
  }
  return merged;
}

/** A Trustpilot-sourced insert row (no yelpId), keyed by a unique `trustpilotId` slug. */
export function makeTrustpilotRow(
  overrides: Partial<NewBusiness> = {},
): NewBusiness & { trustpilotId: string } {
  const n = nextSeq();
  const slug = overrides.trustpilotId ?? `brand${n}.example.com`;
  const name = overrides.name ?? `Brand ${n}`;
  return {
    source: "trustpilot",
    yelpId: null,
    name,
    nameNormalized: normalizeName(name),
    slug,
    website: `https://${slug}`,
    categories: [{ alias: "electronics_technology", title: "Electronics & Technology" }],
    primaryCategory: "electronics_technology",
    reviewCount: 120,
    rating: "4.2",
    country: "US",
    raw: { slug },
    ...overrides,
    trustpilotId: slug,
  };
}

/** A Trustpilot profile as WP-13's extractor returns it. */
export function makeTrustpilotProfile(overrides: Partial<TrustpilotProfile> = {}): TrustpilotProfile {
  const n = nextSeq();
  return {
    displayName: `Brand ${n}`,
    websiteUrl: `https://brand${n}.example.com`,
    phone: `+1 512 555 ${String(n).padStart(4, "0").slice(-4)}`,
    email: `hello@brand${n}.example.com`,
    locationCity: "Austin",
    locationCountry: "US",
    categories: ["electronics_technology"],
    numberOfReviews: 120,
    stars: 4.2,
    trustScore: 4.1,
    relatedBusinessSlugs: [],
    socialLinks: {},
    ...overrides,
  };
}

/** Inserts (or updates by yelpId) one built Yelp business row and returns it. */
export async function insertBusiness(db: Db, overrides: Partial<NewBusiness> = {}): Promise<Business> {
  const { business } = await upsertBusinessByYelpId(db, makeBusinessRow(overrides));
  return business;
}
