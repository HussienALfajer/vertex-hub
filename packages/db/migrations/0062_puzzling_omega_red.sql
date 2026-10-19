ALTER TABLE "retainer_amendments" DROP CONSTRAINT "retainer_amendments_effective_month_check";--> statement-breakpoint
ALTER TABLE "retainer_charges" DROP CONSTRAINT "retainer_charges_month_check";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP CONSTRAINT "retainer_terms_months_check";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP CONSTRAINT "retainer_terms_start_month_check";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP CONSTRAINT "retainer_terms_end_month_check";--> statement-breakpoint
DROP INDEX "retainer_charges_retainer_month_idx";--> statement-breakpoint
DROP INDEX "retainer_charges_monthly_idx";--> statement-breakpoint
DROP INDEX "retainer_cycles_retainer_month_idx";--> statement-breakpoint
ALTER TABLE "retainer_amendments" DROP COLUMN "effective_month";--> statement-breakpoint
ALTER TABLE "retainer_charges" DROP COLUMN "month";--> statement-breakpoint
ALTER TABLE "retainer_cycles" DROP COLUMN "month";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP COLUMN "start_month";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP COLUMN "months";--> statement-breakpoint
ALTER TABLE "retainer_terms" DROP COLUMN "end_month";