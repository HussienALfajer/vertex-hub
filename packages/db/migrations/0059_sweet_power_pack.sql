CREATE TYPE "public"."contract_annex_status" AS ENUM('issued', 'signed', 'void');--> statement-breakpoint
CREATE TYPE "public"."contract_kind" AS ENUM('term', 'open_ended');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'issued', 'signed', 'void');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'retainer_contract';--> statement-breakpoint
ALTER TYPE "public"."document_number_kind" ADD VALUE 'contract';--> statement-breakpoint
CREATE TABLE "retainer_contract_annexes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"amendment_id" uuid NOT NULL,
	"annex_number" integer NOT NULL,
	"status" "contract_annex_status" DEFAULT 'issued' NOT NULL,
	"annex_date" date NOT NULL,
	"snapshot" jsonb NOT NULL,
	"pdf_status" "pdf_status" DEFAULT 'pending' NOT NULL,
	"pdf_file_item_id" uuid,
	"signed_on" date,
	"signed_file_item_id" uuid,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"issued_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "retainer_contract_annexes_number_check" CHECK ("retainer_contract_annexes"."annex_number" >= 1),
	CONSTRAINT "retainer_contract_annexes_void_reason_check" CHECK ("retainer_contract_annexes"."void_reason" is null or char_length("retainer_contract_annexes"."void_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "retainer_contract_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retainer_contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"kind" "contract_kind" NOT NULL,
	"term_id" uuid,
	"start_cycle" integer NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"number" text,
	"contract_date" date NOT NULL,
	"signatory_contact_id" uuid,
	"snapshot" jsonb,
	"pdf_status" "pdf_status",
	"pdf_file_item_id" uuid,
	"draft_pdf_status" "pdf_status",
	"draft_pdf_requested_hash" text,
	"draft_pdf_object_key" text,
	"draft_pdf_at" timestamp with time zone,
	"draft_pdf_hash" text,
	"signed_on" date,
	"signed_file_item_id" uuid,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"issued_at" timestamp with time zone,
	"issued_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "retainer_contracts_term_check" CHECK (("retainer_contracts"."kind" = 'term') = ("retainer_contracts"."term_id" is not null)),
	CONSTRAINT "retainer_contracts_start_cycle_check" CHECK ("retainer_contracts"."start_cycle" >= 1),
	CONSTRAINT "retainer_contracts_issued_check" CHECK (("retainer_contracts"."status" = 'draft') = ("retainer_contracts"."number" is null) and ("retainer_contracts"."status" = 'draft') = ("retainer_contracts"."snapshot" is null)),
	CONSTRAINT "retainer_contracts_archived_check" CHECK ("retainer_contracts"."archived_at" is null or "retainer_contracts"."status" = 'draft'),
	CONSTRAINT "retainer_contracts_void_reason_check" CHECK ("retainer_contracts"."void_reason" is null or char_length("retainer_contracts"."void_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "retainer_contract_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_contract_id_retainer_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."retainer_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_amendment_id_retainer_amendments_id_fk" FOREIGN KEY ("amendment_id") REFERENCES "public"."retainer_amendments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_pdf_file_item_id_file_items_id_fk" FOREIGN KEY ("pdf_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_signed_file_item_id_file_items_id_fk" FOREIGN KEY ("signed_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_annexes" ADD CONSTRAINT "retainer_contract_annexes_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contract_articles" ADD CONSTRAINT "retainer_contract_articles_contract_id_retainer_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."retainer_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_term_id_retainer_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."retainer_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_signatory_contact_id_client_contacts_id_fk" FOREIGN KEY ("signatory_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_pdf_file_item_id_file_items_id_fk" FOREIGN KEY ("pdf_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_signed_file_item_id_file_items_id_fk" FOREIGN KEY ("signed_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_contracts" ADD CONSTRAINT "retainer_contracts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_contract_id_idx" ON "retainer_contract_annexes" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_amendment_id_idx" ON "retainer_contract_annexes" USING btree ("amendment_id");--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_pdf_file_item_id_idx" ON "retainer_contract_annexes" USING btree ("pdf_file_item_id");--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_signed_file_item_id_idx" ON "retainer_contract_annexes" USING btree ("signed_file_item_id");--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_voided_by_id_idx" ON "retainer_contract_annexes" USING btree ("voided_by_id");--> statement-breakpoint
CREATE INDEX "retainer_contract_annexes_issued_by_id_idx" ON "retainer_contract_annexes" USING btree ("issued_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_contract_annexes_number_idx" ON "retainer_contract_annexes" USING btree ("contract_id","annex_number");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_contract_annexes_amendment_unique" ON "retainer_contract_annexes" USING btree ("amendment_id") WHERE "retainer_contract_annexes"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "retainer_contract_articles_contract_id_idx" ON "retainer_contract_articles" USING btree ("contract_id","position");--> statement-breakpoint
CREATE INDEX "retainer_contracts_retainer_id_idx" ON "retainer_contracts" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_term_id_idx" ON "retainer_contracts" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_signatory_contact_id_idx" ON "retainer_contracts" USING btree ("signatory_contact_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_pdf_file_item_id_idx" ON "retainer_contracts" USING btree ("pdf_file_item_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_signed_file_item_id_idx" ON "retainer_contracts" USING btree ("signed_file_item_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_voided_by_id_idx" ON "retainer_contracts" USING btree ("voided_by_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_issued_by_id_idx" ON "retainer_contracts" USING btree ("issued_by_id");--> statement-breakpoint
CREATE INDEX "retainer_contracts_created_by_id_idx" ON "retainer_contracts" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_contracts_number_idx" ON "retainer_contracts" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_contracts_term_unique" ON "retainer_contracts" USING btree ("term_id") WHERE "retainer_contracts"."status" <> 'void' and "retainer_contracts"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_contracts_open_ended_unique" ON "retainer_contracts" USING btree ("retainer_id","start_cycle") WHERE "retainer_contracts"."kind" = 'open_ended' and "retainer_contracts"."status" <> 'void' and "retainer_contracts"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_retainer_contract_id_retainer_contracts_id_fk" FOREIGN KEY ("retainer_contract_id") REFERENCES "public"."retainer_contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_retainer_contract_id_idx" ON "file_items" USING btree ("retainer_contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "retainer_contract_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id") <= 1 and (
        ("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id", "file_items"."retainer_contract_id") = 0)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'ad_wallet_entry' and "file_items"."ad_wallet_entry_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'retainer_contract' and "file_items"."retainer_contract_id" is not null and "file_items"."client_id" is not null)));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry', 'retainer_contract') and "file_items"."role" = 'document'));