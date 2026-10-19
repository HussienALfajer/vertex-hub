ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_source_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_retainer_cycle_id_retainer_cycles_id_fk";
--> statement-breakpoint
DROP INDEX "invoice_lines_retainer_cycle_id_idx";--> statement-breakpoint
DROP INDEX "invoice_lines_live_retainer_cycle_idx";--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP COLUMN "retainer_cycle_id";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_check" CHECK (num_nonnulls("invoice_lines"."milestone_id", "invoice_lines"."retainer_charge_id", "invoice_lines"."extra_work_item_id") <= 1);