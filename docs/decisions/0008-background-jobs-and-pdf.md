# 0008 — pg-boss jobs and Chromium PDF in a worker app

Status: Accepted · Date: 2026-09-28

## Context
V1 needs scheduled and background work: monthly retainer cycles, reminders and escalations, overdue checks, emails, and Arabic PDFs for quotes and invoices. Most PDF libraries break connected Arabic script.

## Decision
- **pg-boss** for queues and cron schedules, stored in PostgreSQL. Jobs can be enqueued in the same transaction as the business change. Redis exists on the server but is shared; pg-boss keeps the project isolated with no extra service.
- **apps/worker**: a NestJS standalone application context that reuses the API's modules and runs job handlers.
- **PDF:** render an HTML template with the brand font and convert it with Playwright/Chromium in the worker.
- In-process schedulers (e.g. @nestjs/schedule) are not used for business schedules, because they are not durable.

## Consequences
- The API stays responsive; heavy work (Chromium) is isolated in the worker process.
- Job handlers must be idempotent (safe to retry).
