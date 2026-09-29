# 0016 — Task workflow, requests and revision counting

Status: Accepted · Date: 2026-09-29

## Context
The task is the core unit of work for all ten departments (v1-scope §3). The owner's answers in the F06 spec (`docs/specs/F06-tasks.md`) fix who sees and moves tasks, how work is requested between departments, what counts as a revision, and how tasks interact with projects and retainers. F07 (templates), F09 (approvals), F14 (notifications), A03, A05–A08 and F15 build on these rules.

## Decision
- **One workflow for every department:** `new → in_progress → internal_review → (awaiting_client) → revisions → approved → delivered`, plus `cancelled` (with a reason, excluded from progress). Internal review is always required; the client step depends on a per-task "needs client approval" flag, off for tasks without a client. Until F09, the account manager records the client's response by hand.
- **Transparency:** every active user reads every task. Changes follow the actor's role: the assignee works the task; department managers, the client's account manager, the General Manager and the Operations manager review and manage; the project manager manages their project's tasks but does not assign people.
- **Requests:** anyone can request work from any department with a task that has no assignee; it waits in that department's unassigned queue until its manager (or another holder of assign scope) assigns it. Staff may also create tasks assigned to themselves in their own departments. A task has exactly one assignee, a member of its department.
- **Dependencies:** a task that waits on another cannot start until that one is `approved` or `delivered` (a manager may override with a reason). Blocked is computed, not stored.
- **Revisions:** every return to `revisions` is recorded with its source. Only client-caused revisions (changes requested while awaiting the client or after approval, or a client-caused reopen after delivery) count against the task's revision limit (default 2, later filled from the quote by F04). Past the limit, work continues and the account manager records a decision: free (with a reason) or extra work (an F05 extra work item).
- **Out-of-scope client requests** create an F05 extra work item at once, so they reach invoicing (F13).
- **Engagements:** completing a project is refused while it has open tasks; cancelling a project cancels them. A delivered task counts once toward its milestone and retainer cycle line; reopening removes it, but never from a closed cycle's frozen count (ADR 0015).
- **The work week** is Saturday to Thursday with Friday off; weeks start on Saturday (was Q9).

## Consequences
- The `tasks` module reads projects, retainers and extra work through a directory service that `projects` exports, and feeds counts and the project close hooks through `WorkProgress`, so `projects` never imports `tasks`.
- F09 replaces the manual client-response step with approval links and adds the medical review step without changing the statuses.
- F14 attaches to the events F06 names (assignment, request, mention, task opened, review, over-limit revision, due soon, overdue); F06 itself sends nothing.
- Permission map: `tasks.read` all for every user, a new `tasks.request`, `tasks.manage` `assigned` for project managers, and `tasks.manage` and `reports.read` `all` for the Operations manager (was Q14).
