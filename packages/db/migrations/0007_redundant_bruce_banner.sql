CREATE TYPE "public"."request_scope" AS ENUM('in_scope', 'out_of_scope');--> statement-breakpoint
CREATE TYPE "public"."revision_decision" AS ENUM('free', 'extra_work');--> statement-breakpoint
CREATE TYPE "public"."revision_source" AS ENUM('internal', 'client');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('new', 'in_progress', 'internal_review', 'awaiting_client', 'revisions', 'approved', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('work', 'client_request');--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"position" integer NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "task_dependencies_self_check" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "task_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"added_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"source" "revision_source" NOT NULL,
	"number" integer,
	"note" text NOT NULL,
	"contact_id" uuid,
	"over_limit" boolean DEFAULT false NOT NULL,
	"decision" "revision_decision",
	"decision_note" text,
	"extra_work_item_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_revisions_source_check" CHECK (case when "task_revisions"."source" = 'client' then "task_revisions"."number" >= 1
        else "task_revisions"."number" is null and "task_revisions"."contact_id" is null and not "task_revisions"."over_limit" end),
	CONSTRAINT "task_revisions_decision_check" CHECK (("task_revisions"."decision" is null or "task_revisions"."over_limit")
        and ("task_revisions"."decision" is null) = ("task_revisions"."decided_at" is null)
        and ("task_revisions"."decision" <> 'free' or "task_revisions"."decision_note" is not null)
        and (("task_revisions"."decision" = 'extra_work') = ("task_revisions"."extra_work_item_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brief" text,
	"type" "task_type" DEFAULT 'work' NOT NULL,
	"department" "department_code" NOT NULL,
	"assignee_id" uuid,
	"status" "task_status" DEFAULT 'new' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"due_date" date NOT NULL,
	"due_time" time,
	"client_id" uuid,
	"project_id" uuid,
	"milestone_id" uuid,
	"retainer_cycle_id" uuid,
	"cycle_line_id" uuid,
	"needs_client_approval" boolean NOT NULL,
	"revision_limit" integer DEFAULT 2 NOT NULL,
	"requested_by_contact_id" uuid,
	"requested_on" date,
	"request_scope" "request_scope",
	"extra_work_item_id" uuid,
	"created_by_id" uuid NOT NULL,
	"started_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "tasks_engagement_check" CHECK (("tasks"."project_id" is null or "tasks"."retainer_cycle_id" is null)
        and (("tasks"."project_id" is null and "tasks"."retainer_cycle_id" is null) or "tasks"."client_id" is not null)
        and ("tasks"."milestone_id" is null or "tasks"."project_id" is not null)
        and ("tasks"."cycle_line_id" is null or "tasks"."retainer_cycle_id" is not null)),
	CONSTRAINT "tasks_client_approval_check" CHECK ("tasks"."client_id" is not null or not "tasks"."needs_client_approval"),
	CONSTRAINT "tasks_revision_limit_check" CHECK ("tasks"."revision_limit" between 0 and 20),
	CONSTRAINT "tasks_client_request_check" CHECK (case when "tasks"."type" = 'client_request'
        then "tasks"."client_id" is not null and "tasks"."requested_on" is not null and "tasks"."request_scope" is not null
        else "tasks"."requested_on" is null and "tasks"."request_scope" is null
          and "tasks"."requested_by_contact_id" is null and "tasks"."extra_work_item_id" is null end),
	CONSTRAINT "tasks_cancel_check" CHECK (("tasks"."status" = 'cancelled') = ("tasks"."cancelled_at" is not null and "tasks"."cancel_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_extra_work_item_id_extra_work_items_id_fk" FOREIGN KEY ("extra_work_item_id") REFERENCES "public"."extra_work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_revisions" ADD CONSTRAINT "task_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_project_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."project_milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_retainer_cycle_id_retainer_cycles_id_fk" FOREIGN KEY ("retainer_cycle_id") REFERENCES "public"."retainer_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cycle_line_id_retainer_cycle_lines_id_fk" FOREIGN KEY ("cycle_line_id") REFERENCES "public"."retainer_cycle_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_requested_by_contact_id_client_contacts_id_fk" FOREIGN KEY ("requested_by_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_extra_work_item_id_extra_work_items_id_fk" FOREIGN KEY ("extra_work_item_id") REFERENCES "public"."extra_work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_checklist_items_task_id_idx" ON "task_checklist_items" USING btree ("task_id","position");--> statement-breakpoint
CREATE INDEX "task_checklist_items_done_by_id_idx" ON "task_checklist_items" USING btree ("done_by_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_depends_on_id_idx" ON "task_dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_created_by_id_idx" ON "task_dependencies" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "task_links_task_id_idx" ON "task_links" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_links_added_by_id_idx" ON "task_links" USING btree ("added_by_id");--> statement-breakpoint
CREATE INDEX "task_revisions_task_id_idx" ON "task_revisions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_revisions_contact_id_idx" ON "task_revisions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "task_revisions_extra_work_item_id_idx" ON "task_revisions" USING btree ("extra_work_item_id");--> statement-breakpoint
CREATE INDEX "task_revisions_decided_by_id_idx" ON "task_revisions" USING btree ("decided_by_id");--> statement-breakpoint
CREATE INDEX "task_revisions_author_id_idx" ON "task_revisions" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "tasks_department_idx" ON "tasks" USING btree ("department");--> statement-breakpoint
CREATE INDEX "tasks_assignee_id_idx" ON "tasks" USING btree ("assignee_id","status","due_date");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_due_date_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "tasks_client_id_idx" ON "tasks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "tasks_project_id_idx" ON "tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "tasks_milestone_id_idx" ON "tasks" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "tasks_retainer_cycle_id_idx" ON "tasks" USING btree ("retainer_cycle_id");--> statement-breakpoint
CREATE INDEX "tasks_cycle_line_id_idx" ON "tasks" USING btree ("cycle_line_id");--> statement-breakpoint
CREATE INDEX "tasks_requested_by_contact_id_idx" ON "tasks" USING btree ("requested_by_contact_id");--> statement-breakpoint
CREATE INDEX "tasks_extra_work_item_id_idx" ON "tasks" USING btree ("extra_work_item_id");--> statement-breakpoint
CREATE INDEX "tasks_created_by_id_idx" ON "tasks" USING btree ("created_by_id");