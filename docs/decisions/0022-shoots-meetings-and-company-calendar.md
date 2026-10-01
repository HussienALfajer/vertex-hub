# 0022 — Shoots tied to tasks, warned conflicts and one company calendar
Status: Accepted · Date: 2026-10-01

## Context
F11 (`docs/specs/F11-calendar-shoots.md`) adds shoot booking, meetings and a company calendar. The monthly template (ADR 0017) already generates a Photography "Photo shoot" task per committed `photo_shoot` unit, and the "Promotional reel" template has a "Shoot" step followed by "First cut"; the deliverables counter (ADR 0015) counts delivered tasks. A shoot must not duplicate that work or count a unit twice, and the team needs to see who is booked when. The owner decided: a shoot is its own record tied to a task; Photography members, the client's account manager and management book; the crew is team members plus named freelancers; overlapping bookings warn and never block; the calendar shows shoots, meetings and key dates to everyone; meetings are created by anyone with team attendees and client contacts; shoots are scheduled, completed or cancelled; closing creates one editing task unless the shoot task already has dependents.

## Decision
- **A shoot is a record tied to one Photography task.** It is booked from an open Photography task or creates one ("Shoot: …") in the same transaction; at most one active shoot per task. The task's due date follows the shoot's day. The engagement links (project, milestone, retainer cycle line) stay on the task, never on the shoot.
- **Closing delivers the shoot task** in the same transaction from any open status (a system transition), so the `photo_shoot` unit counts once, when the shoot happened. Closing also creates one **editing task** that depends on the shoot task and has no cycle line; it is proposed by default unless the shoot task already has dependent tasks.
- **Conflicts warn, never block.** A team member in two scheduled shoots or meetings with overlapping `[start, end)` makes the save return `409 SCHEDULE_CONFLICT` until the request acknowledges it; the acceptance is audited. External crew are not checked.
- **One calendar, read by everyone.** `shoots.read` becomes `calendar.read` (every user, all). `shoots.manage`: Photography members, the Operations manager and the General Manager (all), account managers (own clients). New `meetings.manage`: the organizer, account managers (own clients), the Operations manager and the General Manager. Key dates (project and milestone due dates, retainer renewals) are read from `projects`, not stored.
- **Module.** A new `calendar` module owns shoots, crew, shot lists, meetings and the calendar read model. It imports `tasks` (`ShootTasks`) and `projects`; `tasks` stays unaware of it and asks a `TaskGuards` registry before cancelling, archiving or moving a task that has a scheduled shoot.

## Consequences
- The task views, workload and the deliverables counter need no change to include shoots.
- A shoot cannot outlive its task: cancelling the task needs the shoot cancelled first; a cancelled shoot can be reopened only while its task is still bookable.
- F13 adds invoice due dates as another key date kind; F15 can read shoots per month from the same tables.
