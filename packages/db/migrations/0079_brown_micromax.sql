CREATE TYPE "public"."balance_leave_type" AS ENUM('annual', 'sick', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."hr_request_kind" AS ENUM('leave', 'permission');--> statement-breakpoint
CREATE TYPE "public"."hr_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_half" AS ENUM('first_half', 'second_half');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('annual', 'sick', 'emergency', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry" AS ENUM('opening', 'accrual', 'grant', 'carry_over', 'expiry', 'taken', 'restored', 'adjustment');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'hr_request';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'colleague_on_leave';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'hr_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'hr_request_submitted' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'hr_request_decided' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'colleague_on_leave' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'leave_balance_adjusted' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "hr_opinions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "hr_opinions_body_check" CHECK (char_length("hr_opinions"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "hr_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "hr_request_kind" NOT NULL,
	"leave_type" "leave_type",
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"half" "leave_half",
	"from_time" time,
	"to_time" time,
	"days" numeric(5, 1),
	"paid_days" numeric(5, 1),
	"unpaid_days" numeric(5, 1),
	"reason" text,
	"short_notice" boolean DEFAULT false NOT NULL,
	"status" "hr_request_status" DEFAULT 'pending' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "hr_requests_range_check" CHECK ("hr_requests"."ends_on" >= "hr_requests"."starts_on"),
	CONSTRAINT "hr_requests_kind_check" CHECK (("hr_requests"."kind" = 'leave' and "hr_requests"."leave_type" is not null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is not null)
        or ("hr_requests"."kind" = 'permission' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on" and "hr_requests"."from_time" < "hr_requests"."to_time")),
	CONSTRAINT "hr_requests_half_check" CHECK ("hr_requests"."half" is null or "hr_requests"."starts_on" = "hr_requests"."ends_on")
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type" "balance_leave_type" NOT NULL,
	"year" integer NOT NULL,
	"days" numeric(5, 1) NOT NULL,
	"entry" "ledger_entry" NOT NULL,
	"period" text,
	"request_id" uuid,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "leave_ledger_period_check" CHECK (("leave_ledger"."entry" = 'accrual') = ("leave_ledger"."period" is not null)),
	CONSTRAINT "leave_ledger_note_check" CHECK ("leave_ledger"."entry" not in ('adjustment', 'opening') or "leave_ledger"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "hr_request_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_opinions" ADD CONSTRAINT "hr_opinions_request_id_hr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hr_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_opinions" ADD CONSTRAINT "hr_opinions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_request_id_hr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hr_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_opinions_request_id_idx" ON "hr_opinions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "hr_opinions_author_id_idx" ON "hr_opinions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "hr_requests_user_id_idx" ON "hr_requests" USING btree ("user_id","starts_on");--> statement-breakpoint
CREATE INDEX "hr_requests_created_by_id_idx" ON "hr_requests" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "hr_requests_decided_by_id_idx" ON "hr_requests" USING btree ("decided_by_id");--> statement-breakpoint
CREATE INDEX "hr_requests_status_idx" ON "hr_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leave_ledger_user_id_idx" ON "leave_ledger" USING btree ("user_id","leave_type","year");--> statement-breakpoint
CREATE INDEX "leave_ledger_request_id_idx" ON "leave_ledger" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "leave_ledger_created_by_id_idx" ON "leave_ledger" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_accrual_key" ON "leave_ledger" USING btree ("user_id","period") WHERE "leave_ledger"."entry" = 'accrual' and "leave_ledger"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_yearly_key" ON "leave_ledger" USING btree ("user_id","leave_type","year","entry") WHERE "leave_ledger"."entry" in ('grant', 'carry_over', 'expiry') and "leave_ledger"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_hr_request_id_hr_requests_id_fk" FOREIGN KEY ("hr_request_id") REFERENCES "public"."hr_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_hr_request_id_idx" ON "file_items" USING btree ("hr_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "retainer_contract_id", "announcement_id", "employee_id", "hr_request_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id", "file_items"."employee_id", "file_items"."hr_request_id") <= 1 and (
        ("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id", "file_items"."employee_id", "file_items"."hr_request_id") = 0)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'ad_wallet_entry' and "file_items"."ad_wallet_entry_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'retainer_contract' and "file_items"."retainer_contract_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."announcement_id" is not null and "file_items"."client_id" is null)
        or ("file_items"."owner_type"::text = 'employee' and "file_items"."employee_id" is not null and "file_items"."client_id" is null)
        or ("file_items"."owner_type"::text = 'hr_request' and "file_items"."hr_request_id" is not null and "file_items"."client_id" is null)));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."role"::text = 'attachment')
        or ("file_items"."owner_type"::text in ('employee', 'hr_request') and "file_items"."role" = 'document'));