CREATE TYPE "public"."attendance_month_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'attendance_month';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_month_closed' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "attendance_month_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_days" integer NOT NULL,
	"present_days" integer NOT NULL,
	"remote_days" integer NOT NULL,
	"field_days" integer NOT NULL,
	"absent_days" numeric(5, 1) NOT NULL,
	"leave_days" jsonb NOT NULL,
	"unpaid_leave_days" numeric(5, 1) NOT NULL,
	"holiday_days" integer NOT NULL,
	"late_count" integer NOT NULL,
	"deducted_days" numeric(5, 2) NOT NULL,
	"overtime_paid_minutes" integer NOT NULL,
	"overtime_time_off_minutes" integer NOT NULL,
	"worked_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_months" (
	"id" uuid PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"status" "attendance_month_status" NOT NULL,
	"closed_by_id" uuid,
	"closed_at" timestamp with time zone,
	"reopened_by_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "attendance_months_month_check" CHECK ("attendance_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "attendance_months_closed_check" CHECK ("attendance_months"."status" = 'open' or ("attendance_months"."closed_by_id" is not null and "attendance_months"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "attendance_month_summaries" ADD CONSTRAINT "attendance_month_summaries_month_id_attendance_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."attendance_months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_month_summaries" ADD CONSTRAINT "attendance_month_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD CONSTRAINT "attendance_months_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_months" ADD CONSTRAINT "attendance_months_reopened_by_id_users_id_fk" FOREIGN KEY ("reopened_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_month_summaries_month_id_user_id_key" ON "attendance_month_summaries" USING btree ("month_id","user_id");--> statement-breakpoint
CREATE INDEX "attendance_month_summaries_user_id_idx" ON "attendance_month_summaries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_months_month_key" ON "attendance_months" USING btree ("month");--> statement-breakpoint
CREATE INDEX "attendance_months_closed_by_id_idx" ON "attendance_months" USING btree ("closed_by_id");--> statement-breakpoint
CREATE INDEX "attendance_months_reopened_by_id_idx" ON "attendance_months" USING btree ("reopened_by_id");