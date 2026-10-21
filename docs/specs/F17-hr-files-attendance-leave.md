# F17 — HR: employee files, attendance and leave

Status: Approved · Date: 2026-10-21 · Scope: `docs/product/v2-scope.md` §F17 (and §2) · ADRs: 0006, 0013, 0014, 0017, 0018, 0019, 0022, 0032, 0036, 0037, 0039

## Summary
The agency keeps contracts, start dates and salaries outside the system, takes attendance by trust, and handles leave by message. Nobody can say who is in today, who is on leave next week, or how many days someone has left, and a task can be assigned to a person who is away.

F17 adds an `hr` module with four parts:
- **Employee files:** personal details, contract, probation, schedule, payout method, salary history (General Manager and Finance only), documents through F10, the end of service, and reminders before a contract or probation ends.
- **Rules:** named work schedules (fixed or flexible), public holidays, a grace period, lateness tiers in fractions of a day, early leave, overtime, remote days, and the leave policy, all set in the app.
- **Attendance:** at the office, the employee scans a QR code that changes every 20 seconds on a paired **entrance screen** and confirms with a **passkey** on their own phone, from the **office network**. Remote days, field work and F11 shoots use the passkey with the phone's location; the crew of a shoot checks in at its start and out at its end. Location is read only at a punch, never tracked in between. Lateness, early leave, absence and overtime become **items that the General Manager decides**; nothing is deducted before that. The General Manager closes each month for F19.
- **Leave:** annual, sick, emergency and unpaid leave, half days and hourly permissions, with balances kept as a ledger, requests approved by the General Manager, leave on the company calendar, and warnings when work is assigned to someone on leave.

## In scope / out of scope
- In:
  - **Part A, employee files.** The `employee_files` row of every user, salary history, payout method, documents (F10 owner type `employee`), the end of service with the account archived on its day, contract and probation reminders, four permissions and the People screens.
  - **Part B, rules and leave.** Work schedules, public holidays (also skipped by the work-day functions of F07 and F08), HR settings, the leave balance ledger with monthly accrual and the year rollover, leave and permission requests and their decisions, leave on the company calendar, leave warnings on tasks, shoots and meetings, and the approvals inbox.
  - **Part C, attendance.** Attendance passkeys, entrance screens (kiosks) and the rotating QR code, check-in and check-out at the office, on a remote day, in the field and at a shoot, location at every punch, the day computation, attendance items and justifications, correction and remote-day requests, check-in and check-out reminders, the greeting, My attendance and the Today board.
  - **Part D, months.** The month sheet, closing and reopening a month with its frozen summary, and the Excel files.
- Out (later or never):
  - Payroll, money deductions, payslips, commissions and shares: F19. F17 stores deductions as fractions of a day and overtime as minutes; F19 turns them into money.
  - Signing in with a passkey: the passkey is for attendance only (owner, 2026-10-21).
  - A list of who is present on the entrance screen (owner, 2026-10-21).
  - Department-manager approval: every decision is the General Manager's (owner, 2026-10-21). Department managers read and give an opinion.
  - Shifts that cross midnight, rotating rosters, breaks tracked as punches.
  - Performance reviews, recruitment, training, assets in custody (custody is F18).
  - Hardware fingerprint readers, NFC or Bluetooth beacons.
  - Leave types beyond the four, maternity and bereavement rules (recorded as unpaid or adjusted by hand until a later decision).
  - Employees editing their own personal details (owner, 2026-10-21: the recommended option keeps them with HR).
  - Tracking an employee's location between punches (owner, 2026-10-21). An installed web app cannot read the location while it is closed or the phone is locked, so continuous tracking would need a native store app; the location is read at each punch only.

## Roles and access
Eight new permissions (`packages/contracts/src/permissions.ts`):

| Permission | Granted to | Covers |
|---|---|---|
| `employees.read` | General Manager: `all` · Internal Operations manager: `all` | Employee files without pay: personal, contract, schedule, documents not marked confidential, end of service |
| `employees.manage` | General Manager: `all` · Internal Operations manager: `all` | Edit those files, end a service, upload documents |
| `salaries.read` | General Manager: `all` · Finance: `all` | Salary history, payout method, confidential employee documents |
| `salaries.manage` | General Manager: `all` | Add or archive a salary change |
| `payouts.manage` | General Manager: `all` · Finance: `all` | Edit the payout method |
| `hr.read` | General Manager: `all` · Internal Operations manager: `all` · Department Manager: `department` | Attendance, leave (with its type), balances, requests and items; `department` = members of the departments they manage |
| `hr.manage` | General Manager: `all` · Internal Operations manager: `all` | Schedules and their assignment, holidays, HR settings, entrance screens, the attendance start date |
| `hr.approve` | General Manager: `all` | Decide requests, items, field punches and passkey replacements; adjust balances; record leave for anyone; close and reopen months |

| Action | Permission | Roles and scope |
|---|---|---|
| Read own file, own salary history and payout method, own documents | session | every active user, own record only |
| Own attendance, balances, requests, items; check in and out; register the attendance passkey | session | every active user who is not attendance-exempt (leave and balances also for exempt users) |
| Submit a request, justify an item, cancel own pending request | session | own records only |
| Read the attendance and leave of others, with the leave type; give an opinion on a pending request or item | `hr.read` | GM, Ops: everyone · Department Manager: members of departments they manage |
| Read and edit employee files; end a service | `employees.read` / `employees.manage` | GM, Ops |
| Read salaries and payout; edit payout | `salaries.read` / `payouts.manage` | GM, Finance |
| Add or archive a salary change | `salaries.manage` | GM |
| Schedules, holidays, settings, entrance screens, start date | `hr.manage` | GM, Ops |
| Decide requests, items, field punches, passkey replacements; adjust balances; close and reopen months | `hr.approve` | GM |
| See that a colleague is "on leave" on given days (no type) | `calendar.read` | everyone (as F11) |

- A holder of `hr.approve` acting on their own records needs no decision: their requests are approved and their items decided when they record them, and the audit says so (owner, 2026-10-21).
- Salary amounts never appear in a notification, a push, an email or the audit summary text; the audit entry stores them in its data, readable with `audit.read`.
- `audit.read` holders (GM, Ops) can read HR audit entries; entries on salaries show their amounts only to `salaries.read` holders.

## Data
All tables are owned by the new `hr` module (`packages/db/src/schema/hr.ts`) unless stated. Days are `Asia/Damascus` calendar dates; times of day are `time` in that zone; instants are `timestamptz`. Fractions of a day are `numeric(4,2)` (0.25, 0.5, 1). Leave days are `numeric(5,1)` (half days).

### `employee_files`
One per user, created by migration for every existing user and with every new user (F01 create).

| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK `users`, unique | |
| `national_id`, `birth_date`, `address` | text / date / text, null | personal |
| `emergency_name`, `emergency_phone`, `emergency_relation` | text, null | phone as F01 (`+` and 8–15 digits) |
| `employment_type` | enum `full_time`, `part_time`, `freelance`, default `full_time` | |
| `start_date` | date, null | first working day; required before leave accrues and before attendance is computed for the user |
| `probation_end_date` | date, null | ≥ `start_date` |
| `contract_end_date` | date, null | null = open-ended; ≥ `start_date` |
| `schedule_id` | uuid FK `work_schedules`, not null | defaults to the default schedule |
| `attendance_exempt` | boolean, default false | no punches, items or reminders; leave still works |
| `remote_weekdays` | `weekday[]`, default empty | standing remote days (rule C6) |
| `annual_leave_days` | numeric(4,1), not null | yearly entitlement; defaults to the setting (14) |
| `payout_method` | enum `cash`, `bank_transfer`, `mobile_wallet`, null | |
| `payout_institution`, `payout_account`, `payout_holder` | text, null | bank or wallet provider, account/IBAN/wallet number, holder name; required by method (not for `cash`) |
| `ended_on` | date, null | last working day |
| `end_reason` | enum `resigned`, `terminated`, `contract_ended`, `other`, null | required with `ended_on` |
| `end_note` | text, null | |
| timestamps, `archived_at` | | archived with the user (F01 archive); restored with them |

### `salary_changes`
| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK `users` | indexed |
| `effective_on` | date | |
| `amount_minor` | bigint | > 0; a monthly fixed salary (F19 adds other components) |
| `currency` | `currency` enum (USD, SYP) | per change (owner, 2026-10-21: each employee has their currency) |
| `reason` | text, required | e.g. "Starting salary", "Annual raise" |
| `created_by_id` | uuid FK `users` | |
| timestamps, `archived_at` | | a wrong entry is archived with a reason (`archive_reason`), never edited |

The current salary is the non-archived change with the latest `effective_on` ≤ today. Two non-archived changes of one user on the same `effective_on` are refused (partial unique index).

### `work_schedules` and `work_schedule_days`
`work_schedules`: `name` (unique, case-insensitive), `kind` enum `fixed`, `flexible`, `is_default` boolean (exactly one, partial unique index), timestamps, `archived_at` (the default and an assigned schedule cannot be archived).

`work_schedule_days` (PK `schedule_id`, `weekday`): `start_time` time (fixed: start; flexible: the window opens), `latest_start_time` time, null (flexible only: the window closes), `required_minutes` int 60–960. A weekday without a row is an off day. Fixed end = `start_time` + `required_minutes`, ≤ 23:59.

`weekday` enum (contracts `WEEKDAYS`): `saturday` … `friday`. The migration seeds one default fixed schedule "Main schedule", Saturday–Thursday 09:00 for 480 minutes; the owner sets the real hours before the start date (rule B2).

### `public_holidays`
`name`, `starts_on`, `ends_on` (≥ `starts_on`, at most 10 days), `paid` boolean default true, timestamps, `archived_at`. Overlapping non-archived holidays are refused.

### `hr_settings`
One row (`id` fixed), seeded with the defaults below (owner, 2026-10-21, "the recommended" options):

| Field | Default |
|---|---|
| `attendance_starts_on` | null (trial mode, rule C1) |
| `grace_minutes` | 10 |
| `lateness_tiers` jsonb `[{ upToMinutes, fraction }]` | `[{30, 0.25}, {60, 0.5}, {null, 1}]` (a tier with `upToMinutes` null is "more") |
| `first_lateness_warning` | true (rule C17) |
| `overtime_min_minutes` | 30 |
| `check_in_reminder_minutes` | 15 |
| `default_annual_leave_days` | 14 |
| `carry_over_max_days` | 5 |
| `sick_days_per_year` | 14 |
| `sick_certificate_after_days` | 2 |
| `sick_request_within_work_days` | 3 |
| `emergency_days_per_year` | 3 |
| `permission_max_minutes` / `permissions_per_month` | 120 / 4 |
| `annual_notice_work_days` / `remote_notice_work_days` | 3 / 1 |
| `overtime_minutes_per_leave_day` | 480 |

Validated by `hrSettingsSchema` (tiers ascending, fractions in {0.25, 0.5, 0.75, 1}, last tier open).

### `attendance_passkeys`
WebAuthn credentials for attendance only (ADR 0039), not Better Auth's passkey plugin.

| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK `users` | indexed |
| `credential_id` | text, unique | base64url |
| `public_key` | bytea | |
| `counter` | bigint | |
| `transports` | text[] | |
| `device_label` | text | e.g. "Safari · iPhone", from the registering session (F01B) |
| `status` | enum `pending`, `active`, `revoked` | at most one `active` and one `pending` per user (partial unique indexes) |
| `decided_by_id`, `decided_at` | | for a replacement (rule C9) |
| timestamps, `archived_at` | | revoked rows are kept |

### `attendance_kiosks`
`name`, `token_hash` (SHA-256 of the kiosk cookie, unique, null until paired), `pairing_code_hash` and `pairing_expires_at` (null once paired), `secret` (32 random bytes, encrypted at rest with `BETTER_AUTH_SECRET` like the TOTP secrets) for the QR codes, `last_seen_at`, `last_ip_address`, `recent_ips` jsonb (addresses seen in the last 10 minutes, with times), `created_by_id`, timestamps, `archived_at` (archived = unpaired; its cookie stops working).

### `attendance_punches`
| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK `users` | indexed with `at` |
| `direction` | enum `in`, `out` | |
| `at` | timestamptz | server time of the request, never the phone's |
| `method` | enum `office`, `remote`, `field`, `shoot`, `correction` | |
| `kiosk_id` | uuid FK, null | `office` only |
| `ip_address` | text | |
| `latitude`, `longitude` | numeric(9,6), null | required for `remote`, `field` and `shoot`; recorded when the phone gives it for `office` (rule C6a) |
| `accuracy_m` | int, null | |
| `field_note` | text, null | required for `field` |
| `field_task_id` / `field_meeting_id` | uuid FK, null | optional link for `field` |
| `shoot_id` | uuid FK `shoots`, null | required for `shoot` |
| `field_review` | enum `accepted`, `rejected`, null | `field` and `shoot` start `accepted` (rule C12) |
| `request_id` | uuid FK `hr_requests`, null | `correction` only |
| timestamps, `archived_at` | | a rejected field punch is archived and no longer counts |

### `attendance_days`
One row per user and work-relevant date (unique `user_id`, `date`), created by the daily job for every non-exempt user with a `start_date` ≤ date, and recomputed whenever its inputs change (rule C14) until its month is closed.

| Field | Type | Rules |
|---|---|---|
| `date` | date | |
| `kind` | enum `work`, `off`, `holiday` | from the schedule and holidays at first computation; recomputed if a holiday changes |
| `expected_start`, `latest_start`, `expected_end` | timestamptz, null | frozen from the schedule when the day is first created, so later schedule edits never change past days |
| `required_minutes` | int, null | |
| `place` | enum `office`, `remote`, null | `remote` for an approved remote day or a standing remote weekday |
| `leave` | enum `none`, `full`, `first_half`, `second_half` | from approved leave |
| `first_in_at`, `last_out_at` | timestamptz, null | presence from punches |
| `worked_minutes`, `late_minutes`, `early_minutes`, `overtime_minutes` | int | computed |
| `status` | enum `upcoming`, `in_progress`, `present`, `partial`, `absent`, `leave`, `holiday`, `off`, `trial` | |
| timestamps, `archived_at` | | |

### `attendance_items`
What the General Manager decides.

| Field | Type | Rules |
|---|---|---|
| `user_id`, `day_id` | uuid FK | indexed |
| `kind` | enum `lateness`, `early_leave`, `absence`, `missing_out`, `overtime` | at most one non-void item per day and kind |
| `minutes` | int | late, early or overtime minutes; 0 for absence |
| `proposed_fraction` | numeric(4,2) | from the tiers; 1 for absence; 0 for overtime; 0 for the first lateness of the month when `first_lateness_warning` |
| `justification`, `justified_at` | text, timestamptz, null | the employee's |
| `status` | enum `pending`, `deducted`, `waived`, `warned`, `paid`, `time_off`, `rejected`, `void` | rule C18 |
| `decided_fraction` | numeric(4,2), null | for `deducted` |
| `decided_minutes` | int, null | for `paid` and `time_off` (≤ `minutes`) |
| `decided_by_id`, `decided_at`, `decision_note` | | |
| timestamps, `archived_at` | | |

### `hr_requests`
| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK | indexed |
| `kind` | enum `leave`, `permission`, `remote_day`, `correction`, `passkey_replacement` | |
| `leave_type` | enum `annual`, `sick`, `emergency`, `unpaid`, null | `leave` only |
| `starts_on`, `ends_on` | date, null | `leave` and `remote_day`; `correction`: the day |
| `half` | enum `first_half`, `second_half`, null | single-day `leave` only |
| `from_time`, `to_time` | time, null | `permission`; `correction` uses `to_time` null and `from_time` as the punch time |
| `correction_direction` | enum `in`, `out`, null | `correction` |
| `days` | numeric(5,1), null | work days the leave covers (holidays and off days excluded), computed |
| `paid_days`, `unpaid_days` | numeric(5,1), null | the split for sick and emergency (rule B12) |
| `reason` | text | required except for `annual` |
| `short_notice` | boolean | rule B9 |
| `status` | enum `pending`, `approved`, `rejected`, `cancelled` | |
| `created_by_id` | uuid FK | the employee, or the GM recording for them |
| `decided_by_id`, `decided_at`, `decision_note` | | |
| timestamps, `archived_at` | | |

Attachments (sick certificate) use F10 with a new owner type `hr_request` (role `document`).

### `leave_ledger`
A signed ledger; a balance is the sum of its non-archived rows.

| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid FK | indexed with `leave_type`, `year` |
| `leave_type` | enum `annual`, `sick`, `emergency` | `unpaid` has no balance |
| `year` | int | calendar year |
| `days` | numeric(5,1) | signed |
| `entry` | enum `opening`, `accrual`, `grant`, `carry_over`, `expiry`, `taken`, `restored`, `overtime_credit`, `adjustment` | |
| `request_id` / `item_id` | uuid FK, null | for `taken`, `restored`, `overtime_credit` |
| `note` | text, null | required for `adjustment` and `opening` |
| `created_by_id` | uuid FK, null | null for the job |
| timestamps, `archived_at` | | never edited |

Unique keys keep the jobs idempotent: one `accrual` per user and month (`period` column `YYYY-MM`), one `grant`, `carry_over` and `expiry` per user, type and year.

### `hr_opinions`
A department manager's or Ops' comment on a pending request or item: `request_id` or `item_id` (exactly one, check), `author_id`, `body` (≤ 1000), timestamps, `archived_at`.

### `attendance_months` and `attendance_month_summaries`
`attendance_months`: `month` (`YYYY-MM`, unique), `status` enum `open`, `closed`, `closed_by_id`, `closed_at`, `reopened_by_id`, `reopened_at`, `reopen_reason`, timestamps, `archived_at`.

`attendance_month_summaries` (unique `month_id`, `user_id`), written at closing (rule D3): `work_days`, `present_days`, `remote_days`, `field_days`, `absent_days`, `leave_days` jsonb by type, `unpaid_leave_days`, `holiday_days`, `late_count`, `deducted_days` numeric(5,2), `overtime_paid_minutes`, `overtime_time_off_minutes`, `worked_minutes`. F19 reads only these rows.

### Changes to existing tables
- `file_items.owner_type` gains `employee` (role `document`) and `hr_request` (role `document`).
- `users`: none. Archiving and restoring follow F01.

### Contracts
`packages/contracts/src/hr.ts` (files, salaries, settings, schedules, holidays, requests, items, months), `attendance.ts` (punches, days, kiosk, QR, greeting) and pure functions with unit tests: the day computation (rule C15), tier lookup, leave day counting, accrual, the QR token check and `isWorkDay(date, holidays)`.

## States and rules

### Part A: employee files
1. Every user has exactly one `employee_files` row. A user created after F17 gets one in the same transaction, with the default schedule and the default annual leave days.
2. `employees.read` holders see the file without pay fields. `salaries.read` holders see the Pay section. The employee sees their whole file, pay included, read-only. Everyone else gets 404 for another person's file.
3. Changing the schedule, the exempt flag or the remote weekdays applies from today: past days keep their frozen expectations; today's row is recomputed only if it has no punch yet.
4. **Salary changes** are added by `salaries.manage`, never edited. Archiving one needs a reason. The employee gets `salary_changed` (no amount).
5. **Payout method** is edited by `payouts.manage`. The institution, account and holder are required for `bank_transfer` and `mobile_wallet`, and cleared for `cash`.
6. **Documents** (contract, ID copy, certificates) are F10 documents on owner `employee`. A document marked confidential is visible only to `salaries.read` holders and the employee; others are visible to `employees.read` holders and the employee. Only `employees.manage` holders upload or archive; `salaries.read` holders may also upload confidential ones.
7. **Reminders.** The daily job notifies GMs and Ops `contract_ending` 30 and 7 days before `contract_end_date`, and `probation_ending` 14 days before `probation_end_date`. Changing the date or ending the service resolves them.
8. **End of service.** `employees.manage` sets `ended_on`, `end_reason` and an optional note. The date may be today or later (not earlier than the last day with a punch). GMs, Ops and the managers of the employee's departments get `employee_leaving`. On `ended_on + 1` the daily job archives the user through `auth`'s exported service (F01 archive rules: sessions closed, open work handed over as F16 `member_archived_open_work`). Pending requests are cancelled. The remaining annual balance is shown on the file for F19's final settlement. Clearing `ended_on` before that day undoes it.

Settled in implementation (PR A1, 2026-10-21):
- Rule A1: `auth`'s `UserLifecycle` creates, archives and restores the file in the transaction of F01's create, archive and restore. Users created outside F01's endpoints (the `user:create` command, the seed) get their file when HR first reads them or at the next `hr.daily` run. Until Part B adds `hr_settings`, a new file gets 14 annual days (`DEFAULT_ANNUAL_LEAVE_DAYS`).
- Rule A2: a `salaries.read` holder without `employees.read` (Finance) sees the name, title, departments, status and the Pay section, not the personal or contract sections.
- Rule A6: that holder also sees, adds and archives only the confidential documents.
- Audit: `employee_file` entries are keyed by the user id; personal fields are logged as `changed`, never with their values. `GET /api/audit` leaves salary amounts and payout details out of entries for readers without `salaries.read`.
- Rule A7: reminders are keyed per employee, end date and threshold (`contract_ending_30`, `contract_ending_7`, `probation_ending`). A run after missed days sends the latest threshold reached, once.
- Rule A8: `ALREADY_ENDED` answers a second end while one is set (clear it first to change the date). The day after `ended_on`, the job archives the account as the system, under F01's archive rules. While the user still holds responsibilities that block archiving (F01 rule 9), the archive is refused and retried daily, and the job logs the failure.
- Notification links: `contract_ending` and `probation_ending` open the file in HR; `employee_leaving` opens the member's profile, which department managers can read; `salary_changed` opens My file.

### Part B: rules and leave
1. **Work days.** A work day of a user is a weekday in their schedule that is not a public holiday. `isWorkDay(date, holidays)` replaces the holiday-less check used by F07 template due dates and F08 publish reminders (ADR 0039 amends ADR 0017): new runs skip holidays; tasks already generated keep their dates.
2. **Schedules** are created, edited and archived by `hr.manage`. Exactly one is the default. Editing a schedule changes days not yet created and today's day if it has no punch.
3. **Holidays** are managed by `hr.manage`, any number per year. "Repeat last year" copies last year's holidays to the same dates for review (the Eids move every year, so they are typed each year; no hard-coded list). Adding, re-dating or archiving a holiday notifies everyone (`holiday_changed`) and recomputes affected open days and pending leave counts. A worked holiday is overtime (rule C16).
4. **Balances.** Annual: on day 1 of each month the job adds `annual_leave_days / 12` (rounded to 0.5 by carrying the remainder) to each user whose `start_date` is before that day and who has not ended; the first accrual is on the first day 1 after `start_date`, pro rata by days in that first partial month. Sick and emergency: granted in full on 1 January and on `start_date` for a new employee (`grant`).
5. **Year rollover** (1 January): unused annual balance up to `carry_over_max_days` is carried (`carry_over` into the new year, `expiry` of the rest in the old one); sick and emergency do not carry.
6. **Opening balances.** When F17 goes live, `hr.approve` records each employee's opening annual balance (`opening`, with a note). Accrual starts with the next day 1.
7. **Adjustments.** `hr.approve` adds a signed `adjustment` with a reason; the employee gets `leave_balance_adjusted`.
8. **Requests** are submitted by the employee, or recorded by `hr.approve` for anyone (approved at once). One pending or approved request of one user cannot overlap another for the same days (`REQUEST_OVERLAP`), except a permission inside a work day.
9. **Notice.** Annual leave starting fewer than 3 work days ahead and a remote day requested less than 1 work day ahead are allowed and marked `short_notice` (owner, 2026-10-21). Emergency leave can be requested on the same day, and up to 1 day back. Sick leave can be requested up to 3 work days after the employee's return (`sick_request_within_work_days`).
10. **Annual leave** cannot exceed the available balance (`INSUFFICIENT_BALANCE`), and cannot be taken before `probation_end_date` (`ON_PROBATION`): balance accrues during probation, but is used after it. The employee may request the rest as unpaid.
11. **Half days and permissions.** A single-day leave can be a first or second half (0.5 day). A permission (`إذن مغادرة`) is a time window inside one work day, at most 120 minutes and 4 per calendar month (`PERMISSION_LIMIT`), and never touches a balance; its window is excused from lateness and early leave.
12. **Sick and emergency overflow.** Sick days beyond the sick balance, and emergency days beyond the 3-day cap or the annual balance, are not refused: the request shows the split (`paid_days`, `unpaid_days`) before it is submitted, and the unpaid part counts as unpaid leave. Emergency days draw on the annual balance (also during probation, as the only exception to rule 10).
13. **Sick certificate.** Sick leave longer than 2 days needs a certificate attached (F10). It can be added after submission; the GM sees "certificate missing" and approving without one needs a confirmation.
14. **Deciding.** `hr.approve` approves or rejects a pending request with an optional note (required to reject). Before deciding a leave, the screen shows the employee's open tasks due, shoots and meetings in the period (through `tasks` and `calendar` exported services). Approving a leave writes `taken` rows (split by year if it spans 31 December) and recomputes its days. A department manager's and Ops' opinions are shown on the request.
15. **Cancelling.** The employee cancels a pending request, or an approved one whose first day has not started. `hr.approve` can cancel an approved leave at any time while its month is open; days not yet taken are `restored`, and the days recompute.
16. **Calendar.** Approved leave shows on the company calendar (F11 item kind `leave`) as "On leave" with the person and days, without the type; `hr.read` holders in scope see the type. Holidays show as a key date kind `holiday` to everyone.
17. **Leave warnings** (warn, never block, as F11 conflicts). Assigning a task, or changing its due date, when its due date falls on a day of the assignee's approved leave returns `409 ASSIGNEE_ON_LEAVE` with the days, unless the request carries `acceptLeave: true`. Booking a shoot or a meeting with a team member on approved leave that day adds a `leave` conflict to `SCHEDULE_CONFLICT`. Template runs and automatic assignments do not warn. Accepting is audited.
18. The managers of the employee's departments get `colleague_on_leave` the work day before an approved leave starts.

### Part C: attendance
1. **Start date.** Until `attendance_starts_on`, attendance runs in **trial**: punches are recorded and days show `trial`, but no item, reminder or absence is produced (owner, 2026-10-21). `hr.manage` sets the date (today or later); leave works from the deploy regardless.
2. **Who.** Attendance applies to non-exempt users with a `start_date` ≤ the day and no past `ended_on`. Exempt users cannot punch.
3. **The attendance passkey.** Each user registers one passkey from the installed app on their phone (WebAuthn, platform authenticator, user verification required, so the phone's fingerprint, face or screen lock confirms it). The first registration is `active` at once. It is never used to sign in (owner, 2026-10-21).
4. **Entrance screens.** `hr.manage` creates a screen and gets a pairing code (8 characters, 15 minutes). On the screen's browser, `/kiosk` takes the code; the API sets a `vh_kiosk` cookie (random, `HttpOnly`, `Path=/api/kiosk`, 400 days) and stores its hash. The screen holds no user session. Archiving the screen unpairs it.
5. **The QR code.** The screen shows a code that changes every 20 seconds: `kioskId.window.mac`, where `window` = ⌊unix seconds / 20⌋ and `mac` = HMAC-SHA-256 of both under the kiosk's secret, truncated to 16 bytes, base64url. It is computed on the screen from a per-window value the API gives over the kiosk stream, so the secret never reaches the browser. A code is accepted for its window and the previous one (up to 40 seconds). The code is a link `/attend#<code>` so a phone's camera opens the check-in page; the app's own scanner is the main path.
6. **The office network** (owner, 2026-10-21). An office punch is accepted only when the phone's request comes from an address the paired screen used in the last 10 minutes (IPv4 equal; IPv6 the same /64), and the screen was seen in the last 2 minutes. Otherwise it is refused with `OFF_OFFICE_NETWORK` ("Connect to the office Wi‑Fi"), and the attempt is logged for the GM (`attendance.punch_refused` audit entry with the reason). This defeats a code sent by photo or video call.
6a. **Location at every punch** (owner, 2026-10-21). Every punch asks the phone for its location once, at the moment of the punch. It is required for remote, field and shoot punches (`LOCATION_REQUIRED` without it) and recorded as extra evidence at the office, where the network is the proof. Nothing reads the location between punches. The GM sees each punch's point on a map in the Today board and in the day's timeline.
7. **Office punch.** Scan → the app sends the code → the API checks it (rule 5) and the network (rule 6) and returns a WebAuthn challenge → the passkey signs → the API verifies it against the active passkey, then writes the punch. The direction is `in` when the user's last punch today is absent or `out`, else `out`. The phone and the screen both show the greeting (rule C20).
8. **Remote punch.** On an approved remote day or a standing remote weekday, the app offers "Check in remotely": passkey and location, no code, no network check.
9. **Replacing the passkey** (new phone). Registering again creates a `pending` passkey and a `passkey_replacement` request to the GM; until it is approved, the old one stays active (if the old phone is lost, the employee uses correction requests). Approving activates the new one and revokes the old. `hr.approve` can also revoke a passkey.
10. **Without a suitable phone.** A user with no active passkey cannot punch and submits corrections; the Today board marks them "no passkey".
11. **Field punch.** "Field work" asks for location (required; refused without it, `LOCATION_REQUIRED`), a reason, and optionally a task or meeting, then the passkey. It is accepted at once and appears to the GM with a map (owner, 2026-10-21).
12. **Field review.** `hr.approve` can reject a field punch with a note: it is archived, the day recomputes, and the employee gets `field_punch_rejected`.
13. **Shoots** (owner, 2026-10-21; replaces "counts without checking in" of 2026-10-20). Each team crew member of a `scheduled` F11 shoot checks in at its start and out at its end with a shoot punch: from 30 minutes before the start until its end, the app offers "Shoot check-in" with the shoot already chosen, and it needs the location and the passkey. The GM sees the point beside the shoot's place and map link, and can reject it as a field punch (rule 12). `shoot_check_in_missing` reminds a crew member 15 minutes after the start if they have not checked in. Without punches, shoot time does not count, and the normal lateness and absence rules apply. The shoot's place is text, so the distance is not checked automatically.
14. **Recomputation.** A day recomputes when a punch, leave, permission, remote day, holiday or exempt flag affecting it changes, while its month is open. Items that no longer apply become `void`; new ones are raised.
15. **Day computation** (pure function, unit tested). Presence = union of `[in, out)` punch intervals, whatever their method (an `in` at the office and an `out` at a shoot form one interval).
    - `late_minutes` = first presence − the latest allowed start (fixed: `expected_start`; flexible: `latest_start`), minus any permission window at the start, and 0 if within `grace_minutes`. A second-half leave sets no arrival; a first-half leave moves the start by half of `required_minutes`.
    - Expected end: fixed `expected_end`; flexible: actual start (not before the window opens) + `required_minutes`. Half-day leave halves the required minutes.
    - `early_minutes` = expected end − last presence, under the same grace and permission rules.
    - `overtime_minutes` = presence after the expected end, counted only if ≥ `overtime_min_minutes`. All presence on an off day or holiday is overtime.
    - An `out` punch after midnight closes the open `in` of the previous day if within 6 hours; otherwise the day has a missing `out`.
16. **Status.** `upcoming` before the day; `in_progress` while it runs; afterwards `present` (expectations met), `partial` (late, early or missing out), `absent` (a work day with no presence and no leave), `leave`, `holiday`, `off`.
17. **Items.** Raised at the moment they become known (lateness at check-in; early leave at check-out, replaced if the employee checks in again; absence, missing out and overtime when the day ends). `proposed_fraction` comes from the tiers on the late or early minutes; absence proposes 1; the first lateness of the month proposes 0 (a warning) when `first_lateness_warning`. The employee gets `attendance_item_raised` and may justify the item until it is decided.
18. **Deciding items** (`hr.approve`, owner: deductions only after approval).
    - lateness, early leave, absence: `deducted` with a fraction (0.25–1, default the proposal), `waived`, or `warned` (recorded, no deduction).
    - missing out: `waived` (the expected end is taken as the out) or `deducted` with a fraction; an approved correction for that day voids it.
    - overtime: `paid` (minutes for F19), `time_off` (minutes ÷ `overtime_minutes_per_leave_day` added to the annual balance as `overtime_credit`, rounded down to 0.5), or `rejected` (owner: the GM chooses at approval). The employee may add a reason as the justification.
    - A decision can be changed while the month is open; changing `time_off` reverses its credit.
19. **Corrections** (forgotten punch). The employee asks for an `in` or `out` time on a past day of an open month, with a reason. Approving writes a `correction` punch and recomputes the day.
20. **Greeting** (owner, 2026-10-20). After an `in`, the screen and the phone show for 8 seconds: "Good morning/afternoon/evening, <first name>", the number of open tasks assigned to the user and due today, and the time of their first shoot or meeting today, without client names. After an `out`: "Goodbye, <first name>" and today's worked time. The screen shows no list of who is present.
21. **Reminders** (F16 minute job). `attendance_check_in_missing` at the latest allowed start + `check_in_reminder_minutes` when the user has no presence, no leave and is not exempt; `attendance_check_out_missing` 60 minutes after the expected end while an `in` is open. Once per day each.
22. **Screen offline.** `kiosk_offline` to Ops and GMs when a paired screen is not seen for 10 minutes during working hours of the default schedule; resolved when it returns.

### Part D: months
1. **The month sheet** shows each employee's days and totals, with pending requests and items counted. `hr.read` holders see it in scope.
2. **Closing** (`hr.approve`) needs the month to have ended and no pending request or item dated in it (`MONTH_HAS_PENDING`, with the list). Closed months reject new punches, corrections, requests, decisions and recomputation dated in them (`MONTH_CLOSED`).
3. Closing writes `attendance_month_summaries` for every user with a day in the month, in the same transaction, and notifies Finance (`attendance_month_closed`).
4. **Reopening** needs a reason and deletes nothing: the summaries are rewritten at the next close. F19 will block reopening a month whose payroll is approved.
5. **Excel**: the month sheet (one row per employee, totals) and an employee's month (one row per day, with punches and items), with exceljs as F15.

### Changes to earlier features
- **F01:** creating a user creates their employee file; archiving archives it; restoring restores it.
- **F06:** `acceptLeave` on task create, assign and re-date (rule B17).
- **F07 / F08:** work-day functions skip public holidays (rule B1).
- **F10:** owner types `employee` and `hr_request`.
- **F11:** the calendar gains the `leave` item kind and the `holiday` key date kind; conflicts gain the `leave` kind.
- **F16:** the new notification types below; the audience resolver needs no change.

## Notification types
Added to `packages/contracts/src/notifications.ts`, in the F16 format. "GMs" = holders of the General Manager role; "Ops" = managers of Internal Operations; "dept managers" = managers of the employee's departments.

| Type | Event | Recipients | Pri. | Box | Push | Email | Resolves when / notes |
|---|---|---|---|---|---|---|---|
| `hr_request_submitted` | a request is submitted | GMs | important | A | on | — | decided or cancelled; merges per day; reminds after 1 work day (`action_reminder`) |
| `hr_request_decided` | a request is decided, or an approved one cancelled by the GM | the employee | important | I | on | on | |
| `attendance_item_raised` | an item is raised | the employee | normal | A | on | — | justified, decided or void; names the minutes, never a deduction |
| `attendance_items_pending` | items are raised | GMs | normal | A | — | — | merges per day ("5 attendance items to decide"); all decided or void |
| `attendance_item_decided` | an item is decided | the employee | normal | I | on | — | |
| `attendance_check_in_missing` | rule C21 | the employee | important | A | on | — | a punch, leave or the day ends |
| `attendance_check_out_missing` | rule C21 | the employee | normal | A | on | — | an `out` or a correction |
| `field_punch_recorded` | a field punch | GMs | informational | I | — | — | merges per day |
| `field_punch_rejected` | rule C12 | the employee | important | I | on | — | also for shoot punches |
| `shoot_check_in_missing` | rule C13 | the crew member | important | A | on | — | a shoot punch, the shoot cancelled or ended |
| `colleague_on_leave` | rule B18 | dept managers | informational | I | — | — | |
| `leave_balance_adjusted` | rule B7 | the employee | informational | I | — | — | |
| `holiday_changed` | rule B3 | everyone | normal | I | on | — | |
| `contract_ending` | rule A7 | GMs + Ops | important | A | on | on | the date changes or the service ends |
| `probation_ending` | rule A7 | GMs + Ops | important | A | on | — | the date changes or the service ends |
| `employee_leaving` | rule A8 | GMs + Ops + dept managers | normal | I | on | — | |
| `salary_changed` | rule A4 | the employee | normal | I | on | — | no amount in any channel |
| `kiosk_offline` | rule C22 | Ops + GMs | important | A | on | — | the screen is seen again |
| `attendance_month_closed` | rule D3 | Finance | informational | I | — | — | |

## API
All under `/api/hr` unless stated. Lists follow ADR 0013 (pagination, filters).

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /employees` | `employees.read` or `salaries.read` | `employeeListQuerySchema` (department, status, search) | `employeePageSchema` (pay fields only with `salaries.read`) | — |
| `GET /employees/:userId` | as rule A2 (self, `employees.read`, `salaries.read`) | — | `employeeFileSchema` | 404 |
| `PATCH /employees/:userId` | `employees.manage` | `updateEmployeeFileSchema` | `employeeFileSchema` | `INVALID_DATES`, `SCHEDULE_ARCHIVED` |
| `PUT /employees/:userId/payout` | `payouts.manage` | `payoutSchema` | `employeeFileSchema` | — |
| `GET /employees/:userId/salaries` | self or `salaries.read` | — | `salaryChangeListSchema` | 404 |
| `POST /employees/:userId/salaries` | `salaries.manage` | `createSalaryChangeSchema` | `salaryChangeSchema` | `DUPLICATE_EFFECTIVE_DATE` |
| `POST /salaries/:id/archive` | `salaries.manage` | `{ reason }` | `salaryChangeSchema` | — |
| `POST /employees/:userId/end` · `DELETE …/end` | `employees.manage` | `endServiceSchema` | `employeeFileSchema` | `INVALID_DATES`, `ALREADY_ENDED` |
| `GET/POST/PATCH /schedules`, `POST /schedules/:id/archive` | `hr.read` (GET) / `hr.manage` | `workScheduleSchema` | `workScheduleSchema` | `SCHEDULE_IN_USE`, `DEFAULT_REQUIRED`, `INVALID_TIMES` |
| `GET/POST/PATCH /holidays`, `POST /holidays/:id/archive`, `POST /holidays/repeat` | `calendar.read` (GET) / `hr.manage` | `holidaySchema`, `{ year }` | `holidaySchema[]` | `HOLIDAY_OVERLAP`, `MONTH_CLOSED` |
| `GET/PUT /settings` | `hr.read` / `hr.manage` | `hrSettingsSchema` | `hrSettingsSchema` | — |
| `GET /balances/:userId` | self or `hr.read` in scope | `{ year }` | `leaveBalanceSchema` (by type, with ledger) | 404 |
| `POST /balances/:userId/adjustments` | `hr.approve` | `{ leaveType, year, days, note, entry: 'adjustment' \| 'opening' }` | `leaveBalanceSchema` | — |
| `POST /requests/preview` | session | `createHrRequestSchema` | `{ days, paidDays, unpaidDays, shortNotice, warnings[] }` | as below |
| `POST /requests` | session (own) or `hr.approve` (`userId`) | `createHrRequestSchema` | `hrRequestSchema` | `REQUEST_OVERLAP`, `INSUFFICIENT_BALANCE`, `ON_PROBATION`, `PERMISSION_LIMIT`, `TOO_LATE`, `NOT_A_WORK_DAY`, `MONTH_CLOSED` |
| `GET /requests` | session (own) / `hr.read` | `hrRequestListQuerySchema` (status, kind, user, month) | `hrRequestPageSchema` | — |
| `GET /requests/:id` | owner or `hr.read` in scope | — | `hrRequestDetailSchema` (opinions, overlapping work for `hr.approve`) | 404 |
| `POST /requests/:id/decision` | `hr.approve` | `{ decision, note, confirmMissingCertificate }` | `hrRequestSchema` | `NOT_PENDING`, `CERTIFICATE_MISSING`, `MONTH_CLOSED` |
| `POST /requests/:id/cancel` | owner or `hr.approve` | `{ note }` | `hrRequestSchema` | `NOT_CANCELLABLE`, `MONTH_CLOSED` |
| `POST /opinions` | `hr.read` in scope | `{ requestId \| itemId, body }` | `opinionSchema` | `NOT_PENDING` |
| `GET /items` | session (own) / `hr.read` | `attendanceItemListQuerySchema` | `attendanceItemPageSchema` | — |
| `POST /items/:id/justification` | owner | `{ text }` | `attendanceItemSchema` | `NOT_PENDING` |
| `POST /items/:id/decision` | `hr.approve` | `decideItemSchema` | `attendanceItemSchema` | `INVALID_DECISION`, `MONTH_CLOSED` |
| `GET /attendance/me/today` | session | — | `myTodaySchema` (day, next action, allowed methods, greeting) | — |
| `GET /attendance/days` | self / `hr.read` | `{ userId, month }` | `attendanceDayListSchema` (with punches) | — |
| `POST /attendance/punch/options` | session | `{ method, code?, shootId?, latitude?, longitude?, accuracyM? }` | WebAuthn assertion options + a punch ticket (60 s) | `EXEMPT`, `NO_PASSKEY`, `INVALID_CODE`, `OFF_OFFICE_NETWORK`, `NOT_REMOTE_DAY`, `NOT_ON_SHOOT` (not crew, or outside the shoot's window), `LOCATION_REQUIRED`, `MONTH_CLOSED` |
| `POST /attendance/punch` | session | `{ ticket, assertion, fieldNote?, fieldTaskId?, fieldMeetingId? }` | `{ punch, day, greeting }` | `PASSKEY_FAILED`, `TICKET_EXPIRED`, `OFF_OFFICE_NETWORK` (checked again) |
| `POST /attendance/punches/:id/reject` | `hr.approve` | `{ note }` | `attendanceDaySchema` | `NOT_FIELD`, `MONTH_CLOSED` |
| `GET /attendance/today` | `hr.read` | `{ department? }` | `todayBoardSchema` | — |
| `POST /passkeys/options` · `POST /passkeys` | session | — / attestation | `passkeySchema` | `PENDING_EXISTS` |
| `GET /passkeys/me` · `GET /passkeys?userId` | session / `hr.read` | — | `passkeySchema[]` | — |
| `POST /passkeys/:id/revoke` | `hr.approve` | `{ note }` | `passkeySchema` | — |
| `GET/POST /kiosks`, `POST /kiosks/:id/archive`, `POST /kiosks/:id/pairing-code` | `hr.manage` | `{ name }` | `kioskSchema` (+ the pairing code once) | — |
| `POST /api/kiosk/pair` | none (rate-limited) | `{ code }` | sets `vh_kiosk` | `INVALID_PAIRING_CODE` |
| `GET /api/kiosk/stream` | `vh_kiosk` cookie | — | SSE: QR window values, greetings, heartbeat | 401 |
| `GET /months/:month` | `hr.read` | `{ department? }` | `monthSheetSchema` | — |
| `POST /months/:month/close` · `/reopen` | `hr.approve` | — / `{ reason }` | `attendanceMonthSchema` | `MONTH_NOT_ENDED`, `MONTH_HAS_PENDING`, `NOT_CLOSED` |
| `GET /months/:month/export` · `/employees/:userId/months/:month/export` | `hr.read` / self | — | `.xlsx` | — |

Changed: task create, assign and update (`acceptLeave`, `ASSIGNEE_ON_LEAVE`); shoot and meeting conflicts (`leave` kind); `GET /api/calendar` (leave items, holiday key dates).

## Screens
All Arabic RTL, from `packages/ui`. A new **HR** section in the sidebar for `hr.read`, `employees.read` or `salaries.read` holders; **My attendance** for every user who is not exempt (leave only for exempt users).

- **My attendance** `/me/attendance` (also the app's home shortcut on phones):
  - Today card: the day's expectations, punches, and one main button by state: "Scan the entrance code", "Check in remotely", "Field work", "Check out". Exempt, holiday, leave and trial states explain themselves.
  - Scanner: full-screen camera (`BarcodeDetector` where available, a JS decoder otherwise), then the passkey prompt, then the greeting. Errors in plain Arabic: "Connect to the office Wi‑Fi", "The code expired, scan again", "Register your passkey first".
  - Passkey setup and its state (active, pending replacement).
  - This month: a calendar of days with status colors and the items, each with "Add a justification".
  - Balances: annual (available, accrued, taken, carried), sick, emergency; the ledger on demand.
  - Requests: list and "New request" (leave, permission, remote day, correction) with the preview (days, split, short notice) before submitting; certificate upload for sick leave.
- **People** `/hr/people`: employees with department, type, start date, schedule, passkey state, contract end; filters. Pay columns for `salaries.read` only.
- **Employee file** `/hr/people/:userId`: tabs Personal, Contract and schedule, Pay (`salaries.read`), Documents, Leave, Attendance, with the end-of-service action. The employee sees their own file read-only at `/me/file`.
- **Approvals** `/hr/approvals`: pending requests and items, oldest first, filters by kind and department. A request opens with its days, the split, notice, certificate, opinions and the overlapping work; an item opens with the day's timeline and the justification. Actions for `hr.approve`; department managers and Ops add an opinion. Bulk decide for items of the same proposal.
- **Today** `/hr/today`: counts and lists of in, late, not yet in, on leave, remote, field, on a shoot (each with its punch points on a small map and an "Open in maps" link), exempt and "no passkey"; refusals of the day (`OFF_OFFICE_NETWORK`).
- **Month** `/hr/months/:month`: the sheet (employees × days), totals, pending counts, Close or Reopen, Excel.
- **HR settings** `/hr/settings` (`hr.manage`): Rules (grace, tiers, leave policy, start date), Schedules, Holidays (with "Repeat last year"), Entrance screens (create, pairing code, last seen, unpair).
- **Entrance screen** `/kiosk` (no session): pairing form; then full screen with the logo, the clock, the date, the QR code with a countdown ring, and the greeting; an "offline" banner when the stream drops. Big text readable from 2 metres, landscape and portrait.
- **Calendar** (F11): "On leave" entries and holidays.
- Task, shoot and meeting dialogs: the leave warning with "Assign anyway".

Loading, empty and error states follow F15/F16 patterns; every list has an empty state that says what fills it.

## Audit, notifications and jobs
- **Audit** (`hr` entries on the user): file changes (field names, no values for personal fields), salary added and archived (amounts in data only), payout changed, documents, end of service; schedules, holidays, settings, kiosks (created, paired, archived); passkeys (registered, replaced, revoked); every request state change; every item decision; balance adjustments and openings; field punch rejections; refused punches (`attendance.punch_refused`, with the reason and address); months closed and reopened; accepted leave warnings. Punches themselves are the record and write no audit entry; corrections do (through their request).
- **Notifications:** the table above.
- **Jobs** (worker schedules, API works, ADR 0018):
  - `hr.daily` at 00:10: finalize yesterday's days (absence, missing out, overtime items), create today's days, accruals on day 1, the year rollover on 1 January, contract and probation reminders, `colleague_on_leave`, and end-of-service archiving. Idempotent by the ledger and day keys.
  - The F16 minute job gains the check-in and check-out reminders and the screen-offline check.
  - A development command `pnpm --filter @vertex-hub/api hr:run-daily [--date YYYY-MM-DD]`.

## Edge cases
1. **Code relayed by photo or video call:** refused by the network rule (C6). Relaying through a VPN into the office network is not defended against; the greeting on the screen with nobody in front of it is the visible signal.
2. **IPv6:** if the production domain has an AAAA record, phones and the screen reach it over IPv6 with different addresses; rule C6 compares the /64 prefix. The implementation checks the domain's records and the real office network before Part C ships.
3. **Mobile data at the office:** refused; the message asks for Wi‑Fi.
4. **Synced passkeys:** iCloud Keychain or Google Password Manager may sync the passkey to the employee's other devices. These are the same person's devices, so they are accepted; the passkey, not the phone, proves the person.
5. **Two employees, one phone:** each registers their own passkey on it; each passkey proves its owner.
6. **Lost phone:** the employee submits corrections until the GM approves a new passkey; the GM can revoke the lost one.
7. **Screen clock drift:** the screen gets window values from the API's clock, so its own clock does not matter.
8. **Punch twice within a minute:** the second is refused (`DUPLICATE_PUNCH`), to stop double scans.
9. **Leave approved retroactively** over a day with an absence item: the day recomputes and the item becomes `void`.
10. **Schedule changed mid-day:** today keeps its frozen expectations once it has a punch.
11. **Holiday added on a day with approved leave:** the leave's day count drops and the balance is restored for that day.
12. **A holiday in a closed month:** refused (`MONTH_CLOSED`); reopen first.
13. **Leave spanning two years or two months:** balances split by year; days belong to their months; a closed month in the range refuses the request.
14. **Shoot overlapping a leave:** the conflict warning (B17); if both stand and the crew member punches at the shoot, the presence creates an overtime item and the leave stays (the GM decides).
14a. **Shoot moved or cancelled after a shoot check-in:** the punch stays as field presence; the GM can reject it.
15. **Flexible schedule arriving before the window:** counted from the window's opening for the expected end; the earlier minutes are not overtime.
16. **Permission at day start:** the expected arrival moves to the permission's end; no lateness within it.
17. **Employee ends service mid-month:** days after `ended_on` are not created; the month summary covers the days worked.
18. **User archived by F01 without an end of service:** days stop; the file shows "archived without an end of service" for HR to complete.
19. **GM not exempt:** their items are decided by themselves at once (rule in Roles), recorded in the audit.
20. **No GM holds `hr.approve` actively:** requests wait; there is no fallback approver (owner: GM for all).
21. **Department manager of several departments:** sees the union of their members.
22. **Concurrent decisions:** a decision on a no-longer-pending row returns `NOT_PENDING`.
23. **Archived schedule** cannot be assigned; the default schedule cannot be archived.
24. **Overtime credited as time off, then the decision changed:** the credit is reversed even if the balance goes negative; the screen shows it.
25. **Trial period:** punches made before the start date stay, marked trial; no items are raised for them after the start date.

## Open questions
None block the spec. To confirm during implementation, not owner decisions:
- The leave defaults (14 annual days, 14 sick days) follow the owner's choice of the recommended values, not a verified reading of Syrian labour law; they are settings, so the owner can change them.
- Rule C6 depends on the office network: the screen and the phones must leave through the same public address. Checked on site before Part C ships (edge case 2).

## Acceptance
- **Owner check, in the browser and on a phone:**
  1. As GM, open HR settings: set the main schedule's real hours, add the Eid holidays, set the start date to tomorrow, create an entrance screen and pair it on the office screen.
  2. Open an employee file: fill the contract, probation and payout, add a salary; sign in as Finance and see the salary; sign in as the Ops manager and see the file without pay; as another employee, get "not found".
  3. As an employee on the installed app, register the passkey; scan the entrance code on office Wi‑Fi and check in; see the greeting on the phone and the screen. Turn Wi‑Fi off and scan again: "Connect to the office Wi‑Fi".
  4. Check in late tomorrow; see the item, add a justification; as GM, decide it (quarter day or warning).
  5. Request annual leave for next week; as GM, see the employee's tasks in that week and approve; see "On leave" on the calendar; assign a task due that week and get the warning.
  6. Request a remote day, then check in remotely; record a field punch and see it on the Today map; reject it. As a crew member of a shoot today, do the shoot check-in and check-out and see both points beside the shoot's place.
  7. At month end, close the month after deciding everything; export the Excel file.
- **Tests:**
  - API per endpoint: success, 401, 403, out of scope (department manager outside their departments, Finance on files without pay, an employee on another's file), and each error code.
  - Unit: the day computation (fixed and flexible, grace, tiers, permissions, half days, mixed methods, midnight, off days and holidays), leave day counting, accrual and rollover, the sick and emergency split, the QR token window check, the IP rule (IPv4, IPv6 /64), `isWorkDay` with holidays and the F07 due dates.
  - Privacy: no salary amount in notifications, pushes, emails, audit text or responses without `salaries.read`; the leave type never in calendar responses for users without `hr.read`.
  - E2E and RTL screenshots: My attendance (each state), the scanner errors, the request dialog, Approvals, Today, the month sheet, HR settings, the employee file tabs (with and without pay), and the entrance screen. WebAuthn through Chromium's virtual authenticator.

## Parts and PRs
Each part ships its API, screens and tests, and is accepted by the owner before the next starts.
- **A:** permissions, employee files, salaries, payout, documents, end of service, reminders, People and the employee file.
- **B:** schedules, holidays and work days (F07, F08), settings, balances and the ledger jobs, requests and decisions, Approvals, calendar and warnings (F06, F11).
- **C:** passkeys, entrance screens and the stream, punches (office, remote, field, shoots), the day computation, items, corrections, reminders, greeting, My attendance and Today.
- **D:** months, closing and summaries, Excel, and the full E2E pass.
