-- F08B seed (spec F08B "Data", ADR 0042): starting values the Content Management manager corrects
-- afterwards. Pillar names and occasion names are data, not i18next keys. Ids are random UUIDs:
-- the database has no UUIDv7.
INSERT INTO "content_pillars" ("id", "name", "color", "position") VALUES
  (gen_random_uuid(), 'توعية', 'chart_1', 1),
  (gen_random_uuid(), 'ترويج', 'chart_2', 2),
  (gen_random_uuid(), 'ترفيه', 'chart_3', 3),
  (gen_random_uuid(), 'خلف الكواليس', 'chart_4', 4);
--> statement-breakpoint
INSERT INTO "content_occasions" ("id", "name", "category", "calendar", "month", "day", "duration_days", "lead_days") VALUES
  (gen_random_uuid(), 'رمضان', 'general', 'hijri', 9, 1, 30, 14),
  (gen_random_uuid(), 'عيد الفطر', 'general', 'hijri', 10, 1, 3, 7),
  (gen_random_uuid(), 'عيد الأضحى', 'general', 'hijri', 12, 10, 4, 7),
  (gen_random_uuid(), 'رأس السنة الهجرية', 'general', 'hijri', 1, 1, 1, 7),
  (gen_random_uuid(), 'المولد النبوي', 'general', 'hijri', 3, 12, 1, 7),
  (gen_random_uuid(), 'رأس السنة الميلادية', 'general', 'gregorian', 1, 1, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للمرأة', 'general', 'gregorian', 3, 8, 1, 7),
  (gen_random_uuid(), 'عيد الأم', 'general', 'gregorian', 3, 21, 1, 7),
  (gen_random_uuid(), 'عيد الجلاء', 'general', 'gregorian', 4, 17, 1, 7),
  (gen_random_uuid(), 'عيد العمال', 'general', 'gregorian', 5, 1, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للطفل', 'general', 'gregorian', 11, 20, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للغة العربية', 'general', 'gregorian', 12, 18, 1, 7),
  (gen_random_uuid(), 'عيد الميلاد', 'general', 'gregorian', 12, 25, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للسرطان', 'healthcare', 'gregorian', 2, 4, 1, 7),
  (gen_random_uuid(), 'يوم الصحة العالمي', 'healthcare', 'gregorian', 4, 7, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للقلب', 'healthcare', 'gregorian', 9, 29, 1, 7),
  (gen_random_uuid(), 'شهر التوعية بسرطان الثدي', 'healthcare', 'gregorian', 10, 1, 31, 7),
  (gen_random_uuid(), 'اليوم العالمي للسكري', 'healthcare', 'gregorian', 11, 14, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للمعلم', 'education', 'gregorian', 10, 5, 1, 7),
  (gen_random_uuid(), 'اليوم العالمي للقهوة', 'food', 'gregorian', 10, 1, 1, 7),
  (gen_random_uuid(), 'يوم الأغذية العالمي', 'food', 'gregorian', 10, 16, 1, 7),
  (gen_random_uuid(), 'يوم السياحة العالمي', 'tourism', 'gregorian', 9, 27, 1, 7);
--> statement-breakpoint
-- The agency's default best publishing times (rule C3); weekdays are 0 = Sunday.
INSERT INTO "content_planning_settings" ("id", "client_id", "posting_times") VALUES
  (gen_random_uuid(), NULL, '[{"platform":"instagram","weekdays":[6,0,1,2,3,4],"from":"12:00","to":"14:00"},{"platform":"instagram","weekdays":[6,0,1,2,3,4],"from":"19:00","to":"22:00"},{"platform":"facebook","weekdays":[6,0,1,2,3,4],"from":"12:00","to":"14:00"},{"platform":"facebook","weekdays":[6,0,1,2,3,4],"from":"19:00","to":"22:00"},{"platform":"tiktok","weekdays":[0,1,2,3,4,5,6],"from":"18:00","to":"23:00"},{"platform":"x","weekdays":[0,1,2,3,4],"from":"09:00","to":"11:00"},{"platform":"linkedin","weekdays":[0,1,2,3,4],"from":"09:00","to":"11:00"},{"platform":"youtube","weekdays":[4,5],"from":"17:00","to":"21:00"},{"platform":"snapchat","weekdays":[0,1,2,3,4,5,6],"from":"20:00","to":"23:00"},{"platform":"google_business","weekdays":[6,0,1,2,3,4],"from":"10:00","to":"12:00"}]'::jsonb);
