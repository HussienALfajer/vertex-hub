CREATE TYPE "public"."notification_email_state" AS ENUM('pending', 'sent', 'skipped');--> statement-breakpoint
CREATE TABLE "user_devices" (
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"label" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_user_id_device_key_pk" PRIMARY KEY("user_id","device_key")
);
--> statement-breakpoint
CREATE TABLE "email_digests" (
	"user_id" uuid NOT NULL,
	"digest_date" date NOT NULL,
	"email_id" uuid,
	CONSTRAINT "email_digests_user_id_digest_date_pk" PRIMARY KEY("user_id","digest_date")
);
--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "email_types" "notification_type"[];--> statement-breakpoint
ALTER TABLE "notification_settings" ADD COLUMN "digest_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_state" "notification_email_state";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_id" uuid;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_digests" ADD CONSTRAINT "email_digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_digests" ADD CONSTRAINT "email_digests_email_id_email_messages_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_digests_email_id_idx" ON "email_digests" USING btree ("email_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_email_id_email_messages_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_email_pending_idx" ON "notifications" USING btree ("recipient_id","email_after") WHERE "notifications"."email_state" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_email_id_idx" ON "notifications" USING btree ("email_id");