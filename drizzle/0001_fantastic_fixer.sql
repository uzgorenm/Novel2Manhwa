CREATE TABLE "stripe_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "chapter_credits_remaining" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_stripe_event_created_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_processed_idx" ON "stripe_webhook_events" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_owner_idempotency_uidx" ON "generation_jobs" USING btree ("user_id","idempotency_key");