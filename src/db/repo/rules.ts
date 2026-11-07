import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { type QualificationRules, qualificationRules } from "../schema";
import { DEFAULT_CHAIN_PATTERNS } from "./chain-patterns";

export { DEFAULT_CHAIN_PATTERNS };

const RULES_ID = 1;

/** Returns the single rules row (id = 1), creating it with defaults if missing. */
export async function getRules(db: Db): Promise<QualificationRules> {
  const [existing] = await db.select().from(qualificationRules).where(eq(qualificationRules.id, RULES_ID));
  if (existing) return existing;
  await db
    .insert(qualificationRules)
    .values({ id: RULES_ID, chainPatterns: DEFAULT_CHAIN_PATTERNS })
    .onConflictDoNothing({ target: qualificationRules.id });
  const [created] = await db.select().from(qualificationRules).where(eq(qualificationRules.id, RULES_ID));
  return created;
}

export async function updateRules(
  db: Db,
  patch: Partial<Omit<QualificationRules, "id" | "updatedAt">>,
): Promise<QualificationRules> {
  await getRules(db);
  const [row] = await db
    .update(qualificationRules)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(qualificationRules.id, RULES_ID))
    .returning();
  return row;
}
