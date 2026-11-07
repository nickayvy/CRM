CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'email', 'status_change', 'system');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('new', 'contacted', 'interested', 'callback', 'not_interested', 'do_not_call', 'converted');--> statement-breakpoint
CREATE TYPE "public"."call_outcome" AS ENUM('no_answer', 'voicemail', 'busy', 'interested', 'not_interested', 'callback', 'wrong_number', 'do_not_call');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'running', 'paused', 'completed');--> statement-breakpoint
CREATE TYPE "public"."enrollment_state" AS ENUM('active', 'completed', 'replied', 'unsubscribed', 'bounced', 'paused');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'failed', 'dry_run');--> statement-breakpoint
CREATE TYPE "public"."pause_reason" AS ENUM('manual', 'daily_cap', 'outside_hours', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."qualification" AS ENUM('qualified', 'review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."queue_state" AS ENUM('pending', 'claimed', 'completed', 'skipped', 'callback');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"outcome" text,
	"body" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campaign_type" text,
	"campaign_id" uuid,
	"agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"yelp_id" text NOT NULL,
	"yelp_alias" text,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"phone" text,
	"phone_digits" text,
	"display_phone" text,
	"website" text,
	"yelp_url" text,
	"image_url" text,
	"rating" numeric(2, 1),
	"review_count" integer DEFAULT 0 NOT NULL,
	"price" text,
	"categories" jsonb NOT NULL,
	"primary_category" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"is_claimed" boolean,
	"address1" text,
	"address2" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text,
	"latitude" double precision,
	"longitude" double precision,
	"distance_m" real,
	"hours" jsonb,
	"photos" jsonb,
	"transactions" jsonb,
	"raw" jsonb NOT NULL,
	"enriched_at" timestamp with time zone,
	"qualification" "qualification" DEFAULT 'review' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"rejection_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"qualified_at" timestamp with time zone,
	"status" "business_status" DEFAULT 'new' NOT NULL,
	"owner_name" text,
	"owner_email" text,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"do_not_call" boolean DEFAULT false NOT NULL,
	"do_not_email" boolean DEFAULT false NOT NULL,
	"last_contacted_at" timestamp with time zone,
	"next_follow_up_at" timestamp with time zone,
	"source_job_id" uuid,
	"search_category" text,
	"search_location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_yelp_id_unique" UNIQUE("yelp_id")
);
--> statement-breakpoint
CREATE TABLE "call_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"daily_cap" integer,
	"calling_hours_start" time,
	"calling_hours_end" time,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"max_concurrent_agents" integer DEFAULT 5 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"pause_reason" "pause_reason",
	"auto_resume" boolean DEFAULT true NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_queue_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"state" "queue_state" DEFAULT 'pending' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_outcome" "call_outcome",
	"last_outcome_at" timestamp with time zone,
	"callback_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_queue_items_campaign_business_uq" UNIQUE("campaign_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"daily_cap" integer DEFAULT 50 NOT NULL,
	"pause_reason" "pause_reason",
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"state" "enrollment_state" DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_send_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_enrollments_campaign_business_uq" UNIQUE("campaign_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" uuid,
	"business_id" uuid NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body_rendered" text NOT NULL,
	"status" "message_status" NOT NULL,
	"provider_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "email_steps_campaign_order_uq" UNIQUE("campaign_id","step_order")
);
--> statement-breakpoint
CREATE TABLE "qualification_rules" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"min_rating" numeric(2, 1) DEFAULT '3.5' NOT NULL,
	"min_reviews" integer DEFAULT 5 NOT NULL,
	"max_reviews" integer,
	"require_phone" boolean DEFAULT true NOT NULL,
	"reject_closed" boolean DEFAULT true NOT NULL,
	"reject_chains" boolean DEFAULT true NOT NULL,
	"chain_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_strict" boolean DEFAULT true NOT NULL,
	"distance_tolerance_pct" integer DEFAULT 10 NOT NULL,
	"multi_location_threshold" integer DEFAULT 3 NOT NULL,
	"review_score_below" integer DEFAULT 40 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text,
	"location" text NOT NULL,
	"category_aliases" text[] NOT NULL,
	"radius_m" integer DEFAULT 20000 NOT NULL,
	"max_results" integer DEFAULT 200 NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"qualified_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_source_job_id_search_jobs_id_fk" FOREIGN KEY ("source_job_id") REFERENCES "public"."search_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_queue_items" ADD CONSTRAINT "call_queue_items_campaign_id_call_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."call_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_queue_items" ADD CONSTRAINT "call_queue_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_enrollments" ADD CONSTRAINT "email_enrollments_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_enrollments" ADD CONSTRAINT "email_enrollments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_enrollment_id_email_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."email_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_step_id_email_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."email_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_steps" ADD CONSTRAINT "email_steps_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_business_occurred_idx" ON "activities" USING btree ("business_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "businesses_phone_digits_idx" ON "businesses" USING btree ("phone_digits");--> statement-breakpoint
CREATE INDEX "businesses_name_normalized_idx" ON "businesses" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "businesses_city_state_idx" ON "businesses" USING btree ("city","state");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "businesses_qualification_idx" ON "businesses" USING btree ("qualification");--> statement-breakpoint
CREATE INDEX "businesses_source_job_idx" ON "businesses" USING btree ("source_job_id");--> statement-breakpoint
CREATE INDEX "call_queue_items_campaign_state_position_idx" ON "call_queue_items" USING btree ("campaign_id","state","position");