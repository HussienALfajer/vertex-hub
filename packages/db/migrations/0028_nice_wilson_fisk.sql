CREATE TYPE "public"."document_number_kind" AS ENUM('invoice', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."invoice_origin" AS ENUM('quote_accepted', 'milestone_done', 'cycle_opened', 'manual');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void');--> statement-breakpoint
CREATE TABLE "document_numbers" (
	"kind" "document_number_kind" NOT NULL,
	"year" integer NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "document_numbers_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"milestone_id" uuid,
	"retainer_cycle_id" uuid,
	"extra_work_item_id" uuid,
	"holds_source" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "invoice_lines_source_check" CHECK (num_nonnulls("invoice_lines"."milestone_id", "invoice_lines"."retainer_cycle_id", "invoice_lines"."extra_work_item_id") <= 1),
	CONSTRAINT "invoice_lines_description_check" CHECK (char_length("invoice_lines"."description") between 1 and 300),
	CONSTRAINT "invoice_lines_quantity_check" CHECK ("invoice_lines"."quantity" between 1 and 999),
	CONSTRAINT "invoice_lines_price_check" CHECK ("invoice_lines"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"syp_per_usd" numeric(12, 4),
	"rate_updated_at" timestamp with time zone,
	"rate_updated_by_id" uuid,
	"payment_terms_days" integer DEFAULT 7 NOT NULL,
	"payment_details" text DEFAULT '' NOT NULL,
	"invoice_footer" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "invoice_settings_singleton_check" CHECK ("invoice_settings"."singleton"),
	CONSTRAINT "invoice_settings_rate_check" CHECK ("invoice_settings"."syp_per_usd" > 0),
	CONSTRAINT "invoice_settings_terms_check" CHECK ("invoice_settings"."payment_terms_days" between 0 and 90)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"retainer_id" uuid,
	"quote_id" uuid,
	"origin" "invoice_origin" NOT NULL,
	"year" integer,
	"number" integer,
	"currency" "currency" NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"payment_terms_days" integer NOT NULL,
	"issued_on" date,
	"due_on" date,
	"syp_per_usd" numeric(12, 4),
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"snapshot" jsonb,
	"issued_by_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "invoices_engagement_check" CHECK ("invoices"."project_id" is null or "invoices"."retainer_id" is null),
	CONSTRAINT "invoices_number_check" CHECK (("invoices"."year" is null) = ("invoices"."number" is null)),
	CONSTRAINT "invoices_terms_check" CHECK ("invoices"."payment_terms_days" between 0 and 90),
	CONSTRAINT "invoices_dates_check" CHECK ("invoices"."due_on" >= "invoices"."issued_on"),
	CONSTRAINT "invoices_rate_check" CHECK ("invoices"."syp_per_usd" > 0),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."total_minor" >= 0 and "invoices"."paid_minor" between 0 and "invoices"."total_minor")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_retainer_cycle_id_retainer_cycles_id_fk" FOREIGN KEY ("retainer_cycle_id") REFERENCES "public"."retainer_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_extra_work_item_id_extra_work_items_id_fk" FOREIGN KEY ("extra_work_item_id") REFERENCES "public"."extra_work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_rate_updated_by_id_users_id_fk" FOREIGN KEY ("rate_updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE INDEX "invoice_lines_milestone_id_idx" ON "invoice_lines" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_retainer_cycle_id_idx" ON "invoice_lines" USING btree ("retainer_cycle_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_extra_work_item_id_idx" ON "invoice_lines" USING btree ("extra_work_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_live_milestone_idx" ON "invoice_lines" USING btree ("milestone_id") WHERE "invoice_lines"."holds_source";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_live_retainer_cycle_idx" ON "invoice_lines" USING btree ("retainer_cycle_id") WHERE "invoice_lines"."holds_source";--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_live_extra_work_item_idx" ON "invoice_lines" USING btree ("extra_work_item_id") WHERE "invoice_lines"."holds_source";--> statement-breakpoint
CREATE INDEX "invoice_settings_rate_updated_by_id_idx" ON "invoice_settings" USING btree ("rate_updated_by_id");--> statement-breakpoint
CREATE INDEX "invoice_settings_updated_by_id_idx" ON "invoice_settings" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_idx" ON "invoices" USING btree ("year","number");--> statement-breakpoint
CREATE INDEX "invoices_client_id_idx" ON "invoices" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoices_project_id_idx" ON "invoices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "invoices_retainer_id_idx" ON "invoices" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "invoices_quote_id_idx" ON "invoices" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_due_on_idx" ON "invoices" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "invoices_updated_at_idx" ON "invoices" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "invoices_issued_by_id_idx" ON "invoices" USING btree ("issued_by_id");--> statement-breakpoint
CREATE INDEX "invoices_voided_by_id_idx" ON "invoices" USING btree ("voided_by_id");--> statement-breakpoint
CREATE INDEX "invoices_created_by_id_idx" ON "invoices" USING btree ("created_by_id");