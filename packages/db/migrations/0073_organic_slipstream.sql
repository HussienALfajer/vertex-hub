CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'sent', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'announcement';--> statement-breakpoint
ALTER TYPE "public"."file_role" ADD VALUE 'attachment';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'ack_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'ack_summary';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'announcement';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'announcement' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'announcement_ack_reminder' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'announcement_ack_summary' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "announcement_recipients" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"reminders_sent" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "announcement_recipients_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id"),
	CONSTRAINT "announcement_recipients_reminders_check" CHECK ("announcement_recipients"."reminders_sent" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"link_url" text,
	"link_label" text,
	"priority" "notification_priority" NOT NULL,
	"requires_ack" boolean NOT NULL,
	"audience" jsonb NOT NULL,
	"status" "announcement_status" NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"unsent_at" timestamp with time zone,
	"pinned_until" date,
	"edited_at" timestamp with time zone,
	"renotified_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "announcements_title_check" CHECK (char_length("announcements"."title") between 3 and 120),
	CONSTRAINT "announcements_scheduled_check" CHECK ("announcements"."status" <> 'scheduled' or "announcements"."scheduled_at" is not null),
	CONSTRAINT "announcements_sent_check" CHECK ("announcements"."status" not in ('sent', 'withdrawn') or "announcements"."sent_at" is not null),
	CONSTRAINT "announcements_withdrawn_check" CHECK (("announcements"."status" = 'withdrawn') = ("announcements"."withdrawn_at" is not null)),
	CONSTRAINT "announcements_critical_ack_check" CHECK ("announcements"."priority" <> 'critical' or "announcements"."requires_ack")
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "announcement_id" uuid;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_recipients" ADD CONSTRAINT "announcement_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_withdrawn_by_id_users_id_fk" FOREIGN KEY ("withdrawn_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_recipients_user_id_idx" ON "announcement_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcements_author_id_idx" ON "announcements" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "announcements_withdrawn_by_id_idx" ON "announcements" USING btree ("withdrawn_by_id");--> statement-breakpoint
CREATE INDEX "announcements_scheduled_idx" ON "announcements" USING btree ("scheduled_at") WHERE "announcements"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "announcements_sent_at_idx" ON "announcements" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_announcement_id_idx" ON "file_items" USING btree ("announcement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "retainer_contract_id", "announcement_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id") <= 1 and (
        ("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id", "file_items"."announcement_id") = 0)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'ad_wallet_entry' and "file_items"."ad_wallet_entry_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'retainer_contract' and "file_items"."retainer_contract_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."announcement_id" is not null and "file_items"."client_id" is null)));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."role"::text = 'attachment'));