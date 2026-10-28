# Testing

How the checks run, locally and in CI, and why. `AGENTS.md` holds the rules in short; this file explains them. Measurements from 2026-10-26 are at the end.

## Where each check runs

Each check runs once, in the place where it is cheapest. The session checks what it changed; CI checks everything before a merge.

| When | What runs | Command | Time |
|---|---|---|---|
| While writing | Biome on each edited file (hook), the test file you are working on | `pnpm verify <file>` | seconds to 30 s |
| A layer's gate | That layer's test files, `pnpm typecheck` | `pnpm verify <files>` | under 2 min |
| Before the PR, once | Lint; typecheck, test and build of every package (Turborepo replays the unchanged ones); the changed E2E specs; migration and OpenAPI drift | `pnpm verify` | 1–3 min, seconds when nothing changed |
| CI, before the merge | Everything, the whole E2E suite included, split over parallel jobs | — | about 4 min |

The whole E2E suite (547 tests) never runs in a session unless asked for (`pnpm verify --e2e-all`): CI runs it on four shards.

## `pnpm verify`

`scripts/verify.mjs`, from the repository root:

- `pnpm verify`: Biome over the repository; `turbo run typecheck test build` (with `--continue`, so one failure does not hide the others); the E2E specs the branch changed, against the built web app; `drizzle-kit generate` when `packages/db/src/schema`, the migrations or `packages/contracts/src` changed (the schema takes its enums from the contracts); `openapi:export` and `api:generate` when `apps/api/src` or `packages/contracts/src` changed. A migration that `drizzle-kit generate` writes, or an OpenAPI document or client it regenerates, fails the run as it fails CI: commit the new files with the change.
- `pnpm verify <file>...`: only those test files, paths from the repository root. Vitest files run in their package after `turbo run build --filter=<package>^...` (a stale dependency `dist` gives failures that are not in the code); E2E specs run after the web build. `--grep "<title>"` picks tests of a spec. A package folder (`pnpm verify apps/worker`) runs that package's whole Vitest suite, and a folder inside a package (`apps/api/test/`) the tests under it; `apps/web/e2e` as a folder is refused, since it is the whole E2E suite (`--e2e-all`).
- Changed E2E specs are those that differ from the merge base with `origin/main` (committed, uncommitted or new). For `screens.spec.ts`, half of the suite, only the tests whose lines changed run, picked by title.
- Output: the whole output of each step in `.verify/<step>.log` (git-ignored); the console and `.verify/summary.md` get only the summary: each step's result and time, the tasks Turborepo ran rather than replayed, each failure with its file and line, and the command that reruns only the failed files.
- Exit code 0 when everything passed, 1 when a check failed, 3 when it refused to start: another `pnpm verify` is running on the machine (lock file `vertex-hub-verify.lock` in the temp folder; a lock left by a killed run expires after 30 minutes), `pnpm dev` is up (the api build replaces the `dist` folder its watcher runs from; `--allow-dev` overrides), or a file does not exist.

## Rules, and what enforces them

| Rule | Why | Enforced by |
|---|---|---|
| One test run at a time on the machine | Two runs share the test databases and the CPU, and fail each other's tests | The `test-guard` hook refuses a second run; the advisory lock makes a second run of a suite wait; the verify lock |
| Run once, read the log | Rerunning a suite to read its output again cost hours | `pnpm verify` keeps every log and prints the failures |
| Rerun only what failed | A full rerun after a one-file fix repeats minutes of passing tests | The summary prints the rerun command; Turborepo replays untouched packages |
| No edits while a check runs | The result no longer describes the code | Instructions (`CLAUDE.md`) |
| No whole E2E suite in a session | 11 minutes locally and timeouts under load; CI runs it on four shards | The `test-guard` hook (`pnpm verify --e2e-all` to run it on purpose) |
| No `timeout` around a test run | A killed run proves nothing and gets run again | The `test-guard` hook |
| No checks while `pnpm dev` runs | Its watchers load the machine, and the api build breaks the dev API | `pnpm verify` refuses |

The hook is `.claude/hooks/test-guard.mjs` (PreToolUse on Bash and PowerShell). Commands that run no tests pass straight through, and the text of a heredoc counts as data; for a test command it reads the verify lock and the running Node processes of this repository and its checkouts.

## Test databases

- `packages/db` and `apps/worker` share the test database (`TEST_DATABASE_URL`) and run one after the other (`turbo.json`).
- The api suite runs one Vitest worker per database `<test database>_api_<n>`. The number of workers is `TEST_WORKERS`, or half the logical CPUs from 4 to 12 (`packages/db/src/test-workers.ts`): 4 on CI runners, 12 on a 32-thread machine. Files in one worker run one after another on its database, since some rows are global (one manager per department).
- The api global setup creates the worker databases that are missing (the test role needs `CREATEDB`; otherwise `pnpm db:setup-local` creates them), migrates them and removes what an interrupted run left behind.
- Each suite holds a session advisory lock on the test database for the length of its run (`holdTestDatabases`): a second run of the same suite prints that it waits, and starts when the first ends. PostgreSQL drops the lock if a run dies.
- In tests the api's pool opens at most 4 connections (`DATABASE_POOL_MAX`), so 12 workers stay under PostgreSQL's default `max_connections` of 100: measured with the whole graph running (the db and worker suites at the same time), though each test file's own pool can open more. "Too many clients" errors mean fewer workers (`TEST_WORKERS`) or a higher limit.
- The api suite's timeouts are 15 s per test and 30 s per hook (`apps/api/vitest.config.ts`), above Vitest's 5 s and 10 s: its slowest tests take 2–3 s on an idle machine and crossed the defaults on a 4-core cloud VM with the rest of `pnpm verify` running.
- In a cloud session the typecheck needs more heap than Node's default there: the session hook adds `--max-old-space-size=6144` to `NODE_OPTIONS` (`scripts/cloud-session.sh`, `docs/workflow.md`).

## Vitest

- The api suite runs with `isolate: false`: a worker keeps its modules from one file to the next instead of loading the whole application again for every file. Files still start their own app and seed their own rows with unique values, so a test must leave nothing in module state; `test/worker-env.ts` puts `process.env` back after each file (`FILES_ROOT` and the like). A run with shuffled files passed whole.
- The smaller packages keep isolation: turning it off saved them under two seconds.

## E2E

- Every test mocks the API (`e2e/fixtures.ts`); the suite runs against the production build served by `vite preview`.
- Traces are recorded on the first retry only (`trace: 'on-first-retry'`): CI retries a failed test once and keeps its trace. Recording one for every test made the suite 30% slower and kept the antivirus scanning each trace file. Debug locally with `--trace on`.
- A test that tours many screens (most of `screens.spec.ts`) sets `test.setTimeout(90_000)`.
- CI fails a test that only passes on its retry (`failOnFlakyTests`).

## CI

`.github/workflows/ci.yml`. A pull request that changes only Markdown outside `brand/` skips the checks; the gate jobs still report.

| Job | Runs |
|---|---|
| Lint, typecheck, build | Audit, Biome, typecheck, build, migration drift, OpenAPI drift, the built API and worker start |
| Tests | Every package's tests but the api's |
| API tests shard 1–2 | The api suite, split by file (`vitest --shard`) |
| Playwright shard 1–4 | The whole E2E suite, split by test (`fullyParallel`) |
| Typecheck, lint, test, build · Playwright smoke | Gate jobs: with the secret scan, the three checks the `main` ruleset requires |
| Secret scan | gitleaks |

Turborepo's cache is kept between runs with `actions/cache`, per job. A pull request reads its own runs' cache and `main`'s; `main` cannot read a pull request's (GitHub keeps caches per branch), so after a merge `main` runs what the pull request changed once more.

### Remote cache

The workflow is ready for Turborepo's remote cache, which removes that repeat: `main` replays what its pull request ran, and a session can read what CI ran. It is off until the repository has:

1. A remote cache: Vercel's (create a token in the Vercel account settings; check Vercel's current terms) or a self-hosted server that implements the same API (for example `ducktors/turborepo-remote-cache`; then set `TURBO_API` to its URL).
2. Repository secrets `TURBO_TOKEN` and `TURBO_REMOTE_CACHE_SIGNATURE_KEY` (a long random string; `turbo.json` has `remoteCache.signature`, so artifacts are signed and checked), and the repository variable `TURBO_TEAM` (the team slug).

Only the four jobs that run turbo get these values. Pull requests from forks and from Dependabot get no secrets and keep the per-job cache.

## The local machine (Windows)

- **Antivirus.** Microsoft Defender scanned every file the tests read and wrote: 4.2 CPU cores during E2E with traces on, about one core during the api suite. A [Dev Drive](https://blogs.windows.com/windowsdeveloper/2023/06/01/dev-drive-performance-security-and-control-for-developers/) (ReFS, with Defender's performance mode, which scans after the file operation instead of during it) for the repositories and the pnpm store removes most of that; excluding the folders is the weaker alternative. Both are the owner's choice, set by hand.
- **PostgreSQL.** The local server's latency is not a bottleneck (0.13 ms a round trip). `max_connections = 100` limits the api suite to 12 workers.
- **`pnpm dev`.** Stop it before `pnpm verify`.
- **Old sessions.** Each Claude Code session starts its own connector processes; close the ones no longer used.

## Measurements (2026-10-26)

Local: Intel i9-14900HX (24 cores, 32 threads), 32 GB, NVMe, Windows 11, PostgreSQL 17.11.

| | Before | After |
|---|---|---|
| api suite (88 files, 1,388 tests) | 338 s (isolation on, 4 workers) | 69 s (isolation off, 12 workers, pool of 4) |
| api suite, 4 workers | 338 s | 210 s (isolation off) |
| One api test file | 31 s (75% loading modules) | unchanged: run few of them, and `pnpm verify <file>` |
| Whole E2E suite, 16 workers | 11.1 min, 75 timeouts | 4.4 min, none (tracing on retry, tour timeouts) |
| `pnpm verify` with nothing changed since the last run | — | 29 s (22 tasks replayed; the changed screens re-run) |

Before the change, sessions of this repository spent 44 hours in checks in four weeks, and 40% of the runs of a whole suite repeated one with no change in between.
