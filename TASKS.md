# TASKS — F23 Departments management (first package)

Spec: `docs/specs/F23-departments-management.md` (Approved 2026-10-28) · ADR 0043 · PR split from the spec (1 records, 2 API, 3 screens).

- Branch: `claude/wizardly-galileo-lr0tiv` (cloud session's designated branch; PR 1)
- Stopped at: PR 1 reviewer findings fixed (post and shoot editing tasks checked, filters refuse unknown codes, archived mark on every filter, tests per write); next: `pnpm verify` again, then the PR

## PR 1 — Departments as records (contracts, db, api, web adjustments; no new screens)
- [x] contracts: `departmentCodeSchema` as the pattern `^[a-z][a-z0-9_]{1,39}$`; `SYSTEM_DEPARTMENT_CODES` (today's `DEPARTMENT_CODES`); `DEPARTMENT_CAPABILITIES` and `DEPARTMENT_BRIEF_KINDS` keyed by system codes; `DEPARTMENT_COLORS`, `DEPARTMENT_ICONS`, `DEPARTMENT_SYSTEM_FUNCTIONS`; `departmentResponseSchema` gains `description`, `color`, `icon`, `position`, `archivedAt`; error code `DEPARTMENT_ARCHIVED` (`UNKNOWN_DEPARTMENT` exists); unit tests (pattern, system functions cover the capability keys)
- [x] db (`/db-migration`): enum columns to `text` with foreign keys to `departments.code` (arrays checked by services), enum dropped; `description`, `color` (enum `department_color`), `icon`, `position` with the seeded values; migration test
- [x] api: departments list read from the database wherever `DEPARTMENT_CODES` was used (task views, dashboard, report access); every write that takes a code checks it (`UNKNOWN_DEPARTMENT`, `DEPARTMENT_ARCHIVED` on writes; filters accept archived codes); lists and pickers in department order; notices and reminders of an archived department go to the General Managers (rule 14: `UserDirectory.functionManagers` and `functionMembers` at every listed call site, tested on the directory); filters refuse unknown codes; tests per write
- [x] bridge: `openapi:export`, `api:generate`
- [x] web: filters and pickers read the departments query instead of `DEPARTMENT_CODES` (tasks, board, workload, new task, catalog, projects, retainers, productivity, audit values); `ar.json` keys for the new error codes; fixtures adapted
- [ ] wiring checklist, checks, reviewer, PR with auto-merge

## PR 2 — Departments API
- [ ] contracts: `departments.manage` (General Manager through `everything`); create, update, order, archive preview, archive, member and overview schemas; error codes (`DEPARTMENT_NAME_TAKEN`, `DEPARTMENT_ORDER_MISMATCH`, `TRANSFER_TARGET_REQUIRED`, `INVALID_TRANSFER_TARGET`, `DEPARTMENT_NOT_ARCHIVED`, `ALREADY_MEMBER`, `MANAGER_MEMBERSHIP_REQUIRED`); audit actions; notification types `department_member_added`, `department_member_removed`, `department_archived` (with `ar.json` and `packages/messages` texts)
- [ ] api: create, edit identity, order, archive preview and transfer (one transaction, exported services of tasks, catalog, quotes, templates, projects, retainers), restore, members (add, primary, move, remove), overview; audit and notices; `test/departments.test.ts` per endpoint and rule; architecture test
- [ ] list query `archived` (`users.manage` beyond `false`): keep archived departments' names readable for rule 7 (a closed task shows "Design (archived)" to every employee), since the web reads names from this list; settle with the owner before building
- [ ] bridge: `openapi:export`, `api:generate`
- [ ] wiring checklist, checks, reviewer, PR with auto-merge

## PR 3 — Departments screens
- [ ] ui: `--department-1` … `--department-8` tokens (light and dark) with contrast checks
- [ ] web: departments list (reorder, archived toggle, new-department dialog), department page tabs (overview, members, what it grants, history), archive wizard, restore; `DepartmentBadge` across the app; `permissions.<name>` labels; loading, empty and error states
- [ ] e2e: fixtures, `f23.spec.ts`, screenshots in `screens.spec.ts` (light and dark)
- [ ] `docs/ROADMAP.md`: F23 first package done
- [ ] wiring checklist, checks, reviewer, PR with auto-merge
