-- F23: identity and order of the ten seeded departments (ADR 0043). Colors c1…c8, c1, c2 and
-- positions 1–10 in seed (id) order; each gets a fitting icon from DEPARTMENT_ICONS.
UPDATE "departments" AS d SET "color" = v."color"::"department_color", "icon" = v."icon", "position" = v."position"
FROM (VALUES
	('general_management', 'c1', 'briefcase', 1),
	('internal_operations', 'c2', 'settings', 2),
	('public_relations', 'c3', 'handshake', 3),
	('marketing', 'c4', 'megaphone', 4),
	('design', 'c5', 'palette', 5),
	('photography', 'c6', 'camera', 6),
	('content_management', 'c7', 'file-text', 7),
	('development', 'c8', 'code', 8),
	('general_communication', 'c1', 'headset', 9),
	('medical_consultation', 'c2', 'stethoscope', 10)
) AS v("code", "color", "icon", "position")
WHERE d."code" = v."code";
--> statement-breakpoint
-- Departments outside the seed (none expected): the next colors, a generic icon, after the seed.
WITH rest AS (
	SELECT "id", row_number() OVER (ORDER BY "id") AS n FROM "departments" WHERE "position" IS NULL
)
UPDATE "departments" AS d SET "color" = 'c3', "icon" = 'building', "position" = 10 + rest.n
FROM rest WHERE d."id" = rest."id";
