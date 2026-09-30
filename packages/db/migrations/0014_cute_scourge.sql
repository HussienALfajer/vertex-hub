CREATE TYPE "public"."brand_file_kind" AS ENUM('logo', 'font', 'guidelines', 'other');--> statement-breakpoint
CREATE TYPE "public"."file_final_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."file_owner_type" AS ENUM('task', 'client', 'project', 'retainer');--> statement-breakpoint
CREATE TYPE "public"."file_preview_status" AS ENUM('pending', 'ready', 'none', 'failed');--> statement-breakpoint
CREATE TYPE "public"."file_role" AS ENUM('deliverable', 'reference', 'brand', 'document');--> statement-breakpoint
CREATE TYPE "public"."file_version_kind" AS ENUM('upload', 'link');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'task_file_added' BEFORE 'task_requested';--> statement-breakpoint
CREATE TABLE "file_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_type" "file_owner_type" NOT NULL,
	"task_id" uuid,
	"project_id" uuid,
	"retainer_id" uuid,
	"client_id" uuid,
	"role" "file_role" NOT NULL,
	"name" text NOT NULL,
	"brand_kind" "brand_file_kind",
	"confidential" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "file_items_owner_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."task_id" is not null and "file_items"."project_id" is null and "file_items"."retainer_id" is null)
        or ("file_items"."owner_type" = 'client' and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null and "file_items"."retainer_id" is null)
        or ("file_items"."owner_type" = 'project' and "file_items"."project_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."retainer_id" is null)
        or ("file_items"."owner_type" = 'retainer' and "file_items"."retainer_id" is not null and "file_items"."client_id" is not null and "file_items"."task_id" is null and "file_items"."project_id" is null)),
	CONSTRAINT "file_items_role_check" CHECK (("file_items"."owner_type" = 'task' and "file_items"."role" in ('deliverable', 'reference'))
        or ("file_items"."owner_type" = 'client' and "file_items"."role" in ('brand', 'document'))
        or ("file_items"."owner_type" in ('project', 'retainer') and "file_items"."role" = 'document')),
	CONSTRAINT "file_items_brand_kind_check" CHECK (("file_items"."role" = 'brand') = ("file_items"."brand_kind" is not null)),
	CONSTRAINT "file_items_confidential_check" CHECK (not "file_items"."confidential" or "file_items"."role" = 'document'),
	CONSTRAINT "file_items_name_check" CHECK (char_length("file_items"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" "file_version_kind" NOT NULL,
	"storage_key" text,
	"original_name" text,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text,
	"preview_status" "file_preview_status" DEFAULT 'none' NOT NULL,
	"width" integer,
	"height" integer,
	"url" text,
	"link_label" text,
	"note" text,
	"uploaded_by_id" uuid NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"final_source" "file_final_source",
	"final_marked_by_id" uuid,
	"final_marked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "file_versions_number_check" CHECK ("file_versions"."number" >= 1),
	CONSTRAINT "file_versions_kind_check" CHECK (("file_versions"."kind" = 'upload' and "file_versions"."storage_key" is not null and "file_versions"."original_name" is not null and "file_versions"."mime_type" is not null and "file_versions"."size_bytes" is not null and "file_versions"."sha256" is not null and "file_versions"."url" is null)
        or ("file_versions"."kind" = 'link' and "file_versions"."url" is not null and "file_versions"."storage_key" is null)),
	CONSTRAINT "file_versions_size_check" CHECK ("file_versions"."size_bytes" is null or "file_versions"."size_bytes" between 1 and 262144000),
	CONSTRAINT "file_versions_final_check" CHECK (("file_versions"."is_final" and "file_versions"."final_source" is not null and "file_versions"."final_marked_at" is not null)
        or (not "file_versions"."is_final" and "file_versions"."final_source" is null and "file_versions"."final_marked_at" is null and "file_versions"."final_marked_by_id" is null))
);
--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_items" ADD CONSTRAINT "file_items_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_item_id_file_items_id_fk" FOREIGN KEY ("file_item_id") REFERENCES "public"."file_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_final_marked_by_id_users_id_fk" FOREIGN KEY ("final_marked_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_items_task_id_idx" ON "file_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "file_items_project_id_idx" ON "file_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "file_items_retainer_id_idx" ON "file_items" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "file_items_client_id_idx" ON "file_items" USING btree ("client_id","role");--> statement-breakpoint
CREATE INDEX "file_items_created_by_id_idx" ON "file_items" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_items_name_unique" ON "file_items" USING btree ("owner_type","role",coalesce("task_id", "project_id", "retainer_id", "client_id"),lower("name")) WHERE "file_items"."archived_at" is null and "file_items"."role" <> 'reference';--> statement-breakpoint
CREATE INDEX "file_uploads_user_id_idx" ON "file_uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_uploads_created_at_idx" ON "file_uploads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "file_versions_file_item_id_idx" ON "file_versions" USING btree ("file_item_id");--> statement-breakpoint
CREATE INDEX "file_versions_uploaded_by_id_idx" ON "file_versions" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "file_versions_final_marked_by_id_idx" ON "file_versions" USING btree ("final_marked_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_number_unique" ON "file_versions" USING btree ("file_item_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_final_unique" ON "file_versions" USING btree ("file_item_id") WHERE "file_versions"."is_final" and "file_versions"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "file_versions_final_marked_at_idx" ON "file_versions" USING btree ("final_marked_at" DESC NULLS LAST) WHERE "file_versions"."is_final";