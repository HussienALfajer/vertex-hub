ALTER TABLE "retainer_templates" ALTER COLUMN "linked_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_amendments_template_id_idx" ON "retainer_amendments" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "retainer_amendments" ADD CONSTRAINT "retainer_amendments_template_check" CHECK ("retainer_amendments"."template_id" is null or "retainer_amendments"."kind" = 'quote_renewal');