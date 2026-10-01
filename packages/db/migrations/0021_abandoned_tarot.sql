CREATE TYPE "public"."crew_role" AS ENUM('photographer', 'videographer', 'assistant', 'director', 'other');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shoot_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shoot_type" AS ENUM('product', 'video', 'event', 'people', 'other');--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'shoot_upcoming';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'shoot_not_closed';--> statement-breakpoint
ALTER TYPE "public"."notification_reminder_kind" ADD VALUE 'meeting_upcoming';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'shoot';--> statement-breakpoint
ALTER TYPE "public"."notification_subject" ADD VALUE 'meeting';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_booked' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_dropped' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_changed' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'meeting_invited' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'meeting_dropped' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'meeting_changed' BEFORE 'task_due_soon';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_upcoming' BEFORE 'client_account_manager_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'shoot_not_closed' BEFORE 'client_account_manager_assigned';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'meeting_upcoming' BEFORE 'client_account_manager_assigned';--> statement-breakpoint
CREATE TABLE "meeting_attendees" (
	"meeting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_attendees_meeting_id_user_id_pk" PRIMARY KEY("meeting_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_contacts" (
	"meeting_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_contacts_meeting_id_contact_id_pk" PRIMARY KEY("meeting_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text,
	"online_url" text,
	"agenda" text,
	"organizer_id" uuid NOT NULL,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "meetings_title_check" CHECK (char_length("meetings"."title") between 1 and 160),
	CONSTRAINT "meetings_times_check" CHECK ("meetings"."ends_at" > "meetings"."starts_at"
        and "meetings"."ends_at" - "meetings"."starts_at" <= interval '12 hours'),
	CONSTRAINT "meetings_text_check" CHECK (char_length("meetings"."location") between 1 and 300
        and char_length("meetings"."online_url") between 1 and 2048
        and char_length("meetings"."agenda") between 1 and 2000),
	CONSTRAINT "meetings_cancelled_check" CHECK (("meetings"."status" = 'cancelled') = ("meetings"."cancelled_at" is not null)
        and char_length("meetings"."cancel_reason") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "shoot_crew" (
	"shoot_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "crew_role" NOT NULL,
	"is_lead" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shoot_crew_shoot_id_user_id_pk" PRIMARY KEY("shoot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "shoot_shots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shoot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"note" text,
	"done_at" timestamp with time zone,
	"done_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shoot_shots_text_check" CHECK (char_length("shoot_shots"."text") between 1 and 300),
	CONSTRAINT "shoot_shots_note_check" CHECK (char_length("shoot_shots"."note") between 1 and 500),
	CONSTRAINT "shoot_shots_done_check" CHECK (("shoot_shots"."done_at" is null) = ("shoot_shots"."done_by_id" is null))
);
--> statement-breakpoint
CREATE TABLE "shoots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" "shoot_type" NOT NULL,
	"client_id" uuid,
	"task_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"location" text NOT NULL,
	"map_url" text,
	"brief" text,
	"external_crew" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "shoot_status" DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_id" uuid,
	"close_note" text,
	"raw_files_url" text,
	"editing_task_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "shoots_title_check" CHECK (char_length("shoots"."title") between 1 and 160),
	CONSTRAINT "shoots_location_check" CHECK (char_length("shoots"."location") between 1 and 300),
	CONSTRAINT "shoots_times_check" CHECK ("shoots"."ends_at" > "shoots"."starts_at"
        and "shoots"."ends_at" - "shoots"."starts_at" <= interval '72 hours'),
	CONSTRAINT "shoots_text_check" CHECK (char_length("shoots"."map_url") between 1 and 2048
        and char_length("shoots"."brief") between 1 and 2000
        and char_length("shoots"."close_note") between 1 and 2000
        and char_length("shoots"."raw_files_url") between 1 and 2048),
	CONSTRAINT "shoots_external_crew_check" CHECK (jsonb_typeof("shoots"."external_crew") = 'array'
        and jsonb_array_length("shoots"."external_crew") <= 10),
	CONSTRAINT "shoots_completed_check" CHECK (("shoots"."status" = 'completed') = ("shoots"."completed_at" is not null)
        and ("shoots"."completed_at" is null) = ("shoots"."completed_by_id" is null)),
	CONSTRAINT "shoots_cancelled_check" CHECK (("shoots"."status" = 'cancelled') = ("shoots"."cancelled_at" is not null)
        and ("shoots"."cancelled_at" is null) = ("shoots"."cancel_reason" is null)
        and char_length("shoots"."cancel_reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_attendees" ADD CONSTRAINT "meeting_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_contacts" ADD CONSTRAINT "meeting_contacts_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_contacts" ADD CONSTRAINT "meeting_contacts_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizer_id_users_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_crew" ADD CONSTRAINT "shoot_crew_shoot_id_shoots_id_fk" FOREIGN KEY ("shoot_id") REFERENCES "public"."shoots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_crew" ADD CONSTRAINT "shoot_crew_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_shots" ADD CONSTRAINT "shoot_shots_shoot_id_shoots_id_fk" FOREIGN KEY ("shoot_id") REFERENCES "public"."shoots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_shots" ADD CONSTRAINT "shoot_shots_done_by_id_users_id_fk" FOREIGN KEY ("done_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_completed_by_id_users_id_fk" FOREIGN KEY ("completed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_editing_task_id_tasks_id_fk" FOREIGN KEY ("editing_task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_attendees_user_id_idx" ON "meeting_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meeting_contacts_contact_id_idx" ON "meeting_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "meetings_client_id_idx" ON "meetings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "meetings_starts_at_idx" ON "meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "meetings_organizer_id_idx" ON "meetings" USING btree ("organizer_id");--> statement-breakpoint
CREATE INDEX "meetings_created_by_id_idx" ON "meetings" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "shoot_crew_user_id_idx" ON "shoot_crew" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shoot_crew_one_lead_idx" ON "shoot_crew" USING btree ("shoot_id") WHERE "shoot_crew"."is_lead";--> statement-breakpoint
CREATE UNIQUE INDEX "shoot_shots_position_unique" ON "shoot_shots" USING btree ("shoot_id","position");--> statement-breakpoint
CREATE INDEX "shoot_shots_done_by_id_idx" ON "shoot_shots" USING btree ("done_by_id");--> statement-breakpoint
CREATE INDEX "shoots_client_id_idx" ON "shoots" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "shoots_task_id_idx" ON "shoots" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shoots_task_active_unique" ON "shoots" USING btree ("task_id") WHERE "shoots"."archived_at" is null and "shoots"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "shoots_starts_at_idx" ON "shoots" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "shoots_status_idx" ON "shoots" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shoots_completed_by_id_idx" ON "shoots" USING btree ("completed_by_id");--> statement-breakpoint
CREATE INDEX "shoots_editing_task_id_idx" ON "shoots" USING btree ("editing_task_id");--> statement-breakpoint
CREATE INDEX "shoots_created_by_id_idx" ON "shoots" USING btree ("created_by_id");