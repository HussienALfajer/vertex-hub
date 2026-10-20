CREATE TYPE "public"."timed_reminder_kind" AS ENUM('task_due_shortly', 'post_publish_shortly', 'shoot_starting', 'meeting_starting');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_delivered' BEFORE 'post_returned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_reopened' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_revision_decided' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_due_shortly' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_published' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_cancelled' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_file_added' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_publish_shortly' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_opened' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_completed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_starting' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'meeting_starting' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_completed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_progressed';--> statement-breakpoint
CREATE TABLE "timed_reminders" (
	"kind" timed_reminder_kind NOT NULL,
	"subject_id" uuid NOT NULL,
	"occurs_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timed_reminders_kind_subject_id_occurs_at_pk" PRIMARY KEY("kind","subject_id","occurs_at")
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "first_opened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "timed_reminders_occurs_at_idx" ON "timed_reminders" USING btree ("occurs_at");