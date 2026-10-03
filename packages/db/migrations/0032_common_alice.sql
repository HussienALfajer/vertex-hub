CREATE TYPE "public"."pdf_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "statement_pdfs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"status" "pdf_status" NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pdf_status" "pdf_status";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "pdf_file_item_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft_pdf_status" "pdf_status";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft_pdf_requested_hash" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft_pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft_pdf_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "draft_pdf_hash" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_pdf_status" "pdf_status";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "receipt_file_item_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_pdfs" ADD CONSTRAINT "statement_pdfs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_pdfs_hash_idx" ON "statement_pdfs" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "statement_pdfs_client_id_idx" ON "statement_pdfs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "statement_pdfs_requested_at_idx" ON "statement_pdfs" USING btree ("requested_at");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdf_file_item_id_file_items_id_fk" FOREIGN KEY ("pdf_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_file_item_id_file_items_id_fk" FOREIGN KEY ("receipt_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_pdf_file_item_id_idx" ON "invoices" USING btree ("pdf_file_item_id");--> statement-breakpoint
CREATE INDEX "payments_receipt_file_item_id_idx" ON "payments" USING btree ("receipt_file_item_id");