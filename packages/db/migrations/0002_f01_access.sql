CREATE TYPE "public"."department_code" AS ENUM('general_management', 'internal_operations', 'public_relations', 'marketing', 'design', 'photography', 'content_management', 'development', 'general_communication', 'medical_consultation');--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "department_members" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"is_primary" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_members_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" "department_code" NOT NULL,
	"name" text NOT NULL,
	"manager_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "departments_code_unique" UNIQUE("code"),
	CONSTRAINT "departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entries_entity_idx" ON "audit_entries" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_entries_actor_id_idx" ON "audit_entries" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_entries_occurred_at_idx" ON "audit_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "department_members_department_id_idx" ON "department_members" USING btree ("department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_members_one_primary_idx" ON "department_members" USING btree ("user_id") WHERE "department_members"."is_primary";--> statement-breakpoint
CREATE INDEX "departments_manager_id_idx" ON "departments" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");