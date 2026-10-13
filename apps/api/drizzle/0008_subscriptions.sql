ALTER TABLE "campaign_reviews" DROP CONSTRAINT "campaign_reviews_action_check";--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_status_check";--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD COLUMN "media_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "payment_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "status" text DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "original_name" text;--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD CONSTRAINT "campaign_reviews_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The current media of each campaign becomes its piece: approved only if the partner had approved the campaign
-- (or it is Kraken Ads institutional); otherwise it still waits for review. Replaced media stay as removed history.
UPDATE "media" m SET "status" = CASE
  WHEN EXISTS (SELECT 1 FROM "campaigns" c WHERE c."current_media_id" = m."id" AND (c."status" = 'approved' OR c."kind" = 'institutional')) THEN 'approved'
  WHEN EXISTS (SELECT 1 FROM "campaigns" c WHERE c."current_media_id" = m."id") THEN 'pending_review'
  ELSE 'removed' END;--> statement-breakpoint
-- Campaigns become subscriptions: approved ones stay on air, drafts/reviews pause, cancelled stay cancelled.
UPDATE "campaigns" SET "status" = CASE "status" WHEN 'approved' THEN 'active' WHEN 'cancelled' THEN 'cancelled' ELSE 'paused' END;--> statement-breakpoint
UPDATE "campaigns" c SET "price_cents" = p."price_cents" FROM "plans" p WHERE p."id" = c."plan_id";--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD CONSTRAINT "campaign_reviews_action_check" CHECK ("campaign_reviews"."action" in ('submitted', 'approved', 'changes_requested', 'cancelled', 'created', 'paused', 'resumed', 'payment',
        'piece_added', 'piece_submitted', 'piece_approved', 'piece_rejected', 'piece_removed'));--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_payment_check" CHECK ("campaigns"."payment_status" in ('pending', 'paid'));--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('active', 'paused', 'cancelled'));--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_status_check" CHECK ("media"."status" in ('pending_review', 'approved', 'rejected', 'removed'));