-- F01: seed the ten fixed departments (ADR 0014). Ids are fixed UUIDv7 literals so every
-- environment has the same ids; names are the editable Arabic display names.
INSERT INTO "departments" ("id", "code", "name") VALUES
	('01a0e97d-0023-7c42-857b-de0c777a52fb', 'general_management', 'الإدارة العامة'),
	('01a0e97d-0024-7e93-8e7f-2574646e7003', 'internal_operations', 'العمليات الداخلية'),
	('01a0e97d-0026-7424-babb-6ea4f083b55e', 'public_relations', 'العلاقات العامة'),
	('01a0e97d-0027-7a51-8d1e-2bd9badfa0c8', 'marketing', 'التسويق'),
	('01a0e97d-0028-7d46-8479-9fa1ea9ffcd7', 'design', 'التصميم'),
	('01a0e97d-0029-7d36-a99f-72fb7d3a67be', 'photography', 'التصوير'),
	('01a0e97d-002a-7b06-bcc0-ed1e76bd7367', 'content_management', 'إدارة المحتوى'),
	('01a0e97d-002b-7215-b506-275963adc85b', 'development', 'التطوير'),
	('01a0e97d-002c-71c5-91d8-2fa044db3e7c', 'general_communication', 'التواصل العام'),
	('01a0e97d-002d-71ea-9e63-db9ec2b674a6', 'medical_consultation', 'الاستشارات الطبية');
--> statement-breakpoint
-- Employee and Department Manager are derived now (ADR 0014); only assigned roles are stored.
DELETE FROM "user_roles" WHERE "role" IN ('employee', 'department_manager');
