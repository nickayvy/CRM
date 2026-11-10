// AC-18.5: name cleaning, table-driven.
import { describe, expect, it } from "vitest";
import { cleanBusinessName } from "@/lib/google-places/clean-name";

const DALLAS = { city: "Dallas", state: "TX" };
const HOUSTON = { city: "Houston", state: "TX" };

const CASES: [raw: string, expected: string, ctx?: { city?: string | null; state?: string | null }][] = [
  // the package's named cases
  ["BEST ROOFING DALLAS TX - Free Estimates", "Best Roofing"],
  ["BEST ROOFING DALLAS TX - Free Estimates", "Best Roofing", DALLAS],
  ["Joe's Plumbing | 24/7 Emergency Service", "Joe's Plumbing"],
  ["ABC HVAC", "ABC HVAC"],
  ["McDonald Roofing LLC", "McDonald Roofing LLC"],
  // only a tagline or a location → raw name
  ["Free Estimates", "Free Estimates"],
  ["Dallas, TX", "Dallas, TX", DALLAS],
  ["24/7 Emergency Service", "24/7 Emergency Service"],
  // separators
  ["Reliable Plumbing - Houston", "Reliable Plumbing", HOUSTON],
  ["Bright Smile Dental: Family & Cosmetic Dentistry", "Bright Smile Dental"],
  ["Sunrise Bakery • Fresh Bread Daily", "Sunrise Bakery"],
  ["Iron Gym — 24 Hours", "Iron Gym"],
  ["Elite Painting - Residential & Commercial", "Elite Painting"],
  // trailing tagline clauses
  ["Lone Star Roofing, Licensed & Insured", "Lone Star Roofing"],
  ["Lone Star Roofing, Free Estimates", "Lone Star Roofing"],
  ["Guardian Pest Control Family Owned & Operated", "Guardian Pest Control"],
  // tacked-on locations
  ["Best Roofing San Antonio TX", "Best Roofing"],
  ["Cool Air HVAC Dallas TX", "Cool Air HVAC"],
  ["Reliable Plumbing of Houston", "Reliable Plumbing", HOUSTON],
  ["Precision Auto Repair in Plano", "Precision Auto Repair", { city: "Plano", state: "TX" }],
  ["Mile High Plumbing CO", "Mile High Plumbing", { city: "Denver", state: "CO" }],
  ["Gulf Coast Plumbing Texas", "Gulf Coast Plumbing", HOUSTON],
  ["Smith & Sons TX", "Smith & Sons"],
  // names that must not change
  ["Green Lawn Care Co", "Green Lawn Care Co", DALLAS],
  ["Smith Law Firm PLLC", "Smith Law Firm PLLC"],
  ["Texas Roofing Pros", "Texas Roofing Pros", HOUSTON],
  ["Main Street Dental Care", "Main Street Dental Care"],
  ["Kim's Nails & Spa", "Kim's Nails & Spa"],
  ["Top Rated Roofing", "Top Rated Roofing"],
  ["Dallas Roofing Company", "Dallas Roofing Company", DALLAS],
  // shouting and lower case
  ["JOE'S BARBER SHOP", "Joe's Barber Shop"],
  ["THE ROOF DOCTOR", "The Roof Doctor"],
  ["A-1 PLUMBING SERVICES", "A-1 Plumbing Services"],
  ["O'NEIL ELECTRIC", "O'Neil Electric"],
  ["MCDONALD ROOFING", "McDonald Roofing"],
  ["dfw pest control", "DFW Pest Control"],
  ["ALL STAR HEATING AND AIR", "All Star Heating and Air"],
  // whitespace
  ["  Ace   Locksmith  ", "Ace Locksmith"],
];

describe("cleanBusinessName", () => {
  it(`has at least 25 cases (${CASES.length})`, () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CASES)("%s → %s", (raw, expected, ctx) => {
    expect(cleanBusinessName(raw, ctx)).toBe(expected);
  });

  it("never returns an empty string", () => {
    for (const raw of ["", "   ", "-", "|", "TX", "Free Estimates - 24/7"]) {
      const out = cleanBusinessName(raw, DALLAS);
      expect(out.trim().length, JSON.stringify(raw)).toBeGreaterThan(0);
    }
  });
});
