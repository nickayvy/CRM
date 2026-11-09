CREATE TYPE "public"."business_source" AS ENUM('yelp', 'trustpilot');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('queued', 'contacted', 'callback', 'success', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "business_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_business_id" uuid NOT NULL,
	"target_business_id" uuid NOT NULL,
	"relation_type" text DEFAULT 'similar' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_relations_source_target_uq" UNIQUE("source_business_id","target_business_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "lead_status" DEFAULT 'queued' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_user_business_uq" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "review_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"total_reviews" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "yelp_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "source" "business_source" DEFAULT 'yelp' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "trustpilot_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "reviews_last_30d" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "trust_score" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "has_meta_ads" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "last_scraped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_relations" ADD CONSTRAINT "business_relations_source_business_id_businesses_id_fk" FOREIGN KEY ("source_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_relations" ADD CONSTRAINT "business_relations_target_business_id_businesses_id_fk" FOREIGN KEY ("target_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_snapshots" ADD CONSTRAINT "review_snapshots_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_relations_target_idx" ON "business_relations" USING btree ("target_business_id");--> statement-breakpoint
CREATE INDEX "leads_user_status_idx" ON "leads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "review_snapshots_business_captured_idx" ON "review_snapshots" USING btree ("business_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "businesses_source_idx" ON "businesses" USING btree ("source");--> statement-breakpoint
CREATE INDEX "businesses_reviews_last_30d_idx" ON "businesses" USING btree ("reviews_last_30d");--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_trustpilot_id_unique" UNIQUE("trustpilot_id");