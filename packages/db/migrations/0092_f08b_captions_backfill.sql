-- F08B backfill (ADR 0042): every existing post keeps its caption and hashtags on each caption
-- group of its platforms (Facebook and Instagram share `facebook_instagram`). Ids are random
-- UUIDs: the database has no UUIDv7.
INSERT INTO "post_captions" ("id", "post_id", "group", "caption", "hashtags", "created_at", "updated_at")
SELECT gen_random_uuid(), groups."post_id", groups."group", groups."caption", groups."hashtags", now(), now()
FROM (
  SELECT DISTINCT
    p."id" AS "post_id",
    (CASE WHEN platform IN ('facebook', 'instagram') THEN 'facebook_instagram' ELSE platform::text END)::"caption_group" AS "group",
    p."caption",
    p."hashtags"
  FROM "content_posts" p, unnest(p."platforms") AS platform
) groups
ON CONFLICT ("post_id", "group") DO NOTHING;
