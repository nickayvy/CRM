// AC-18.6 (normalise to the row contract) and AC-18.7 (type → category table).
import { describe, expect, it } from "vitest";
import { GOOGLE_TYPE_CATEGORIES, categoryForTypes } from "@/lib/google-places/categories";
import { normalizeGooglePlace } from "@/lib/google-places/normalize";
import type { GooglePlace } from "@/lib/google-places/types";
import { normalizeName, phoneDigits } from "@/lib/format";
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";
import { normalizeYelpBusiness } from "@/lib/yelp";
import { makeYelpBusiness } from "./helpers/builders";

/** A fixture shaped like a Text Search (New) place with the full field mask (not verified live; see the WP-18 report). */
const FIXTURE: GooglePlace = {
  id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
  displayName: { text: "BEST ROOFING DALLAS TX - Free Estimates", languageCode: "en" },
  formattedAddress: "1234 Elm St Suite 200, Dallas, TX 75201, USA",
  addressComponents: [
    { longText: "200", shortText: "200", types: ["subpremise"] },
    { longText: "1234", shortText: "1234", types: ["street_number"] },
    { longText: "Elm Street", shortText: "Elm St", types: ["route"] },
    { longText: "Downtown", shortText: "Downtown", types: ["neighborhood", "political"] },
    { longText: "Dallas", shortText: "Dallas", types: ["locality", "political"] },
    { longText: "Dallas County", shortText: "Dallas County", types: ["administrative_area_level_2", "political"] },
    { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1", "political"] },
    { longText: "United States", shortText: "US", types: ["country", "political"] },
    { longText: "75201", shortText: "75201", types: ["postal_code"] },
  ],
  location: { latitude: 32.7812, longitude: -96.7987 },
  nationalPhoneNumber: "(214) 555-0199",
  internationalPhoneNumber: "+1 214-555-0199",
  websiteUri: "https://www.bestroofingdallas.com/?utm_source=google&utm_medium=organic",
  googleMapsUri: "https://maps.google.com/?cid=1234567890",
  rating: 4.66,
  userRatingCount: 87,
  businessStatus: "OPERATIONAL",
  primaryType: "roofing_contractor",
  primaryTypeDisplayName: { text: "Roofing contractor", languageCode: "en-US" },
  types: ["roofing_contractor", "general_contractor", "point_of_interest", "establishment"],
  pureServiceAreaBusiness: false,
};

const NOW = new Date("2026-11-10T12:00:00Z");

describe("normalizeGooglePlace", () => {
  it("maps the fixture to every column in the row contract", () => {
    const row = normalizeGooglePlace(FIXTURE, {
      jobId: "00000000-0000-4000-8000-000000000009",
      searchCategory: "home_services",
      searchLocation: "Dallas, TX",
      now: NOW,
    });
    expect(row).toEqual({
      source: "google",
      googlePlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      googleMapsUrl: "https://maps.google.com/?cid=1234567890",
      name: "Best Roofing",
      nameNormalized: "best roofing",
      phone: "+1 214-555-0199",
      phoneDigits: "12145550199",
      displayPhone: "(214) 555-0199",
      website: "https://www.bestroofingdallas.com",
      slug: "bestroofingdallas.com",
      rating: "4.7",
      reviewCount: 87,
      categories: [
        { alias: "home_services", title: "Home Services" },
        { alias: "roofing_contractor", title: "Roofing contractor" },
        { alias: "general_contractor", title: "General contractor" },
        { alias: "point_of_interest", title: "Point of interest" },
        { alias: "establishment", title: "Establishment" },
      ],
      primaryCategory: "home_services",
      subcategory: "Roofing contractor",
      isClosed: false,
      address1: "1234 Elm St",
      address2: "#200",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      country: "US",
      latitude: 32.7812,
      longitude: -96.7987,
      raw: FIXTURE,
      lastScrapedAt: NOW,
      searchCategory: "home_services",
      searchLocation: "Dallas, TX",
      sourceJobId: "00000000-0000-4000-8000-000000000009",
    });
    // The uncleaned name stays in raw.
    expect((row.raw as GooglePlace).displayName?.text).toBe("BEST ROOFING DALLAS TX - Free Estimates");
    // No CRM or qualification fields.
    for (const k of ["status", "ownerName", "ownerEmail", "notes", "tags", "doNotCall", "doNotEmail", "qualification", "score", "rejectionReasons"])
      expect(row, k).not.toHaveProperty(k);
  });

  it("phoneDigits equal the same number on a Yelp row", () => {
    const g = normalizeGooglePlace(FIXTURE, { searchCategory: "", searchLocation: "" });
    const y = normalizeYelpBusiness(makeYelpBusiness({ phone: "+12145550199" }), { searchCategory: "", searchLocation: "" });
    expect(g.phoneDigits).toBe(y.phoneDigits);
    // National-only numbers get the US country code too.
    const nat = normalizeGooglePlace({ ...FIXTURE, internationalPhoneNumber: undefined }, { searchCategory: "", searchLocation: "" });
    expect(nat.phoneDigits).toBe("12145550199");
    expect(nat.phone).toBe("(214) 555-0199");
    expect(phoneDigits(nat.phone ?? null)).toBe("2145550199");
  });

  it("CLOSED_PERMANENTLY → isClosed; CLOSED_TEMPORARILY is not", () => {
    expect(normalizeGooglePlace({ ...FIXTURE, businessStatus: "CLOSED_PERMANENTLY" }, { searchCategory: "", searchLocation: "" }).isClosed).toBe(true);
    expect(normalizeGooglePlace({ ...FIXTURE, businessStatus: "CLOSED_TEMPORARILY" }, { searchCategory: "", searchLocation: "" }).isClosed).toBe(false);
  });

  it("a place with no website has website and slug null; a sparse place still maps", () => {
    const row = normalizeGooglePlace({ id: "ChIJsparse", displayName: { text: "Joe's Plumbing" } }, { searchCategory: "", searchLocation: "" });
    expect(row.website).toBeNull();
    expect(row.slug).toBeNull();
    expect(row).toMatchObject({
      name: "Joe's Plumbing",
      nameNormalized: normalizeName("Joe's Plumbing"),
      phone: null,
      phoneDigits: null,
      rating: null,
      reviewCount: 0,
      categories: [],
      primaryCategory: null,
      city: null,
      state: null,
      googleMapsUrl: null,
      latitude: null,
    });
    expect(row.sourceJobId).toBeUndefined();
  });

  it("categories[0] is the top-level slug, then the Google types; unknown types give no slug entry", () => {
    const row = normalizeGooglePlace(
      { ...FIXTURE, primaryType: "dentist", primaryTypeDisplayName: { text: "Dentist" }, types: ["dentist", "health", "point_of_interest"] },
      { searchCategory: "", searchLocation: "" },
    );
    expect(row.categories?.map((c) => c.alias)).toEqual(["health_medical", "dentist", "health", "point_of_interest"]);
    const odd = normalizeGooglePlace(
      { ...FIXTURE, primaryType: undefined, primaryTypeDisplayName: undefined, types: ["point_of_interest", "establishment"] },
      { searchCategory: "", searchLocation: "" },
    );
    expect(odd.categories?.map((c) => c.alias)).toEqual(["point_of_interest", "establishment"]);
    expect(odd.primaryCategory).toBeNull();
  });
});

describe("categoryForTypes", () => {
  const TABLE: [string, string][] = [
    ["roofing_contractor", "home_services"],
    ["plumber", "home_services"],
    ["electrician", "home_services"],
    ["general_contractor", "home_services"],
    ["painter", "home_services"],
    ["locksmith", "home_services"],
    ["moving_company", "home_services"],
    ["real_estate_agency", "home_services"],
    ["laundry", "home_services"],
    ["hardware_store", "home_garden"],
    ["home_improvement_store", "home_garden"],
    ["florist", "home_garden"],
    ["furniture_store", "home_garden"],
    ["dentist", "health_medical"],
    ["dental_clinic", "health_medical"],
    ["doctor", "health_medical"],
    ["chiropractor", "health_medical"],
    ["physiotherapist", "health_medical"],
    ["pharmacy", "health_medical"],
    ["hospital", "health_medical"],
    ["veterinary_care", "animals_pets"],
    ["pet_store", "animals_pets"],
    ["hair_salon", "beauty_wellbeing"],
    ["barber_shop", "beauty_wellbeing"],
    ["beauty_salon", "beauty_wellbeing"],
    ["nail_salon", "beauty_wellbeing"],
    ["spa", "beauty_wellbeing"],
    ["skin_care_clinic", "beauty_wellbeing"],
    ["car_repair", "vehicles_transportation"],
    ["car_wash", "vehicles_transportation"],
    ["car_dealer", "vehicles_transportation"],
    ["auto_parts_store", "vehicles_transportation"],
    ["gas_station", "vehicles_transportation"],
    ["restaurant", "restaurants_bars"],
    ["mexican_restaurant", "restaurants_bars"],
    ["pizza_restaurant", "restaurants_bars"],
    ["fast_food_restaurant", "restaurants_bars"],
    ["cafe", "restaurants_bars"],
    ["coffee_shop", "restaurants_bars"],
    ["bar", "restaurants_bars"],
    ["meal_takeaway", "restaurants_bars"],
    ["bakery", "food_beverages_tobacco"],
    ["ice_cream_shop", "food_beverages_tobacco"],
    ["grocery_store", "food_beverages_tobacco"],
    ["liquor_store", "food_beverages_tobacco"],
    ["gym", "sports"],
    ["fitness_center", "sports"],
    ["yoga_studio", "sports"],
    ["golf_course", "sports"],
    ["lawyer", "legal_services_government"],
    ["accounting", "money_insurance"],
    ["insurance_agency", "money_insurance"],
    ["bank", "money_insurance"],
    ["school", "education_training"],
    ["preschool", "education_training"],
    ["university", "education_training"],
    ["hotel", "travel_vacation"],
    ["motel", "travel_vacation"],
    ["campground", "travel_vacation"],
    ["travel_agency", "travel_vacation"],
    ["clothing_store", "shopping_fashion"],
    ["jewelry_store", "shopping_fashion"],
    ["electronics_store", "electronics_technology"],
    ["funeral_home", "public_local_services"],
  ];

  it(`maps at least 60 Google types (${TABLE.length}) to the expected slug`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
    for (const [type, slug] of TABLE) expect(categoryForTypes(type, []), type).toBe(slug);
  });

  it("every table value is one of the 22 slugs", () => {
    const slugs = new Set(TRUSTPILOT_CATEGORIES.map((c) => c.slug));
    for (const [type, slug] of Object.entries(GOOGLE_TYPE_CATEGORIES)) expect(slugs.has(slug), type).toBe(true);
  });

  it("primary type first, then the rest; keyword rules as a fallback; unknown → null", () => {
    expect(categoryForTypes("plumber", ["hardware_store"])).toBe("home_services");
    expect(categoryForTypes(null, ["point_of_interest", "hardware_store"])).toBe("home_garden");
    expect(categoryForTypes("korean_barbecue_restaurant", [])).toBe("restaurants_bars");
    expect(categoryForTypes("pediatric_dentist", [])).toBe("health_medical");
    expect(categoryForTypes("unknown_type", [])).toBeNull();
    expect(categoryForTypes(undefined, ["point_of_interest", "establishment"])).toBeNull();
    // Keyword rules must not misfire on look-alikes.
    expect(categoryForTypes("taxi_service", [])).not.toBe("money_insurance");
    expect(categoryForTypes("transportation_service", [])).not.toBe("sports");
    expect(categoryForTypes("digital_marketing_agency", [])).not.toBe("food_beverages_tobacco");
  });
});
