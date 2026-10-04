CREATE TYPE "public"."ad_campaign_status" AS ENUM('planned', 'active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ad_funding" AS ENUM('wallet', 'client_direct');--> statement-breakpoint
CREATE TYPE "public"."ad_objective" AS ENUM('awareness', 'traffic', 'engagement', 'messages', 'leads', 'sales', 'video_views', 'app_installs', 'other');--> statement-breakpoint
CREATE TYPE "public"."ad_platform" AS ENUM('meta', 'google', 'tiktok', 'snapchat', 'linkedin', 'x', 'other');--> statement-breakpoint
CREATE TABLE "ad_campaign_updates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"spend_minor" bigint NOT NULL,
	"reach" integer NOT NULL,
	"clicks" integer NOT NULL,
	"results" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"entered_by_id" uuid NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" uuid,
	CONSTRAINT "ad_campaign_updates_period_check" CHECK ("ad_campaign_updates"."period_start" <= "ad_campaign_updates"."period_end" and date_trunc('month', "ad_campaign_updates"."period_start") = date_trunc('month', "ad_campaign_updates"."period_end")),
	CONSTRAINT "ad_campaign_updates_metrics_check" CHECK ("ad_campaign_updates"."spend_minor" >= 0 and "ad_campaign_updates"."reach" >= 0 and "ad_campaign_updates"."clicks" >= 0 and "ad_campaign_updates"."results" >= 0),
	CONSTRAINT "ad_campaign_updates_note_check" CHECK (char_length("ad_campaign_updates"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" "ad_platform" NOT NULL,
	"objective" "ad_objective" NOT NULL,
	"funding" "ad_funding" DEFAULT 'wallet' NOT NULL,
	"budget_minor" bigint NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"owner_id" uuid NOT NULL,
	"status" "ad_campaign_status" DEFAULT 'planned' NOT NULL,
	"project_id" uuid,
	"retainer_id" uuid,
	"task_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"cancel_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" uuid,
	CONSTRAINT "ad_campaigns_name_check" CHECK (char_length("ad_campaigns"."name") between 1 and 200),
	CONSTRAINT "ad_campaigns_budget_check" CHECK ("ad_campaigns"."budget_minor" > 0),
	CONSTRAINT "ad_campaigns_dates_check" CHECK ("ad_campaigns"."ends_on" is null or "ad_campaigns"."ends_on" >= "ad_campaigns"."starts_on"),
	CONSTRAINT "ad_campaigns_engagement_check" CHECK ("ad_campaigns"."project_id" is null or "ad_campaigns"."retainer_id" is null),
	CONSTRAINT "ad_campaigns_notes_check" CHECK (char_length("ad_campaigns"."notes") <= 2000),
	CONSTRAINT "ad_campaigns_cancel_reason_check" CHECK (("ad_campaigns"."status" = 'cancelled') = ("ad_campaigns"."cancel_reason" is not null) and char_length("ad_campaigns"."cancel_reason") <= 500)
);
--> statement-breakpoint
ALTER TABLE "ad_campaign_updates" ADD CONSTRAINT "ad_campaign_updates_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_updates" ADD CONSTRAINT "ad_campaign_updates_entered_by_id_users_id_fk" FOREIGN KEY ("entered_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_updates" ADD CONSTRAINT "ad_campaign_updates_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaign_updates" ADD CONSTRAINT "ad_campaign_updates_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_retainer_id_retainers_id_fk" FOREIGN KEY ("retainer_id") REFERENCES "public"."retainers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaign_updates_campaign_id_period_start_idx" ON "ad_campaign_updates" USING btree ("campaign_id","period_start");--> statement-breakpoint
CREATE INDEX "ad_campaign_updates_entered_by_id_idx" ON "ad_campaign_updates" USING btree ("entered_by_id");--> statement-breakpoint
CREATE INDEX "ad_campaign_updates_updated_by_id_idx" ON "ad_campaign_updates" USING btree ("updated_by_id");--> statement-breakpoint
CREATE INDEX "ad_campaign_updates_archived_by_id_idx" ON "ad_campaign_updates" USING btree ("archived_by_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_client_id_status_idx" ON "ad_campaigns" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX "ad_campaigns_owner_id_status_idx" ON "ad_campaigns" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "ad_campaigns_project_id_idx" ON "ad_campaigns" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_retainer_id_idx" ON "ad_campaigns" USING btree ("retainer_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_task_id_idx" ON "ad_campaigns" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_created_by_id_idx" ON "ad_campaigns" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_archived_by_id_idx" ON "ad_campaigns" USING btree ("archived_by_id");