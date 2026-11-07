import { and, asc, count, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { env } from "@/lib/env";
import type { EmailSender } from "@/lib/email/sender";
import { renderTemplate } from "@/lib/email/template";
import type { Db } from "../client";
import {
  type Business,
  type EmailCampaign,
  type EmailEnrollment,
  type EmailMessage,
  type EmailStep,
  type EnrollmentState,
  type MessageStatus,
  type NewEmailCampaign,
  type NewEmailStep,
  businesses,
  emailCampaigns,
  emailEnrollments,
  emailMessages,
  emailSteps,
} from "../schema";
import { logActivity } from "./activities";
import { updateBusinessCrm } from "./businesses";

const DAY_MS = 86_400_000;
/** While a send is in flight its enrollment's nextSendAt is pushed this far out, so a concurrent run skips it. */
const SEND_LEASE_MS = 10 * 60_000;
/** A failed send is retried this long after the failure. */
const RETRY_AFTER_MS = DAY_MS;

export type StepInput = Omit<NewEmailStep, "campaignId" | "id">;

export type EmailStats = {
  active: number;
  completed: number;
  replied: number;
  unsubscribed: number;
  sentToday: number;
  sentTotal: number;
};

/** EmailStats plus the remaining enrollment states, for the campaign page. */
export type EmailCampaignDetailStats = EmailStats & { paused: number; bounced: number; enrolled: number };

export type ProcessResult = { sent: number; skipped: number; failed: number };

const SENT_STATUSES: MessageStatus[] = ["sent", "dry_run"];
/** Statuses that consume the daily cap (a failed attempt still counts, so a broken provider is not hammered). */
const CAP_STATUSES: MessageStatus[] = ["sent", "dry_run", "failed"];

/** Start of the calendar day containing `now` in `tz`, as a UTC instant. */
export function startOfLocalDay(now: Date, tz: string = env.APP_TIMEZONE): Date {
  return fromZonedTime(startOfDay(toZonedTime(now, tz)), tz);
}

function normalizeSteps(steps: StepInput[]): StepInput[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((s, i) => ({ stepOrder: i + 1, subject: s.subject, body: s.body, delayDays: i === 0 ? 0 : (s.delayDays ?? 0) }));
}

async function loadSteps(db: Db, campaignId: string): Promise<EmailStep[]> {
  return db.select().from(emailSteps).where(eq(emailSteps.campaignId, campaignId)).orderBy(asc(emailSteps.stepOrder));
}

// ---------------------------------------------------------------- campaigns

export async function createEmailCampaign(
  db: Db,
  input: NewEmailCampaign & { steps: StepInput[] },
): Promise<EmailCampaign> {
  const { steps, ...campaign } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(emailCampaigns).values(campaign).returning();
    const normalized = normalizeSteps(steps);
    if (normalized.length) {
      await tx.insert(emailSteps).values(normalized.map((s) => ({ ...s, campaignId: row.id })));
    }
    return row;
  });
}

/**
 * Patch campaign fields; when `steps` is given, the step list is replaced
 * (rows are updated in place by position, extras deleted, so message history
 * keeps its step links).
 */
export async function updateEmailCampaign(
  db: Db,
  id: string,
  patch: Partial<Omit<NewEmailCampaign, "id" | "createdAt">>,
  steps?: StepInput[],
): Promise<EmailCampaign | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(emailCampaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(emailCampaigns.id, id))
      .returning();
    if (!row) return null;
    if (steps) {
      const normalized = normalizeSteps(steps);
      const existing = await tx.select().from(emailSteps).where(eq(emailSteps.campaignId, id));
      const byOrder = new Map(existing.map((s) => [s.stepOrder, s]));
      for (const s of normalized) {
        const cur = byOrder.get(s.stepOrder);
        if (cur) {
          await tx
            .update(emailSteps)
            .set({ subject: s.subject, body: s.body, delayDays: s.delayDays })
            .where(eq(emailSteps.id, cur.id));
        } else {
          await tx.insert(emailSteps).values({ ...s, campaignId: id });
        }
      }
      await tx
        .delete(emailSteps)
        .where(and(eq(emailSteps.campaignId, id), gt(emailSteps.stepOrder, normalized.length)));
    }
    return row;
  });
}

export async function getEmailCampaign(db: Db, id: string): Promise<(EmailCampaign & { steps: EmailStep[] }) | null> {
  const [row] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id));
  if (!row) return null;
  return { ...row, steps: await loadSteps(db, id) };
}

async function statsFor(db: Db, ids: string[], now: Date): Promise<Map<string, EmailCampaignDetailStats>> {
  const out = new Map<string, EmailCampaignDetailStats>();
  for (const id of ids) {
    out.set(id, { active: 0, completed: 0, replied: 0, unsubscribed: 0, paused: 0, bounced: 0, enrolled: 0, sentToday: 0, sentTotal: 0 });
  }
  if (!ids.length) return out;
  const byState = await db
    .select({ campaignId: emailEnrollments.campaignId, state: emailEnrollments.state, n: count() })
    .from(emailEnrollments)
    .where(inArray(emailEnrollments.campaignId, ids))
    .groupBy(emailEnrollments.campaignId, emailEnrollments.state);
  for (const r of byState) {
    const s = out.get(r.campaignId)!;
    const n = Number(r.n);
    s[r.state] = n;
    s.enrolled += n;
  }
  const dayStart = startOfLocalDay(now);
  const sent = await db
    .select({
      campaignId: emailEnrollments.campaignId,
      total: count(),
      today: sql<number>`count(*) filter (where ${emailMessages.sentAt} >= ${dayStart.toISOString()}::timestamptz)`,
    })
    .from(emailMessages)
    .innerJoin(emailEnrollments, eq(emailMessages.enrollmentId, emailEnrollments.id))
    .where(and(inArray(emailEnrollments.campaignId, ids), inArray(emailMessages.status, SENT_STATUSES)))
    .groupBy(emailEnrollments.campaignId);
  for (const r of sent) {
    const s = out.get(r.campaignId)!;
    s.sentTotal = Number(r.total);
    s.sentToday = Number(r.today);
  }
  return out;
}

/** Newest first, with enrollment and send stats. */
export async function listEmailCampaigns(db: Db, now: Date = new Date()): Promise<(EmailCampaign & EmailCampaignDetailStats & { stepCount: number })[]> {
  const rows = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt));
  const ids = rows.map((r) => r.id);
  const stats = await statsFor(db, ids, now);
  const stepCounts = ids.length
    ? await db
        .select({ campaignId: emailSteps.campaignId, n: count() })
        .from(emailSteps)
        .where(inArray(emailSteps.campaignId, ids))
        .groupBy(emailSteps.campaignId)
    : [];
  const stepMap = new Map(stepCounts.map((r) => [r.campaignId, Number(r.n)]));
  return rows.map((r) => ({ ...r, ...stats.get(r.id)!, stepCount: stepMap.get(r.id) ?? 0 }));
}

export async function getEmailCampaignStats(db: Db, id: string, now: Date = new Date()): Promise<EmailCampaignDetailStats> {
  return (await statsFor(db, [id], now)).get(id)!;
}

export async function pauseEmailCampaign(db: Db, id: string): Promise<void> {
  const now = new Date();
  await db
    .update(emailCampaigns)
    .set({ status: "paused", pauseReason: "manual", pausedAt: now, updatedAt: now })
    .where(and(eq(emailCampaigns.id, id), inArray(emailCampaigns.status, ["running", "paused"])));
}

export async function resumeEmailCampaign(db: Db, id: string): Promise<void> {
  await db
    .update(emailCampaigns)
    .set({ status: "running", pauseReason: null, pausedAt: null, updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "paused")));
}

/** draft → running. Returns false when the campaign is not a draft or has no steps. */
export async function startEmailCampaign(db: Db, id: string): Promise<boolean> {
  const steps = await loadSteps(db, id);
  if (!steps.length) return false;
  const rows = await db
    .update(emailCampaigns)
    .set({ status: "running", pauseReason: null, pausedAt: null, updatedAt: new Date() })
    .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "draft")))
    .returning({ id: emailCampaigns.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------- enrollments

/**
 * Enroll businesses at step 0 with `nextSendAt = now`. Skips businesses with
 * no ownerEmail, with doNotEmail, already enrolled in this campaign, or not
 * found. A completed campaign goes back to running when someone is enrolled.
 */
export async function enrollBusinesses(
  db: Db,
  campaignId: string,
  businessIds: string[],
  now: Date = new Date(),
): Promise<{ enrolled: number; skipped: number }> {
  const unique = [...new Set(businessIds)];
  if (!unique.length) return { enrolled: 0, skipped: 0 };
  const found = await db
    .select({ id: businesses.id, ownerEmail: businesses.ownerEmail, doNotEmail: businesses.doNotEmail })
    .from(businesses)
    .where(inArray(businesses.id, unique));
  const eligible = found.filter((b) => b.ownerEmail?.trim() && !b.doNotEmail).map((b) => b.id);
  let enrolled = 0;
  if (eligible.length) {
    const inserted = await db
      .insert(emailEnrollments)
      .values(
        eligible.map((businessId) => ({
          campaignId,
          businessId,
          state: "active" as const,
          currentStep: 0,
          nextSendAt: now,
          enrolledAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({ target: [emailEnrollments.campaignId, emailEnrollments.businessId] })
      .returning({ id: emailEnrollments.id });
    enrolled = inserted.length;
  }
  if (enrolled > 0) {
    await db
      .update(emailCampaigns)
      .set({ status: "running", updatedAt: now })
      .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "completed")));
  }
  return { enrolled, skipped: businessIds.length - enrolled };
}

/** Ids of businesses already enrolled (any state) in a campaign. */
export async function listEnrolledBusinessIds(db: Db, campaignId: string): Promise<string[]> {
  const rows = await db
    .select({ id: emailEnrollments.businessId })
    .from(emailEnrollments)
    .where(eq(emailEnrollments.campaignId, campaignId));
  return rows.map((r) => r.id);
}

export async function listEnrollments(
  db: Db,
  campaignId: string,
  opts: { state?: EnrollmentState[]; limit?: number; offset?: number } = {},
): Promise<{ rows: (EmailEnrollment & { business: Business })[]; total: number }> {
  const where = and(
    eq(emailEnrollments.campaignId, campaignId),
    opts.state?.length ? inArray(emailEnrollments.state, opts.state) : undefined,
  );
  const rows = await db
    .select({ enrollment: getTableColumns(emailEnrollments), business: getTableColumns(businesses) })
    .from(emailEnrollments)
    .innerJoin(businesses, eq(emailEnrollments.businessId, businesses.id))
    .where(where)
    .orderBy(asc(emailEnrollments.enrolledAt), asc(businesses.name))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  const [{ n }] = await db.select({ n: count() }).from(emailEnrollments).where(where);
  return { rows: rows.map((r) => ({ ...r.enrollment, business: r.business })), total: Number(n) };
}

async function getEnrollment(db: Db, id: string): Promise<EmailEnrollment | null> {
  const [row] = await db.select().from(emailEnrollments).where(eq(emailEnrollments.id, id));
  return row ?? null;
}

/** Owner replied (recorded by hand): no further sends. */
export async function markReplied(db: Db, enrollmentId: string): Promise<void> {
  const e = await getEnrollment(db, enrollmentId);
  if (!e) return;
  const now = new Date();
  await db
    .update(emailEnrollments)
    .set({ state: "replied", nextSendAt: null, updatedAt: now })
    .where(eq(emailEnrollments.id, enrollmentId));
  await logActivity(db, {
    businessId: e.businessId,
    type: "email",
    body: "Replied to email sequence",
    outcome: "replied",
    campaignType: "email",
    campaignId: e.campaignId,
  });
}

/** Unsubscribe: enrollment stops and the business is flagged doNotEmail everywhere. */
export async function unsubscribe(db: Db, enrollmentId: string): Promise<void> {
  const e = await getEnrollment(db, enrollmentId);
  if (!e) return;
  const now = new Date();
  await db
    .update(emailEnrollments)
    .set({ state: "unsubscribed", nextSendAt: null, updatedAt: now })
    .where(eq(emailEnrollments.id, enrollmentId));
  await updateBusinessCrm(db, e.businessId, { doNotEmail: true });
  await logActivity(db, {
    businessId: e.businessId,
    type: "system",
    body: "Unsubscribed from email; marked do not email",
    outcome: "unsubscribed",
    campaignType: "email",
    campaignId: e.campaignId,
  });
}

// ---------------------------------------------------------------- messages

export async function listMessages(
  db: Db,
  campaignId: string,
  opts: { status?: MessageStatus[]; limit?: number; offset?: number } = {},
): Promise<{ rows: EmailMessage[]; total: number }> {
  const where = and(
    eq(emailEnrollments.campaignId, campaignId),
    opts.status?.length ? inArray(emailMessages.status, opts.status) : undefined,
  );
  const rows = await db
    .select(getTableColumns(emailMessages))
    .from(emailMessages)
    .innerJoin(emailEnrollments, eq(emailMessages.enrollmentId, emailEnrollments.id))
    .where(where)
    .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  const [{ n }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .innerJoin(emailEnrollments, eq(emailMessages.enrollmentId, emailEnrollments.id))
    .where(where);
  return { rows, total: Number(n) };
}

/** Messages actually sent (status sent or dry_run) with sentAt ≥ since, across campaigns. */
export async function countEmailsSent(db: Db, since: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(and(inArray(emailMessages.status, SENT_STATUSES), isNotNull(emailMessages.sentAt), gte(emailMessages.sentAt, since)));
  return Number(n);
}

// ---------------------------------------------------------------- runner

async function attemptsSince(db: Db, campaignId: string, since: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .innerJoin(emailEnrollments, eq(emailMessages.enrollmentId, emailEnrollments.id))
    .where(
      and(
        eq(emailEnrollments.campaignId, campaignId),
        inArray(emailMessages.status, CAP_STATUSES),
        gte(emailMessages.createdAt, since),
      ),
    );
  return Number(n);
}

function fromHeader(c: EmailCampaign): string {
  const name = c.fromName.replace(/["<>]/g, "").trim();
  return name ? `${name} <${c.fromEmail}>` : c.fromEmail;
}

/**
 * Send what is due for one running campaign: active enrollments with
 * nextSendAt ≤ now, oldest first, up to dailyCap minus today's attempts
 * (calendar day in APP_TIMEZONE). See architecture §Campaign automation.
 */
export async function processDueSends(
  db: Db,
  campaignId: string,
  sender: EmailSender,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, skipped: 0, failed: 0 };
  const campaign = await getEmailCampaign(db, campaignId);
  if (!campaign || campaign.status !== "running") return result;
  const steps = campaign.steps;

  let remaining = campaign.dailyCap - (await attemptsSince(db, campaignId, startOfLocalDay(now)));
  while (remaining > 0) {
    const due = await db
      .select({ enrollment: getTableColumns(emailEnrollments), business: getTableColumns(businesses) })
      .from(emailEnrollments)
      .innerJoin(businesses, eq(emailEnrollments.businessId, businesses.id))
      .where(
        and(
          eq(emailEnrollments.campaignId, campaignId),
          eq(emailEnrollments.state, "active"),
          isNotNull(emailEnrollments.nextSendAt),
          lte(emailEnrollments.nextSendAt, now),
        ),
      )
      .orderBy(asc(emailEnrollments.nextSendAt), asc(emailEnrollments.id))
      .limit(remaining);
    if (!due.length) break;

    for (const { enrollment: e, business: b } of due) {
      if (remaining <= 0) break;
      const step = steps[e.currentStep];
      if (!step) {
        // Steps were removed since enrollment: nothing left to send.
        await db
          .update(emailEnrollments)
          .set({ state: "completed", nextSendAt: null, updatedAt: now })
          .where(eq(emailEnrollments.id, e.id));
        continue;
      }
      const to = b.ownerEmail?.trim();
      if (!to || b.doNotEmail) {
        await db
          .update(emailEnrollments)
          .set({ state: "paused", nextSendAt: null, updatedAt: now })
          .where(eq(emailEnrollments.id, e.id));
        await logActivity(db, {
          businessId: b.id,
          type: "system",
          body: !to
            ? `Email step ${step.stepOrder} skipped: business has no email address; enrollment paused`
            : `Email step ${step.stepOrder} skipped: business is marked do not email; enrollment paused`,
          outcome: "skipped",
          campaignType: "email",
          campaignId,
          occurredAt: now,
        });
        result.skipped += 1;
        continue;
      }

      // Claim: only proceed if no concurrent run took this enrollment.
      const claimed = await db
        .update(emailEnrollments)
        .set({ nextSendAt: new Date(now.getTime() + SEND_LEASE_MS), updatedAt: now })
        .where(
          and(
            eq(emailEnrollments.id, e.id),
            eq(emailEnrollments.state, "active"),
            eq(emailEnrollments.currentStep, e.currentStep),
            lte(emailEnrollments.nextSendAt, now),
          ),
        )
        .returning({ id: emailEnrollments.id });
      if (!claimed.length) continue;

      const subject = renderTemplate(step.subject, b);
      const text = renderTemplate(step.body, b);
      let status: MessageStatus;
      let providerId: string | null = null;
      let error: string | null = null;
      try {
        const res = await sender.send({ to, from: fromHeader(campaign), subject, text });
        providerId = res.id;
        status = sender.kind === "dry_run" ? "dry_run" : "sent";
      } catch (err) {
        status = "failed";
        error = err instanceof Error ? err.message : String(err);
        console.error(`[email] send failed for enrollment ${e.id}:`, err);
      }
      remaining -= 1;

      await db.insert(emailMessages).values({
        enrollmentId: e.id,
        stepId: step.id,
        businessId: b.id,
        toEmail: to,
        subject,
        bodyRendered: text,
        status,
        providerId,
        error,
        sentAt: status === "failed" ? null : now,
        createdAt: now,
      });

      if (status === "failed") {
        await db
          .update(emailEnrollments)
          .set({ nextSendAt: new Date(now.getTime() + RETRY_AFTER_MS), updatedAt: now })
          .where(eq(emailEnrollments.id, e.id));
        result.failed += 1;
      } else {
        const nextIndex = e.currentStep + 1;
        const next = steps[nextIndex];
        await db
          .update(emailEnrollments)
          .set({
            currentStep: nextIndex,
            lastSentAt: now,
            nextSendAt: next ? new Date(now.getTime() + next.delayDays * DAY_MS) : null,
            state: next ? "active" : "completed",
            updatedAt: now,
          })
          .where(eq(emailEnrollments.id, e.id));
        result.sent += 1;
      }
      await logActivity(db, {
        businessId: b.id,
        type: "email",
        body: status === "failed" ? `Send failed: ${subject}` : subject,
        outcome: status,
        metadata: { step: step.stepOrder, ...(error ? { error } : {}) },
        campaignType: "email",
        campaignId,
        occurredAt: now,
      });
    }
  }

  // A campaign with enrollments but none still active is done.
  const [{ total, active }] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${emailEnrollments.state} = 'active')`,
    })
    .from(emailEnrollments)
    .where(eq(emailEnrollments.campaignId, campaignId));
  if (Number(total) > 0 && Number(active) === 0) {
    await db
      .update(emailCampaigns)
      .set({ status: "completed", updatedAt: now })
      .where(and(eq(emailCampaigns.id, campaignId), eq(emailCampaigns.status, "running")));
  }
  return result;
}

/** Run processDueSends for every running campaign; returns the number of messages sent. */
export async function processAllDue(db: Db, sender: EmailSender, now: Date = new Date()): Promise<number> {
  const running = await db.select({ id: emailCampaigns.id }).from(emailCampaigns).where(eq(emailCampaigns.status, "running"));
  let sent = 0;
  for (const c of running) {
    sent += (await processDueSends(db, c.id, sender, now)).sent;
  }
  return sent;
}
