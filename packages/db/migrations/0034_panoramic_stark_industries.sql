CREATE TYPE "public"."ad_wallet_entry_kind" AS ENUM('deposit', 'refund');--> statement-breakpoint
ALTER TYPE "public"."file_owner_type" ADD VALUE 'ad_wallet_entry';--> statement-breakpoint
ALTER TYPE "public"."document_number_kind" ADD VALUE 'ad_deposit';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'ad_budget_low';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'ad_budget_low';--> statement-breakpoint
CREATE TABLE "ad_wallet_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "ad_wallet_entry_kind" NOT NULL,
	"year" integer,
	"number" integer,
	"occurred_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"syp_per_usd" numeric(12, 4) NOT NULL,
	"usd_minor" bigint NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"note" text,
	"proof_file_item_id" uuid,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_id" uuid,
	"void_reason" text,
	CONSTRAINT "ad_wallet_entries_number_check" CHECK (("ad_wallet_entries"."kind" = 'deposit') = ("ad_wallet_entries"."year" is not null) and ("ad_wallet_entries"."year" is null) = ("ad_wallet_entries"."number" is null)),
	CONSTRAINT "ad_wallet_entries_amounts_check" CHECK ("ad_wallet_entries"."amount_minor" > 0 and "ad_wallet_entries"."usd_minor" > 0),
	CONSTRAINT "ad_wallet_entries_rate_check" CHECK ("ad_wallet_entries"."syp_per_usd" > 0),
	CONSTRAINT "ad_wallet_entries_reference_check" CHECK (char_length("ad_wallet_entries"."reference") <= 200),
	CONSTRAINT "ad_wallet_entries_note_check" CHECK (char_length("ad_wallet_entries"."note") <= 500),
	CONSTRAINT "ad_wallet_entries_void_check" CHECK (("ad_wallet_entries"."voided_at" is null) = ("ad_wallet_entries"."void_reason" is null) and ("ad_wallet_entries"."voided_at" is null) = ("ad_wallet_entries"."voided_by_id" is null) and char_length("ad_wallet_entries"."void_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ad_wallets" (
	"client_id" uuid PRIMARY KEY NOT NULL,
	"low_balance_threshold_minor" bigint DEFAULT 10000,
	"low_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "ad_wallets_threshold_check" CHECK ("ad_wallets"."low_balance_threshold_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_owner_check";--> statement-breakpoint
ALTER TABLE "file_items" DROP CONSTRAINT "file_items_role_check";--> statement-breakpoint
DROP INDEX "file_items_name_unique";--> statement-breakpoint
ALTER TABLE "file_items" ADD COLUMN "ad_wallet_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_proof_file_item_id_file_items_id_fk" FOREIGN KEY ("proof_file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_wallet_entries" ADD CONSTRAINT "ad_wallet_entries_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_wallets" ADD CONSTRAINT "ad_wallets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_wallets" ADD CONSTRAINT "ad_wallets_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_wallet_entries_number_idx" ON "ad_wallet_entries" USING btree ("year","number");--> statement-breakpoint
CREATE INDEX "ad_wallet_entries_client_id_occurred_on_idx" ON "ad_wallet_entries" USING btree ("client_id","occurred_on");--> statement-breakpoint
CREATE INDEX "ad_wallet_entries_proof_file_item_id_idx" ON "ad_wallet_entries" USING btree ("proof_file_item_id");--> statement-breakpoint
CREATE INDEX "ad_wallet_entries_recorded_by_id_idx" ON "ad_wallet_entries" USING btree ("recorded_by_id");--> statement-breakpoint
CREATE INDEX "ad_wallet_entries_voided_by_id_idx" ON "ad_wallet_entries" USING btree ("voided_by_id");--> statement-breakpoint
CREATE INDEX "ad_wallets_updated_by_id_idx" ON "ad_wallets" USING btree ("updated_by_id");--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_ad_wallet_entry_id_ad_wallet_entries_id_fk" FOREIGN KEY ("ad_wallet_entry_id") REFERENCES "public"."ad_wallet_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_ad_wallet_entry_id_idx" ON "file_items" USING btree ("ad_wallet_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "post_id", "quote_id", "invoice_id", "ad_wallet_entry_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_owner_check" CHECK (num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id") <= 1 and (
        ("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and num_nonnulls("file_items"."task_id", "file_items"."project_id", "file_items"."retainer_id", "file_items"."post_id", "file_items"."quote_id", "file_items"."invoice_id", "file_items"."ad_wallet_entry_id") = 0)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'post' and "file_items"."post_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."quote_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'invoice' and "file_items"."invoice_id" is not null and "file_items"."client_id" is not null)
        or ("file_items"."owner_type"::text = 'ad_wallet_entry' and "file_items"."ad_wallet_entry_id" is not null and "file_items"."client_id" is not null)));--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text = 'post' and "file_items"."role" = 'deliverable')
        or ("file_items"."owner_type"::text = 'quote' and "file_items"."role" = 'document')
        or ("file_items"."owner_type"::text in ('invoice', 'ad_wallet_entry') and "file_items"."role" = 'document'));