CREATE TYPE "public"."checklist_item_kind" AS ENUM('checklist', 'criterion');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('open', 'answered');--> statement-breakpoint
CREATE TYPE "public"."task_comment_kind" AS ENUM('comment', 'question');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_question_asked' BEFORE 'task_blocked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_question_answered' BEFORE 'task_blocked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_question_reminder' BEFORE 'task_blocked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_question_escalated' BEFORE 'task_blocked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_question_converted' BEFORE 'task_blocked';--> statement-breakpoint
ALTER TYPE "public"."timed_reminder_kind" ADD VALUE 'question_reminder';--> statement-breakpoint
ALTER TYPE "public"."timed_reminder_kind" ADD VALUE 'question_escalation';--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "task_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD COLUMN "kind" "checklist_item_kind" DEFAULT 'checklist' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "body_doc" jsonb;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "kind" "task_comment_kind" DEFAULT 'comment' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "question_id" uuid;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "addressed_user_id" uuid;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "addressed_department" "department_code";--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "question_status" "question_status";--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "clock_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "answered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "answered_by_id" uuid;--> statement-breakpoint
ALTER TABLE "task_comments" ADD COLUMN "converted_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "brief_doc" jsonb;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_task_comment_id_task_comments_id_fk" FOREIGN KEY ("task_comment_id") REFERENCES "public"."task_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_question_id_task_comments_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."task_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_addressed_user_id_users_id_fk" FOREIGN KEY ("addressed_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_answered_by_id_users_id_fk" FOREIGN KEY ("answered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_converted_task_id_tasks_id_fk" FOREIGN KEY ("converted_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_task_comment_id_idx" ON "file_items" USING btree ("task_comment_id");--> statement-breakpoint
CREATE INDEX "task_comments_question_id_idx" ON "task_comments" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "task_comments_addressed_user_id_idx" ON "task_comments" USING btree ("addressed_user_id");--> statement-breakpoint
CREATE INDEX "task_comments_answered_by_id_idx" ON "task_comments" USING btree ("answered_by_id");--> statement-breakpoint
CREATE INDEX "task_comments_converted_task_id_idx" ON "task_comments" USING btree ("converted_task_id");--> statement-breakpoint
CREATE INDEX "task_comments_open_questions_idx" ON "task_comments" USING btree ("clock_started_at") WHERE "task_comments"."kind" = 'question' and "task_comments"."question_status" = 'open' and "task_comments"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "retainer_contract_id", "announcement_id", "employee_id", "hr_request_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference' and "file_items"."task_comment_id" is null;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_task_comment_check" CHECK (("file_items"."task_comment_id" is not null) = ("file_items"."owner_type" = 'task' and "file_items"."role" = 'attachment'));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference', 'attachment'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'announcement' and "file_items"."role"::text = 'attachment')
        or ("file_items"."owner_type"::text in ('employee', 'hr_request') and "file_items"."role" = 'document'));--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_question_check" CHECK (case when "task_comments"."kind" = 'question'
        then ("task_comments"."addressed_user_id" is not null or "task_comments"."addressed_department" is not null)
          and "task_comments"."question_status" is not null and "task_comments"."clock_started_at" is not null
          and "task_comments"."question_id" is null
        else "task_comments"."addressed_user_id" is null and "task_comments"."addressed_department" is null
          and "task_comments"."question_status" is null and "task_comments"."clock_started_at" is null
          and "task_comments"."answered_at" is null and "task_comments"."answered_by_id" is null end);--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_answered_check" CHECK (("task_comments"."answered_at" is null) = ("task_comments"."answered_by_id" is null)
        and ("task_comments"."question_status" = 'answered') = ("task_comments"."answered_at" is not null));