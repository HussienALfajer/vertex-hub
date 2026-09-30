# Tests and CI audit

- Date: 2026-09-30 · Commit: 9463f9f
- Scope covered: the local check suite (typecheck, lint, unit and integration tests, Playwright E2E); API integration tests (`apps/api/test/*`, 26 files), contracts unit tests (`packages/contracts/src/*.test.ts`), db and ui convention tests, worker tests (`apps/worker/test/worker.test.ts`), web unit tests and E2E specs (`apps/web/e2e/*`, including the mocked API in `fixtures.ts`) against specs F01, F02, F05, F06, F07, F14; `apps/api/test/architecture.test.ts`; `.github/workflows/ci.yml`; the GitHub ruleset on `main` and recent CI runs (read-only `gh api` / `gh run`); `turbo.json`, the Vitest and Playwright configs; the deploy path (`deploy/deploy.sh`, `deploy/bin/vertexhub-healthcheck`, `deploy/ecosystem.config.cjs`, health endpoint, migrate CLI).
- Not covered: `pnpm build` and `pnpm dev` (not run, by the audit rules); the production server (not contacted); a line-by-line check that every one of the 113 routes has its 401, 403 and out-of-scope case (a scripted check found every route requested by at least one API test, and spot checks of 401 blocks in `tasks`, `templates`, `clients`, `users`, `retainer-cycles` and `notifications` were complete; the rest is not proven).
- Checks run (logs in the session scratchpad; `git status --porcelain` identical before and after, only `?? docs/audit/`):
  - `pnpm typecheck --output-logs=errors-only`: exit 0, but `Cached: 9 cached, 9 total ... >>> FULL TURBO` (replayed, see TST-02).
  - `pnpm lint`: exit 0, `Checked 451 files in 248ms. No fixes applied.`
  - `pnpm test --output-logs=errors-only`: exit 0 in 0.5 s, `Cached: 9 cached, 9 total, Time: 71ms >>> FULL TURBO`, so nothing ran. Rerun without the cache and without rebuilding dependencies: `pnpm exec turbo run test --force --only --output-logs=errors-only`: exit 0, `Tasks: 7 successful, 7 total, Cached: 0 cached`, 3m46s.
  - `pnpm test:e2e`: exit 1, `1 failed, 143 passed (2.3m)`: `e2e\f02.spec.ts:7:1 › create a client, then add a contact with final approval`. Rerun of that file once (`pnpm --filter @vertex-hub/web exec playwright test e2e/f02.spec.ts`): exit 0, `7 passed`. Classified as a flake (TST-01).

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| TST-01 | Medium | F02 E2E test is flaky, and CI's retry would hide it | `apps/web/e2e/f02.spec.ts:17` |
| TST-02 | Medium | Turborepo caches DB and clock-dependent tests, so `pnpm test` can report a replayed pass | `turbo.json:15` |
| TST-03 | Medium | Mocked E2E API can drift from the real API, and nothing catches it | `apps/web/e2e/fixtures.ts:642` |
| TST-04 | Medium | Nothing boots the built API and worker or runs the web app against the real API; the deploy health gate ignores the worker | `deploy/deploy.sh:33` |
| TST-05 | Medium | The API's pg-boss consumer path (retainer cycles, daily notifications) is never exercised | `apps/api/src/core/jobs/job-queue.service.ts:29` |
| TST-06 | Medium | Concurrency rules that the specs rely on have no tests | `apps/api/test/users.test.ts:510` |
| TST-07 | Medium | Spec rules and edge cases with no test | `apps/api/test/notifications.test.ts:375` |
| TST-08 | Low | API tests leave rows in the shared test database on every run | `apps/api/test/helpers.ts:126` |
| TST-09 | Low | Architecture test misses several import forms | `apps/api/test/architecture.test.ts:80` |
| TST-10 | Low | Date rules are tested against the real clock, and one assertion recomputes its expected value with the code under test | `apps/api/test/retainer-cycles.test.ts:30` |
| TST-11 | Low | Required checks are not strict, and main-branch CI runs get cancelled | `.github/workflows/ci.yml:11` |
| TST-12 | Low | GitHub Actions pinned by mutable tags | `.github/workflows/ci.yml:38` |
| TST-13 | Info | RTL screenshots are evidence only, never compared | `apps/web/e2e/fixtures.ts:4221` |

Counts: Critical 0 · High 0 · Medium 7 · Low 5 · Info 1

## Findings

### TST-01 — F02 E2E test is flaky, and CI's retry would hide it

- **Severity:** Medium
- **Confidence:** Confirmed (failure and pass on rerun); the root cause is Likely
- **Location:** `apps/web/e2e/f02.spec.ts:17-20`
  `apps/web/playwright.config.ts:8`
- **Evidence:** In the full `pnpm test:e2e` run:
  ```
  x 3 [chromium] › e2e\f02.spec.ts:7:1 › create a client, then add a contact with final approval (11.9s)
  Error: expect(locator).toHaveText(expected) failed
  Locator:  getByRole('heading', { level: 1 })
  Expected: "مخبز السنابل"
  Received: "عميل جديد"
  13 × locator resolved to <h1 ...>عميل جديد</h1>
  ```
  The same file passed on the single rerun (`7 passed (19.5s)`). The test clicks "create" (`f02.spec.ts:17`) and then waits 5 s for the profile heading. It never waits for the combobox choice (`:14-15`) or the POST to be accepted, so under parallel load the form stayed on "New client". The trace was overwritten by the rerun, so the exact cause (a lost option click or an unfinished submit) is not confirmed. `playwright.config.ts:8` sets `retries: process.env.CI ? 1 : 0`. In CI a test that fails once and then passes is reported as "flaky" and the job still passes. Recent CI logs showed no flaky lines (`gh run view <id> --log | grep -ciE "[0-9]+ flaky"` returned 0 for the last 12 runs), so today the flake shows up locally, where agents run `pnpm test:e2e` as the finish-line check.
- **Impact:** Agents and the owner get random red runs on the feature finish-line check, and retrying until green becomes normal. In CI the retry turns real intermittent bugs (for example a double-submit or a lost selection) into green builds.
- **Suggested fix:** In `f02.spec.ts`, check that the account-manager combobox shows the chosen name before submitting. Then wait for the create response (`page.waitForResponse(r => r.url().endsWith('/api/clients') && r.request().method() === 'POST')`) before the heading assertion. Apply the same pattern to other create-then-navigate flows. Set `retries: 0` in CI, or keep 1 and fail the job on flaky results with the `failOnFlakyTests: true` config option (Playwright ≥ 1.52).

### TST-02 — Turborepo caches DB and clock-dependent tests, so `pnpm test` can report a replayed pass

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `turbo.json:15-21`
- **Evidence:**
  ```json
  "test": { "dependsOn": ["^build"] },
  "test:e2e": { "dependsOn": ["build"], "outputs": ["playwright-report/**", "test-results/**"] },
  ```
  `TEST_DATABASE_URL` and `DATABASE_URL` are in `globalPassThroughEnv` (`turbo.json:5`), so they are not part of the hash. Running `pnpm test --output-logs=errors-only` finished in 0.49 s with `Cached: 9 cached, 9 total ... >>> FULL TURBO`, so no test ran. The API suite needs about 3m46s when forced. The API, worker and db suites depend on the database contents and on the wall clock: `businessDate()`, monthly cycles, and "today" in reminders (see TST-10). CI is not affected because it keeps no Turbo cache between runs (no `actions/cache` and no remote cache in `ci.yml`).
- **Impact:** `AGENTS.md` asks agents to "show the evidence (commands run and their results)". Locally that evidence can be a replay from an earlier day or another database: a test that breaks at a month boundary, or against a migrated database, still shows green until the code changes. This is a local check that can hide real failures.
- **Suggested fix:** Mark `test` as `"cache": false` in `turbo.json`, or at least the DB-backed packages (`@vertex-hub/api#test`, `@vertex-hub/worker#test`, `@vertex-hub/db#test`) through package-level `turbo.json` overrides. Keep caching for the pure `contracts`, `ui` and `web` unit tests if speed matters. `typecheck` and `lint` can stay cached.

### TST-03 — Mocked E2E API can drift from the real API, and nothing catches it

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/e2e/fixtures.ts:642-644`
  `apps/web/e2e/fixtures.ts:718-924`
  `apps/web/e2e/fixtures.ts:819-821`
- **Evidence:** The whole E2E suite runs against a 4,227-line in-memory copy of the API (`fixtures.ts`). Responses leave through untyped helpers:
  ```ts
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
  const fail = (route: Route, status: number, code: string, details?: unknown) =>
  ```
  - Error `code` is a free `string`, not the `ErrorCode` type from contracts.
  - Paths are string and regex matches (`path.match(/^\/api\/users\/([^/]+)(?:\/(.+))?$/)`), never checked against `apps/web/src/lib/api/openapi.json`.
  - Most request bodies are trusted as they are (`Object.assign(user, request.postDataJSON())` at `:820`). Only four parse with a contract schema (`:3578`, `:3607`, `:3930`, `:3975`).
  - Any request the mock does not know gets a silent `return fail(route, 404, 'NOT_FOUND')` (`:924`), not a test failure.
  - No spec listens for `pageerror` or console errors (no match for `pageerror|on('console'` in `apps/web/e2e`).

  Business rules are reimplemented in the mock, for example the archive responsibilities at `:827-856`. The typed client catches drift between the web app and `openapi.json`, but nothing catches drift between the mock and the API.
- **Impact:** A renamed path, a changed status code, a new error code, a response field the API stops sending, or a rule that changes in the API but not in the mock all leave the E2E suite green while the real screen breaks. A background query that hits an unknown path silently gets a 404, and the UI's error state is never noticed. That is how a mocked suite passes for the wrong reason.
- **Suggested fix:**
  1. Make `json()` generic over the OpenAPI response type (`paths[P][M]['responses'][200]['content']['application/json']` from `schema.gen.ts`), or parse each body with its contract response schema before `fulfill`.
  2. Type `fail()`'s `code` as `ErrorCode`.
  3. Turn the fallback at `:924` into `throw new Error(`Unmocked ${method} ${path}`)`, or record it and fail the test in an `afterEach`.
  4. Add a unit test that lists every path/method the mock answers and asserts it exists in `openapi.json`.
  5. Add a shared fixture that fails a test on `pageerror`.

### TST-04 — Nothing boots the built API and worker or runs the web app against the real API; the deploy health gate ignores the worker

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `.github/workflows/ci.yml:44-58`
  `deploy/deploy.sh:33-40`
  `deploy/deploy.sh:103-110`
  `apps/api/src/modules/health/health.service.ts:11-17`
- **Evidence:**
  - CI runs `pnpm build`, but no step starts `apps/api/dist/main.js` or `apps/worker/dist/main.js`, the files PM2 runs (`deploy/ecosystem.config.cjs:26,33`).
  - API tests boot the app through `Test.createTestingModule` (`apps/api/test/start-app.ts:17`), not `main.ts`.
  - E2E serves the built SPA against the mock (TST-03).
  - The migrate CLI that deploy runs (`node "$release/packages/db/dist/cli/migrate.js"`, `deploy.sh:89`) is never executed in CI. Only the shared `runMigrations` is exercised, through `@vertex-hub/db/testing`.
  - The deploy gate probes only the API: `HEALTH_URL="http://127.0.0.1:3050/api/health"`, and `/api/health` checks only the database (`checks: { database: ... }`).
  - The worker is watched only afterwards, by the 2-minute timer in `deploy/bin/vertexhub-healthcheck` (restart, log). A worker that crashes on start does not fail the deploy or trigger the rollback.
- **Impact:** A production-only boot failure (a missing file in `dist`, an env validation error, a bad `exports` path of a workspace package) passes CI. Deploy rolls the API back, but it reports a broken worker as `deployed <sha>`. With no worker, retainer cycles are not opened on the 1st and daily reminders are not sent, and nobody is told at deploy time.
- **Suggested fix:**
  1. Add a CI step after `pnpm build` in the `checks` job: run `node packages/db/dist/cli/migrate.js`, start `node apps/api/dist/main.js` and `node apps/worker/dist/main.js` against the CI Postgres, `curl --retry` `/api/health`, and check that `worker_heartbeats` gets a row. That is the same sequence `deploy.sh` runs.
  2. In `deploy.sh` `healthy()`, also require `pm2 jlist` to show `vertexhub-worker` as `online` with a stable restart count, or add a `worker` check to `/api/health` based on the latest `worker_heartbeats.beat_at`. Keep the `/api/health` contract test in `app.test.ts` in step.
  3. Optionally, add one Playwright spec that runs against the real API and test database (sign in, create a client) as a full-stack smoke test.

### TST-05 — The API's pg-boss consumer path (retainer cycles, daily notifications) is never exercised

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/api/src/core/jobs/job-queue.service.ts:29-40`
  `apps/api/vitest.config.ts:22-24`
- **Evidence:**
  ```ts
  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.JOBS_ENABLED || this.handlers.size === 0) return;
    const boss = new PgBoss(this.env.DATABASE_URL);
    ...
      await boss.createQueue(queue);
      await boss.work(queue, async () => handler());
  ```
  The API tests always set `JOBS_ENABLED: 'false'` ("Tests call job handlers directly; pg-boss stays off"). No test in the repo runs the API with jobs enabled: `JOBS_ENABLED` appears only in `vitest.config.ts`, `env.ts`, `job-queue.service.ts` and the CLI. The worker tests check only that the schedules are registered (`apps/worker/test/worker.test.ts:39-55`), not that the API consumes them.
- **Impact:** The production handoff (worker schedules `retainers.cycles` and `notifications.daily`, the API works them) has no automated check. A regression in `JobQueue` or its registration, a pg-boss upgrade that changes `work()` semantics, or a handler that throws only when called through pg-boss would stop cycle creation (F05 R2) and all A07/A08/renewal reminders (F14 rules 8-12) in silence. `/api/health` would stay green (TST-04).
- **Suggested fix:** Add `apps/api/test/job-queue.test.ts`:
  1. Start the app with `JOBS_ENABLED=true` (override the `ENV` provider).
  2. Register a probe handler through `JobQueue.work` on a unique queue, `send` a job with a separate `PgBoss` instance, and wait until the handler runs.
  3. Assert that both real queues from `packages/contracts/src/jobs.ts` are registered after bootstrap.

### TST-06 — Concurrency rules that the specs rely on have no tests

- **Severity:** Medium
- **Confidence:** Confirmed (by search; only two concurrent tests exist)
- **Location:** `apps/api/test/users.test.ts:510-519`
  `apps/api/src/modules/auth/user-status.ts:24`
  `apps/api/test/template-runs.test.ts` (no concurrent case)
  `apps/api/test/retainer-cycles.test.ts:240` (no concurrent case)
- **Evidence:** `grep -n "Promise.all\|concurren" apps/api/test/*.test.ts` finds only `task-status.test.ts:231` (F06 edge case 1) and a batch create at `task-dependencies.test.ts:199`. These rules are implemented but never tested under concurrency:
  - F01 rule 6 and F02 rule 14: "serialized with F01's access-change lock" (`pg_advisory_xact_lock(7_140_014)` in `user-status.ts:24`). The test even says the check "can only fire under a race, which the lock prevents" (`users.test.ts:511-512`) and then tests only the sequential path.
  - F05 edge case 2: "the API creates a cycle while the job runs: the unique `(retainer_id, month)` index keeps one cycle; the loser does nothing".
  - F07 edge case 2: "two automatic or manual runs on one cycle at once: ... the other gets `ALREADY_GENERATED`". `ALREADY_GENERATED` is tested only sequentially.
  - F05 edge case 1: "Two adjustments at once both apply".
- **Impact:** These are exactly the cases where a missing lock or a wrong `on conflict` gives duplicate cycles, duplicate generated tasks, or no General Manager left. Nothing would catch it if the lock or the conflict handling were removed or moved outside the transaction.
- **Suggested fix:** Add one `Promise.all` test per rule:
  - Archive the last two General Managers from each other at once: one gets 409 `LAST_GENERAL_MANAGER`.
  - Change a client's account manager and archive the old one at once: never an active client with an archived account manager.
  - Run `RetainerCyclesService.runDaily` twice at once, and alongside `POST /retainers/:id/resume`: one cycle.
  - Send two `POST /retainers/:id/cycles/:cycleId/...` template generations at once: one 201, one 409 `ALREADY_GENERATED`.
  - Post two adjustments at once: both applied.

### TST-07 — Spec rules and edge cases with no test

- **Severity:** Medium
- **Confidence:** Confirmed (searched the API, contracts, web unit and E2E tests for each item)
- **Location:** `apps/api/test/notifications.test.ts:375-427` (stream)
  `apps/api/test/notification-events.test.ts:500-570` (daily job)
  `apps/api/test/task-dependencies.test.ts` (whole file)
  `apps/api/test/task-views.test.ts` (whole file)
  `apps/api/test/template-runs.test.ts` (whole file)
- **Evidence:** Every error code named in the six specs appears in at least one test (scripted check), and every one of the 113 routes is requested by at least one API test. These rules have no test:
  - **F14 API table and edge case 7:** "the server closes the stream after 15 minutes so the client reconnects and the session is checked again", with a ping every 25 s. The stream tests cover only delivery and shutdown (`notifications.test.ts:376`, `:416`). Nothing checks that `NOTIFICATION_STREAM_LIFETIME_MS` closes the stream, or that an archived user's reconnect is refused. This is the only thing that stops live pushes to an archived user.
  - **F14 edge case 2:** a missed day ("a due-soon reminder whose due date has already passed is skipped"). No test runs `remind()` after skipping a day.
  - **F14 edge case 5:** reassigned after `task_overdue`: escalation still goes to the managers, and the new assignee gets no second overdue notice.
  - **F14 edge case 13:** department without a manager: unassigned overdue and escalations are skipped. No match for `managerId`, `without a manager` or similar in `notification-events.test.ts`.
  - **F06 edge case 3 (second half):** "A finished dependency reopened later: ... a `new` one becomes blocked again". `task-dependencies.test.ts` has no `reopen` and no `delivered` case.
  - **F06 edge case 16:** the board caps each column at 200 cards (`BOARD_LIMITS.cards`, `task-views.service.ts:68`). No test covers the cap (no `BOARD_LIMITS` in `task-views.test.ts`).
  - **F07 edge case 14:** "cancelling [a generated task] makes it missing again". No `cancel` in `template-runs.test.ts`.
- **Impact:** These rules can regress without a failing check. The stream lifetime has security weight (an archived user keeps receiving notifications on an open tab if the timeout is broken). The others decide who is reminded and whether a blocked task can start.
- **Suggested fix:** Add the cases to the named files:
  - A stream test with the lifetime overridden through the config/provider to a few hundred ms: assert the stream ends, and a reconnect after archiving returns 401.
  - In `notification-events.test.ts`: `remind(saturday)` without a Thursday run (no due-soon for Friday, overdue instead); a reassign after overdue; a department with `managerId = null`.
  - In `task-dependencies.test.ts`: deliver the dependency, then reopen it, and assert the `new` dependent is `blocked: true` again while an `in_progress` one stays.
  - In `task-views.test.ts`: seed 201 tasks in one status and assert 200 cards plus the total.
  - In `template-runs.test.ts`: cancel one generated task and assert the line's `missing` goes up by one and "Generate missing" recreates it.

### TST-08 — API tests leave rows in the shared test database on every run

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/test/helpers.ts:126-156`
  `docs/decisions/0013-engineering-conventions.md:52`
- **Evidence:** ADR 0013 says "Test data is unique per run and removed in `afterAll`". After the forced run, a read-only row count of the test database (scratch script, no writes) showed leftovers, among them `notification_reminders 315`, `verifications 85`, `users 3`, `sessions 4`, `two_factors 2`, `audit_entries 2` (`user.two_factor_enabled`). Dating the reminder rows by their UUIDv7 `subject_id` gives `{"2026-09-29T20":219,"2026-09-29T21":32,"2026-09-29T22":32,"2026-09-30T01":32}`. The last bucket is this audit's single run, so each full run leaks about 32 reminder rows and about 8 `verifications` rows. `removeUsers` and `removeTasks` do not delete `notification_reminders` for the tasks they remove. Only two test files clean their own reminder subjects (`notifications.test.ts:101`, `notification-events.test.ts:79`). The three leftover users (with sessions and 2FA) date from 2026-09-29, probably an interrupted run (Likely).
- **Impact:** The test database grows without bound. Daily-job tests run over every row in the table, so leftovers (for example a leftover user who manages a department, or open tasks) can change their results over time. That is order and history dependence, which ADR 0013 forbids.
- **Suggested fix:** Delete `notification_reminders` by `subject_id` inside `removeTasks`, and do the same for retainers in the retainer cleanup. Delete `verifications` rows for the removed users' identifiers in `removeUsers`. Add a final `afterAll` check in one test (or a Vitest `globalSetup` teardown) that counts users with the `@test.vertex.local` domain and fails when any are left.

### TST-09 — Architecture test misses several import forms

- **Severity:** Low
- **Confidence:** Confirmed (for the gaps); no current violation (searched `apps/api/src` for each form, none found)
- **Location:** `apps/api/test/architecture.test.ts:78-95`
  `apps/api/test/architecture.test.ts:189-195`
- **Evidence:**
  ```ts
  const pattern = /import\s+(?:type\s+)?(?:\{([^}]*)\}|[\w*\s,]+)\s+from\s+'([^']+)'/g;
  ```
  - A default-plus-named import (`import X, { a } from '../other/x.js'`) does not match: `[\w*\s,]+` cannot contain `{`.
  - `export { x } from '../../other/...'` and `export * from` re-exports are not read.
  - Dynamic `await import('../other/...')` is not read.
  - A namespace import `import * as db from '@vertex-hub/db'` yields `names: []`, so `db.clients` bypasses the table-ownership check (`:190-195`).
  - Imports that use double quotes are ignored.

  Biome formats to single quotes today, which limits the last gap.
- **Impact:** The module-boundary and table-ownership rules (ADR 0013, `AGENTS.md` "Module boundaries") can be broken through these forms, and the test that "enforces" them stays green. Agents copy patterns, so one bypass spreads.
- **Suggested fix:** Parse imports with the TypeScript compiler API (`ts.createSourceFile` and walk `ImportDeclaration`, `ExportDeclaration` and `import()` calls), or at least extend the regex. Fail on `import * as` from `@vertex-hub/db` outside `packages/db`. Add a small fixture test that feeds each form to `importsOf` and expects it to be detected.

### TST-10 — Date rules are tested against the real clock, and one assertion recomputes its expected value with the code under test

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/api/test/retainer-cycles.test.ts:30-31`
  `apps/api/test/retainer-cycles.test.ts:142`
  `apps/api/test/retainers.test.ts:27`
  `apps/api/test/template-runs.test.ts:54-55`
- **Evidence:** `const today = businessDate();` is computed once when the file loads, while the API computes its own "today" per request with `new Date()` (for example `projects.service.ts:476`, `task-views.service.ts:45`). The API has no injectable clock, and no API test uses `vi.setSystemTime` (no match). So:
  - Month-end, 31st, Friday and "7 days left" behaviour (F05 R3, R11, edge case 4, edge case 16; F07 edge case 15) is exercised only when CI happens to run on such a day.
  - A run that crosses midnight in Asia/Damascus compares two different "todays".
  - `expect(line?.behind).toBe(isLineBehind({ committed: 12, delivered: 5 }, shown, today));` derives the expected value from the same function the service uses, so it cannot fail if `isLineBehind` is wrong. `isLineBehind` itself does have fixed-date unit tests in `packages/contracts/src/retainers.test.ts`, which limits the impact.

  The daily-job tests do pass explicit dates (`reminders.remind(thursday)`, `job.runDaily(nextMonth)`), which is good.
- **Impact:** A boundary regression shows up days later as a "random" red build, and it is hard to reproduce. The pure functions are well covered, so the risk is at the service level.
- **Suggested fix:** Add a `CLOCK` provider (a `now()` function) in `apps/api/src/core` that services use instead of `new Date()` and `businessDate()` with no argument. Override it in the tests that check date rules, and add fixed-date cases for the 31st, the last Thursday before a Friday period end, and 00:30 local time on the 1st. Replace the recomputed expectation at `:142` with a literal (`false` or `true` for a fixed date).

### TST-11 — Required checks are not strict, and main-branch CI runs get cancelled

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `.github/workflows/ci.yml:11-13`
  GitHub ruleset 24128222 on `main`
- **Evidence:** `gh api repos/HussienALfajer/vertex-hub/rules/branches/main` returns `"strict_required_status_checks_policy":false` for the three required checks, and auto-merge is on (`allow_auto_merge: true`). So a PR that is green against an older `main` merges without being retested against the current `main`. The workflow uses `group: ci-${{ github.ref }}` with `cancel-in-progress: true`, which also applies to `push` on `main`. `gh run list` shows `2026-09-29 push main cancelled attempt=1` between two successful main runs, so one `main` commit has no CI result.
- **Impact:** Two PRs that each pass can merge into a broken `main`: two migrations generated from the same base, or a stale `openapi.json` after both change contracts. The post-merge run that would show it can be cancelled by the next merge. Phase deploys take `origin/main`.
- **Suggested fix:** Turn on "Require branches to be up to date before merging" (strict), or add a merge queue. Set `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` so runs on `main` always finish.

### TST-12 — GitHub Actions pinned by mutable tags

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `.github/workflows/ci.yml:38-40`
  `.github/workflows/ci.yml:66-74`
  `.github/workflows/ci.yml:91`
- **Evidence:** The workflow uses `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/upload-artifact@v7` and `gitleaks/gitleaks-action@v3`. The gitleaks step receives `GITHUB_TOKEN`. The repository is public.
- **Impact:** A moved tag in a third-party action (pnpm, gitleaks) runs new code in CI with the job token and the build output. `permissions: contents: read` limits the damage, which is why this is Low.
- **Suggested fix:** Pin third-party actions to full commit SHAs with the version in a comment, and let Dependabot (`.github/dependabot.yml`, `package-ecosystem: github-actions`) propose the updates.

### TST-13 — RTL screenshots are evidence only, never compared

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/e2e/fixtures.ts:4221-4227`
- **Evidence:**
  ```ts
  /** Viewport screenshot kept in the test output and attached to the HTML report. */
  await page.screenshot({ path, animations: 'disabled' });
  ```
  There is no `toHaveScreenshot` in `apps/web/e2e`. Each screen test does assert a heading or a visible element before taking the shot. The CI job uploads the report as an artifact for 14 days (`ci.yml:74-81`).
- **Impact:** A visual regression (a broken RTL layout, a lost token, a dark-theme contrast issue) passes CI. Someone has to open the artifact to see it. This matches the stated intent ("the design review evidence"), so it is not a defect.
- **Suggested fix:** Optional: add `toHaveScreenshot` for a few stable screens (login, shell, design system) with committed baselines generated in CI's Linux image, so font rendering matches.

## Strengths

- Integration tests hit the real app over HTTP against a real Postgres, with typed response parsing (`*Schema.parse(await response.json())`) and exact error codes through `expectError`. The 401 blocks spot-checked in `tasks`, `templates`, `clients`, `users`, `retainer-cycles` and `notifications` cover every route of their controllers.
- Test names cite the rule they cover ("(rule 7)", "(edge case 12)", "(R13)"), and every error code in the six specs appears in a test.
- Daily jobs are tested with explicit dates and repeated runs to prove idempotency (`notification-events.test.ts:506-557`, `retainer-cycles.test.ts:240-350`, `template-runs.test.ts:892`).
- `runMigrations` takes an advisory lock, so parallel Turbo test packages cannot race on migrations. CI migrates a fresh `postgres:17` on every run.
- CI has a migration drift check (`db:generate` + `git diff` + `git status` for untracked files), an OpenAPI and client-type drift check, gitleaks with full history, `--frozen-lockfile`, `node-version-file`, `permissions: contents: read`, and uploads Playwright traces and reports on failure. The three jobs are required checks on `main`.
- E2E runs the production build (`vite preview`) with `locale: 'ar'` and `timezoneId: 'Asia/Damascus'`. The clock-sensitive specs pin `page.clock.setFixedTime`, and `forbidOnly` is on in CI.
- Convention tests (`packages/db/src/conventions.test.ts`, `packages/ui/src/conventions.test.ts`, architecture test) move rules from review into checks, as ADR 0013 intends.
- The checks left the working tree clean (`git status --porcelain` identical before and after).

## Open questions

- Should Phase 1 deploys wait for a real-stack smoke test in CI (TST-04), or is the post-deploy manual walkthrough accepted for Phase 1? This is an owner decision about deploy gating. It is not in `docs/open-questions.md`.
- Should the owner allow squash and rebase merges at the repository level? `allow_squash_merge` and `allow_rebase_merge` are `true`, while `AGENTS.md` forbids them. Enforcement is by convention only, so this needs an owner decision; it is not a defect in the tests.
