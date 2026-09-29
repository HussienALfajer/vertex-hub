# 0017 — Work templates and automatic cycle tasks

Status: Accepted · Date: 2026-09-29

## Context
v1-scope F07 asks for one template per service that generates ordered tasks with dependencies, departments and relative due dates. The service catalog (F04) arrives only in Phase 3, while Phase 1 needs templates so the pilot clients' projects and retainer months start with their tasks. The owner's answers in the F07 spec (`docs/specs/F07-work-templates.md`) fix how templates stand on their own until then, how due dates are counted and how retainer months are generated.

## Decision
- **Two kinds of template, independent of the catalog:** `project` templates group steps into stages that become project milestones; `retainer_cycle` (monthly) templates generate a retainer month. F04 later links each service to a template and A01 applies it from an accepted quote.
- **Due dates in work days:** a step is due on work day n from the run's start (Saturday to Thursday, Friday skipped; no holidays in V1), computed by pure functions in `packages/contracts`.
- **Repeated steps:** a monthly template step can repeat once per committed unit of a deliverable kind, spread evenly over the month's work days and linked to the cycle line, so the deliverables counter (ADR 0015) counts generated work without extra entry. One repeated step per kind, so no unit counts twice.
- **Applying:** whoever manages the project or retainer applies a template after a preview where they change the start date and the assignee per department. Generated tasks keep the chosen assignees even when the applier cannot assign by hand; the template is maintained by the General Manager and the Operations manager.
- **A02, task part, moves into Phase 1:** a retainer links one monthly template, and its tasks are generated in the same transaction that opens each cycle. A grown committed quantity is filled by an explicit "generate missing tasks" action; lowering it never cancels tasks.
- **Invalid defaults fall back to the department queue:** an archived or departed default assignee never blocks a run or a user's archiving; the template shows a warning.

## Consequences
- A new `templates` module creates tasks through a service `tasks` exports and hooks cycle opening through a registry in `projects`, so neither `projects` nor `tasks` imports `templates`.
- Tasks created by the daily job have no creator: `tasks.created_by_id` becomes nullable.
- `templates.read` is granted to every user so account managers and project managers can pick templates.
- F08 adds post-driven design tasks separately; it must not duplicate repeated design steps for the same cycle line.
