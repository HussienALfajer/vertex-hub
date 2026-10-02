ALTER TYPE "public"."notification_type" ADD VALUE 'quote_accepted';--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "retainer_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD COLUMN "revision_limit" integer;--> statement-breakpoint
ALTER TABLE "retainer_deliverables" ADD COLUMN "revision_limit" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_project_id_idx" ON "quotes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "quotes_retainer_id_idx" ON "quotes" USING btree ("retainer_id");--> statement-breakpoint
ALTER TABLE "retainer_cycle_lines" ADD CONSTRAINT "retainer_cycle_lines_revision_limit_check" CHECK ("retainer_cycle_lines"."revision_limit" between 0 and 20);--> statement-breakpoint
ALTER TABLE "retainer_deliverables" ADD CONSTRAINT "retainer_deliverables_revision_limit_check" CHECK ("retainer_deliverables"."revision_limit" between 0 and 20);