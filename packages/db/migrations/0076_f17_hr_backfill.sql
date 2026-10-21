-- F17 part A: the default work schedule, "Main schedule", Saturday to Thursday at 09:00 for
-- 480 minutes (a fixed UUIDv7 literal, so every environment has the same id; the owner sets the
-- real hours in HR settings, rule B2), and one employee file per existing user (rule A1), on the
-- default schedule with 14 annual leave days, archived with archived users.
INSERT INTO "work_schedules" ("id", "name", "kind", "is_default")
VALUES ('01a15bc1-f400-7317-bafa-ed6adc65b308', 'Main schedule', 'fixed', true);
--> statement-breakpoint
INSERT INTO "work_schedule_days" ("schedule_id", "weekday", "start_time", "required_minutes")
SELECT '01a15bc1-f400-7317-bafa-ed6adc65b308', day::"weekday", '09:00', 480
FROM unnest(ARRAY['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday']) AS day;
--> statement-breakpoint
INSERT INTO "employee_files" ("id", "user_id", "schedule_id", "annual_leave_days", "archived_at")
SELECT gen_random_uuid(), u."id", '01a15bc1-f400-7317-bafa-ed6adc65b308', 14, u."archived_at"
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "employee_files" f WHERE f."user_id" = u."id");
