import { readFileSync } from "node:fs";
import path from "node:path";
import { startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { count, sql } from "drizzle-orm";
import { normalizeName, phoneDigits } from "@/lib/format";
import type { Db } from "./client";
import { getRules } from "./repo/rules";
import {
  type ActivityType,
  type Business,
  type CallOutcome,
  type NewActivity,
  type NewBusiness,
  activities,
  businesses,
  callCampaigns,
  callQueueItems,
  emailCampaigns,
  emailEnrollments,
  emailMessages,
  emailSteps,
  qualificationRules,
  searchJobs,
} from "./schema";

export type SeedSummary = Record<string, number>;

/** Every table, in an order safe for counting/reporting. */
const TABLES = {
  qualification_rules: qualificationRules,
  search_jobs: searchJobs,
  businesses,
  activities,
  call_campaigns: callCampaigns,
  call_queue_items: callQueueItems,
  email_campaigns: emailCampaigns,
  email_steps: emailSteps,
  email_enrollments: emailEnrollments,
  email_messages: emailMessages,
} as const;

/** Minimal Yelp Fusion search record shape the seed reads from fixtures. */
type FixtureBusiness = {
  id: string;
  alias: string;
  name: string;
  image_url?: string;
  is_closed: boolean;
  url: string;
  review_count: number;
  categories: { alias: string; title: string }[];
  rating: number;
  coordinates: { latitude: number | null; longitude: number | null };
  transactions: string[];
  price?: string;
  location: {
    address1?: string | null;
    address2?: string | null;
    city: string;
    zip_code: string;
    country: string;
    state: string;
  };
  phone: string;
  display_phone: string;
  distance?: number;
};
type FixtureFile = { _traps: { id: string }[]; businesses: FixtureBusiness[]; total: number };

export const SEED_SEARCHES = [
  { file: "search-plumbing-houston.json", term: "plumbers", category: "plumbing", location: "Houston, TX" },
  { file: "search-hvac-dallas.json", term: "hvac", category: "hvac", location: "Dallas, TX" },
  { file: "search-dentists-austin.json", term: "dentists", category: "dentists", location: "Austin, TX" },
] as const;

const FIXTURE_DIR = path.join(process.cwd(), "fixtures", "yelp");
const SEED_TZ = "America/Chicago";

function readFixture(file: string): FixtureFile {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as FixtureFile;
}

function toNewBusiness(
  b: FixtureBusiness,
  ctx: { jobId: string; searchCategory: string; searchLocation: string },
): NewBusiness {
  return {
    yelpId: b.id,
    yelpAlias: b.alias,
    name: b.name,
    nameNormalized: normalizeName(b.name),
    phone: b.phone || null,
    phoneDigits: phoneDigits(b.phone),
    displayPhone: b.display_phone || null,
    yelpUrl: b.url,
    imageUrl: b.image_url || null,
    rating: b.rating == null ? null : b.rating.toFixed(1),
    reviewCount: b.review_count,
    price: b.price ?? null,
    categories: b.categories,
    primaryCategory: b.categories[0]?.alias ?? null,
    isClosed: b.is_closed,
    isClaimed: null,
    address1: b.location.address1 ?? null,
    address2: b.location.address2 ?? null,
    city: b.location.city,
    state: b.location.state,
    zip: b.location.zip_code,
    country: b.location.country,
    latitude: b.coordinates.latitude,
    longitude: b.coordinates.longitude,
    distanceM: b.distance ?? null,
    transactions: b.transactions,
    raw: b,
    qualification: "review",
    score: 0,
    rejectionReasons: [],
    sourceJobId: ctx.jobId,
    searchCategory: ctx.searchCategory,
    searchLocation: ctx.searchLocation,
  };
}

const OWNER_FIRST = ["Maria", "James", "Linh", "Robert", "Priya", "Carlos", "Dana", "Marcus", "Elena", "Tom", "Aisha", "Greg"];
const OWNER_LAST = ["Gonzalez", "Whitfield", "Nguyen", "Barrett", "Patel", "Ramirez", "Cole", "Johnson", "Petrova", "Hughes", "Okafor", "Sutton"];

const NOTE_BODIES = [
  "Owner prefers calls before 10am.",
  "Spoke with the office manager; send pricing sheet.",
  "Website is outdated, good fit for our offer.",
  "Has two trucks, looking to hire a third tech.",
  "Mentioned they lose leads after hours.",
  "Asked us to follow up after the holidays.",
  "Family-run business, 15 years in the area.",
  "Currently uses a competitor; contract ends in March.",
  "Interested in a demo next week.",
  "Front desk said owner is usually in the field.",
];

const CALL_HISTORY: { outcome: CallOutcome; body: string }[] = [
  { outcome: "no_answer", body: "" },
  { outcome: "voicemail", body: "Left a short voicemail." },
  { outcome: "busy", body: "" },
  { outcome: "interested", body: "Wants a follow-up email with details." },
  { outcome: "not_interested", body: "Happy with current setup." },
];

/** A time `minutesAgo` before now, clamped so it never falls before local midnight. */
function earlierToday(now: Date, minutesAgo: number): Date {
  const midnight = fromZonedTime(startOfDay(toZonedTime(now, SEED_TZ)), SEED_TZ);
  const sinceMidnight = now.getTime() - midnight.getTime();
  const offset = Math.min(minutesAgo * 60_000, Math.floor(sinceMidnight / 2));
  return new Date(now.getTime() - offset);
}

function daysAgo(now: Date, days: number, hours = 0): Date {
  return new Date(now.getTime() - (days * 24 + hours) * 3_600_000);
}

function emailFor(first: string, b: Business): string {
  const domain = b.nameNormalized.replace(/[^a-z0-9]/g, "").slice(0, 24) || "business";
  return `${first.toLowerCase()}@${domain}.example`;
}

function render(tpl: string, b: Business): string {
  const first = b.ownerName?.split(" ")[0] ?? "";
  const tokens: Record<string, string> = {
    business_name: b.name,
    owner_first_name: first,
    owner_name: b.ownerName ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    category: b.primaryCategory ?? "",
    rating: b.rating ?? "",
    review_count: String(b.reviewCount),
    phone: b.displayPhone ?? "",
  };
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => tokens[k] ?? "");
}

async function countAll(db: Db): Promise<SeedSummary> {
  const summary: SeedSummary = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const [row] = await db.select({ n: count() }).from(table);
    summary[name] = Number(row.n);
  }
  return summary;
}

/**
 * Idempotent demo seed: truncates every table, then inserts the default rules
 * row, three completed search jobs with every fixture business (unqualified:
 * qualification 'review', score 0), owners, activities, two call campaigns and
 * one email campaign. Returns row counts per table.
 */
export async function seed(db: Db, opts: { now?: Date } = {}): Promise<SeedSummary> {
  const now = opts.now ?? new Date();

  await db.execute(
    sql.raw(`TRUNCATE TABLE ${Object.keys(TABLES).map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`),
  );

  await getRules(db);

  // ---- search jobs + businesses ------------------------------------------------
  const bySearch: Record<string, { ordinary: Business[]; all: Business[] }> = {};
  for (const [i, s] of SEED_SEARCHES.entries()) {
    const fixture = readFixture(s.file);
    const n = fixture.businesses.length;
    const startedAt = daysAgo(now, 7 - i * 2);
    const [job] = await db
      .insert(searchJobs)
      .values({
        term: s.term,
        location: s.location,
        categoryAliases: [s.category],
        radiusM: 20000,
        maxResults: 200,
        status: "completed",
        fetchedCount: n,
        qualifiedCount: 0,
        reviewCount: n,
        rejectedCount: 0,
        apiCalls: Math.ceil(n / 50),
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 4_000),
        createdAt: startedAt,
      })
      .returning();

    const rows = fixture.businesses.map((b) =>
      toNewBusiness(b, { jobId: job.id, searchCategory: s.category, searchLocation: s.location }),
    );
    const inserted = await db.insert(businesses).values(rows).returning();
    const trapIds = new Set(fixture._traps.map((t) => t.id));
    // "Ordinary" = not a trap and not the cross-fixture ABC Plumbing record.
    const ordinary = inserted.filter((b) => !trapIds.has(b.yelpId) && b.name !== "ABC Plumbing");
    bySearch[s.category] = { ordinary, all: inserted };
  }

  const houston = bySearch.plumbing.ordinary;
  const dallas = bySearch.hvac.ordinary;
  const austin = bySearch.dentists.ordinary;

  // ---- owners on 12 businesses (4 per city) -------------------------------------
  const ownerTargets = [...houston.slice(0, 4), ...dallas.slice(0, 4), ...austin.slice(0, 4)];
  const owned: Business[] = [];
  for (const [i, b] of ownerTargets.entries()) {
    const ownerName = `${OWNER_FIRST[i]} ${OWNER_LAST[i]}`;
    const [u] = await db
      .update(businesses)
      .set({ ownerName, ownerEmail: emailFor(OWNER_FIRST[i], b), updatedAt: now })
      .where(sql`${businesses.id} = ${b.id}`)
      .returning();
    owned.push(u);
  }

  // ---- historic notes and calls --------------------------------------------------
  const activityRows: NewActivity[] = [];
  const historicPool = [...houston.slice(4, 12), ...dallas.slice(4, 10), ...austin.slice(4, 10), ...owned];
  for (let i = 0; i < 20; i++) {
    const b = historicPool[i % historicPool.length];
    activityRows.push({
      businessId: b.id,
      type: "note",
      body: NOTE_BODIES[i % NOTE_BODIES.length],
      agent: i % 2 ? "Sam" : "Jordan",
      occurredAt: daysAgo(now, 1 + (i % 12), i % 7),
    });
  }
  const contactedIds = new Set<string>();
  // Historic calls stay out of Houston so the call queue below gets untouched businesses.
  const callPool = [...dallas.slice(4, 10), ...austin.slice(4, 10)];
  for (let i = 0; i < 10; i++) {
    const b = callPool[i % callPool.length];
    const call = CALL_HISTORY[i % CALL_HISTORY.length];
    contactedIds.add(b.id);
    activityRows.push({
      businessId: b.id,
      type: "call",
      outcome: call.outcome,
      body: call.body,
      agent: i % 2 ? "Sam" : "Jordan",
      occurredAt: daysAgo(now, 1 + (i % 6), 2 + (i % 5)),
    });
  }
  for (const id of contactedIds) {
    await db
      .update(businesses)
      .set({ status: "contacted", lastContactedAt: daysAgo(now, 1), updatedAt: now })
      .where(sql`${businesses.id} = ${id}`);
  }

  // ---- call campaigns --------------------------------------------------------------
  const [running] = await db
    .insert(callCampaigns)
    .values({
      name: "Houston plumbers — Q4 outreach",
      description: "Qualified Houston-area plumbing companies.",
      status: "running",
      script:
        "Hi, is this {{owner_first_name}}? This is {{agent}} calling about {{business_name}} in {{city}}.\n\n" +
        "We help local plumbing companies answer every call, even after hours.\n\n" +
        "- Ask: how do you handle calls when your techs are on a job?\n- Offer: a 15-minute demo this week.",
      dailyCap: 100,
      timezone: SEED_TZ,
      maxConcurrentAgents: 5,
      maxAttempts: 3,
      createdAt: daysAgo(now, 5),
      updatedAt: daysAgo(now, 5),
    })
    .returning();
  await db.insert(callCampaigns).values({
    name: "Dallas HVAC — spring tune-ups",
    description: "Draft list for the spring push.",
    status: "draft",
    script: "Hi {{owner_first_name}}, calling about {{business_name}}…",
    dailyCap: 60,
    callingHoursStart: "09:00",
    callingHoursEnd: "17:00",
    timezone: SEED_TZ,
    maxConcurrentAgents: 3,
    createdAt: daysAgo(now, 2),
    updatedAt: daysAgo(now, 2),
  });

  // 25 queue items from ordinary Houston businesses that have no call history.
  const queuePool = houston.filter((b) => !contactedIds.has(b.id)).slice(0, 25);
  if (queuePool.length < 25) throw new Error(`seed: need 25 Houston businesses for the queue, found ${queuePool.length}`);
  const todayOutcomes: { outcome: CallOutcome; status: Business["status"]; notes: string }[] = [
    { outcome: "interested", status: "interested", notes: "Wants a demo Thursday." },
    { outcome: "not_interested", status: "not_interested", notes: "Not a fit right now." },
    { outcome: "interested", status: "interested", notes: "Send pricing to the office." },
    { outcome: "wrong_number", status: "new", notes: "Number belongs to a residence." },
    { outcome: "not_interested", status: "not_interested", notes: "" },
  ];
  await db.insert(callQueueItems).values(
    queuePool.map((b, i) => {
      const done = i < todayOutcomes.length ? todayOutcomes[i] : null;
      const at = done ? earlierToday(now, 60 - i * 10) : null;
      return {
        campaignId: running.id,
        businessId: b.id,
        position: i + 1,
        state: done ? ("completed" as const) : ("pending" as const),
        attempts: done ? 1 : 0,
        claimedBy: done ? (i % 2 ? "Sam" : "Jordan") : null,
        claimedAt: at ? new Date(at.getTime() - 120_000) : null,
        lastOutcome: done?.outcome ?? null,
        lastOutcomeAt: at,
        notes: done?.notes || null,
      };
    }),
  );
  for (const [i, done] of todayOutcomes.entries()) {
    const b = queuePool[i];
    const at = earlierToday(now, 60 - i * 10);
    activityRows.push({
      businessId: b.id,
      type: "call",
      outcome: done.outcome,
      body: done.notes,
      agent: i % 2 ? "Sam" : "Jordan",
      campaignType: "call",
      campaignId: running.id,
      occurredAt: at,
    });
    await db
      .update(businesses)
      .set({
        status: done.status,
        lastContactedAt: at,
        ...(done.outcome === "wrong_number" ? { tags: ["wrong_number"] } : {}),
        updatedAt: now,
      })
      .where(sql`${businesses.id} = ${b.id}`);
  }

  // ---- email campaign ----------------------------------------------------------------
  const [emailCampaign] = await db
    .insert(emailCampaigns)
    .values({
      name: "Owner intro sequence",
      status: "running",
      fromName: "Alex from LeadDesk",
      fromEmail: "alex@leaddesk.example",
      dailyCap: 50,
      createdAt: daysAgo(now, 4),
      updatedAt: daysAgo(now, 4),
    })
    .returning();
  const steps = await db
    .insert(emailSteps)
    .values([
      {
        campaignId: emailCampaign.id,
        stepOrder: 1,
        delayDays: 0,
        subject: "Quick question about {{business_name}}",
        body:
          "Hi {{owner_first_name}},\n\nI saw {{business_name}} has {{review_count}} reviews in {{city}}, nice work. " +
          "Do you have a plan for calls that come in while your team is on a job?\n\nAlex",
      },
      {
        campaignId: emailCampaign.id,
        stepOrder: 2,
        delayDays: 3,
        subject: "Re: Quick question about {{business_name}}",
        body: "Hi {{owner_first_name}}, following up on my note from earlier this week. Worth a 15-minute call?\n\nAlex",
      },
      {
        campaignId: emailCampaign.id,
        stepOrder: 3,
        delayDays: 4,
        subject: "Closing the loop",
        body: "Hi {{owner_first_name}}, I'll stop here. If missed calls ever become a problem for {{business_name}}, reply anytime.\n\nAlex",
      },
    ])
    .returning();
  const step1 = steps.find((s) => s.stepOrder === 1)!;

  const enrolledBusinesses = owned.slice(0, 8);
  const enrollments = await db
    .insert(emailEnrollments)
    .values(
      enrolledBusinesses.map((b, i) => {
        const sent = i < 4;
        const sentAt = daysAgo(now, 1, i);
        return {
          campaignId: emailCampaign.id,
          businessId: b.id,
          state: "active" as const,
          currentStep: sent ? 1 : 0,
          lastSentAt: sent ? sentAt : null,
          nextSendAt: sent ? new Date(sentAt.getTime() + steps[1].delayDays * 86_400_000) : now,
          enrolledAt: daysAgo(now, 2),
          updatedAt: sent ? sentAt : daysAgo(now, 2),
        };
      }),
    )
    .returning();
  for (let i = 0; i < 4; i++) {
    const b = enrolledBusinesses[i];
    const enrollment = enrollments.find((e) => e.businessId === b.id)!;
    const sentAt = daysAgo(now, 1, i);
    const subject = render(step1.subject, b);
    await db.insert(emailMessages).values({
      enrollmentId: enrollment.id,
      stepId: step1.id,
      businessId: b.id,
      toEmail: b.ownerEmail!,
      subject,
      bodyRendered: render(step1.body, b),
      status: "dry_run",
      providerId: null,
      sentAt,
      createdAt: sentAt,
    });
    activityRows.push({
      businessId: b.id,
      type: "email" satisfies ActivityType,
      body: subject,
      outcome: "dry_run",
      campaignType: "email",
      campaignId: emailCampaign.id,
      occurredAt: sentAt,
    });
  }

  await db.insert(activities).values(activityRows);

  return countAll(db);
}
