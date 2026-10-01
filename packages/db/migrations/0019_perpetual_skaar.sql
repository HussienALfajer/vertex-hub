CREATE TYPE "public"."post_platform" AS ENUM('instagram', 'facebook', 'tiktok', 'x', 'linkedin', 'youtube', 'snapchat', 'google_business');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('idea', 'in_production', 'internal_review', 'awaiting_client', 'approved', 'scheduled', 'published', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."post_type" AS ENUM('post', 'reel', 'story', 'carousel');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'post';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'post_publish_today';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'post_publish_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'post';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_returned' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_review_requested' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_medical_review_requested' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_awaiting_client' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_assigned' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_approved' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_publish_today' BEFORE 'client_account_manager_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_publish_overdue' BEFORE 'client_account_manager_assigned';--> statement-breakpoint
CREATE TABLE "content_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" "post_type" NOT NULL,
	"platforms" "post_platform"[] NOT NULL,
	"caption" text,
	"hashtags" text,
	"notes" text,
	"publish_date" date NOT NULL,
	"publish_time" time,
	"status" "post_status" DEFAULT 'idea' NOT NULL,
	"review_stage" "review_stage",
	"needs_client_approval" boolean DEFAULT true NOT NULL,
	"responsible_id" uuid NOT NULL,
	"cycle_line_id" uuid,
	"cleared_review_id" uuid,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by_id" uuid,
	"published_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "content_posts_review_stage_check" CHECK (("content_posts"."status" = 'internal_review') = ("content_posts"."review_stage" is not null)),
	CONSTRAINT "content_posts_title_check" CHECK (char_length("content_posts"."title") between 1 and 160),
	CONSTRAINT "content_posts_platforms_check" CHECK (cardinality("content_posts"."platforms") between 1 and 8),
	CONSTRAINT "content_posts_text_check" CHECK (char_length("content_posts"."caption") between 1 and 5000
        and char_length("content_posts"."hashtags") between 1 and 1000
        and char_length("content_posts"."notes") between 1 and 2000),
	CONSTRAINT "content_posts_published_check" CHECK (("content_posts"."status" = 'published') = ("content_posts"."published_at" is not null)
        and ("content_posts"."published_at" is null) = ("content_posts"."published_by_id" is null)),
	CONSTRAINT "content_posts_cancelled_check" CHECK (("content_posts"."status" = 'cancelled') = ("content_posts"."cancelled_at" is not null)
        and ("content_posts"."cancelled_at" is null) = ("content_posts"."cancel_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "post_client_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"decision" "client_decision" NOT NULL,
	"channel" "response_channel" NOT NULL,
	"contact_id" uuid NOT NULL,
	"note" text,
	"review_id" uuid NOT NULL,
	"approval_item_id" uuid,
	"recorded_by_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_client_responses_channel_check" CHECK (case when "post_client_responses"."channel" = 'manual'
        then "post_client_responses"."recorded_by_id" is not null and "post_client_responses"."ip" is null and "post_client_responses"."user_agent" is null
        else "post_client_responses"."recorded_by_id" is null and "post_client_responses"."approval_item_id" is not null end),
	CONSTRAINT "post_client_responses_decision_check" CHECK ("post_client_responses"."decision" <> 'changes_requested' or "post_client_responses"."note" is not null),
	CONSTRAINT "post_client_responses_user_agent_check" CHECK (char_length("post_client_responses"."user_agent") <= 500)
);
--> statement-breakpoint
CREATE TABLE "post_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"stage" "review_stage" NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"note" text,
	"reviewer_id" uuid,
	"version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"caption" text,
	"hashtags" text,
	"type" "post_type",
	"platforms" "post_platform"[] DEFAULT '{}'::post_platform[] NOT NULL,
	"publish_date" date,
	"publish_time" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reviews_outcome_check" CHECK (case when "post_reviews"."outcome" = 'returned'
        then "post_reviews"."note" is not null and "post_reviews"."version_ids" = '{}'
          and "post_reviews"."caption" is null and "post_reviews"."hashtags" is null
          and "post_reviews"."type" is null and "post_reviews"."publish_date" is null
        else "post_reviews"."type" is not null and "post_reviews"."publish_date" is not null end)
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_responsible_id_users_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_cycle_line_id_retainer_cycle_lines_id_fk" FOREIGN KEY ("cycle_line_id") REFERENCES "public"."retainer_cycle_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_cleared_review_id_post_reviews_id_fk" FOREIGN KEY ("cleared_review_id") REFERENCES "public"."post_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_client_responses" ADD CONSTRAINT "post_client_responses_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_client_responses" ADD CONSTRAINT "post_client_responses_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_client_responses" ADD CONSTRAINT "post_client_responses_review_id_post_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."post_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_client_responses" ADD CONSTRAINT "post_client_responses_approval_item_id_approval_items_id_fk" FOREIGN KEY ("approval_item_id") REFERENCES "public"."approval_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_client_responses" ADD CONSTRAINT "post_client_responses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD CONSTRAINT "post_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_posts_client_id_idx" ON "content_posts" USING btree ("client_id","publish_date");--> statement-breakpoint
CREATE INDEX "content_posts_publish_date_idx" ON "content_posts" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "content_posts_status_idx" ON "content_posts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_posts_responsible_id_idx" ON "content_posts" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "content_posts_cycle_line_id_idx" ON "content_posts" USING btree ("cycle_line_id");--> statement-breakpoint
CREATE INDEX "content_posts_cleared_review_id_idx" ON "content_posts" USING btree ("cleared_review_id");--> statement-breakpoint
CREATE INDEX "content_posts_published_by_id_idx" ON "content_posts" USING btree ("published_by_id");--> statement-breakpoint
CREATE INDEX "content_posts_created_by_id_idx" ON "content_posts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "post_client_responses_post_id_idx" ON "post_client_responses" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_client_responses_contact_id_idx" ON "post_client_responses" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "post_client_responses_review_id_idx" ON "post_client_responses" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "post_client_responses_approval_item_id_idx" ON "post_client_responses" USING btree ("approval_item_id");--> statement-breakpoint
CREATE INDEX "post_client_responses_recorded_by_id_idx" ON "post_client_responses" USING btree ("recorded_by_id");--> statement-breakpoint
CREATE INDEX "post_reviews_post_id_idx" ON "post_reviews" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_reviews_reviewer_id_idx" ON "post_reviews" USING btree ("reviewer_id");--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_post_id_idx" ON "file_items" USING btree ("post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."post_id" is null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable'));