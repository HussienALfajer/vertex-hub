# apps/worker

NestJS standalone context for background work: pg-boss queues and cron (ADR 0008), PDF rendering with Chromium, email.

## Layout
- `src/core/`: config and database, the same role as in `apps/api`.
- `src/jobs/<name>.job.ts`: one job per file. Pattern to copy: `src/jobs/heartbeat.job.ts`.
- `src/pdf/`: Chromium rendering (`pdf-renderer.ts`) and the document templates; fonts are embedded from `@fontsource`, the logo is read from `brand/`.

## Rules
- Queue names are `<module>.<action>` (`system.heartbeat`), exported as constants next to the job.
- Register queues and handlers in `onApplicationBootstrap` through `PgBossService`.
- Every job is idempotent: pg-boss retries, so running a job twice must leave the same result (upsert, check-then-act inside a transaction).
- Job payloads carry ids, not records. Load fresh data inside the job. Exception: a render job (`quotes.pdf`) carries its frozen, hashed payload, so the worker reads no business table; its result goes back to the API as a job (`quotes.pdf-ready`).
- Business rules live in the API's module services. A scheduled job that needs one is only scheduled here and worked by the API through `JobQueue` (ADR 0008; pattern: `src/jobs/retainer-cycles.job.ts` with `apps/api/src/modules/projects/retainer-cycles.service.ts`). Shared queue names and crons live in `packages/contracts/src/jobs.ts`.
- Logs through the Nest `Logger`, never `console.log`.

## Tests
Integration tests in `test/` run against the test database with a unique `WORKER_NAME` per run.

Run: `pnpm --filter @vertex-hub/worker test` · `pnpm --filter @vertex-hub/worker typecheck`.
