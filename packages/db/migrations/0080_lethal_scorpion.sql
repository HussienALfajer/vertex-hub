CREATE TYPE "public"."attendance_day_kind" AS ENUM('work', 'off', 'holiday');--> statement-breakpoint
CREATE TYPE "public"."attendance_day_status" AS ENUM('upcoming', 'in_progress', 'present', 'partial', 'absent', 'leave', 'holiday', 'off', 'trial');--> statement-breakpoint
CREATE TYPE "public"."attendance_place" AS ENUM('office', 'remote');--> statement-breakpoint
CREATE TYPE "public"."day_leave" AS ENUM('none', 'full', 'first_half', 'second_half');--> statement-breakpoint
CREATE TYPE "public"."field_review" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."attendance_passkey_status" AS ENUM('pending', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."punch_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."punch_method" AS ENUM('office', 'remote', 'field', 'shoot', 'correction');--> statement-breakpoint
ALTER TYPE "public"."hr_request_kind" ADD VALUE 'passkey_replacement';--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "attendance_day_kind" NOT NULL,
	"expected_start" timestamp with time zone,
	"latest_start" timestamp with time zone,
	"expected_end" timestamp with time zone,
	"required_minutes" integer,
	"place" "attendance_place",
	"leave" "day_leave" DEFAULT 'none' NOT NULL,
	"first_in_at" timestamp with time zone,
	"last_out_at" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"status" "attendance_day_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_kiosks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text,
	"pairing_code_hash" text,
	"pairing_expires_at" timestamp with time zone,
	"secret" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_ip_address" text,
	"recent_ips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_passkeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"device_label" text NOT NULL,
	"status" "attendance_passkey_status" NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_punches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "punch_direction" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"method" "punch_method" NOT NULL,
	"kiosk_id" uuid,
	"ip_address" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"accuracy_m" integer,
	"field_note" text,
	"field_task_id" uuid,
	"field_meeting_id" uuid,
	"shoot_id" uuid,
	"field_review" "field_review",
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "attendance_punches_method_check" CHECK (("attendance_punches"."method" = 'office') = ("attendance_punches"."kiosk_id" is not null)
        and ("attendance_punches"."method" = 'shoot') = ("attendance_punches"."shoot_id" is not null)
        and ("attendance_punches"."method" <> 'field' or "attendance_punches"."field_note" is not null)
        and ("attendance_punches"."method" not in ('remote', 'field', 'shoot') or "attendance_punches"."latitude" is not null)
        and ("attendance_punches"."method" in ('field', 'shoot')) = ("attendance_punches"."field_review" is not null)),
	CONSTRAINT "attendance_punches_location_check" CHECK (("attendance_punches"."latitude" is null) = ("attendance_punches"."longitude" is null))
);
--> statement-breakpoint
ALTER TABLE "hr_requests" DROP CONSTRAINT "hr_requests_kind_check";--> statement-breakpoint
ALTER TABLE "hr_settings" ADD COLUMN "attendance_starts_on" date;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_kiosks" ADD CONSTRAINT "attendance_kiosks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_passkeys" ADD CONSTRAINT "attendance_passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_passkeys" ADD CONSTRAINT "attendance_passkeys_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_kiosk_id_attendance_kiosks_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."attendance_kiosks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_field_task_id_tasks_id_fk" FOREIGN KEY ("field_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_field_meeting_id_meetings_id_fk" FOREIGN KEY ("field_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_shoot_id_shoots_id_fk" FOREIGN KEY ("shoot_id") REFERENCES "public"."shoots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_request_id_hr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hr_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_days_user_id_date_key" ON "attendance_days" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_kiosks_token_hash_key" ON "attendance_kiosks" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_kiosks_pairing_code_hash_key" ON "attendance_kiosks" USING btree ("pairing_code_hash");--> statement-breakpoint
CREATE INDEX "attendance_kiosks_created_by_id_idx" ON "attendance_kiosks" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_passkeys_credential_id_key" ON "attendance_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "attendance_passkeys_user_id_idx" ON "attendance_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attendance_passkeys_decided_by_id_idx" ON "attendance_passkeys" USING btree ("decided_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_passkeys_active_key" ON "attendance_passkeys" USING btree ("user_id") WHERE "attendance_passkeys"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_passkeys_pending_key" ON "attendance_passkeys" USING btree ("user_id") WHERE "attendance_passkeys"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_punches_user_id_idx" ON "attendance_punches" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "attendance_punches_kiosk_id_idx" ON "attendance_punches" USING btree ("kiosk_id");--> statement-breakpoint
CREATE INDEX "attendance_punches_shoot_id_idx" ON "attendance_punches" USING btree ("shoot_id");--> statement-breakpoint
CREATE INDEX "attendance_punches_field_task_id_idx" ON "attendance_punches" USING btree ("field_task_id");--> statement-breakpoint
CREATE INDEX "attendance_punches_field_meeting_id_idx" ON "attendance_punches" USING btree ("field_meeting_id");--> statement-breakpoint
CREATE INDEX "attendance_punches_request_id_idx" ON "attendance_punches" USING btree ("request_id");--> statement-breakpoint
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_kind_check" CHECK (("hr_requests"."kind" = 'leave' and "hr_requests"."leave_type" is not null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is not null)
        or ("hr_requests"."kind" = 'permission' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on" and "hr_requests"."from_time" < "hr_requests"."to_time")
        or ("hr_requests"."kind"::text = 'passkey_replacement' and "hr_requests"."leave_type" is null and "hr_requests"."half" is null and "hr_requests"."from_time" is null and "hr_requests"."to_time" is null and "hr_requests"."days" is null and "hr_requests"."starts_on" = "hr_requests"."ends_on"));