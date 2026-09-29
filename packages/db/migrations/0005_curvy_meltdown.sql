CREATE TYPE "public"."currency" AS ENUM('USD', 'SYP');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'done');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planned', 'active', 'on_hold', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"due_date" date,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"installment_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_milestones_installment_check" CHECK ("project_milestones"."installment_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"project_manager_id" uuid NOT NULL,
	"departments" "department_code"[] NOT NULL,
	"status" "project_status" DEFAULT 'planned' NOT NULL,
	"start_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_dates_check" CHECK ("projects"."due_date" >= "projects"."start_date")
);
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_users_id_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestones_project_id_idx" ON "project_milestones" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "project_milestones_done_by_id_idx" ON "project_milestones" USING btree ("done_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_client_name_idx" ON "projects" USING btree ("client_id",lower("name")) WHERE "projects"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "projects_client_id_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_project_manager_id_idx" ON "projects" USING btree ("project_manager_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_due_date_idx" ON "projects" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "projects_departments_idx" ON "projects" USING gin ("departments");