// AC-12.3: a fresh database applies 0000_init and 0001_v2; the v2 columns and tables exist.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { MIGRATIONS_FOLDER } from "@/db/migrate";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { rowsOf } from "@/features/ingest/context";
import { makeBusinessRow } from "./helpers/builders";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

type Col = { column_name: string; is_nullable: "YES" | "NO"; column_default: string | null; data_type: string };
async function columns(table: string): Promise<Map<string, Col>> {
  const rows = await q<Col>(
    sql`SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`,
  );
  return new Map(rows.map((r) => [r.column_name, r]));
}

describe("migrations", () => {
  it("ships exactly 0000_init through 0005_google_places, and all are applied", async () => {
    const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toEqual([
      "0000_init.sql",
      "0001_v2.sql",
      "0002_scrape_backoff.sql",
      "0003_ai_calls.sql",
      "0004_campaign_agent.sql",
      "0005_google_places.sql",
    ]);
    const applied = await q<{ n: number | string }>(sql`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`);
    expect(Number(applied[0].n)).toBe(6);
  });

  it("0003_ai_calls is additive: two enums, the ai_calls table, and call_campaigns.mode defaulting to human", async () => {
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, "0003_ai_calls.sql"), "utf8");
    expect(text).not.toMatch(/DROP |RENAME |ALTER COLUMN/i);
    const mode = (await columns("call_campaigns")).get("mode");
    expect(mode?.is_nullable).toBe("NO");
    expect(mode?.column_default).toMatch(/'human'/);
    const ai = await columns("ai_calls");
    for (const c of ["campaign_id", "queue_item_id", "business_id", "conversation_id", "outcome", "transcript", "analysis"]) {
      expect(ai.has(c), c).toBe(true);
    }
  });

  it("0002_scrape_backoff only adds the two back-off columns", async () => {
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, "0002_scrape_backoff.sql"), "utf8");
    const statements = text.split("--> statement-breakpoint").map((x) => x.trim()).filter(Boolean);
    expect(statements).toEqual([
      `ALTER TABLE "businesses" ADD COLUMN "scrape_failed_at" timestamp with time zone;`,
      `ALTER TABLE "businesses" ADD COLUMN "scrape_attempts" integer DEFAULT 0 NOT NULL;`,
    ]);
    const cols = await columns("businesses");
    expect(cols.get("scrape_failed_at")?.is_nullable).toBe("YES");
    expect(cols.get("scrape_failed_at")?.data_type).toBe("timestamp with time zone");
    expect(cols.get("scrape_attempts")?.is_nullable).toBe("NO");
    expect(cols.get("scrape_attempts")?.column_default).toBe("0");
  });

  it("0001_v2 relaxes yelp_id in place (no table rebuild)", () => {
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, "0001_v2.sql"), "utf8");
    expect(text).toContain(`ALTER TABLE "businesses" ALTER COLUMN "yelp_id" DROP NOT NULL`);
    expect(text).not.toMatch(/DROP TABLE|CREATE TABLE "businesses"|RENAME TO/i);
  });

  it("businesses: source defaults to yelp, yelp_id is nullable, the v2 columns exist", async () => {
    const cols = await columns("businesses");
    expect(cols.get("source")?.is_nullable).toBe("NO");
    expect(cols.get("source")?.column_default).toMatch(/'yelp'/);
    expect(cols.get("yelp_id")?.is_nullable).toBe("YES");
    for (const c of [
      "trustpilot_id",
      "slug",
      "email",
      "logo_url",
      "social_links",
      "reviews_last_30d",
      "trust_score",
      "ai_summary",
      "has_meta_ads",
      "subcategory",
      "last_scraped_at",
    ]) {
      expect(cols.has(c), c).toBe(true);
    }
    expect(cols.get("reviews_last_30d")?.column_default).toBe("0");
    expect(cols.get("social_links")?.is_nullable).toBe("NO");
  });

  it("the three new tables exist with their key columns", async () => {
    const relations = await columns("business_relations");
    expect([...relations.keys()].sort()).toEqual(
      ["created_at", "id", "relation_type", "source_business_id", "target_business_id"].sort(),
    );
    const snapshots = await columns("review_snapshots");
    expect([...snapshots.keys()].sort()).toEqual(["business_id", "captured_at", "id", "total_reviews"].sort());
    const leads = await columns("leads");
    expect([...leads.keys()].sort()).toEqual(
      ["business_id", "created_at", "id", "notes", "status", "updated_at", "user_id"].sort(),
    );
    expect(leads.get("user_id")?.data_type).toBe("uuid");
    // No FK from leads.user_id (auth schema lives in Supabase).
    const fks = await q<{ column_name: string }>(sql`
      SELECT kcu.column_name FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'leads' AND tc.constraint_type = 'FOREIGN KEY'`);
    expect(fks.map((f) => f.column_name)).toEqual(["business_id"]);
  });

  it("inserting a Trustpilot row without a yelpId succeeds; a Yelp row defaults to source yelp", async () => {
    const [tp] = await db
      .insert(businesses)
      .values({ name: "Acme", nameNormalized: "acme", categories: [], raw: {}, source: "trustpilot", trustpilotId: "acme.com" })
      .returning();
    expect(tp.yelpId).toBeNull();
    expect(tp.source).toBe("trustpilot");
    expect(tp.socialLinks).toEqual({});
    expect(tp.reviewsLast30d).toBe(0);
    expect(tp.hasMetaAds).toBe(false);

    // Omit `source` so the column default applies.
    const yelpRow = makeBusinessRow();
    delete yelpRow.source;
    const [y] = await db.insert(businesses).values(yelpRow).returning();
    expect(y.source).toBe("yelp");
    expect(y.trustpilotId).toBeNull();

    // trustpilot_id is unique.
    await expect(
      db.insert(businesses).values({ name: "Dup", nameNormalized: "dup", categories: [], raw: {}, source: "trustpilot", trustpilotId: "acme.com" }),
    ).rejects.toThrow();
  });
});
