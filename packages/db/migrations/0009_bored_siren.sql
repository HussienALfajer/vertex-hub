CREATE TYPE "public"."template_kind" AS ENUM('project', 'retainer_cycle');--> statement-breakpoint
CREATE TYPE "public"."template_run_trigger" AS ENUM('manual', 'cycle_opened', 'missing_tasks');--> statement-breakpoint
CREATE TABLE "retainer_templates" (
	"retainer_id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"linked_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_run_tasks" (
	"run_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"instance" integer,
	CONSTRAINT "template_run_tasks_run_id_task_id_pk" PRIMARY KEY("run_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "template_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"trigger" "template_run_trigger" NOT NULL,
	"project_id" uuid,
	"retainer_cycle_id" uuid,
	"cycle_line_id" uuid,
	"start_date" date NOT NULL,
	"task_count" integer NOT NULL,
	"milestones_created" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_runs_target_check" CHECK (("template_runs"."project_id" is null) <> ("template_runs"."retainer_cycle_id" is null)
        and ("template_runs"."cycle_line_id" is not null) = ("template_runs"."trigger" = 'missing_tasks')
        and ("template_runs"."trigger" <> 'cycle_opened' or "template_runs"."retainer_cycle_id" is not null)
        and ("template_runs"."trigger" <> 'missing_tasks' or "template_runs"."retainer_cycle_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "work_template_assignees" (
	"template_id" uuid NOT NULL,
	"department" "department_code" NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "work_template_assignees_template_id_department_pk" PRIMARY KEY("template_id","department")
);
--> statement-breakpoint
CREATE TABLE "work_template_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_template_step_dependencies" (
	"step_id" uuid NOT NULL,
	"depends_on_step_id" uuid NOT NULL,
	CONSTRAINT "work_template_step_dependencies_step_id_depends_on_step_id_pk" PRIMARY KEY("step_id","depends_on_step_id"),
	CONSTRAINT "work_template_step_dependencies_self_check" CHECK ("work_template_step_dependencies"."step_id" <> "work_template_step_dependencies"."depends_on_step_id")
);
--> statement-breakpoint
CREATE TABLE "work_template_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid NOT NULL,
	"stage_id" uuid,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"brief" text,
	"department" "department_code" NOT NULL,
	"due_day" integer,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"needs_client_approval" boolean DEFAULT true NOT NULL,
	"revision_limit" integer DEFAULT 2 NOT NULL,
	"checklist" text[] DEFAULT '{}'::text[] NOT NULL,
	"repeat_kind" "deliverable_kind",
	"repeat_label" text,
	"spread_from_day" integer,
	CONSTRAINT "work_template_steps_revision_limit_check" CHECK ("work_template_steps"."revision_limit" between 0 and 20),
	CONSTRAINT "work_template_steps_timing_check" CHECK (case when "work_template_steps"."repeat_kind" is null
        then "work_template_steps"."due_day" is not null and "work_template_steps"."spread_from_day" is null and "work_template_steps"."repeat_label" is null
        else "work_template_steps"."due_day" is null and "work_template_steps"."spread_from_day" is not null
          and ("work_template_steps"."repeat_kind" = 'other') = ("work_template_steps"."repeat_label" is not null) end)
);
--> statement-breakpoint
CREATE TABLE "work_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "template_kind" NOT NULL,
	"description" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ALTER COLUMN "created_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "created_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retainer_templates" ADD CONSTRAINT "retainer_templates_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_templates" ADD CONSTRAINT "retainer_templates_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainer_templates" ADD CONSTRAINT "retainer_templates_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_run_tasks" ADD CONSTRAINT "template_run_tasks_run_id_template_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."template_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_run_tasks" ADD CONSTRAINT "template_run_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_retainer_cycle_id_retainer_cycles_id_fk" FOREIGN KEY ("retainer_cycle_id") REFERENCES "public"."retainer_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_cycle_line_id_retainer_cycle_lines_id_fk" FOREIGN KEY ("cycle_line_id") REFERENCES "public"."retainer_cycle_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_assignees" ADD CONSTRAINT "work_template_assignees_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_assignees" ADD CONSTRAINT "work_template_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_stages" ADD CONSTRAINT "work_template_stages_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_step_dependencies" ADD CONSTRAINT "work_template_step_dependencies_step_id_work_template_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."work_template_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_step_dependencies" ADD CONSTRAINT "work_template_step_dependencies_depends_on_step_id_work_template_steps_id_fk" FOREIGN KEY ("depends_on_step_id") REFERENCES "public"."work_template_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_template_id_work_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."work_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_stage_id_work_template_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."work_template_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_templates" ADD CONSTRAINT "work_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retainer_templates_template_id_idx" ON "retainer_templates" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "retainer_templates_linked_by_id_idx" ON "retainer_templates" USING btree ("linked_by_id");--> statement-breakpoint
CREATE INDEX "template_run_tasks_task_id_idx" ON "template_run_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "template_runs_template_id_idx" ON "template_runs" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "template_runs_project_id_idx" ON "template_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "template_runs_retainer_cycle_id_idx" ON "template_runs" USING btree ("retainer_cycle_id");--> statement-breakpoint
CREATE INDEX "template_runs_cycle_line_id_idx" ON "template_runs" USING btree ("cycle_line_id");--> statement-breakpoint
CREATE INDEX "template_runs_created_by_id_idx" ON "template_runs" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_runs_one_full_run_idx" ON "template_runs" USING btree ("retainer_cycle_id") WHERE "template_runs"."trigger" in ('manual', 'cycle_opened') and "template_runs"."retainer_cycle_id" is not null;--> statement-breakpoint
CREATE INDEX "work_template_assignees_user_id_idx" ON "work_template_assignees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "work_template_stages_template_id_idx" ON "work_template_stages" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "work_template_step_dependencies_depends_on_step_id_idx" ON "work_template_step_dependencies" USING btree ("depends_on_step_id");--> statement-breakpoint
CREATE INDEX "work_template_steps_template_id_idx" ON "work_template_steps" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "work_template_steps_stage_id_idx" ON "work_template_steps" USING btree ("stage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_templates_name_idx" ON "work_templates" USING btree (lower("name")) WHERE "work_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "work_templates_kind_idx" ON "work_templates" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "work_templates_created_by_id_idx" ON "work_templates" USING btree ("created_by_id");