# TASKS — F14 Email and daily digest

Spec: `docs/specs/F14-email-digest.md` · ADRs 0006, 0008, 0013, 0014, 0018, 0020, 0023, 0024, 0025, 0027, 0028 · Four PRs, each leaves `main` green and fully wired. New dependencies (ADR 0028): `nodemailer`, `@react-email/components` + `@react-email/render` (worker); `smtp-server` (worker dev, one SMTP integration test). The device key parser is written by hand (no user-agent library).

## PR 1 — `feat/f14-email-core`: outbox, `email` module, worker sending, `packages/messages`
- [x] contracts: `emails.ts` (`EMAIL_KINDS` with audience, recipient and attachment schemas, per-kind data schema for `test`, `emailSummarySchema`, `emailListQuerySchema`, `emailPageSchema`, `.meta({ id })`); jobs `email.send`, `email.result`, `email.purge` in `jobs.ts`; unit tests (no `ar.json` keys: the log screen is PR 4)
- [x] `packages/messages`: new framework-free package (`CLAUDE.md`) with the sender names, the layout texts and the `test` email content
- [x] db (`/db-migration`, 0042 + 0043 `sender_name`, additive): `email_messages` with its enums and indexes, conventions exception; `TABLE_OWNERS`; drift
- [x] api `email` module: `Mailer.queue(tx, …)` (row + `email.send` job in the same transaction), `email.result` handler (`sent` / `failed`), `email.purge` (rule 25, staff only), `GET /api/emails` (`audit.read`), `POST /api/emails/test` (`users.manage`); `app.module.ts`; architecture test: `email` imports no other module
- [x] worker: `email-send.job.ts` (render, send, retry 3, `email.result`), transports `smtp` (Nodemailer) and `log` (`.eml` under `.data/emails/`), React Email layout (RTL, logo, footer, plain text) and the `test` template; SMTP integration test, `log` test, snapshot of `test`
- [x] api tests: `test/email.test.ts` and `test/job-queue.test.ts` (transactional enqueue against real pg-boss) (queue commits / rolls back, result, purge, log filters, test email, 401/403)
- [x] `.env.example`: moved to PR 2 (`.env*` files are outside the session's permissions; the owner adds the lines)
- [x] `docs/deployment.md` (F14 email configuration), `docs/architecture.md` (module, package), `AGENTS.md`, worker `CLAUDE.md`, spec details settled (`sender_name`, `EMAIL_LOG_DIR`, idempotency)
- [x] bridge: build, `openapi:export`, `api:generate`; web typecheck
- [x] wiring checklist, full checks (lint, typecheck, build, test, drift, OpenAPI current), reviewer (one blocking issue fixed: no SMTP error objects in the worker log)
- [x] owner acceptance (approved), dev database migrated (0042, 0043)
- [x] /ship

## PR 2 — `feat/f14-staff-emails`: notification emails, digest, account emails (API + worker)
- [x] `packages/messages`: move `notification-content.ts`, its strings and the formatters it uses from `apps/web`, with their tests; links as paths; web keeps the router glue
- [x] contracts: catalog `emailByDefault`, settings schemas + `emailTypes`, `digestEnabled`, per-type `email`, `emailLocked`; jobs `email.notifications`, `email.digest`; staff kinds' data schemas; batch window rules with unit tests; device key parsing with unit tests
- [x] db (`/db-migration`, 0044, additive): `notifications.email_state`, `email_after`, `email_id` + partial index; `notification_settings.email_types`, `digest_enabled`; `email_digests`; `user_devices` (auth)
- [x] api `notifications`: marking in `notify` (rules 3–4), merge re-pending (rule 8), batch job (rules 5–7, 9), digest with registered sources (rules 10–12; `tasks` registers its source), settings round-trip; `email:run-notifications [--at]` and `email:run-digest [--date]` scripts
- [x] `.env.example` (still outside the session's permissions; the owner adds the lines): the worker email variables from PR 1 (`EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_LOG_DIR`, `SMTP_*`) and `EMAIL_SECRET_KEY`, if the owner has not added them
- [x] token links (first use): AES-256-GCM encryption in the job under `EMAIL_SECRET_KEY` (api and worker config, `.env.example`), redacted in the row, decrypted by the worker; tests
- [x] api `auth`: links emailed on create, restore, new link; `POST /api/password-links/request` (rule 13); security notices (rule 14); `user_devices` and new-device email (rule 15)
- [x] worker templates: `notification_batch`, `digest`, `account_activation`, `password_reset`, `security_notice`, `new_device` with snapshots
- [x] api tests: batches and digest with a fixed clock, settings, auth emails, forgot password (204 always, 3 per hour)
- [x] emails queued while pg-boss is off (done: `JobQueue.startSending()` in the two email scripts; `user:create` emails nothing, it creates an active user) (CLI: `user:create`, `email:run-notifications`, `email:run-digest`) must still be sent: start pg-boss in those scripts, or have the worker pick up `queued` rows without a job (PR 1 reviewer note)
- [x] bridge; web typecheck; `AGENTS.md` commands for the two scripts
- [x] wiring checklist, full checks, reviewer (two blocking issues fixed: batch subject over 200 characters; "forgot password" timing), owner approval, dev database migrated (0044), PR opened

## PR 3 — `feat/f14-client-emails`: client emails from each document (API + worker)
- [x] contracts: `clientEmailSchema`, client kinds' data schemas and prefilled Arabic templates, permission `invoices.send` (+ `permissions.test.ts`), notification type `email_failed` with its text in `packages/messages`, error codes (`QUOTE_NOT_SENT`, `QUOTE_EXPIRED`, `INVOICE_NOT_ISSUED`, `INVOICE_NOT_OVERDUE`, `PAYMENT_VOIDED`, `ENTRY_VOIDED`, `BUDGET_NOT_LOW`, `PDF_NOT_READY`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`, `CONTACT_NO_EMAIL` as missing, `ATTACHMENT_TOO_LARGE`), audit action `<entity>.emailed`; `ar.json` keys; `CONTACT_NO_EMAIL` and `REMINDER_NOT_DUE` added; the client kinds and the email summary moved to `email-basics.ts` (import cycle with notifications and approvals); prefilled templates in `packages/messages/src/client-emails.ts`
- [x] db (`/db-migration`, 0045, additive): `email_failed` in `notification_type`; drift
- [x] api `email`: attachments (10 MB cap), `Mailer.history(record)`, recipient resolution helper input, attachment copy for temporary renders (rule 21), `email_failed` to the sender (rule 23) through `Mailer.onFailure`, registered by `notifications`; `clients` exports `ClientEmails` (contacts, copies, signature)
- [x] api routes: quotes (email, history), approvals (`email` on create / reissue, email reminder, history), invoices and payments (email, history), statement (email, history), monthly report (email, history), ad wallet entries and budget low (email, history); audit on each record (rule 22)
- [x] worker templates for the eleven client kinds with snapshots
- [x] api tests per route: success, 401, 403, out of scope, each 409 code
- [x] bridge; web typecheck
- [x] wiring checklist, full checks (lint, typecheck, build, test, drift, OpenAPI current), reviewer (two blocking issues fixed: a refused statement or report send kept its copy on disk; missing 401/403/scope tests; also found: a reissue without a body answered 400)
- [x] owner acceptance (approved), dev database migrated (0045)
- [x] PR opened

## PR 4 — `feat/f14-email-web`: screens and E2E
- [ ] web: notification settings email column and digest switch; `/forgot-password` and the sign-in link; shared "Send by email" dialog and email history; wired into quotes, invoices, receipts, statement, monthly report, ad receipts and budget notice, approval dialogs and request page; `/emails` log with test email and navigation; team profile "Sent to …"
- [ ] e2e: mocks, `f14-email.spec.ts`, screenshots light and dark (settings, forgot password, dialog, history, log)
- [ ] wiring checklist, full checks, reviewer, owner acceptance (browser steps of the spec's Acceptance), /ship; `docs/ROADMAP.md`
