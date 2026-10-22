ALTER TABLE "leave_ledger" ADD COLUMN "item_id" uuid;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_item_id_attendance_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."attendance_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_ledger_item_id_idx" ON "leave_ledger" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_item_check" CHECK (("leave_ledger"."entry"::text = 'overtime_credit') = ("leave_ledger"."item_id" is not null));