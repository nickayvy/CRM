// AC-18.2 (not configured → no client, no request) and AC-18.14 (dry run), plus the CLI modes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { count, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { GOOGLE_PLACES_PROVIDER, getUsage } from "@/db/repo/google";
import { businesses } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { GOOGLE_NOT_CONFIGURED } from "@/lib/google-places/client";
import { type CliDeps, parseGoogleArgs, runGoogleCli } from "../scripts/google-search";
import { createFakePlaces, makeGooglePlace } from "./helpers/fake-places";

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

const fetchSpy = vi.fn(async () => new Response("{}"));
beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function deps(over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const createClient = vi.fn(() => createFakePlaces({ results: () => [makeGooglePlace()] }));
  const getDb = vi.fn(async () => db);
  const d: CliDeps = {
    apiKey: "test-key",
    geocodingKey: undefined,
    cap: 1000,
    createClient,
    getDb,
    log: (l) => out.push(l),
    error: (l) => err.push(l),
    ...over,
  };
  return { d, out, err, createClient: (over.createClient ?? createClient) as ReturnType<typeof vi.fn>, getDb };
}

describe("google:search CLI", () => {
  it("--dry-run prints terms, zips, searches, max requests and cost, exits 0, and makes no request (even with no key)", async () => {
    const { d, out, createClient, getDb } = deps({ apiKey: undefined });
    const code = await runGoogleCli(["--niche", "roofing", "--area", "75201,75202", "--dry-run"], d);
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Terms (3): roofer, roofing contractor, roofing company");
    expect(text).toContain("75201, 75202");
    expect(text).toContain("Searches: 3 terms × 2 zips = 6");
    expect(text).toContain("Max requests: 18");
    expect(text).toContain("Estimated max cost: $0.63");
    expect(createClient).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without a key a real run prints the not-configured message, exits non-zero, never builds a client and sends nothing", async () => {
    const { d, err, createClient, getDb } = deps({ apiKey: undefined });
    for (const argv of [
      ["--niche", "roofing", "--area", "75201,75202"],
      ["--probe", "roofer 75201"],
      ["--resume", "00000000-0000-4000-8000-000000000001"],
    ]) {
      expect(await runGoogleCli(argv, d)).toBe(2);
    }
    expect(err).toEqual([GOOGLE_NOT_CONFIGURED, GOOGLE_NOT_CONFIGURED, GOOGLE_NOT_CONFIGURED]);
    expect(createClient).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(0);
  });

  it("a run loops slices to completion and prints one line per search", async () => {
    const { d, out } = deps();
    const code = await runGoogleCli(["--terms", "roofer,gutters", "--area", "75201 75202", "--max-pages", "1"], d);
    expect(code).toBe(0);
    const lines = out.filter((l) => /^\s+\[\d\/4\]/.test(l));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/\[1\/4\] "roofer" in 75201: 1 request, 1 new place/);
    expect(out.join("\n")).toMatch(/Job [0-9a-f-]+ completed/);
    expect(Number((await db.select({ n: count() }).from(businesses))[0].n)).toBe(4);
    expect(await getUsage(db, GOOGLE_PLACES_PROVIDER)).toBe(4);
  });

  it("a capped run pauses with exit 3; --resume continues it", async () => {
    const first = deps({ cap: 1 });
    expect(await runGoogleCli(["--terms", "roofer", "--area", "75201,75202", "--max-pages", "1"], first.d)).toBe(3);
    const text = first.out.join("\n");
    expect(text).toMatch(/paused \(capped\)/);
    const jobId = /Job ([0-9a-f-]{36}) created/.exec(text)![1];
    const second = deps({ cap: 10 });
    expect(await runGoogleCli(["--resume", jobId], second.d)).toBe(0);
    expect(second.out.join("\n")).toMatch(/completed/);
  });

  it("--probe sends one request, prints mapped rows and writes nothing", async () => {
    const fake = createFakePlaces({ results: { "roofer 75201": [makeGooglePlace({ displayName: { text: "ACE ROOFING DALLAS TX - Free Estimates" } })] } });
    const { d, out, getDb } = deps({ createClient: vi.fn(() => fake) });
    expect(await runGoogleCli(["--probe", "roofer 75201"], d)).toBe(0);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ textQuery: "roofer 75201", regionCode: "US" });
    const text = out.join("\n");
    expect(text).toContain("- Ace Roofing  (raw: ACE ROOFING DALLAS TX - Free Estimates)");
    expect(text).toMatch(/phone \+1 214-555-\d{4} · website https:\/\/www\.fakeroofing\d+\.com/);
    expect(text).toContain("types roofing_contractor | roofing_contractor, general_contractor");
    expect(getDb).not.toHaveBeenCalled();
    expect(Number((await db.select({ n: count() }).from(businesses))[0].n)).toBe(0);
  });

  it("parses arguments and rejects bad ones", () => {
    expect(parseGoogleArgs(["--niche", "roofing", "--area", "Dallas, TX", "--terms", "a, b", "--max-pages", "2"])).toEqual({
      mode: "search",
      dryRun: false,
      input: { nicheId: "roofing", terms: ["a", "b"], area: "Dallas, TX", maxPagesPerQuery: 2 },
    });
    expect(parseGoogleArgs(["--probe", "roofer 75201"])).toEqual({ mode: "probe", query: "roofer 75201" });
    expect(parseGoogleArgs(["--resume", "abc"])).toEqual({ mode: "resume", jobId: "abc" });
    expect(parseGoogleArgs(["--help"])).toEqual({ mode: "help" });
    expect(() => parseGoogleArgs(["--niche", "roofing"])).toThrow(/--area is required/);
    expect(() => parseGoogleArgs(["--area", "75201"])).toThrow(/--niche or --terms/);
    expect(() => parseGoogleArgs(["--niche", "roofing", "--area", "75201", "--max-pages", "4"])).toThrow(/--max-pages/);
    expect(() => parseGoogleArgs(["--probe", "x", "--resume", "y"])).toThrow(/one of/);
    expect(() => parseGoogleArgs(["--bogus"])).toThrow();
  });

  it("a slice budget too small for any search stops instead of looping", async () => {
    const { d, err } = deps({ sliceBudgetMs: 1 });
    expect(await runGoogleCli(["--terms", "roofer", "--area", "75201", "--max-pages", "1"], d)).toBe(3);
    expect(err.join("\n")).toMatch(/No progress/);
  });

  it("a plan over the limits exits 2 with the reason", async () => {
    const { d, err } = deps();
    expect(await runGoogleCli(["--terms", "a", "--area", "75201 +60mi", "--dry-run"], d)).toBe(2);
    expect(err.join("\n")).toMatch(/over the limit of 200/);
  });
});
