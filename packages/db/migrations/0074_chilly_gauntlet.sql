CREATE TYPE "public"."poll_results_visibility" AS ENUM('everyone_after_voting', 'author_only');--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'poll_closing';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'poll_closing' BEFORE 'action_reminder';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'poll_results' BEFORE 'action_reminder';--> statement-breakpoint
CREATE TABLE "announcement_poll_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"announcement_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "announcement_poll_options_position_key" UNIQUE("announcement_id","position"),
	CONSTRAINT "announcement_poll_options_label_check" CHECK (char_length("announcement_poll_options"."label") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "announcement_poll_votes" (
	"announcement_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_poll_votes_option_id_user_id_pk" PRIMARY KEY("option_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcement_polls" (
	"announcement_id" uuid PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"multiple" boolean NOT NULL,
	"anonymous" boolean NOT NULL,
	"results" "poll_results_visibility" NOT NULL,
	"closes_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "announcement_polls_question_check" CHECK (char_length("announcement_polls"."question") between 3 and 200)
);
--> statement-breakpoint
CREATE TABLE "announcement_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"priority" "notification_priority" NOT NULL,
	"requires_ack" boolean NOT NULL,
	"link_url" text,
	"link_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "announcement_templates_name_check" CHECK (char_length("announcement_templates"."name") between 3 and 60),
	CONSTRAINT "announcement_templates_critical_ack_check" CHECK ("announcement_templates"."priority" <> 'critical' or "announcement_templates"."requires_ack")
);
--> statement-breakpoint
ALTER TABLE "announcement_poll_options" ADD CONSTRAINT "announcement_poll_options_announcement_id_announcement_polls_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement_polls"("announcement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_poll_votes" ADD CONSTRAINT "announcement_poll_votes_announcement_id_announcement_polls_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement_polls"("announcement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_poll_votes" ADD CONSTRAINT "announcement_poll_votes_option_id_announcement_poll_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."announcement_poll_options"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_poll_votes" ADD CONSTRAINT "announcement_poll_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_polls" ADD CONSTRAINT "announcement_polls_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_templates" ADD CONSTRAINT "announcement_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_poll_options_announcement_id_idx" ON "announcement_poll_options" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_poll_votes_announcement_id_idx" ON "announcement_poll_votes" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX "announcement_poll_votes_user_id_idx" ON "announcement_poll_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcement_polls_closes_at_idx" ON "announcement_polls" USING btree ("closes_at") WHERE "announcement_polls"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "announcement_templates_owner_id_idx" ON "announcement_templates" USING btree ("owner_id");