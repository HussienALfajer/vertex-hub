ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_cycle_report_ready' BEFORE 'retainer_amendment_pending';--> statement-breakpoint
CREATE TABLE "retainer_cycle_reports" (
	"cycle_id" uuid PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"pdf_status" "pdf_status",
	"storage_key" text,
	"hash" text,
	"size_bytes" bigint,
	"rendered_at" timestamp with time zone,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_cycle_reports_summary_check" CHECK (char_length("retainer_cycle_reports"."summary") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "retainer_cycle_reports" ADD CONSTRAINT "retainer_cycle_reports_cycle_id_retainer_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."retainer_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_cycle_reports" ADD CONSTRAINT "retainer_cycle_reports_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_cycle_reports_updated_by_id_idx" ON "retainer_cycle_reports" USING btree ("updated_by_id");