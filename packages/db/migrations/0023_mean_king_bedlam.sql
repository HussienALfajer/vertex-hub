CREATE TYPE "public"."catalog_billing" AS ENUM('one_off', 'monthly');--> statement-breakpoint
CREATE TABLE "catalog_package_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"package_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "catalog_package_items_quantity_check" CHECK ("catalog_package_items"."quantity" between 1 and 999)
);
--> statement-breakpoint
CREATE TABLE "catalog_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"billing" "catalog_billing" NOT NULL,
	"price_usd_minor" bigint NOT NULL,
	"price_syp_minor" bigint,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "catalog_packages_name_check" CHECK (char_length("catalog_packages"."name") between 1 and 120),
	CONSTRAINT "catalog_packages_price_usd_check" CHECK ("catalog_packages"."price_usd_minor" >= 0),
	CONSTRAINT "catalog_packages_price_syp_check" CHECK ("catalog_packages"."price_syp_minor" >= 0),
	CONSTRAINT "catalog_packages_template_check" CHECK ("catalog_packages"."template_id" is null or "catalog_packages"."billing" = 'monthly')
);
--> statement-breakpoint
CREATE TABLE "catalog_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"department" "department_code" NOT NULL,
	"billing" "catalog_billing" NOT NULL,
	"price_usd_minor" bigint NOT NULL,
	"price_syp_minor" bigint,
	"revision_rounds" integer DEFAULT 2 NOT NULL,
	"deliverable_kind" "deliverable_kind",
	"deliverable_label" text,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "catalog_services_name_check" CHECK (char_length("catalog_services"."name") between 1 and 120),
	CONSTRAINT "catalog_services_price_usd_check" CHECK ("catalog_services"."price_usd_minor" >= 0),
	CONSTRAINT "catalog_services_price_syp_check" CHECK ("catalog_services"."price_syp_minor" >= 0),
	CONSTRAINT "catalog_services_revision_rounds_check" CHECK ("catalog_services"."revision_rounds" between 0 and 20),
	CONSTRAINT "catalog_services_counted_check" CHECK ("catalog_services"."deliverable_kind" is null or "catalog_services"."billing" = 'monthly')
);
--> statement-breakpoint
ALTER TABLE "catalog_package_items" ADD CONSTRAINT "catalog_package_items_package_id_catalog_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."catalog_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_package_items" ADD CONSTRAINT "catalog_package_items_service_id_catalog_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."catalog_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_packages" ADD CONSTRAINT "catalog_packages_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_services" ADD CONSTRAINT "catalog_services_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_package_items_service_idx" ON "catalog_package_items" USING btree ("package_id","service_id");--> statement-breakpoint
CREATE INDEX "catalog_package_items_package_id_idx" ON "catalog_package_items" USING btree ("package_id","position");--> statement-breakpoint
CREATE INDEX "catalog_package_items_service_id_idx" ON "catalog_package_items" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_packages_name_idx" ON "catalog_packages" USING btree (lower("name")) WHERE "catalog_packages"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "catalog_packages_template_id_idx" ON "catalog_packages" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_services_name_idx" ON "catalog_services" USING btree (lower("name")) WHERE "catalog_services"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "catalog_services_template_id_idx" ON "catalog_services" USING btree ("template_id");