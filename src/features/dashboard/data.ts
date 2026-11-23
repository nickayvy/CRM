// Overview tiles added in v2 (WP-16), next to the v1 DashboardStats. Every
// count is recomputed with hand-written SQL in tests/dashboard.test.ts.
import { and, count, eq, notExists } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  type BusinessSource,
  type LeadStatus,
  businessSourceEnum,
  businesses,
  callQueueItems,
  emailEnrollments,
  leadStatusEnum,
  leads,
} from "@/db/schema";

export type OverviewTiles = {
  /** Leads per status across every user (zeros included, pipeline order). */
  leadsByStatus: { status: LeadStatus; count: number }[];
  leadsTotal: number;
  /** Businesses per discovery source (zeros included, Trustpilot first). */
  businessesBySource: { source: BusinessSource; count: number }[];
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  queued: "Queued",
  contacted: "Contacted",
  callback: "Callback",
  success: "Success",
  failed: "Failed",
  skipped: "Skipped",
};

export const SOURCE_LABELS: Record<BusinessSource, string> = {
  trustpilot: "Trustpilot",
  yelp: "Yelp",
  google: "Google",
};

const SOURCE_ORDER: BusinessSource[] = ["trustpilot", "yelp"];

/** Businesses per source, every source listed (Trustpilot first). Also feeds the /businesses Source filter counts. */
export async function countBusinessesBySource(db: Db): Promise<{ source: BusinessSource; count: number }[]> {
  const rows = await db.select({ source: businesses.source, n: count() }).from(businesses).groupBy(businesses.source);
  const b = new Map(rows.map((r) => [r.source, Number(r.n)]));
  const sources = [...SOURCE_ORDER, ...businessSourceEnum.enumValues.filter((x) => !SOURCE_ORDER.includes(x))];
  return sources.map((source) => ({ source, count: b.get(source) ?? 0 }));
}

export async function getOverviewTiles(db: Db): Promise<OverviewTiles> {
  const [byStatus, businessesBySource] = await Promise.all([
    db.select({ status: leads.status, n: count() }).from(leads).groupBy(leads.status),
    countBusinessesBySource(db),
  ]);
  const s = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const leadsByStatus = leadStatusEnum.enumValues.map((status) => ({ status, count: s.get(status) ?? 0 }));
  return { leadsByStatus, leadsTotal: leadsByStatus.reduce((n, r) => n + r.count, 0), businessesBySource };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The user's queued leads whose business is in no call queue and no email
 * sequence: the ones nothing is set up to reach. A queued lead that already
 * sits in a campaign is waiting its turn, not waiting on the user.
 */
export async function countUnassignedLeads(db: Db, userId: string): Promise<number> {
  if (!UUID_RE.test(userId)) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(leads)
    .where(
      and(
        eq(leads.userId, userId),
        eq(leads.status, "queued"),
        notExists(db.select({ id: callQueueItems.id }).from(callQueueItems).where(eq(callQueueItems.businessId, leads.businessId))),
        notExists(db.select({ id: emailEnrollments.id }).from(emailEnrollments).where(eq(emailEnrollments.businessId, leads.businessId))),
      ),
    );
  return Number(row?.n ?? 0);
}
