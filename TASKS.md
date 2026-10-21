# TASKS — F17 HR: employee files, attendance and leave

Spec: `docs/specs/F17-hr-files-attendance-leave.md` (Approved 2026-10-21) · ADR 0039 (and 0006, 0013, 0014, 0017, 0018, 0019, 0022, 0032, 0036, 0037).
Parts A → B → C → D, each accepted by the owner before the next starts (spec, "Parts and PRs"). One session per PR. Parts B–D are planned when they start.

## PR A1 — employee files: contracts, db, api
- [x] contracts: `hr.ts` (employee file, list query and page, update, payout, salary change, end of service, `WEEKDAYS`, enums); the eight permissions and grants + `permissions.test.ts`; error codes `INVALID_DATES`, `SCHEDULE_ARCHIVED`, `DUPLICATE_EFFECTIVE_DATE`, `ALREADY_ENDED`; audit actions and entity types; F10 owner type `employee`; notification types `contract_ending`, `probation_ending`, `employee_leaving`, `salary_changed` (texts in `messages`, no amount); `hr.daily` job; unit tests; `ar.json` keys
- [x] db (`/db-migration`): `work_schedules`, `work_schedule_days` (seeded "Main schedule"), `employee_files` (one per existing user), `salary_changes`; `file_items` owner type `employee`; `TABLE_OWNERS`
- [x] api `hr` module: employees list, detail (rule A2 visibility), update, payout, salaries list/add/archive, end of service and undo; F01 hooks (create, archive, restore the file); F10 documents on `employee` with the confidential rule (A6); `hr.daily` (reminders A7, end-of-service archive A8) and `hr:run-daily`; `test/hr-employees.test.ts`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`, owner 2026-10-21), PR with auto-merge

## PR A2 — employee files: web and E2E
- [x] HR nav section, People `/hr/people`, employee file `/hr/people/:userId` (tabs Personal, Contract and schedule, Pay, Documents; end of service), `/me/file`
- [x] E2E: `f17.spec.ts` (with and without pay, roles), screenshots in both themes; mocks in `fixtures.ts`
- [x] checks, reviewer, acceptance (spec steps 2 and the file part of 1), PR with auto-merge, `docs/ROADMAP.md`

## PR B1 — rules: contracts, db, api
- [ ] contracts: schedules (`workScheduleSchema`, create/update, `INVALID_TIMES`), holidays (`holidaySchema`, `{ year }` repeat, at most 10 days), `hrSettingsSchema` (tiers ascending, fractions, last tier open); `isWorkDay(date, holidays)` and the work-day helpers taking holidays; error codes `SCHEDULE_IN_USE`, `DEFAULT_REQUIRED`, `INVALID_TIMES`, `HOLIDAY_OVERLAP`; audit actions and entity types; notification type `holiday_changed` (text in `messages`); F11 key date kind `holiday`; unit tests; `ar.json` keys
- [ ] db (`/db-migration`): `public_holidays`, `hr_settings` (one seeded row with the defaults)
- [ ] api `hr`: schedules list/create/update/archive (rule B2), holidays list/create/update/archive/repeat (rule B3, `holiday_changed`), settings get/put; an exported holiday service; F07 template due dates and F08 publish reminders (and the other work-day callers ADR 0039 names) skip holidays (rule B1); calendar holiday key dates; tests in `test/hr-rules.test.ts`
- [ ] bridge: `openapi:export`, `api:generate`; web typecheck
- [ ] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge

## PR B2 — rules: web and E2E
- [ ] HR settings `/hr/settings` (`hr.manage`): Rules (grace, tiers, leave policy; the start date stays for part C), Schedules, Holidays with "Repeat last year"; holidays on the calendar
- [ ] E2E: `f17-rules.spec.ts`, screenshots in both themes; mocks in `fixtures.ts`
- [ ] checks, reviewer, acceptance (spec step 1 without the entrance screen and start date), PR with auto-merge

## PR B3 — leave: contracts, db, api
- [ ] contracts: requests of kind `leave` and `permission` (create, preview, list query and page, detail, decision, cancel), leave day counting, the sick and emergency split, accrual and rollover as pure functions with unit tests; `leaveBalanceSchema`, adjustments; opinions; error codes `REQUEST_OVERLAP`, `INSUFFICIENT_BALANCE`, `ON_PROBATION`, `PERMISSION_LIMIT`, `TOO_LATE`, `NOT_A_WORK_DAY`, `NOT_PENDING`, `CERTIFICATE_MISSING`, `NOT_CANCELLABLE`, `ASSIGNEE_ON_LEAVE`; notification types `hr_request_submitted`, `hr_request_decided`, `colleague_on_leave`, `leave_balance_adjusted`; F10 owner type `hr_request`; F11 item kind `leave` and conflict kind `leave`; `ar.json` keys
- [ ] db (`/db-migration`): `hr_requests`, `leave_ledger`, `hr_opinions`; `file_items` owner type `hr_request`
- [ ] api `hr`: balances and adjustments (B6, B7), requests preview/create/list/detail/decision/cancel (B8–B15), opinions; `hr.daily` gains accruals, grants, the year rollover and `colleague_on_leave` (B4, B5, B18); holiday changes recompute pending leave days (B3, edge case 11); exported `LeaveDirectory` for `tasks` and `calendar`: calendar leave items without the type (B16), `ASSIGNEE_ON_LEAVE` with `acceptLeave` on task create, assign and re-date, `leave` conflicts on shoots and meetings (B17); tests in `test/hr-leave.test.ts`
- [ ] bridge: `openapi:export`, `api:generate`; web typecheck
- [ ] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge

## PR B4 — leave: web and E2E
- [ ] My attendance `/me/attendance` with Balances and Requests only (the Today card is part C), the request dialog with the preview and the certificate upload; employee file Leave tab (balances, ledger, adjustments, opening); Approvals `/hr/approvals` (requests); "On leave" on the calendar; the leave warning with "Assign anyway" in the task, shoot and meeting dialogs
- [ ] E2E: `f17-leave.spec.ts` (employee, GM, department manager), screenshots in both themes; mocks in `fixtures.ts`
- [ ] checks, reviewer, acceptance (spec step 5), PR with auto-merge, `docs/ROADMAP.md`
