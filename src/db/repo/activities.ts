import { desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { type Activity, type ActivityType, activities, businesses } from "../schema";

export type LogActivityInput = {
  businessId: string;
  type: ActivityType;
  body?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
  campaignType?: "call" | "email";
  campaignId?: string;
  agent?: string;
  occurredAt?: Date;
};

export async function logActivity(db: Db, input: LogActivityInput): Promise<Activity> {
  const [row] = await db
    .insert(activities)
    .values({
      businessId: input.businessId,
      type: input.type,
      body: input.body ?? "",
      outcome: input.outcome ?? null,
      metadata: input.metadata ?? {},
      campaignType: input.campaignType ?? null,
      campaignId: input.campaignId ?? null,
      agent: input.agent ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return row;
}

/** Newest first. */
export async function listActivities(db: Db, businessId: string, opts?: { limit?: number }): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(eq(activities.businessId, businessId))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(opts?.limit ?? 100);
}

/** Newest first, across all businesses, with the business name joined. */
export async function listRecentActivities(db: Db, limit: number): Promise<(Activity & { businessName: string })[]> {
  const rows = await db
    .select({ activity: activities, businessName: businesses.name })
    .from(activities)
    .innerJoin(businesses, eq(businesses.id, activities.businessId))
    .orderBy(desc(activities.occurredAt), desc(activities.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.activity, businessName: r.businessName }));
}
