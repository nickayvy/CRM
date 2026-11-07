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
  // prepare:false is required behind Supabase's transaction pooler.
  // Serverless hardening: a frozen function instance can thaw holding a socket the
  // pooler already closed, and a query on it hangs until the platform timeout.
  // Closing idle sockets quickly and bounding connect/lifetime avoids reusing dead
  // connections; a small pool keeps per-instance server connections low.
  const client = postgres(url, {
    prepare: false,
    max: 3,
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
