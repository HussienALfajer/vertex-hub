ALTER TYPE "public"."approval_withdrawn_reason" ADD VALUE 'post_moved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_task_ready' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_task_unlinked' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TABLE "approval_items" DROP CONSTRAINT "approval_items_status_check";--> statement-breakpoint
ALTER TABLE "task_revisions" DROP CONSTRAINT "task_revisions_source_check";--> statement-breakpoint
ALTER TABLE "approval_items" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_items" ALTER COLUMN "review_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_items" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_items" ADD COLUMN "post_review_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_items" ADD COLUMN "post_response_id" uuid;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD COLUMN "post_response_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "post_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_post_review_id_post_reviews_id_fk" FOREIGN KEY ("post_review_id") REFERENCES "public"."post_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_post_response_id_post_client_responses_id_fk" FOREIGN KEY ("post_response_id") REFERENCES "public"."post_client_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_post_response_id_post_client_responses_id_fk" FOREIGN KEY ("post_response_id") REFERENCES "public"."post_client_responses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_items_post_id_idx" ON "approval_items" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "approval_items_post_review_id_idx" ON "approval_items" USING btree ("post_review_id");--> statement-breakpoint
CREATE INDEX "approval_items_post_response_id_idx" ON "approval_items" USING btree ("post_response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_items_post_pending_unique" ON "approval_items" USING btree ("post_id") WHERE "approval_items"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "task_revisions_post_response_unique" ON "task_revisions" USING btree ("post_response_id","task_id");--> statement-breakpoint
CREATE INDEX "tasks_post_id_idx" ON "tasks" USING btree ("post_id","post_linked_at");--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_kind_check" CHECK (case when "approval_items"."task_id" is not null
        then "approval_items"."review_id" is not null and "approval_items"."post_id" is null
          and "approval_items"."post_review_id" is null and "approval_items"."post_response_id" is null
        else "approval_items"."post_id" is not null and "approval_items"."post_review_id" is not null
          and "approval_items"."review_id" is null and "approval_items"."response_id" is null end);--> statement-breakpoint
ALTER TABLE "approval_items" ADD CONSTRAINT "approval_items_status_check" CHECK (("approval_items"."status" = 'pending') = ("approval_items"."closed_at" is null)
        and ("approval_items"."status" in ('approved', 'changes_requested'))
          = ("approval_items"."response_id" is not null or "approval_items"."post_response_id" is not null)
        and ("approval_items"."status" = 'withdrawn') = ("approval_items"."withdrawn_reason" is not null));--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_source_check" CHECK (case when "task_revisions"."source" = 'client' then "task_revisions"."number" >= 1
        else "task_revisions"."number" is null and "task_revisions"."contact_id" is null and not "task_revisions"."over_limit"
          and "task_revisions"."post_response_id" is null end);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_post_check" CHECK (("tasks"."post_id" is null) = ("tasks"."post_linked_at" is null)
        and ("tasks"."post_id" is null
          or ("tasks"."client_id" is not null and not "tasks"."needs_client_approval")));