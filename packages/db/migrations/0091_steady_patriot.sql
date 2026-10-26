CREATE TYPE "public"."caption_group" AS ENUM('facebook_instagram', 'tiktok', 'x', 'linkedin', 'youtube', 'snapchat', 'google_business');--> statement-breakpoint
CREATE TABLE "post_captions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"group" "caption_group" NOT NULL,
	"caption" text,
	"hashtags" text,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_captions_text_check" CHECK (char_length("post_captions"."caption") between 1 and 5000
        and char_length("post_captions"."hashtags") between 1 and 1000
        and char_length("post_captions"."title") between 1 and 100),
	CONSTRAINT "post_captions_title_check" CHECK ("post_captions"."group" = 'youtube' or "post_captions"."title" is null)
);
--> statement-breakpoint
ALTER TABLE "content_posts" ADD COLUMN "media_layout" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD COLUMN "captions" jsonb;--> statement-breakpoint
ALTER TABLE "post_reviews" ADD COLUMN "slide_captions" jsonb;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "post_captions" ADD CONSTRAINT "post_captions_post_id_content_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."content_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_captions_post_id_group_idx" ON "post_captions" USING btree ("post_id","group");