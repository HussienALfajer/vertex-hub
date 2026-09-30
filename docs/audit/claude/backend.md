# Backend and data correctness audit

- Date: 2026-09-30 · Commit: 9463f9f
- Scope covered: `apps/api` modules auth (users, departments, access lock), clients (service, directory), projects (projects, milestones, retainers, retainer cycles and the `retainers.cycles` job, extra work, engagement directory, work progress, renewals), tasks (service, workflow, access, dependencies, parts, comments, views, hooks, generator, notices, reminders), templates (templates, runs, retainer link), notifications (center, channel, stream, daily job, service), audit; `apps/worker` jobs (heartbeat, retainer cycles, notifications daily, pg-boss service); `apps/api/src/core/jobs`; `packages/db` schema files, client, migrate and every migration `.sql`; `packages/contracts` dates, jobs, money, lists, workflow, tasks, retainers, templates, notifications. Compared against specs F05, F06, F14 (full rule sections), F02 and F07 (relevant rules) and ADRs 0006, 0013–0018.
- Not covered: permission-map correctness and object-level access (area 1, only touched where it changes data), web code, running the test suite (area 5), `deploy/`. `users.service.ts` was read for archive, roles and departments only; `templates.service.ts` document save (`saveDocument`) was skimmed, not traced line by line; `task-comments.service.ts` and `departments.service.ts` were grepped, not read in full.
- Checks run: none. Read-only file reads and greps only; no vitest run was needed to prove a behaviour.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| BE-01 | High | Editing an out-of-scope client request's client or engagement leaves its extra work item on the old project or retainer | `apps/api/src/modules/tasks/tasks.service.ts:466` |
| BE-02 | Medium | `task.created` audit entries store full link URLs (share tokens) in the append-only log | `apps/api/src/modules/tasks/tasks.service.ts:422` |
| BE-03 | Medium | One failing retainer (or reminder source) aborts the whole daily job run for everything after it | `apps/api/src/modules/projects/retainer-cycles.service.ts:126` |
| BE-04 | Medium | Tasks of completed or cancelled projects can be reopened, so a completed project gets open tasks | `apps/api/src/modules/tasks/task-workflow.service.ts:77` |
| BE-05 | Low | Renewal reminders go out for retainers of archived clients | `apps/api/src/modules/projects/retainer-renewals.ts:147` |
| BE-06 | Low | Concurrent dependency edits on two tasks can create a dependency cycle | `apps/api/src/modules/tasks/task-workflow.service.ts:242` |
| BE-07 | Low | Unique-index races surface as 500 instead of the coded error | `apps/api/src/core/errors/index.ts:8` |
| BE-08 | Low | Transactions read task counts through the pool instead of the transaction; pool has no timeouts | `apps/api/src/modules/projects/retainer-cycles.service.ts:589` |
| BE-09 | Low | Lock sets taken without a fixed order can deadlock (project cancel vs. task move) | `apps/api/src/modules/tasks/task-hooks.service.ts:98` |
| BE-10 | Low | Task cancel reason accepts 2000 chars; spec caps it at 500 | `packages/contracts/src/tasks.ts:417` |
| BE-11 | Low | Two comments at once can create two unread `task_commented` rows instead of merging | `apps/api/src/modules/notifications/notification-center.ts:108` |
| BE-12 | Low | Business constants duplicated outside `packages/contracts` | `apps/api/src/modules/tasks/task-sql.ts:10` |
| BE-13 | Info | Business time zone is a fixed UTC+3 offset, not `Asia/Damascus` | `packages/contracts/src/dates.ts:9` |
| BE-14 | Info | Money columns of milestones and extra work have no currency column of their own | `packages/db/src/schema/retainers.ts:281` |

Counts: Critical 0 · High 1 · Medium 3 · Low 8 · Info 2

## Findings

### BE-01 — Editing an out-of-scope client request's client or engagement leaves its extra work item on the old project or retainer

- **Severity:** High
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/tasks/tasks.service.ts:466-488` (links merged and checked), `apps/api/src/modules/tasks/tasks.service.ts:564-585` (extra work touched only when the scope changes)
- **Evidence:** In `update`, a link change is validated (`assertLinks`, `assertSameClientLinks`) and written, but the task's `extraWorkItemId` is only created or archived when `scopeGiven`:
  ```ts
  let extraWorkItemId = task.extraWorkItemId;
  if (scopeGiven && input.requestScope === 'out_of_scope') { ... createRequestExtraWork ... }
  if (scopeGiven && input.requestScope === 'in_scope' && task.extraWorkItemId) { ... archiveExtraWork ... }
  ```
  Nothing handles `linksChange` for an `out_of_scope` request. `taskLinkProblem` (`packages/contracts/src/tasks.ts:335`) and line 477 only refuse removing the client, so an `out_of_scope` request can be moved to another client's project, from a project to a retainer, or have its project/retainer removed entirely, while its extra work item stays logged (unbilled) on the original project of the original client. Spec F06 rule 11: "`out_of_scope` requires a project or retainer (`NO_ENGAGEMENT`) and creates … an extra work item … linked through `extra_work_item_id`"; ADR 0016: out-of-scope requests "create an F05 extra work item at once, so they reach invoicing (F13)". Creation enforces `NO_ENGAGEMENT` (`createRequestExtraWork` → `engagementOf`), editing does not.
- **Impact:** A correction of a wrongly linked client request (a common edit) leaves a billable extra work item on another client's project or retainer, and an out-of-scope request can end up with no engagement at all. The account manager of the wrong client sees an unbilled item for work they never received; the right client's item is missing, so it is not billed.
- **Suggested fix:** In `TasksService.update`, when `task.requestScope === 'out_of_scope'` (and the scope is not being switched in the same request) and the engagement changes (`projectId`, `retainerCycleId` → retainer, or `clientId`): refuse removing the engagement with `NO_ENGAGEMENT`; otherwise, if the item is `unbilled`, archive it through `engagements.archiveExtraWork` and create a new one on the new engagement with `createRequestExtraWork`, auditing both in the same transaction (`task.request_scope_changed` or a new `task.extra_work_moved`); if it is billed or waived, refuse with `EXTRA_WORK_BILLED`. Guard with `apps/api/test/tasks.test.ts` cases: (a) out-of-scope request moved from project A to project B → old item archived, new item on B, task points at the new one; (b) engagement removed → 409 `NO_ENGAGEMENT`; (c) billed item → 409 `EXTRA_WORK_BILLED`.

### BE-02 — `task.created` audit entries store full link URLs (share tokens) in the append-only log

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/tasks/tasks.service.ts:412-424`
- **Evidence:** Creating a task with links writes the raw input into the audit entry:
  ```ts
  after: {
    ...values,
    ...
    ...(input.links.length > 0 && { links: input.links }),
  },
  ```
  `input.links` is `{ url, label }[]`. The dedicated link endpoint does it right: `task-parts.service.ts:169-171` "Links may carry share tokens: the audit keeps the site only" → `site: new URL(created.url).host`. Rules broken: F06 "Audit, notifications and jobs": "link entries keep the label and the site (host) only, never the full URL, which may hold a share token"; `apps/api/CLAUDE.md`: "never passwords, tokens, links or 2FA secrets".
- **Impact:** Every task created with links (the New task form sends them) leaves the full share URL in `audit_entries`, which is append-only and never purged. Archiving the link later does not remove the token; anyone with `audit.read` keeps access to it indefinitely.
- **Suggested fix:** Map the links as `task-parts` does: `links: input.links.map((l) => ({ label: l.label ?? null, site: new URL(l.url).host }))`. Existing rows need a one-off custom migration (`drizzle-kit generate --custom`) that rewrites `after->'links'` of `task.created` entries to label and host, if the owner accepts editing audit rows once; otherwise document that pre-fix entries hold URLs. Test in `apps/api/test/tasks.test.ts`: create a task with a link, read the `task.created` entry, assert it contains the host and no `url` key.

### BE-03 — One failing retainer (or reminder source) aborts the whole daily job run for everything after it

- **Severity:** Medium
- **Confidence:** Likely (the code path is confirmed; no deterministic failing input was found)
- **Location:** `apps/api/src/modules/projects/retainer-cycles.service.ts:126-161`; `apps/api/src/modules/notifications/daily-reminders.ts:67-72`; `apps/api/src/modules/tasks/task-reminders.ts:118-125`; `apps/api/src/modules/projects/retainer-renewals.ts:149-178`
- **Evidence:** `runDaily` loops over retainers ordered by id, one transaction each, with no `try/catch`:
  ```ts
  for (const { id } of candidates) {
    await this.db.transaction(async (tx) => { ... close ... open ... openedHooks.run ... });
  }
  ```
  The transaction also runs the F07 cycle-opened hook (template run: task inserts, checklist, dependencies, notifications). Any error in one retainer (a deadlock victim, a constraint in generated tasks, a bad template) throws out of `runDaily`; retainers after it in id order are neither closed nor opened for that run. `DailyReminders.runDaily` does the same across sources, so an error in the tasks source skips the renewal source and the purge; `TaskReminders.send` and `RetainerRenewals.remind` stop at the first failing reminder. pg-boss retries the whole job (idempotent, so no double effects), but a persistent error repeats every day. ADR 0015 / F05 R2 require each active retainer to get its month; success metric 4 requires every month to close with a known delivery rate.
- **Impact:** A single broken retainer or task can silently stop cycle closing/opening (and the A02 generated tasks) or reminders for other clients until someone reads the API logs. There is no alert.
- **Suggested fix:** Catch per item: wrap each retainer's transaction (and each reminder, and each daily source) in `try/catch`, log with the retainer/task id through the Nest logger, count failures, continue, and throw at the end if any failed so pg-boss still records the job as failed. Tests: in `apps/api/test/retainer-cycles.test.ts`, register a `CycleOpenedHooks` hook that throws for one retainer and assert the other retainers still get their cycle and `runDaily` rejects; same pattern for a daily source in `apps/api/test/notifications.test.ts`.

### BE-04 — Tasks of completed or cancelled projects can be reopened, so a completed project gets open tasks

- **Severity:** Medium
- **Confidence:** Confirmed (code path); the intended rule needs an owner decision
- **Location:** `apps/api/src/modules/tasks/task-workflow.service.ts:77-99` (no project-state check), `packages/contracts/src/tasks.ts:139-145` (`delivered>revisions`, `delivered>in_progress`, `cancelled>in_progress|new`), `apps/api/src/modules/projects/projects.service.ts:464-473` (the invariant enforced only at completion)
- **Evidence:** `changeStatus` checks only `assertTaskWritable` (archived) and the move rights. Nothing reads `task.project.status`. So after a project is completed (which requires no open tasks, `TASKS_OPEN`) or cancelled (which cancels its open tasks), a manager can `reopen_internal` / `reopen_client` a delivered task or `reopen` a cancelled one, and the project then holds open tasks. The same applies to the extra-work decision: `decideRevision` on that reopened task then fails with the project-closed error from `assertTakesExtraWork`. F05 rule 7: "A `completed` or `cancelled` project is read-only, including milestones and extra work, until reopened (`PROJECT_CLOSED`)"; F06 edge case 7: "A reopened project does not reopen its cancelled tasks", which implies reopening goes through the project first.
- **Impact:** Completed projects show open work and progress below 100%; cancelled projects get live tasks that appear in workloads and reminders (A07/A08) for a project nobody works on; client-caused reopen after completion cannot become extra work.
- **Suggested fix:** Owner decision first (see Open questions). If closed projects are read-only for tasks too: in `changeStatus`, refuse `reopen`, `reopen_internal` and `reopen_client` with `PROJECT_CLOSED` when `task.project` is completed or cancelled (and drop them from `allowedTaskTransitions` via `taskPermissions`). Test in `apps/api/test/tasks.test.ts`: complete a project, try to reopen its delivered task → 409 `PROJECT_CLOSED`; reopen the project, then the task → 200.

### BE-05 — Renewal reminders go out for retainers of archived clients

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/projects/retainer-renewals.ts:131-152`
- **Evidence:** The query filters `isNull(retainers.archivedAt)` and `ne(status, 'ended')` but not the client; `ClientDirectory.summaries` returns archived clients too (`client-directory.ts:50-58`), and the loop only skips a missing client: `if (!client || !renewalDate) continue;`. The cycle job and task reminders do exclude archived clients (`this.clients.isLive(...)`, `visibleSql()`). F05 G2: archiving a client hides its retainers ("the cycle job skips them"); F14 rule 12 targets retainers that are "not `ended` or archived".
- **Impact:** The account manager of an archived client (archived = entered by mistake) receives renewal notices whose link opens a retainer they cannot see (404 without scope all).
- **Suggested fix:** Add `this.clients.isLive(retainers.clientId)` to the `where` (or `if (!client || client.archived) continue;`). Test in `apps/api/test/notifications.test.ts`: archive the client of a retainer due for renewal, run `remind(today)`, assert no notification and no `notification_reminders` row.

### BE-06 — Concurrent dependency edits on two tasks can create a dependency cycle

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/api/src/modules/tasks/task-workflow.service.ts:242-265`; `apps/api/src/modules/tasks/task-dependencies.ts:128-134`
- **Evidence:** `setDependencies` locks only the edited task's row, then checks cycles with `reachableEdges` over committed `task_dependencies`. Request 1 (A waits on B) and request 2 (B waits on A) lock different rows, each sees no path back, and both commit: A ⇄ B. F06 rule 4 / edge case 2: "checked on every dependency change (`DEPENDENCY_CYCLE`)".
- **Impact:** Both tasks stay blocked forever; they can only start through the manager override. Unlikely with ~20 users, but the rule is stated as absolute.
- **Suggested fix:** Serialize dependency writes: take a transaction-scoped advisory lock (e.g. `pg_advisory_xact_lock(<constant>)`, or keyed by client id) before `dependenciesOf` in `setDependencies` and before `assertValidDependencies` in `create`. Test: two concurrent `PUT /api/tasks/:id/dependencies` with crossed ids → exactly one 409 `DEPENDENCY_CYCLE`.

### BE-07 — Unique-index races surface as 500 instead of the coded error

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/api/src/core/errors/index.ts:8-14` (no database error mapping; `grep 23505` finds nothing in `apps/api/src`); examples: `apps/api/src/modules/clients/clients.service.ts:305-306` (rename checked under the one client's row lock only), `apps/api/src/modules/templates/templates.service.ts:206-207` (create checks the name without any lock)
- **Evidence:** Name uniqueness is checked in code (`assertNameFree`) and backed by partial unique indexes (`clients_trade_name_idx`, `work_templates_name_idx`). Where the check is not serialized by a lock, two concurrent writes both pass the check and the second insert/update fails with PostgreSQL `23505`, which reaches the client as an unhandled 500. ADR 0013 Errors: an error the UI must tell apart carries a stable code.
- **Impact:** A rare generic error instead of `CLIENT_NAME_TAKEN` / `TEMPLATE_NAME_TAKEN`; no data damage (the index holds).
- **Suggested fix:** Add a global exception filter (or a helper around inserts) that maps `23505` on a known index name to its `CodedException` (409), and `40P01` (deadlock) to a retryable 409/503. Unit test the mapping; integration test two parallel `POST /api/templates` with the same name → one 201, one 409.

### BE-08 — Transactions read task counts through the pool instead of the transaction; pool has no timeouts

- **Severity:** Low
- **Confidence:** Confirmed (code path); impact Likely only under load
- **Location:** `apps/api/src/modules/projects/retainer-cycles.service.ts:578-595` (`liveDelivered(..., tx)` calls `this.progress.cycleLines(lineIds)` without the executor), `apps/api/src/modules/projects/engagement-directory.ts:265`, `apps/api/src/modules/tasks/task-hooks.service.ts:55-66` (`counts` always uses `this.db`), `apps/api/src/modules/projects/work-progress.ts:10-14` (interface has no executor), `packages/db/src/client.ts:14`
- **Evidence:** `close()` freezes `deliveredAtClose` from counts read on a second pool connection while the closing transaction holds its locks; `generateMissing`, the manual cycle run and the automatic cycle run read `line.tasks` the same way (`cycleLineSummaries`). The pool is `new pg.Pool({ connectionString })`: max 10 connections, no `connectionTimeoutMillis`, no `statement_timeout`/`idle_in_transaction_session_timeout`. The board runs 14 parallel queries per request (`task-views.service.ts:55-73`).
- **Impact:** (1) The counts ignore the transaction's own uncommitted changes (today harmless: no caller delivers and closes in one transaction, but the API invites it). (2) If every pool connection is held by a transaction that is waiting for another pool connection, requests hang with no timeout. Improbable at ~20 users, but it fails silently.
- **Suggested fix:** Give `WorkProgressSource.cycleLines/projects/milestones` an optional executor and pass `tx` from `liveDelivered` and `cycleLineSummaries`. Set pool options in `createDatabase` (`max` from env, `connectionTimeoutMillis`, and `statement_timeout` / `idle_in_transaction_session_timeout` via `options`). Test: a unit test that `close()` passes its transaction to the progress source (spy), and an integration test that closes a cycle inside a transaction after delivering a task in it and sees the delivery frozen.

### BE-09 — Lock sets taken without a fixed order can deadlock (project cancel vs. task move)

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/api/src/modules/tasks/task-hooks.service.ts:98-102`; `apps/api/src/modules/tasks/task-notices.ts:133-139`; `apps/api/src/modules/tasks/task-workflow.service.ts:77`
- **Evidence:** `cancelOpenTasks` locks every open task of the project with `.for('update')` and no `orderBy`. A concurrent status move locks its own task first, then (approve, deliver, cancel) locks its dependents in `openedDependents`. Project cancel (tasks in heap order) and a task approval (task T1, then dependent T2 of the same project) can wait on each other; PostgreSQL aborts one with `40P01`, which becomes a 500 (see BE-07).
- **Impact:** A rare failed cancel or approval that succeeds on retry; no data damage.
- **Suggested fix:** Add `.orderBy(asc(tasks.id))` to the `cancelOpenTasks` lock query (as `openedDependents` already does) and map `40P01` per BE-07.

### BE-10 — Task cancel reason accepts 2000 chars; spec caps it at 500

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `packages/contracts/src/tasks.ts:414-417` (`note: optionalText(2000)`), `apps/api/src/modules/tasks/task-workflow.service.ts:128` (`cancelReason: note`)
- **Evidence:** The single `note` field serves return, client changes, reopen and cancel, validated at 2000 characters, and is stored as `cancel_reason`. F06 data table: "`cancelled_at`, `cancel_reason` … set when cancelled (reason 1–500 chars)". The project cancel path caps at 500 (`projects.ts:178`) and passes it to every cancelled task, so the two paths disagree.
- **Impact:** Longer cancel reasons than the spec allows; the UI may truncate or overflow where it assumes 500.
- **Suggested fix:** In `TaskWorkflowService.changeStatus`, refuse a `cancel` note over 500 characters (400), or add a `superRefine` in `taskStatusChangeSchema` keyed on `status === 'cancelled'`. Contract unit test for 501 characters.

### BE-11 — Two comments at once can create two unread `task_commented` rows instead of merging

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/api/src/modules/notifications/notification-center.ts:102-131`
- **Evidence:** `mergeComment` does `select … where recipient, type, subject, read_at is null limit 1 for update`; when no row exists yet, nothing is locked, so two concurrent comments on the same task (by different authors) both insert. F14 rule 5: a new `task_commented` "updates that one instead"; there is no unique index to enforce it.
- **Impact:** Occasionally two bell entries for one task; cosmetic.
- **Suggested fix:** Either a partial unique index `(recipient_id, subject_id) where type = 'task_commented' and read_at is null` with `on conflict … do update set count = count + 1`, or accept and document. Test: two parallel comments → one notification with `count = 2`.

### BE-12 — Business constants duplicated outside `packages/contracts`

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/tasks/task-sql.ts:10-12` (own `3 * 60 * 60 * 1000` offset); `apps/api/src/modules/projects/retainer-renewals.ts:110-111` (`const RENEWAL_NOTICE_DAYS = 30`) vs `packages/contracts/src/retainers.ts:191` (exported `RENEWAL_NOTICE_DAYS`) and `packages/contracts/src/dates.ts:9`
- **Evidence:** The business UTC offset and the 30-day renewal window each exist twice. `packages/contracts/CLAUDE.md`: "Never define the same shape twice"; ADR 0015 puts shared rules in one pure function in contracts.
- **Impact:** A later change (renewal window, time zone) updates one copy and the list filter, badge and reminder disagree.
- **Suggested fix:** Import `RENEWAL_NOTICE_DAYS` from contracts in `retainer-renewals.ts`; export a `businessTimeOfDay(now)` helper from `dates.ts` and use it in `task-sql.ts`.

### BE-13 — Business time zone is a fixed UTC+3 offset, not `Asia/Damascus`

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `packages/contracts/src/dates.ts:8-14`, `packages/contracts/src/dates.ts:88-91`; cron jobs use `tz: 'Asia/Damascus'` (`packages/contracts/src/jobs.ts:106`, `:116`)
- **Evidence:** `businessDate` adds a fixed 3 hours ("Syria keeps UTC+3 all year (no daylight saving since 2022)"), while pg-boss schedules use the IANA zone. Today both agree.
- **Impact:** None now. If Syria reintroduces DST, the cron would follow the tz database while `businessDate` would not, so the 00:05 cycle job could compute the previous day. Month boundaries (`firstOfMonth`, `lastOfMonth`) are correct for the stored date strings.
- **Suggested fix:** Keep as is, or compute with `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Damascus' })`; the existing `dates.test.ts` edge tests would guard either.

### BE-14 — Money columns of milestones and extra work have no currency column of their own

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `packages/db/src/schema/projects.ts:81-82` (`installment_minor`), `packages/db/src/schema/retainers.ts:280-281` (`estimate_minor`)
- **Evidence:** ADR 0013/`packages/db/CLAUDE.md`: money is `<name>_minor` "next to a currency column". These amounts take the currency of their project or retainer (spec F05 design), protected by `CURRENCY_LOCKED` (`projects.service.ts:623-655`, `retainers.service.ts:588-607`), which is checked under the project/retainer row lock, so the pairing is safe today.
- **Impact:** None now; F13 invoices and reports must always join the parent for the currency. Worth an explicit note in ADR 0006/0013 so F13 does not assume a sibling column.
- **Suggested fix:** Document the exception, or add a denormalized `currency` column when F13 starts reading these amounts.

## Strengths

- State machines live as pure functions in contracts (`taskMove`, `canMakeTaskMove`, `canChangeProjectStatus`, `canChangeRetainerStatus`, `isLineBehind`, `deliveryRate`, `planTemplateRun`) and the services re-check each move under a row lock (`readableTask(..., { forUpdate: true })`), which gives F06 edge case 1 for free.
- Every state change reviewed writes its audit entry in the same transaction, including the system paths (cycle open/close with a null actor, generated tasks with `templateRunId`, project-cancel cascades per task, extra work created for tasks).
- Idempotency is structural, not procedural: `retainer_cycles (retainer_id, month)` unique + `onConflictDoNothing`, `template_runs_one_full_run_idx`, and `notification_reminders` primary key with insert-then-notify; closing only touches `status = 'open'` cycles.
- Lock discipline is documented and followed: the global `lockAccessChanges` advisory lock is always taken before row locks, and cycle/retainer writers share the retainer row lock with the daily job.
- Schema constraints back the rules: check constraints for engagement links, client-request fields, cancel fields, revision decisions and template step timing; every foreign key is indexed; no `ON DELETE CASCADE` on business tables; money is `bigint` minor units with non-negative checks.
- Module boundaries hold: `projects` never imports `tasks` or `templates` (registries `WorkProgress`, `CycleOpenedHooks`), `notifications` never reads emitters' tables and keeps a data snapshot.
- Lists use `page`/`pageSize` (max 100) with totals; list presenters batch lookups (`present` loads people, clients, engagements, counts in one round), so no N+1 on list endpoints.

## Open questions

- BE-04: may tasks of a `completed` or `cancelled` project be reopened (delivered → revisions/in progress, cancelled → in progress/new) while the project stays closed, or must the project be reopened first? The F05 rule 7 "read-only" list names milestones and extra work, not tasks. Not in `docs/open-questions.md`.
- BE-01: when an out-of-scope request moves to another engagement, should its unbilled extra work item move with it (archive + recreate), or should the edit be refused until the scope is switched to in-scope? Not in `docs/open-questions.md`.
- BE-02: may the pre-fix `task.created` audit rows that contain full URLs be rewritten once by a custom migration, given that audit entries are append-only?
