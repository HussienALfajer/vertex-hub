CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'e_wallet');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'invoice_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'invoice_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'invoice_paid';--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"paid_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"syp_per_usd" numeric(12, 4) NOT NULL,
	"applied_minor" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"note" text,
	"proof_file_item_id" uuid,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	CONSTRAINT "payments_amounts_check" CHECK ("payments"."amount_minor" > 0 and "payments"."applied_minor" > 0),
	CONSTRAINT "payments_rate_check" CHECK ("payments"."syp_per_usd" > 0),
	CONSTRAINT "payments_reference_check" CHECK (char_length("payments"."reference") <= 200),
	CONSTRAINT "payments_note_check" CHECK (char_length("payments"."note") <= 500),
	CONSTRAINT "payments_void_check" CHECK (("payments"."voided_at" is null) = ("payments"."void_reason" is null) and char_length("payments"."void_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_file_item_id_file_items_id_fk" FOREIGN KEY ("proof_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_number_idx" ON "payments" USING btree ("year","number");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_proof_file_item_id_idx" ON "payments" USING btree ("proof_file_item_id");--> statement-breakpoint
CREATE INDEX "payments_recorded_by_id_idx" ON "payments" USING btree ("recorded_by_id");--> statement-breakpoint
CREATE INDEX "payments_voided_by_id_idx" ON "payments" USING btree ("voided_by_id");--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_invoice_id_idx" ON "file_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."quote_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."invoice_id" is null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null and "file_items"."post_id" is null and "file_items"."quote_id" is null));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."role" = 'document'));