// TODO(PM, at WP-13 merge): replace this inline copy with
//   export { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";
// Inline copy of the 22 top-level Trustpilot categories (gtm lib/constants.ts).
export const TRUSTPILOT_CATEGORIES: { slug: string; label: string }[] = [
  { slug: "animals_pets", label: "Animals & Pets" },
  { slug: "beauty_wellbeing", label: "Beauty & Well-being" },
  { slug: "business_services", label: "Business Services" },
  { slug: "construction_manufactoring", label: "Construction & Manufacturing" },
  { slug: "education_training", label: "Education & Training" },
  { slug: "electronics_technology", label: "Electronics & Technology" },
  { slug: "events_entertainment", label: "Events & Entertainment" },
  { slug: "food_beverages_tobacco", label: "Food, Beverages & Tobacco" },
  { slug: "health_medical", label: "Health & Medical" },
  { slug: "hobbies_crafts", label: "Hobbies & Crafts" },
  { slug: "home_garden", label: "Home & Garden" },
  { slug: "home_services", label: "Home Services" },
  { slug: "legal_services_government", label: "Legal Services & Government" },
  { slug: "media_publishing", label: "Media & Publishing" },
  { slug: "money_insurance", label: "Money & Insurance" },
  { slug: "public_local_services", label: "Public & Local Services" },
  { slug: "restaurants_bars", label: "Restaurants & Bars" },
  { slug: "shopping_fashion", label: "Shopping & Fashion" },
  { slug: "sports", label: "Sports" },
  { slug: "travel_vacation", label: "Travel & Vacation" },
  { slug: "utilities", label: "Utilities" },
  { slug: "vehicles_transportation", label: "Vehicles & Transportation" },
];
