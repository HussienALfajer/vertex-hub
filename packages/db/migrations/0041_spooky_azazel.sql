CREATE TABLE "client_report_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"month" date NOT NULL,
	"summary" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_report_notes_month_check" CHECK (extract(day from "client_report_notes"."month") = 1),
	CONSTRAINT "client_report_notes_summary_check" CHECK (char_length("client_report_notes"."summary") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "client_report_pdfs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"month" date NOT NULL,
	"hash" text NOT NULL,
	"status" "pdf_status" NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_report_notes" ADD CONSTRAINT "client_report_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_report_notes" ADD CONSTRAINT "client_report_notes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_report_pdfs" ADD CONSTRAINT "client_report_pdfs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_report_notes_client_month_idx" ON "client_report_notes" USING btree ("client_id","month");--> statement-breakpoint
CREATE INDEX "client_report_notes_updated_by_id_idx" ON "client_report_notes" USING btree ("updated_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_report_pdfs_hash_idx" ON "client_report_pdfs" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "client_report_pdfs_client_id_idx" ON "client_report_pdfs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_report_pdfs_requested_at_idx" ON "client_report_pdfs" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "content_posts_published_at_idx" ON "content_posts" USING btree ("published_at");