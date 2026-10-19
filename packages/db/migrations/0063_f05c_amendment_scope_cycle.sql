-- F05C contract: amendments written before F05C name their scope `month`, F05B's name for
-- `cycle`. Rewrite them so the API reads `cycle` only; the `month` enum value is removed in a
-- later release, once no deployed code names it.
UPDATE "retainer_amendments" SET "scope" = 'cycle' WHERE "scope" = 'month';
