CREATE TYPE "public"."channel_mode" AS ENUM('required', 'on', 'off', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."follow_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."follow_subject" AS ENUM('task', 'post');--> statement-breakpoint
CREATE TYPE "public"."notification_box" AS ENUM('action', 'info');--> statement-breakpoint
CREATE TYPE "public"."notification_resolution" AS ENUM('done', 'void');--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'escalation_1';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'escalation_2';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'escalation_3';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'action_escalated';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'action_escalated_top';--> statement-breakpoint
CREATE TABLE "notification_policies" (
	"type" "notification_type" PRIMARY KEY NOT NULL,
	"push" "channel_mode" NOT NULL,
	"email" "channel_mode" NOT NULL,
	"updated_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_followers" (
	"subject_type" "follow_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"following" boolean NOT NULL,
	"source" "follow_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_followers_subject_type_subject_id_user_id_pk" PRIMARY KEY("subject_type","subject_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "morning_push" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "box" "notification_box" DEFAULT 'info' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolution_type" "notification_type";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "resolution" "notification_resolution";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_followers" ADD CONSTRAINT "record_followers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_policies_updated_by_id_idx" ON "notification_policies" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "record_followers_user_id_idx" ON "record_followers" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_needs_you_idx" ON "notifications" USING btree ("recipient_id","updated_at" DESC NULLS LAST) WHERE "notifications"."box" = 'action' and "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_snoozed_idx" ON "notifications" USING btree ("snoozed_until") WHERE "notifications"."snoozed_until" is not null;--> statement-breakpoint
CREATE INDEX "notifications_open_subject_idx" ON "notifications" USING btree ("subject_type","subject_id","resolution_type") WHERE "notifications"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_resolved_at_idx" ON "notifications" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "notifications_resolved_by_id_idx" ON "notifications" USING btree ("resolved_by_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resolution_check" CHECK (("notifications"."resolution" is null) = ("notifications"."resolved_at" is null));