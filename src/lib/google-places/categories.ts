// Google place type → one of the 22 top-level category slugs
// (src/lib/trustpilot-categories.ts). Pure; safe in client bundles.
import { TRUSTPILOT_CATEGORIES } from "@/lib/trustpilot-categories";

const S = {
  animals: "animals_pets",
  beauty: "beauty_wellbeing",
  business: "business_services",
  construction: "construction_manufactoring",
  education: "education_training",
  electronics: "electronics_technology",
  events: "events_entertainment",
  food: "food_beverages_tobacco",
  health: "health_medical",
  hobbies: "hobbies_crafts",
  homeGarden: "home_garden",
  homeServices: "home_services",
  legal: "legal_services_government",
  media: "media_publishing",
  money: "money_insurance",
  public: "public_local_services",
  restaurants: "restaurants_bars",
  shopping: "shopping_fashion",
  sports: "sports",
  travel: "travel_vacation",
  utilities: "utilities",
  vehicles: "vehicles_transportation",
} as const;

/** Exact Google types. Generic types (point_of_interest, establishment, store, food, …) are deliberately absent. */
export const GOOGLE_TYPE_CATEGORIES: Record<string, string> = {
  // home services and contractors
  roofing_contractor: S.homeServices,
  plumber: S.homeServices,
  electrician: S.homeServices,
  hvac_contractor: S.homeServices,
  general_contractor: S.homeServices,
  painter: S.homeServices,
  locksmith: S.homeServices,
  moving_company: S.homeServices,
  pest_control_service: S.homeServices,
  exterminator: S.homeServices,
  house_cleaning_service: S.homeServices,
  cleaning_service: S.homeServices,
  janitorial_service: S.homeServices,
  carpet_cleaning_service: S.homeServices,
  laundry: S.homeServices,
  storage: S.homeServices,
  real_estate_agency: S.homeServices,
  // home and garden
  landscaper: S.homeGarden,
  lawn_care_service: S.homeGarden,
  gardener: S.homeGarden,
  garden_center: S.homeGarden,
  florist: S.homeGarden,
  hardware_store: S.homeGarden,
  home_improvement_store: S.homeGarden,
  home_goods_store: S.homeGarden,
  furniture_store: S.homeGarden,
  // restaurants and bars
  restaurant: S.restaurants,
  american_restaurant: S.restaurants,
  mexican_restaurant: S.restaurants,
  italian_restaurant: S.restaurants,
  chinese_restaurant: S.restaurants,
  japanese_restaurant: S.restaurants,
  sushi_restaurant: S.restaurants,
  thai_restaurant: S.restaurants,
  indian_restaurant: S.restaurants,
  pizza_restaurant: S.restaurants,
  seafood_restaurant: S.restaurants,
  steak_house: S.restaurants,
  barbecue_restaurant: S.restaurants,
  breakfast_restaurant: S.restaurants,
  brunch_restaurant: S.restaurants,
  hamburger_restaurant: S.restaurants,
  vegetarian_restaurant: S.restaurants,
  fast_food_restaurant: S.restaurants,
  sandwich_shop: S.restaurants,
  diner: S.restaurants,
  bar_and_grill: S.restaurants,
  meal_takeaway: S.restaurants,
  meal_delivery: S.restaurants,
  cafe: S.restaurants,
  coffee_shop: S.restaurants,
  tea_house: S.restaurants,
  bar: S.restaurants,
  pub: S.restaurants,
  wine_bar: S.restaurants,
  night_club: S.restaurants,
  // food and beverages
  bakery: S.food,
  dessert_shop: S.food,
  donut_shop: S.food,
  ice_cream_shop: S.food,
  confectionery: S.food,
  juice_shop: S.food,
  liquor_store: S.food,
  grocery_store: S.food,
  supermarket: S.food,
  butcher_shop: S.food,
  // health and medical
  dentist: S.health,
  dental_clinic: S.health,
  doctor: S.health,
  chiropractor: S.health,
  physiotherapist: S.health,
  hospital: S.health,
  medical_lab: S.health,
  pharmacy: S.health,
  drugstore: S.health,
  // beauty and well-being
  hair_salon: S.beauty,
  hair_care: S.beauty,
  barber_shop: S.beauty,
  beauty_salon: S.beauty,
  nail_salon: S.beauty,
  spa: S.beauty,
  medical_spa: S.beauty,
  skin_care_clinic: S.beauty,
  massage: S.beauty,
  wellness_center: S.beauty,
  tanning_studio: S.beauty,
  makeup_artist: S.beauty,
  sauna: S.beauty,
  // automotive
  car_repair: S.vehicles,
  auto_body_shop: S.vehicles,
  tire_shop: S.vehicles,
  car_wash: S.vehicles,
  car_dealer: S.vehicles,
  car_rental: S.vehicles,
  auto_parts_store: S.vehicles,
  gas_station: S.vehicles,
  towing_service: S.vehicles,
  // fitness and sports
  gym: S.sports,
  fitness_center: S.sports,
  yoga_studio: S.sports,
  pilates_studio: S.sports,
  martial_arts_school: S.sports,
  sports_club: S.sports,
  sports_complex: S.sports,
  golf_course: S.sports,
  swimming_pool: S.sports,
  sporting_goods_store: S.sports,
  // legal
  lawyer: S.legal,
  legal_services: S.legal,
  notary_public: S.legal,
  // finance
  accounting: S.money,
  tax_preparation_service: S.money,
  insurance_agency: S.money,
  bank: S.money,
  finance: S.money,
  // business services
  consultant: S.business,
  marketing_agency: S.business,
  courier_service: S.business,
  corporate_office: S.business,
  // education
  school: S.education,
  preschool: S.education,
  primary_school: S.education,
  secondary_school: S.education,
  university: S.education,
  driving_school: S.education,
  tutoring_service: S.education,
  child_care_agency: S.education,
  library: S.education,
  // lodging and travel
  hotel: S.travel,
  motel: S.travel,
  bed_and_breakfast: S.travel,
  inn: S.travel,
  resort_hotel: S.travel,
  extended_stay_hotel: S.travel,
  campground: S.travel,
  rv_park: S.travel,
  lodging: S.travel,
  travel_agency: S.travel,
  // pets
  veterinary_care: S.animals,
  pet_store: S.animals,
  pet_care: S.animals,
  pet_groomer: S.animals,
  dog_trainer: S.animals,
  // retail
  clothing_store: S.shopping,
  shoe_store: S.shopping,
  jewelry_store: S.shopping,
  gift_shop: S.shopping,
  department_store: S.shopping,
  shopping_mall: S.shopping,
  tailor: S.shopping,
  // electronics
  electronics_store: S.electronics,
  cell_phone_store: S.electronics,
  computer_repair: S.electronics,
  // events and hobbies
  event_venue: S.events,
  wedding_venue: S.events,
  movie_theater: S.events,
  bowling_alley: S.events,
  amusement_park: S.events,
  photographer: S.events,
  book_store: S.hobbies,
  art_studio: S.hobbies,
  // public and local services
  funeral_home: S.public,
  post_office: S.public,
  church: S.public,
  // construction
  construction_company: S.construction,
  // utilities
  telecommunications_service_provider: S.utilities,
};

/** Keyword rules on the type string for types the table does not list (first match wins). */
const KEYWORD_RULES: [RegExp, string][] = [
  [/restaurant|_grill|bistro|eatery|steak|pizz|taco|burger|bar$|_bar_|pub$|brewery|cafe|coffee/, S.restaurants],
  [/bakery|dessert|candy|chocolate|ice_cream|juice|grocery|(^|_)market$|butcher|liquor|wine_store/, S.food],
  [/dent|doctor|clinic|medical|hospital|physio|therap|chiropract|optometr|pharmac|health/, S.health],
  [/salon|barber|spa$|_spa|beauty|nail|hair|skin_care|massage|tanning|cosmetic|wellness/, S.beauty],
  [/veterinar|(^|_)pets?(_|$)|animal|(^|_)dog_|kennel/, S.animals],
  [/car_|auto|tire|vehicle|truck|motorcycle|towing/, S.vehicles],
  [/gym|fitness|yoga|pilates|martial|(^|_)sports?(_|$)|golf|swim|athletic/, S.sports],
  [/lawyer|legal|attorney|law_firm|notary/, S.legal],
  [/account|(^|_)tax(_|$)|insurance|(^|_)bank(_|$)|financ|loan|mortgage/, S.money],
  [/contractor|plumb|electric|roof|hvac|clean|pest|locksmith|moving|mover|handyman|painter|repair_service|installer/, S.homeServices],
  [/landscap|lawn|garden|florist|nursery|hardware|furniture|home_improvement|home_goods/, S.homeGarden],
  [/school|academy|tutor|educat|college|university|training|child_care/, S.education],
  [/hotel|motel|lodging|(^|_)inn$|resort|hostel|campground|travel/, S.travel],
  [/clothing|shoe|jewel|boutique|fashion|gift|mall/, S.shopping],
  [/electronic|phone|computer/, S.electronics],
  [/venue|theater|event|amusement|photograph/, S.events],
];

const LABELS = new Map(TRUSTPILOT_CATEGORIES.map((c) => [c.slug, c.label]));

/** "Home Services" for "home_services"; null for an unknown slug. */
export function categoryLabel(slug: string): string | null {
  return LABELS.get(slug) ?? null;
}

function lookupOne(type: string | null | undefined): string | null {
  const t = (type ?? "").trim().toLowerCase();
  return t ? (GOOGLE_TYPE_CATEGORIES[t] ?? null) : null;
}

function keywordOne(type: string | null | undefined): string | null {
  const t = (type ?? "").trim().toLowerCase();
  if (!t) return null;
  for (const [re, slug] of KEYWORD_RULES) if (re.test(t)) return slug;
  return null;
}

/** One of the 22 Trustpilot slugs, or null. Primary type first, then the rest; exact table before keyword rules. */
export function categoryForTypes(primaryType: string | null | undefined, types: string[]): string | null {
  const ordered = [primaryType, ...(types ?? [])];
  for (const t of ordered) {
    const hit = lookupOne(t);
    if (hit) return hit;
  }
  for (const t of ordered) {
    const hit = keywordOne(t);
    if (hit) return hit;
  }
  return null;
}

/** "roofing_contractor" → "Roofing contractor". */
export function typeTitle(type: string): string {
  const words = type.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : type;
}
