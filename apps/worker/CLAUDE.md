# apps/worker

NestJS standalone context for background work: pg-boss queues and cron (ADR 0008), PDF rendering with Chromium, email.

## Layout
- `src/core/`: config and database, the same role as in `apps/api`.
- `src/jobs/<name>.job.ts`: one job per file. Pattern to copy: `src/jobs/heartbeat.job.ts`.
- `src/pdf/`: Chromium rendering (`pdf-renderer.ts`) and the document templates; fonts are embedded from `@fontsource`, the logo is read from `brand/`. A new template builds on the shared shell in `document.ts` (brand header, styles, watermark); a render job stores its output with `storeOnce` (`pdf-objects.ts`). Pattern: `src/jobs/invoices-pdf.job.ts` with `src/pdf/invoice-templates.ts`.
- `src/email/`: emails (F14, ADR 0028). `email-sender.ts` holds the `smtp` and `log` transports; `email-layout.tsx` is the one React Email layout (RTL, logo, footer); `email-render.tsx` maps each kind to its content from `@vertex-hub/messages`. A new kind: its data schema in contracts `EMAIL_DATA_SCHEMAS`, its content function in `packages/messages`, its case in `emailContent`, and a snapshot test. Data fields that hold a token link are listed in `EMAIL_SECRET_FIELDS`: the API encrypts them into the job's `sealed` and `email-secrets.ts` puts them back with `EMAIL_SECRET_KEY`; links into the app use `APP_URL`. Biome's React rules apply to `.tsx` files only.

## Rules
- Queue names are `<module>.<action>` (`system.heartbeat`), exported as constants next to the job.
- Register queues and handlers in `onApplicationBootstrap` through `PgBossService`.
- Every job is idempotent: pg-boss retries, so running a job twice must leave the same result (upsert, check-then-act inside a transaction).
- Job payloads carry ids, not records. Load fresh data inside the job. Exception: a render job (`quotes.pdf`) carries its frozen, hashed payload, so the worker reads no business table; its result goes back to the API as a job (`quotes.pdf-ready`). `email.send` does the same with the whole email; its outcome goes back as `email.result`.
- Business rules live in the API's module services. A scheduled job that needs one is only scheduled here and worked by the API through `JobQueue` (ADR 0008; pattern: `src/jobs/retainer-cycles.job.ts` with `apps/api/src/modules/projects/retainer-cycles.service.ts`). Shared queue names and crons live in `packages/contracts/src/jobs.ts`.
- Logs through the Nest `Logger`, never `console.log`.

## Tests
Integration tests in `test/` run against the test database with a unique `WORKER_NAME` per run.

Run: `pnpm --filter @vertex-hub/worker test` · `pnpm --filter @vertex-hub/worker typecheck`.
