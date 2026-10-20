# 0037 — Notification engine 2.0: priorities, channel policy, self-resolving rows, escalation and a minute job

Status: Accepted · Date: 2026-10-20 · Extends ADR 0018 and ADR 0028

## Context
F14 stores one row per recipient and pushes it over SSE (ADR 0018), and emails chosen types in batches (ADR 0028). The owner wants a complete engine (F16), built around four needs:
- priorities;
- channels per type, chosen by users within limits set by management;
- a bell that is a real to-do list, where a notification closes when its work is done;
- escalation of anything critical left unhandled, plus reminders at exact times.

Today nothing ever closes a notification except the user, only overdue tasks escalate, and every reminder runs once a day at 09:00.

## Decision
- **Priority and box in the catalog.**
  - Each type has a fixed priority (`critical`, `important`, `normal`, `informational`), a box (`action`: "Needs you", or `info`), default push and email modes, its resolution events and its escalation.
  - Each row snapshots its priority and box.
  - Priorities are code, not settings, because escalation and urgency depend on them.
- **Channel policy.**
  - `notification_policies` holds management's mode per type and channel (`required`, `on`, `off`, `unavailable`); with no row, the catalog default applies.
  - Users store only overrides (`push_overrides`, `email_overrides`), so changing a default reaches everyone who did not choose.
  - The app channel keeps F14's mute rule.
- **Resolving.** Modules call `NotificationCenter.resolve(tx, { subject, types, outcome })` where the work is done, in the same transaction:
  - `done` closes the actor's row and moves the others' rows to "For your information" with who handled it (owner);
  - `void` closes every row as no longer needed.

  Rows find their resolution through `resolution_type`, so reminders and escalations close with their original. There is no manual "done".
- **Snooze** is a timestamp on the row. A snoozed row is out of lists and counts until the minute job wakes it.
- **Escalation chain.** It is generic and driven by the daily job:
  - one work day after the original: a reminder to its open recipients;
  - one more: their department managers (the GMs for a manager);
  - two more: the GMs and the Internal Operations managers.

  Each step is a row of `action_reminder`, `action_escalated` or `action_escalated_top`, carrying the original's snapshot. It runs once, keyed in `notification_reminders`. Types opt in from the catalog, and some adjust the steps.
- **Followers.** `record_followers` holds who follows a task or post: automatic for the creator, the assignee and anyone who commented or was mentioned, manual for anyone, and sticky when someone unfollows.
- **Minute job.** `notifications.timed` (every minute, worked by the API) runs exact-time reminders, wakes snoozes, sends scheduled announcements and closes polls. `timed_reminders`, keyed by the moment, keeps it idempotent; a moment already passed is skipped.
- **Critical email** skips the 10-minute delay and the night hold, because there are no quiet hours (owner).

## Consequences
- Every emitting module must also call `resolve` at the events the catalog names. The catalog tests check that each `action` type has a resolution.
- `notifications` still reads no other module's tables. Recipients for escalation step 2 come through the department directory that `auth` exports.
- A job runs every minute in the API. Its queries use partial indexes and windows, which is light at about 20 users.
- Old rows are backfilled with priority and box and stay unresolved until their events next happen; no escalation runs for rows created before the deploy.
