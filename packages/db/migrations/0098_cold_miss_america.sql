ALTER TYPE "public"."notification_type" ADD VALUE 'department_member_added' BEFORE 'security_new_device';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'department_member_removed' BEFORE 'security_new_device';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'department_archived' BEFORE 'security_new_device';--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "archived_by_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_archived_by_id_idx" ON "departments" USING btree ("archived_by_id");