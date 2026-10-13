-- F05C backfill (ADR 0030): retainer cycles, charges, terms and amendments name anchored cycles.
-- Existing rows are not re-cut into anchored periods (owner decision): each calendar month maps
-- to the anchored cycle that holds its last day, which keeps one cycle per month. The month
-- columns stay until the contract migration of the next release.
--
-- The cycle arithmetic of `packages/contracts/src/retainer-cycles.ts`: cycle n runs from the
-- start date + (n − 1) months to the day before the start date + n months; Postgres clamps a
-- missing day to the month's end, as `addMonths` does.
CREATE OR REPLACE FUNCTION pg_temp.f05c_cycle_at(start_date date, day date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT m + CASE WHEN (start_date + make_interval(months => m))::date <= day THEN 1 ELSE 0 END
  FROM (
    SELECT ((extract(year FROM day) - extract(year FROM start_date)) * 12
      + extract(month FROM day) - extract(month FROM start_date))::integer AS m
  ) months
$$;
--> statement-breakpoint
-- A month before the start month (a termination fee or a scheduled amendment of a retainer that
-- had not started) maps to cycle 1: numbers are never below 1.
CREATE OR REPLACE FUNCTION pg_temp.f05c_month_cycle(start_date date, month date) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT greatest(1, pg_temp.f05c_cycle_at(start_date, (date_trunc('month', month) + interval '1 month - 1 day')::date))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.f05c_cycle_start(start_date date, n integer) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (start_date + make_interval(months => n - 1))::date
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.f05c_cycle_end(start_date date, n integer) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (start_date + make_interval(months => n))::date - 1
$$;
--> statement-breakpoint
-- 1. Cycles: the number of the cycle holding the last day of their month.
UPDATE "retainer_cycles" c
SET "number" = pg_temp.f05c_month_cycle(r."start_date", c."month")
FROM "retainers" r
WHERE r."id" = c."retainer_id" AND c."number" IS NULL AND c."month" IS NOT NULL;
--> statement-breakpoint
-- 2. Charges: the cycle of their month, and that cycle's start.
UPDATE "retainer_charges" ch
SET "cycle_number" = pg_temp.f05c_month_cycle(r."start_date", ch."month"),
    "cycle_start" = pg_temp.f05c_cycle_start(r."start_date", pg_temp.f05c_month_cycle(r."start_date", ch."month"))
FROM "retainers" r
WHERE r."id" = ch."retainer_id" AND ch."cycle_number" IS NULL AND ch."month" IS NOT NULL;
--> statement-breakpoint
-- 3. Terms: the cycle of their start month, as many cycles as months, and their periods.
UPDATE "retainer_terms" t
SET "start_cycle" = pg_temp.f05c_month_cycle(r."start_date", t."start_month"),
    "cycles" = t."months",
    "start_date" = pg_temp.f05c_cycle_start(r."start_date", pg_temp.f05c_month_cycle(r."start_date", t."start_month")),
    "end_date" = pg_temp.f05c_cycle_end(r."start_date", pg_temp.f05c_month_cycle(r."start_date", t."start_month") + t."months" - 1)
FROM "retainers" r
WHERE r."id" = t."retainer_id" AND t."start_cycle" IS NULL AND t."start_month" IS NOT NULL;
--> statement-breakpoint
-- 4. Amendments: the cycle of their effective month and its start; schedules and effects gain
--    the cycle of their month and keep the month (expand only: the previous release reads it).
UPDATE "retainer_amendments" a
SET "effective_cycle" = pg_temp.f05c_month_cycle(r."start_date", a."effective_month"),
    "effective_date" = pg_temp.f05c_cycle_start(r."start_date", pg_temp.f05c_month_cycle(r."start_date", a."effective_month")),
    "schedule" = CASE WHEN a."schedule" IS NULL THEN NULL ELSE (
      SELECT coalesce(jsonb_agg(
        item || jsonb_build_object(
          'cycle', pg_temp.f05c_month_cycle(r."start_date", (item->>'month')::date)
        ) ORDER BY position), '[]'::jsonb)
      FROM jsonb_array_elements(a."schedule") WITH ORDINALITY AS items(item, position)
    ) END,
    "effects" = (
      SELECT coalesce(jsonb_agg(
        effect || jsonb_build_object(
          'cycle', pg_temp.f05c_month_cycle(r."start_date", (effect->>'month')::date)
        ) ORDER BY position), '[]'::jsonb)
      FROM jsonb_array_elements(a."effects") WITH ORDINALITY AS items(effect, position)
    )
FROM "retainers" r
WHERE r."id" = a."retainer_id" AND a."effective_cycle" IS NULL AND a."effective_month" IS NOT NULL;
--> statement-breakpoint
-- 5. The renewal date is derived from the terms (T3'): the day after the last active or
--    scheduled term, null without one.
UPDATE "retainers" r
SET "renewal_date" = (
  SELECT max(t."end_date") + 1
  FROM "retainer_terms" t
  WHERE t."retainer_id" = r."id" AND t."status" IN ('active', 'scheduled')
)
WHERE "renewal_date" IS DISTINCT FROM (
  SELECT max(t."end_date") + 1
  FROM "retainer_terms" t
  WHERE t."retainer_id" = r."id" AND t."status" IN ('active', 'scheduled')
);
