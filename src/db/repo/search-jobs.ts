import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type SearchJob, searchJobs } from "../schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createSearchJob(
  db: Db,
  input: { term?: string; location: string; categoryAliases: string[]; radiusM?: number; maxResults?: number },
): Promise<SearchJob> {
  const [row] = await db
    .insert(searchJobs)
    .values({
      term: input.term?.trim() || null,
      location: input.location.trim(),
      categoryAliases: input.categoryAliases.map((a) => a.trim()).filter(Boolean),
      ...(input.radiusM !== undefined ? { radiusM: input.radiusM } : {}),
      ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
    })
    .returning();
  return row;
}

export async function getSearchJob(db: Db, id: string): Promise<SearchJob | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(searchJobs).where(eq(searchJobs.id, id));
  return row ?? null;
}

/** Newest first. */
export async function listSearchJobs(db: Db, limit = 50): Promise<SearchJob[]> {
  return db.select().from(searchJobs).orderBy(desc(searchJobs.createdAt), desc(searchJobs.id)).limit(limit);
}

export async function updateSearchJob(db: Db, id: string, patch: Partial<SearchJob>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, createdAt: _c, ...rest } = patch;
  if (Object.keys(rest).length === 0) return;
  await db.update(searchJobs).set(rest).where(eq(searchJobs.id, id));
}
