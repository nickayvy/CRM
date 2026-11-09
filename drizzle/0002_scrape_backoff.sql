ALTER TABLE "businesses" ADD COLUMN "scrape_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "scrape_attempts" integer DEFAULT 0 NOT NULL;