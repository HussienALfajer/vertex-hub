# Phase 1 pre-deploy audit (Claude)

A read-only audit of the whole Vertex Hub codebase before the Phase 1 production deploy (`docs/ROADMAP.md`, Phase 1: F01, F02, F05, F06, F07, F14 and automations A03, A07, A08).

This audit is independent. It does not read, reuse or compare against any other audit in the repository. Every finding comes from the code, the docs listed under "Sources", the checks run and the browser walkthrough.

## Rules for every auditor

- **Read-only.** No change to source, config, docs, migrations, lockfiles or git state (no commits, branches, stashes, `lint:fix`, `db:generate`). The only file an auditor writes is its own report in this folder. Scratch files go to the session scratchpad, never the repo.
- **Independence.** Never open anything under `docs/audit/` except this README and your own report. Do not read other `vertex-*` folders on the machine.
- **No production.** Do not SSH to the server, run deploy scripts, or send requests to the production domain. `deploy/` and `docs/deployment.md` are read as files only.
- **Secrets.** Do not print the contents of `.env` or any secret value in a report. Say which key is affected, not its value.
- **Local data only.** The walkthrough may create records in the local development database. Test credentials are generated locally and never written to the repo or the report.
- **Evidence, not opinion.** Every finding cites `path:line` (or a URL + steps for the walkthrough) and quotes the code, command output or observed behaviour that proves it. Mark anything not confirmed as `Likely` and say what was checked.
- **Context economy.** Search first, read ranges. Never read generated or lock files (`pnpm-lock.yaml`, `packages/db/migrations/meta/`, `routeTree.gen.ts`, `schema.gen.ts`, `dist/`, `.turbo/`).

## Sources to judge against

`AGENTS.md`, each folder's `CLAUDE.md` (`apps/api`, `apps/web`, `apps/worker`, `packages/{contracts,db,ui}`, `deploy`), `docs/decisions/` (ADR 0013 is the code shape; 0006 money, 0007/0014 roles and permissions, 0008 jobs, 0015 retainers, 0016 tasks, 0017 templates, 0018 notifications), `docs/specs/F01…F14`, `docs/product/v1-scope.md` (Phase 1 sections), `docs/architecture.md`, `docs/deployment.md`, `brand/identity.md`, `docs/open-questions.md`.

## Areas

| # | Area | Report | ID prefix | Scope |
|---|---|---|---|---|
| 1 | Security and access | `security.md` | `SEC` | Better Auth setup (sessions, cookies, CSRF/origin, rate limiting, password rules, user creation), every route's permission and access declaration against the permission map (ADR 0014, F01), object-level access (IDOR: can a user read or change a record outside their department or assignment where the spec forbids it), input validation on every endpoint, SSE stream auth, CORS, security headers, error leakage, logging of secrets or PII, dependency vulnerabilities (`pnpm audit`), secrets in the repo, deploy config (nginx, PM2, env handling, file permissions, backups). |
| 2 | Backend and data correctness | `backend.md` | `BE` | `apps/api`, `apps/worker`, `packages/db`, `packages/contracts`: business rules against each spec and ADR (state machines, transitions, retainer cycles, task workflow and revisions, template runs, notifications and the daily job), transactions and race conditions, audit log on every state change, archive-not-delete, money in minor units, dates and time zone (`Asia/Damascus`), module boundaries, schema constraints and indexes, migration safety, pg-boss job idempotency and retries, N+1 queries and list pagination, error codes. |
| 3 | Web code quality | `web.md` | `WEB` | `apps/web` and `packages/ui` code: route and feature structure against ADR 0013 and `apps/web/CLAUDE.md`, TanStack Query keys, invalidation and cache consistency after mutations, forms using the contract schemas, error handling (`errors.<code>`), loading/empty/error states, permission-based hiding matching the API, SSE client lifecycle, memory leaks, dead code, type safety (`any`, casts, non-null assertions), bundle size and code splitting. |
| 4 | UI/UX and design | `ui-ux.md` | `UX` | Design system use only (no ad-hoc colors, fonts, spacing), `brand/identity.md` compliance, Arabic copy quality and consistency (§9), missing or untranslated i18n keys, RTL correctness (logical CSS, icon direction, number and date formatting), light and dark themes, accessibility (labels, focus, keyboard, contrast, `role="alert"`), responsive layout, consistency of patterns across screens, usability issues in the main flows. Uses code reading plus the committed E2E screenshots where they exist. |
| 5 | Tests and CI | `tests-ci.md` | `TST` | Runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm test:e2e` and reports failures and flakes. Reviews coverage against each spec's rules and edge cases (what is untested), test quality (assertions that cannot fail, over-mocking, E2E fixtures drifting from the real API), architecture tests, the GitHub Actions workflows (required checks, caching, gitleaks, OpenAPI drift check, migration drift), and whether the checks would catch a broken deploy. |
| 6 | End-to-end walkthrough | `e2e-walkthrough.md` | `E2E` | Runs the real app locally (`pnpm dev`: web on :5173, api on :3000, worker) against the local dev database and walks every Phase 1 flow in the built-in browser as real users with different roles: sign-in and sign-out, users and departments, clients (profile, contacts, brand kit, platforms, communication log), projects with milestones and extra work, retainers with monthly cycles, tasks (create, workflow transitions, revisions, checklist, comments with @mentions, board, workload, My tasks), templates (editor, generate on project and cycle), notifications (bell, live stream, page, settings), permission boundaries between roles, both themes, narrow viewport. Reports every bug, broken flow, console error, failed request and confusing step. |

Areas 1–5 are read-only code audits. Area 6 is the only one that runs the dev server; area 5 is the only one that runs the full check suite, and it does not run `pnpm build` or `pnpm dev`, so the two do not overwrite each other's build output.

## Severity

Severity is judged for the Phase 1 production deploy with ~20 internal staff.

| Severity | Meaning |
|---|---|
| **Critical** | Must be fixed before deploy: data loss or corruption, auth bypass, privilege escalation, secret exposure, a core flow that cannot be completed. |
| **High** | Should be fixed before deploy: wrong business result, a user can see or change data the spec forbids, a broken screen or action, a missing audit entry on a state change, a check that hides real failures. |
| **Medium** | Fix soon after deploy: incorrect edge case, poor error handling, missing test for a spec rule, inconsistent UX that confuses users, a convention broken in a way that will spread. |
| **Low** | Polish: minor UX or copy issues, small convention drift, cleanup. |
| **Info** | Observation or suggestion with no defect. |

## Finding format

Each report starts with a header and a summary, then one section per finding, ordered by severity (Critical first).

```markdown
# <Area> audit

- Date: YYYY-MM-DD · Commit: <short sha from `git rev-parse --short HEAD`>
- Scope covered: <what was reviewed>
- Not covered: <what was skipped and why>
- Checks run: <commands and their result, or "none">

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| SEC-01 | High | ... | `apps/api/src/...:42` |

Counts: Critical n · High n · Medium n · Low n · Info n

## Findings

### SEC-01 — <short title>

- **Severity:** High
- **Confidence:** Confirmed | Likely
- **Location:** `path/to/file.ts:42` (more locations on extra lines)
- **Evidence:** the quoted code, command output or observed behaviour (for the walkthrough: URL, role, steps to reproduce, expected vs actual, console or network error), and the rule, spec or ADR it breaks.
- **Impact:** what goes wrong, for whom, and when.
- **Suggested fix:** the concrete change, where it goes, and the test that would guard it.
```

Reports end with a short **Strengths** section (what is done well, so fixes do not undo it) and **Open questions** (anything that needs an owner decision, cross-referenced to `docs/open-questions.md` when relevant).

## Process

1. This README is written first.
2. The six areas run as parallel, read-only subagents with fresh context; each receives this README and writes only its own report.
3. The main session reads the six reports, checks that each follows the format, and gives the owner a consolidated summary: all Critical and High findings, and the recommended fix order before the deploy.
