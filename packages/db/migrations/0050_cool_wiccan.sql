ALTER TABLE "retainer_amendments" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD COLUMN "fee_minor" bigint;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_amendments_quote_id_idx" ON "retainer_amendments" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "retainer_terms_quote_id_idx" ON "retainer_terms" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_quote_check" CHECK (("retainer_amendments"."kind" = 'quote_renewal') = ("retainer_amendments"."quote_id" is not null and "retainer_amendments"."fee_minor" is not null) and coalesce("retainer_amendments"."fee_minor", 0) >= 0);