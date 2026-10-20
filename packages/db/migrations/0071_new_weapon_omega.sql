ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'quote_expiring' BEFORE 'escalation_1';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'responsibility_moved' BEFORE 'approval_opened';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'client_status_changed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'client_healthcare_changed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_lost' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'quote_expiring' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'quote_expired' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'quote_rejected' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'project_status_changed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'milestone_completed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'extra_work_created' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_status_changed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'contract_signed' BEFORE 'push_device_lost';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'contract_voided' BEFORE 'push_device_lost';