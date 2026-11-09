// The v1 qualification trap table as inline builder data: three searches
// (plumbing/Houston 40 records, hvac/Dallas 30, dentists/Austin 30). Expected
// with default rules, one search at a time: Houston 31 qualified / 9 rejected,
// Dallas 26/4, Austin 26/4. "ABC Plumbing" appears in all three cities, so
// after all three searches + requalifyAll every ABC row is multi_location.
// Traps are annotated inline.
import type { YelpBusiness, YelpBusinessDetails, YelpSearchParams } from "@/lib/yelp";
import { createFakeYelp, type FakeYelpClient } from "./fake-yelp";
import { makeYelpBusiness } from "./builders";

/** [id, name, rating, reviews, phone, category aliases ("a|b"), city, state, distance m, closed?] */
type Row = [string, string, number, number, string, string, string, string, number, boolean?];

const CATEGORY_TITLES: Record<string, string> = {
  "plumbing": "Plumbing",
  "handyman": "Handyman",
  "waterheaterinstallrepair": "Water Heater Installation/Repair",
  "septic": "Septic Services",
  "contractors": "Contractors",
  "landscaping": "Landscaping",
  "hvac": "Heating & Air Conditioning/HVAC",
  "ductcleaning": "Air Duct Cleaning",
  "airconditioningrepair": "Air Conditioning Repair",
  "dentists": "General Dentistry",
  "cosmeticdentists": "Cosmetic Dentists",
  "orthodontists": "Orthodontists",
  "pediatric_dentists": "Pediatric Dentists"
};

/** plumbing-houston: 40 records, 13 traps. */
const HOUSTON_ROWS: Row[] = [
  ["CfQwacWaJKWTi-Ull7BeXj", "Precision Plumbing & Repair", 4.5, 12, "+17135554493", "plumbing", "Houston", "TX", 12970.57],
  ["zgHZK4KdDezeTkADXYN0ov", "Cornerstone Plumbing Co.", 4.5, 27, "+17135553789", "plumbing", "Pearland", "TX", 1979.49],
  ["ipgQPfI6e-km0aAITO82Yk", "Dusty Wrench Plumbing", 3.5, 5, "+17135553897", "handyman|plumbing", "Houston", "TX", 19000],  // trap: borderline: rating 3.5, 5 reviews, plumbing only secondary category, 19000 m → qualified
  ["HP1LSCmJoah3jkYaZ7W3_P", "Mr. Rooter Plumbing of Houston", 4.5, 17, "+17135557750", "plumbing", "Stafford", "TX", 17370.05],  // trap: national chain name (mr. rooter) → rejected (chain)
  ["Zo5xddprE3f1rrznPHRszC", "Montrose Plumbing & Repair", 4.5, 17, "+17135553374", "plumbing", "Houston", "TX", 12714.32],
  ["RMzVY3hLf8QUWZGymOx8aR", "Brazos Plumbing & Repair", 4, 44, "+17135555713", "plumbing|waterheaterinstallrepair", "Stafford", "TX", 18920.82],
  ["fg4ucFx5oypIYl6u2kzduD", "Memorial Plumbing & Repair", 4.5, 67, "+17135557200", "plumbing", "Houston", "TX", 15844.29],
  ["6o552ZUTsPPtE1iYRssNwq", "Reliable Plumbing Co", 4, 346, "+17135557920", "plumbing", "Houston", "TX", 18230.19],  // trap: first of a duplicate-phone pair (kept) → qualified
  ["mOjz70PFrqr0CuYKZzrqY9", "Sugar Land Pipe Masters", 3.5, 310, "+17135552249", "plumbing", "Sugar Land", "TX", 21500],  // trap: 21500 m, outside radius but inside 10% tolerance → qualified
  ["hpYRYNEbYE_0nUGYEbHitg", "Evergreen Plumbing", 4.5, 176, "+17135553747", "plumbing", "Houston", "TX", 12778.38],
  ["HfECPQJlprbX3eIDTQeYRO", "Space City Plumbing & Repair", 4.5, 36, "+17135557895", "plumbing", "Houston", "TX", 17267.89],
  ["f5dZ7hF9QOpAytFg0Cb15C", "Eagle Plumbing Co.", 3.5, 206, "+17135552636", "plumbing", "Houston", "TX", 10434.56],
  ["Jv8jUeeWm9Oiv0gLIIDjWh", "Gulf Coast Plumbing", 4.5, 294, "+17135557127", "plumbing", "Houston", "TX", 9413.87, true],  // trap: permanently closed on Yelp → rejected (closed)
  ["r8YWarZDjvtSAsV4URhsqP", "Trusty Plumbing & Repair", 4.5, 232, "+17135555368", "plumbing", "Bellaire", "TX", 6341.58],
  ["WmhgLVDX8aF4Z19-AysKD_", "Handy Hank Plumbing", 5, 123, "", "plumbing|septic", "Houston", "TX", 8618.51],  // trap: no phone number → rejected (no_phone)
  ["7iNUtRD6-1_PkjO9UEgQlq", "Armadillo Plumbers", 3.5, 17, "+17135550463", "plumbing|waterheaterinstallrepair", "Houston", "TX", 8810.65],
  ["KGbIjTTqeO3ZENvfgpunYW", "Reliable Plumbing Co", 4.5, 113, "+17135557920", "plumbing", "Houston", "TX", 11642.99],  // trap: second of a duplicate-phone pair (same phone as first) → rejected (duplicate_phone)
  ["KBCZ24yVvaOlhbLOyDnxJm", "Brazos Plumbing", 4.5, 129, "+17135553285", "plumbing|contractors", "Stafford", "TX", 2345.92],
  ["03qW0Y4b02wuLjz3dZCNYu", "Pinnacle Plumbing", 4.5, 337, "+17135558499", "plumbing|septic", "Houston", "TX", 14678.6],
  ["Siynqx-OTeAFMrcEhHXPwQ", "Third Ward Plumbing Services", 5, 395, "+17135553009", "plumbing", "Houston", "TX", 9346.56],
  ["txvlQLTXh9ik3GKIHR_sUg", "Rice Village Plumbing", 5, 26, "+17135552521", "plumbing", "Bellaire", "TX", 5992.36],
  ["zyoo4DGGL29o_1bC_OKO8X", "Steadfast Plumbing Services", 4.5, 66, "+17135552616", "plumbing|contractors", "Houston", "TX", 1432.69],
  ["Z8kta7p7ssUC-wcPBsX2Fe", "Oak Forest Plumbing", 4, 73, "+17135552328", "plumbing|waterheaterinstallrepair", "Stafford", "TX", 5260.41],
  ["JPjYt-qpndNloCYqdiaTY5", "Dependable Plumbing Services", 4.5, 18, "+17135554869", "plumbing", "Houston", "TX", 8813.15],
  ["jpaG-POdA3HgKtiEdUu06s", "Patriot Plumbing", 4.5, 13, "+17135551497", "plumbing|septic", "Humble", "TX", 13802.96],
  ["jQfhJslxmoiJSE1-GuHOay", "ABC Plumbing", 4, 181, "+17135551162", "plumbing", "Houston", "TX", 1086.69],  // trap: ordinary plumber sharing its name with the ABC Plumbing in the other files → qualified
  ["TwabBMs7x9xtd_KMSzyQeA", "Armadillo Plumbing", 4.5, 445, "+17135554885", "plumbing|contractors", "Humble", "TX", 17609.76],
  ["dVajVceTnT0M441VGSufYU", "Quick Fix Plumbing", 2.5, 40, "+17135559389", "plumbing", "Houston", "TX", 697.98],  // trap: rating 2.5 below minimum → rejected (low_rating)
  ["Ww1qnYHo89HDPzsL3lF6kX", "Prime Pipe & Drain", 4, 256, "+17135553113", "plumbing|septic", "Humble", "TX", 6935.59],
  ["A_WVRIXI2j-DK9wCzxJdcF", "Steadfast Plumbers", 4, 14, "+17135550511", "plumbing", "Houston", "TX", 1248.8],
  ["D1PWH9-ugWglCa0TEZWu6h", "New Guy Plumbing LLC", 5, 2, "+17135551878", "plumbing|waterheaterinstallrepair", "Houston", "TX", 1238.66],  // trap: only 2 reviews → rejected (too_few_reviews)
  ["oVPcEwxgEZpkh6RwmS260X", "Westchase Plumbing & Repair", 5, 102, "+17135555166", "plumbing", "Houston", "TX", 8865.99],
  ["c7YUVdmNxYtrFuM0dW0gED", "Prime Plumbing Services", 3.5, 358, "+17135552770", "plumbing", "Houston", "TX", 10598.01],
  ["ximMp2BZo23ds-lBuqOEoc", "Memorial Plumbers", 4, 13, "+17135556114", "plumbing", "Humble", "TX", 9436.16],
  ["jL1ubAPu_iC3AH8RLZj_RB", "Katy Drain Pros", 4, 43, "+17135552306", "plumbing", "Katy", "TX", 31000],  // trap: outside radius (31000 m, hard out of area) → rejected (out_of_area)
  ["xP-o46dl5zr8a-eZw69fJf", "Roto-Rooter Plumbing & Water Cleanup", 4.5, 179, "+17135553707", "plumbing", "Houston", "TX", 17623.87],  // trap: national chain name (roto-rooter) → rejected (chain)
  ["vs4S8r3Ch_ZyHfZfGfCIpb", "Tomball Plumbing Services", 4.5, 138, "+17135556431", "plumbing|septic", "Houston", "TX", 15592.8],
  ["juLJB61UhjSMJG-0HdPMMw", "Evergreen Plumbing & Repair", 4.5, 399, "+17135556402", "plumbing", "Houston", "TX", 17476.1],
  ["n3tZ_lpR0RuPNnUEarER1k", "Blue Heron Pipe & Drain", 5, 398, "+17135558591", "plumbing", "Houston", "TX", 6426.56],
  ["eLURK9WZDjR9QVN-dgZvXl", "Bayou City Lawn & Landscape", 5, 35, "+17135557058", "landscaping", "Houston", "TX", 2668.62],  // trap: category is landscaping, not plumbing → rejected (category_mismatch)
];

/** hvac-dallas: 30 records, 4 traps. */
const DALLAS_ROWS: Row[] = [
  ["RLNGZm2e9r3rlsrnwYhKda", "One Hour Heating & Air Conditioning of Dallas", 5, 403, "+12145556910", "hvac", "Dallas", "TX", 11994.82],  // trap: national chain name (one hour heating) → rejected (chain)
  ["gBUUMIFqedSdAGWWwr9HYZ", "Frontier HVAC", 4.5, 116, "+12145558523", "hvac|ductcleaning", "Dallas", "TX", 1487.59],
  ["9yFsri7UJtxPrKc4cdrPS7", "Deep Ellum HVAC", 5, 67, "+12145556118", "hvac|ductcleaning", "Dallas", "TX", 16228.23],
  ["s-KpSBo7wYuZVHXITGiZmb", "Ranger Climate Control", 5, 65, "+12145555059", "hvac", "Dallas", "TX", 824.93],
  ["7XYaFsPEm24Gt113tVZHot", "Comanche Climate Control", 4, 259, "+12145557305", "hvac", "Dallas", "TX", 14257.63],
  ["ZKtqddvlA3trKivDyEAbcG", "Big D Air Conditioning", 5, 337, "+12145559792", "hvac", "Dallas", "TX", 14850.05],
  ["umym_Y3oaAx7MmXSxZW0_I", "Oak Cliff Air Conditioning", 4.5, 62, "+12145553994", "hvac", "Dallas", "TX", 16171.1],
  ["aEd9wSXSey1Rmfx_gb-voy", "Trinity River HVAC", 5, 192, "+12145556336", "hvac|contractors", "Dallas", "TX", 2676.8],
  ["R3Fwd3BoA6kS8cCQP6CRnB", "Trinity River A/C & Heat", 4.5, 244, "+12145557146", "hvac", "Dallas", "TX", 10872.69],
  ["e0JAEtt_9mym4Bs47PQz_1", "Longhorn HVAC", 4, 251, "+12145552411", "hvac", "Dallas", "TX", 685.92],
  ["x_Q8SxqYalBTlgVcYhLFkv", "Arlington Ridge HVAC", 4.5, 117, "+12145555326", "hvac", "Dallas", "TX", 18891.86],
  ["ZomAly2g7_wsRnEcwyi8d_", "Lakewood Comfort Heating & Air", 5, 335, "+12145556321", "hvac", "Mesquite", "TX", 13090.99, true],  // trap: permanently closed on Yelp → rejected (closed)
  ["qKm3JaViXzEkDjLo9nhTVK", "Redline Comfort Systems", 4, 186, "+12145556126", "hvac|contractors", "Dallas", "TX", 14895.52],
  ["Wb_mAwhjs9vaDxt1x0GPRo", "Trinity Valley Climate Control", 3, 36, "+12145551456", "hvac|contractors", "Dallas", "TX", 7261.96],  // trap: rating 3.0 below minimum → rejected (low_rating)
  ["V7nZefv8b3jutgmSl3dLpp", "Highland Park Air Conditioning", 5, 29, "+12145559251", "hvac", "Dallas", "TX", 3836.62],
  ["u6fXTq65ZYpFSoruIHaeA7", "Redline Heating & Cooling", 5, 21, "+12145558074", "hvac|airconditioningrepair", "Dallas", "TX", 9959.51],
  ["q-svzmekrX-VwyTtn5DHSX", "Arlington Ridge A/C & Heat", 4.5, 149, "+12145551059", "hvac", "Dallas", "TX", 11051.19],
  ["5rF1JusWP2DYJrC1NQG2l-", "Sunbelt HVAC", 4, 288, "+12145552395", "hvac", "Dallas", "TX", 13070.02],
  ["2VIVcVV1eC_Tffus1vbIfF", "Mesa Air Conditioning", 4, 48, "+12145559460", "hvac|contractors", "Dallas", "TX", 3654.34],
  ["P_0RlDTTVPgGZj3lTU--r4", "Longhorn Heating & Air", 4, 14, "+12145559194", "hvac|ductcleaning", "Dallas", "TX", 2268.18],
  ["MsQR88h7gotzlBLupCCNtw", "Ranger Comfort Systems", 4, 368, "+12145553818", "hvac", "Dallas", "TX", 1460.53],
  ["RIhD7DF677U2yZsziYf6e1", "Skyline Heating & Cooling", 4, 13, "+12145558801", "hvac|ductcleaning", "Dallas", "TX", 5218.68],
  ["kthowGcS2aD0Ls7ltQeaG5", "White Rock Air Conditioning", 5, 91, "+12145555479", "hvac", "Garland", "TX", 487.58],
  ["PhLprV3R0bSMMGx0i1-EKZ", "North Texas Climate Control", 4.5, 12, "+12145551839", "hvac", "Dallas", "TX", 5411.93],
  ["qQgZbhMg5KG3jgHBZLI_s0", "Cowtown Heating & Cooling", 4.5, 44, "+12145551504", "hvac", "Dallas", "TX", 6314.53],
  ["crH9rVAwoqPyssMGV7Xukj", "Bishop Arts Climate Control", 5, 387, "+12145554073", "hvac|contractors", "Mesquite", "TX", 1241.18],
  ["GB4NFSEFaB-SRG9bs5iq6r", "Preston Hollow Heating & Cooling", 4.5, 59, "+12145557088", "hvac", "Dallas", "TX", 12821.25],
  ["gSd042be75oFAMNPTHCqov", "ABC Plumbing", 4, 12, "+12145556171", "plumbing", "Dallas", "TX", 4772.94],  // trap: plumbing category in an HVAC search → rejected (category_mismatch)
  ["8Kdk36geb3dIrB81mqsEFH", "Big D Climate Control", 4.5, 145, "+12145557402", "hvac", "Carrollton", "TX", 3267.56],
  ["X4uW2kvx3p8WyuiLbNRm-b", "Longhorn Air Conditioning", 4.5, 381, "+12145552712", "hvac", "Irving", "TX", 17525.96],
];

/** dentists-austin: 30 records, 4 traps. */
const AUSTIN_ROWS: Row[] = [
  ["YQS_Gf779WHE9itjtflirj", "Brentwood Dental Associates", 4.5, 29, "+15125553891", "dentists", "Austin", "TX", 15735.96],
  ["U0-akvPFOSSTYItcGLVQth", "Windsor Park Dentistry", 3.5, 55, "+15125556391", "dentists", "Austin", "TX", 10751.16],
  ["Eev1Mm4GV35nm6lwxIu3ke", "Westlake Dental Studio", 4.5, 95, "+15125558615", "dentists", "Bee Cave", "TX", 12030.02],
  ["oNatU4S4IXzyZKP5iQAVQb", "Great Hills Smiles Dental", 5, 75, "+15125555387", "dentists|cosmeticdentists", "Round Rock", "TX", 1162.33],
  ["yoOyfX4n_Mc5S-fGNm3ttg", "Bluebonnet Dental Studio", 4.5, 17, "+15125550520", "dentists", "Bee Cave", "TX", 9169.19],
  ["tq4hLY_OPWb2ZYU42HuAEL", "Shoal Creek Smiles Dental", 3.5, 280, "+15125556588", "dentists|cosmeticdentists", "Austin", "TX", 12839.47],
  ["8lyZJdqofSkqmHQ33uhEgs", "Bouldin Dental Associates", 4.5, 22, "+15125557341", "dentists|orthodontists", "Austin", "TX", 3581.98],
  ["ZFmO6gz9ZumIItBJ9PkdW7", "Capital City Dental Studio", 5, 74, "+15125552705", "dentists|orthodontists", "Austin", "TX", 13313.42],
  ["jabMWqYlSAENoRzZLnt2V6", "Bluebonnet Dental Associates", 4, 323, "+15125557164", "dentists|pediatric_dentists", "Austin", "TX", 3138.78],
  ["ZIMSJgm_DKSLU_y5-qW3fu", "Rosedale Dental Group", 5, 15, "+15125558350", "dentists|pediatric_dentists", "Austin", "TX", 16409.49],
  ["HE6vRSGwy-TA5m4gxaXf1v", "Bouldin Dental Studio", 4.5, 37, "+15125559882", "dentists", "Austin", "TX", 17433.56],
  ["FEU6NlDS5m1nZi50JlFftt", "Rosedale Dental Associates", 4.5, 12, "+15125554600", "dentists|cosmeticdentists", "Austin", "TX", 15809.48],
  ["flun5G-iPXvmYgOymgY_d5", "Cherrywood Dental Care", 5, 296, "+15125559401", "dentists", "Austin", "TX", 1249.66],
  ["tdeWCp7pI6aPhiezgOkTnj", "Domain Smiles Dental", 3.5, 120, "+15125552536", "dentists|pediatric_dentists", "Austin", "TX", 712.69],
  ["tPhEY2VrNlN4H3i0SWE0q7", "Lady Bird Smiles Dental", 4, 78, "+15125551184", "dentists|orthodontists", "Austin", "TX", 4243.69],
  ["0LP9TTaKNSuPgdgLoAgD2Z", "Zilker Family Dentistry", 5, 175, "+15125556111", "dentists|orthodontists", "Austin", "TX", 4175.08],
  ["8D8x3BP7yHaBHoMqg_U9eU", "Travis Heights Dental Care", 3.5, 300, "+15125551349", "dentists", "Austin", "TX", 11309.2],
  ["fJsnk2Ky0u9aE2ZxADRHcc", "Springdale Dental Care", 4.5, 12, "+15125553929", "dentists|cosmeticdentists", "Austin", "TX", 14703.2],
  ["0JbiIWxDoGgg1PihSfRumx", "Travis Heights Dental Studio", 4, 436, "+15125557231", "dentists", "Austin", "TX", 11753.67],
  ["5yXyldugJHMwsfBOoSxbf9", "Westlake Dental Care", 5, 12, "+15125554782", "dentists", "Austin", "TX", 13696.36],
  ["pfQZZcJ5-1R0uv8Qb2bXL-", "Riverside Family Dentistry", 4.5, 386, "+15125559761", "dentists", "Austin", "TX", 5154.08],
  ["mtyz35bCWVufZpyZp5bAEB", "ABC Plumbing", 4.5, 210, "+15125555748", "plumbing", "Austin", "TX", 8597.13],  // trap: plumbing category in a dentist search → rejected (category_mismatch)
  ["RwLACJEkrqkdDnOWBkynXx", "Aspen Dental - South Lamar", 3.5, 182, "+15125554101", "dentists", "Pflugerville", "TX", 715.2],  // trap: national chain name (aspen dental) → rejected (chain)
  ["Wc0P_EYuPSaoi2OwHBJCJ4", "Hyde Park Dental Associates", 4, 25, "+15125551948", "dentists", "Bee Cave", "TX", 5418.03],
  ["kFVvWMqSy48iGHlxlHbdJr", "Westlake Family Dentistry", 5, 112, "+15125551130", "dentists", "Austin", "TX", 14219.44],
  ["nWA4GgBO-aVJ-08MTUavpf", "Barton Hills Family Dental", 5, 21, "", "dentists|orthodontists", "Round Rock", "TX", 17420.95],  // trap: no phone number → rejected (no_phone)
  ["0gIoFLp90LWYoWcEpdeljO", "Hyde Park Smiles Dental", 5, 121, "+15125553845", "dentists|cosmeticdentists", "Austin", "TX", 12631.42],
  ["CwXRqVj0jP_onuoGEgl7dg", "Lakeline Smiles Dental", 4.5, 57, "+15125552967", "dentists", "Austin", "TX", 11007.17],
  ["CfkrV6cCG5fVAFidbt_Yoj", "Sun City Family Dentistry", 5, 12, "+15125555844", "dentists", "Georgetown", "TX", 41000],  // trap: Georgetown, 41000 m, out of area → rejected (out_of_area)
  ["BATMeCnyQS5SfnsrCJjtoU", "South Congress Dental Studio", 3.5, 309, "+15125555307", "dentists", "Austin", "TX", 15935.52],
];

const AREA: Record<string, { zip: string; lat: number; lon: number }> = {
  TX: { zip: "77002", lat: 29.76, lon: -95.37 },
};

function build(r: Row): YelpBusiness {
  const [id, name, rating, reviews, phone, cats, city, state, distance, closed] = r;
  const digits = phone.replace(/\D/g, "");
  const display = digits.length === 11 ? `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}` : "";
  return makeYelpBusiness({
    id,
    alias: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${city.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    rating,
    review_count: reviews,
    phone,
    display_phone: display,
    categories: cats.split("|").map((alias) => ({ alias, title: CATEGORY_TITLES[alias] ?? alias })),
    is_closed: closed ?? false,
    distance,
    coordinates: { latitude: AREA.TX.lat, longitude: AREA.TX.lon },
    location: {
      address1: "100 Main St",
      address2: null,
      address3: null,
      city,
      zip_code: AREA.TX.zip,
      country: "US",
      state,
      display_address: ["100 Main St", `${city}, ${state} ${AREA.TX.zip}`],
    },
  });
}

export const HOUSTON_PLUMBERS: readonly YelpBusiness[] = HOUSTON_ROWS.map(build);
export const DALLAS_HVAC: readonly YelpBusiness[] = DALLAS_ROWS.map(build);
export const AUSTIN_DENTISTS: readonly YelpBusiness[] = AUSTIN_ROWS.map(build);

export type TrapSearch = "plumbing-houston" | "hvac-dallas" | "dentists-austin";

/** Search-job inputs for each trap set. */
export const TRAP_SEARCHES: Record<TrapSearch, { location: string; categoryAliases: string[]; records: readonly YelpBusiness[] }> = {
  "plumbing-houston": { location: "Houston, TX", categoryAliases: ["plumbing"], records: HOUSTON_PLUMBERS },
  "hvac-dallas": { location: "Dallas, TX", categoryAliases: ["hvac"], records: DALLAS_HVAC },
  "dentists-austin": { location: "Austin, TX", categoryAliases: ["dentists"], records: AUSTIN_DENTISTS },
};

const WEEKDAY_HOURS = [
  {
    open: [0, 1, 2, 3, 4].map((day) => ({ is_overnight: false, start: "0800", end: "1700", day })),
    hours_type: "REGULAR",
    is_open_now: true,
  },
];
const photos = (id: string) => [1, 2, 3].map((i) => `https://img.example.test/${id}/${i}.jpg`);

/** Detail responses (enrichment): two unclaimed and four claimed businesses. */
export const TRAP_DETAILS: Record<string, Partial<YelpBusinessDetails>> = Object.fromEntries(
  (
    [
      ["7iNUtRD6-1_PkjO9UEgQlq", false], // Armadillo Plumbers (Houston)
      ["Zo5xddprE3f1rrznPHRszC", true], // Montrose Plumbing & Repair (Houston)
      ["7XYaFsPEm24Gt113tVZHot", true], // Comanche Climate Control (Dallas)
      ["V7nZefv8b3jutgmSl3dLpp", true], // Highland Park Air Conditioning (Dallas)
      ["tdeWCp7pI6aPhiezgOkTnj", true], // Domain Smiles Dental (Austin)
      ["yoOyfX4n_Mc5S-fGNm3ttg", false], // Bluebonnet Dental Studio (Austin)
    ] as const
  ).map(([id, claimed]) => [id, { is_claimed: claimed, photos: photos(id), hours: WEEKDAY_HOURS }]),
);

/** A fake Yelp that answers each trap search by its first category alias (empty for anything else). */
export function createTrapYelp(): FakeYelpClient {
  const all = [...HOUSTON_PLUMBERS, ...DALLAS_HVAC, ...AUSTIN_DENTISTS];
  const byCategory: Record<string, readonly YelpBusiness[]> = {
    plumbing: HOUSTON_PLUMBERS,
    hvac: DALLAS_HVAC,
    dentists: AUSTIN_DENTISTS,
  };
  const client = createFakeYelp({
    results: (p: YelpSearchParams) => [...(byCategory[(p.categories ?? "").split(",")[0]] ?? [])],
    catalog: all,
    details: TRAP_DETAILS,
  });
  return client;
}
