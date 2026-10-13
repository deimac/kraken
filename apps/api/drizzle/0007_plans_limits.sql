ALTER TABLE "plans" ADD COLUMN "max_videos" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_images" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_video_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "period_months" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_limits_check" CHECK ("plans"."max_videos" between 0 and 50 and "plans"."max_images" between 0 and 50 and "plans"."max_videos" + "plans"."max_images" > 0);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_video_seconds_check" CHECK ("plans"."max_video_seconds" between 5 and 300);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_price_check" CHECK ("plans"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_period_check" CHECK ("plans"."period_months" in (1, 3, 6, 12));