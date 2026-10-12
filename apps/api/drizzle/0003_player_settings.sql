ALTER TABLE "partners" ADD COLUMN "transition" text DEFAULT 'fade' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "transition_ms" integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_transition_check" CHECK ("partners"."transition" in ('fade', 'slide', 'cut'));--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_transition_ms_check" CHECK ("partners"."transition_ms" between 0 and 3000);