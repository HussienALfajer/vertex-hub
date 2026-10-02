CREATE TYPE "public"."quote_pdf_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'quote';--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_status" "quote_pdf_status";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_file_item_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "draft_pdf_status" "quote_pdf_status";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "draft_pdf_requested_hash" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "draft_pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "draft_pdf_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "draft_pdf_hash" text;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_pdf_file_item_id_file_items_id_fk" FOREIGN KEY ("pdf_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_quote_id_idx" ON "file_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_pdf_file_item_id_idx" ON "quotes" USING btree ("pdf_file_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."quote_id" is null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document'));