# Backend and data correctness

## Scope and revision

Read-only review for the Phase 1 deployment, dated 2026-09-30 (Asia/Damascus), at `9463f9f4366c133ec55bfa577c1fa08605581554` on `docs/phase-1-audit`. Scope: Phase 0 infrastructure and F01, F02, F05, F06, F07 and F14 in-app notifications. This reviewer wrote only this report. No application changes, database queries, migrations, integration tests, jobs, accounts or business mutations were executed.

Findings: **1 High, 6 Medium, 0 Critical, 0 Low**. All use static evidence; an in-memory probe of authored contract code additionally confirms the negative-count contract mismatch and the dependency helper's precommit decisions. Database interleavings and HTTP consequences were not reproduced.

## Findings

### DATA-001 — A valid negative adjustment can freeze a negative delivery count and break cycle history
- Severity: High
- Confidence: static evidence
- Location: `apps/api/src/modules/projects/retainer-cycles.service.ts:257`; additional locations: `apps/api/src/modules/projects/retainer-cycles.service.ts:474`, `apps/api/src/modules/projects/retainer-cycles.service.ts:531`, `apps/api/src/modules/projects/retainer-cycles.service.ts:593`, `packages/contracts/src/retainers.ts:231`, `packages/db/src/schema/retainers.ts:137`, `apps/api/src/modules/tasks/task-workflow.service.ts:127`.
- Requirement: F05 retainer rules R7–R9 and R13; ADR 0015; F06 rule 14 permits reopening delivered tasks and removes them from live counts; the cycle response requires nonnegative `delivered`.
- Evidence: Start with one delivered task on a cycle line. A `delta: -1` adjustment passes the check because `before + delta` is zero. Reopen or archive that task before closing the cycle: task counts now contribute zero while the append-only adjustment remains -1. `liveDelivered` returns -1. Open-cycle presentation clamps this to zero, but `close` saves the raw value to `deliveredAtClose`, and closed-cycle presentation returns that frozen -1. The schema/migration has no nonnegative check on the frozen field. The in-memory probe below verified that the authored `cycleLineSchema.shape.delivered` rejects -1. Cycle list/detail routes serialize with the cycle schemas (`apps/api/src/modules/projects/retainer-cycles.controller.ts:43`, `apps/api/src/modules/projects/retainer-cycles.controller.ts:58`); the global serializer is registered at `apps/api/src/app.module.ts:49`.
- Impact: Ordinary permitted actions can permanently store an invalid frozen month. The cycle history/detail response violates its contract, and the delivery rate may also become negative. Closed cycles reject subsequent adjustments, so users cannot repair the month through its normal API. This breaks the core retained monthly delivery record.
- Suggested fix: Freeze the same nonnegative delivery value used for presentation, and enforce that invariant at the database boundary through a new migration. Preserve the existing adjustment history; evaluate existing negative frozen values before any separately authorized repair.
- Verification: Integration regression: deliver one task, adjust -1, reopen or archive it, close the cycle, then require valid nonnegative cycle list/detail responses and a stable frozen delivery rate; also retain existing post-close delivery tests.

### DATA-002 — Concurrent dependency edits can commit a cycle across different tasks
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/tasks/task-workflow.service.ts:242`; additional locations: `apps/api/src/modules/tasks/task-workflow.service.ts:251`, `apps/api/src/modules/tasks/task-dependencies.ts:131`, `apps/api/src/modules/tasks/task-dependencies.ts:168`, `packages/db/src/schema/tasks.ts:121`.
- Requirement: F06 rule 4 and edge case 2: a dependency change must never create a cycle; ADR 0016.
- Evidence: `setDependencies` locks only the task being edited. Its recursive reachability query performs ordinary reads, and the link table enforces only the composite key and the self-edge check. Use four same-client tasks with existing edges C→B and D→A. Concurrent transactions lock A and B respectively, then check additions A→C and B→D before either new edge commits. Each check sees an acyclic graph and succeeds. Their new FK references are A/C and B/D, so this example does not require either insert to acquire a conflicting key-share lock on the other transaction's locked target. Both commits produce A→C→B→D→A. The in-memory probe confirmed both precommit helper checks return false and the committed graph contains a cycle. The simpler reciprocal A→B/B→A case is deliberately not used: opposite FK key-share locks can conflict with `FOR UPDATE` and abort a writer.
- Impact: Tasks can become mutually blocked and never open through ordinary dependency completion. The manager must repair dependencies or override the block. Recursive checks do not provide concurrency safety on their own.
- Suggested fix: Serialize graph-changing operations under a shared transaction lock, including edits that change a linked task's client, or use serializable transactions with explicit retries. Apply a consistent lock order across all graph writers.
- Verification: A controlled two-transaction regression for the four-node interleaving must allow at most one conflicting addition and return a coded cycle rejection/retry outcome for the other; also test concurrent client changes with dependency edits.

### DATA-003 — Changing an out-of-scope task's engagement leaves its extra work on the old owner
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/tasks/tasks.service.ts:474`; additional locations: `apps/api/src/modules/tasks/tasks.service.ts:565`, `apps/api/src/modules/tasks/tasks.service.ts:583`, `packages/db/src/schema/tasks.ts:96`, `packages/db/src/schema/tasks.ts:110`.
- Requirement: F06 rule 11: an out-of-scope client request requires an engagement and logs its extra work on that project or retainer; ADR 0016.
- Evidence: Create an out-of-scope request on project P without a milestone. PATCH with `projectId: null`, leaving the client and `requestScope` unchanged. The merged link shape permits a client task without an engagement, and `assertLinks` checks only nonnull changed links. Extra-work reconciliation runs only when `scopeGiven` is true, so this update keeps `requestScope: out_of_scope` and the original `extraWorkItemId`, while dropping the engagement. Likewise, changing to another valid project Q of the same client leaves the extra work on P. The database checks do not require an out-of-scope request to retain an engagement or match the extra-work owner. These are permitted sequential code paths, not concurrency hypotheses.
- Impact: The task and billing log disagree about which engagement owns the request, and the task can violate `NO_ENGAGEMENT` without changing scope. Later billing/cancellation operates on the old work item.
- Suggested fix: Validate the merged task's out-of-scope engagement invariant on every update. Refuse engagement removal or movement while an existing out-of-scope work item is linked, using a coded error and an explicit existing scope-change path rather than silently moving financial history.
- Verification: PATCH tests must reject clearing/moving the engagement of an out-of-scope request while preserving the task and original extra work atomically; cover unbilled, billed and waived items and normal in-scope task movement.

### DATA-004 — Reopening or restoring a task can recreate open work assigned to an archived user
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/tasks/task-workflow.service.ts:77`; additional locations: `apps/api/src/modules/tasks/task-workflow.service.ts:129`, `apps/api/src/modules/tasks/task-workflow.service.ts:353`, `apps/api/src/modules/tasks/tasks.service.ts:648`, `apps/api/src/modules/tasks/task-hooks.service.ts:44`, `apps/api/src/modules/auth/users.service.ts:256`.
- Requirement: F06 rule 6 requires a non-archived assignee; F06 changes to F01 and edge case 4 refuse user archiving while assigned open tasks exist. Department departures are explicitly allowed and are not this finding.
- Evidence: Deliver or cancel a user's only task, or archive their open task; the responsibility source excludes delivered/cancelled or archived tasks, allowing the user to be archived. Reopen the closed task as a manager, or restore the archived open task as a scope-all manager. Neither path acquires `lockAccessChanges` or checks the stored assignee's archive state; it preserves their id and creates live open work. A cancelled task with a nonnull archived assignee even reopens directly into `in_progress`. The same missing shared lock also permits races with user archiving, but no race is needed for the sequential example.
- Impact: An archived employee cannot sign in or receive notifications, yet receives an open assignment again. The task remains assigned instead of entering the department queue and is excluded from workloads built from active members.
- Suggested fix: Before a reopen/restore makes a task live and open, acquire the existing access-change lock before the task row lock and reject an archived assignee with `INVALID_ASSIGNEE`, requiring reassignment. Preserve the documented behavior for a non-archived assignee who merely left the department.
- Verification: Cover delivered, cancelled and archived-open tasks after user archiving; ensure the operation cannot recreate an inaccessible assignment and include an archive/reopen concurrency regression.

### DATA-005 — Two first comments can create separate unread notifications instead of merging
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/notifications/notification-center.ts:121`; additional locations: `apps/api/src/modules/notifications/notification-center.ts:72`, `apps/api/src/modules/tasks/task-comments.service.ts:72`, `apps/api/src/modules/tasks/task-comments.service.ts:174`, `packages/db/src/schema/notifications.ts:67`.
- Requirement: F14 rule 5: unread comments for one recipient and task merge into one row with `count + 1`.
- Evidence: Comment creation loads the task without `forUpdate`. Two users can therefore create comments on the same task concurrently; their comment FK key-share locks are compatible. If no unread comment notification exists, both `mergeComment` queries can return no row, so `FOR UPDATE` locks nothing. Both callers insert a new notification. There is no partial unique constraint for the unread recipient/task/comment key. Existing tests (`apps/api/test/notifications.test.ts:302`, `apps/api/test/notification-events.test.ts:365`) verify sequential merging, not this empty-row race. No concurrent database probe was run.
- Impact: The bell shows duplicate unread comment rows and counts separate notifications instead of the required merged comment count; subsequent comments choose an arbitrary matching row.
- Suggested fix: Serialize comment merging per recipient/task, or enforce the unread merge key with a partial unique index and atomic conflict-aware update. Coordinate that constraint with marking rows unread again.
- Verification: Concurrently create two first comments for the same assignee/task and assert exactly one unread comment notification with count 2 and a valid latest snapshot; test concurrent read/unread actions too.

### DATA-006 — Daily task reminders use a stale task snapshot when committing the reminder
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/tasks/task-reminders.ts:104`; additional locations: `apps/api/src/modules/tasks/task-reminders.ts:119`, `apps/api/src/modules/tasks/task-reminders.ts:122`, `apps/api/src/modules/notifications/daily-reminders.ts:94`.
- Requirement: F14 rules 9–11 and edge case 4: only open, live tasks receive reminders; finished/cancelled tasks do not escalate. Worker rules require fresh record state when doing scheduled work.
- Evidence: `open` selects matching ids and loads task snapshots outside the per-reminder transaction. `send` then builds a notice and an occurrence key from those snapshots before entering the transaction. `remindOnce` only inserts the idempotency key and sends the supplied notice; it never reloads or locks the task. An earlier item can delay the loop while a later selected task is delivered/cancelled/archived or its due date/assignee changes. That later task still receives the old reminder/escalation, and the stale occurrence is recorded as sent. The renewal source uses a similar outside-transaction snapshot pattern (`apps/api/src/modules/projects/retainer-renewals.ts:38`).
- Impact: Staff or department managers can receive an actionable overdue/escalation notice after the work is finished, or a due-date notice for an obsolete assignment. Idempotency prevents duplicates but does not validate eligibility.
- Suggested fix: Re-read each subject and its eligibility inside the reminder transaction under a lock that coordinates with status/date/assignment writers, then derive recipients, occurrence and snapshot from that state before inserting the reminder key.
- Verification: Pause a reminder batch after candidate collection, finish/re-date/reassign a later task, resume, and assert no stale notification or obsolete reminder key. Retain rerun and work-week timing tests.

### DATA-007 — A template run can read stages and steps from different saved revisions
- Severity: Medium
- Confidence: static evidence
- Location: `apps/api/src/modules/templates/templates.service.ts:322`; additional locations: `apps/api/src/modules/templates/templates.service.ts:334`, `apps/api/src/modules/templates/templates.service.ts:343`, `apps/api/src/modules/templates/templates.service.ts:438`, `apps/api/src/modules/templates/template-runs.service.ts:193`, `packages/contracts/src/templates.ts:566`.
- Requirement: F07 project stage mapping (rule 13), rules 1–2 for a valid template document, and the all-or-nothing run; ADR 0017.
- Evidence: `forRun` separately reads the parent, stages, steps/dependencies and assignees without locking the parent or choosing a consistent snapshot. Template updates lock the parent and replace child rows, but ordinary reads do not wait for that lock. With the application's ordinary transaction configuration, a run can read old stage S1, then an editor commits a replacement stage S2 and its new step, then the run reads the new step pointing at S2. `planTemplateRun` silently resolves the absent stage in its old stage map to `milestone: null`. Its stage scan creates no milestone for S2, so the resulting task loses the requested stage grouping. A transaction around the run's writes does not make these earlier multi-statement reads one revision. No database timing reproduction was run.
- Impact: A valid template saved by one user can generate incomplete milestone links when another applies it concurrently. Defaults, step dependencies and archive state can also be read from different revisions.
- Suggested fix: Load the whole template under a transaction-scoped shared parent-row lock used consistently by template editors/archivers, or use a deliberate snapshot isolation strategy. Preserve a consistent lock order with run target and access locks.
- Verification: A controlled edit/apply test must produce either the entire old document or the entire new one, never a task whose template stage disappeared from the run's stage map; test both preview and apply.

## Coverage

| Area | Reviewed paths and depth |
|---|---|
| Rules and business requirements | Read API, worker, contracts and db `CLAUDE.md`; README boundaries; ADRs 0005, 0006, 0008, 0013–0018; relevant F01/F02/F05/F06/F07/F14 rules, data and edge cases; Phase 1 roadmap, architecture, feature sections of V1 scope and open questions. |
| F01 users/departments | Traced create/update/archive/restore, role and membership changes, department manager validation, responsibility registry, password-link lifecycle, the common access-change lock and downstream directories. Security/authentication details are primarily owned by `security-access.md`. |
| F02 clients | Traced basics/status/account manager, archive/restore, contacts, platforms and communication notes; checked parent/child association and authored transaction/audit paths, live-client filters and exported directory calls. |
| F05 engagements | Traced project complete/cancel hooks, manager validity, milestone completion/order/archive, money visibility/edit checks, currency locking and extra work; retainer changes, cycle generation/closing, line snapshots, adjustments, delivery calculations and history. |
| F06 tasks | Traced manual creation/update/archive/restore, link validation, assignments, statuses, dependencies, revision numbering/decisions, extra work, checklist/link/comment services and hooks into projects and user archiving; inspected board/workload/summary and shared SQL flags. |
| F07 templates | Traced document replacement, default validation/fallback, run preview/apply, milestone mapping, atomic task generator, cycle hook, missing generation, full-run uniqueness and run history; inspected pure planning/dates and shared schemas. |
| F14 notifications | Traced notification selection, snapshot validation, first-match/muting, merge behavior, own-row reads/read state, reminder key insertion, daily sources, escalation, renewal and retention; SSE security/browser behavior is covered by the other areas. |
| Schema/migrations | Enumerated authored schema and `.sql` migrations 0000–0011; structurally reviewed table definitions/constraints/indexes and seed statements, with focused reads of task, cycle, template and notification migrations. No migration metadata or deployed-schema comparison. |
| Worker/infrastructure | Inspected pg-boss initialization, worker heartbeat upsert, durable shared queue/cron/tz declarations, API handler registration and shutdown; the worker schedules business handlers that run in the API, as ADR 0008 requires. No runtime job execution. |
| Tests | Inspected relevant task dependency/status/revision, retainer-cycle and notification tests to distinguish tested sequential paths from uncovered interleavings. Integration tests were not run. Suite-wide execution/coverage is owned by `tests-ci.md`. |

Positive static observations: business mutation paths reviewed generally use transactions with `recordAudit(tx, ...)`; delivered cycle counts freeze separately from later deliveries; cycle uniqueness is enforced by `retainer_cycles_retainer_month_idx`; full cycle runs have a partial unique index; task generation and its audit/notifications use the calling transaction; reminder insertion uses `onConflictDoNothing`; money inputs use safe integer minor units and supported currency schemas; date/time contracts separate calendar dates from Damascus times. These observations are not runtime certification.

## Checks and observations

- `git rev-parse HEAD`: exit 0, revision above.
- `git status --short`: exit 0; the shared audit directory was untracked during this area review. Git printed a warning about an inaccessible user-global ignore file. The coordinator captured the initially clean tracked checkout and owns the final whole-workspace comparison.
- `rg --files docs/specs docs/decisions apps/api/src apps/worker/src packages/contracts/src packages/db/src packages/db/migrations`: used for authored-file inventory. Migration metadata names appeared in the initial inventory; their contents were never read. Focused searches used `-g '*.sql'` for migration contents and avoided generated outputs.
- Focused `rg -n` and `Get-Content` ranges: traced and verified the cited lines; all reads were in this project. Initial Windows wildcard-path searches returned `os error 123`; subsequent searches used directories with `-g` filters. These were navigation failures, not failed application checks.
- `node -e $auditProbe`: exit 0. The exact PowerShell probe is below. It evaluates authored contract modules in memory using the installed TypeScript/Zod dependencies and writes no files. It tests the actual response-field schema and cycle helper, not the HTTP/database service flow.

```powershell
$auditProbe = @'
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('./packages/contracts/node_modules/typescript');
const cache = new Map();
function authored(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const local = createRequire(file);
  const load = (name) => name.startsWith('.') ? authored(path.resolve(path.dirname(file), name.replace(/\.js$/, '.ts'))) : local(name);
  new Function('require','module','exports', js)(load, module, module.exports);
  return module.exports;
}
const {cycleLineSchema} = authored('packages/contracts/src/retainers.ts');
const {createsDependencyCycle} = authored('packages/contracts/src/tasks.ts');
const adjustment = -1;
const before = 1 + adjustment;
const afterReopen = 0 + adjustment;
console.log(JSON.stringify({counter:{validBefore:before,rawAfterReopen:afterReopen,openDisplay:Math.max(0,afterReopen),closedContractAccepts:cycleLineSchema.shape.delivered.safeParse(afterReopen).success}}));
const initial = new Map([['C',['B']],['D',['A']]]);
const committed = new Map([...initial, ['A',['C']], ['B',['D']]]);
console.log(JSON.stringify({dependencies:{aCheckBefore:createsDependencyCycle('A',['C'],initial),bCheckBefore:createsDependencyCycle('B',['D'],initial),cycleAfterBoth:createsDependencyCycle('A',['C'],committed)}}));
'@;
node -e $auditProbe
```

Output: counter `{ validBefore: 0, rawAfterReopen: -1, openDisplay: 0, closedContractAccepts: false }`; dependencies `{ aCheckBefore: false, bCheckBefore: false, cycleAfterBoth: true }`.

## Limitations and unverified items

- No live/test/production database was queried. Data already stored, migration application order/state, PostgreSQL isolation configuration and precise concurrent API timings remain unverified. Controlled integration regressions require a separately authorized disposable test database because the ordinary test setup migrates and writes it.
- No pg-boss job was started, run, retried or simulated through the business services. Durable scheduling, catch-up after downtime, production retention volume and LISTEN delivery need later operational verification. No typecheck/build/lint pass is claimed by this area; see the coordinator and tests/CI report for actual checks.
- The in-memory probe deliberately supplies arithmetic/graph scenarios; it confirms contract/helper outcomes but does not substitute for the later service regressions described above.
- Some cross-module progress counts use the global database handle even when a caller has a transaction (`apps/api/src/modules/projects/work-progress.ts:48`, `apps/api/src/modules/tasks/task-hooks.service.ts:55`). This matters for future compound changes and snapshot consistency; no additional demonstrated corruption is counted beyond DATA-001.
- Renewal reminders select unarchived retainers but do not filter archived parent clients (`apps/api/src/modules/projects/retainer-renewals.ts:40`). F05 G2 explicitly suppresses the cycle job on archived clients, while F14 rule 12 does not explicitly state a parent-client reminder rule. Treat that as a policy clarification/follow-up, not a confirmed finding or an invented owner decision.
- Link snapshots written by task creation were forwarded for reconciliation with the security reviewer. Their confidentiality implications belong to `security-access.md` and are not counted again here.
- Future features such as invoices, exchange-rate conversion, client approval links, medical review, email/digest and delivery publishing were not treated as missing Phase 1 functionality. Existing owner decisions in `docs/open-questions.md` remain unresolved.

## Deploy implications

DATA-001 blocks deployment under the audit's High-severity rule until fixed and regression-tested or explicitly accepted by the owner. The six Medium findings need pilot triage, especially dependency integrity, extra-work ownership and inactive assignments. This read-only audit performed no remediation and gives no authorization to deploy. Verification of fixes should use the focused regressions above followed by the repository's required checks; runtime proof of the flagged interleavings remains outstanding.
