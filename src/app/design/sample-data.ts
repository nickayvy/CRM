import type { ActivityType, BusinessStatus, Qualification } from "@/db/schema";

/** Showcase-only sample data. Fixed ISO timestamps keep server and client renders identical. */

export type SampleBusiness = {
  id: string;
  name: string;
  category: string;
  city: string;
  phone: string;
  rating: number;
  reviewCount: number;
  score: number;
  qualification: Qualification;
  status: BusinessStatus;
  reasons: string[];
  lastActivityAt: string;
};

const NAMES = [
  "Reliable Plumbing Co.",
  "Bayou City Drain Pros",
  "Heights Pipe & Fixture",
  "Lone Star Rooter",
  "Gulf Coast Water Heaters",
  "Montrose Leak Detection",
  "Katy Family Plumbing",
  "Spring Branch Sewer",
  "Memorial Drain Works",
  "Pearland Plumbing Pros",
  "Sugar Land Pipe Doctors",
  "Cypress Creek Plumbing",
  "Westchase Water Works",
  "Galleria Plumbing Group",
  "Clear Lake Drain Co.",
  "Humble Hydro Jetting",
  "Bellaire Backflow",
  "Midtown Faucet Fixers",
  "Tomball Tank & Tap",
  "Kingwood Pipe Pros",
  "Rice Village Plumbing",
  "Alief Emergency Plumbing",
  "Friendswood Fixtures",
  "Dusty Wrench Plumbing",
  "EaDo Drain & Sewer",
  "Northside Repipe",
  "Channelview Plumbing",
  "Garden Oaks Gas & Water",
  "Third Ward Plumbing",
  "Seabrook Septic & Drain",
];

const CITIES = ["Houston", "Houston", "Houston", "Katy", "Pearland", "Sugar Land", "Spring", "Cypress"];
const STATUSES: BusinessStatus[] = ["new", "new", "contacted", "interested", "callback", "not_interested", "converted", "do_not_call"];
const REASONS = ["low_rating", "too_few_reviews", "no_phone", "chain", "out_of_area", "unclaimed", "low_score"];

export const REASON_TEXT: Record<string, string> = {
  closed: "Business is permanently closed",
  category_mismatch: "No category matches the search",
  chain: "Matches a known chain pattern",
  multi_location: "Same name in 3+ locations in this city",
  no_phone: "No phone number listed",
  out_of_area: "Outside the search radius or state",
  low_rating: "Rating below 3.5",
  too_few_reviews: "Fewer than 5 reviews",
  too_many_reviews: "More reviews than the configured maximum",
  duplicate_phone: "Phone number already belongs to another business",
  unclaimed: "Yelp listing is unclaimed (soft flag)",
  low_score: "Score below 40, needs review (soft flag)",
};

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

export const BUSINESSES: SampleBusiness[] = NAMES.map((name, i) => {
  const rating = Math.round((2.5 + ((i * 7) % 26) / 10) * 2) / 2;
  const reviewCount = (i * 37 + 3) % 420;
  const score = Math.min(100, Math.max(8, Math.round(40 + (rating - 3) * 18 + Math.log10(reviewCount + 1) * 8 - (i % 5) * 3)));
  const reasons = rating < 3.5 ? ["low_rating"] : reviewCount < 5 ? ["too_few_reviews"] : i % 9 === 0 ? [pick(REASONS, i)] : [];
  const qualification: Qualification = reasons.some((r) => r !== "unclaimed" && r !== "low_score")
    ? "rejected"
    : score < 40
      ? "review"
      : "qualified";
  const day = 1 + (i % 7);
  const hour = 9 + (i % 8);
  return {
    id: `biz_${String(i + 1).padStart(3, "0")}`,
    name,
    category: i % 6 === 0 ? "Water heaters" : i % 4 === 0 ? "Drain cleaning" : "Plumbing",
    city: pick(CITIES, i),
    phone: `+1713555${String(1000 + i * 137).slice(-4)}`,
    rating,
    reviewCount,
    score,
    qualification,
    status: pick(STATUSES, i * 3),
    reasons,
    lastActivityAt: `2026-11-0${day}T${String(hour).padStart(2, "0")}:15:00.000Z`,
  };
});

export type SampleActivity = {
  id: string;
  type: ActivityType;
  title: string;
  body?: string;
  agent?: string;
  at: string;
};

export const ACTIVITIES: SampleActivity[] = [
  { id: "a1", type: "call", title: "Call: interested", body: "Owner wants a quote for the website refresh. Call back Tuesday after 2 pm.", agent: "Maya", at: "2026-11-06T22:40:00.000Z" },
  { id: "a2", type: "email", title: "Email sent: Intro (step 1)", agent: "Sequence", at: "2026-11-06T14:00:00.000Z" },
  { id: "a3", type: "status_change", title: "Status: New → Contacted", agent: "Maya", at: "2026-11-05T17:12:00.000Z" },
  { id: "a4", type: "note", title: "Note", body: "Second location opening in Katy next spring.", agent: "Jordan", at: "2026-11-04T19:30:00.000Z" },
  { id: "a5", type: "system", title: "Imported from Yelp search “plumbing, Houston, TX”", at: "2026-11-01T12:00:00.000Z" },
];

export const CALLS_PER_DAY = [
  { day: "Mon", calls: 42, connects: 11 },
  { day: "Tue", calls: 58, connects: 17 },
  { day: "Wed", calls: 51, connects: 14 },
  { day: "Thu", calls: 64, connects: 21 },
  { day: "Fri", calls: 39, connects: 9 },
];

export const CAMPAIGNS = [
  { id: "c1", name: "Houston plumbers: November", status: "running" as const, progress: 62, total: 120, done: 74 },
  { id: "c2", name: "Katy HVAC follow-ups", status: "paused" as const, progress: 18, total: 60, done: 11 },
  { id: "c3", name: "Pearland dentists (draft)", status: "draft" as const, progress: 0, total: 45, done: 0 },
];
