import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { GooglePlan } from "@/lib/google-places/types";

// ---------------------------------------------------------------- enums

export const qualificationEnum = pgEnum("qualification", ["qualified", "review", "rejected"]);
export const businessStatusEnum = pgEnum("business_status", [
  "new",
  "contacted",
  "interested",
  "callback",
  "not_interested",
  "do_not_call",
  "converted",
]);
export const activityTypeEnum = pgEnum("activity_type", ["note", "call", "email", "status_change", "system"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "completed", "failed"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "running", "paused", "completed"]);
export const pauseReasonEnum = pgEnum("pause_reason", ["manual", "daily_cap", "outside_hours", "exhausted"]);
export const queueStateEnum = pgEnum("queue_state", ["pending", "claimed", "completed", "skipped", "callback"]);
export const callOutcomeEnum = pgEnum("call_outcome", [
  "no_answer",
  "voicemail",
  "busy",
  "interested",
  "not_interested",
  "callback",
  "wrong_number",
  "do_not_call",
]);
export const enrollmentStateEnum = pgEnum("enrollment_state", [
  "active",
  "completed",
  "replied",
  "unsubscribed",
  "bounced",
  "paused",
]);
export const messageStatusEnum = pgEnum("message_status", ["queued", "sent", "failed", "dry_run"]);
export const businessSourceEnum = pgEnum("business_source", ["yelp", "trustpilot", "google"]);
export const callModeEnum = pgEnum("call_mode", ["human", "ai"]);
export const aiCallStatusEnum = pgEnum("ai_call_status", ["initiated", "completed", "failed"]);
export const leadStatusEnum = pgEnum("lead_status", ["queued", "contacted", "callback", "success", "failed", "skipped"]);

export type Qualification = (typeof qualificationEnum.enumValues)[number];
export type BusinessStatus = (typeof businessStatusEnum.enumValues)[number];
export type ActivityType = (typeof activityTypeEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type CampaignStatus = (typeof campaignStatusEnum.enumValues)[number];
export type PauseReason = (typeof pauseReasonEnum.enumValues)[number];
export type QueueState = (typeof queueStateEnum.enumValues)[number];
export type CallOutcome = (typeof callOutcomeEnum.enumValues)[number];
export type EnrollmentState = (typeof enrollmentStateEnum.enumValues)[number];
export type MessageStatus = (typeof messageStatusEnum.enumValues)[number];
export type BusinessSource = (typeof businessSourceEnum.enumValues)[number];
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];
export type CallMode = (typeof callModeEnum.enumValues)[number];
export type AiCallStatus = (typeof aiCallStatusEnum.enumValues)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------- search_jobs

export const searchJobs = pgTable("search_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  term: text("term"),
  location: text("location").notNull(),
  categoryAliases: text("category_aliases").array().notNull(),
  radiusM: integer("radius_m").notNull().default(20000),
  maxResults: integer("max_results").notNull().default(200),
  status: jobStatusEnum("status").notNull().default("pending"),
  fetchedCount: integer("fetched_count").notNull().default(0),
  qualifiedCount: integer("qualified_count").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  apiCalls: integer("api_calls").notNull().default(0),
  error: text("error"),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  createdAt: createdAt(),
  /** Which provider this job searches. */
  source: businessSourceEnum("source").notNull().default("yelp"),
  /** Google jobs only: terms × zips, accepted types, saturated and failed searches. */
  plan: jsonb("plan").$type<GooglePlan>(),
  queriesTotal: integer("queries_total").notNull().default(0),
  /** Index of the next search to run (Google jobs). */
  queriesDone: integer("queries_done").notNull().default(0),
  /** Rows inserted by this job. */
  newCount: integer("new_count").notNull().default(0),
  /** Places attached to an existing Yelp/Trustpilot row. */
  matchedCount: integer("matched_count").notNull().default(0),
  /** Slice lease: a runner holds the job until this time. */
  leaseExpiresAt: ts("lease_expires_at"),
});

// ---------------------------------------------------------------- businesses

/**
 * Expression behind `businesses.website_domain`. Mirrors WEBSITE_DOMAIN_RE in
 * src/lib/domain.ts: optional scheme, optional userinfo, optional "www.",
 * then a dotted host (captured), optional trailing dot and port, then a path
 * delimiter or the end. Anything else yields NULL.
 */
const WEBSITE_DOMAIN_SQL = String.raw`substring(lower(btrim("website")) from '^(?:[a-z][a-z0-9+.-]*://)?(?:[^/?#@]*@)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?::[0-9]*)?(?:[/?#]|$)')`;

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for Trustpilot rows. */
    yelpId: text("yelp_id").unique(),
    source: businessSourceEnum("source").notNull().default("yelp"),
    /** Trustpilot slug (e.g. "acme.com"); null for Yelp rows. */
    trustpilotId: text("trustpilot_id").unique(),
    /** Domain-like slug used for favicon/Trustpilot links. */
    slug: text("slug"),
    email: text("email"),
    logoUrl: text("logo_url"),
    socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
    /** Review velocity: reviews in the last 30 days. */
    reviewsLast30d: integer("reviews_last_30d").notNull().default(0),
    trustScore: numeric("trust_score", { precision: 3, scale: 1 }),
    aiSummary: text("ai_summary"),
    hasMetaAds: boolean("has_meta_ads").notNull().default(false),
    subcategory: text("subcategory"),
    lastScrapedAt: ts("last_scraped_at"),
    /** Last failed discovery scrape (back-off for permanently failing rows); null after a success. */
    scrapeFailedAt: ts("scrape_failed_at"),
    /** Consecutive failed discovery scrapes; reset to 0 on success. */
    scrapeAttempts: integer("scrape_attempts").notNull().default(0),
    yelpAlias: text("yelp_alias"),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    phone: text("phone"),
    phoneDigits: text("phone_digits"),
    displayPhone: text("display_phone"),
    website: text("website"),
    yelpUrl: text("yelp_url"),
    imageUrl: text("image_url"),
    rating: numeric("rating", { precision: 2, scale: 1 }),
    reviewCount: integer("review_count").notNull().default(0),
    price: text("price"),
    categories: jsonb("categories").$type<{ alias: string; title: string }[]>().notNull(),
    primaryCategory: text("primary_category"),
    isClosed: boolean("is_closed").notNull().default(false),
    isClaimed: boolean("is_claimed"),
    address1: text("address1"),
    address2: text("address2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    country: text("country"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    distanceM: real("distance_m"),
    hours: jsonb("hours"),
    photos: jsonb("photos").$type<string[]>(),
    transactions: jsonb("transactions").$type<string[]>(),
    raw: jsonb("raw").notNull(),
    enrichedAt: ts("enriched_at"),
    qualification: qualificationEnum("qualification").notNull().default("review"),
    score: integer("score").notNull().default(0),
    rejectionReasons: text("rejection_reasons").array().notNull().default(sql`'{}'::text[]`),
    qualifiedAt: ts("qualified_at"),
    status: businessStatusEnum("status").notNull().default("new"),
    ownerName: text("owner_name"),
    ownerEmail: text("owner_email"),
    notes: text("notes"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    doNotCall: boolean("do_not_call").notNull().default(false),
    doNotEmail: boolean("do_not_email").notNull().default(false),
    lastContactedAt: ts("last_contacted_at"),
    nextFollowUpAt: ts("next_follow_up_at"),
    sourceJobId: uuid("source_job_id").references(() => searchJobs.id, { onDelete: "set null" }),
    searchCategory: text("search_category"),
    searchLocation: text("search_location"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Google Places place id; null for rows Google never returned. */
    googlePlaceId: text("google_place_id").unique(),
    /** places.googleMapsUri */
    googleMapsUrl: text("google_maps_url"),
    /**
     * Host of `website` without scheme, "www.", port or path, lower case; null
     * when empty or not a host. Generated by Postgres so every writer keeps it
     * in step; `websiteDomain()` in src/lib/domain.ts applies the same pattern.
     */
    websiteDomain: text("website_domain").generatedAlwaysAs(sql.raw(WEBSITE_DOMAIN_SQL)),
  },
  (t) => [
    index("businesses_phone_digits_idx").on(t.phoneDigits),
    index("businesses_name_normalized_idx").on(t.nameNormalized),
    index("businesses_city_state_idx").on(t.city, t.state),
    index("businesses_status_idx").on(t.status),
    index("businesses_qualification_idx").on(t.qualification),
    index("businesses_source_job_idx").on(t.sourceJobId),
    index("businesses_source_idx").on(t.source),
    index("businesses_reviews_last_30d_idx").on(t.reviewsLast30d),
    index("businesses_website_domain_idx").on(t.websiteDomain),
    index("businesses_email_lower_idx").on(sql`lower(${t.email})`),
  ],
);

// ---------------------------------------------------------------- activities

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    outcome: text("outcome"),
    body: text("body").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    campaignType: text("campaign_type"),
    campaignId: uuid("campaign_id"),
    agent: text("agent"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("activities_business_occurred_idx").on(t.businessId, t.occurredAt.desc())],
);

// ---------------------------------------------------------------- qualification_rules

export const qualificationRules = pgTable("qualification_rules", {
  id: integer("id").primaryKey().default(1),
  minRating: numeric("min_rating", { precision: 2, scale: 1 }).notNull().default("3.5"),
  minReviews: integer("min_reviews").notNull().default(5),
  maxReviews: integer("max_reviews"),
  requirePhone: boolean("require_phone").notNull().default(true),
  rejectClosed: boolean("reject_closed").notNull().default(true),
  rejectChains: boolean("reject_chains").notNull().default(true),
  chainPatterns: text("chain_patterns").array().notNull().default(sql`'{}'::text[]`),
  categoryStrict: boolean("category_strict").notNull().default(true),
  distanceTolerancePct: integer("distance_tolerance_pct").notNull().default(10),
  multiLocationThreshold: integer("multi_location_threshold").notNull().default(3),
  reviewScoreBelow: integer("review_score_below").notNull().default(40),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- call campaigns

export const callCampaigns = pgTable("call_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  status: campaignStatusEnum("status").notNull().default("draft"),
  /** human: agents work the queue in the dialer. ai: the ElevenLabs agent places the calls. */
  mode: callModeEnum("mode").notNull().default("human"),
  /** The campaign's own ElevenLabs agent (a copy of the template in ELEVENLABS_AGENT_ID); null → the shared template places the calls. */
  elevenlabsAgentId: text("elevenlabs_agent_id"),
  script: text("script").notNull().default(""),
  dailyCap: integer("daily_cap"),
  callingHoursStart: time("calling_hours_start"),
  callingHoursEnd: time("calling_hours_end"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  maxConcurrentAgents: integer("max_concurrent_agents").notNull().default(5),
  maxAttempts: integer("max_attempts").notNull().default(3),
  pauseReason: pauseReasonEnum("pause_reason"),
  autoResume: boolean("auto_resume").notNull().default(true),
  pausedAt: ts("paused_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const callQueueItems = pgTable(
  "call_queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => callCampaigns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    state: queueStateEnum("state").notNull().default("pending"),
    claimedBy: text("claimed_by"),
    claimedAt: ts("claimed_at"),
    leaseExpiresAt: ts("lease_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    lastOutcome: callOutcomeEnum("last_outcome"),
    lastOutcomeAt: ts("last_outcome_at"),
    callbackAt: ts("callback_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("call_queue_items_campaign_business_uq").on(t.campaignId, t.businessId),
    index("call_queue_items_campaign_state_position_idx").on(t.campaignId, t.state, t.position),
  ],
);

// ---------------------------------------------------------------- AI calls (ElevenLabs)

/** One outbound call placed by the ElevenLabs agent for a queue item. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => callCampaigns.id, { onDelete: "cascade" }),
    queueItemId: uuid("queue_item_id").references(() => callQueueItems.id, { onDelete: "set null" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    toNumber: text("to_number").notNull(),
    status: aiCallStatusEnum("status").notNull().default("initiated"),
    /** ElevenLabs conversation id (set once the call is accepted). */
    conversationId: text("conversation_id").unique(),
    callSid: text("call_sid"),
    outcome: callOutcomeEnum("outcome"),
    summary: text("summary"),
    /** [{ role, message }] turns, trimmed. */
    transcript: jsonb("transcript").$type<{ role: string; message: string }[]>(),
    /** Data collection results keyed by field id (value + rationale). */
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
    durationSecs: integer("duration_secs"),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
  },
  (t) => [
    index("ai_calls_campaign_started_idx").on(t.campaignId, t.startedAt.desc()),
    index("ai_calls_business_idx").on(t.businessId),
  ],
);

// ---------------------------------------------------------------- email campaigns

export const emailCampaigns = pgTable("email_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  dailyCap: integer("daily_cap").notNull().default(50),
  pauseReason: pauseReasonEnum("pause_reason"),
  pausedAt: ts("paused_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const emailSteps = pgTable(
  "email_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    /** Delay after the previous step; step 1 uses 0. */
    delayDays: integer("delay_days").notNull().default(0),
  },
  (t) => [unique("email_steps_campaign_order_uq").on(t.campaignId, t.stepOrder)],
);

export const emailEnrollments = pgTable(
  "email_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    state: enrollmentStateEnum("state").notNull().default("active"),
    currentStep: integer("current_step").notNull().default(0),
    nextSendAt: ts("next_send_at"),
    lastSentAt: ts("last_sent_at"),
    enrolledAt: ts("enrolled_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("email_enrollments_campaign_business_uq").on(t.campaignId, t.businessId)],
);

export const emailMessages = pgTable("email_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  enrollmentId: uuid("enrollment_id")
    .notNull()
    .references(() => emailEnrollments.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => emailSteps.id, { onDelete: "set null" }),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  bodyRendered: text("body_rendered").notNull(),
  status: messageStatusEnum("status").notNull(),
  providerId: text("provider_id"),
  error: text("error"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- discovery (v2)

export const businessRelations = pgTable(
  "business_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceBusinessId: uuid("source_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    targetBusinessId: uuid("target_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull().default("similar"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("business_relations_source_target_uq").on(t.sourceBusinessId, t.targetBusinessId),
    index("business_relations_target_idx").on(t.targetBusinessId),
  ],
);

export const reviewSnapshots = pgTable(
  "review_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    totalReviews: integer("total_reviews").notNull().default(0),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [index("review_snapshots_business_captured_idx").on(t.businessId, t.capturedAt.desc())],
);

// ---------------------------------------------------------------- API usage (Google)

/** Requests per provider per calendar month (UTC), for spend caps. */
export const apiUsage = pgTable(
  "api_usage",
  {
    provider: text("provider").notNull(), // "google_places" | "google_geocoding"
    period: text("period").notNull(), // "YYYY-MM", UTC
    requests: integer("requests").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.period] })],
);

// ---------------------------------------------------------------- leads (v2)

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Supabase auth user id. No FK: the auth schema is not ours. */
    userId: uuid("user_id").notNull(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    status: leadStatusEnum("status").notNull().default("queued"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("leads_user_business_uq").on(t.userId, t.businessId),
    index("leads_user_status_idx").on(t.userId, t.status),
  ],
);

// ---------------------------------------------------------------- row types

export type SearchJob = typeof searchJobs.$inferSelect;
export type NewSearchJob = typeof searchJobs.$inferInsert;
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type QualificationRules = typeof qualificationRules.$inferSelect;
export type CallCampaign = typeof callCampaigns.$inferSelect;
export type NewCallCampaign = typeof callCampaigns.$inferInsert;
export type CallQueueItem = typeof callQueueItems.$inferSelect;
export type NewCallQueueItem = typeof callQueueItems.$inferInsert;
export type AiCall = typeof aiCalls.$inferSelect;
export type NewAiCall = typeof aiCalls.$inferInsert;
export type EmailCampaign = typeof emailCampaigns.$inferSelect;
export type NewEmailCampaign = typeof emailCampaigns.$inferInsert;
export type EmailStep = typeof emailSteps.$inferSelect;
export type NewEmailStep = typeof emailSteps.$inferInsert;
export type EmailEnrollment = typeof emailEnrollments.$inferSelect;
export type NewEmailEnrollment = typeof emailEnrollments.$inferInsert;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type NewEmailMessage = typeof emailMessages.$inferInsert;
export type BusinessRelation = typeof businessRelations.$inferSelect;
export type ReviewSnapshot = typeof reviewSnapshots.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type ApiUsage = typeof apiUsage.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
