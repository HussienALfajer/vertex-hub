# F07 — Work templates

Status: Approved · Date: 2026-09-29 · Scope: `docs/product/v1-scope.md` §F07 (and the task part of A02) · ADRs: 0013, 0014, 0015, 0016, 0017

## Summary
Every new project and every retainer month starts with someone typing the same tasks again, or forgetting some. F07 adds work templates: a named, ordered set of task steps, each with a department, a due day counted in work days from the start date, dependencies on earlier steps, a checklist and the task defaults, plus a default assignee per department. A **project template** groups its steps into stages that become the project's milestones; a **monthly template** is linked to a retainer and generates each new cycle's tasks automatically, including one task per committed deliverable ("Design 1 … Design 12") linked to its cycle line so the deliverables counter works from day one. Four seed templates ship: brand identity, promotional reel, website and monthly social media cycle. Until the service catalog (F04), templates are applied by hand to projects and linked by hand to retainers; F04 and A01 later apply them from an accepted quote.

## In scope / out of scope
- In:
  - Templates: create, edit, archive and restore; two kinds, `project` and `retainer_cycle`; stages (project kind), ordered steps, dependencies on earlier steps, checklist, task defaults; a default assignee per department.
  - Monthly templates: a step can repeat once per committed unit of a deliverable kind, spread over the month's work days and linked to the cycle line.
  - Applying a project template to a project (from the new project form and from the project's Tasks tab) with a preview in which the applier changes the start date and the assignee per department; stages map to existing milestones by name or create new ones.
  - Linking a monthly template to a retainer; generating the cycle's tasks automatically when a cycle opens (the task part of A02, moved into Phase 1 by the owner), or by hand for the current cycle when it has none yet; "generate missing tasks" for a cycle line whose committed quantity grew.
  - Work-day arithmetic (Friday off) as pure functions in `packages/contracts`.
  - Run history: which template generated which tasks, when, by whom or automatically.
  - Seed data: the four templates, written as a draft here for the owner to review, editable from the UI afterwards.
  - Permission map change: `templates.read` for every user.
  - F06 change: tasks created automatically have no creator (`created_by_id` null).
- Out (later or never):
  - Linking templates to catalog services and applying them from an accepted quote: F04 and A01 (Phase 3). The revision limit taken from the quote: F04.
  - Posts in the content calendar generating design tasks: F08.
  - Sending the notifications listed below: F14.
  - Holidays or a per-person calendar in due-date arithmetic (only Friday is skipped).
  - Excluding individual steps while applying, per-task edits inside the preview (edit the tasks after generation, as the scope says), cross-template dependencies, conditional steps, versioning of templates (edits never touch generated tasks).
  - Cancelling generated tasks when a committed quantity is lowered (done by hand on the tasks).

## Roles and access

### Permission map change (from `packages/contracts/src/permissions.ts`)
- `templates.read` becomes `all` for Employee: every active user can open templates, so account managers and project managers can pick one when they apply it. The now redundant Department Manager grant is removed. The Internal Operations manager keeps `templates.read` through their department capability, which is redundant but harmless; keep it with `templates.manage` for readability.
- `templates.manage` is unchanged: General Manager and the Internal Operations manager (F01, Q13).

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| List and open templates (non-archived) | `templates.read` | Every active user: all |
| Create, edit, archive and restore templates; see archived ones | `templates.manage` | General Manager, Operations manager |
| Preview and apply a project template to a project | `projects.manage` over the project | General Manager, Operations manager: all · Account Manager: their clients · the project's project manager |
| Link or unlink a monthly template on a retainer | `projects.manage` (client scope) | General Manager, Operations manager · the client's account manager |
| Generate the current cycle's tasks by hand; generate missing tasks for a cycle line | `projects.manage` (client scope) | as above |
| See run history | `projects.read` | Every active user |

Applying a template never needs `tasks.manage`: the generated tasks get the assignees chosen in the preview (defaults from the template, which Operations maintains), even when the applier could not assign those people by hand (owner decision). Everything after generation follows F06 permissions.

## Data

Module ownership: a new `templates` module owns every table below. It reads users and department membership through `auth`'s `UserDirectory`, clients through `clients`' `ClientDirectory`, projects, milestones, retainers and cycles through `projects`' `EngagementDirectory`, and creates tasks through a new service `tasks` exports (`TaskGenerator`). It registers into a new `projects` registry `CycleOpenedHooks`, called inside the transaction that opens a cycle, so `projects` never imports `templates` or `tasks`. `EngagementDirectory` gains milestone creation (for stages) and cycle line summaries with task counts.

Dates are calendar days in Asia/Damascus. **Work days** are Saturday to Thursday (`WORK_WEEK`); no holidays in V1.

### `work_templates` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `name` | text | required, trimmed, 1–80 chars; unique among non-archived templates, case-insensitive (`TEMPLATE_NAME_TAKEN`) |
| `kind` | enum `template_kind` (`project`, `retainer_cycle`) | required; cannot change after creation |
| `description` | text | optional, ≤ 1000 chars |
| `created_by_id` | uuid → `users.id` | from the session; null for seed rows |
| timestamps, `archived_at` | | archived = no longer offered when applying or linking; runs and generated tasks are kept |

### `work_template_stages` (project kind only)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `template_id` | uuid → `work_templates.id` | required, indexed |
| `name` | text | required, trimmed, 1–80 chars; unique within the template, case-insensitive |
| `position` | integer | dense from 1 |

At most 30 stages per template (the F05 milestone limit). Stages and steps are part of the template document: saving the template replaces them (see API), so they carry no `archived_at` of their own.

### `work_template_steps`
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `template_id` | uuid → `work_templates.id` | required, indexed |
| `stage_id` | uuid → `work_template_stages.id` | project kind: optional (steps without a stage create tasks without a milestone); retainer kind: always null |
| `position` | integer | dense from 1 across the template; order of generation and of dependencies |
| `title` | text | required, trimmed, 1–160 chars (F06 title) |
| `brief` | text | optional, ≤ 5000 chars |
| `department` | department code | required |
| `due_day` | integer | work day the task is due, counted from the run's start (day 1 = the first work day on or after it). Project kind: 1–260. Retainer kind: 1–27, fixed steps only |
| `priority` | enum `task_priority` | required, default `normal` |
| `needs_client_approval` | boolean | required, default true |
| `revision_limit` | integer | required, 0–20, default 2 |
| `checklist` | text[] | ≤ 20 items, each trimmed, 1–200 chars |
| `repeat_kind` | enum `deliverable_kind` | retainer kind only, optional: set = a **repeated step** (one task per committed unit of the cycle line of that kind) |
| `repeat_label` | text | required with `repeat_kind` = `other` (matches the line label, case-insensitive), else null |
| `spread_from_day` | integer | repeated steps only, 1–27, default 1: the first work day instances may fall on |

At most 60 steps per template. Within a template, `(repeat_kind, lower(repeat_label))` is unique: one repeated step per deliverable line kind, so a line's delivered count never counts two tasks for one unit.

### `work_template_step_dependencies`
| Field | Type | Rules |
|---|---|---|
| `step_id` | uuid → `work_template_steps.id` | the waiting step |
| `depends_on_step_id` | uuid → `work_template_steps.id` | a step of the same template with a lower `position` (so no cycle is possible) |

Primary key `(step_id, depends_on_step_id)`. At most 10 per step (the F06 limit). In a monthly template a fixed step cannot depend on a repeated step (it would wait on up to 999 tasks); a repeated step may depend on fixed steps, and each of its instances then depends on the generated fixed tasks.

### `work_template_assignees`
| Field | Type | Rules |
|---|---|---|
| `template_id` | uuid → `work_templates.id` | |
| `department` | department code | a department used by at least one step |
| `user_id` | uuid → `users.id` | the default assignee; when saved, a non-archived member (primary or secondary) of the department (`INVALID_ASSIGNEE`) |

Primary key `(template_id, department)`. A department without a row defaults to "unassigned" (the department's queue). A default that later becomes invalid (the user is archived or leaves the department) is kept and shown with an "invalid default assignee" warning on the template; runs treat it as unassigned (owner decision). Archiving a user is never refused because of templates.

### `retainer_templates` (link owned by `templates`)
| Field | Type | Rules |
|---|---|---|
| `retainer_id` | uuid → `retainers.id` | primary key |
| `template_id` | uuid → `work_templates.id` | a non-archived `retainer_cycle` template when set (`TEMPLATE_KIND_MISMATCH`, `TEMPLATE_ARCHIVED`); indexed |
| `linked_by_id`, timestamps | | |

Unlinking deletes the row (a link, audited on the retainer). A linked template that is later archived stays linked but generates nothing; the retainer page shows a warning.

### `template_runs` (append-only)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `template_id` | uuid → `work_templates.id` | required, indexed |
| `trigger` | enum `template_run_trigger` (`manual`, `cycle_opened`, `missing_tasks`) | required |
| `project_id` | uuid → `projects.id` | project runs; indexed |
| `retainer_cycle_id` | uuid → `retainer_cycles.id` | cycle runs; indexed; exactly one of `project_id` and `retainer_cycle_id` (check constraint) |
| `cycle_line_id` | uuid → `retainer_cycle_lines.id` | `missing_tasks` runs only |
| `start_date` | date | the run's start |
| `task_count`, `milestones_created` | integer | |
| `created_by_id` | uuid → `users.id` | null for `cycle_opened` runs from the daily job |
| `created_at` | timestamptz | |

A partial unique index on `retainer_cycle_id` where `trigger` is `manual` or `cycle_opened`: a cycle gets at most one full run (`ALREADY_GENERATED`); that index also makes the automatic run idempotent. No `updated_at` or `archived_at`: runs are never edited.

### `template_run_tasks`
`(run_id → template_runs.id, task_id → tasks.id)`, primary key both, plus `step_id` (uuid, not a foreign key: the step may be edited away later) and `instance` (integer, repeated steps only). Lets the run history list its tasks without a templates column on `tasks`.

### Change to F06 data
- `tasks.created_by_id` and `task_dependencies.created_by_id` become nullable: null means created by the system (a `cycle_opened` run). The task page shows "created automatically from <template>" for them. Every other path still sets them from the session.

## States and rules

Templates have no workflow: they are active or archived. Runs are immediate and all-or-nothing (one transaction).

### Work days (pure functions in `packages/contracts/src/dates.ts`)
- `isWorkDay(date)`: not a `WORK_WEEK` weekend day.
- `nthWorkDay(start, n)`: day 1 = the first work day on or after `start`; day n = the (n − 1)th work day after day 1.
- `workDaysBetween(from, to)`: the work days in `[from, to]`, in order.

### Template rules
1. Only the fields above are valid per kind: stages, and `due_day` beyond 27, only in `project` templates; `repeat_kind` only in `retainer_cycle` templates; a step's stage belongs to the same template. Violations are validation errors (400).
2. Dependencies point to earlier steps only (by position), at most 10 per step; in monthly templates never from a fixed step to a repeated step (validation).
3. A template needs at least one step to be saved.
4. Default assignees must be valid when saved (`INVALID_ASSIGNEE`); later invalidity produces a warning, never an error.
5. Editing or archiving a template never changes tasks already generated or past runs.

### Planning a run (one pure function `planTemplateRun` in `packages/contracts`, used by the preview and by the apply)
6. **Start date.** Project runs: chosen in the preview, default the later of the project's start date and today; it may not be before today (`INVALID_DATES`, F06 rule 12: no new task due in the past). Cycle runs: the later of the cycle's period start and today.
7. **Project steps.** Due date = `nthWorkDay(start, due_day)`. A due date after the project's due date is allowed and shown as a warning in the preview.
8. **Fixed monthly steps.** Due date = `nthWorkDay(start, due_day)`, clamped to the cycle's **last work day** (the last work day on or before the period end, or the period end when the run starts after it).
9. **Repeated monthly steps.** For the cycle line matching `repeat_kind` (and label for `other`), n = the line's committed quantity. Instances are numbered 1…n and titled "<step title> <i>". With D = the work days from `nthWorkDay(start, spread_from_day)` to the last work day (or just the last work day when that range is empty) and W = |D|, instance i is due on D[⌈i·W/n⌉ − 1]: evenly spread, the last one on the last work day. Each instance is linked to the cycle line. Lines without a matching repeated step, and repeated steps without a matching line (or with committed 0), generate nothing.
10. **Assignee.** Per department, the one chosen in the preview (default: the template's default assignee). An assignee who is not a non-archived member of the department at run time is replaced by "unassigned" (the task joins the department's queue, F06 rule 6); the preview shows it. Automatic runs use the template defaults.
11. **Task fields.** Each task gets the step's title, brief, department, priority, needs client approval, revision limit and checklist; type `work`; status `new`; the engagement's client; the project and milestone (project runs) or the cycle and, for repeated instances, the cycle line (cycle runs). `created_by_id` is the applier, or null for automatic runs.
12. **Dependencies.** Each generated task depends on the tasks generated from the steps it depends on in the same run. A repeated instance depending on a fixed step depends on that step's task. `missing_tasks` runs create no dependencies.
13. **Stages → milestones.** Each stage used by at least one step maps to the project's non-archived `pending` milestone with the same name (trimmed, case-insensitive; the first by position if several); otherwise a new milestone is created with that name, due on the latest due date of the stage's tasks, appended after the existing milestones in stage order, without an installment. Past the 30-milestone limit the run is refused (`LIMIT_REACHED`). Stages without steps are ignored.
14. **Size.** A run creates at most 300 tasks. A cycle run past the cap stops adding repeated instances at the cap (lines keep "missing" tasks for rule 18); a project run cannot exceed it (60 steps).

### Applying
15. **Project runs** need a non-archived project in `planned`, `active` or `on_hold` (`PROJECT_CLOSED`, `PROJECT_ARCHIVED`) of a non-archived client with status `active` or `paused` (`CLIENT_ARCHIVED`, `CLIENT_ENDED`), and a non-archived `project` template (`TEMPLATE_ARCHIVED`, `TEMPLATE_KIND_MISMATCH`). A template may be applied to the same project more than once (for example two reels); the preview warns when it was applied before.
16. **Automatic cycle runs (A02, task part).** When a cycle opens (daily job, or a retainer starting, resuming or reactivating), inside the same transaction: if the retainer has a linked, non-archived monthly template, a `cycle_opened` run generates the cycle's tasks. It never refuses on data: invalid assignees become unassigned (rule 10) and the cap applies (rule 14). If it fails for an unexpected reason the cycle's opening rolls back with it and the next daily run retries.
17. **Manual cycle runs.** On the retainer's open current cycle (`CYCLE_CLOSED`) of a non-archived (`RETAINER_ARCHIVED`), not ended (`RETAINER_ENDED`) retainer with a linked template (`NO_TEMPLATE`), when the cycle has no full run yet (`ALREADY_GENERATED`); for a retainer linked after its cycle opened.
18. **Missing tasks.** For a line of the open current cycle: missing = committed quantity − the line's non-archived, non-cancelled tasks (any origin, manual tasks included). "Generate missing" creates that many instances of the linked template's repeated step for the line's kind (`NO_TEMPLATE`, `NO_REPEATED_STEP`, `NOTHING_MISSING`), numbered after the line's existing tasks, spread with rule 9 from today over the remaining work days (owner decision). Lowering a quantity never cancels tasks.
19. Linking a template to a retainer applies from the next cycle; the current cycle is generated only by rule 17.

## API

Schemas live in `packages/contracts/src/templates.ts` (with `planTemplateRun`) and the work-day helpers in `dates.ts`, reusing the shared list and error schemas. The `templates` module owns every route below.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/templates` | `templates.read` | `templateListQuerySchema`: `search` (name), `kind`, `archived` (`templates.manage`), `sort` (`name` default, `updatedAt`), `order` | `templatePageSchema`: id, name, kind, description, step count, departments, `warnings` count (invalid default assignees), linked retainers count, `updatedAt` | — |
| `GET /api/templates/:id` | `templates.read` | — | `templateDetailSchema`: basics, stages, steps (with dependencies by step id, checklist, repeat fields), default assignees (user id, name, archived, `valid`), warnings, linked retainers (id, name, client), `archivedAt`, `permissions` (`canEdit`, `canArchive`) | 404 |
| `POST /api/templates` | `templates.manage` | `templateInputSchema`: name, kind, description, stages[] (`key`, name), steps[] (`key`, stageKey, title, brief, department, dueDay, priority, needsClientApproval, revisionLimit, checklist[], repeatKind, repeatLabel, spreadFromDay, dependsOn[] as keys), assignees[] (department, userId); order of the arrays is the position | `templateDetailSchema` | 403, `TEMPLATE_NAME_TAKEN`, `INVALID_ASSIGNEE` |
| `PUT /api/templates/:id` | `templates.manage` | `templateInputSchema` without `kind` (`key` = the existing id to keep it, or a new client key) | `templateDetailSchema` | 403, 404, `TEMPLATE_ARCHIVED`, `TEMPLATE_NAME_TAKEN`, `INVALID_ASSIGNEE` |
| `POST /api/templates/:id/archive` · `/restore` | `templates.manage` | — | `templateDetailSchema` | 403, 404, `TEMPLATE_ARCHIVED` / `TEMPLATE_NOT_ARCHIVED`, `TEMPLATE_NAME_TAKEN` (restore) |
| `POST /api/templates/:id/preview` | `projects.manage` over the target | `templateRunInputSchema`: `projectId` or `retainerCycleId`, `startDate` (project runs), `assignees[]` (department, userId or null) | `templateRunPlanSchema`: start date, tasks (key, title, department, assignee or null with `assigneeReplaced`, due date, stage → milestone `{ existingId }` or `{ newName }`, cycle line, dependsOn keys), milestones to create, `warnings` (`due_after_project`, `applied_before`, `assignee_replaced`, `over_cap`), `taskCount` | 403, 404, the apply codes |
| `POST /api/templates/:id/runs` | as preview | `templateRunInputSchema` | `templateRunSchema`: id, template, trigger, target, start date, task count, milestones created, created by, created at | 403, 404, `TEMPLATE_ARCHIVED`, `TEMPLATE_KIND_MISMATCH`, `INVALID_DATES`, `INVALID_ASSIGNEE` (a chosen user not in the department), `PROJECT_CLOSED`, `PROJECT_ARCHIVED`, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `CYCLE_CLOSED`, `RETAINER_ARCHIVED`, `RETAINER_ENDED`, `NO_TEMPLATE`, `ALREADY_GENERATED`, `LIMIT_REACHED` |
| `GET /api/template-runs` | `projects.read` | one of `projectId`, `retainerId`, `taskId`; page | `templateRunPageSchema`, newest first: run fields, with the tasks of the run (id, title, status) on request (`include=tasks`) | — |
| `GET /api/retainers/:id/template` | `projects.read` | — | linked template (id, name, archived) or null; current cycle's full run or null; per line of the current cycle: `committed`, `tasks` (non-archived, non-cancelled), `missing`, `canGenerate` (a repeated step exists); `permissions` | 404 |
| `PUT /api/retainers/:id/template` | `projects.manage` (client scope) | `{ templateId: uuid \| null }` | as the GET | 403, 404, `TEMPLATE_ARCHIVED`, `TEMPLATE_KIND_MISMATCH`, `RETAINER_ARCHIVED`, `RETAINER_ENDED` |
| `POST /api/retainers/:id/cycles/:cycleId/lines/:lineId/missing-tasks` | `projects.manage` (client scope) | — | `templateRunSchema` | 403, 404, `CYCLE_CLOSED`, `RETAINER_ARCHIVED`, `RETAINER_ENDED`, `NO_TEMPLATE`, `TEMPLATE_ARCHIVED`, `NO_REPEATED_STEP`, `NOTHING_MISSING` |

A cycle run through `POST /api/templates/:id/runs` must use the template linked to the retainer: `NO_TEMPLATE` when none is linked, `TEMPLATE_NOT_LINKED` for another template.

Changes to other modules:
- `projects`: new `CycleOpenedHooks` registry (called by `RetainerCyclesService.open` inside its transaction with the cycle id, retainer id and actor or null); `EngagementDirectory` gains `createMilestones(tx, projectId, milestones, actor)` (writes F05's `project_milestone.created` audit entries) and cycle and line summaries needed by rules 9, 17 and 18. The new project form's `createProjectSchema` is unchanged: the web fills its `milestones` from the template.
- `tasks`: exports `TaskGenerator.createMany(tx, drafts, actor | null)` that inserts tasks, checklist items and dependencies in the caller's transaction and writes `task.created` per task with `templateRunId` in `after`; it applies F06's data rules (rule 10's assignee fallback happens in the planner before). `created_by_id` nullable (Data).
- New error codes: `TEMPLATE_NAME_TAKEN`, `TEMPLATE_ARCHIVED`, `TEMPLATE_NOT_ARCHIVED`, `TEMPLATE_KIND_MISMATCH`, `TEMPLATE_NOT_LINKED`, `NO_TEMPLATE`, `NO_REPEATED_STEP`, `NOTHING_MISSING`, `ALREADY_GENERATED`.

## Screens

All screens: Arabic RTL, strings through i18next (`templates.*`), dates in Asia/Damascus with Latin digits, loading, empty and error states.

1. **Templates** `/templates` — table: name, kind badge (project / monthly), steps, departments, warning badge, last updated. Filters: kind; "Archived" for `templates.manage`. "New template" for `templates.manage`. Linked in navigation for department managers, account managers, General Manager and Operations manager; reachable by everyone. Empty: "no templates yet".
2. **Template page** `/templates/$templateId` and **New template** `/templates/new` — name, kind (chosen on create only), description. **Default assignees**: one row per department used by the steps, with a picker of that department's members and "unassigned (department queue)"; invalid defaults show a warning. **Steps**: project templates group steps under stages (add, rename, reorder, remove stages; steps without a stage last); monthly templates list fixed steps, then repeated steps under "One task per deliverable" with the deliverable kind (and label for other) and "spread from work day". Each step: title, department, due work day ("day 3"), priority, needs client approval, revision limit, depends on (earlier steps), checklist, brief; add, edit (dialog), reorder (drag and up/down), remove. Saving sends the whole document; errors point to the step. Readers see the same page read-only. Actions: archive / restore. Archived templates show a banner. A "Linked retainers" list on monthly templates.
3. **Generate tasks dialog** (project Tasks tab: "Generate from template"; retainer This month tab: "Generate this month's tasks") — template picker (non-archived, of the right kind; on a retainer, the linked template only), start date (projects), assignee per department (defaults filled in), and the preview from `POST …/preview`: tasks grouped by milestone (badge "existing" / "new milestone") or, for a cycle, fixed tasks then per line "Design 1…12", each with department, assignee (or "department queue"), due date and "waits on"; warnings on top. "Generate N tasks" applies it; on success the tab refreshes and shows a toast.
4. **New project** (F05) — a "Template" picker (project templates) above the milestones editor: picking one replaces the suggested milestones with the template's stages, due dates computed from the start date with rule 7 (editable; installments as before). After saving, the project page opens with the generate dialog prefilled with that template.
5. **Project page, Tasks tab** (F06) — "Generate from template" (users who may manage the project, while it runs); a line per run above the list: "Generated from <template> on <date> by <name> (N tasks)".
6. **New retainer and retainer page** (F05) — "Monthly template" picker on the new retainer form and an edit action on the retainer page (client-scope users). This month tab: "Tasks generated from <template> on <date>" (or "automatically"), or the "Generate this month's tasks" button when the cycle has no full run; per line, "tasks 12/14" and "Generate 2 missing tasks" when missing > 0 and the template has a repeated step for it; a warning when the linked template is archived.
7. **Task page** (F06) — a generated task shows "Generated from <template> on <date>", or "Created automatically from <template>" when it has no creator. The web reads it from `GET /api/template-runs?taskId=` (`tasks` does not import `templates`, so the task detail does not carry it).

What roles see differently: everyone reads templates and runs; only `templates.manage` edits templates; the generate and link actions appear for users who may manage the project or retainer.

## Audit, notifications and jobs
- Audit actions: `template.created`, `template.updated` (before/after of name and description, and a summary of steps and stages added, changed and removed), `template.assignees_updated` (department, user before/after), `template.archived`, `template.restored` (entity `template`); `template_run.created` (entity `template_run`: template, trigger, target, start date, task count, milestones created); `retainer.template_changed` (entity `retainer`: template before/after). Generated tasks write F06's `task.created` (with `templateRunId`) and dependencies; created milestones write F05's `project_milestone.created`. All in the run's transaction; automatic runs have a null actor.
- Notification events (F14 delivers them; F07 ships none): a run notifies each assignee once with the number of tasks assigned to them ("12 tasks from Monthly social media — <client>"), and each department's managers once for the tasks left unassigned in their department, instead of one F06 "assigned" event per task. Linking a template whose default assignee is invalid is not a notification; it is the template warning.
- Jobs: no new job. The daily `retainers.cycles` job (F05) runs the automatic cycle runs through `CycleOpenedHooks`.

## Seed templates (draft for the owner to review)
Inserted by a data migration with Arabic titles (English here), no default assignees, revision limit 2, priority normal. "CA" = needs client approval. Days are work days.

**Brand identity** (project)
| Stage | Step | Department | Day | Depends on | CA |
|---|---|---|---|---|---|
| Discovery | Brand discovery session and brief | Marketing | 3 | — | yes |
| Discovery | Market and competitor research | Marketing | 5 | brief | no |
| Design | Moodboard and creative direction | Design | 7 | research | yes |
| Design | Logo concepts (three directions) | Design | 12 | moodboard | yes |
| Design | Color palette and typography | Design | 15 | logo | yes |
| Design | Brand guidelines | Design | 20 | palette | yes |
| Delivery | Brand applications (stationery, social templates) | Design | 24 | guidelines | yes |
| Delivery | Final files and handover | Design | 26 | applications | no |

**Promotional reel** (project)
| Stage | Step | Department | Day | Depends on | CA |
|---|---|---|---|---|---|
| Pre-production | Concept and script | Content Management | 2 | — | yes |
| Pre-production | Shot list and shoot plan | Photography | 3 | script | no |
| Production | Shoot | Photography | 5 | shot list | no |
| Post-production | First cut | Photography | 8 | shoot | yes |
| Post-production | Cover and text overlays | Design | 9 | script | no |
| Post-production | Final cut and export | Photography | 11 | first cut, overlays | yes |

**Website** (project; stage names match F05's suggested milestones)
| Stage | Step | Department | Day | Depends on | CA |
|---|---|---|---|---|---|
| Discovery | Requirements and sitemap | Development | 3 | — | yes |
| Discovery | Content inventory | Content Management | 5 | requirements | no |
| Design | Wireframes | Design | 8 | requirements | yes |
| Design | UI design | Design | 14 | wireframes | yes |
| Build | Frontend build | Development | 24 | UI design | no |
| Build | Backend and CMS | Development | 24 | requirements | no |
| Build | Content entry | Content Management | 26 | backend, content inventory | no |
| Test | Testing and fixes | Development | 29 | frontend, content entry | yes |
| Delivery | Launch | Development | 31 | testing | no |
| Delivery | Client training and handover | Development | 32 | launch | no |

**Monthly social media cycle** (monthly)
| Step | Department | Timing | Depends on | CA |
|---|---|---|---|---|
| Monthly content plan and captions | Content Management | day 3 | — | yes |
| Design *(per `design` unit)* | Design | spread from day 4 | plan | yes |
| Post *(per `post` unit)* | Content Management | spread from day 4 | plan | yes |
| Story *(per `story` unit)* | Design | spread from day 4 | plan | yes |
| Reel *(per `reel` unit)* | Photography | spread from day 5 | plan | yes |
| Video *(per `video` unit)* | Photography | spread from day 5 | plan | yes |
| Photo shoot *(per `photo_shoot` unit)* | Photography | spread from day 4 | plan | no |
| Ad campaign *(per `ad_campaign` unit)* | Marketing | spread from day 4 | plan | yes |
| Monthly report *(per `monthly_report` unit)* | Marketing | last work day | — | no |

## Edge cases
1. Two people apply a template to the same project at once: both runs succeed (repeat applications are allowed); the second preview shows "applied before" only if it was loaded after the first run.
2. Two automatic or manual runs on one cycle at once: the partial unique index lets one win; the other gets `ALREADY_GENERATED` (manual) or is skipped (automatic, same transaction as the cycle insert, which is already idempotent).
3. A template is edited or archived between preview and apply: the apply re-plans from the current template; archived → `TEMPLATE_ARCHIVED`. The owner sees the new result in the refreshed preview.
4. A stage name matches a done milestone: a new milestone with the same name is created (tasks cannot join a done milestone, F06 rule 7).
5. The project has 30 milestones already and the template needs a new one: `LIMIT_REACHED`, naming the stages.
6. A retainer starts mid-month: the cycle opens at once with full quantities (F05 R4) and the run spreads the instances over the remaining work days.
7. The job runs late (server down on the 1st): start = today (rule 6), so no task is due in the past; fixed steps whose day has passed are due on their computed day from today.
8. A cycle with committed 0 on a line, or a line of kind `other` whose label no repeated step matches: no tasks for it; "Generate missing" is not offered.
9. A committed quantity of 500: the automatic run stops at 300 tasks; the line shows the remaining as missing (rule 14, rule 18).
10. The default assignee is archived or leaves the department: runs create those tasks unassigned in the department's queue; the template shows the warning until Operations picks another default.
11. A department manager changes: no effect on templates; unassigned generated tasks go to the new manager's queue.
12. A linked retainer is paused: no cycle opens, so no run. Resumed mid-month: the cycle opens and the run happens then.
13. The client is paused: project runs are still allowed (F06 rule 7 allows paused clients); cycles behave as F05 defines.
14. A cancelled or delivered generated task: counts as a task of the line for "missing" only while not cancelled; cancelling one makes it missing again.
15. A period ending on a Friday: the cycle's last work day is the Thursday before (rule 8).
16. A permission loss mid-session (account manager changed): the next preview or apply returns 403.

## Open questions
- None blocks F07. The owner reviews the seed templates above before approval; they stay editable from the UI.

## Acceptance
- Owner check in the browser:
  1. As the Operations manager, open Templates: the four seeds are there. Open "Website", set a default assignee for Design and Development. Create a small test template, archive it and restore it.
  2. As an account manager, create a project for a client choosing the "Website" template: the milestones editor shows the five stages with computed due dates. Save: the generate dialog opens with the template; change the Development assignee; the preview shows tasks per milestone ("existing"), due dates on work days only (no Friday) and dependencies. Generate: the Tasks tab shows the tasks and a run line; the first tasks are not blocked, "UI design" waits on "Wireframes".
  3. Apply "Promotional reel" to the same project: the preview shows three "new milestone" stages; generate: the milestones appear in the Milestones tab.
  4. As an ordinary employee who is the project's project manager, apply a template: allowed; the tasks keep the template's assignees.
  5. On a retainer with lines design 12, reel 4, monthly report 1, link "Monthly social media cycle" and use "Generate this month's tasks": 1 plan task + 12 designs + 4 reels + 1 report, each design linked to the design line and waiting on the plan; the line shows "tasks 12/12".
  6. Raise the design line's committed quantity to 14 with a reason: the line shows "Generate 2 missing tasks"; generate: "Design 13" and "Design 14" appear, spread over the rest of the month.
  7. Deliver a design task: the counter goes up by one.
  8. Archive the designer who is the template's default for Design: allowed; the template shows the warning; the next run puts design tasks in the Design queue.
  9. Open the audit log: the template changes, the runs and the created tasks and milestones are there.
- Tests:
  - Unit (contracts): template input schemas per kind (rules 1–3); work-day helpers across Fridays and month ends; `planTemplateRun`: project due dates, stage → milestone mapping, fixed-step clamping, repeated spread (n < W, n = W, n > W, n = 1, empty range), dependencies per instance, assignee replacement, the 300 cap, `missing_tasks` numbering; permission map change (`templates.read` all).
  - API (`apps/api/test/templates.test.ts`, `template-runs.test.ts`): each endpoint for success, 401, 403 and out of scope (an employee editing a template; an account manager applying to another manager's client; a project manager applying to a project not theirs or linking a retainer template); each error code; rules 4–19; the automatic run on the daily job, on start, resume and reactivate, and its idempotency; null creator on automatic tasks; audit entries in the same transaction; the F05 counter counting generated tasks; the seed migration.
  - E2E: create a project from the Website template and generate its tasks; link the monthly template and generate a cycle.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): templates list, project template page, monthly template page, generate dialog preview (project and cycle), new project with a template, retainer This month with generated counts and "generate missing".
