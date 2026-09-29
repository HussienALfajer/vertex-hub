# 0008 — pg-boss jobs and Chromium PDF in a worker app

Status: Accepted · Date: 2026-09-28

## Context
V1 needs scheduled and background work: monthly retainer cycles, reminders and escalations, overdue checks, emails, and Arabic PDFs for quotes and invoices. Most PDF libraries break connected Arabic script.

## Decision
- **pg-boss** for queues and cron schedules, stored in PostgreSQL. Jobs can be enqueued in the same transaction as the business change. Redis exists on the server but is shared; pg-boss keeps the project isolated with no extra service.
- **apps/worker**: a NestJS standalone application context that owns every schedule and runs the handlers that need no module state (PDF, email).
- **Jobs whose rule lives in a module service** are scheduled by the worker and worked by the API process (`apps/api/src/core/jobs/`, `JobQueue.work`). The worker never loads the API's modules: they depend on Better Auth and on what other modules register at runtime (F05's retainer cycles read F06 task counts through `WorkProgress`), so a copy running in the worker would compute different results. Queue names and schedules shared by both apps live in `packages/contracts/src/jobs.ts`. (Amended 2026-09-29, F05, owner decision.)
- **PDF:** render an HTML template with the brand font and convert it with Playwright/Chromium in the worker.
- In-process schedulers (e.g. @nestjs/schedule) are not used for business schedules, because they are not durable.

## Consequences
- The API stays responsive; heavy work (Chromium) is isolated in the worker process.
- Job handlers must be idempotent (safe to retry).
- The API process starts pg-boss only when a module registers a handler and `JOBS_ENABLED` is not `false` (tests set it to `false` and call handlers directly).
