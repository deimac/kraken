CREATE TABLE "plays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"media_type" text NOT NULL,
	"played_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plays_media_type_check" CHECK ("plays"."media_type" in ('image', 'video'))
);
--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plays" ADD CONSTRAINT "plays_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plays_campaign_played_idx" ON "plays" USING btree ("campaign_id","played_at");--> statement-breakpoint
CREATE INDEX "plays_partner_played_idx" ON "plays" USING btree ("partner_id","played_at");