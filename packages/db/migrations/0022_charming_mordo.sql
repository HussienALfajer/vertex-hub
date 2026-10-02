ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'over_limit_pending';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'cycle_behind';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'cycle_behind_final';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_over_limit_pending' BEFORE 'post_publish_today';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_behind';