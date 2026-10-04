CREATE TYPE "public"."lead_loss_reason" AS ENUM('price', 'timing', 'competitor', 'not_a_fit', 'no_response', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('instagram', 'facebook', 'tiktok', 'whatsapp', 'website', 'referral', 'paid_ad', 'event', 'walk_in', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'contacted', 'meeting', 'quote_sent', 'won', 'lost');--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'lead_follow_up_due';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'lead_follow_up_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'lead';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_won';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_follow_up_overdue';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'lead_follow_up_due';--> statement-breakpoint
CREATE TABLE "lead_interests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"service_id" uuid,
	"package_id" uuid,
	CONSTRAINT "lead_interests_item_check" CHECK (("lead_interests"."service_id" is null) <> ("lead_interests"."package_id" is null))
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "note_channel" NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "lead_notes_summary_check" CHECK (char_length("lead_notes"."summary") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_name" text NOT NULL,
	"company_name" text,
	"phone" text,
	"email" text,
	"social_handle" text,
	"source" "lead_source" NOT NULL,
	"source_detail" text,
	"request" text,
	"budget_minor" bigint,
	"budget_currency" "currency",
	"sector" text,
	"is_healthcare" boolean DEFAULT false NOT NULL,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid NOT NULL,
	"next_follow_up_on" date,
	"lost_reason" "lead_loss_reason",
	"lost_note" text,
	"closed_at" timestamp with time zone,
	"client_id" uuid,
	"converted_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "leads_contact_name_check" CHECK (char_length("leads"."contact_name") between 1 and 120),
	CONSTRAINT "leads_contact_method_check" CHECK ("leads"."phone" is not null or "leads"."email" is not null or "leads"."social_handle" is not null),
	CONSTRAINT "leads_budget_check" CHECK (("leads"."budget_minor" is null) = ("leads"."budget_currency" is null) and ("leads"."budget_minor" is null or "leads"."budget_minor" > 0)),
	CONSTRAINT "leads_follow_up_check" CHECK (("leads"."stage" in ('won', 'lost')) = ("leads"."next_follow_up_on" is null)),
	CONSTRAINT "leads_lost_check" CHECK (("leads"."stage" = 'lost') = ("leads"."lost_reason" is not null) and ("leads"."lost_note" is null or "leads"."stage" = 'lost')),
	CONSTRAINT "leads_won_check" CHECK (("leads"."stage" = 'won') = ("leads"."client_id" is not null) and ("leads"."stage" = 'won') = ("leads"."converted_by_id" is not null)),
	CONSTRAINT "leads_closed_at_check" CHECK (("leads"."stage" in ('won', 'lost')) = ("leads"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lead_interests" ADD CONSTRAINT "lead_interests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interests" ADD CONSTRAINT "lead_interests_service_id_catalog_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."catalog_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interests" ADD CONSTRAINT "lead_interests_package_id_catalog_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."catalog_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_by_id_users_id_fk" FOREIGN KEY ("converted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_interests_lead_id_idx" ON "lead_interests" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_interests_service_id_idx" ON "lead_interests" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "lead_interests_package_id_idx" ON "lead_interests" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_interests_lead_service_idx" ON "lead_interests" USING btree ("lead_id","service_id") WHERE "lead_interests"."service_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_interests_lead_package_idx" ON "lead_interests" USING btree ("lead_id","package_id") WHERE "lead_interests"."package_id" is not null;--> statement-breakpoint
CREATE INDEX "lead_notes_lead_id_idx" ON "lead_notes" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_notes_author_id_idx" ON "lead_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "leads_owner_id_idx" ON "leads" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "leads_next_follow_up_on_idx" ON "leads" USING btree ("next_follow_up_on");--> statement-breakpoint
CREATE INDEX "leads_closed_at_idx" ON "leads" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "leads_client_id_idx" ON "leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_converted_by_id_idx" ON "leads" USING btree ("converted_by_id");--> statement-breakpoint
CREATE INDEX "leads_created_by_id_idx" ON "leads" USING btree ("created_by_id");