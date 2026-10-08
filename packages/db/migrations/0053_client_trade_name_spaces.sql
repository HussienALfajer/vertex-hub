-- Trade names count the spaces inside them once (F02 rule 6): "شركة   البناء" and "شركة البناء"
-- are one client. The API collapses them on input from now on; this collapses the stored names.
-- Two live clients that become the same name would break the unique index: stop with a clear
-- message instead, so one of them is renamed or archived first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "clients"
    WHERE "archived_at" IS NULL
    GROUP BY lower(btrim(regexp_replace("trade_name", '\s+', ' ', 'g')))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Two clients that are not archived have the same trade name once the spaces inside it are collapsed: rename or archive one, then migrate again';
  END IF;
END $$;--> statement-breakpoint
UPDATE "clients"
SET "trade_name" = btrim(regexp_replace("trade_name", '\s+', ' ', 'g'))
WHERE "trade_name" <> btrim(regexp_replace("trade_name", '\s+', ' ', 'g'));
