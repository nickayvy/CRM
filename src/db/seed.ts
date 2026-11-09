import { count } from "drizzle-orm";
import type { Db } from "./client";
import { getRules } from "./repo/rules";
import { qualificationRules } from "./schema";

export type SeedSummary = Record<string, number>;

/**
 * Idempotent seed: ensures the singleton qualification-rules row exists and
 * nothing else. The app ships with no demo data; every business, campaign,
 * activity and lead comes from real use. Returns `{ qualification_rules: 1 }`.
 */
export async function seed(db: Db): Promise<SeedSummary> {
  await getRules(db);
  const [row] = await db.select({ n: count() }).from(qualificationRules);
  return { qualification_rules: Number(row.n) };
}
