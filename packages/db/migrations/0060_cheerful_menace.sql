ALTER TABLE "sessions" ADD COLUMN "browser_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "hardware_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_active_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "last_ip_address" text;--> statement-breakpoint
CREATE INDEX "sessions_browser_key_idx" ON "sessions" USING btree ("browser_key");--> statement-breakpoint
CREATE INDEX "sessions_hardware_key_idx" ON "sessions" USING btree ("hardware_key");