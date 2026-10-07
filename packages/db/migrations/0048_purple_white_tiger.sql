CREATE TYPE "public"."term_end_action" AS ENUM('renew', 'end', 'continue');--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('scheduled', 'active', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_term_renewed' BEFORE 'quote_approval_requested';--> statement-breakpoint
CREATE TABLE "retainer_terms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"retainer_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"start_month" date NOT NULL,
	"months" integer NOT NULL,
	"end_month" date NOT NULL,
	"agreed_total_minor" bigint NOT NULL,
	"end_action" "term_end_action" DEFAULT 'renew' NOT NULL,
	"status" "term_status" NOT NULL,
	"renewed_from_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retainer_terms_months_check" CHECK ("retainer_terms"."months" between 1 and 36),
	CONSTRAINT "retainer_terms_agreed_total_check" CHECK ("retainer_terms"."agreed_total_minor" >= 0),
	CONSTRAINT "retainer_terms_start_month_check" CHECK (extract(day from "retainer_terms"."start_month") = 1),
	CONSTRAINT "retainer_terms_end_month_check" CHECK ("retainer_terms"."end_month" >= "retainer_terms"."start_month")
);
--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "term_id" uuid;--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD COLUMN "base_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_terms" ADD CONSTRAINT "retainer_terms_renewed_from_id_retainer_terms_id_fk" FOREIGN KEY ("renewed_from_id") REFERENCES "public"."retainer_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_terms_retainer_number_idx" ON "retainer_terms" USING btree ("retainer_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_terms_active_idx" ON "retainer_terms" USING btree ("retainer_id") WHERE "retainer_terms"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "retainer_terms_scheduled_idx" ON "retainer_terms" USING btree ("retainer_id") WHERE "retainer_terms"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "retainer_terms_renewed_from_id_idx" ON "retainer_terms" USING btree ("renewed_from_id");--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_term_id_retainer_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."retainer_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_charges_term_id_idx" ON "retainer_charges" USING btree ("term_id");--> statement-breakpoint
ALTER TABLE "retainer_charges" ADD CONSTRAINT "retainer_charges_term_check" CHECK (("retainer_charges"."term_id" is null and "retainer_charges"."base_amount_minor" is null) or ("retainer_charges"."kind" = 'monthly' and "retainer_charges"."base_amount_minor" >= 0));