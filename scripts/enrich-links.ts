// External-links backfill: drains rows pending link enrichment (website,
// social profiles, email, phone from each business's own site) against the DB
// the env points to. Requires FIRECRAWL_API_KEY. ~1–2 Firecrawl credits per row.
//   npm run enrich:links -- [--limit 200] [--budget-seconds 1800]
import { parseArgs } from "node:util";
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { countPendingLinks } from "@/db/repo/discovery";
import { env } from "@/lib/env";
import { createFirecrawl } from "@/lib/firecrawl/client";
import { enrichPendingLinks } from "@/lib/firecrawl/enrich";

const USAGE = "Usage: npm run enrich:links -- [--limit 200] [--budget-seconds 1800]";
/** Rows per enrichPendingLinks call, so progress prints as the drain goes. */
const BATCH = 20;

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
      limit: { type: "string", short: "l" },
      "budget-seconds": { type: "string", short: "b" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const limit = intArg(values.limit, "limit", 1, 100_000, 200);
  const budgetSeconds = intArg(values["budget-seconds"], "budget-seconds", 1, 86_400, 86_400);

  if (!env.FIRECRAWL_API_KEY) {
    console.error("Discovery is not configured: set FIRECRAWL_API_KEY");
    process.exit(2);
  }
  const db = getDb();
  await runMigrations(db);
  const fc = createFirecrawl(env.FIRECRAWL_API_KEY);
  const target = env.DATABASE_URL ? "Postgres (DATABASE_URL)" : `PGlite at ${env.PGLITE_DATA_DIR}`;
  console.log(`Database: ${target}`);
  console.log(`Pending: ${await countPendingLinks(db)} · limit ${limit} · budget ${budgetSeconds}s`);

  const started = Date.now();
  const budgetMs = budgetSeconds * 1000;
  const totals = { enriched: 0, empty: 0, failed: 0, remaining: 0 };
  for (;;) {
    const attempted = totals.enriched + totals.empty + totals.failed;
    const left = budgetMs - (Date.now() - started);
    if (attempted >= limit || left <= 0) break;
    const r = await enrichPendingLinks(db, fc, { limit: Math.min(BATCH, limit - attempted), budgetMs: left });
    totals.enriched += r.enriched;
    totals.empty += r.empty;
    totals.failed += r.failed;
    totals.remaining = r.remaining;
    console.log(`  +${r.enriched} enriched · +${r.empty} empty · +${r.failed} failed · ${r.remaining} pending`);
    if (r.enriched + r.empty + r.failed === 0 || r.remaining === 0) break;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `Done in ${secs}s: enriched ${totals.enriched} · empty ${totals.empty} · failed ${totals.failed} · still pending ${totals.remaining}`,
  );
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
