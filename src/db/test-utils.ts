import { PGlite } from "@electric-sql/pglite";
import { createPgliteDb, type Db } from "./client";
import { runMigrations } from "./migrate";

/** In-memory PGlite with all migrations applied and no rows. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { db, close } = createPgliteDb(new PGlite());
  await runMigrations(db);
  return { db, close };
}
