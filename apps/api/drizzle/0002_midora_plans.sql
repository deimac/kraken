CREATE TABLE "midora_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "midora_plans_price_check" CHECK ("midora_plans"."price_cents" is null or "midora_plans"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "midora_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_midora_plan_id_midora_plans_id_fk" FOREIGN KEY ("midora_plan_id") REFERENCES "public"."midora_plans"("id") ON DELETE restrict ON UPDATE no action;