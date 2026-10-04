ALTER TABLE "invoice_lines" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_service_id_catalog_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."catalog_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_service_id_idx" ON "invoice_lines" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "invoices_issued_on_idx" ON "invoices" USING btree ("issued_on");--> statement-breakpoint
CREATE INDEX "payments_paid_on_idx" ON "payments" USING btree ("paid_on");--> statement-breakpoint
CREATE INDEX "tasks_delivered_at_idx" ON "tasks" USING btree ("delivered_at");