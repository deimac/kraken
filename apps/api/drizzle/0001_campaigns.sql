CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisers_source_check" CHECK ("advertisers"."source" in ('manual', 'self_signup'))
);
--> statement-breakpoint
CREATE TABLE "campaign_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_reviews_action_check" CHECK ("campaign_reviews"."action" in ('submitted', 'approved', 'changes_requested', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid,
	"advertiser_id" uuid,
	"plan_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"frequency_level" text NOT NULL,
	"current_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_kind_check" CHECK ("campaigns"."kind" in ('commercial', 'institutional')),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft', 'pending_review', 'changes_requested', 'approved', 'cancelled')),
	CONSTRAINT "campaigns_frequency_check" CHECK ("campaigns"."frequency_level" in ('low', 'medium', 'high')),
	CONSTRAINT "campaigns_period_check" CHECK ("campaigns"."ends_at" > "campaigns"."starts_at"),
	CONSTRAINT "campaigns_scope_check" CHECK (("campaigns"."kind" = 'commercial' and "campaigns"."partner_id" is not null and "campaigns"."advertiser_id" is not null and "campaigns"."plan_id" is not null)
       or ("campaigns"."kind" = 'institutional' and "campaigns"."partner_id" is null and "campaigns"."advertiser_id" is null and "campaigns"."plan_id" is null))
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid,
	"campaign_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"media_type" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_ms" integer,
	"sha256" text NOT NULL,
	"display_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_type_check" CHECK ("media"."media_type" in ('image', 'video')),
	CONSTRAINT "media_display_check" CHECK (("media"."media_type" = 'image') = ("media"."display_seconds" is not null))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"frequency_level" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_frequency_check" CHECK ("plans"."frequency_level" in ('low', 'medium', 'high'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "advertiser_id" uuid;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD CONSTRAINT "campaign_reviews_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reviews" ADD CONSTRAINT "campaign_reviews_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_current_media_id_media_id_fk" FOREIGN KEY ("current_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "advertisers_partner_idx" ON "advertisers" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "campaign_reviews_campaign_idx" ON "campaign_reviews" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_partner_status_idx" ON "campaigns" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_advertiser_idx" ON "campaigns" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "media_campaign_idx" ON "media" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "plans_partner_idx" ON "plans" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_advertiser_scope_check" CHECK (("users"."role" = 'advertiser') = ("users"."advertiser_id" is not null));