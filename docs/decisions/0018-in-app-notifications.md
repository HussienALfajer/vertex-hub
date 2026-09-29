# 0018 — In-app notifications: stored per user, pushed over SSE, reminders from one daily job

Status: Accepted · Date: 2026-09-29

## Context
F14 (`docs/specs/F14-notifications.md`) delivers the events F02, F05, F06 and F07 name, plus reminders (A03, A07, A08, retainer renewal). The owner wants a bell with an unread count, a toast when something arrives and live updates without reloading, per-user muting of what does not require action, and read notifications kept 90 days. The API runs as one PM2 process behind nginx (ADR 0009); scheduled work follows ADR 0008.

## Decision
- **Stored first, pushed second.** Each notification is a row per recipient in `notifications`, written by the module that owns the change, inside that change's transaction, through `NotificationCenter.notify` exported by the `notifications` module. Modules that emit import `notifications`; `notifications` never reads their tables and keeps a display snapshot (`data`) so it needs nothing from them to render.
- **Text is rendered by the web app** from the type and the snapshot through i18next; nothing user-facing is stored as text.
- **Live push with SSE and `pg_notify`.** The transaction also runs `pg_notify('notifications', <recipient ids>)`, which PostgreSQL delivers only on commit. The API keeps one `LISTEN` connection and pushes to the recipients' open `GET /api/me/notifications/stream` connections. This needs no after-commit hooks, works for notifications created by any process, and keeps working if the API ever runs more than one instance. Streams close every 15 minutes so the session is checked again; clients reconnect and refetch on reconnect and on window focus. nginx gets a location for the stream with `proxy_buffering off` and a read timeout above the stream's lifetime. WebSockets were not chosen: the push is one-way.
- **Fixed catalog of types** in `packages/contracts`, each with a category and whether it can be muted; action-required types (assignment, requests, review, returned work, awaiting client, over the revision limit, overdue and escalation, new account manager or project manager) cannot be muted. A muted type is not stored.
- **One daily job** `notifications.daily` at 09:00 Asia/Damascus on work days (Saturday–Thursday), scheduled by the worker and worked by the API (ADR 0008). Modules register their daily sources (tasks: A07, A08 and escalation; projects: renewal). Idempotency comes from a `notification_reminders` table keyed by kind, subject and occurrence (the due date or renewal date), so retries and reruns never send twice and a changed date starts the reminders again.
- **Retention:** read notifications are deleted 90 days after they were read. Notifications are not business records: no archive column and no audit entries; the business changes behind them are audited by their modules.

## Consequences
- Every later feature that notifies (F09 client responses, F13 invoices, A04, A09–A12) adds its types to the catalog and calls `notify`; email and the daily digest (Phase 4, after Q5) read the same rows and settings.
- The `notifications` tables are listed as exceptions to the business-table conventions in `packages/db/src/conventions.test.ts`.
- The architecture test forbids `notifications` from importing the emitting modules.
- The production nginx site changes once, with the Phase 1 deploy.
