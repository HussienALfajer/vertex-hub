CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'freelance');--> statement-breakpoint
CREATE TYPE "public"."end_reason" AS ENUM('resigned', 'terminated', 'contract_ended', 'other');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('cash', 'bank_transfer', 'mobile_wallet');--> statement-breakpoint
CREATE TYPE "public"."weekday" AS ENUM('saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday');--> statement-breakpoint
CREATE TYPE "public"."work_schedule_kind" AS ENUM('fixed', 'flexible');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'employee';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'contract_ending_30';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'contract_ending_7';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'probation_ending';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'contract_ending' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'probation_ending' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'employee_leaving' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'salary_changed' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "employee_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"national_id" text,
	"birth_date" date,
	"address" text,
	"emergency_name" text,
	"emergency_phone" text,
	"emergency_relation" text,
	"employment_type" "employment_type" DEFAULT 'full_time' NOT NULL,
	"start_date" date,
	"probation_end_date" date,
	"contract_end_date" date,
	"schedule_id" uuid NOT NULL,
	"attendance_exempt" boolean DEFAULT false NOT NULL,
	"remote_weekdays" "weekday"[] DEFAULT '{}'::weekday[] NOT NULL,
	"annual_leave_days" numeric(4, 1) NOT NULL,
	"payout_method" "payout_method",
	"payout_institution" text,
	"payout_account" text,
	"payout_holder" text,
	"ended_on" date,
	"end_reason" "end_reason",
	"end_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "employee_files_dates_check" CHECK ("employee_files"."start_date" is null or (("employee_files"."probation_end_date" is null or "employee_files"."probation_end_date" >= "employee_files"."start_date") and ("employee_files"."contract_end_date" is null or "employee_files"."contract_end_date" >= "employee_files"."start_date"))),
	CONSTRAINT "employee_files_end_check" CHECK (("employee_files"."ended_on" is null) = ("employee_files"."end_reason" is null)),
	CONSTRAINT "employee_files_payout_check" CHECK ("employee_files"."payout_method" in ('bank_transfer', 'mobile_wallet') or ("employee_files"."payout_institution" is null and "employee_files"."payout_account" is null and "employee_files"."payout_holder" is null))
);
--> statement-breakpoint
CREATE TABLE "salary_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"reason" text NOT NULL,
	"created_by_id" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "salary_changes_amount_check" CHECK ("salary_changes"."amount_minor" > 0),
	CONSTRAINT "salary_changes_archive_check" CHECK (("salary_changes"."archived_at" is null) = ("salary_changes"."archive_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "work_schedule_days" (
	"schedule_id" uuid NOT NULL,
	"weekday" "weekday" NOT NULL,
	"start_time" time NOT NULL,
	"latest_start_time" time,
	"required_minutes" integer NOT NULL,
	CONSTRAINT "work_schedule_days_schedule_id_weekday_pk" PRIMARY KEY("schedule_id","weekday"),
	CONSTRAINT "work_schedule_days_minutes_check" CHECK ("work_schedule_days"."required_minutes" between 60 and 960),
	CONSTRAINT "work_schedule_days_window_check" CHECK ("work_schedule_days"."latest_start_time" is null or "work_schedule_days"."latest_start_time" >= "work_schedule_days"."start_time")
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "work_schedule_kind" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_files" ADD CONSTRAINT "employee_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_files" ADD CONSTRAINT "employee_files_schedule_id_work_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_changes" ADD CONSTRAINT "salary_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_changes" ADD CONSTRAINT "salary_changes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule_days" ADD CONSTRAINT "work_schedule_days_schedule_id_work_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_files_user_id_key" ON "employee_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "employee_files_schedule_id_idx" ON "employee_files" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "salary_changes_user_id_idx" ON "salary_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "salary_changes_created_by_id_idx" ON "salary_changes" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_changes_effective_key" ON "salary_changes" USING btree ("user_id","effective_on") WHERE "salary_changes"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_name_key" ON "work_schedules" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_default_key" ON "work_schedules" USING btree ("is_default") WHERE "work_schedules"."is_default";--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_employee_id_users_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_employee_id_idx" ON "file_items" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "retainer_contract_id", "announcement_id", "employee_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id", "file_items"."employee_id") <= 1 and (
        ("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id", "file_items"."employee_id") = 0)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'ad_wallet_entry' and "file_items"."ad_wallet_entry_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'retainer_contract' and "file_items"."retainer_contract_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."announcement_id" is not null and "file_items"."client_id" is null)
        or ("file_items"."owner_type"::text = 'employee' and "file_items"."employee_id" is not null and "file_items"."client_id" is null)));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."role"::text = 'attachment')
        or ("file_items"."owner_type"::text = 'employee' and "file_items"."role" = 'document'));