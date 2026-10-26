# 0041 — Subtasks as tasks under a parent, run modes through dependencies, questions in the task thread
Status: Accepted · Date: 2026-10-26

## Context
F06B (Tasks 2.0, `docs/specs/F06B-tasks-2.md`) splits a piece of client work across people and departments, and adds questions with reminders. F06 already has a complete task: status machine, review (F09), files (F10), notifications (F16), and dependencies that hold a task until the work it needs is finished. A separate subtask entity would duplicate all of it. A separate questions table would split the task's discussion in two.

## Decision
- **A subtask is a row of `tasks` with `parent_id`.** It is one level deep. It has its own department, assignee, dates, status, files, questions and comments, and takes the parent's client and engagement. It never has a milestone, cycle line, post or client approval. Only the parent goes to the client and counts in F05's `WorkProgress` (owner, 2026-10-25).
- **Run modes are dependencies.** The parent's `run_mode` (`sequential`, `parallel`, `stages`) and its subtasks' order and stages are turned into `task_dependencies` rows with `source = 'run'`. The system rewrites them whenever the mode, the order or the stages change. F06's blocked rule then drives waiting and opening unchanged, and manual dependencies keep `source = 'manual'` and F06's limit.
- **Approving a subtask delivers it** (`internal_review → delivered`, subtasks only). Its reviewers are its department managers and the parent's assignee. The parent cannot move to `internal_review` while a subtask is not delivered (owner, 2026-10-26).
- **Questions are comments of kind `question`** in `task_comments`, with an addressee (a person or a department), a status (`open`, `answered`) and replies linked by `question_id`. Comments, questions, replies and the brief are ADR 0038 rich-text documents, with a plain-text extract kept beside each.
- **Question reminders count work hours**: all hours of every day except Fridays and F17's public holidays. Reminders are sent at 24 such hours and escalations at 48, by F16's minute job (owner, 2026-10-26).
- **Task templates are a third F07 kind, `task`**, with one root step and sub-steps (`parent_step_id`). They are saved from a real task by assign-scope holders (owner, 2026-10-26).

## Consequences
- Every list, board, view, permission and notification of F06 works on subtasks without a second code path. Callers that must leave subtasks out (`WorkProgress`, client approval, posts) check `parent_id`.
- Changing the run mode is a rewrite of `run` rows inside one transaction under the parent's lock. Tasks already started never move back (F06 edge case 3).
- The task thread stays one ordered list. Question state lives on the comment row, so the minute job reads one partial index of open questions.
- The rich-text change keeps `brief` and `body` as plain text, written from the documents, so the previous release keeps working during a deploy (expand only).
