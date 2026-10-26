CREATE TYPE "public"."dependency_source" AS ENUM('manual', 'run');--> statement-breakpoint
CREATE TYPE "public"."subtask_run_mode" AS ENUM('sequential', 'parallel', 'stages');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask_turn' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask_handover' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask_stage_finished' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtasks_all_finished' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'subtask_holding_next' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_blocked' BEFORE 'task_progressed';--> statement-breakpoint
CREATE TABLE "task_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "task_stages_name_check" CHECK (char_length("task_stages"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD COLUMN "source" "dependency_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "run_mode" "subtask_run_mode";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "handover_note" text;--> statement-breakpoint
ALTER TABLE "task_stages" ADD CONSTRAINT "task_stages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_stages_task_id_idx" ON "task_stages" USING btree ("task_id","position");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_stage_id_task_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."task_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_parent_id_idx" ON "tasks" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "tasks_stage_id_idx" ON "tasks" USING btree ("stage_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_subtask_check" CHECK (case when "tasks"."parent_id" is not null
        then "tasks"."parent_id" <> "tasks"."id" and "tasks"."position" >= 1 and "tasks"."run_mode" is null
          and "tasks"."milestone_id" is null and "tasks"."cycle_line_id" is null and "tasks"."post_id" is null
          and "tasks"."type" = 'work' and not "tasks"."needs_client_approval"
        else "tasks"."position" is null and "tasks"."stage_id" is null and "tasks"."handover_note" is null end);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_handover_note_check" CHECK (char_length("tasks"."handover_note") between 1 and 2000);