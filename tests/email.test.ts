import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  createEmailCampaign,
  enrollBusinesses,
  getEmailCampaign,
  listEnrollments,
  listMessages,
  processDueSends,
} from "@/db/repo/email-campaigns";
import { type NewBusiness, activities, businesses, emailEnrollments } from "@/db/schema";
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
