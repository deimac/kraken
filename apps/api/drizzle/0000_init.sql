CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"weight_low" integer DEFAULT 1 NOT NULL,
	"weight_medium" integer DEFAULT 2 NOT NULL,
	"weight_high" integer DEFAULT 3 NOT NULL,
	"default_image_seconds" integer DEFAULT 10 NOT NULL,
	"show_institutional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_slug_unique" UNIQUE("slug"),
	CONSTRAINT "partners_status_check" CHECK ("partners"."status" in ('active', 'inactive')),
	CONSTRAINT "partners_weights_check" CHECK ("partners"."weight_low" > 0 and "partners"."weight_medium" > 0 and "partners"."weight_high" > 0),
	CONSTRAINT "partners_image_seconds_check" CHECK ("partners"."default_image_seconds" between 1 and 3600)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('admin', 'partner_user', 'advertiser', 'player')),
	CONSTRAINT "users_partner_scope_check" CHECK (("users"."role" = 'admin') = ("users"."partner_id" is null))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_player_per_partner" ON "users" USING btree ("partner_id") WHERE "users"."role" = 'player';--> statement-breakpoint
CREATE INDEX "users_partner_idx" ON "users" USING btree ("partner_id");