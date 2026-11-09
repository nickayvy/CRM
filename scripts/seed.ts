// Ensures the qualification-rules row exists. No demo data is seeded.
import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seed } from "@/db/seed";

async function main() {
  const db = getDb();
  // Seeding needs the schema; applying migrations is a no-op when up to date.
  await runMigrations(db);
  const summary = await seed(db);
  for (const [table, n] of Object.entries(summary)) console.log(`${table} ${n}`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
