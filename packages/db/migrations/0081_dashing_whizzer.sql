CREATE TYPE "public"."attendance_item_kind" AS ENUM('lateness', 'early_leave', 'absence', 'missing_out', 'overtime');--> statement-breakpoint
CREATE TYPE "public"."attendance_item_status" AS ENUM('pending', 'deducted', 'waived', 'warned', 'paid', 'time_off', 'rejected', 'void');--> statement-breakpoint
ALTER TYPE "public"."hr_request_kind" ADD VALUE 'remote_day';--> statement-breakpoint
ALTER TYPE "public"."hr_request_kind" ADD VALUE 'correction';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry" ADD VALUE 'overtime_credit';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'attendance_check_in';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'attendance_check_out';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'attendance_day';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'attendance_item';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'attendance_date';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'kiosk';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_item_raised' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_items_pending' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_item_decided' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_check_in_missing' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'attendance_check_out_missing' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'field_punch_recorded' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'field_punch_rejected' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_check_in_missing' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'kiosk_offline' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."timed_reminder_kind" ADD VALUE 'shoot_check_in';--> statement-breakpoint
ALTER TYPE "public"."timed_reminder_kind" ADD VALUE 'kiosk_offline';--> statement-breakpoint
CREATE TABLE "attendance_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"kind" "attendance_item_kind" NOT NULL,
	"minutes" integer NOT NULL,
	"proposed_fraction" numeric(4, 2) NOT NULL,
	"justification" text,
	"justified_at" timestamp with time zone,
	"status" "attendance_item_status" DEFAULT 'pending' NOT NULL,
	"decided_fraction" numeric(4, 2),
	"decided_minutes" integer,
	"credited_days" numeric(5, 1),
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "attendance_items_minutes_check" CHECK ("attendance_items"."minutes" >= 0),
	CONSTRAINT "attendance_items_decision_check" CHECK (("attendance_items"."status" = 'deducted') = ("attendance_items"."decided_fraction" is not null)
        and ("attendance_items"."status" in ('paid', 'time_off')) = ("attendance_items"."decided_minutes" is not null)
        and ("attendance_items"."decided_minutes" is null or "attendance_items"."decided_minutes" <= "attendance_items"."minutes")
        and ("attendance_items"."credited_days" is null or "attendance_items"."status" = 'time_off'))
);
--> statement-breakpoint
ALTER TABLE "hr_requests" DROP CONSTRAINT "hr_requests_kind_check";--> statement-breakpoint
ALTER TABLE "hr_opinions" ALTER COLUMN "request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_opinions" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_requests" ADD COLUMN "correction_direction" "punch_direction";--> statement-breakpoint
ALTER TABLE "attendance_items" ADD CONSTRAINT "attendance_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_items" ADD CONSTRAINT "attendance_items_day_id_attendance_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."attendance_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_items" ADD CONSTRAINT "attendance_items_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_items_user_id_idx" ON "attendance_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attendance_items_day_id_idx" ON "attendance_items" USING btree ("day_id");--> statement-breakpoint
CREATE INDEX "attendance_items_decided_by_id_idx" ON "attendance_items" USING btree ("decided_by_id");--> statement-breakpoint
CREATE INDEX "attendance_items_status_idx" ON "attendance_items" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_items_day_kind_key" ON "attendance_items" USING btree ("day_id","kind") WHERE "attendance_items"."status" <> 'void';--> statement-breakpoint
ALTER TABLE "hr_opinions" ADD CONSTRAINT "hr_opinions_item_id_attendance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."attendance_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_opinions_item_id_idx" ON "hr_opinions" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "hr_opinions" ADD CONSTRAINT "hr_opinions_subject_check" CHECK (("hr_opinions"."request_id" is null) <> ("hr_opinions"."item_id" is null));--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_correction_check" CHECK (("hr_requests"."kind"::text = 'correction') = ("hr_requests"."correction_direction" is not null));--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_kind_check" CHECK (("hr_requests"."kind" = 'leave' and "hr_requests"."leave_type" is not null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is not null)
        or ("hr_requests"."kind" = 'permission' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on" and "hr_requests"."from_time" < "hr_requests"."to_time")
        or ("hr_requests"."kind"::text = 'passkey_replacement' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on")
        or ("hr_requests"."kind"::text = 'remote_day' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is not null)
        or ("hr_requests"."kind"::text = 'correction' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."from_time" is not null and "hr_requests"."to_time" is null and "hr_requests"."days" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on"));