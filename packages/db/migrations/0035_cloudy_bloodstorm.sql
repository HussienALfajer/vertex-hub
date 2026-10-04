ALTER TABLE "ad_wallet_entries" ADD COLUMN "receipt_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD COLUMN "receipt_pdf_status" "pdf_status";--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD COLUMN "receipt_file_item_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_receipt_file_item_id_file_items_id_fk" FOREIGN KEY ("receipt_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_wallet_entries_receipt_file_item_id_idx" ON "ad_wallet_entries" USING btree ("receipt_file_item_id");--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_receipt_check" CHECK ("ad_wallet_entries"."kind" = 'deposit' or ("ad_wallet_entries"."receipt_snapshot" is null and "ad_wallet_entries"."receipt_pdf_status" is null and "ad_wallet_entries"."receipt_file_item_id" is null));