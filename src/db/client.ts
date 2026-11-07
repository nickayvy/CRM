import { mkdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * Driver-agnostic Drizzle instance. Both the PGlite and postgres-js drivers
 * produce a `PgDatabase` with this schema, so repositories accept either.
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema> & { $client: unknown };

export type DbDriver = "pglite" | "postgres";

type Handle = { db: Db; driver: DbDriver; close: () => Promise<void> };

const drivers = new WeakMap<object, DbDriver>();

/** Which driver backs a Db instance (used by the migrator). */
export function driverOf(db: Db): DbDriver {
  const d = drivers.get(db);
  if (d) return d;
  return db.$client instanceof PGlite ? "pglite" : "postgres";
}

/** Wrap an existing PGlite instance (in-memory for tests, or on disk). */
export function createPgliteDb(client: PGlite): Handle {
  const db = drizzlePglite({ client, schema }) as unknown as Db;
  drivers.set(db, "pglite");
  return { db, driver: "pglite", close: () => client.close() };
}

/** Connect to a real Postgres (Supabase) via postgres-js. */
export function createPostgresDb(url: string): Handle {
  // Supabase Transaction pooler (port 6543) notes, verified 2026-11-07:
  // - prepare:false — the pooler does not support named prepared statements.
  // - max_pipeline:1 — postgres-js pipelines queued queries onto busy connections by
  //   default; the transaction pooler never answers those, so any page issuing more
  //   concurrent queries than `max` hangs until the platform timeout. One in-flight
  //   query per connection fixes it.
  // - small pool + idle/lifetime/connect timeouts — serverless instances freeze and
  //   thaw; closing idle sockets avoids reusing ones the pooler already dropped.
  // The Session pooler (5432) also works but is capped at 15 clients per project,
  // which a few function instances exhaust.
  const client = postgres(url, {
    prepare: false,
    max: 3,
    max_pipeline: 1,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
  });
  const db = drizzlePostgres({ client, schema }) as unknown as Db;
  drivers.set(db, "postgres");
  return { db, driver: "postgres", close: () => client.end({ timeout: 5 }) };
}

/** Pick the driver from env: postgres-js when DATABASE_URL is set, else PGlite on disk. */
export function createDbFromEnv(): Handle {
  const url = env.DATABASE_URL;
  if (url) return createPostgresDb(url);
  const dir = env.PGLITE_DATA_DIR;
  mkdirSync(dir, { recursive: true });
  return createPgliteDb(new PGlite(dir));
}

declare global {
  var __db: Handle | undefined;
}

/** Process-wide Db, cached on globalThis so it survives Next.js HMR. */
export function getDb(): Db {
  if (!globalThis.__db) globalThis.__db = createDbFromEnv();
  return globalThis.__db.db;
}

export async function closeDb(): Promise<void> {
  const h = globalThis.__db;
  globalThis.__db = undefined;
  if (h) await h.close();
}
