ALTER TYPE "public"."business_source" ADD VALUE 'google';--> statement-breakpoint
CREATE TABLE "api_usage" (
	"provider" text NOT NULL,
	"period" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_usage_provider_period_pk" PRIMARY KEY("provider","period")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_place_id" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "google_maps_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "website_domain" text GENERATED ALWAYS AS (substring(lower(btrim("website")) from '^(?:[a-z][a-z0-9+.-]*://(?:[^/?#@]*@)?)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\.?(?::[0-9]*)?(?:[/?#]|$)')) STORED;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "source" "business_source" DEFAULT 'yelp' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "queries_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "queries_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "new_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "matched_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "search_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "businesses_website_domain_idx" ON "businesses" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "businesses_email_lower_idx" ON "businesses" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_google_place_id_unique" UNIQUE("google_place_id");