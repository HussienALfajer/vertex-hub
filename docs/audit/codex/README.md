# Phase 1 pre-deploy audit

Date: 2026-09-30 (Asia/Damascus). Target: the current `docs/phase-1-audit` checkout, including Phase 0 foundations and completed Phase 1 features F01, F02, F05, F06, F07 and F14 in-app notifications. This is a codebase audit, not permission to deploy or a certification of production readiness.

## Goal and boundaries

Review the whole authored codebase, shared packages, local tooling, tests, CI and deployment configuration against `AGENTS.md`, folder `CLAUDE.md` rules, relevant specs, ADRs, `docs/architecture.md`, `docs/ROADMAP.md` and `docs/open-questions.md`. Future-phase functionality is not a missing Phase 1 feature. Unresolved owner decisions remain unresolved.

Only this directory's Markdown reports and the audit checklist in root `TASKS.md` may change. Do not fix code, change dependencies, regenerate files, migrate databases, create accounts, seed records, run scheduled jobs, submit business mutations, send messages, open a PR, publish, or access the production server. Do not read other projects, secret files, lockfiles, generated client/router files, migration metadata, `dist/` or `.turbo/`. Redact sensitive values discovered accidentally.

Prefer static inspection and safe checks that do not mutate the checkout or databases. Inspect test setup before execution; ordinary integration tests migrate and write to a test database and are therefore excluded here. Browser navigation must use an already available local app and session where possible. Do not start the API or worker without establishing that background jobs cannot write. A mocked browser run may inspect UI behavior, but is not a live backend walkthrough. Record environmental limitations instead of treating an unexecuted check as passed.

## Six independent review areas

| Area and report | Ownership and review questions |
|---|---|
| [Security and access](security-access.md) | Authentication, sessions, 2FA, guards, role/department/client scopes on every route and object, notification privacy/SSE, input abuse, logs and secrets handling, dependency declarations, nginx and deploy hardening. Inspect API, contracts, web auth and deployment boundaries. |
| [Backend and data correctness](backend-data.md) | API modules, contracts, database schema and authored SQL migrations, worker jobs: validation, transaction/audit atomicity, concurrency, archive rules, money/dates, cycle generation, task workflow/dependencies/revisions, template idempotency and notifications/reminders. Trace cross-module interactions against feature specs. |
| [Web code quality](web-quality.md) | Every authored web feature and route, API/query handling, cache invalidation, forms and shared validation, permission presentation, loading/empty/error states, URL filters, pagination, SSE lifecycle, types and module conventions. Review UI package interactions without duplicating the visual review. |
| [UI/UX and design](ui-ux-design.md) | Brand identity and UI tokens/components; Arabic copy, RTL/logical CSS, numbers and Damascus dates, keyboard and screen-reader access, responsive layouts, forms, dialogs, action clarity, task/retainer/template/notification flows and both themes. Separate static concerns from observed browser behavior. |
| [Tests and CI](tests-ci.md) | All authored unit/integration/E2E tests, fixtures, architecture/conventions enforcement, CI, scripts, toolchain and deployment checks. Assess coverage, role/scope negatives, concurrency and rollback, test isolation, mocked E2E limitations, drift checks and build/deploy reproducibility. Run only demonstrably safe checks. |
| [End-to-end browser walkthrough](browser-walkthrough.md) | Inventory the local browser/runtime, then traverse all reachable Phase 1 screens and roles: auth → users/departments → client → project/retainer/cycle → tasks/workflow → templates → notifications → audit. Inspect existing records and unsaved forms; never submit changes or mark notifications read. Verify RTL, errors and responsive behavior through the browser where possible. List each attempted step, observed outcome, evidence and blockers. |

Each area is assigned to a separate read-only subagent with exclusive ownership of its report. The environment permits three subagents at once, so six reviews are dispatched in two overlapping waves as slots become available. Reviewers may read overlapping sources but must not edit each other's reports. The coordinator reconciles duplicates and updates this index and `TASKS.md` only.

## Method

1. Capture the checkout revision and initial dirty state; enumerate authored files before focused reads.
2. Read local rules and relevant specification/ADR sections, then trace implementation paths across layers.
3. Investigate suspected defects through callers, shared contracts and tests. Confirm file line numbers in this checkout. Distinguish a demonstrated defect from a hypothesis or missing evidence.
4. Run safe read-only checks where available and record exact commands, exit status and results. Browser reports distinguish a live API, mocks and static inspection.
5. Write findings in the common format below, followed by coverage, checks and explicit limitations. No remediation is performed.
6. Reconcile all reports, verify report links and finding format, check the documentation diff, and confirm that application code is unchanged.

## Severity and evidence

- **Critical:** demonstrated unauthenticated compromise, broad privileged access or destructive data loss; blocks deploy.
- **High:** reproducible permission bypass, serious corruption or broken core Phase 1 flow; blocks deploy until resolved or explicitly accepted by the owner.
- **Medium:** bounded correctness, reliability, accessibility or usability defect; assess before the pilot.
- **Low:** localized maintainability, copy or polish issue with limited operational impact.

Severity describes impact; confidence describes evidence. Use `confirmed`, `static evidence` or `needs runtime confirmation`. A blocker or untested assumption is not automatically a defect. Do not inflate severity for future-phase omissions or unresolved owner decisions.

Every finding uses this exact structure:

```markdown
### <AREA>-001 — <concrete problem>
- Severity: Critical | High | Medium | Low
- Confidence: confirmed | static evidence | needs runtime confirmation
- Location: `repository/path.ts:123` (additional locations if needed)
- Requirement: spec/ADR/rule and its relevant section
- Evidence: observed behavior, command result or precise code trace; never a bare assertion
- Impact: affected role, record or user flow and the failure condition
- Suggested fix: the smallest specific remediation; no implementation in this audit
- Verification: a focused acceptance step or regression check for a later fix
```

Prefixes: `SEC`, `DATA`, `WEB`, `UX`, `CI`, `E2E`. Report uncertain risks in a separate limitations/follow-ups section unless there is sufficient evidence of a defect. Cross-reference duplicate findings rather than counting them twice. If no supported findings exist, say so and retain coverage/limitations; never invent findings to fill a report.

## Required report structure

Each report contains: scope and revision; findings; coverage (reviewed paths/features and depth); checks/observations (exact commands or browser actions and outcomes); limitations and unverified items; deploy implications. Tests passing do not prove business completeness. A browser or database blocker must name where the reviewer looked and what is needed to complete verification.

## Execution and consolidated results

Status: all six area reports completed and reconciled by six separate subagents, dispatched in overlapping waves of three. Target revision: `9463f9f4366c133ec55bfa577c1fa08605581554`. The checkout was initially clean and already on `docs/phase-1-audit`; no branch, commit or PR was created by this audit. Application code remains unchanged. Root `TASKS.md` is intentionally git-ignored and holds the local checklist.

| Report | Critical | High | Medium | Low | Evidence and limits |
|---|---:|---:|---:|---:|---|
| [Security and access](security-access.md) | 0 | 1 | 3 | 0 | Static access/deploy/audit traces; pure redirect probe. Production and live security negatives untested. |
| [Backend and data correctness](backend-data.md) | 0 | 1 | 6 | 0 | Static cross-module traces; pure contract/graph probes. Database interleavings and HTTP serializer outcomes untested. |
| [Web code quality](web-quality.md) | 0 | 1 | 4 | 1 | Static UI/query traces, pure mention/cache probes, direct web unit/type checks. Cross-user live reproduction untested. |
| [UI/UX and design](ui-ux-design.md) | 0 | 0 | 2 | 1 | Static brand/accessibility review and live shorter-phone dialog/navigation defects. Populated lifecycle screens unavailable. |
| [Tests and CI](tests-ci.md) | 0 | 0 | 1 | 0 | All 60 authored suite files reviewed; safe checks executed. PM2 rollback failure traced statically; no deployment run. |
| [End-to-end browser walkthrough](browser-walkthrough.md) | 0 | 0 | 0 | 0 | Partial live GM navigation, RTL, mobile and both themes. Missing records/role sessions and no-write boundary prevent full lifecycle acceptance. |
| **Unique findings** | **0** | **3** | **16** | **2** | **21 total; unverified follow-ups are not included in the count.** |

### Deploy blockers and triage

Under the severity policy above, resolve or explicitly assess these three High findings before deployment:

- **SEC-001:** pre-migration `pg_dump` receives the credential-bearing database URI in argv. Shared-host process visibility and reachability remain unverified; code exposure is established.
- **DATA-001:** reversing a delivered task after a valid negative adjustment can freeze a negative cycle count, violating the closed-cycle response contract. The contract mismatch was confirmed in memory; the full service regression remains required.
- **WEB-001:** involuntary session expiry leaves private queries cached across a later identity change. An in-memory observer confirmed the cache mechanism; a live two-user disclosure was not performed.

Also assess **CI-001** before relying on automatic rollback: a PM2 error after switching `current` exits before the health-failure recovery branch. The Medium findings require pilot triage, including graph consistency, extra-work ownership, inactive assignees, notification/template races, task history/mentions/pickers and misleading medical-review copy. The two Low findings concern failure feedback and short-height navigation.

Duplicated observations are counted once: the backend's token-audit observation belongs to SEC-004; the browser's medical-review copy observation belongs to UX-001; usability implications of web pagination/mentions/history remain WEB findings. Missing regression coverage is cross-referenced in tests/CI rather than assigned duplicate defect IDs. During graph review, PostgreSQL foreign-key locking ruled out using a simplistic two-node reciprocal-edit proof; DATA-002 records the four-node interleaving instead. The lock analysis follows the [PostgreSQL 17 row-lock documentation](https://www.postgresql.org/docs/17/explicit-locking.html); the interleaving remains an inference from source, not a database reproduction.

### Verification and remaining evidence

- Direct installed TypeScript checks passed for all seven workspace packages, without emitting or rebuilding dependencies.
- **258 pure/convention tests in 23 files passed.** The other 37 authored suite files were not executed: API, worker and DB integration plus automated browser suites.
- `& ./node_modules/.bin/biome.cmd check --error-on-warnings .` passed, checking 451 files with no fixes. The initial `pnpm lint` attempt failed before lint because the runtime's pnpm wrapper attempted installation and aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; it is not counted as a lint pass. Its newly created store scaffold was removed, and no dependency installation was continued.
- The live local web app and API health responded HTTP 200. The existing GM session covered reachable lists, unsaved forms, users/departments/client detail, seed templates, empty notifications, audit and error paths. Browser screenshots were inspected in tool output; no screenshot files or business writes were produced.
- Documentation validation checks all six reports, their eight finding fields, unique IDs/severity counts, local links, file:line bounds and whitespace. The final tracked diff is empty; new visible work is confined to the seven Markdown audit documents. Exact package commands and results are recorded in [tests-ci.md](tests-ci.md).

Direct checks rely on existing dependency/build interfaces and do not establish a fresh install/build, migration/OpenAPI drift or current remote CI status. The live app's running revision was not independently proven. Before deploy, run an authorized disposable-database integration/clean CI pass and populated multi-role local acceptance, including workflow changes, cycle closing, notifications and failure/recovery paths. Do not turn missing evidence into a pass.

Q4 off-server backups/restore and the other unresolved owner questions remain as recorded in `docs/open-questions.md`; this audit does not decide them. No feature shipped and no roadmap status changed. Deployment and the 2–3 client pilot remain owner-controlled roadmap steps. This audit grants no permission to access or modify production.
