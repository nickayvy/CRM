CREATE TYPE "public"."ai_call_status" AS ENUM('initiated', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."call_mode" AS ENUM('human', 'ai');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"queue_item_id" uuid,
	"business_id" uuid NOT NULL,
	"to_number" text NOT NULL,
	"status" "ai_call_status" DEFAULT 'initiated' NOT NULL,
	"conversation_id" text,
	"call_sid" text,
	"outcome" "call_outcome",
	"summary" text,
	"transcript" jsonb,
	"analysis" jsonb,
	"duration_secs" integer,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "ai_calls_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "call_campaigns" ADD COLUMN "mode" "call_mode" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_campaign_id_call_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."call_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_queue_item_id_call_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."call_queue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_campaign_started_idx" ON "ai_calls" USING btree ("campaign_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_calls_business_idx" ON "ai_calls" USING btree ("business_id");