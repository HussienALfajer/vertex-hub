-- F09 backfill for tasks that were in review, sent or approved before review snapshots existed.
-- 1. Tasks in internal review are in the `internal` stage (the check that follows needs it).
UPDATE "tasks" SET "review_stage" = 'internal' WHERE "status" = 'internal_review';
--> statement-breakpoint
-- 2. Tasks already sent to the client or approved get a system pass (no reviewer) holding what
--    they have now: the latest live version of each live deliverable and no text. Client
--    responses are recorded against it. Ids are random UUIDs: the database has no UUIDv7.
WITH passes AS (
  INSERT INTO "task_reviews" ("id", "task_id", "stage", "outcome", "version_ids")
  SELECT
    gen_random_uuid(),
    t."id",
    'internal',
    'passed',
    coalesce(
      (
        SELECT array_agg(latest."id" ORDER BY latest."id")
        FROM "file_items" i
        CROSS JOIN LATERAL (
          SELECT v."id"
          FROM "file_versions" v
          WHERE v."file_item_id" = i."id" AND v."archived_at" IS NULL
          ORDER BY v."number" DESC
          LIMIT 1
        ) latest
        WHERE i."task_id" = t."id" AND i."role" = 'deliverable' AND i."archived_at" IS NULL
      ),
      '{}'::uuid[]
    )
  FROM "tasks" t
  WHERE t."status" IN ('awaiting_client', 'approved')
  RETURNING "id", "task_id"
)
UPDATE "tasks" SET "cleared_review_id" = passes."id"
FROM passes
WHERE "tasks"."id" = passes."task_id";
