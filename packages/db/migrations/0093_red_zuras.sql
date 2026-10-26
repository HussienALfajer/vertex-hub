CREATE TYPE "public"."occasion_calendar" AS ENUM('gregorian', 'hijri', 'once');--> statement-breakpoint
CREATE TYPE "public"."occasion_category" AS ENUM('general', 'healthcare', 'education', 'food', 'retail', 'tourism', 'beauty', 'real_estate');--> statement-breakpoint
CREATE TYPE "public"."pillar_color" AS ENUM('chart_1', 'chart_2', 'chart_3', 'chart_4', 'chart_5', 'chart_6', 'chart_7', 'chart_8');--> statement-breakpoint
CREATE TYPE "public"."snippet_kind" AS ENUM('hashtags', 'caption');--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'post_at_risk';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'content_week_check';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'content_week';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'content_ideas';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_moved' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_unassigned' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_at_risk' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'content_week_check' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'content_idea_added' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'content_idea_used' BEFORE 'task_progressed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_changed' BEFORE 'task_progressed';--> statement-breakpoint
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"client_id" uuid,
	"pillar_id" uuid,
	"occasion_id" uuid,
	"post_id" uuid,
	"drop_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "content_ideas_text_check" CHECK (char_length("content_ideas"."text") between 1 and 300),
	CONSTRAINT "content_ideas_state_check" CHECK (("content_ideas"."post_id" is null or "content_ideas"."archived_at" is null)
        and ("content_ideas"."drop_reason" is null or "content_ideas"."archived_at" is not null)
        and char_length("content_ideas"."drop_reason") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "content_occasion_dates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"occasion_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"start_date" date NOT NULL,
	"confirmed_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_occasions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "occasion_category" NOT NULL,
	"client_id" uuid,
	"calendar" "occasion_calendar" NOT NULL,
	"month" integer,
	"day" integer,
	"date" date,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"lead_days" integer DEFAULT 7 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "content_occasions_name_check" CHECK (char_length("content_occasions"."name") between 1 and 80),
	CONSTRAINT "content_occasions_rule_check" CHECK (case when "content_occasions"."calendar" = 'once'
        then "content_occasions"."date" is not null and "content_occasions"."month" is null and "content_occasions"."day" is null
        else "content_occasions"."date" is null and "content_occasions"."month" between 1 and 12
          and "content_occasions"."day" between 1 and (case when "content_occasions"."calendar" = 'hijri' then 30 else 31 end) end),
	CONSTRAINT "content_occasions_days_check" CHECK ("content_occasions"."duration_days" between 1 and 31 and "content_occasions"."lead_days" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "content_pillars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" "pillar_color" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "content_pillars_name_check" CHECK (char_length("content_pillars"."name") between 1 and 40),
	CONSTRAINT "content_pillars_position_check" CHECK ("content_pillars"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "content_planning_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"posting_times" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pillar_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_gap_days" integer DEFAULT 3 NOT NULL,
	"occasion_categories" "occasion_category"[] DEFAULT '{general}'::occasion_category[] NOT NULL,
	"excluded_occasion_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"skipped_occasions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"x_long_posts" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_planning_settings_gap_check" CHECK ("content_planning_settings"."max_gap_days" between 1 and 14)
);
--> statement-breakpoint
CREATE TABLE "content_snippets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"kind" "snippet_kind" NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "content_snippets_name_check" CHECK (char_length("content_snippets"."name") between 1 and 60),
	CONSTRAINT "content_snippets_body_check" CHECK (char_length("content_snippets"."body") between 1 and (case when "content_snippets"."kind" = 'hashtags' then 1000 else 2000 end))
);
--> statement-breakpoint
ALTER TABLE "content_posts" ADD COLUMN "pillar_id" uuid;--> statement-breakpoint
ALTER TABLE "content_posts" ADD COLUMN "occasion_id" uuid;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_occasion_id_content_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."content_occasions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_occasion_dates" ADD CONSTRAINT "content_occasion_dates_occasion_id_content_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."content_occasions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_occasion_dates" ADD CONSTRAINT "content_occasion_dates_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_occasions" ADD CONSTRAINT "content_occasions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_occasions" ADD CONSTRAINT "content_occasions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_planning_settings" ADD CONSTRAINT "content_planning_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_snippets" ADD CONSTRAINT "content_snippets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_snippets" ADD CONSTRAINT "content_snippets_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_ideas_client_id_idx" ON "content_ideas" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "content_ideas_pillar_id_idx" ON "content_ideas" USING btree ("pillar_id");--> statement-breakpoint
CREATE INDEX "content_ideas_occasion_id_idx" ON "content_ideas" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "content_ideas_post_id_idx" ON "content_ideas" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "content_ideas_created_by_id_idx" ON "content_ideas" USING btree ("created_by_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_occasion_dates_occasion_id_idx" ON "content_occasion_dates" USING btree ("occasion_id","year") WHERE "content_occasion_dates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "content_occasion_dates_confirmed_by_id_idx" ON "content_occasion_dates" USING btree ("confirmed_by_id");--> statement-breakpoint
CREATE INDEX "content_occasions_client_id_idx" ON "content_occasions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "content_occasions_created_by_id_idx" ON "content_occasions" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pillars_name_idx" ON "content_pillars" USING btree (lower("name")) WHERE "content_pillars"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "content_planning_settings_client_id_idx" ON "content_planning_settings" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_planning_settings_agency_idx" ON "content_planning_settings" USING btree (("client_id" is null)) WHERE "content_planning_settings"."client_id" is null;--> statement-breakpoint
CREATE INDEX "content_snippets_client_id_idx" ON "content_snippets" USING btree ("client_id","kind");--> statement-breakpoint
CREATE INDEX "content_snippets_created_by_id_idx" ON "content_snippets" USING btree ("created_by_id");--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_occasion_id_content_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."content_occasions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_posts_pillar_id_idx" ON "content_posts" USING btree ("pillar_id");--> statement-breakpoint
CREATE INDEX "content_posts_occasion_id_idx" ON "content_posts" USING btree ("occasion_id");