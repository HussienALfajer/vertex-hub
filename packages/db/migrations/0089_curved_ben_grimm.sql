ALTER TYPE "public"."template_kind" ADD VALUE 'task';--> statement-breakpoint
ALTER TABLE "template_runs" DROP CONSTRAINT "template_runs_target_check";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "brief_fields" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD COLUMN "parent_step_id" uuid;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD COLUMN "brief_doc" jsonb;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD COLUMN "brief_fields" jsonb;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD COLUMN "criteria" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "work_templates" ADD COLUMN "run_mode" "subtask_run_mode";--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_parent_step_id_work_template_steps_id_fk" FOREIGN KEY ("parent_step_id") REFERENCES "public"."work_template_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_template_steps_parent_step_id_idx" ON "work_template_steps" USING btree ("parent_step_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimate_check" CHECK ("tasks"."estimate_minutes" between 30 and 12000 and "tasks"."estimate_minutes" % 30 = 0);--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_target_check" CHECK ((("template_runs"."project_id" is null) <> ("template_runs"."retainer_cycle_id" is null)
          or ("template_runs"."trigger" = 'manual' and "template_runs"."project_id" is null))
        and ("template_runs"."cycle_line_id" is not null) = ("template_runs"."trigger" = 'missing_tasks')
        and ("template_runs"."trigger" <> 'cycle_opened' or "template_runs"."retainer_cycle_id" is not null)
        and ("template_runs"."trigger" <> 'missing_tasks' or "template_runs"."retainer_cycle_id" is not null));--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_estimate_check" CHECK ("work_template_steps"."estimate_minutes" between 30 and 12000 and "work_template_steps"."estimate_minutes" % 30 = 0);--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_criteria_check" CHECK (cardinality("work_template_steps"."criteria") <= 15);--> statement-breakpoint
ALTER TABLE "work_templates" ADD CONSTRAINT "work_templates_run_mode_check" CHECK (("work_templates"."kind"::text = 'task') = ("work_templates"."run_mode" is not null));