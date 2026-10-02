-- F13: the single invoice settings row with the defaults (payment terms 7 days, no current
-- rate yet) and empty texts.
INSERT INTO "invoice_settings" ("singleton") VALUES (true) ON CONFLICT DO NOTHING;
