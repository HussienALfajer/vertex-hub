# apps/worker

NestJS standalone context for background work: pg-boss queues and cron (ADR 0008), PDF rendering with Chromium, email.

## Layout
- `src/core/`: config and database, the same role as in `apps/api`.
- `src/jobs/<name>.job.ts`: one job per file. Pattern to copy: `src/jobs/heartbeat.job.ts`.

## Rules
- Queue names are `<module>.<action>` (`system.heartbeat`), exported as constants next to the job.
- Register queues and handlers in `onApplicationBootstrap` through `PgBossService`.
- Every job is idempotent: pg-boss retries, so running a job twice must leave the same result (upsert, check-then-act inside a transaction).
- Job payloads carry ids, not records. Load fresh data inside the job.
- Business rules live in the API's module services. When the worker needs one, share it through a package rather than copying the logic.
- Logs through the Nest `Logger`, never `console.log`.

## Tests
Integration tests in `test/` run against the test database with a unique `WORKER_NAME` per run.

Run: `pnpm --filter @vertex-hub/worker test` · `pnpm --filter @vertex-hub/worker typecheck`.
