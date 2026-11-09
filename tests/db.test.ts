import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { seed } from "@/db/seed";
import {
  activities,
  businesses,
  callCampaigns,
  emailEnrollments,
  leads,
  qualificationRules,
  searchJobs,
} from "@/db/schema";
import { createTestDb } from "@/db/test-utils";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function rowCount(table: PgTable): Promise<number> {
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row.n);
}

describe("createTestDb + seed", () => {
  it("starts migrated and empty", async () => {
    expect(await rowCount(businesses)).toBe(0);
    expect(await rowCount(qualificationRules)).toBe(0);
  });

  it("seed ensures only the qualification rules row", async () => {
    expect(await seed(db)).toEqual({ qualification_rules: 1 });
  });

  it("ships no demo data", async () => {
    expect(await rowCount(qualificationRules)).toBe(1);
    const empty = {
      businesses,
      call_campaigns: callCampaigns,
      activities,
      email_enrollments: emailEnrollments,
      leads,
      search_jobs: searchJobs,
    };
    for (const [name, table] of Object.entries(empty)) expect(await rowCount(table), name).toBe(0);
  });

  it("is idempotent", async () => {
    expect(await seed(db)).toEqual({ qualification_rules: 1 });
    expect(await seed(db)).toEqual({ qualification_rules: 1 });
    expect(await rowCount(qualificationRules)).toBe(1);
  });
});
