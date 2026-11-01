# F06C — Task reminders by hand

Status: Approved · Date: 2026-11-01 · Scope: requested by the owner (2026-11-01), an addition to F06 and F06B · ADRs: 0018, 0036–0038 (notifications)

## Summary
Whoever asked for a task, or manages it, can nudge its assignee with one click: a "Remind" button on the tasks list and on the task page sends the assignee an important notification (bell and push), with an optional short note. It saves a message or a call when the work is late or urgent.

## In scope / out of scope
- In: the "Remind" button on each row of the tasks list (`/tasks`) and on the task page, the dialog with an optional note, the `task_reminder` notification, its audit entry.
- Out: automatic reminders (A07 and the F16 escalations already do that), reminders to anyone but the assignee, a limit on how often (owner, 2026-11-01: no limit).

## Roles and access
| Action | Permission | Who (owner, 2026-11-01) |
|---|---|---|
| Remind the assignee of a task | `tasks.read` plus the rule below | The task's creator, and whoever manages it: the managers of its department, the project manager of its project, the client's account manager and the General Managers (manage scope, `taskRights(...).manage`) |

## States and rules
1. A task can be reminded about when it has an assignee, is not read-only (archived, or its work is archived), and is not approved, delivered or cancelled.
2. The actor is the task's creator or holds manage rights on it (`taskRights`), and is not its assignee. Anyone else gets 403.
3. A refusal has a code: `TASK_NOT_ASSIGNED` (no assignee), `TASK_CLOSED` (approved, delivered or cancelled), `TASK_ARCHIVED` (read-only), `CANNOT_REMIND_SELF` (the actor is the assignee).
4. No limit on how often (owner, 2026-11-01): each click sends one notification.
5. The note is optional plain text, at most 300 characters, trimmed; an empty note is no note.
6. `permissions.canRemind` on the task detail and `canRemind` on each item of `GET /api/tasks` say whether the button shows; the API checks again.

## API
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/tasks/:id/remind` | `tasks.read` (rule 2 in the service) | `taskReminderInputSchema` (`{ note?: string }`) | 204 | `TASK_NOT_ASSIGNED`, `TASK_CLOSED`, `TASK_ARCHIVED`, `CANNOT_REMIND_SELF`, 403, 404 |

## Screens
- Tasks list (`/tasks`): a bell icon button at the end of each row where `canRemind` holds, with a tooltip "Remind the assignee". It opens the dialog.
- Task page: a "Remind" outline button beside the moves, where `permissions.canRemind` holds.
- Dialog: names the assignee, an optional note (300 characters), "Send reminder". On success a toast "Reminder sent to <name>"; errors through their codes.

## Audit, notifications and jobs
- Audit: `task.reminded` on the task, with the assignee and the note.
- Notification `task_reminder` (category tasks, not mutable, important: in-app and push on, email off; "Needs you", no merging, no escalation). Recipient: the assignee. Snapshot: the task and the note; the actor is the sender. Text: "<actor> reminds you of «<task>»", with ": <note>" when there is one.
- Resolves: done when the task is approved or delivered; void when it is cancelled or archived, and for the previous assignee when it is reassigned.

## Edge cases
1. The assignee is archived or left the department: the reminder is still sent (the F14 rules decide delivery).
2. A subtask is reminded about like any task; its parent's assignee reminds through manage rights only when they hold them.

## Acceptance
- As a department manager, open `/tasks`, click the bell on an open task assigned to someone else, write a note, send: the toast shows, and the assignee gets a push and an entry in "Needs you" with the note.
- As that assignee, deliver or get the task approved: the reminder leaves "Needs you".
- As an employee who did not create the task, the bell does not show.
