-- F17 part B: the single HR settings row, with the column defaults (spec, `hr_settings`).
INSERT INTO "hr_settings" ("singleton") VALUES (true) ON CONFLICT DO NOTHING;
