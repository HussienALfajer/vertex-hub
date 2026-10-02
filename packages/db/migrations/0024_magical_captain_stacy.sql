CREATE TYPE "public"."discount_approval" AS ENUM('none', 'pending', 'approved', 'returned');--> statement-breakpoint
CREATE TYPE "public"."quote_rejection_reason" AS ENUM('price', 'timing', 'competitor', 'scope', 'no_response', 'other');--> statement-breakpoint
CREATE TYPE "public"."quote_section" AS ENUM('one_off', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded');--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'quote';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'quote_approval_requested';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'quote_approval_decided';--> statement-breakpoint
CREATE TABLE "quote_installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"name" text NOT NULL,
	"percent" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "quote_installments_percent_check" CHECK ("quote_installments"."percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" "department_code" NOT NULL,
	"quantity" integer NOT NULL,
	"revision_rounds" integer NOT NULL,
	"deliverable_kind" "deliverable_kind",
	"deliverable_label" text,
	"template_id" uuid,
	"position" integer NOT NULL,
	CONSTRAINT "quote_line_items_quantity_check" CHECK ("quote_line_items"."quantity" between 1 and 999),
	CONSTRAINT "quote_line_items_revision_rounds_check" CHECK ("quote_line_items"."revision_rounds" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "quote_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"quote_id" uuid NOT NULL,
	"section" "quote_section" NOT NULL,
	"service_id" uuid,
	"package_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"department" "department_code",
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"list_unit_price_minor" bigint,
	"revision_rounds" integer,
	"deliverable_kind" "deliverable_kind",
	"deliverable_label" text,
	"template_id" uuid,
	"position" integer NOT NULL,
	CONSTRAINT "quote_lines_item_check" CHECK (("quote_lines"."service_id" is null) <> ("quote_lines"."package_id" is null)),
	CONSTRAINT "quote_lines_quantity_check" CHECK ("quote_lines"."quantity" between 1 and 999),
	CONSTRAINT "quote_lines_price_check" CHECK ("quote_lines"."unit_price_minor" >= 0),
	CONSTRAINT "quote_lines_list_price_check" CHECK ("quote_lines"."list_unit_price_minor" >= 0),
	CONSTRAINT "quote_lines_revision_rounds_check" CHECK ("quote_lines"."revision_rounds" between 0 and 20)
);
--> statement-breakpoint
CREATE TABLE "quote_numbers" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"company_details" text DEFAULT '' NOT NULL,
	"default_terms" text DEFAULT '' NOT NULL,
	"default_validity_days" integer DEFAULT 14 NOT NULL,
	"discount_threshold_percent" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "quote_settings_singleton_check" CHECK ("quote_settings"."singleton"),
	CONSTRAINT "quote_settings_validity_check" CHECK ("quote_settings"."default_validity_days" between 1 and 90),
	CONSTRAINT "quote_settings_threshold_check" CHECK ("quote_settings"."discount_threshold_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid,
	"title" text NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"discount_approval" "discount_approval" DEFAULT 'none' NOT NULL,
	"discount_requested_by_id" uuid,
	"discount_decided_by_id" uuid,
	"discount_decided_at" timestamp with time zone,
	"discount_note" text,
	"one_off_discount_minor" bigint DEFAULT 0 NOT NULL,
	"monthly_discount_minor" bigint DEFAULT 0 NOT NULL,
	"monthly_term_months" integer,
	"validity_days" integer NOT NULL,
	"valid_until" date,
	"client_notes" text,
	"terms" text,
	"sent_at" timestamp with time zone,
	"sent_by_id" uuid,
	"responded_on" date,
	"response_contact_id" uuid,
	"response_note" text,
	"responded_by_id" uuid,
	"rejection_reason" "quote_rejection_reason",
	"snapshot" jsonb,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "quotes_title_check" CHECK (char_length("quotes"."title") between 1 and 120),
	CONSTRAINT "quotes_version_check" CHECK ("quotes"."version" >= 1),
	CONSTRAINT "quotes_discounts_check" CHECK ("quotes"."one_off_discount_minor" >= 0 and "quotes"."monthly_discount_minor" >= 0),
	CONSTRAINT "quotes_term_check" CHECK ("quotes"."monthly_term_months" between 1 and 36),
	CONSTRAINT "quotes_validity_check" CHECK ("quotes"."validity_days" between 1 and 90)
);
--> statement-breakpoint
ALTER TABLE "quote_installments" ADD CONSTRAINT "quote_installments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_line_id_quote_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."quote_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_service_id_catalog_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."catalog_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_service_id_catalog_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."catalog_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_package_id_catalog_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."catalog_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_settings" ADD CONSTRAINT "quote_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_requested_by_id_users_id_fk" FOREIGN KEY ("discount_requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_discount_decided_by_id_users_id_fk" FOREIGN KEY ("discount_decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sent_by_id_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_response_contact_id_client_contacts_id_fk" FOREIGN KEY ("response_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_installments_quote_id_idx" ON "quote_installments" USING btree ("quote_id","position");--> statement-breakpoint
CREATE INDEX "quote_line_items_line_id_idx" ON "quote_line_items" USING btree ("line_id","position");--> statement-breakpoint
CREATE INDEX "quote_line_items_service_id_idx" ON "quote_line_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "quote_line_items_template_id_idx" ON "quote_line_items" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "quote_lines_quote_id_idx" ON "quote_lines" USING btree ("quote_id","position");--> statement-breakpoint
CREATE INDEX "quote_lines_service_id_idx" ON "quote_lines" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "quote_lines_package_id_idx" ON "quote_lines" USING btree ("package_id");--> statement-breakpoint
CREATE INDEX "quote_lines_template_id_idx" ON "quote_lines" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "quote_settings_updated_by_id_idx" ON "quote_settings" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_idx" ON "quotes" USING btree ("year","number","version");--> statement-breakpoint
CREATE INDEX "quotes_client_id_idx" ON "quotes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "quotes_updated_at_idx" ON "quotes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "quotes_contact_id_idx" ON "quotes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "quotes_discount_requested_by_id_idx" ON "quotes" USING btree ("discount_requested_by_id");--> statement-breakpoint
CREATE INDEX "quotes_discount_decided_by_id_idx" ON "quotes" USING btree ("discount_decided_by_id");--> statement-breakpoint
CREATE INDEX "quotes_sent_by_id_idx" ON "quotes" USING btree ("sent_by_id");--> statement-breakpoint
CREATE INDEX "quotes_response_contact_id_idx" ON "quotes" USING btree ("response_contact_id");--> statement-breakpoint
CREATE INDEX "quotes_responded_by_id_idx" ON "quotes" USING btree ("responded_by_id");--> statement-breakpoint
CREATE INDEX "quotes_created_by_id_idx" ON "quotes" USING btree ("created_by_id");