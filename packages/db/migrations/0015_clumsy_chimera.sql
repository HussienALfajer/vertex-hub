CREATE TYPE "public"."approval_item_status" AS ENUM('pending', 'approved', 'changes_requested', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."approval_withdrawn_reason" AS ENUM('revoked', 'resent', 'task_moved');--> statement-breakpoint
CREATE TYPE "public"."client_decision" AS ENUM('approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."response_channel" AS ENUM('link', 'manual');--> statement-breakpoint
CREATE TYPE "public"."review_outcome" AS ENUM('passed', 'returned');--> statement-breakpoint
CREATE TYPE "public"."review_stage" AS ENUM('internal', 'medical');--> statement-breakpoint
ALTER TYPE "public"."file_final_source" ADD VALUE 'client';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'approval_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_medical_review_requested' BEFORE 'task_awaiting_client';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_responded' BEFORE 'task_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_no_response' BEFORE 'task_changed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'approval_expired' BEFORE 'task_changed';--> statement-breakpoint
ALTER TYPE "public"."revision_source" ADD VALUE 'medical';--> statement-breakpoint
CREATE TABLE "approval_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"review_id" uuid NOT NULL,
	"status" "approval_item_status" DEFAULT 'pending' NOT NULL,
	"response_id" uuid,
	"withdrawn_reason" "approval_withdrawn_reason",
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_items_title_check" CHECK (char_length("approval_items"."title") between 1 and 160),
	CONSTRAINT "approval_items_position_check" CHECK ("approval_items"."position" >= 1),
	CONSTRAINT "approval_items_status_check" CHECK (("approval_items"."status" = 'pending') = ("approval_items"."closed_at" is null)
        and ("approval_items"."status" in ('approved', 'changes_requested')) = ("approval_items"."response_id" is not null)
        and ("approval_items"."status" = 'withdrawn') = ("approval_items"."withdrawn_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"message" text,
	"token_hash" text NOT NULL,
	"link_issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reminded_at" timestamp with time zone,
	"expiry_notified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"completed_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "approval_requests_message_check" CHECK (char_length("approval_requests"."message") between 1 and 1000),
	CONSTRAINT "approval_requests_revoked_check" CHECK (("approval_requests"."revoked_at" is null) = ("approval_requests"."revoked_by_id" is null))
);
--> statement-breakpoint
CREATE TABLE "task_client_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"decision" "client_decision" NOT NULL,
	"channel" "response_channel" NOT NULL,
	"contact_id" uuid NOT NULL,
	"note" text,
	"review_id" uuid NOT NULL,
	"approval_item_id" uuid,
	"revision_id" uuid,
	"recorded_by_id" uuid,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_client_responses_channel_check" CHECK (case when "task_client_responses"."channel" = 'manual'
        then "task_client_responses"."recorded_by_id" is not null and "task_client_responses"."ip" is null and "task_client_responses"."user_agent" is null
        else "task_client_responses"."recorded_by_id" is null and "task_client_responses"."approval_item_id" is not null end),
	CONSTRAINT "task_client_responses_decision_check" CHECK (case when "task_client_responses"."decision" = 'changes_requested'
        then "task_client_responses"."note" is not null and "task_client_responses"."revision_id" is not null
        else "task_client_responses"."revision_id" is null end),
	CONSTRAINT "task_client_responses_user_agent_check" CHECK (char_length("task_client_responses"."user_agent") <= 500)
);
--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"stage" "review_stage" NOT NULL,
	"outcome" "review_outcome" NOT NULL,
	"note" text,
	"reviewer_id" uuid,
	"version_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"client_text" text,
	"revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_reviews_outcome_check" CHECK (case when "task_reviews"."outcome" = 'returned'
        then "task_reviews"."note" is not null and "task_reviews"."revision_id" is not null
          and "task_reviews"."version_ids" = '{}' and "task_reviews"."client_text" is null
        else "task_reviews"."revision_id" is null end)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_stage" "review_stage";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "client_text" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "cleared_review_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_review_id_task_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."task_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_response_id_task_client_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."task_client_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_review_id_task_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."task_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_approval_item_id_approval_items_id_fk" FOREIGN KEY ("approval_item_id") REFERENCES "public"."approval_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_revision_id_task_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."task_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_client_responses" ADD CONSTRAINT "task_client_responses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_revision_id_task_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."task_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_items_request_id_idx" ON "approval_items" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "approval_items_task_id_idx" ON "approval_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "approval_items_review_id_idx" ON "approval_items" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "approval_items_response_id_idx" ON "approval_items" USING btree ("response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_items_pending_unique" ON "approval_items" USING btree ("task_id") WHERE "approval_items"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_requests_client_id_idx" ON "approval_requests" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_contact_id_idx" ON "approval_requests" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "approval_requests_revoked_by_id_idx" ON "approval_requests" USING btree ("revoked_by_id");--> statement-breakpoint
CREATE INDEX "approval_requests_created_by_id_idx" ON "approval_requests" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "approval_requests_expires_at_idx" ON "approval_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "task_client_responses_task_id_idx" ON "task_client_responses" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_client_responses_contact_id_idx" ON "task_client_responses" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "task_client_responses_review_id_idx" ON "task_client_responses" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "task_client_responses_approval_item_id_idx" ON "task_client_responses" USING btree ("approval_item_id");--> statement-breakpoint
CREATE INDEX "task_client_responses_revision_id_idx" ON "task_client_responses" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "task_client_responses_recorded_by_id_idx" ON "task_client_responses" USING btree ("recorded_by_id");--> statement-breakpoint
CREATE INDEX "task_reviews_task_id_idx" ON "task_reviews" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "task_reviews_reviewer_id_idx" ON "task_reviews" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "task_reviews_revision_id_idx" ON "task_reviews" USING btree ("revision_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cleared_review_id_task_reviews_id_fk" FOREIGN KEY ("cleared_review_id") REFERENCES "public"."task_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_cleared_review_id_idx" ON "tasks" USING btree ("cleared_review_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_text_check" CHECK (char_length("tasks"."client_text") between 1 and 10000);