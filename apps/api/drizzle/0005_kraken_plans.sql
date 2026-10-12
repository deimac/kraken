-- Midora was renamed to Kraken Ads: rename in place, no data is copied or dropped.
ALTER TABLE "midora_plans" RENAME TO "kraken_plans";--> statement-breakpoint
ALTER INDEX "midora_plans_pkey" RENAME TO "kraken_plans_pkey";--> statement-breakpoint
ALTER TABLE "kraken_plans" RENAME CONSTRAINT "midora_plans_price_check" TO "kraken_plans_price_check";--> statement-breakpoint
ALTER TABLE "partners" RENAME COLUMN "midora_plan_id" TO "kraken_plan_id";--> statement-breakpoint
ALTER TABLE "partners" RENAME CONSTRAINT "partners_midora_plan_id_midora_plans_id_fk" TO "partners_kraken_plan_id_kraken_plans_id_fk";
