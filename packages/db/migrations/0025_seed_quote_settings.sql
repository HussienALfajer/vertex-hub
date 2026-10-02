-- F04: the single quote settings row with the defaults (validity 14 days, threshold 10 %) and
-- empty texts.
INSERT INTO "quote_settings" ("singleton") VALUES (true) ON CONFLICT DO NOTHING;
