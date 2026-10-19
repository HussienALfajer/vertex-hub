ALTER TABLE "retainer_amendments" DROP CONSTRAINT "retainer_amendments_scope_check";--> statement-breakpoint
ALTER TABLE "retainer_amendments" ALTER COLUMN "scope" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."amendment_scope";--> statement-breakpoint
CREATE TYPE "public"."amendment_scope" AS ENUM('cycle', 'onward');--> statement-breakpoint
ALTER TABLE "retainer_amendments" ALTER COLUMN "scope" SET DATA TYPE "public"."amendment_scope" USING "scope"::"public"."amendment_scope";--> statement-breakpoint
ALTER TABLE "retainer_amendments" ALTER COLUMN "effective_cycle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ALTER COLUMN "effective_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_charges" ALTER COLUMN "cycle_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_charges" ALTER COLUMN "cycle_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "start_cycle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "cycles" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "end_date" SET NOT NULL;