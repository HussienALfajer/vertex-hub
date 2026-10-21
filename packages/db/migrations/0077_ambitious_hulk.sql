ALTER TYPE "public"."notification_subject" ADD VALUE 'holiday';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'holiday_changed' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "hr_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	"lateness_tiers" jsonb DEFAULT '[{"upToMinutes":30,"fraction":0.25},{"upToMinutes":60,"fraction":0.5},{"upToMinutes":null,"fraction":1}]'::jsonb NOT NULL,
	"first_lateness_warning" boolean DEFAULT true NOT NULL,
	"overtime_min_minutes" integer DEFAULT 30 NOT NULL,
	"check_in_reminder_minutes" integer DEFAULT 15 NOT NULL,
	"default_annual_leave_days" numeric(5, 1) DEFAULT 14 NOT NULL,
	"carry_over_max_days" numeric(5, 1) DEFAULT 5 NOT NULL,
	"sick_days_per_year" numeric(5, 1) DEFAULT 14 NOT NULL,
	"sick_certificate_after_days" integer DEFAULT 2 NOT NULL,
	"sick_request_within_work_days" integer DEFAULT 3 NOT NULL,
	"emergency_days_per_year" numeric(5, 1) DEFAULT 3 NOT NULL,
	"permission_max_minutes" integer DEFAULT 120 NOT NULL,
	"permissions_per_month" integer DEFAULT 4 NOT NULL,
	"annual_notice_work_days" integer DEFAULT 3 NOT NULL,
	"remote_notice_work_days" integer DEFAULT 1 NOT NULL,
	"overtime_minutes_per_leave_day" integer DEFAULT 480 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "hr_settings_singleton_check" CHECK ("hr_settings"."singleton")
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "public_holidays_range_check" CHECK ("public_holidays"."ends_on" >= "public_holidays"."starts_on" and "public_holidays"."ends_on" - "public_holidays"."starts_on" < 10)
);
--> statement-breakpoint
ALTER TABLE "hr_settings" ADD CONSTRAINT "hr_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_settings_updated_by_id_idx" ON "hr_settings" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "public_holidays_starts_on_idx" ON "public_holidays" USING btree ("starts_on");