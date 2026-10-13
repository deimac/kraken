ALTER TABLE "partners" ADD COLUMN "tv_code_hash" text;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_tv_code_hash_unique" UNIQUE("tv_code_hash");