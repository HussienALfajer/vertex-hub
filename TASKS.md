# TASKS — F17 HR: employee files, attendance and leave

Spec: `docs/specs/F17-hr-files-attendance-leave.md` (Approved 2026-10-21) · ADR 0039 (and 0006, 0013, 0014, 0017, 0018, 0019, 0022, 0032, 0036, 0037).
Parts A → B → C → D, each accepted by the owner before the next starts (spec, "Parts and PRs"). One session per PR. Parts B–D are planned when they start.

## PR A1 — employee files: contracts, db, api
- [ ] contracts: `hr.ts` (employee file, list query and page, update, payout, salary change, end of service, `WEEKDAYS`, enums); the eight permissions and grants + `permissions.test.ts`; error codes `INVALID_DATES`, `SCHEDULE_ARCHIVED`, `DUPLICATE_EFFECTIVE_DATE`, `ALREADY_ENDED`; audit actions and entity types; F10 owner type `employee`; notification types `contract_ending`, `probation_ending`, `employee_leaving`, `salary_changed` (texts in `messages`, no amount); `hr.daily` job; unit tests; `ar.json` keys
- [ ] db (`/db-migration`): `work_schedules`, `work_schedule_days` (seeded "Main schedule"), `employee_files` (one per existing user), `salary_changes`; `file_items` owner type `employee`; `TABLE_OWNERS`
- [ ] api `hr` module: employees list, detail (rule A2 visibility), update, payout, salaries list/add/archive, end of service and undo; F01 hooks (create, archive, restore the file); F10 documents on `employee` with the confidential rule (A6); `hr.daily` (reminders A7, end-of-service archive A8) and `hr:run-daily`; `test/hr-employees.test.ts`
- [ ] bridge: `openapi:export`, `api:generate`; web typecheck
- [ ] checks, reviewer, acceptance (API at `/api/docs`), PR with auto-merge

## PR A2 — employee files: web and E2E
- [ ] HR nav section, People `/hr/people`, employee file `/hr/people/:userId` (tabs Personal, Contract and schedule, Pay, Documents; end of service), `/me/file`
- [ ] E2E: `f17.spec.ts` (with and without pay, roles), screenshots in both themes; mocks in `fixtures.ts`
- [ ] checks, reviewer, acceptance (spec steps 2 and the file part of 1), PR with auto-merge, `docs/ROADMAP.md`
