// AC-18.1: 0005_google_places applies on top of 0000–0004 with existing rows
// present, and those rows read back unchanged.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Db, createPgliteDb } from "@/db/client";
import { MIGRATIONS_FOLDER } from "@/db/migrate";
import { rowsOf } from "@/features/ingest/context";

let db: Db;
let close: () => Promise<void>;
let oldFolder: string;

const asPglite = (d: Db) => d as unknown as PgliteDatabase<Record<string, unknown>>;

async function q<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  return rowsOf<T>(await db.execute(query));
}

beforeAll(async () => {
  // A copy of the migrations folder whose journal stops at 0004.
  oldFolder = mkdtempSync(path.join(tmpdir(), "lar-mig-"));
  cpSync(MIGRATIONS_FOLDER, oldFolder, { recursive: true });
  const journalPath = path.join(oldFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.tag < "0005");
  writeFileSync(journalPath, JSON.stringify(journal));
  rmSync(path.join(oldFolder, "0005_google_places.sql"));

  ({ db, close } = createPgliteDb(new PGlite()));
  await migrate(asPglite(db), { migrationsFolder: oldFolder });
});

afterAll(async () => {
  await close();
  rmSync(oldFolder, { recursive: true, force: true });
});

describe("0005_google_places on a populated 0004 database", () => {
  it("is additive and keeps existing rows", async () => {
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, "0005_google_places.sql"), "utf8");
    expect(text).not.toMatch(/DROP |RENAME |ALTER COLUMN/i);
    // The new enum value is never used inside the migration that adds it.
    const statements = text.split("--> statement-breakpoint").map((s) => s.trim());
    expect(statements[0]).toBe(`ALTER TYPE "public"."business_source" ADD VALUE 'google';`);
    expect(statements.slice(1).join("\n")).not.toMatch(/'google'/);

    // Rows as they exist in production before 0005 (raw SQL: the 0004 schema).
    await db.execute(sql`INSERT INTO search_jobs (id, term, location, category_aliases)
      VALUES ('00000000-0000-4000-8000-000000000001', 'plumber', 'Houston, TX', ARRAY['plumbing'])`);
    await db.execute(sql`INSERT INTO businesses (id, yelp_id, name, name_normalized, website, categories, raw, source_job_id, rating, review_count)
      VALUES ('00000000-0000-4000-8000-0000000000a1', 'yelp-1', 'Yelp Plumbing', 'yelp plumbing', 'https://www.YelpPlumbing.com/about?x=1',
              '[{"alias":"plumbing","title":"Plumbing"}]'::jsonb, '{}'::jsonb, '00000000-0000-4000-8000-000000000001', 4.5, 25)`);
    await db.execute(sql`INSERT INTO businesses (id, source, trustpilot_id, name, name_normalized, website, email, categories, raw)
      VALUES ('00000000-0000-4000-8000-0000000000b1', 'trustpilot', 'acme.com', 'Acme', 'acme', 'acme.com', 'Info@Acme.com', '[]'::jsonb, '{}'::jsonb)`);
    const before = await q<Record<string, unknown>>(sql`SELECT * FROM businesses ORDER BY id`);
    const jobBefore = await q<Record<string, unknown>>(sql`SELECT * FROM search_jobs`);

    await migrate(asPglite(db), { migrationsFolder: MIGRATIONS_FOLDER });
    const applied = await q<{ n: number | string }>(sql`SELECT count(*) AS n FROM drizzle.__drizzle_migrations`);
    expect(Number(applied[0].n)).toBe(6);

    const after = await q<Record<string, unknown>>(sql`SELECT * FROM businesses ORDER BY id`);
    expect(after).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      for (const [k, v] of Object.entries(before[i])) expect(after[i][k], k).toEqual(v);
    }
    expect(after.map((r) => r.source)).toEqual(["yelp", "trustpilot"]);
    expect(after.map((r) => r.website_domain)).toEqual(["yelpplumbing.com", "acme.com"]);
    expect(after.map((r) => r.google_place_id)).toEqual([null, null]);

    const [job] = await q<Record<string, unknown>>(sql`SELECT * FROM search_jobs`);
    for (const [k, v] of Object.entries(jobBefore[0])) expect(job[k], k).toEqual(v);
    expect(job).toMatchObject({
      source: "yelp",
      plan: null,
      queries_total: 0,
      queries_done: 0,
      new_count: 0,
      matched_count: 0,
      lease_expires_at: null,
    });

    // The new enum value, table and indexes are usable after the migration.
    await db.execute(sql`INSERT INTO businesses (source, google_place_id, name, name_normalized, categories, raw)
      VALUES ('google', 'ChIJtest', 'G', 'g', '[]'::jsonb, '{}'::jsonb)`);
    await db.execute(sql`INSERT INTO api_usage (provider, period, requests) VALUES ('google_places', '2026-11', 1)`);
    const idx = await q<{ indexname: string }>(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'businesses'`);
    const names = idx.map((r) => r.indexname);
    expect(names).toEqual(
      expect.arrayContaining(["businesses_website_domain_idx", "businesses_email_lower_idx", "businesses_google_place_id_unique"]),
    );
    // google_place_id is unique.
    await expect(
      db.execute(sql`INSERT INTO businesses (source, google_place_id, name, name_normalized, categories, raw)
        VALUES ('google', 'ChIJtest', 'G2', 'g2', '[]'::jsonb, '{}'::jsonb)`),
    ).rejects.toThrow();
  });

  it("website_domain follows website on update and is null for non-hosts", async () => {
    const id = "00000000-0000-4000-8000-0000000000a1";
    const domainOf = async (website: string | null) => {
      await db.execute(sql`UPDATE businesses SET website = ${website} WHERE id = ${id}`);
      const [r] = await q<{ d: string | null }>(sql`SELECT website_domain AS d FROM businesses WHERE id = ${id}`);
      return r.d;
    };
    expect(await domainOf("http://shop.Example.co.uk:8080/x")).toBe("shop.example.co.uk");
    expect(await domainOf("  WWW.acme.com  ")).toBe("acme.com");
    expect(await domainOf("not a website")).toBeNull();
    expect(await domainOf("")).toBeNull();
    expect(await domainOf(null)).toBeNull();
  });
});
