// AC-12.6: source-aware qualification through the DB-backed context, and the
// v1 trap table on 40 built records.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { countByQualification, getBusiness, upsertBusinessByYelpId } from "@/db/repo/businesses";
import { upsertBusinessByTrustpilotId } from "@/db/repo/discovery";
import { getRules } from "@/db/repo/rules";
import { createTestDb } from "@/db/test-utils";
import { qualifyOne, requalifyAll } from "@/features/ingest/run";
import { qualify } from "@/lib/qualify";
import { normalizeYelpBusiness } from "@/lib/yelp";
import { buildContext } from "@/features/ingest/context";
import { makeTrustpilotRow } from "./helpers/builders";
import { HOUSTON_PLUMBERS } from "./helpers/trap-table";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE businesses, search_jobs, qualification_rules RESTART IDENTITY CASCADE`);
});

describe("Trustpilot rows", () => {
  it("are never category_mismatch or out_of_area, via qualifyOne and requalifyAll", async () => {
    const rows = [
      makeTrustpilotRow({ name: "Acme Travel", categories: [{ alias: "travel_vacation", title: "Travel" }], phone: "+1 512 555 0001", phoneDigits: "15125550001", reviewCount: 200, rating: "4.5" }),
      makeTrustpilotRow({ name: "No Category Co", categories: [], primaryCategory: null, phone: "+1 512 555 0002", phoneDigits: "15125550002", reviewCount: 50, rating: "4.0" }),
    ];
    for (const row of rows) {
      const { business } = await upsertBusinessByTrustpilotId(db, row);
      const ctx = await buildContext(db, business);
      expect(ctx.categoryAliases).toEqual([]);
      expect(ctx.locationState).toBeNull();
      const r = await qualifyOne(db, business);
      expect(r.reasons).not.toContain("category_mismatch");
      expect(r.reasons).not.toContain("out_of_area");
      expect(r.qualification).toBe("qualified");
      expect((await getBusiness(db, business.id))?.qualification).toBe("qualified");
    }
    expect(await requalifyAll(db)).toEqual({ qualified: 2, review: 0, rejected: 0 });
  });

  it("other rules still apply (no phone, low rating)", async () => {
    const { business } = await upsertBusinessByTrustpilotId(db, makeTrustpilotRow({ rating: "2.0", reviewCount: 40 }));
    const r = await qualifyOne(db, business);
    expect(r.reasons).toEqual(["no_phone", "low_rating"]);
  });

  it("a Trustpilot row sharing a Yelp row's phone is the later duplicate (no yelpId needed)", async () => {
    const yelp = normalizeYelpBusiness(HOUSTON_PLUMBERS[0], { searchCategory: "plumbing", searchLocation: "Houston, TX" });
    await upsertBusinessByYelpId(db, yelp);
    const { business } = await upsertBusinessByTrustpilotId(
      db,
      makeTrustpilotRow({ phone: yelp.phone, phoneDigits: yelp.phoneDigits, reviewCount: 40 }),
    );
    expect((await qualifyOne(db, business)).reasons).toContain("duplicate_phone");
  });
});

describe("v1 trap table on 40 built records", () => {
  it("yields 31 qualified / 9 rejected with the default rules", async () => {
    for (const y of HOUSTON_PLUMBERS) {
      const { business } = await upsertBusinessByYelpId(
        db,
        normalizeYelpBusiness(y, { searchCategory: "plumbing", searchLocation: "Houston, TX" }),
      );
      await qualifyOne(db, business);
    }
    expect(await countByQualification(db)).toEqual({ qualified: 31, review: 0, rejected: 9 });
    expect(await requalifyAll(db)).toEqual({ qualified: 31, review: 0, rejected: 9 });
  });

  it("the pure engine agrees record by record (Dusty Wrench scores 69)", async () => {
    const rules = await getRules(db);
    const dusty = HOUSTON_PLUMBERS.find((b) => b.name === "Dusty Wrench Plumbing")!;
    const row = normalizeYelpBusiness(dusty, { searchCategory: "plumbing", searchLocation: "Houston, TX" });
    const r = qualify(
      { ...row, isClaimed: null, distanceM: row.distanceM ?? null, rating: row.rating ?? null, reviewCount: row.reviewCount ?? 0, isClosed: false, phoneDigits: row.phoneDigits ?? null, primaryCategory: row.primaryCategory ?? null, state: row.state ?? null },
      { searchCategory: "plumbing", categoryAliases: ["plumbing"], radiusM: 20000, locationState: "TX", sameNameCityCount: 1, phoneDuplicate: false, websiteDuplicate: false, emailDuplicate: false },
      rules,
    );
    expect(r).toEqual({ qualification: "qualified", score: 69, reasons: [] });
  });
});
