-- Phase 1 audit remediation, data only (docs/audit).
-- 1. Link URLs may hold share tokens: `task.created` entries keep each link's label and site
--    (host) only, as `task_link.created` always did (F06, apps/api CLAUDE.md). A one-off
--    rewrite of the append-only log, approved as part of the audit remediation.
UPDATE "audit_entries"
SET "after" = jsonb_set(
  "after",
  '{links}',
  (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'label', link -> 'label',
      'site', substring(link ->> 'url' from '^[^:]+://(?:[^@/?#]*@)?([^/?#]+)')
    )), '[]'::jsonb)
    FROM jsonb_array_elements("after" -> 'links') AS link
  )
)
WHERE "action" = 'task.created'
  AND jsonb_typeof("after" -> 'links') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements("after" -> 'links') AS link WHERE link ? 'url');
--> statement-breakpoint
-- 2. A frozen delivered count is never below zero (R7, R8): repair before the check that follows.
UPDATE "retainer_cycle_lines" SET "delivered_at_close" = 0 WHERE "delivered_at_close" < 0;
--> statement-breakpoint
-- 3. Over-limit revisions are logged as extra work under an Arabic title (F06 rule 10).
UPDATE "extra_work_items"
SET "title" = regexp_replace("title", '^Revision ([0-9]+): ', 'التعديل \1: ')
WHERE "title" ~ '^Revision [0-9]+: ';
