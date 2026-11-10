// Built-in niches: the names a market searches for, and the Google place types
// that count as on-target (they drive `category_mismatch` through
// search_jobs.category_aliases). Pure data; safe in client bundles.
//
// Type names follow Google's Places (New) type table. Types marked "(unverified)"
// are best guesses where no exact table entry is known; confirm them with the
// live probe (`npm run google:search -- --probe "<term> <zip>"`).

export type Niche = {
  id: string;
  label: string;
  /** One of the 22 top-level slugs (src/lib/trustpilot-categories.ts). */
  category: string;
  terms: string[];
  acceptTypes: string[];
};

const TRADE_EXTRAS = ["general_contractor"];

export const NICHES: Niche[] = [
  // ---- trades
  {
    id: "roofing",
    label: "Roofing",
    category: "home_services",
    terms: ["roofer", "roofing contractor", "roofing company"],
    acceptTypes: ["roofing_contractor", ...TRADE_EXTRAS],
  },
  {
    id: "plumbing",
    label: "Plumbing",
    category: "home_services",
    terms: ["plumber", "plumbing company", "emergency plumber"],
    acceptTypes: ["plumber", ...TRADE_EXTRAS],
  },
  {
    id: "hvac",
    label: "HVAC",
    category: "home_services",
    terms: ["hvac contractor", "air conditioning repair", "heating and cooling", "furnace repair"],
    // hvac_contractor (unverified); HVAC firms are often typed plumber or electrician too.
    acceptTypes: ["hvac_contractor", "plumber", "electrician", ...TRADE_EXTRAS],
  },
  {
    id: "electrical",
    label: "Electrical",
    category: "home_services",
    terms: ["electrician", "electrical contractor", "electrical repair"],
    acceptTypes: ["electrician", ...TRADE_EXTRAS],
  },
  {
    id: "landscaping",
    label: "Landscaping",
    category: "home_garden",
    terms: ["landscaper", "landscaping company", "lawn care service"],
    // landscaper / lawn_care_service / gardener (unverified).
    acceptTypes: ["landscaper", "lawn_care_service", "gardener", ...TRADE_EXTRAS],
  },
  {
    id: "pest_control",
    label: "Pest control",
    category: "home_services",
    terms: ["pest control", "exterminator", "termite control"],
    // pest_control_service / exterminator (unverified).
    acceptTypes: ["pest_control_service", "exterminator"],
  },
  {
    id: "cleaning",
    label: "Cleaning",
    category: "home_services",
    terms: ["house cleaning service", "maid service", "commercial cleaning", "carpet cleaning"],
    // house_cleaning_service / cleaning_service / janitorial_service / carpet_cleaning_service (unverified).
    acceptTypes: ["house_cleaning_service", "cleaning_service", "janitorial_service", "carpet_cleaning_service"],
  },
  {
    id: "painting",
    label: "Painting",
    category: "home_services",
    terms: ["house painter", "painting contractor", "commercial painter"],
    acceptTypes: ["painter", ...TRADE_EXTRAS],
  },
  {
    id: "locksmith",
    label: "Locksmith",
    category: "home_services",
    terms: ["locksmith", "emergency locksmith"],
    acceptTypes: ["locksmith"],
  },
  {
    id: "moving",
    label: "Moving",
    category: "home_services",
    terms: ["moving company", "movers", "local movers"],
    acceptTypes: ["moving_company", "storage"],
  },
  // ---- health
  {
    id: "dentist",
    label: "Dentist",
    category: "health_medical",
    terms: ["dentist", "dental clinic", "family dentist", "cosmetic dentist"],
    acceptTypes: ["dentist", "dental_clinic"],
  },
  {
    id: "chiropractor",
    label: "Chiropractor",
    category: "health_medical",
    terms: ["chiropractor", "chiropractic clinic"],
    acceptTypes: ["chiropractor", "physiotherapist", "doctor", "wellness_center"],
  },
  {
    id: "med_spa",
    label: "Med spa",
    category: "beauty_wellbeing",
    terms: ["med spa", "medical spa", "botox", "laser hair removal"],
    acceptTypes: ["medical_spa", "spa", "skin_care_clinic", "beauty_salon", "wellness_center", "doctor"],
  },
  {
    id: "veterinary",
    label: "Veterinary",
    category: "animals_pets",
    terms: ["veterinarian", "animal hospital", "vet clinic"],
    acceptTypes: ["veterinary_care"],
  },
  {
    id: "physical_therapy",
    label: "Physical therapy",
    category: "health_medical",
    terms: ["physical therapist", "physical therapy clinic", "sports physical therapy"],
    acceptTypes: ["physiotherapist", "doctor", "wellness_center"],
  },
  // ---- food
  {
    id: "restaurant",
    label: "Restaurant",
    category: "restaurants_bars",
    terms: ["restaurant", "family restaurant", "local restaurant"],
    acceptTypes: [
      "restaurant",
      "american_restaurant",
      "mexican_restaurant",
      "italian_restaurant",
      "chinese_restaurant",
      "pizza_restaurant",
      "seafood_restaurant",
      "steak_house",
      "barbecue_restaurant",
      "breakfast_restaurant",
      "brunch_restaurant",
      "diner",
      "bar_and_grill",
      "fast_food_restaurant",
      "sandwich_shop",
      "meal_takeaway",
    ],
  },
  {
    id: "coffee_shop",
    label: "Coffee shop",
    category: "restaurants_bars",
    terms: ["coffee shop", "cafe", "espresso bar"],
    acceptTypes: ["coffee_shop", "cafe", "tea_house", "bakery"],
  },
  {
    id: "bakery",
    label: "Bakery",
    category: "food_beverages_tobacco",
    terms: ["bakery", "cake shop", "donut shop"],
    acceptTypes: ["bakery", "dessert_shop", "donut_shop", "confectionery", "cafe", "coffee_shop"],
  },
  // ---- fitness
  {
    id: "gym",
    label: "Gym",
    category: "sports",
    terms: ["gym", "fitness center", "personal trainer", "crossfit"],
    acceptTypes: ["gym", "fitness_center", "sports_club"],
  },
  {
    id: "yoga_pilates",
    label: "Yoga / Pilates studio",
    category: "sports",
    terms: ["yoga studio", "pilates studio", "hot yoga"],
    acceptTypes: ["yoga_studio", "pilates_studio", "gym", "fitness_center", "wellness_center"],
  },
  {
    id: "martial_arts",
    label: "Martial arts",
    category: "sports",
    terms: ["martial arts school", "karate", "jiu jitsu", "taekwondo"],
    // martial_arts_school (unverified).
    acceptTypes: ["martial_arts_school", "gym", "fitness_center", "sports_club", "school"],
  },
  // ---- services
  {
    id: "law_firm",
    label: "Law firm",
    category: "legal_services_government",
    terms: ["lawyer", "attorney", "law firm", "personal injury lawyer"],
    acceptTypes: ["lawyer", "legal_services"],
  },
  {
    id: "accountant",
    label: "Accountant",
    category: "money_insurance",
    terms: ["accountant", "cpa", "tax preparation", "bookkeeping service"],
    acceptTypes: ["accounting", "tax_preparation_service", "consultant", "finance"],
  },
  {
    id: "real_estate",
    label: "Real estate office",
    category: "home_services",
    terms: ["real estate agency", "realtor", "real estate office"],
    acceptTypes: ["real_estate_agency"],
  },
  {
    id: "auto_repair",
    label: "Auto repair",
    category: "vehicles_transportation",
    terms: ["auto repair", "mechanic", "auto body shop", "brake repair"],
    acceptTypes: ["car_repair", "auto_body_shop", "tire_shop", "car_wash", "auto_parts_store"],
  },
  {
    id: "hair_salon",
    label: "Hair salon / Barber",
    category: "beauty_wellbeing",
    terms: ["hair salon", "barber shop", "barber", "hair stylist"],
    acceptTypes: ["hair_salon", "barber_shop", "beauty_salon", "hair_care"],
  },
  {
    id: "nail_salon",
    label: "Nail salon",
    category: "beauty_wellbeing",
    terms: ["nail salon", "manicure", "pedicure"],
    acceptTypes: ["nail_salon", "beauty_salon"],
  },
  {
    id: "insurance",
    label: "Insurance agency",
    category: "money_insurance",
    terms: ["insurance agency", "insurance agent", "auto insurance"],
    acceptTypes: ["insurance_agency"],
  },
];

const BY_ID = new Map(NICHES.map((n) => [n.id, n]));

export function getNiche(id: string | null | undefined): Niche | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}
