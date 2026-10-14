CREATE TABLE "contract_article_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contract_settings" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"trade_name" text DEFAULT '' NOT NULL,
	"company_type" text DEFAULT '' NOT NULL,
	"registration_number" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"representative_name" text DEFAULT '' NOT NULL,
	"representative_title" text DEFAULT '' NOT NULL,
	"slogan" text DEFAULT 'نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.' NOT NULL,
	"number_prefix" text DEFAULT 'VM-CCS' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_id" uuid,
	CONSTRAINT "contract_settings_singleton_check" CHECK ("contract_settings"."singleton"),
	CONSTRAINT "contract_settings_number_prefix_check" CHECK ("contract_settings"."number_prefix" ~ '^[A-Z0-9-]{2,20}$')
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "father_name" text;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "national_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "registration_number" text;--> statement-breakpoint
ALTER TABLE "contract_settings" ADD CONSTRAINT "contract_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_article_templates_position_idx" ON "contract_article_templates" USING btree ("position") WHERE "contract_article_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contract_settings_updated_by_id_idx" ON "contract_settings" USING btree ("updated_by_id");