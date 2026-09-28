CREATE TYPE "public"."client_platform" AS ENUM('instagram', 'facebook', 'tiktok', 'x', 'linkedin', 'youtube', 'snapchat', 'google_business', 'website', 'other');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."note_channel" AS ENUM('call', 'meeting', 'whatsapp', 'email', 'other');--> statement-breakpoint
CREATE TYPE "public"."platform_access" AS ENUM('granted', 'pending', 'none');--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"email" text,
	"has_final_approval" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"channel" "note_channel" NOT NULL,
	"contact_id" uuid,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "client_platform_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"platform" "client_platform" NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"agency_access" "platform_access" DEFAULT 'none' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"trade_name" text NOT NULL,
	"sector" text,
	"account_manager_id" uuid NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"is_healthcare" boolean DEFAULT false NOT NULL,
	"brand_kit" jsonb DEFAULT '{"colors":[],"fonts":[],"toneOfVoice":null,"forbiddenWords":[],"files":[],"references":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_platform_accounts" ADD CONSTRAINT "client_platform_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_notes_client_id_idx" ON "client_notes" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "client_notes_author_id_idx" ON "client_notes" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "client_notes_contact_id_idx" ON "client_notes" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "client_platform_accounts_client_id_idx" ON "client_platform_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_trade_name_idx" ON "clients" USING btree (lower("trade_name")) WHERE "clients"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "clients_sector_idx" ON "clients" USING btree (lower("sector"));--> statement-breakpoint
CREATE INDEX "clients_account_manager_id_idx" ON "clients" USING btree ("account_manager_id");--> statement-breakpoint
CREATE INDEX "clients_status_idx" ON "clients" USING btree ("status");