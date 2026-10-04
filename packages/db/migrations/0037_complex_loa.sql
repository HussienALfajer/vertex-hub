ALTER TABLE "quotes" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_object_key" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_lead_id_idx" ON "quotes" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_recipient_check" CHECK ("quotes"."client_id" is not null or "quotes"."lead_id" is not null);