// AC-18.8 (upsert outcomes, cross-source matching, CRM fields), usage counter, jobs and lease.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { count, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getBusiness, updateBusinessCrm, upsertBusinessByYelpId } from "@/db/repo/businesses";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import {
  acquireJobLease,
  addDailySnapshot,
  createGoogleJob,
  getUsage,
  listUnfinishedGoogleJobs,
  releaseJobLease,
  renewJobLease,
  reserveUsage,
  upsertGooglePlace,
  usagePeriod,
} from "@/db/repo/google";
import { createSearchJob, updateSearchJob } from "@/db/repo/search-jobs";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { normalizeGooglePlace } from "@/lib/google-places/normalize";
import { planGoogleSearch } from "@/lib/google-places/plan";
import type { GooglePlace } from "@/lib/google-places/types";
import { makeBusinessRow, makeTrustpilotRow } from "./helpers/builders";
import { makeGooglePlace } from "./helpers/fake-places";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, api_usage, review_snapshots RESTART IDENTITY CASCADE`);
});

const rowOf = (p: GooglePlace) => normalizeGooglePlace(p, { searchCategory: "home_services", searchLocation: "Dallas, TX" });
const total = async () => Number((await db.select({ n: count() }).from(businesses))[0].n);
const CRM = { status: "interested" as const, ownerName: "Pat", notes: "call back", tags: ["vip"], doNotEmail: true };

describe("upsertGooglePlace", () => {
  it("the same place twice is one row; the second outcome is updated and refreshes Google columns", async () => {
    const place = makeGooglePlace();
    const first = await upsertGooglePlace(db, rowOf(place));
    expect(first.outcome).toBe("created");
    expect(first.business).toMatchObject({ source: "google", googlePlaceId: place.id, websiteDomain: expect.any(String) });
    await updateBusinessCrm(db, first.business.id, CRM);

    const second = await upsertGooglePlace(db, rowOf({ ...place, rating: 3.9, userRatingCount: 55 }));
    expect(second.outcome).toBe("updated");
    expect(second.business.id).toBe(first.business.id);
    expect(second.business).toMatchObject({ rating: "3.9", reviewCount: 55, ...CRM });
    expect(await total()).toBe(1);
  });

  it("a place whose phone equals a Trustpilot row's attaches to it: matched, no new row, source/name/rating kept", async () => {
    const { business: tp } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ name: "Acme Roofing Co", phone: "+1 214 555 0001", phoneDigits: "12145550001", rating: "4.2", email: "hi@acme.example", website: null }),
    );
    await updateBusinessCrm(db, tp.id, CRM);
    const place = makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0001", nationalPhoneNumber: "(214) 555-0001", rating: 3.1 });
    const r = await upsertGooglePlace(db, rowOf(place));
    expect(r.outcome).toBe("matched");
    expect(r.business.id).toBe(tp.id);
    expect(await total()).toBe(1);
    const after = (await getBusiness(db, tp.id))!;
    expect(after).toMatchObject({
      googlePlaceId: place.id,
      googleMapsUrl: place.googleMapsUri,
      source: "trustpilot",
      name: "Acme Roofing Co",
      rating: "4.2",
      reviewCount: tp.reviewCount,
      categories: tp.categories,
      email: "hi@acme.example",
      ...CRM,
    });
    // Empty columns were filled from Google.
    expect(after.website).toBe("https://www." + place.websiteUri!.split("www.")[1].split("/")[0]);
    expect(after.city).toBe("Dallas");
    expect(after.address1).toMatch(/Elm St$/);

    // The next sync of the same place is an update of that row, still under the match rules.
    const again = await upsertGooglePlace(db, rowOf({ ...place, rating: 1.0 }));
    expect(again.outcome).toBe("updated");
    expect(again.business).toMatchObject({ id: tp.id, source: "trustpilot", rating: "4.2", name: "Acme Roofing Co" });
    expect(await total()).toBe(1);
  });

  it("a place whose website domain equals a Trustpilot row's attaches to it", async () => {
    const { business: tp } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "acmeroof.com", rating: "4.8" }));
    const place = makeGooglePlace({ websiteUri: "http://www.AcmeRoof.com/home?utm_source=gmb" });
    const r = await upsertGooglePlace(db, rowOf(place));
    expect(r.outcome).toBe("matched");
    expect(r.business).toMatchObject({ id: tp.id, source: "trustpilot", rating: "4.8", googlePlaceId: place.id });
    // Phone was empty on the Trustpilot row and is filled now.
    expect(r.business.phoneDigits).toBe(rowOf(place).phoneDigits);
    expect(await total()).toBe(1);
  });

  it("matches Yelp rows too; phone wins over domain; ties go to the oldest row", async () => {
    const older = (await upsertBusinessByYelpId(db, makeBusinessRow({ phone: "+12145550777" }))).business;
    await new Promise((r) => setTimeout(r, 5));
    await upsertBusinessByYelpId(db, makeBusinessRow({ phone: "+12145550777" }));
    const { business: byDomain } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "phonewins.com" }));
    const place = makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0777", websiteUri: "https://phonewins.com" });
    const r = await upsertGooglePlace(db, rowOf(place));
    expect(r.outcome).toBe("matched");
    expect(r.business.id).toBe(older.id);
    expect((await getBusiness(db, byDomain.id))!.googlePlaceId).toBeNull();
  });

  it("a shared-host website (facebook.com) matches nothing", async () => {
    await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ trustpilotId: "fbpage", website: "https://www.facebook.com/acme" }));
    const place = makeGooglePlace({ websiteUri: "https://www.facebook.com/acme" });
    const r = await upsertGooglePlace(db, rowOf(place));
    expect(r.outcome).toBe("created");
    expect(await total()).toBe(2);
  });

  it("never matches a Google row or a row that already has a place id", async () => {
    const a = makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0888" });
    const b = makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0888" });
    expect((await upsertGooglePlace(db, rowOf(a))).outcome).toBe("created");
    expect((await upsertGooglePlace(db, rowOf(b))).outcome).toBe("created");
    const { business: tp } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ phoneDigits: "12145550999", phone: "+12145550999" }));
    expect((await upsertGooglePlace(db, rowOf(makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0999" })))).outcome).toBe("matched");
    // Second place with the same phone: the Trustpilot row is taken, so it is inserted.
    expect((await upsertGooglePlace(db, rowOf(makeGooglePlace({ internationalPhoneNumber: "+1 214-555-0999" })))).outcome).toBe("created");
    expect((await getBusiness(db, tp.id))!.source).toBe("trustpilot");
    expect(await total()).toBe(4);
  });
});

describe("usage", () => {
  it("reserveUsage counts atomically up to the cap, per provider and UTC month", async () => {
    const nov = new Date("2026-11-30T23:59:00Z");
    const dec = new Date("2026-12-01T00:01:00Z");
    expect(usagePeriod(nov)).toBe("2026-11");
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveUsage(db, "google_places", 5, nov)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await getUsage(db, "google_places", nov)).toBe(5);
    expect(await reserveUsage(db, "google_places", 5, nov)).toBe(false);
    expect(await getUsage(db, "google_places", nov)).toBe(5);
    expect(await reserveUsage(db, "google_places", 6, nov)).toBe(true);
    expect(await getUsage(db, "google_places", nov)).toBe(6);
    expect(await reserveUsage(db, "google_places", 5, dec)).toBe(true);
    expect(await getUsage(db, "google_places", dec)).toBe(1);
    expect(await getUsage(db, "google_geocoding", nov)).toBe(0);
    expect(await reserveUsage(db, "google_geocoding", 0, nov)).toBe(false);
    expect(await getUsage(db, "google_geocoding", nov)).toBe(0);
  });
});

describe("jobs and lease", () => {
  it("createGoogleJob stores the plan; listUnfinishedGoogleJobs is pending/running Google jobs oldest first", async () => {
    const preview = await planGoogleSearch({ nicheId: "roofing", area: "75201, 75202" });
    const a = await createGoogleJob(db, preview);
    expect(a).toMatchObject({
      source: "google",
      status: "pending",
      term: "Roofing",
      location: "2 zips, TX",
      categoryAliases: preview.plan.acceptTypes,
      queriesTotal: preview.queries,
      queriesDone: 0,
      plan: preview.plan,
    });
    const b = await createGoogleJob(db, preview);
    const c = await createGoogleJob(db, preview);
    await updateSearchJob(db, b.id, { status: "running" });
    await updateSearchJob(db, c.id, { status: "completed" });
    await createSearchJob(db, { location: "Houston, TX", categoryAliases: ["plumbing"] });
    expect((await listUnfinishedGoogleJobs(db)).map((j) => j.id)).toEqual([a.id, b.id]);
    expect((await listUnfinishedGoogleJobs(db, 1)).map((j) => j.id)).toEqual([a.id]);
  });

  it("one holder at a time; renew and release need the current token; an expired lease can be taken", async () => {
    const job = await createGoogleJob(db, await planGoogleSearch({ nicheId: "roofing", area: "75201" }));
    const t0 = new Date("2026-11-10T00:00:00Z");
    const token = await acquireJobLease(db, job.id, t0);
    expect(token).not.toBeNull();
    expect(await acquireJobLease(db, job.id, new Date(t0.getTime() + 60_000))).toBeNull();
    const renewed = await renewJobLease(db, job.id, token!, new Date(t0.getTime() + 60_000));
    expect(renewed).not.toBeNull();
    expect(await renewJobLease(db, job.id, token!, new Date(t0.getTime() + 61_000))).toBeNull(); // stale token
    // Expired (120 s after the renewal): another slice takes it; the old holder cannot release it.
    const other = await acquireJobLease(db, job.id, new Date(t0.getTime() + 60_000 + 120_000));
    expect(other).not.toBeNull();
    await releaseJobLease(db, job.id, renewed!);
    expect(await acquireJobLease(db, job.id, new Date(t0.getTime() + 200_000))).toBeNull();
    await releaseJobLease(db, job.id, other!);
    expect(await acquireJobLease(db, job.id, new Date(t0.getTime() + 200_000))).not.toBeNull();
  });

  it("addDailySnapshot stores at most one snapshot per 24 h", async () => {
    const { business } = await upsertGooglePlace(db, rowOf(makeGooglePlace()));
    const t = new Date("2026-11-01T00:00:00Z");
    expect(await addDailySnapshot(db, business.id, 10, t)).toBe(true);
    expect(await addDailySnapshot(db, business.id, 11, new Date(t.getTime() + 23 * 3_600_000))).toBe(false);
    expect(await addDailySnapshot(db, business.id, 12, new Date(t.getTime() + 25 * 3_600_000))).toBe(true);
  });
});
