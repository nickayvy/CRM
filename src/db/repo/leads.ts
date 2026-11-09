// Per-user leads: a user's shortlist of businesses with a pipeline status.
// Every read and write is scoped by userId (the Supabase auth user id).
// See docs/team/v2/architecture.md §Repos.
import { type SQL, and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Schema } from "../client";
import {
  type Business,
  type CallOutcome,
  type Lead,
  type LeadStatus,
  businesses,
  leadStatusEnum,
  leads,
} from "../schema";

/** A Db or an open transaction on one. */
type DbOrTx = PgDatabase<PgQueryResultHKT, Schema>;

export type LeadWithBusiness = Lead & { business: Business };
export type LeadFilter = { status?: LeadStatus[]; q?: string; category?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string | null | undefined): s is string => typeof s === "string" && UUID_RE.test(s);

/** Dialer outcome → lead status (architecture §Repos). */
export const OUTCOME_TO_LEAD_STATUS: Record<CallOutcome, LeadStatus> = {
  interested: "success",
  not_interested: "failed",
  wrong_number: "failed",
  callback: "callback",
  no_answer: "contacted",
  voicemail: "contacted",
  busy: "contacted",
  do_not_call: "skipped",
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function leadWhere(userId: string, f: LeadFilter = {}): SQL {
  const c: (SQL | undefined)[] = [eq(leads.userId, userId)];
  if (f.status?.length) c.push(inArray(leads.status, f.status));
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    c.push(or(ilike(businesses.name, like), ilike(businesses.slug, like), ilike(businesses.website, like)));
  }
  const category = f.category?.trim();
  if (category) {
    c.push(
      or(
        eq(businesses.primaryCategory, category),
        sql`${businesses.categories} @> ${JSON.stringify([{ alias: category }])}::jsonb`,
      ),
    );
  }
  return and(...c.filter((x): x is SQL => x !== undefined))!;
}

async function selectLeads(db: DbOrTx, where: SQL): Promise<LeadWithBusiness[]> {
  const rows = await db
    .select({ lead: leads, business: businesses })
    .from(leads)
    .innerJoin(businesses, eq(businesses.id, leads.businessId))
    .where(where)
    .orderBy(desc(leads.createdAt), desc(leads.id));
  return rows.map((r) => ({ ...r.lead, business: r.business }));
}

/** The user's leads with their businesses, newest first. */
export async function listLeads(db: DbOrTx, userId: string, f?: LeadFilter): Promise<LeadWithBusiness[]> {
  if (!isUuid(userId)) return [];
  return selectLeads(db, leadWhere(userId, f));
}

export async function getLead(db: DbOrTx, userId: string, id: string): Promise<LeadWithBusiness | null> {
  if (!isUuid(userId) || !isUuid(id)) return null;
  const [row] = await selectLeads(db, and(eq(leads.userId, userId), eq(leads.id, id))!);
  return row ?? null;
}

/** Idempotent per (user, business): returns the existing lead with `created: false` on repeat. */
export async function addLead(
  db: DbOrTx,
  userId: string,
  businessId: string,
): Promise<{ lead: Lead; created: boolean }> {
  if (!isUuid(userId)) throw new Error("addLead: userId must be a uuid");
  if (!isUuid(businessId)) throw new Error("addLead: businessId must be a uuid");
  const [inserted] = await db.insert(leads).values({ userId, businessId }).onConflictDoNothing().returning();
  if (inserted) return { lead: inserted, created: true };
  const [existing] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.userId, userId), eq(leads.businessId, businessId)));
  return { lead: existing, created: false };
}

/** Adds every known business id once; unknown or malformed ids are ignored (counted in neither total). */
export async function addLeads(
  db: DbOrTx,
  userId: string,
  businessIds: string[],
): Promise<{ added: number; existing: number }> {
  if (!isUuid(userId)) throw new Error("addLeads: userId must be a uuid");
  const ids = [...new Set(businessIds.filter(isUuid))];
  if (ids.length === 0) return { added: 0, existing: 0 };
  const known = await db.select({ id: businesses.id }).from(businesses).where(inArray(businesses.id, ids));
  if (known.length === 0) return { added: 0, existing: 0 };
  const inserted = await db
    .insert(leads)
    .values(known.map((b) => ({ userId, businessId: b.id })))
    .onConflictDoNothing()
    .returning({ id: leads.id });
  return { added: inserted.length, existing: known.length - inserted.length };
}

/** Updates the user's own lead; another user's (or a missing) lead returns null. */
export async function updateLead(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: { status?: LeadStatus; notes?: string | null },
): Promise<Lead | null> {
  if (!isUuid(userId) || !isUuid(id)) return null;
  const set: Partial<Lead> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.notes !== undefined) set.notes = patch.notes;
  const [row] = await db
    .update(leads)
    .set(set)
    .where(and(eq(leads.id, id), eq(leads.userId, userId)))
    .returning();
  return row ?? null;
}

export async function removeLead(db: DbOrTx, userId: string, id: string): Promise<boolean> {
  if (!isUuid(userId) || !isUuid(id)) return false;
  const rows = await db
    .delete(leads)
    .where(and(eq(leads.id, id), eq(leads.userId, userId)))
    .returning({ id: leads.id });
  return rows.length > 0;
}

/** Every lead status with the user's count (zeros included). */
export async function countLeadsByStatus(db: DbOrTx, userId: string): Promise<Record<LeadStatus, number>> {
  const out = Object.fromEntries(leadStatusEnum.enumValues.map((s) => [s, 0])) as Record<LeadStatus, number>;
  if (!isUuid(userId)) return out;
  const rows = await db
    .select({ k: leads.status, n: count() })
    .from(leads)
    .where(eq(leads.userId, userId))
    .groupBy(leads.status);
  for (const r of rows) out[r.k] = Number(r.n);
  return out;
}

export async function leadBusinessIds(db: DbOrTx, userId: string): Promise<string[]> {
  if (!isUuid(userId)) return [];
  const rows = await db.select({ id: leads.businessId }).from(leads).where(eq(leads.userId, userId));
  return rows.map((r) => r.id);
}

/**
 * Applies a dialer outcome to every user's lead on this business (see
 * `OUTCOME_TO_LEAD_STATUS`). Returns the number of leads updated; 0 (and no
 * write) when nobody has the business as a lead.
 */
export async function syncLeadStatusFromOutcome(db: DbOrTx, businessId: string, outcome: CallOutcome): Promise<number> {
  if (!isUuid(businessId)) return 0;
  const status = OUTCOME_TO_LEAD_STATUS[outcome];
  const rows = await db
    .update(leads)
    .set({ status, updatedAt: new Date() })
    .where(eq(leads.businessId, businessId))
    .returning({ id: leads.id });
  return rows.length;
}
