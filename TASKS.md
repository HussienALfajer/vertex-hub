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
- [x] contracts: schedules (`workScheduleSchema`, create/update, `INVALID_TIMES`), holidays (`holidaySchema`, `{ year }` repeat, at most 10 days), `hrSettingsSchema` (tiers ascending, fractions, last tier open; the start date stays for part C); `isWorkDay(date, holidays)` and the work-day helpers taking holidays (F07 `planTemplateRun`, F08 `postTaskDueDate`); error codes `SCHEDULE_IN_USE`, `DEFAULT_REQUIRED`, `INVALID_TIMES`, `HOLIDAY_OVERLAP`; audit actions and entity types; notification type `holiday_changed` and subject `holiday` (text and link in `messages`); unit tests; `ar.json` keys
- [x] db (`/db-migration`): `public_holidays`, `hr_settings` (one seeded row with the defaults); notification subject `holiday`
- [x] api `hr`: schedules list/create/update/archive (rule B2), holidays list/create/update/archive/repeat (rule B3, `holiday_changed`), settings get/put, new files take `defaultAnnualLeaveDays`; an exported `HolidayCalendar`; F07 template runs, F08 post task due dates and publish reminders skip holidays (rule B1); tests in `test/hr-rules.test.ts`; error code `SCHEDULE_NAME_TAKEN` (names are unique, spec Data)
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`, owner 2026-10-21), PR with auto-merge

## PR B2 — rules: web and E2E
- [x] contracts and api: the calendar's `holiday` key dates for everyone (rule B16), moved here from B1 because the calendar screen must show them in the same PR
- [x] bridge: `openapi:export`, `api:generate`
- [x] HR settings `/hr/settings` (`hr.manage`): Rules (grace, tiers, leave policy; the start date stays for part C), Schedules, Holidays with "Repeat last year"; holidays on the calendar; the F08 post task form's default due date skips holidays; a file's schedule in the contract dialog; HR nav item
- [x] E2E: `f17-rules.spec.ts`, screenshots in both themes; mocks in `fixtures.ts`
- [x] checks, reviewer, acceptance (spec step 1 without the entrance screen and start date; owner 2026-10-21), PR with auto-merge

## PR B3 — leave: contracts, db, api
- [x] contracts: requests of kind `leave` and `permission` (create, preview, list query and page, detail, decision, cancel), leave day counting, the sick and emergency split, accrual and rollover as pure functions with unit tests; `leaveBalanceSchema`, adjustments; opinions; error codes `REQUEST_OVERLAP`, `INSUFFICIENT_BALANCE`, `ON_PROBATION`, `PERMISSION_LIMIT`, `TOO_LATE`, `NOT_A_WORK_DAY`, `NOT_PENDING`, `CERTIFICATE_MISSING`, `NOT_CANCELLABLE`, `ASSIGNEE_ON_LEAVE`; notification types `hr_request_submitted`, `hr_request_decided`, `colleague_on_leave`, `leave_balance_adjusted`; F10 owner type `hr_request`; F11 item kind `leave` and conflict kind `leave`; `ar.json` keys
- [x] db (`/db-migration`): `hr_requests`, `leave_ledger`, `hr_opinions`; `file_items` owner type `hr_request`
- [x] api `hr`: balances and adjustments (B6, B7), requests preview/create/list/detail/decision/cancel (B8–B15), opinions; `hr.daily` gains accruals, grants, the year rollover and `colleague_on_leave` (B4, B5, B18); holiday changes recompute pending leave days (B3, edge case 11); exported `LeaveDirectory` for `tasks` and `calendar`: calendar leave items without the type (B16), `ASSIGNEE_ON_LEAVE` with `acceptLeave` on task create, assign and re-date, `leave` conflicts on shoots and meetings (B17); tests in `test/hr-leave.test.ts`; exported `LeaveWorkSources` registry (tasks, calendar) for the overlapping work (B14); `hr_request` file owner policy; archiving an account cancels its pending requests (A8)
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer, acceptance (API at `/api/docs`, owner 2026-10-21), PR with auto-merge

## PR B4 — leave: web and E2E
- [x] My attendance `/me/attendance` with Balances and Requests only (the Today card is part C), the request dialog with the preview and the certificate upload; employee file Leave tab (balances, ledger, adjustments, opening); Approvals `/hr/approvals` (requests); "On leave" on the calendar; the leave warning with "Assign anyway" in the task, shoot and meeting dialogs
- [x] request page `/hr/requests/:id` (details, opinions, overlapping work, documents); `/hr` opens the first HR page the user can use; nav: My attendance, HR › Requests
- [x] E2E: `f17-leave.spec.ts` (employee, GM, department manager), screenshots in both themes; mocks in `fixtures.ts`
- [x] checks, reviewer, acceptance (spec step 5; owner 2026-10-22), PR with auto-merge, `docs/ROADMAP.md`

## PR C1 — attendance core: contracts, db, api
- [x] contracts: `attendance.ts` (passkey, kiosk, punch options and punch, day, my today, greeting); pure functions with unit tests: the day computation (rules C15, C16), the midnight rule and next direction, the code and window check (C5), the office address rule (IPv4 equal, IPv6 /64; C6), the greeting's part of day; `attendanceStartsOn` in `hrSettingsSchema` (C1); request kind `passkey_replacement` (texts in `messages`); error codes `EXEMPT`, `NO_PASSKEY`, `INVALID_CODE`, `OFF_OFFICE_NETWORK`, `NOT_REMOTE_DAY`, `NOT_ON_SHOOT`, `LOCATION_REQUIRED`, `PASSKEY_FAILED`, `TICKET_EXPIRED`, `DUPLICATE_PUNCH`, `PENDING_EXISTS`, `INVALID_PAIRING_CODE`; audit actions and entity types; `ar.json` keys
- [x] db (`/db-migration`): `attendance_passkeys`, `attendance_kiosks`, `attendance_punches`, `attendance_days` (`schema/attendance.ts`, owner `hr`); `hr_settings.attendance_starts_on`; request kind `passkey_replacement` (its check compares `kind::text`: a new enum value cannot be used in its own transaction)
- [x] api `hr`: SimpleWebAuthn dependency; passkeys register, replacement request, revoke (C3, C9); kiosks create, pairing code, archive, `/api/kiosk/pair` (rate-limited in nginx), `/api/kiosk/stream` SSE with greetings through `pg_notify` (C4, C5, C20); punch options and punch for office, remote, field and shoot (C6–C8, C11, C13) with `attendance.punch_refused`; the greeting (C20, moved here from C2: the punch returns it); days created and finalized by `hr.daily`, recomputed on punches, leave, holidays, the start date and the file's schedule, exemption, start and remote days (C14); `GET /attendance/me/today`, `GET /attendance/days`; trial mode (C1); `AttendanceShoots` registry filled by `calendar`; tests in `test/hr-attendance.test.ts`; nginx locations for the pairing and the stream
- [x] bridge: `openapi:export`, `api:generate`; web typecheck (the settings form keeps the stored start date until C3 adds its field)
- [x] checks, reviewer (7 findings fixed; the midnight rule C15 settled by the owner 2026-10-22: before 06:00), acceptance (API at `/api/docs`, owner 2026-10-22), PR with auto-merge

## PR C2 — attendance decisions: contracts, db, api
- [x] contracts: `attendanceItemSchema`, `attendanceItemListQuerySchema` and page, `decideItemSchema` (per kind: lateness, early leave, absence → deducted 0.25–1 / waived / warned; missing out → waived / deducted; overtime → paid / time_off / rejected), justification; request kinds `remote_day` and `correction` (`correctionDirection`, past day of an open month) in the request schemas; `todayBoardSchema`; opinions take `requestId | itemId`; pure functions with unit tests: the lateness tier lookup and the first-lateness warning, the items a day raises and voids (C14, C17), the overtime credit rounded down to 0.5 (C18); error codes `INVALID_DECISION`, `NOT_FIELD`; audit actions and entity types; notification types `attendance_item_raised`, `attendance_items_pending`, `attendance_item_decided`, `attendance_check_in_missing`, `attendance_check_out_missing`, `field_punch_recorded`, `field_punch_rejected`, `shoot_check_in_missing`, `kiosk_offline` (texts in `messages`, never a deduction); `ar.json` keys
- [x] db (`/db-migration`): `attendance_items` (one non-void item per day and kind); `hr_request_kind` gains `remote_day` and `correction`, `hr_requests.correction_direction` and the kind check (compared as `kind::text`); `hr_opinions.item_id` with request-or-item check; `leave_ledger` entry `overtime_credit`; notification types, subjects and reminder kinds (migration 0081)
- [x] api `hr`: items raised and voided by the day computation, never in trial (C1, C14, C17); justification; decision and change while open, `time_off` credit and its reversal (C18); remote days and corrections as requests (C19; an approved remote day sets the day's place and allows remote punches; an approved correction writes a `correction` punch and voids missing out); field and shoot punch review `POST /attendance/punches/:id/reject` (C12) and `field_punch_recorded`; the F16 minute job: check-in and check-out reminders (C21), `shoot_check_in_missing` (C13), `kiosk_offline` and its resolution (C22); `GET /attendance/today`; `GET /items`; opinions on items; GM self-decision (edge case 19); tests in `test/hr-attendance-items.test.ts`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck (the E2E mocks refuse remote days and corrections until C3 gives them screens)
- [x] checks (full run; screens E2E passes with 2 workers, times out under full load), reviewer (3 findings fixed: items of days that stop applying, `leave_ledger.item_id` in migration 0082, `NOT_YET`)
- [x] acceptance (API at `/api/docs`, owner 2026-10-22), PR with auto-merge

## PR C3 — attendance screens: web and E2E
- [x] contracts and api: `fieldWork` on the punch (rule C11: an open task due today or a meeting today, from `LeaveWorkSources`; titles through the new `AttendanceFieldWork` registry filled by `tasks` and `calendar`); `passkey` state on the file's employment (People, the file); tests in `test/hr-attendance.test.ts`
- [x] bridge: `openapi:export`, `api:generate`
- [x] deploy: the hub's own copy of the standard headers with `camera=(self)` and `geolocation=(self)` (the server's `security-headers.conf` turns both off); installed by `provision.sh` after merge
- [x] `/kiosk` entrance screen; My attendance Today card, scanner, passkey setup, This month; HR settings: start date and Entrance screens; request dialog for remote days and corrections; the field punch's optional task or meeting (`field_task_id`, `field_meeting_id`: the columns exist, the API takes them with the picker); WebAuthn needs a domain, so local checks use `localhost`, not `127.0.0.1`
- [x] Today `/hr/today`; Approvals with items (item page `/hr/items/:id`, bulk apply of a proposal); employee file Attendance tab and passkey state; People passkey column; `/attend#<code>` for a phone camera; the punch in two taps (prepare, then the passkey prompt)
- [x] E2E: `f17-attendance.spec.ts` (WebAuthn through Chromium's virtual authenticator on `localhost`), screenshots in both themes; mocks in `fixtures.ts`
- [x] checks (full run; HR screens pass with 2 workers, time out under full load), reviewer (5 findings fixed: the kiosk stream watchdog, HSTS `includeSubDomains`, passkey registration in two taps, the pairing code as a field error, stale docs), acceptance (in the browser, owner 2026-10-22; the phone at the office after deploy), PR with auto-merge, `docs/ROADMAP.md`

## PR D1 — months: contracts, db, api
- [x] contracts: `attendanceMonthSchema`, `monthSheetSchema` (employees × days, totals, pending counts), `attendanceMonthSummarySchema`; the month summary as a pure function with unit tests (rule D3: work, present, remote, field, absent, leave by type, unpaid, holidays, late count, deducted days, overtime paid and time off, worked minutes); error codes `MONTH_CLOSED`, `MONTH_NOT_ENDED`, `MONTH_HAS_PENDING` (with the list), `NOT_CLOSED`; audit actions `attendance_month.closed` / `reopened` and entity type; notification type `attendance_month_closed` (Finance, informational; text in `messages`); `ar.json` keys
- [x] db (`/db-migration`): `attendance_months`, `attendance_month_summaries` (unique `month_id`, `user_id`) in `schema/attendance.ts`; notification type
- [x] api `hr`: `GET /months/:month` in scope (D1); close (D2, D3: summaries in the transaction, `attendance_month_closed`) and reopen with a reason (D4); one `MONTH_CLOSED` guard used by punches and punch options, punch reject, corrections and every request create, decision and cancel, item decisions, holidays (create, update, archive, repeat; edge case 12) and the day recomputation (closed days are not recomputed); Excel exports for the month sheet and an employee's month (D5, exceljs as F15, self or `hr.read`); tests in `test/hr-months.test.ts`
- [x] bridge: `openapi:export`, `api:generate`; web typecheck
- [x] checks, reviewer (3 findings fixed: items raised by the closing's recompute kept, the holiday lock in closing, guard tests), acceptance (owner 2026-10-22: Finance reads and exports the month sheet), PR with auto-merge

## PR D2 — months: web and the full E2E pass
- [x] Month `/hr/months/:month` (sheet employees × days, totals, pending counts, Close with the pending list, Reopen with a reason, Excel); month navigation; links from Today and the file's Attendance tab; "Excel" on My attendance's This month; `MONTH_CLOSED` and the other new errors in `ar.json`; HR nav item
- [x] E2E: `f17-months.spec.ts`, screenshots in both themes; mocks in `fixtures.ts`; the full F17 E2E pass (spec acceptance, Tests)
- [x] checks, reviewer (1 finding fixed: the pending list dialog's close button and focus), acceptance (spec step 7; owner 2026-10-22), PR with auto-merge, `docs/ROADMAP.md` (F17 done)
