CREATE TYPE "public"."amendment_kind" AS ENUM('change', 'reschedule', 'quote_renewal');--> statement-breakpoint
CREATE TYPE "public"."amendment_scope" AS ENUM('month', 'onward');--> statement-breakpoint
CREATE TYPE "public"."amendment_status" AS ENUM('pending_approval', 'scheduled', 'applied', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_amendment_pending' BEFORE 'quote_approval_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_amendment_decided' BEFORE 'quote_approval_requested';--> statement-breakpoint
CREATE TABLE "retainer_amendment_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"amendment_id" uuid NOT NULL,
	"kind" "deliverable_kind" NOT NULL,
	"label" text,
	"quantity_delta" integer,
	"quantity" integer,
	"revision_limit" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_amendment_lines_delta_check" CHECK ("retainer_amendment_lines"."quantity_delta" <> 0 and "retainer_amendment_lines"."quantity_delta" between -999 and 999),
	CONSTRAINT "retainer_amendment_lines_quantity_check" CHECK ("retainer_amendment_lines"."quantity" between 0 and 999),
	CONSTRAINT "retainer_amendment_lines_revision_limit_check" CHECK ("retainer_amendment_lines"."revision_limit" between 0 and 20),
	CONSTRAINT "retainer_amendment_lines_label_check" CHECK ("retainer_amendment_lines"."kind" <> 'other' or "retainer_amendment_lines"."label" is not null)
);
--> statement-breakpoint
CREATE TABLE "retainer_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" "amendment_kind" NOT NULL,
	"scope" "amendment_scope",
	"effective_month" date NOT NULL,
	"amount_delta_minor" bigint DEFAULT 0 NOT NULL,
	"schedule" jsonb,
	"money_delta_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"status" "amendment_status" NOT NULL,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_amendments_effective_month_check" CHECK (extract(day from "retainer_amendments"."effective_month") = 1),
	CONSTRAINT "retainer_amendments_scope_check" CHECK (case "retainer_amendments"."kind" when 'change' then "retainer_amendments"."scope" is not null when 'quote_renewal' then "retainer_amendments"."scope" = 'onward' else "retainer_amendments"."scope" is null end),
	CONSTRAINT "retainer_amendments_reason_check" CHECK (char_length("retainer_amendments"."reason") between 1 and 500),
	CONSTRAINT "retainer_amendments_note_check" CHECK (char_length("retainer_amendments"."decision_note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_price_check";--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "amendment_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "settle_note" text;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "split_from_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD COLUMN "amendment_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_amendment_lines" ADD CONSTRAINT "retainer_amendment_lines_amendment_id_retainer_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."retainer_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_amendment_lines_amendment_id_idx" ON "retainer_amendment_lines" USING btree ("amendment_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_amendment_lines_kind_label_idx" ON "retainer_amendment_lines" USING btree ("amendment_id","kind",lower(coalesce("label", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_amendments_retainer_number_idx" ON "retainer_amendments" USING btree ("retainer_id","number");--> statement-breakpoint
CREATE INDEX "retainer_amendments_status_idx" ON "retainer_amendments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "retainer_amendments_created_by_id_idx" ON "retainer_amendments" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "retainer_amendments_decided_by_id_idx" ON "retainer_amendments" USING btree ("decided_by_id");--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_amendment_id_retainer_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."retainer_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_split_from_id_retainer_charges_id_fk" FOREIGN KEY ("split_from_id") REFERENCES "public"."retainer_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD CONSTRAINT "retainer_cycle_lines_amendment_id_retainer_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."retainer_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_charges_amendment_id_idx" ON "retainer_charges" USING btree ("amendment_id");--> statement-breakpoint
CREATE INDEX "retainer_charges_split_from_id_idx" ON "retainer_charges" USING btree ("split_from_id");--> statement-breakpoint
CREATE INDEX "retainer_cycle_lines_amendment_id_idx" ON "retainer_cycle_lines" USING btree ("amendment_id");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_price_check" CHECK ("invoice_lines"."unit_price_minor" >= 0 or "invoice_lines"."retainer_charge_id" is not null);--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_settle_note_check" CHECK (("retainer_charges"."status" = 'settled_outside') = ("retainer_charges"."settle_note" is not null) and coalesce(char_length("retainer_charges"."settle_note"), 0) <= 300);