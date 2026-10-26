# TASKS — F06B Tasks 2.0

Spec: `docs/specs/F06B-tasks-2.md` (Approved 2026-10-26) · ADR 0041 (and 0013, 0014, 0016, 0017, 0019, 0020, 0037, 0038, 0039). Five PRs; each leaves `main` whole. Each API PR carries the `ar.json` keys for its error codes, audit values and notification types, and the regenerated OpenAPI client.

## PR 1 — Subtasks API (Part A)
- [ ] contracts: `SUBTASK_RUN_MODES`, `DEPENDENCY_SOURCES`, limits; `runDependencies`, `suggestSubtaskDates`, `subtaskProgress` with unit tests; subtask create/order/run-mode/stage/reopen/handover schemas; detail and list fields (`parent`, `runMode`, `stages`, `subtasks`, `progress`, `topLevel`, `parentId`); `internal_review → delivered` for subtasks; error codes `SUBTASK_DEPTH`, `SUBTASKS_OPEN`, `SUBTASK_DUE_AFTER_PARENT`, `TASK_CLOSED`, `STAGE_NOT_EMPTY`; audit actions and `task_stage` entity; notification types `subtask_turn`, `subtask_handover`, `subtask_stage_finished`, `subtasks_all_finished`, `subtask_holding_next`, `task_blocked`, `task_reopened` extended (messages + `ar.json`)
- [ ] db (`/db-migration`): `tasks.parent_id`, `position`, `stage_id`, `run_mode`, `handover_note` + checks and `(parent_id, position)`; `task_stages`; `task_dependencies.source`
- [ ] api: `POST /tasks/:id/subtasks`, order, run mode, stages, reopen, handover note; run dependencies rewritten under the parent's lock; opening (turn, handover summary on `task_stage.finished`); review by the parent's assignee, approve → delivered; parent held by `SUBTASKS_OPEN`; links follow the parent; cascades (cancel, archive, restore, project); `SUBTASK_DUE_AFTER_PARENT` / `moveSubtasks`; subtasks out of `WorkProgress`; lists and board (`topLevel`, `parentId`, `parent`, `progress`); daily `subtask_holding_next`; `task_blocked`; `test/task-subtasks.test.ts` + changed F06 suites
- [ ] bridge: `pnpm build`, `openapi:export`, `api:generate`; fixtures adapted to the new response fields
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 2 — Questions, rich text and criteria API (Parts B, C6)
- [ ] contracts: mention node in the ADR 0038 document schema; `TASK_COMMENT_KINDS`, `QUESTION_STATUSES`, `CHECKLIST_ITEM_KINDS`; `workHoursBetween` with tests; question/reply/forward schemas; comment `bodyDoc`, `attachments`, `question`, `replies`, `convertedTask`; criteria schemas; error codes `CRITERIA_OPEN`, `INVALID_ADDRESSEE`, `QUESTION_NOT_FOUND`, `QUESTION_NO_REPLY`, `QUESTION_CLOSED`, `NOT_QUESTION_ASKER`; notification types `task_question_*`
- [ ] db: `task_comments` kind/body_doc/question fields + partial index of open questions; backfill `body_doc` from `body` (mentions as nodes); `tasks.brief_doc` + backfill; `task_checklist_items.kind`; `file_items.task_comment_id` and the `attachment` role for `task`
- [ ] api: questions, replies, answered/reopen, forward, convert to subtask (`fromCommentId`), attachments through `FileItems`; brief as rich text; criteria endpoints and `CRITERIA_OPEN` on submit/resubmit; `openQuestions` + `hasOpenQuestions`; `GET /me/questions`, `questionsWaiting`; minute job reminder and escalation through `timed_reminders` (work hours); voiding on deliver/cancel/archive, clock restart on reopen; `test/task-questions.test.ts`
- [ ] bridge
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 3 — Creation, readiness, estimates, templates and tree API (Parts C, D)
- [ ] contracts: `briefFieldsSchemas`, `estimateMinutes`, extended `createTaskSchema` (subtasks, stages, files, questions, criteria, limits), readiness schemas, `bottleneck` with tests, tree schema, workload capacity fields; `template_kind` `task` schemas; `TEMPLATE_KIND`
- [ ] db: `tasks.brief_fields`, `estimate_minutes`; `template_kind` `task`, `work_templates.run_mode`, `work_template_steps.parent_step_id`, brief/fields/estimate/criteria on steps
- [ ] api: one-transaction create; `POST /tasks/readiness` (leave, overload against the F17 schedule, Friday/holiday, brief missing, criteria); workload estimated vs capacity; `GET /tasks/tree` with the bottleneck; `TaskTemplates.snapshot`; `POST /templates/from-task/:taskId`, `POST /templates/:id/task-draft`, task-kind editing; `test/task-creation.test.ts`, `task-templates.test.ts`, `task-tree.test.ts`
- [ ] bridge
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 4 — Task page, lists, board and My tasks (web)
- [ ] ui: viewer component (image zoom/pan, video, next/previous) on the design-system page; rich-text editor with mentions and attachments (drag, paste)
- [ ] web: task page order (header badges and progress, brief + fields, Subtasks with timeline, stages, handover summaries, reorder, add, cancel, reopen dialog, handover note, Questions and discussion, Files groups with the viewer, criteria); list/board badges and filters; My tasks "Questions waiting for my answer"; `ar.json`
- [ ] e2e: fixtures, screens (task page with subtasks, questions, reopen dialog, viewer, My tasks, list and board)
- [ ] checks, reviewer, acceptance, PR with auto-merge

## PR 5 — Creation wizard, Workload, tree and templates (web)
- [ ] web: `/tasks/new` wizard (five steps, local-storage draft, files at creation with paste, live preview per mode, readiness review, start from a template); Workload hours vs capacity; project Tasks tab and retainer "This month" Tree mode; template list kind and the task template editor, "Save as template"
- [ ] web unit tests: draft storage, paste handler, preview layout
- [ ] e2e: `f06b.spec.ts` flow (stages → handover → deliver → client → reopen one); screens of each wizard step and preview mode, Workload, tree, template editor
- [ ] checks, reviewer, acceptance, PR with auto-merge; `docs/ROADMAP.md` F06B done
