CREATE TYPE "public"."email_audience" AS ENUM('staff', 'client');--> statement-breakpoint
CREATE TYPE "public"."email_kind" AS ENUM('notification_batch', 'digest', 'account_activation', 'password_reset', 'security_notice', 'new_device', 'test', 'client_quote', 'client_quote_reminder', 'client_approval_link', 'client_approval_reminder', 'client_invoice', 'client_invoice_reminder', 'client_receipt', 'client_statement', 'client_report', 'client_ad_receipt', 'client_ad_budget_low');--> statement-breakpoint
CREATE TYPE "public"."email_record_type" AS ENUM('quote', 'invoice', 'payment', 'approval_request', 'client', 'ad_wallet_entry');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "email_kind" NOT NULL,
	"audience" "email_audience" NOT NULL,
	"to" jsonb NOT NULL,
	"cc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reply_to" text,
	"subject" text NOT NULL,
	"message" text,
	"data" jsonb NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sender_id" uuid,
	"client_id" uuid,
	"record_type" "email_record_type",
	"record_id" uuid,
	"status" "email_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_subject_check" CHECK (char_length("email_messages"."subject") between 1 and 200),
	CONSTRAINT "email_messages_record_check" CHECK (("email_messages"."record_type" is null) = ("email_messages"."record_id" is null))
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_messages_record_idx" ON "email_messages" USING btree ("record_type","record_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_messages_client_id_idx" ON "email_messages" USING btree ("client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_messages_status_idx" ON "email_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "email_messages_created_at_idx" ON "email_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_messages_sender_id_idx" ON "email_messages" USING btree ("sender_id");