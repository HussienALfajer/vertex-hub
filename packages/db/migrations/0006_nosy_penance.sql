CREATE TYPE "public"."cycle_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."deliverable_kind" AS ENUM('design', 'reel', 'story', 'post', 'video', 'photo_shoot', 'ad_campaign', 'monthly_report', 'other');--> statement-breakpoint
CREATE TYPE "public"."extra_work_billing" AS ENUM('unbilled', 'billed', 'waived');--> statement-breakpoint
CREATE TYPE "public"."retainer_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "extra_work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid,
	"retainer_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"requested_on" date NOT NULL,
	"requested_by_contact_id" uuid,
	"estimate_minor" bigint,
	"billing_status" "extra_work_billing" DEFAULT 'unbilled' NOT NULL,
	"billing_note" text,
	"logged_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "extra_work_items_owner_check" CHECK (("extra_work_items"."project_id" is null) <> ("extra_work_items"."retainer_id" is null)),
	CONSTRAINT "extra_work_items_estimate_check" CHECK ("extra_work_items"."estimate_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retainer_cycle_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"line_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_cycle_adjustments_delta_check" CHECK ("retainer_cycle_adjustments"."delta" <> 0 and "retainer_cycle_adjustments"."delta" between -999 and 999)
);
--> statement-breakpoint
CREATE TABLE "retainer_cycle_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cycle_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"kind" "deliverable_kind" NOT NULL,
	"label" text,
	"committed_quantity" integer NOT NULL,
	"delivered_at_close" integer,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_cycle_lines_quantity_check" CHECK ("retainer_cycle_lines"."committed_quantity" between 0 and 999)
);
--> statement-breakpoint
CREATE TABLE "retainer_cycles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"month" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "cycle_status" DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_cycles_period_check" CHECK ("retainer_cycles"."period_end" >= "retainer_cycles"."period_start")
);
--> statement-breakpoint
CREATE TABLE "retainer_deliverables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"kind" "deliverable_kind" NOT NULL,
	"label" text,
	"monthly_quantity" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "retainer_deliverables_quantity_check" CHECK ("retainer_deliverables"."monthly_quantity" between 1 and 999),
	CONSTRAINT "retainer_deliverables_label_check" CHECK ("retainer_deliverables"."kind" <> 'other' or "retainer_deliverables"."label" is not null)
);
--> statement-breakpoint
CREATE TABLE "retainers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"departments" "department_code"[] NOT NULL,
	"status" "retainer_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"renewal_date" date,
	"ended_on" date,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"monthly_fee_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "retainers_renewal_date_check" CHECK ("retainers"."renewal_date" > "retainers"."start_date"),
	CONSTRAINT "retainers_monthly_fee_check" CHECK ("retainers"."monthly_fee_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "extra_work_items" ADD CONSTRAINT "extra_work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_work_items" ADD CONSTRAINT "extra_work_items_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_work_items" ADD CONSTRAINT "extra_work_items_requested_by_contact_id_client_contacts_id_fk" FOREIGN KEY ("requested_by_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_work_items" ADD CONSTRAINT "extra_work_items_logged_by_id_users_id_fk" FOREIGN KEY ("logged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_adjustments" ADD CONSTRAINT "retainer_cycle_adjustments_line_id_retainer_cycle_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."retainer_cycle_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_adjustments" ADD CONSTRAINT "retainer_cycle_adjustments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD CONSTRAINT "retainer_cycle_lines_cycle_id_retainer_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."retainer_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD CONSTRAINT "retainer_cycle_lines_deliverable_id_retainer_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."retainer_deliverables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycles" ADD CONSTRAINT "retainer_cycles_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_deliverables" ADD CONSTRAINT "retainer_deliverables_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_work_items_project_id_idx" ON "extra_work_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "extra_work_items_retainer_id_idx" ON "extra_work_items" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "extra_work_items_requested_by_contact_id_idx" ON "extra_work_items" USING btree ("requested_by_contact_id");--> statement-breakpoint
CREATE INDEX "extra_work_items_logged_by_id_idx" ON "extra_work_items" USING btree ("logged_by_id");--> statement-breakpoint
CREATE INDEX "retainer_cycle_adjustments_line_id_idx" ON "retainer_cycle_adjustments" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "retainer_cycle_adjustments_author_id_idx" ON "retainer_cycle_adjustments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "retainer_cycle_lines_cycle_id_idx" ON "retainer_cycle_lines" USING btree ("cycle_id","position");--> statement-breakpoint
CREATE INDEX "retainer_cycle_lines_deliverable_id_idx" ON "retainer_cycle_lines" USING btree ("deliverable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_cycle_lines_kind_label_idx" ON "retainer_cycle_lines" USING btree ("cycle_id","kind",lower(coalesce("label", '')));--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_cycles_retainer_month_idx" ON "retainer_cycles" USING btree ("retainer_id","month");--> statement-breakpoint
CREATE INDEX "retainer_cycles_status_idx" ON "retainer_cycles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "retainer_deliverables_retainer_id_idx" ON "retainer_deliverables" USING btree ("retainer_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_deliverables_kind_label_idx" ON "retainer_deliverables" USING btree ("retainer_id","kind",lower(coalesce("label", ''))) WHERE "retainer_deliverables"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "retainers_client_name_idx" ON "retainers" USING btree ("client_id",lower("name")) WHERE "retainers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "retainers_client_id_idx" ON "retainers" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "retainers_status_idx" ON "retainers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "retainers_departments_idx" ON "retainers" USING gin ("departments");