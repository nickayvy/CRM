// Local-only demo data so every screen has something to show during QA:
// 140 businesses across the three sources, leads for the mock user, call and
// email campaigns in every state, a week of call outcomes and due callbacks.
// Refuses to run against a real database. See scripts/qa/README.md.
import { getDb, closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { normalizeName } from "@/lib/format";

if (process.env.DATABASE_URL?.trim()) {
  console.error("Refusing to seed demo data: DATABASE_URL is set. This script is for the local PGlite database only.");
  process.exit(1);
}
const USER = "11111111-1111-4111-8111-111111111111";
const db = getDb();
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

const trades = ["Roofing", "Plumbing", "HVAC", "Electric", "Landscaping", "Pest Control", "Garage Doors", "Painting", "Flooring", "Pool Service"];
const prefixes = ["Lone Star", "Bayou City", "Hill Country", "Gulf Coast", "Trinity", "Bluebonnet", "Alamo", "Red River", "Brazos", "Pecan Valley", "Summit", "Cedar Ridge", "Ironwood", "Northside", "Heritage"];
const cities = [["Houston", "TX", "77002"], ["Dallas", "TX", "75201"], ["Austin", "TX", "78701"], ["San Antonio", "TX", "78205"], ["Fort Worth", "TX", "76102"]];
const reasons = ["too_few_reviews", "low_rating", "chain", "no_phone", "closed", "category_mismatch", "out_of_area"];
const statuses: s.BusinessStatus[] = ["new", "new", "new", "new", "contacted", "contacted", "interested", "callback", "not_interested", "converted", "do_not_call"];

async function main() {
  const [existing] = await db.select({ id: s.businesses.id }).from(s.businesses).limit(1);
  if (existing) {
    console.log("Demo data not seeded: the database already has businesses. Delete .data/ to start over.");
    return;
  }
  const rows: s.NewBusiness[] = [];
  for (let i = 0; i < 140; i++) {
    const trade = trades[i % trades.length];
    const name = `${prefixes[(i * 7) % prefixes.length]} ${trade}${i >= 15 * 4 ? ` ${["Co", "Pros", "Group", "& Sons", "Experts"][i % 5]}` : ""} ${i}`.replace(/ \d+$/, i % 3 === 0 ? "" : ` #${i}`);
    const [city, state, zip] = cities[i % cities.length];
    const source: s.BusinessSource = i % 10 < 5 ? "google" : i % 10 < 8 ? "trustpilot" : "yelp";
    const q: s.Qualification = i % 10 < 5 ? "qualified" : i % 10 < 7 ? "review" : "rejected";
    const slug = `biz${i}.example.com`;
    rows.push({
      source,
      yelpId: source === "yelp" ? `yelp-${i}` : null,
      trustpilotId: source === "trustpilot" ? slug : null,
      googlePlaceId: source === "google" ? `place-${i}` : null,
      slug,
      name: `${name}`,
      nameNormalized: normalizeName(name),
      phone: i % 9 === 8 ? null : `+1713555${String(1000 + i)}`,
      phoneDigits: i % 9 === 8 ? null : `1713555${String(1000 + i)}`,
      displayPhone: i % 9 === 8 ? null : `(713) 555-${String(1000 + i)}`,
      website: `https://${slug}`,
      email: i % 4 === 0 ? null : `hello@${slug}`,
      rating: String((3 + rnd() * 2).toFixed(1)),
      reviewCount: Math.floor(5 + rnd() * 400),
      reviewsLast30d: Math.floor(rnd() * 30),
      categories: [{ alias: trade.toLowerCase().replace(/\s+/g, "_"), title: trade }],
      primaryCategory: trade.toLowerCase().replace(/\s+/g, "_"),
      city, state, zip, country: "US",
      raw: { demo: true },
      qualification: q,
      score: q === "qualified" ? 60 + Math.floor(rnd() * 40) : q === "review" ? 30 + Math.floor(rnd() * 20) : Math.floor(rnd() * 30),
      rejectionReasons: q === "rejected" ? [pick(reasons), ...(rnd() > 0.6 ? [pick(reasons)] : [])].filter((v, k, a) => a.indexOf(v) === k) : [],
      status: q === "qualified" ? pick(statuses) : "new",
      searchCategory: trade.toLowerCase(),
      searchLocation: `${city}, ${state}`,
      createdAt: hoursAgo(rnd() * 24 * 20),
    });
  }
  const biz = await db.insert(s.businesses).values(rows).returning();
  const qualified = biz.filter((b) => b.qualification === "qualified" && b.phone);

  // Leads for the signed-in user.
  const leadStatuses: s.LeadStatus[] = ["queued", "queued", "queued", "queued", "contacted", "contacted", "callback", "success", "failed", "skipped"];
  await db.insert(s.leads).values(
    qualified.slice(0, 38).map((b, i) => ({ userId: USER, businessId: b.id, status: leadStatuses[i % leadStatuses.length], createdAt: hoursAgo(rnd() * 24 * 10) })),
  );

  // Call campaigns.
  const [human, ai, paused, draft] = await db
    .insert(s.callCampaigns)
    .values([
      { name: "Houston roofers: intro call", status: "running", mode: "human", script: "Hi {{name}}, this is …", dailyCap: 40, timezone: "America/Chicago" },
      { name: "DFW HVAC: AI qualifier", status: "running", mode: "ai", script: "Hello …", dailyCap: 60, timezone: "America/Chicago" },
      { name: "Austin plumbers: follow-up", status: "paused", mode: "human", pauseReason: "manual", pausedAt: hoursAgo(30), script: "" },
      { name: "San Antonio landscapers", status: "draft", mode: "human", script: "" },
    ])
    .returning();

  const outcomes: s.CallOutcome[] = ["no_answer", "no_answer", "voicemail", "voicemail", "interested", "not_interested", "callback", "busy", "wrong_number", "interested", "no_answer", "do_not_call"];
  const acts: s.NewActivity[] = [];
  const queue: s.NewCallQueueItem[] = [];
  const addQueue = (campaignId: string, list: s.Business[], doneShare: number) => {
    list.forEach((b, i) => {
      const done = i / list.length < doneShare;
      const o = done ? outcomes[i % outcomes.length] : null;
      const isCallback = o === "callback";
      const when = hoursAgo(1 + rnd() * 24 * 6.5);
      queue.push({
        campaignId, businessId: b.id, position: i + 1,
        state: !done ? "pending" : isCallback ? "callback" : "completed",
        attempts: done ? 1 : 0, lastOutcome: o, lastOutcomeAt: done ? when : null,
        // Callbacks: half overdue, half later today.
        callbackAt: isCallback ? (i % 2 === 0 ? hoursAgo(3 + i) : new Date(Date.now() + (1 + (i % 3)) * 3_600_000)) : null,
      });
      if (done && o) acts.push({ businessId: b.id, type: "call", outcome: o, body: o === "interested" ? "Asked for a quote by email." : "", campaignType: "call", campaignId, agent: campaignId === ai.id ? "AI agent" : pick(["Nick", "Dana"]), occurredAt: when });
    });
  };
  addQueue(human.id, qualified.slice(0, 30), 0.6);
  addQueue(ai.id, qualified.slice(30, 55), 0.45);
  addQueue(paused.id, qualified.slice(55, 65), 0.3);
  await db.insert(s.callQueueItems).values(queue);
  // A handful of calls today so "calls today" is non-zero.
  qualified.slice(0, 7).forEach((b, i) => acts.push({ businessId: b.id, type: "call", outcome: outcomes[(i * 5) % outcomes.length], body: "", campaignType: "call", campaignId: human.id, agent: "Nick", occurredAt: hoursAgo(0.2 + i * 0.4) }));
  qualified.slice(3, 9).forEach((b, i) => acts.push({ businessId: b.id, type: i % 2 ? "note" : "status_change", body: i % 2 ? "Owner prefers mornings. Mentioned a second location opening in spring." : "new → contacted", agent: "Nick", occurredAt: hoursAgo(0.5 + i * 2) }));
  await db.insert(s.activities).values(acts);

  // Email campaign.
  const [ec] = await db.insert(s.emailCampaigns).values([{ name: "Roofers: listing invite", status: "running", fromName: "Nick", fromEmail: "nick@example.test", dailyCap: 50 }, { name: "Winter HVAC check-in", status: "draft", fromName: "Nick", fromEmail: "nick@example.test", dailyCap: 50 }]).returning();
  const steps = await db.insert(s.emailSteps).values([
    { campaignId: ec.id, stepOrder: 1, subject: "A quick question about {{name}}", body: "Hi …", delayDays: 0 },
    { campaignId: ec.id, stepOrder: 2, subject: "Following up", body: "Hi again …", delayDays: 3 },
  ]).returning();
  const emailable = biz.filter((b) => b.qualification === "qualified" && b.email).slice(0, 24);
  const enr = await db.insert(s.emailEnrollments).values(
    emailable.map((b, i) => ({ campaignId: ec.id, businessId: b.id, state: (i % 8 === 0 ? "replied" : i % 11 === 0 ? "bounced" : "active") as s.EnrollmentState, currentStep: 1, nextSendAt: new Date(Date.now() + 86_400_000 * 2), lastSentAt: hoursAgo(2 + i) })),
  ).returning();
  await db.insert(s.emailMessages).values(
    enr.slice(0, 14).map((e, i) => ({ enrollmentId: e.id, stepId: steps[0].id, businessId: e.businessId, toEmail: "x@example.test", subject: "A quick question", bodyRendered: "Hi", status: "dry_run" as const, createdAt: hoursAgo(0.3 + i * 0.3), sentAt: hoursAgo(0.3 + i * 0.3) })),
  );
  console.log({ businesses: biz.length, qualified: qualified.length, queue: queue.length, activities: acts.length, enrollments: enr.length, draft: draft.id });
}
main().then(() => closeDb()).catch(async (e) => { console.error(e); await closeDb().catch(() => {}); process.exit(1); });
