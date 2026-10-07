CREATE TYPE "public"."retainer_charge_kind" AS ENUM('monthly', 'addition', 'credit', 'termination_fee');--> statement-breakpoint
CREATE TYPE "public"."retainer_charge_status" AS ENUM('pending', 'cancelled', 'settled_outside');--> statement-breakpoint
ALTER TYPE "public"."invoice_origin" ADD VALUE 'retainer_amendment';--> statement-breakpoint
ALTER TYPE "public"."invoice_origin" ADD VALUE 'retainer_termination';--> statement-breakpoint
CREATE TABLE "retainer_charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"month" date NOT NULL,
	"kind" "retainer_charge_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "retainer_charge_status" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_charges_amount_check" CHECK (case when "retainer_charges"."kind" = 'credit' then "retainer_charges"."amount_minor" < 0 else "retainer_charges"."amount_minor" >= 0 end),
	CONSTRAINT "retainer_charges_month_check" CHECK (extract(day from "retainer_charges"."month") = 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_source_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "retainer_charge_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_charges_retainer_month_idx" ON "retainer_charges" USING btree ("retainer_id","month");--> statement-breakpoint
CREATE INDEX "retainer_charges_status_idx" ON "retainer_charges" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_charges_monthly_idx" ON "retainer_charges" USING btree ("retainer_id","month") WHERE "retainer_charges"."kind" = 'monthly' and "retainer_charges"."status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_retainer_charge_id_retainer_charges_id_fk" FOREIGN KEY ("retainer_charge_id") REFERENCES "public"."retainer_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_retainer_charge_id_idx" ON "invoice_lines" USING btree ("retainer_charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_live_retainer_charge_idx" ON "invoice_lines" USING btree ("retainer_charge_id") WHERE "invoice_lines"."holds_source";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_check" CHECK (num_nonnulls("invoice_lines"."milestone_id", coalesce("invoice_lines"."retainer_charge_id", "invoice_lines"."retainer_cycle_id"), "invoice_lines"."extra_work_item_id") <= 1);