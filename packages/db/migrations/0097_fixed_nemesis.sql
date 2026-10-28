ALTER TABLE "departments" ALTER COLUMN "color" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ALTER COLUMN "icon" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
DROP TYPE "public"."department_code";