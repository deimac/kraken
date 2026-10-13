ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_current_media_id_media_id_fk";
--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "current_media_id";