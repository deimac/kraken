ALTER TABLE "advertisers" ADD COLUMN "person_type" text DEFAULT 'pj' NOT NULL;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "document" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "complement" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "district" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "advertisers" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "advertisers_partner_document_uq" ON "advertisers" USING btree ("partner_id","document") WHERE "advertisers"."document" is not null;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_person_type_check" CHECK ("advertisers"."person_type" in ('pf', 'pj'));