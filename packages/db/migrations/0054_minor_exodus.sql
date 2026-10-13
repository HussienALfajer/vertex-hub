ALTER TYPE "public"."amendment_scope" ADD VALUE 'cycle' BEFORE 'onward';--> statement-breakpoint
ALTER TABLE "retainer_amendments" ALTER COLUMN "effective_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_charges" ALTER COLUMN "month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ALTER COLUMN "month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "start_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "months" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ALTER COLUMN "end_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD COLUMN "effective_cycle" integer;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "cycle_number" integer;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "cycle_start" date;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD COLUMN "number" integer;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD COLUMN "backdated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD COLUMN "untracked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD COLUMN "start_cycle" integer;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD COLUMN "cycles" integer;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "retainers" ADD COLUMN "cycles_from" date;--> statement-breakpoint
CREATE INDEX "retainer_charges_retainer_cycle_idx" ON "retainer_charges" USING btree ("retainer_id","cycle_number");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_charges_monthly_cycle_idx" ON "retainer_charges" USING btree ("retainer_id","cycle_number") WHERE "retainer_charges"."kind" = 'monthly' and "retainer_charges"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_cycles_retainer_number_idx" ON "retainer_cycles" USING btree ("retainer_id","number");--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_effective_cycle_check" CHECK ("retainer_amendments"."effective_cycle" >= 1);--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_cycle_check" CHECK ("retainer_charges"."cycle_number" >= 1);--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD CONSTRAINT "retainer_cycles_number_check" CHECK ("retainer_cycles"."number" >= 1);--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD CONSTRAINT "retainer_cycles_untracked_check" CHECK (not "retainer_cycles"."untracked" or "retainer_cycles"."backdated");--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_cycles_check" CHECK ("retainer_terms"."cycles" between 1 and 36);--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_start_cycle_check" CHECK ("retainer_terms"."start_cycle" >= 1);--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_end_date_check" CHECK ("retainer_terms"."end_date" >= "retainer_terms"."start_date");