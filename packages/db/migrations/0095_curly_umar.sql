CREATE TYPE "public"."department_color" AS ENUM('c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8');--> statement-breakpoint
ALTER TABLE "departments" ALTER COLUMN "code" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "catalog_services" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "departments" SET DATA TYPE text[];--> statement-breakpoint
ALTER TABLE "quote_line_items" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "quote_lines" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "retainers" ALTER COLUMN "departments" SET DATA TYPE text[];--> statement-breakpoint
ALTER TABLE "task_comments" ALTER COLUMN "addressed_department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "work_template_assignees" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "work_template_steps" ALTER COLUMN "department" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "color" "department_color";--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "catalog_services" ADD CONSTRAINT "catalog_services_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_addressed_department_departments_code_fk" FOREIGN KEY ("addressed_department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_assignees" ADD CONSTRAINT "work_template_assignees_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_template_steps" ADD CONSTRAINT "work_template_steps_department_departments_code_fk" FOREIGN KEY ("department") REFERENCES "public"."departments"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_services_department_idx" ON "catalog_services" USING btree ("department");--> statement-breakpoint
CREATE INDEX "quote_line_items_department_idx" ON "quote_line_items" USING btree ("department");--> statement-breakpoint
CREATE INDEX "quote_lines_department_idx" ON "quote_lines" USING btree ("department");--> statement-breakpoint
CREATE INDEX "task_comments_addressed_department_idx" ON "task_comments" USING btree ("addressed_department");--> statement-breakpoint
CREATE INDEX "work_template_assignees_department_idx" ON "work_template_assignees" USING btree ("department");--> statement-breakpoint
CREATE INDEX "work_template_steps_department_idx" ON "work_template_steps" USING btree ("department");