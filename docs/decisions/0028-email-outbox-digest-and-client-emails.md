# 0028 — Email: one outbox, sent by the worker over Hostinger SMTP; batched notification emails, a morning digest, and client emails sent by hand

Status: Accepted · Date: 2026-10-04

## Context
F14 email (`docs/specs/F14-email-digest.md`) adds email on top of the in-app notifications of ADR 0018: notification emails, a daily morning digest, account emails (activation, self-service password reset, security notices) and, by owner decision, client emails for quotes, invoices, receipts, statements, approval links, the monthly client report and ad budgets. Q5 (email provider) was open. The company mailbox `info@vertexmedia.pro` is on Hostinger Email. The team works in the app all day, so an email for every notification would be noise. ADR 0008 puts email in the worker; module rules stay in the API.

## Decision
- **Provider (Q5):** Hostinger Email SMTP, authenticated as `info@vertexmedia.pro` (owner decision), through Nodemailer. The transport is plain SMTP configured by environment variables, so a change of provider is a configuration change. Development and tests use a `log` transport that writes each message as an `.eml` file and sends nothing.
- **One outbox.** Every email is a row in `email_messages`, owned by a new api module `email`, written by the module that owns the change inside its transaction through `Mailer.queue(tx, …)`, which also enqueues an `email.send` job in the same transaction. Modules import `email`; `email` never reads their tables. The row records kind, recipients, subject, the template data, attachments (storage key and SHA-256), the sender and the record it belongs to, and its delivery status.
- **The worker sends.** `email.send` is worked by the worker: it renders the template (React Email, RTL, Arabic) and sends over SMTP, retries three times with backoff, and hands the outcome back to the API with an `email.result` job, as the PDF jobs do. The API records `sent` or `failed` and notifies the sender of a client email that failed for good.
- **Secrets never rest in plain text.** Links that carry a token (activation, password reset, approval link) are encrypted in the job payload with AES-256-GCM under `EMAIL_SECRET_KEY`, shared by the API and the worker, and are stored redacted in `email_messages`.
- **One renderer for notification text.** The notification texts, their links and the formatters they use move from `apps/web` into a new framework-free package `packages/messages`, used by the web app (bell, page, toasts) and by the worker (emails), so an email says exactly what the bell says.
- **Notification emails are batched and delayed.** A notification of a type the recipient emails is marked `pending`. Every 5 minutes from 08:00 to 20:00 on work days (`email.notifications`, worked by the API), each recipient's pending notifications older than 10 minutes are sent as one email, and those already read in the app are skipped. Nothing is sent from 20:00 to 08:00 or on Fridays; what waits joins the morning digest.
- **Morning digest.** `email.digest` at 08:00 Asia/Damascus on work days (Saturday–Thursday), worked by the API's `notifications` module, which runs the digest sources modules register (tasks: the user's overdue tasks and tasks due today), adds the notifications held overnight and the unread count, and sends nothing when all are empty. With the digest on, the assignee's due-soon and overdue reminders are not emailed separately: the digest covers them.
- **Client emails are sent by hand.** A "Send by email" action beside each document: recipients are the client's contacts with an email (no free addresses), the client's account manager is copied by default, `Reply-To` is the sender, the PDF is attached, and the subject and message are prefilled and editable. Each sending writes an audit entry on its record. Display names: "Vertex Media" for clients, "Vertex Hub" for staff.
- **Retention.** Client emails are kept with their attachments as correspondence. Staff emails (notifications, digests, account emails, tests) are deleted 90 days after they were created.

## Consequences
- The worker gets the SMTP settings; the API never connects to SMTP. Both get `EMAIL_SECRET_KEY`.
- Every later feature that emails calls `Mailer.queue`; the architecture test forbids `email` from importing the modules that use it.
- `info@vertexmedia.pro` shares Hostinger's daily sending limit with the people who use the mailbox by hand; the expected load (about 20 digests, at most a few dozen batches and client emails a day) fits, and a refusal shows as a failed email with its error.
- SPF, DKIM and DMARC records for `vertexmedia.pro` must be in place before the Phase 4 deploy, or the emails will land in spam.
- Bounces and opens are not tracked: SMTP reports acceptance only.
