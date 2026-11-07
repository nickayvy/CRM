import { closeDb, getDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { env } from "@/lib/env";

async function main() {
  const target = env.DATABASE_URL ? "Postgres (DATABASE_URL)" : `PGlite at ${env.PGLITE_DATA_DIR}`;
  console.log(`Applying migrations to ${target}…`);
  await runMigrations(getDb());
  console.log("Migrations applied.");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
