import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  countEmailsSent,
  createEmailCampaign,
  enrollBusinesses,
  getEmailCampaign,
  getEmailCampaignStats,
  listEmailCampaigns,
  listEnrollments,
  listMessages,
  markReplied,
  pauseEmailCampaign,
  processAllDue,
  processDueSends,
  resumeEmailCampaign,
  unsubscribe,
  updateEmailCampaign,
} from "@/db/repo/email-campaigns";
import { type NewBusiness, activities, businesses, emailEnrollments, emailMessages } from "@/db/schema";
import { createTestDb } from "@/db/test-utils";
import { DryRunSender, type EmailSender, type OutgoingEmail } from "@/lib/email/sender";
import { normalizeName } from "@/lib/format";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE email_messages, email_enrollments, email_steps, email_campaigns, activities, businesses RESTART IDENTITY CASCADE`,
  );
});

const DAY = 86_400_000;
// 15:00 UTC = 09:00/10:00 in America/Chicago: mid-day, far from local midnight.
const NOW = new Date("2026-11-04T15:00:00.000Z");
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

let seq = 0;
async function makeBusiness(overrides: Partial<NewBusiness> = {}) {
  seq += 1;
  const name = overrides.name ?? `Acme Plumbing ${seq}`;
  const [b] = await db
    .insert(businesses)
    .values({
      yelpId: `yelp-email-${seq}`,
      name,
      nameNormalized: normalizeName(name),
      categories: [{ alias: "plumbing", title: "Plumbing" }],
      primaryCategory: "plumbing",
      city: "Houston",
      state: "TX",
      rating: "4.5",
      reviewCount: 42,
      ownerName: "Maria Lopez",
      ownerEmail: `owner${seq}@example.com`,
      raw: {},
      ...overrides,
    })
    .returning();
  return b;
}

/** Records every message, like DryRunSender, so tests can inspect what went out. */
class RecordingSender implements EmailSender {
  readonly kind = "dry_run" as const;
  sent: OutgoingEmail[] = [];
  private inner = new DryRunSender();
  async send(msg: OutgoingEmail) {
    this.sent.push(msg);
    return this.inner.send(msg);
  }
}

async function makeCampaign(dailyCap = 50) {
  return createEmailCampaign(db, {
    name: "Intro",
    status: "running",
    fromName: "Alex",
    fromEmail: "alex@example.com",
    dailyCap,
    steps: [
      { stepOrder: 1, delayDays: 0, subject: "Hello {{business_name}}", body: "Hi {{owner_first_name}}, about {{business_name}} in {{city}}." },
      { stepOrder: 2, delayDays: 2, subject: "Following up, {{business_name}}", body: "Step two for {{business_name}}." },
      { stepOrder: 3, delayDays: 4, subject: "Last note", body: "Closing the loop with {{business_name}}." },
    ],
  });
}

describe("AC-06.1 runner", () => {
  it("sends each step on schedule and completes after step 3", async () => {
    const campaign = await makeCampaign(50);
    const a = await makeBusiness({ name: "Bayou Plumbing" });
    const b = await makeBusiness({ name: "Gulf Coast Drains" });
    expect(await enrollBusinesses(db, campaign.id, [a.id, b.id], NOW)).toEqual({ enrolled: 2, skipped: 0 });

    const sender = new RecordingSender();
    // Step 1 at now.
    expect(await processDueSends(db, campaign.id, sender, NOW)).toEqual({ sent: 2, skipped: 0, failed: 0 });
    const msgs = await listMessages(db, campaign.id);
    expect(msgs.total).toBe(2);
    for (const m of msgs.rows) expect(m.status).toBe("dry_run");
    const subjects = msgs.rows.map((m) => m.subject).sort();
    expect(subjects).toEqual(["Hello Bayou Plumbing", "Hello Gulf Coast Drains"]);
    const bayou = msgs.rows.find((m) => m.businessId === a.id)!;
    expect(bayou.bodyRendered).toBe("Hi Maria, about Bayou Plumbing in Houston.");
    expect(bayou.toEmail).toBe(a.ownerEmail);
    expect(sender.sent[0].from).toBe("Alex <alex@example.com>");

    let { rows } = await listEnrollments(db, campaign.id);
    for (const e of rows) {
      expect(e.currentStep).toBe(1);
      expect(e.state).toBe("active");
      expect(e.nextSendAt?.toISOString()).toBe(at(2).toISOString());
      expect(e.lastSentAt?.toISOString()).toBe(NOW.toISOString());
    }

    // One day later: nothing is due.
    expect(await processDueSends(db, campaign.id, sender, at(1))).toEqual({ sent: 0, skipped: 0, failed: 0 });

    // Two days later: step 2.
    expect((await processDueSends(db, campaign.id, sender, at(2))).sent).toBe(2);
    ({ rows } = await listEnrollments(db, campaign.id));
    for (const e of rows) {
      expect(e.currentStep).toBe(2);
      expect(e.nextSendAt?.toISOString()).toBe(at(6).toISOString());
    }
    expect((await listMessages(db, campaign.id)).rows.filter((m) => m.subject.startsWith("Following up")).length).toBe(2);

    // Not yet due at +5, step 3 at +6, then completed.
    expect((await processDueSends(db, campaign.id, sender, at(5))).sent).toBe(0);
    expect((await processDueSends(db, campaign.id, sender, at(6))).sent).toBe(2);
    ({ rows } = await listEnrollments(db, campaign.id));
    for (const e of rows) {
      expect(e.state).toBe("completed");
      expect(e.currentStep).toBe(3);
      expect(e.nextSendAt).toBeNull();
    }
    expect((await listMessages(db, campaign.id)).total).toBe(6);
    // No active enrollments left → campaign completed; further runs send nothing.
    expect((await getEmailCampaign(db, campaign.id))!.status).toBe("completed");
    expect((await processDueSends(db, campaign.id, sender, at(30))).sent).toBe(0);

    // One email activity per send.
    const emailActs = await db
      .select()
      .from(activities)
      .where(and(eq(activities.type, "email"), eq(activities.campaignId, campaign.id)));
    expect(emailActs.length).toBe(6);
  });

  it("does nothing for a campaign that is not running", async () => {
    const campaign = await makeCampaign(50);
    await db.execute(sql`UPDATE email_campaigns SET status = 'paused', pause_reason = 'manual' WHERE id = ${campaign.id}`);
    const b = await makeBusiness();
    await enrollBusinesses(db, campaign.id, [b.id], NOW);
    expect(await processDueSends(db, campaign.id, new RecordingSender(), NOW)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    const [e] = await db.select().from(emailEnrollments).where(eq(emailEnrollments.businessId, b.id));
    expect(e.currentStep).toBe(0);
  });

  it("records a failed send without advancing and retries later", async () => {
    const campaign = await makeCampaign(50);
    const b = await makeBusiness();
    await enrollBusinesses(db, campaign.id, [b.id], NOW);
    const failing: EmailSender = {
      kind: "resend",
      async send() {
        throw new Error("provider down");
      },
    };
    expect(await processDueSends(db, campaign.id, failing, NOW)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    const [m] = (await listMessages(db, campaign.id)).rows;
    expect(m.status).toBe("failed");
    expect(m.error).toBe("provider down");
    const [e] = (await listEnrollments(db, campaign.id)).rows;
    expect(e.currentStep).toBe(0);
    expect(e.state).toBe("active");
    expect(e.nextSendAt!.getTime()).toBeGreaterThan(NOW.getTime());
    // Next day it goes out with a working sender.
    expect((await processDueSends(db, campaign.id, new RecordingSender(), at(1))).sent).toBe(1);
  });
});

// ---------------------------------------------------------------- helpers for the blocks below

async function enrollmentOf(campaignId: string, businessId: string) {
  const [e] = await db
    .select()
    .from(emailEnrollments)
    .where(and(eq(emailEnrollments.campaignId, campaignId), eq(emailEnrollments.businessId, businessId)));
  return e;
}

async function messagesFor(businessId: string) {
  return db.select().from(emailMessages).where(eq(emailMessages.businessId, businessId));
}

describe("AC-06.2 daily cap", () => {
  it("sends at most dailyCap per local day, one more each day", async () => {
    const campaign = await makeCampaign(1);
    const bs = [await makeBusiness(), await makeBusiness(), await makeBusiness()];
    expect(await enrollBusinesses(db, campaign.id, bs.map((b) => b.id), NOW)).toEqual({ enrolled: 3, skipped: 0 });
    const sender = new RecordingSender();

    expect((await processDueSends(db, campaign.id, sender, NOW)).sent).toBe(1);
    // Same local day (NOW + 2 h): cap already used.
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(await processDueSends(db, campaign.id, sender, later)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sender.sent.length).toBe(1);
    expect((await listMessages(db, campaign.id)).total).toBe(1);

    expect((await processDueSends(db, campaign.id, sender, at(1))).sent).toBe(1);
    expect((await listMessages(db, campaign.id)).total).toBe(2);
    expect((await processDueSends(db, campaign.id, sender, at(2))).sent).toBe(1);

    const msgs = (await listMessages(db, campaign.id)).rows;
    expect(msgs.length).toBe(3);
    // Each of the three businesses got exactly one email.
    expect(new Set(msgs.map((m) => m.businessId))).toEqual(new Set(bs.map((b) => b.id)));
    expect(sender.sent.length).toBe(3);
  });

  it("uses the APP_TIMEZONE local day, not the UTC day, for the boundary", async () => {
    const campaign = await makeCampaign(1);
    const bs = [await makeBusiness(), await makeBusiness()];
    const t0 = new Date("2026-11-04T23:00:00.000Z"); // 17:00 Chicago, Nov 4
    await enrollBusinesses(db, campaign.id, bs.map((b) => b.id), t0);
    const sender = new RecordingSender();

    expect((await processDueSends(db, campaign.id, sender, t0)).sent).toBe(1);
    // 22:00 Chicago on Nov 4: same local day although the UTC date is Nov 5.
    expect((await processDueSends(db, campaign.id, sender, new Date("2026-11-05T04:00:00.000Z"))).sent).toBe(0);
    expect((await listMessages(db, campaign.id)).total).toBe(1);
    // 01:00 Chicago on Nov 5: a new local day.
    expect((await processDueSends(db, campaign.id, sender, new Date("2026-11-05T07:00:00.000Z"))).sent).toBe(1);
    expect((await listMessages(db, campaign.id)).total).toBe(2);
  });
});

describe("AC-06.3 skips, replies and unsubscribes", () => {
  it("pauses an enrollment whose business lost its ownerEmail and logs a system activity", async () => {
    const campaign = await makeCampaign(50);
    const good = await makeBusiness();
    const noEmail = await makeBusiness({ name: "Lost Email Co" });
    await enrollBusinesses(db, campaign.id, [good.id, noEmail.id], NOW);
    await db.update(businesses).set({ ownerEmail: null }).where(eq(businesses.id, noEmail.id));

    const sender = new RecordingSender();
    expect(await processDueSends(db, campaign.id, sender, NOW)).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(sender.sent.map((m) => m.to)).toEqual([good.ownerEmail]);
    expect(await messagesFor(noEmail.id)).toEqual([]);

    const e = await enrollmentOf(campaign.id, noEmail.id);
    expect(e.state).toBe("paused");
    expect(e.currentStep).toBe(0);
    expect(e.nextSendAt).toBeNull();

    const acts = await db
      .select()
      .from(activities)
      .where(and(eq(activities.businessId, noEmail.id), eq(activities.type, "system")));
    expect(acts.length).toBe(1);
    expect(acts[0].campaignId).toBe(campaign.id);

    // Paused enrollments are never picked up again.
    expect((await processDueSends(db, campaign.id, sender, at(10))).skipped).toBe(0);
    expect(await messagesFor(noEmail.id)).toEqual([]);
  });

  it("pauses an enrollment whose business became doNotEmail", async () => {
    const campaign = await makeCampaign(50);
    const good = await makeBusiness();
    const dnc = await makeBusiness({ name: "Opted Out LLC" });
    await enrollBusinesses(db, campaign.id, [good.id, dnc.id], NOW);
    await db.update(businesses).set({ doNotEmail: true }).where(eq(businesses.id, dnc.id));

    const sender = new RecordingSender();
    expect(await processDueSends(db, campaign.id, sender, NOW)).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(sender.sent.map((m) => m.to)).toEqual([good.ownerEmail]);
    expect(await messagesFor(dnc.id)).toEqual([]);

    const e = await enrollmentOf(campaign.id, dnc.id);
    expect(e.state).toBe("paused");
    expect(e.nextSendAt).toBeNull();

    const acts = await db
      .select()
      .from(activities)
      .where(and(eq(activities.businessId, dnc.id), eq(activities.type, "system")));
    expect(acts.length).toBe(1);
    expect(acts[0].campaignId).toBe(campaign.id);
    // No email activity for the skipped business.
    const emailActs = await db
      .select()
      .from(activities)
      .where(and(eq(activities.businessId, dnc.id), eq(activities.type, "email")));
    expect(emailActs).toEqual([]);
  });

  it("markReplied stops further sends to that enrollment", async () => {
    const campaign = await makeCampaign(50);
    const replier = await makeBusiness();
    const other = await makeBusiness();
    await enrollBusinesses(db, campaign.id, [replier.id, other.id], NOW);
    const sender = new RecordingSender();
    expect((await processDueSends(db, campaign.id, sender, NOW)).sent).toBe(2);

    const e = await enrollmentOf(campaign.id, replier.id);
    await markReplied(db, e.id);
    const after = await enrollmentOf(campaign.id, replier.id);
    expect(after.state).toBe("replied");
    expect(after.nextSendAt).toBeNull();

    // The other enrollment continues through steps 2 and 3; the replier gets nothing more.
    expect((await processDueSends(db, campaign.id, sender, at(2))).sent).toBe(1);
    expect((await processDueSends(db, campaign.id, sender, at(30))).sent).toBe(1);
    expect((await messagesFor(replier.id)).length).toBe(1);
    expect((await messagesFor(other.id)).length).toBe(3);
    expect((await enrollmentOf(campaign.id, replier.id)).state).toBe("replied");
  });

  it("unsubscribe stops the enrollment and flags the business doNotEmail", async () => {
    const campaign = await makeCampaign(50);
    const quitter = await makeBusiness();
    await enrollBusinesses(db, campaign.id, [quitter.id], NOW);
    const sender = new RecordingSender();
    await processDueSends(db, campaign.id, sender, NOW);

    const e = await enrollmentOf(campaign.id, quitter.id);
    await unsubscribe(db, e.id);

    const after = await enrollmentOf(campaign.id, quitter.id);
    expect(after.state).toBe("unsubscribed");
    expect(after.nextSendAt).toBeNull();
    const [b] = await db.select().from(businesses).where(eq(businesses.id, quitter.id));
    expect(b.doNotEmail).toBe(true);

    expect((await processDueSends(db, campaign.id, sender, at(30))).sent).toBe(0);
    expect((await messagesFor(quitter.id)).length).toBe(1);
  });
});

describe("AC-06.4 enrollBusinesses", () => {
  it("enrolls only eligible businesses and reports enrolled/skipped", async () => {
    const campaign = await makeCampaign(50);
    const ok1 = await makeBusiness();
    const ok2 = await makeBusiness();
    const nullEmail = await makeBusiness({ ownerEmail: null });
    const emptyEmail = await makeBusiness({ ownerEmail: "" });
    const dnc = await makeBusiness({ doNotEmail: true });
    const already = await makeBusiness();

    expect(await enrollBusinesses(db, campaign.id, [already.id], NOW)).toEqual({ enrolled: 1, skipped: 0 });
    const ids = [ok1.id, ok2.id, nullEmail.id, emptyEmail.id, dnc.id, already.id];
    expect(await enrollBusinesses(db, campaign.id, ids, at(1))).toEqual({ enrolled: 2, skipped: 4 });

    const { rows, total } = await listEnrollments(db, campaign.id);
    expect(total).toBe(3);
    expect(new Set(rows.map((r) => r.businessId))).toEqual(new Set([ok1.id, ok2.id, already.id]));
    for (const e of rows) {
      expect(e.currentStep).toBe(0);
      expect(e.state).toBe("active");
    }
    // New enrollments are due at the `now` passed in; the earlier one is untouched.
    expect((await enrollmentOf(campaign.id, ok1.id)).nextSendAt?.toISOString()).toBe(at(1).toISOString());
    expect((await enrollmentOf(campaign.id, ok2.id)).nextSendAt?.toISOString()).toBe(at(1).toISOString());
    expect((await enrollmentOf(campaign.id, already.id)).nextSendAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("counts duplicate ids and unknown ids as skipped", async () => {
    const campaign = await makeCampaign(50);
    const a = await makeBusiness();
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await enrollBusinesses(db, campaign.id, [a.id, a.id], NOW)).toEqual({ enrolled: 1, skipped: 1 });
    const b = await makeBusiness();
    expect(await enrollBusinesses(db, campaign.id, [b.id, missing], NOW)).toEqual({ enrolled: 1, skipped: 1 });
    expect(await enrollBusinesses(db, campaign.id, [], NOW)).toEqual({ enrolled: 0, skipped: 0 });
    expect((await listEnrollments(db, campaign.id)).total).toBe(2);
  });

  it("moves a completed campaign back to running when someone is enrolled", async () => {
    const campaign = await makeCampaign(50);
    await db.execute(sql`UPDATE email_campaigns SET status = 'completed' WHERE id = ${campaign.id}`);
    const skippedOnly = await makeBusiness({ ownerEmail: null });
    expect(await enrollBusinesses(db, campaign.id, [skippedOnly.id], NOW)).toEqual({ enrolled: 0, skipped: 1 });
    expect((await getEmailCampaign(db, campaign.id))!.status).toBe("completed");

    const b = await makeBusiness();
    expect(await enrollBusinesses(db, campaign.id, [b.id], NOW)).toEqual({ enrolled: 1, skipped: 0 });
    expect((await getEmailCampaign(db, campaign.id))!.status).toBe("running");
  });
});

describe("pause and resume", () => {
  it("pauseEmailCampaign records a manual pause and stops sending; resume restores it", async () => {
    const campaign = await makeCampaign(50);
    const b = await makeBusiness();
    await enrollBusinesses(db, campaign.id, [b.id], NOW);

    await pauseEmailCampaign(db, campaign.id);
    const paused = (await getEmailCampaign(db, campaign.id))!;
    expect(paused.status).toBe("paused");
    expect(paused.pauseReason).toBe("manual");
    expect(paused.pausedAt).toBeInstanceOf(Date);

    const sender = new RecordingSender();
    expect(await processDueSends(db, campaign.id, sender, NOW)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sender.sent).toEqual([]);

    await resumeEmailCampaign(db, campaign.id);
    const resumed = (await getEmailCampaign(db, campaign.id))!;
    expect(resumed.status).toBe("running");
    expect(resumed.pauseReason).toBeNull();
    expect(resumed.pausedAt).toBeNull();
    expect((await processDueSends(db, campaign.id, sender, NOW)).sent).toBe(1);
  });
});

describe("processAllDue", () => {
  it("runs only running campaigns and returns the total sent", async () => {
    const running1 = await makeCampaign(50);
    const running2 = await makeCampaign(50);
    const paused = await makeCampaign(50);
    const draft = await createEmailCampaign(db, {
      name: "Draft",
      status: "draft",
      fromName: "Alex",
      fromEmail: "alex@example.com",
      dailyCap: 50,
      steps: [{ stepOrder: 1, delayDays: 0, subject: "Hi", body: "Hi" }],
    });
    const campaigns = [running1, running2, paused, draft];
    const counts = [2, 1, 1, 1];
    for (const [i, c] of campaigns.entries()) {
      const bs = await Promise.all(Array.from({ length: counts[i] }, () => makeBusiness()));
      await enrollBusinesses(db, c.id, bs.map((b) => b.id), NOW);
    }
    await db.execute(sql`UPDATE email_campaigns SET status = 'paused', pause_reason = 'manual' WHERE id = ${paused.id}`);

    const sender = new RecordingSender();
    expect(await processAllDue(db, sender, NOW)).toBe(3);
    expect(sender.sent.length).toBe(3);
    expect((await listMessages(db, running1.id)).total).toBe(2);
    expect((await listMessages(db, running2.id)).total).toBe(1);
    expect((await listMessages(db, paused.id)).total).toBe(0);
    expect((await listMessages(db, draft.id)).total).toBe(0);
  });
});

describe("countEmailsSent", () => {
  it("counts sent and dry_run messages but not failed ones", async () => {
    // Real-provider campaign: two succeed (status 'sent'), one fails.
    const live = await makeCampaign(50);
    const ok1 = await makeBusiness();
    const ok2 = await makeBusiness();
    const bad = await makeBusiness();
    await enrollBusinesses(db, live.id, [ok1.id, ok2.id, bad.id], NOW);
    const flaky: EmailSender = {
      kind: "resend",
      async send(msg) {
        if (msg.to === bad.ownerEmail) throw new Error("bounced");
        return { id: "re_1" };
      },
    };
    expect(await processDueSends(db, live.id, flaky, NOW)).toEqual({ sent: 2, skipped: 0, failed: 1 });
    const statuses = (await listMessages(db, live.id)).rows.map((m) => m.status).sort();
    expect(statuses).toEqual(["failed", "sent", "sent"]);

    // Dry-run campaign: one dry_run message.
    const dry = await makeCampaign(50);
    const d = await makeBusiness();
    await enrollBusinesses(db, dry.id, [d.id], NOW);
    expect((await processDueSends(db, dry.id, new RecordingSender(), NOW)).sent).toBe(1);

    expect(await countEmailsSent(db, NOW)).toBe(3);
    expect(await countEmailsSent(db, new Date(NOW.getTime() - DAY))).toBe(3);
    expect(await countEmailsSent(db, at(1))).toBe(0);
  });
});

describe("campaign stats", () => {
  it("listEmailCampaigns and getEmailCampaignStats reflect enrollment states and sends", async () => {
    const campaign = await makeCampaign(50);
    const empty = await makeCampaign(50);
    const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map(() => makeBusiness()));
    await enrollBusinesses(db, campaign.id, [a.id, b.id, c.id, d.id], NOW);
    const sender = new RecordingSender();
    expect((await processDueSends(db, campaign.id, sender, NOW)).sent).toBe(4);

    await markReplied(db, (await enrollmentOf(campaign.id, a.id)).id);
    await unsubscribe(db, (await enrollmentOf(campaign.id, b.id)).id);
    expect((await processDueSends(db, campaign.id, sender, at(2))).sent).toBe(2);
    expect((await processDueSends(db, campaign.id, sender, at(6))).sent).toBe(2);
    expect((await getEmailCampaign(db, campaign.id))!.status).toBe("completed");

    // A late enrollment reopens the campaign and sends its first step.
    await enrollBusinesses(db, campaign.id, [e.id], at(6));
    expect((await processDueSends(db, campaign.id, sender, at(6))).sent).toBe(1);

    const expected = {
      active: 1,
      completed: 2,
      replied: 1,
      unsubscribed: 1,
      paused: 0,
      bounced: 0,
      enrolled: 5,
      sentToday: 3,
      sentTotal: 9,
    };
    expect(await getEmailCampaignStats(db, campaign.id, at(6))).toEqual(expected);

    const list = await listEmailCampaigns(db, at(6));
    expect(list.length).toBe(2);
    const row = list.find((r) => r.id === campaign.id)!;
    expect(row).toMatchObject({ ...expected, stepCount: 3 });
    const emptyRow = list.find((r) => r.id === empty.id)!;
    expect(emptyRow).toMatchObject({
      active: 0,
      completed: 0,
      replied: 0,
      unsubscribed: 0,
      enrolled: 0,
      sentToday: 0,
      sentTotal: 0,
      stepCount: 3,
    });
  });
});

describe("updateEmailCampaign steps", () => {
  it("replaces 3 steps with 2, keeping ids for orders 1-2 and forcing the first delay to 0", async () => {
    const campaign = await makeCampaign(50);
    const before = (await getEmailCampaign(db, campaign.id))!.steps;
    expect(before.map((s) => s.stepOrder)).toEqual([1, 2, 3]);

    const updated = await updateEmailCampaign(db, campaign.id, { name: "Renamed", dailyCap: 7 }, [
      { stepOrder: 1, delayDays: 5, subject: "New one", body: "Body one" },
      { stepOrder: 2, delayDays: 3, subject: "New two", body: "Body two" },
    ]);
    expect(updated?.id).toBe(campaign.id);

    const after = (await getEmailCampaign(db, campaign.id))!;
    expect(after.name).toBe("Renamed");
    expect(after.dailyCap).toBe(7);
    expect(after.steps.length).toBe(2);
    expect(after.steps.map((s) => s.stepOrder)).toEqual([1, 2]);
    expect(after.steps[0].id).toBe(before[0].id);
    expect(after.steps[1].id).toBe(before[1].id);
    expect(after.steps[0]).toMatchObject({ delayDays: 0, subject: "New one", body: "Body one" });
    expect(after.steps[1]).toMatchObject({ delayDays: 3, subject: "New two", body: "Body two" });
    expect(after.steps.some((s) => s.id === before[2].id)).toBe(false);
  });
});
