CREATE TYPE "public"."image_source" AS ENUM('upload', 'brand_file');--> statement-breakpoint
CREATE TYPE "public"."image_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."image_subject_type" AS ENUM('user', 'client', 'project', 'retainer');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'profile_changed' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'client_logo_changed' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'project_image_changed' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'retainer_image_changed' BEFORE 'task_progressed';--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "image_subject_type" NOT NULL,
	"user_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"retainer_id" uuid,
	"source" "image_source" NOT NULL,
	"source_version_id" uuid,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"status" "image_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" uuid,
	CONSTRAINT "images_subject_check" CHECK (num_nonnulls("images"."user_id", "images"."client_id", "images"."project_id", "images"."retainer_id") = 1 and (
        ("images"."subject_type" = 'user' and "images"."user_id" is not null)
        or ("images"."subject_type" = 'client' and "images"."client_id" is not null)
        or ("images"."subject_type" = 'project' and "images"."project_id" is not null)
        or ("images"."subject_type" = 'retainer' and "images"."retainer_id" is not null))),
	CONSTRAINT "images_source_check" CHECK (("images"."source" = 'upload' and "images"."source_version_id" is null)
        or ("images"."source" = 'brand_file' and "images"."subject_type" = 'client' and "images"."source_version_id" is not null)),
	CONSTRAINT "images_size_check" CHECK ("images"."size_bytes" between 1 and 10485760),
	CONSTRAINT "images_mime_type_check" CHECK ("images"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "images_archived_check" CHECK (("images"."archived_at" is null) = ("images"."archived_by_id" is null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "retainers" ADD COLUMN "image_id" uuid;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_source_version_id_file_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_user_id_idx" ON "images" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "images_client_id_idx" ON "images" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "images_project_id_idx" ON "images" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "images_retainer_id_idx" ON "images" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "images_source_version_id_idx" ON "images" USING btree ("source_version_id");--> statement-breakpoint
CREATE INDEX "images_created_by_id_idx" ON "images" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "images_archived_by_id_idx" ON "images" USING btree ("archived_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "images_user_current_unique" ON "images" USING btree ("user_id") WHERE "images"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "images_client_current_unique" ON "images" USING btree ("client_id") WHERE "images"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "images_project_current_unique" ON "images" USING btree ("project_id") WHERE "images"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "images_retainer_current_unique" ON "images" USING btree ("retainer_id") WHERE "images"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "images_pending_idx" ON "images" USING btree ("created_at") WHERE "images"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_image_id_idx" ON "users" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "clients_image_id_idx" ON "clients" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "projects_image_id_idx" ON "projects" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "retainers_image_id_idx" ON "retainers" USING btree ("image_id");