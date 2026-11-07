// Ingestion CLI: search job → Yelp (or fixtures) → upsert → qualify.
//   npm run ingest -- --location "Houston, TX" --categories plumbing --radius 20000 --max 200 [--term plumber]
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { countByQualification, countByReason } from "@/db/repo/businesses";
import { createSearchJob } from "@/db/repo/search-jobs";
import { runSearchJob } from "@/features/ingest/run";
import { env } from "@/lib/env";
import { createYelpClient } from "@/lib/yelp";

const USAGE =
  'Usage: npm run ingest -- --location "Houston, TX" --categories plumbing[,alias2] [--radius 20000] [--max 200] [--term plumber]';

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

function intArg(v: string | undefined, name: string, min: number, max: number, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(`--${name} must be an integer between ${min} and ${max}`);
  return n;
}

async function main() {
  const { values } = parseArgs({
    options: {
      location: { type: "string", short: "l" },
      categories: { type: "string", short: "c" },
      radius: { type: "string", short: "r" },
      max: { type: "string", short: "m" },
      term: { type: "string", short: "t" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const location = values.location?.trim();
  if (!location) fail("--location is required");
  const categoryAliases = (values.categories ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (categoryAliases.length === 0) fail("--categories is required");
  const radiusM = intArg(values.radius, "radius", 500, 40000, 20000);
  const maxResults = intArg(values.max, "max", 1, 1000, 200);

  const db = getDb();
  await runMigrations(db);
  const client = createYelpClient();
  const target = env.DATABASE_URL ? "Postgres (DATABASE_URL)" : `PGlite at ${env.PGLITE_DATA_DIR}`;
  console.log(`Yelp mode: ${client.mode} · database: ${target}`);
  console.log(
    `Searching ${categoryAliases.join(",")} in "${location}" (radius ${radiusM} m, max ${maxResults}${values.term ? `, term "${values.term}"` : ""})…`,
  );

  const job = await createSearchJob(db, { term: values.term, location, categoryAliases, radiusM, maxResults });
  const started = Date.now();
  const result = await runSearchJob(db, job.id, client, {
    onProgress: (j) => {
      if (j.status === "running")
        console.log(
          `  fetched ${j.fetchedCount} · qualified ${j.qualifiedCount} · review ${j.reviewCount} · rejected ${j.rejectedCount} · api calls ${j.apiCalls}`,
        );
    },
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Job ${result.id} ${result.status} in ${secs}s`);
  if (result.error) console.log(`  error: ${result.error}`);
  console.log(
    `  fetched ${result.fetchedCount} · qualified ${result.qualifiedCount} · review ${result.reviewCount} · rejected ${result.rejectedCount} · api calls ${result.apiCalls}`,
  );
  const reasons = await countByReason(db);
  const all = await countByQualification(db);
  const jobCounts = await countByQualification(db, { sourceJobId: result.id });
  console.log(`  this job's businesses now: qualified ${jobCounts.qualified} · review ${jobCounts.review} · rejected ${jobCounts.rejected}`);
  console.log(`Database totals: qualified ${all.qualified} · review ${all.review} · rejected ${all.rejected}`);
  if (reasons.length) console.log(`Reasons (all businesses): ${reasons.map((r) => `${r.reason} ${r.count}`).join(", ")}`);
  if (result.status === "failed") process.exitCode = 1;
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
