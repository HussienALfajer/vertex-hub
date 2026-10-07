ALTER TABLE "departments" DROP CONSTRAINT "departments_name_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_idx" ON "departments" USING btree (lower("name"));