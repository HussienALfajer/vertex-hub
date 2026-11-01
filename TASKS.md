# TASKS — F06C Task reminders by hand

Spec: `docs/specs/F06C-task-reminders.md` (owner's decisions, 2026-11-01) · one PR.

- Branch: `claude/quirky-tesla-mz2371` (cloud session's designated branch).
- Stopped at: web done; next: full verify, reviewer, PR

- [x] contracts: `task_reminder` type (catalog, channels, engine, data), resolutions, `task.reminded` audit, error codes, `taskReminderInputSchema`, `canRemind` (permissions and list items), tests
- [x] messages: `task_reminder` text and test
- [x] db (`/db-migration`): `task_reminder` in `notification_type`
- [x] api: `POST /api/tasks/:id/remind`, `canRemind`, tests
- [x] bridge: `openapi:export`, `api:generate`
- [x] web: bell button in the tasks list, button on the task page, dialog, `ar.json`; e2e and screenshots
- [ ] docs: ROADMAP; checks, reviewer, PR with auto-merge
