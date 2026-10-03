CREATE TABLE "project_expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"spent_on" date NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"syp_per_usd" numeric(12, 4) NOT NULL,
	"note" text,
	"logged_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_expenses_amount_check" CHECK ("project_expenses"."amount_minor" > 0),
	CONSTRAINT "project_expenses_rate_check" CHECK ("project_expenses"."syp_per_usd" > 0),
	CONSTRAINT "project_expenses_description_check" CHECK (char_length("project_expenses"."description") between 1 and 200),
	CONSTRAINT "project_expenses_note_check" CHECK (char_length("project_expenses"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_logged_by_id_users_id_fk" FOREIGN KEY ("logged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_expenses_project_id_idx" ON "project_expenses" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_expenses_logged_by_id_idx" ON "project_expenses" USING btree ("logged_by_id");