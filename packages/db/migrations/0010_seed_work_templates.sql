-- F07: seed the four draft work templates (spec F07, "Seed templates"). Fixed UUIDv7 ids so
-- every environment has the same rows; no default assignees; editable from the UI afterwards.
--> statement-breakpoint
INSERT INTO "work_templates" ("id", "name", "kind", "description") VALUES
	('01a0ec2d-8000-7001-805e-ed0000000001', 'هوية بصرية', 'project', 'شعار وهوية بصرية كاملة مع دليل الاستخدام.');
--> statement-breakpoint
INSERT INTO "work_template_stages" ("id", "template_id", "name", "position") VALUES
	('01a0ec2d-8000-7002-805e-ed0000000002', '01a0ec2d-8000-7001-805e-ed0000000001', 'الاستكشاف', 1),
	('01a0ec2d-8000-7003-805e-ed0000000003', '01a0ec2d-8000-7001-805e-ed0000000001', 'التصميم', 2),
	('01a0ec2d-8000-7004-805e-ed0000000004', '01a0ec2d-8000-7001-805e-ed0000000001', 'التسليم', 3);
--> statement-breakpoint
INSERT INTO "work_template_steps" ("id", "template_id", "stage_id", "position", "title", "department", "due_day", "needs_client_approval", "repeat_kind", "spread_from_day") VALUES
	('01a0ec2d-8000-7005-805e-ed0000000005', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7002-805e-ed0000000002', 1, 'جلسة استكشاف الهوية وموجز العمل', 'marketing', 3, true, NULL, NULL),
	('01a0ec2d-8000-7006-805e-ed0000000006', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7002-805e-ed0000000002', 2, 'بحث السوق والمنافسين', 'marketing', 5, false, NULL, NULL),
	('01a0ec2d-8000-7007-805e-ed0000000007', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7003-805e-ed0000000003', 3, 'لوحة الإلهام والتوجه الإبداعي', 'design', 7, true, NULL, NULL),
	('01a0ec2d-8000-7008-805e-ed0000000008', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7003-805e-ed0000000003', 4, 'مقترحات الشعار (ثلاثة اتجاهات)', 'design', 12, true, NULL, NULL),
	('01a0ec2d-8000-7009-805e-ed0000000009', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7003-805e-ed0000000003', 5, 'الألوان والخطوط', 'design', 15, true, NULL, NULL),
	('01a0ec2d-8000-700a-805e-ed000000000a', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7003-805e-ed0000000003', 6, 'دليل الهوية', 'design', 20, true, NULL, NULL),
	('01a0ec2d-8000-700b-805e-ed000000000b', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7004-805e-ed0000000004', 7, 'تطبيقات الهوية (المطبوعات وقوالب التواصل الاجتماعي)', 'design', 24, true, NULL, NULL),
	('01a0ec2d-8000-700c-805e-ed000000000c', '01a0ec2d-8000-7001-805e-ed0000000001', '01a0ec2d-8000-7004-805e-ed0000000004', 8, 'الملفات النهائية والتسليم', 'design', 26, false, NULL, NULL);
--> statement-breakpoint
INSERT INTO "work_template_step_dependencies" ("step_id", "depends_on_step_id") VALUES
	('01a0ec2d-8000-7006-805e-ed0000000006', '01a0ec2d-8000-7005-805e-ed0000000005'),
	('01a0ec2d-8000-7007-805e-ed0000000007', '01a0ec2d-8000-7006-805e-ed0000000006'),
	('01a0ec2d-8000-7008-805e-ed0000000008', '01a0ec2d-8000-7007-805e-ed0000000007'),
	('01a0ec2d-8000-7009-805e-ed0000000009', '01a0ec2d-8000-7008-805e-ed0000000008'),
	('01a0ec2d-8000-700a-805e-ed000000000a', '01a0ec2d-8000-7009-805e-ed0000000009'),
	('01a0ec2d-8000-700b-805e-ed000000000b', '01a0ec2d-8000-700a-805e-ed000000000a'),
	('01a0ec2d-8000-700c-805e-ed000000000c', '01a0ec2d-8000-700b-805e-ed000000000b');
--> statement-breakpoint
INSERT INTO "work_templates" ("id", "name", "kind", "description") VALUES
	('01a0ec2d-8000-700d-805e-ed000000000d', 'فيديو ترويجي', 'project', 'ريل أو فيديو ترويجي قصير من الفكرة إلى النسخة النهائية.');
--> statement-breakpoint
INSERT INTO "work_template_stages" ("id", "template_id", "name", "position") VALUES
	('01a0ec2d-8000-700e-805e-ed000000000e', '01a0ec2d-8000-700d-805e-ed000000000d', 'ما قبل الإنتاج', 1),
	('01a0ec2d-8000-700f-805e-ed000000000f', '01a0ec2d-8000-700d-805e-ed000000000d', 'الإنتاج', 2),
	('01a0ec2d-8000-7010-805e-ed0000000010', '01a0ec2d-8000-700d-805e-ed000000000d', 'ما بعد الإنتاج', 3);
--> statement-breakpoint
INSERT INTO "work_template_steps" ("id", "template_id", "stage_id", "position", "title", "department", "due_day", "needs_client_approval", "repeat_kind", "spread_from_day") VALUES
	('01a0ec2d-8000-7011-805e-ed0000000011', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-700e-805e-ed000000000e', 1, 'الفكرة والسيناريو', 'content_management', 2, true, NULL, NULL),
	('01a0ec2d-8000-7012-805e-ed0000000012', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-700e-805e-ed000000000e', 2, 'قائمة اللقطات وخطة التصوير', 'photography', 3, false, NULL, NULL),
	('01a0ec2d-8000-7013-805e-ed0000000013', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-700f-805e-ed000000000f', 3, 'التصوير', 'photography', 5, false, NULL, NULL),
	('01a0ec2d-8000-7014-805e-ed0000000014', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-7010-805e-ed0000000010', 4, 'المونتاج الأول', 'photography', 8, true, NULL, NULL),
	('01a0ec2d-8000-7015-805e-ed0000000015', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-7010-805e-ed0000000010', 5, 'الغلاف والنصوص على الفيديو', 'design', 9, false, NULL, NULL),
	('01a0ec2d-8000-7016-805e-ed0000000016', '01a0ec2d-8000-700d-805e-ed000000000d', '01a0ec2d-8000-7010-805e-ed0000000010', 6, 'المونتاج النهائي والتصدير', 'photography', 11, true, NULL, NULL);
--> statement-breakpoint
INSERT INTO "work_template_step_dependencies" ("step_id", "depends_on_step_id") VALUES
	('01a0ec2d-8000-7012-805e-ed0000000012', '01a0ec2d-8000-7011-805e-ed0000000011'),
	('01a0ec2d-8000-7013-805e-ed0000000013', '01a0ec2d-8000-7012-805e-ed0000000012'),
	('01a0ec2d-8000-7014-805e-ed0000000014', '01a0ec2d-8000-7013-805e-ed0000000013'),
	('01a0ec2d-8000-7015-805e-ed0000000015', '01a0ec2d-8000-7011-805e-ed0000000011'),
	('01a0ec2d-8000-7016-805e-ed0000000016', '01a0ec2d-8000-7014-805e-ed0000000014'),
	('01a0ec2d-8000-7016-805e-ed0000000016', '01a0ec2d-8000-7015-805e-ed0000000015');
--> statement-breakpoint
INSERT INTO "work_templates" ("id", "name", "kind", "description") VALUES
	('01a0ec2d-8000-7017-805e-ed0000000017', 'موقع إلكتروني', 'project', 'موقع من المتطلبات إلى الإطلاق وتدريب العميل.');
--> statement-breakpoint
INSERT INTO "work_template_stages" ("id", "template_id", "name", "position") VALUES
	('01a0ec2d-8000-7018-805e-ed0000000018', '01a0ec2d-8000-7017-805e-ed0000000017', 'الاستكشاف', 1),
	('01a0ec2d-8000-7019-805e-ed0000000019', '01a0ec2d-8000-7017-805e-ed0000000017', 'التصميم', 2),
	('01a0ec2d-8000-701a-805e-ed000000001a', '01a0ec2d-8000-7017-805e-ed0000000017', 'التنفيذ', 3),
	('01a0ec2d-8000-701b-805e-ed000000001b', '01a0ec2d-8000-7017-805e-ed0000000017', 'الاختبار', 4),
	('01a0ec2d-8000-701c-805e-ed000000001c', '01a0ec2d-8000-7017-805e-ed0000000017', 'التسليم', 5);
--> statement-breakpoint
INSERT INTO "work_template_steps" ("id", "template_id", "stage_id", "position", "title", "department", "due_day", "needs_client_approval", "repeat_kind", "spread_from_day") VALUES
	('01a0ec2d-8000-701d-805e-ed000000001d', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-7018-805e-ed0000000018', 1, 'المتطلبات وخريطة الموقع', 'development', 3, true, NULL, NULL),
	('01a0ec2d-8000-701e-805e-ed000000001e', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-7018-805e-ed0000000018', 2, 'جرد المحتوى', 'content_management', 5, false, NULL, NULL),
	('01a0ec2d-8000-701f-805e-ed000000001f', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-7019-805e-ed0000000019', 3, 'المخططات الأولية', 'design', 8, true, NULL, NULL),
	('01a0ec2d-8000-7020-805e-ed0000000020', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-7019-805e-ed0000000019', 4, 'تصميم الواجهات', 'design', 14, true, NULL, NULL),
	('01a0ec2d-8000-7021-805e-ed0000000021', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701a-805e-ed000000001a', 5, 'برمجة الواجهة الأمامية', 'development', 24, false, NULL, NULL),
	('01a0ec2d-8000-7022-805e-ed0000000022', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701a-805e-ed000000001a', 6, 'الخلفية ونظام إدارة المحتوى', 'development', 24, false, NULL, NULL),
	('01a0ec2d-8000-7023-805e-ed0000000023', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701a-805e-ed000000001a', 7, 'إدخال المحتوى', 'content_management', 26, false, NULL, NULL),
	('01a0ec2d-8000-7024-805e-ed0000000024', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701b-805e-ed000000001b', 8, 'الاختبار والإصلاحات', 'development', 29, true, NULL, NULL),
	('01a0ec2d-8000-7025-805e-ed0000000025', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701c-805e-ed000000001c', 9, 'الإطلاق', 'development', 31, false, NULL, NULL),
	('01a0ec2d-8000-7026-805e-ed0000000026', '01a0ec2d-8000-7017-805e-ed0000000017', '01a0ec2d-8000-701c-805e-ed000000001c', 10, 'تدريب العميل والتسليم', 'development', 32, false, NULL, NULL);
--> statement-breakpoint
INSERT INTO "work_template_step_dependencies" ("step_id", "depends_on_step_id") VALUES
	('01a0ec2d-8000-701e-805e-ed000000001e', '01a0ec2d-8000-701d-805e-ed000000001d'),
	('01a0ec2d-8000-701f-805e-ed000000001f', '01a0ec2d-8000-701d-805e-ed000000001d'),
	('01a0ec2d-8000-7020-805e-ed0000000020', '01a0ec2d-8000-701f-805e-ed000000001f'),
	('01a0ec2d-8000-7021-805e-ed0000000021', '01a0ec2d-8000-7020-805e-ed0000000020'),
	('01a0ec2d-8000-7022-805e-ed0000000022', '01a0ec2d-8000-701d-805e-ed000000001d'),
	('01a0ec2d-8000-7023-805e-ed0000000023', '01a0ec2d-8000-7022-805e-ed0000000022'),
	('01a0ec2d-8000-7023-805e-ed0000000023', '01a0ec2d-8000-701e-805e-ed000000001e'),
	('01a0ec2d-8000-7024-805e-ed0000000024', '01a0ec2d-8000-7021-805e-ed0000000021'),
	('01a0ec2d-8000-7024-805e-ed0000000024', '01a0ec2d-8000-7023-805e-ed0000000023'),
	('01a0ec2d-8000-7025-805e-ed0000000025', '01a0ec2d-8000-7024-805e-ed0000000024'),
	('01a0ec2d-8000-7026-805e-ed0000000026', '01a0ec2d-8000-7025-805e-ed0000000025');
--> statement-breakpoint
INSERT INTO "work_templates" ("id", "name", "kind", "description") VALUES
	('01a0ec2d-8000-7027-805e-ed0000000027', 'دورة التواصل الاجتماعي الشهرية', 'retainer_cycle', 'مهام شهر من إدارة حسابات التواصل الاجتماعي، مهمة لكل وحدة متفق عليها.');
--> statement-breakpoint
INSERT INTO "work_template_steps" ("id", "template_id", "stage_id", "position", "title", "department", "due_day", "needs_client_approval", "repeat_kind", "spread_from_day") VALUES
	('01a0ec2d-8000-7028-805e-ed0000000028', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 1, 'خطة المحتوى الشهرية والنصوص', 'content_management', 3, true, NULL, NULL),
	('01a0ec2d-8000-7029-805e-ed0000000029', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 2, 'تصميم', 'design', NULL, true, 'design', 4),
	('01a0ec2d-8000-702a-805e-ed000000002a', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 3, 'منشور', 'content_management', NULL, true, 'post', 4),
	('01a0ec2d-8000-702b-805e-ed000000002b', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 4, 'ستوري', 'design', NULL, true, 'story', 4),
	('01a0ec2d-8000-702c-805e-ed000000002c', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 5, 'ريل', 'photography', NULL, true, 'reel', 5),
	('01a0ec2d-8000-702d-805e-ed000000002d', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 6, 'فيديو', 'photography', NULL, true, 'video', 5),
	('01a0ec2d-8000-702e-805e-ed000000002e', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 7, 'جلسة تصوير', 'photography', NULL, false, 'photo_shoot', 4),
	('01a0ec2d-8000-702f-805e-ed000000002f', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 8, 'حملة إعلانية', 'marketing', NULL, true, 'ad_campaign', 4),
	('01a0ec2d-8000-7030-805e-ed0000000030', '01a0ec2d-8000-7027-805e-ed0000000027', NULL, 9, 'التقرير الشهري', 'marketing', NULL, false, 'monthly_report', 27);
--> statement-breakpoint
INSERT INTO "work_template_step_dependencies" ("step_id", "depends_on_step_id") VALUES
	('01a0ec2d-8000-7029-805e-ed0000000029', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702a-805e-ed000000002a', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702b-805e-ed000000002b', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702c-805e-ed000000002c', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702d-805e-ed000000002d', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702e-805e-ed000000002e', '01a0ec2d-8000-7028-805e-ed0000000028'),
	('01a0ec2d-8000-702f-805e-ed000000002f', '01a0ec2d-8000-7028-805e-ed0000000028');
