CREATE TYPE "public"."notification_reminder_kind" AS ENUM('due_soon', 'overdue', 'overdue_escalated', 'renewal_due', 'renewal_reached');--> statement-breakpoint
CREATE TYPE "public"."notification_subject" AS ENUM('task', 'client', 'project', 'retainer', 'template_run');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('task_assigned', 'task_mentioned', 'task_returned', 'task_review_requested', 'task_awaiting_client', 'task_over_limit', 'task_changed', 'task_commented', 'task_requested', 'tasks_generated', 'task_approved', 'task_opened', 'request_finished', 'task_due_soon', 'task_overdue', 'task_overdue_escalated', 'client_account_manager_assigned', 'project_manager_assigned', 'retainer_renewal_due');--> statement-breakpoint
CREATE TABLE "notification_reminders" (
	"kind" "notification_reminder_kind" NOT NULL,
	"subject_id" uuid NOT NULL,
	"occurrence" date NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "notification_reminders_kind_subject_id_occurrence_pk" PRIMARY KEY("kind","subject_id","occurrence")
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"muted_types" "notification_type"[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"actor_id" uuid,
	"subject_type" "notification_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_count_check" CHECK ("notifications"."count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_recipient_id_idx" ON "notifications" USING btree ("recipient_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("recipient_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_read_at_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "notifications_actor_id_idx" ON "notifications" USING btree ("actor_id");