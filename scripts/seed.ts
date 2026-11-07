import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";
import { env } from "@/lib/env";

async function main() {
  const target = env.DATABASE_URL ? "Postgres (DATABASE_URL)" : `PGlite at ${env.PGLITE_DATA_DIR}`;
  const db = getDb();
  // Seeding needs the schema; applying migrations is a no-op when up to date.
  await runMigrations(db);
  console.log(`Seeding ${target}…`);
  const summary = await seed(db);
  const width = Math.max(...Object.keys(summary).map((k) => k.length));
  console.log("Seed summary:");
  for (const [table, n] of Object.entries(summary)) console.log(`  ${table.padEnd(width)}  ${n}`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
