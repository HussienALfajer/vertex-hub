-- F05B backfill (ADR 0029): invoices bill retainer charges instead of cycles.
-- 1. Every cycle gets one open-ended `monthly` charge: the amount of the live invoice line that
--    bills it, else of its latest line, else the retainer's fee. A cycle with no line and no fee
--    (null or 0) gets none. The charge was due when its cycle opened. Ids are random UUIDs: the
--    database has no UUIDv7.
INSERT INTO "retainer_charges" ("id", "retainer_id", "month", "kind", "amount_minor", "due_at", "created_at", "updated_at")
SELECT gen_random_uuid(), c."retainer_id", c."month", 'monthly', amount."minor", c."created_at", c."created_at", c."created_at"
FROM "retainer_cycles" c
JOIN "retainers" r ON r."id" = c."retainer_id"
CROSS JOIN LATERAL (
  SELECT coalesce(
    (
      SELECT l."unit_price_minor" * l."quantity"
      FROM "invoice_lines" l
      JOIN "invoices" i ON i."id" = l."invoice_id"
      WHERE l."retainer_cycle_id" = c."id"
      ORDER BY l."holds_source" DESC, i."created_at" DESC, l."id" DESC
      LIMIT 1
    ),
    nullif(r."monthly_fee_minor", 0)
  ) AS "minor"
) amount
WHERE amount."minor" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "retainer_charges" ch
    WHERE ch."retainer_id" = c."retainer_id" AND ch."month" = c."month" AND ch."kind" = 'monthly'
  );
--> statement-breakpoint
-- 2. Every invoice line of a cycle points to its month's charge. The cycle column stays until the
--    release after F05B, so older code keeps working against this schema.
UPDATE "invoice_lines" l
SET "retainer_charge_id" = ch."id"
FROM "retainer_cycles" c, "retainer_charges" ch
WHERE l."retainer_cycle_id" = c."id"
  AND ch."retainer_id" = c."retainer_id"
  AND ch."month" = c."month"
  AND ch."kind" = 'monthly';
