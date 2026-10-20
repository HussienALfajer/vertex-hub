ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'invoice_due_soon' BEFORE 'escalation_1';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'campaign_end_passed' BEFORE 'escalation_1';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'campaign';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'department';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'invoice_draft_created' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'invoice_due_soon' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_recorded' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'payment_voided' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'invoice_voided' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'ad_deposit_recorded' BEFORE 'project_status_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'campaign_assigned' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'campaign_status_changed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'campaign_end_passed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'department_manager_assigned' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'member_moved' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'member_archived_open_work' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'security_new_device' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'security_notice' BEFORE 'push_device_lost';