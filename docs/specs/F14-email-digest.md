# F14 — Email and daily digest

Status: Approved · Date: 2026-10-04 · Scope: `docs/product/v1-scope.md` §F14 (email, daily digest; client and account emails added by the owner on 2026-10-04) · ADRs: 0006, 0008, 0013, 0014, 0018, 0020, 0023, 0024, 0025, 0027, 0028

## Summary
The in-app bell works only while people have the app open, nobody gets a picture of their day before they sign in, and documents still reach clients through WhatsApp by hand. F14 email adds four kinds of email, all sent from `info@vertexmedia.pro` over Hostinger SMTP by the worker through one outbox (ADR 0028): **notification emails** for the types each user chooses, delayed 10 minutes, skipped when already read in the app, batched into one email per user and held outside work hours; a **morning digest** at 08:00 on work days with the user's overdue tasks and tasks due today; **account emails** (activation links, self-service "forgot password", security notices, sign-in from a new device); and **client emails** sent by hand from each document (quotes, invoices, receipts, statements, approval links, the monthly client report, ad budget receipts and low-balance notices, and reminders), with the PDF attached and replies going to the sender.

## In scope / out of scope
- In:
  - Outbox `email_messages`, the `email` api module and `Mailer.queue`, the worker's `email.send` job with SMTP (Nodemailer) and React Email templates, `email.result` back to the API (ADR 0028).
  - Notification emails: an email switch per type in the notification settings, defaults on for the scope's triggers; delay, read-skip, batching and quiet hours.
  - Daily digest at 08:00 Asia/Damascus on work days, with a switch to turn it off.
  - Account emails: activation and password reset links sent on issue, self-service "forgot password", security notices (password changed, two-factor changed, roles changed, account archived), sign-in from a new device.
  - Client emails sent by hand: quote, quote expiry reminder, approval link (on create and reissue), approval reminder, invoice, overdue invoice reminder, payment receipt, client statement, monthly client report, ad deposit receipt, ad budget low notice; their history on each document; audit entries.
  - Email log for administrators and a test email.
  - `packages/messages`: the notification texts, links and formatters shared by the web app and the worker (ADR 0028).
- Out (later or never):
  - WhatsApp sending by the system (first V2 item); the existing "Send on WhatsApp" links stay.
  - Automatic client emails (every client email is sent by a person); emails to addresses that are not saved client contacts.
  - Receiving email, reply threading, bounce and open tracking, unsubscribe links for clients.
  - English or bilingual client emails; per-client email language.
  - Email for the department managers' view in the digest (the digest is the user's own tasks only).
  - Scheduled sending, attachments other than the record's PDF.

## Roles and access
One new permission, `invoices.send`: granted with scope `all` wherever `invoices.manage` is granted, and to the Account Manager with `own_clients` (owner decision: Finance and the client's account manager). Everything else reuses existing permissions.

| Action | Permission | Roles and scope |
|---|---|---|
| Read and change own email switches and digest switch | session | every active user, own settings only |
| Request a password reset link for an email address | anonymous | anyone (same answer whether the address exists or not) |
| Email a quote or its expiry reminder | `quotes.manage` covering the quote's client | Account Manager: own_clients · other holders as F04 |
| Email an approval link (create, reissue) or an approval reminder | `tasks.manage` client scope on the client (as F09) | as F09 |
| Email an invoice, an overdue reminder, a payment receipt, a client statement | `invoices.send` covering the client | every holder of `invoices.manage`: all · Account Manager: own_clients |
| Email an ad deposit receipt or an ad budget low notice | `campaigns.fund`, or `campaigns.manage` covering the client | holders of `campaigns.fund`: all · Account Manager: own_clients (`campaigns.manage`) · others as F12 |
| Email the monthly client report | `reports.read` covering the client (as F15) | General Manager, Operations manager: all · Account Manager: own_clients |
| Read a document's email history | the read permission of that document (`quotes.read`, `invoices.read`, `tasks.read`, `campaigns.read`, `reports.read`) covering its client | as each feature |
| Read the email log | `audit.read` | General Manager, Internal Operations manager |
| Send a test email | `users.manage` | General Manager, Internal Operations manager |

## Email kinds
The catalog lives in `packages/contracts/src/emails.ts` (`EMAIL_KINDS`, each with its audience). Staff emails come from "Vertex Hub <info@vertexmedia.pro>" with no `Reply-To`; client emails from "Vertex Media <info@vertexmedia.pro>" with `Reply-To` the sender (owner decisions). All are Arabic, RTL, with the brand logo and colours (`brand/identity.md`), a system font stack (no web fonts, Q11), and a plain-text alternative.

| Kind | Audience | Sent when | To | Attachment |
|---|---|---|---|---|
| `notification_batch` | staff | rules 6–9 | the recipient user | — |
| `digest` | staff | rule 10 | the user | — |
| `account_activation` | staff | a user is created or restored, or a user manager issues a link to an `invited` user (F01) | the user | — |
| `password_reset` | staff | a user manager issues a link to an `active` user (F01), or the user asks for one (rule 13) | the user | — |
| `security_notice` | staff | rule 14 | the user | — |
| `new_device` | staff | rule 15 | the user | — |
| `test` | staff | an administrator sends a test (rule 26) | the administrator | — |
| `client_quote` | client | by hand, quote `sent` | chosen contacts | the PDF of the current sent version |
| `client_quote_reminder` | client | by hand, quote `sent`, valid until today or later | chosen contacts | same |
| `client_approval_link` | client | on create or reissue of an approval request, when asked | the request's contact | — (the link) |
| `client_approval_reminder` | client | by hand, when F09 offers its WhatsApp reminder | the request's contact | — (no link) |
| `client_invoice` | client | by hand, invoice `sent`, `partially_paid`, `overdue` or `paid` | chosen contacts | the invoice PDF (current version) |
| `client_invoice_reminder` | client | by hand, invoice `overdue` | chosen contacts | the invoice PDF |
| `client_receipt` | client | by hand, payment not voided | chosen contacts | the receipt PDF |
| `client_statement` | client | by hand, from a ready statement render | chosen contacts | the statement PDF (copied, rule 21) |
| `client_report` | client | by hand, from a ready monthly report render | chosen contacts | the report PDF (copied, rule 21) |
| `client_ad_receipt` | client | by hand, deposit entry not voided | chosen contacts | the deposit receipt PDF |
| `client_ad_budget_low` | client | by hand, wallet below its threshold (F12 rule 20) | chosen contacts | — |

## Data
New module `email` (`apps/api/src/modules/email`), tables in `packages/db/src/schema/email.ts`. Email messages are not business records: never archived; client emails are kept, staff emails are purged (rule 25); they write no audit entries of their own (the module that sends a client email audits it on its record, rule 22). They are listed as exceptions, with this reason, in `packages/db/src/conventions.test.ts`.

### `email_messages`
| Field | Type | Constraints |
|---|---|---|
| `id` | uuid | primary key |
| `kind` | enum `email_kind` | required |
| `audience` | enum (`staff`, `client`) | required, follows the kind |
| `to` | jsonb | required; `[{ name, email, userId? , contactId? }]`, 1–10 |
| `cc` | jsonb | required, default `[]`; same shape, ≤ 5 |
| `reply_to` | text | optional; the sender's email for client emails |
| `subject` | text | required, ≤ 200 |
| `message` | text | optional, ≤ 4000; the editable text of a client email |
| `data` | jsonb | required; the template data validated by the kind's schema in contracts, with token links redacted (ADR 0028) |
| `attachments` | jsonb | required, default `[]`; `[{ fileName, storageKey, sizeBytes, sha256 }]` |
| `sender_id` | uuid → `users.id` | optional; null for system emails |
| `sender_name` | text | optional, set with `sender_id`; the sender's name when queued, so `email` reads no other module's table (as `audit_entries.actor_name`) |
| `client_id` | uuid → `clients.id` | optional; set for client emails |
| `record_type` | enum (`quote`, `invoice`, `payment`, `approval_request`, `client`, `ad_wallet_entry`) | optional; the record a client email belongs to |
| `record_id` | uuid | optional, with `record_type` |
| `status` | enum (`queued`, `sent`, `failed`) | required, default `queued` |
| `attempts` | integer | required, default 0 |
| `last_error` | text | optional; the SMTP error of the last attempt, ≤ 1000 |
| `provider_message_id` | text | optional; the SMTP message id |
| `sent_at` | timestamptz | optional |
| `created_at`, `updated_at` | timestamptz | `timestamps()` |

Indexes: `(record_type, record_id, created_at desc)`; `(client_id, created_at desc)`; `(status, created_at)`; `(created_at)` for the purge; `(sender_id)`. For the statement and monthly report, `record_type` is `client` and `data` holds the period or month.

### `notifications` (changed)
| Field | Type | Constraints |
|---|---|---|
| `email_state` | enum (`pending`, `sent`, `skipped`) | optional; null when the type is not emailed to this recipient |
| `email_after` | timestamptz | optional; when a `pending` notification may be emailed (10 minutes after it was created or last merged) |
| `email_id` | uuid → `email_messages.id` | optional; the batch or digest that carried it |

Partial index `(recipient_id, email_after) where email_state = 'pending'`.

### `notification_settings` (changed)
| Field | Type | Constraints |
|---|---|---|
| `email_types` | `notification_type[]` | optional; null = the catalog defaults (rule 2) |
| `digest_enabled` | boolean | required, default true |

### `email_digests`
One row per digest sent; the digest's idempotency key. Never purged (one row per user per work day).

| Field | Type | Constraints |
|---|---|---|
| `user_id` | uuid → `users.id` | required |
| `digest_date` | date | required; the work day |
| `email_id` | uuid → `email_messages.id` | optional; set null when the purge deletes the email (rule 25) |

Primary key `(user_id, digest_date)`.

### `user_devices` (module `auth`)
| Field | Type | Constraints |
|---|---|---|
| `user_id` | uuid → `users.id` | required |
| `device_key` | text | required; SHA-256 of the browser family and the operating system family parsed from the user agent |
| `label` | text | required; e.g. "Chrome · Windows" |
| `first_seen_at`, `last_seen_at` | timestamptz | required |

Primary key `(user_id, device_key)`.

### Contracts and catalog
- `NOTIFICATION_CATALOG` gets `emailByDefault: boolean`, true for `task_assigned`, `task_mentioned`, `task_due_soon`, `task_overdue`, `task_overdue_escalated`, `approval_responded`, `invoice_paid` (the scope's triggers).
- New notification type `email_failed` (category `clients_projects`, not mutable, `emailByDefault` false; subject: the email's record, or the client for statements, reports and ad budget notices), with its display snapshot (kind, recipients, document number or month).
- New permission `invoices.send` (Roles and access).
- Jobs in `packages/contracts/src/jobs.ts`: `email.send` (worker, retry 3 with backoff), `email.result` (API), `email.notifications` (cron `*/5 * * * *`, API), `email.digest` (cron `0 8 * * 0-4,6`, API), `email.purge` (cron `30 3 * * *`, API); all in `Asia/Damascus`.

## States and rules
An email is `queued`, then `sent` or `failed`; nothing moves it back. A notification's `email_state` is `pending`, then `sent` or `skipped`; a merge may set it back to `pending` (rule 8).

### Delivery
1. **Queueing.** A module queues an email with `Mailer.queue(tx, { kind, to, cc, replyTo, subject, message, data, attachments, senderId, clientId, record })`, exported from `email/index.ts`, inside the transaction of its change; the row and its `email.send` job commit or roll back with the change. `email` never reads other modules' tables; modules import it, never the reverse. The worker renders and sends, then queues `email.result`; the API sets `sent` (with `sent_at` and the message id) or, after the last retry, `failed` with the error (ADR 0028). Token links travel encrypted in the job and are stored redacted.

### Notification emails
2. **Email switches.** Each user has an email switch per notification type in their settings; without a choice saved (`email_types` null) the catalog defaults apply. Every type can be switched, including the ones that cannot be muted in the app (owner decision). A type muted in the app creates no notification, so it sends no email; its email switch is shown off and disabled.
3. **Marking.** When `notify` stores a notification for an active recipient whose email switch for the type is on, it sets `email_state = pending` and `email_after = now + 10 minutes`; otherwise `email_state` stays null. `invited` and archived users get no emails of this kind.
4. **Covered by the digest.** `task_due_soon` and `task_overdue` sent to the task's assignee (`tasks` marks these notices `digestCovered`) are stored with `email_state = skipped` when that user's digest is on: the next digest lists those tasks (owner decision). Overdue notices to department managers for unassigned tasks, and escalations, are emailed normally.
5. **Read in time.** A pending notification that is read before it is emailed becomes `skipped`, whenever the batch or the digest looks at it.
6. **Batches.** `email.notifications` runs every 5 minutes; it acts only on work days (Saturday–Thursday) from 08:10 to 20:00 Asia/Damascus (rule 7). For each recipient with pending notifications whose `email_after` has passed, it locks them (`for update skip locked`), skips the read ones, and queues one `notification_batch` email with up to 20 items (newest first) and "n more" linking to `/notifications`; the items get `email_state = sent` and the email's id. One item: the subject is the item's text; more: "لديك n إشعارات جديدة".
7. **Quiet hours.** Nothing is batched from 20:00 to 08:10 or on Fridays (owner decision). What waits goes into the next morning's digest (rule 10); for users with the digest off, into the first batch after 08:10.
8. **Merging.** When an unread `task_commented` is merged with a new comment (F14 rule 5) and its type is emailed to the recipient, its `email_state` becomes `pending` again and `email_after` moves to now + 10 minutes, so a later batch carries the new comments once.
9. **Content.** Each item is the text the bell shows, rendered by `packages/messages` from the type and the snapshot, with its subject line, its time (Damascus) and an "Open" link to `APP_URL` + the notification's path. Opening the link does not mark it read; the app does when it opens (F14 rule 15). The footer links to `/notifications/settings`.

### Digest
10. **Morning digest.** `email.digest` runs at 08:00 Asia/Damascus on work days. For each active user with the digest on and no `email_digests` row for the day, it collects: the user's open, non-archived tasks that are overdue (F06 rule 12) and those due today, from the digest source registered by `tasks` (F06 My tasks rules), up to 10 each with "n more" linking to My tasks; the user's pending notifications (rule 7, whether or not their 10 minutes have passed), up to 20, which become `sent` with the digest's id; and the unread count with a link to `/notifications`. Each task shows its title, client, due date and, when overdue, the days late. When the three lists are all empty, nothing is sent and no row is written. Otherwise it queues one `digest` email and writes the `email_digests` row in the same transaction, so a retry or a second run sends nothing twice.
11. **Switch.** The digest switch is on by default and lives in the notification settings (owner decision). Turning it off stops digests from the next run and rule 4 from the next reminder.
12. **Registration.** `notifications` runs the digest sources other modules register (as F14's daily sources); `notifications` never imports `tasks`.

### Account emails
13. **Links (F01).** Issuing an activation or reset link (user created, restored, or "new link") also emails it to the user; the link is still returned once for copying (F01 rules 11–14 unchanged). **Forgot password:** the sign-in page links to `/forgot-password`, which asks for an email and always answers "If the address belongs to an account, a link is on its way". For an `active` user it issues a reset link valid for 1 hour (the user manager's links stay 72 hours), single-use, invalidating earlier links, and emails it; `invited` and archived users and unknown addresses get nothing. At most 3 requests per user per hour are honoured (counted in the API process, which runs as one); more are ignored silently; per IP, nginx applies the sign-in limit (`vhsignin`) and answers 429. Redeeming revokes the user's other sessions (F01 rule 13); two-factor is still required at the next sign-in.
14. **Security notices.** A `security_notice` email goes to the user when: their password changes (by link, by themselves, by forgot password); two-factor is enabled, disabled or reset by an administrator; their assigned roles change; their account is archived (owner decisions). Each says what changed, when (Damascus), by whom (themselves or the user manager's name), and what to do if it was not expected. They cannot be switched off. Setting the first password through an activation link is not a change and sends none. Restoring sends the activation email with "your account was restored" wording instead.
15. **New device.** When a session is created for a user from a browser family and operating system not in their `user_devices`, the row is added and a `new_device` email is sent with the time, the device label, and the IP address. The very first sign-in of a user (no rows yet) records the device without an email. A known device updates `last_seen_at`.

### Client emails
16. **Sending by hand.** Every client email starts from the "Send by email" dialog of its document (rule 17). Nothing is emailed to a client automatically (owner decision). The email changes nothing on the document: a quote is sent with F04's action first, an invoice is issued with F13's.
17. **Dialog.** Recipients: 1–10 non-archived contacts of the record's client that have an email, chosen in a picker (no free addresses; owner decision); contacts without an email show greyed with "No email". CC: the client's primary account manager, on by default and removable, and "CC me" (off by default); a sender who is the account manager is not copied twice. Subject (≤ 200) and message (≤ 4000, plain text with line breaks) are prefilled from the kind's Arabic template with the client, document number, amounts with their currency (ADR 0006), dates and validity filled in, and can be edited. Below the message the email adds a fixed block with the document's key facts and, for links, the button; then the sender's signature (name, title, phone) and the company footer.
18. **Conditions by kind** (refused with `409` and the code when not met): quote `sent` (`QUOTE_NOT_SENT`); reminder also valid until today or later (`QUOTE_EXPIRED`); invoice issued and not `void` (`INVOICE_NOT_ISSUED`); overdue reminder only for `overdue` (`INVOICE_NOT_OVERDUE`); receipt of a payment not voided (`PAYMENT_VOIDED`); ad receipt of an entry not voided (`ENTRY_VOIDED`); ad budget low only while the wallet is below its threshold (`BUDGET_NOT_LOW`); a needed PDF must be `ready` (`PDF_NOT_READY`); the client must not be archived (`CLIENT_ARCHIVED`); every recipient must be a non-archived contact of that client with an email (`INVALID_RECIPIENT`).
19. **Approval links (F09).** The create and reissue requests take `email: true` to email the link to the request's contact (it must have an email: `CONTACT_NO_EMAIL`); the link is still shown once, and "Copy link" and "Send on WhatsApp" stay. The email uses the request's message, the list of items, a button to the link and its expiry. The approval reminder (`POST …/email-reminder`) is offered when F09 offers "Send reminder on WhatsApp" (F09 rule 24) and the contact has an email; it carries no link and points to the earlier email. No subject or message editing for these two kinds: the request's message is the message.
20. **Attachments.** The PDF attached is the record's current one (F04 sent version, F13 invoice version after a due date change, receipt, F12 deposit receipt). Its file name is the document number (e.g. `INV-2026-0012.pdf`); statements and reports use the client name and the period or month.
21. **Temporary renders.** Statement and monthly report PDFs are deleted 24 hours after rendering (F13 rule 29, F15). Emailing one copies the object to `objects/emails/<email id>/` when the email is queued, so the sent file outlives the render and stays with the email.
22. **Audit and history.** Each client email writes an audit entry on its record (`emailed`, with kind, recipients' names and addresses, subject): on the quote, invoice, payment, approval request, ad wallet entry, or on the client for statements, reports and ad budget notices. Each document shows its email history (Screens 5).
23. **Failure.** A client email that fails for good notifies its sender with `email_failed` (in the app, and by email only if they switched it on), opening the document; the history shows the error. The sender sends again from the same dialog; there is no automatic resend.

### Operations
24. **Configuration.** The worker reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` and `EMAIL_TRANSPORT` (`smtp` or `log`; `log` is the default outside production and writes `.eml` files under `EMAIL_LOG_DIR`, default `.data/emails/`). The worker refuses to start with `smtp` without `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD`. The API and the worker read `EMAIL_SECRET_KEY` (32 bytes, base64). Links use `APP_URL`. Production values live in the server's git-ignored `.env`; `.env.example` gets fake ones.
25. **Purge.** `email.purge` deletes staff emails (`audience = staff`) created more than 90 days ago, after clearing their references from `notifications` and `email_digests`. Client emails and their copied attachments are kept.
26. **Test email.** An administrator can send a `test` email to their own address from the email log, to check the configuration; it shows in the log with its status.

### Changes to earlier features
- **F01** (`auth`): links are emailed on issue; `/forgot-password` and `POST /api/password-links/request`; security notices; `user_devices` and new-device emails; the profile's "Copy activation/reset link" also says the link was emailed.
- **F04** (`quotes`): "Send by email" and "Send reminder" on a sent quote; email history on the quote page.
- **F09** (`approvals`): `email` option on create and reissue; "Send reminder by email"; history on the request page.
- **F12** (`campaigns`): "Send by email" on deposit receipts and "Email low balance notice" on the client Ads tab; history there.
- **F13** (`invoices`): "Send by email" and "Send overdue reminder" on the invoice page, "Send by email" on receipts and on the statement; history on the invoice page and the client Invoices tab; `invoices.send`.
- **F14 in-app** (`notifications`): email switches and the digest switch in settings; `email_state` marking in `notify`; the batch and digest jobs; `email_failed`; texts moved to `packages/messages`.
- **F15** (`reports`): "Send by email" on the monthly client report; history there.
- **Web:** `apps/web/src/features/notifications/notification-content.ts` and its strings move to `packages/messages` (ADR 0028); the web keeps only the router glue.

## API
Every route below is new or changed. Client email routes take `clientEmailSchema`: `contactIds[]` (1–10), `ccAccountManager` (default true), `ccMe` (default false), `subject`, `message`; they answer `202` with `emailSummarySchema` (id, kind, status, to, cc, subject, sender, createdAt, sentAt, error) and share the errors `400`, `401`, `403`, `404`, `CLIENT_ARCHIVED`, `INVALID_RECIPIENT`, `PDF_NOT_READY` (rule 18).

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/me/notification-settings` | session | — | `notificationSettingsSchema` + per type `email` (on, off) and `emailLocked` (muted in app), and `digestEnabled` | — |
| `PUT /api/me/notification-settings` | session | `updateNotificationSettingsSchema` + `emailTypes[]`, `digestEnabled` (both optional: left out, they stay as saved) | as GET | `NOT_MUTABLE` |
| `POST /api/password-links/request` | anonymous | `{ email }` | 204 always | 429 (global rate limit) |
| `POST /api/quotes/:id/email` | `quotes.manage` (client) | `clientEmailSchema` + `kind` (`quote`, `reminder`) | 202 summary | `QUOTE_NOT_SENT`, `QUOTE_EXPIRED` |
| `GET /api/quotes/:id/emails` | `quotes.read` | — | `emailSummarySchema[]`, newest first | 404 |
| `POST /api/approvals/requests`, `POST /api/approvals/requests/:id/reissue` | as F09 | + `email` (boolean, default false) | as F09 + `email` summary | as F09 + `CONTACT_NO_EMAIL` |
| `POST /api/approvals/requests/:id/email-reminder` | `tasks.manage` (client) | — | 202 summary | `REQUEST_CLOSED`, `REMINDER_NOT_DUE`, `CONTACT_NO_EMAIL` |
| `GET /api/approvals/requests/:id/emails` | `tasks.read` | — | summaries | 404 |
| `POST /api/invoices/:id/email` | `invoices.send` (client) | `clientEmailSchema` + `kind` (`invoice`, `overdue_reminder`) | 202 summary | `INVOICE_NOT_ISSUED`, `INVOICE_NOT_OVERDUE` |
| `POST /api/payments/:id/email` | `invoices.send` (client) | `clientEmailSchema` | 202 summary | `PAYMENT_VOIDED` |
| `GET /api/invoices/:id/emails` | `invoices.read` | — | summaries of the invoice and its payments' receipts | 404 |
| `POST /api/clients/:id/statement/email` | `invoices.send` (client) | `clientEmailSchema` + `statementPdfId` | 202 summary | — |
| `GET /api/clients/:id/statement/emails` | `invoices.read` (client) | — | summaries | 404 |
| `POST /api/clients/:id/monthly-report/email` | `reports.read` (client) | `clientEmailSchema` + `month`, `reportPdfId` | 202 summary | — |
| `GET /api/clients/:id/monthly-report/emails` | `reports.read` (client) | `month` | summaries | 404 |
| `POST /api/ad-wallet-entries/:id/email` | `campaigns.fund` or `campaigns.manage` (client) | `clientEmailSchema` | 202 summary | `ENTRY_VOIDED` |
| `POST /api/clients/:id/ad-wallet/email` | as above | `clientEmailSchema` | 202 summary | `BUDGET_NOT_LOW` |
| `GET /api/clients/:id/ad-wallet/emails` | `campaigns.read` (client) | — | summaries (receipts and notices) | 404 |
| `GET /api/emails` | `audit.read` | `emailListQuerySchema`: `page`, `pageSize`, `status[]`, `audience`, `kind[]`, `from`, `to`, `search` (recipient address) | `emailPageSchema`: summaries + audience, record link, attempts | — |
| `POST /api/emails/test` | `users.manage` | — | 202 summary | — |

Each module serves its own routes and calls `Mailer.queue` and `Mailer.history(record)`; `email` serves only the log and the test. `GET /api/emails` never returns `data` or `message` of client emails beyond the subject (content stays on the documents, under their permissions).

## Screens
1. **Notification settings** `/notifications/settings` (changed) — a second switch column "Email" beside "Notify me" for every type; locked off with a hint when the type is muted in the app. A "Daily digest at 8:00" switch at the top, with a one-line description. Saves on change, as today.
2. **Forgot password** `/forgot-password` — outside the shell, like `/activate`: email field, submit, then the neutral confirmation (rule 13) with "Back to sign in". The sign-in page gets a "Forgot password?" link. Error: inline message; 429 says to try later.
3. **Send by email dialog** (shared component, used by quotes, invoices, receipts, statement, monthly report, ad receipts and ad budget notices) — recipients picker (contacts with email, greyed without), CC switches, subject, message, the attachment's name and size, a short read-only preview of the fixed block, "Send". On success: a toast "Queued for sending" and the history refreshes. Disabled with the reason when the PDF is not ready yet. Errors show inline per field or as the code's message.
4. **Approval request dialogs** (F09, changed) — "Also send by email to <contact>" checkbox (checked when the contact has an email, hidden otherwise); the success view says whether it was emailed. The request page gets "Send reminder by email" beside the WhatsApp one.
5. **Email history** (shared component) — on the quote page, invoice page, approval request page, client Invoices tab (statement), monthly client report screen and client Ads tab: newest first, each row with kind, recipients, sender, time, and status badge (queued, sent, failed with the error in a tooltip). Empty: "Not emailed yet".
6. **Email log** `/emails` (`audit.read`, in the menu beside the audit log) — table with filters (status, audience, kind, dates, recipient search): time, kind, recipients, subject, status, attempts, error, record link. "Send test email" button (`users.manage`). Empty, loading and error states as other lists.
7. **Team profile** (F01, changed) — after issuing a link: "Sent to <email>" above "Copy link".

The emails themselves (rendered in the worker): RTL Arabic layout, logo header, content, footer. Every email template gets a snapshot test of its HTML and its plain text. Everything in the web is RTL with logical CSS and i18next strings; email strings live in `packages/messages`.

## Audit, notifications and jobs
- Audit: each client email on its record (rule 22). Account emails are not audited themselves; the changes behind them already are (F01). Settings changes are personal: not audited.
- Notifications: `email_failed` (rule 23).
- Jobs: `email.send` (worker, retry 3 with backoff), `email.result` (API), `email.notifications` (every 5 minutes, acts 08:10–20:00 on work days), `email.digest` (08:00 on work days), `email.purge` (03:30 daily). All handlers are idempotent: `email.send` carries the whole email (as the PDF render jobs, so the worker reads no table) and `email.result` changes only a `queued` row, so a repeated outcome changes nothing; batches lock their notifications; digests key on `email_digests`.

## Edge cases
1. **SMTP down or credentials wrong:** each email retries three times with backoff, then `failed` with the error; staff emails are not retried after that (the in-app notification is still there); client emails notify the sender (rule 23). The email log shows the failures.
2. **Hostinger's daily limit reached:** SMTP refuses, emails fail as in 1; the log shows the error. `info@` shares the limit with manual use (ADR 0028).
3. **Worker down for hours:** emails stay `queued` and go out when it is back; a digest queued at 08:00 may arrive late; its content is the 08:00 state.
4. **Digest job missed a day:** no catch-up digest for past days; the next run sends that day's.
5. **Notification read during sending:** the batch locked it before queueing; it is still emailed. Accepted.
6. **Recipient archived with pending notifications:** they are skipped by the next batch; no emails to archived users except the archive notice (rule 14), which is queued in the archiving transaction.
7. **User changes their email address:** emails queued before the change go to the old address; later ones to the new. Account emails go to the address at the time of the change.
8. **User switches an email type on or off while notifications are pending:** pending ones are still sent; the switch affects new notifications only.
9. **Forgot password for an address in different case or with spaces:** trimmed and compared case-insensitively, as sign-in does.
10. **Contact archived or email removed after it was chosen in an open dialog:** the send is refused with `INVALID_RECIPIENT`; the picker reloads.
11. **Invoice voided or payment voided after its email was queued:** the email still goes out with the PDF it was queued with. The audit and history show both.
12. **Statement render deleted before the email is queued:** `PDF_NOT_READY`; the dialog asks to render it again.
13. **Two people send the same document at once:** both emails are sent and both appear in the history; no lock (each is a deliberate send).
14. **Very long notification bursts** (a template run, the 09:00 daily job): one batch per user carries up to 20 items and "n more".
15. **Large attachment:** PDFs today are under 5 MB; an email whose attachments exceed 10 MB is refused with `ATTACHMENT_TOO_LARGE` before queueing.
16. **New device from an unknown user agent:** parsed as "Unknown browser · Unknown system"; one email for that key, then known.
17. **Clock and time zone:** all schedules and windows are in `Asia/Damascus`; times in emails are shown in Damascus time with Latin digits.

## Open questions
- None block this spec. Q5 is resolved (Hostinger SMTP, `info@vertexmedia.pro`).
- Before the Phase 4 deploy (not owner decisions, checks in the deploy session): Hostinger's daily sending limit for the `info@` mailbox plan; SPF, DKIM and DMARC records on `vertexmedia.pro`; the SMTP password placed in the server's `.env` by the owner.
- Not asked, chosen as the simplest reading and easy to change before implementation: the 10-minute delay and 5-minute batch cycle, 08:10–20:00 window, 20 items per batch, 10 tasks per digest list, 1-hour self-service reset links with 3 requests per hour, 90-day staff email retention, the 10 MB attachment cap, the copy-to-account-manager default, and `invoices.send` following every holder of `invoices.manage`.

## Acceptance
- Owner check in the browser (development uses the `log` transport: each email is an `.eml` file under `apps/worker/.data/emails/` to open in a mail client; one final check on the server with real SMTP):
  1. As the General Manager, open the email log and send a test email → the log shows it `sent` and the `.eml` opens with the logo, RTL Arabic text and footer.
  2. Create a user → an activation email is written and the profile says "Sent to …". Sign out; on the sign-in page use "Forgot password?" for an active user → a reset email with a 1-hour link; set a new password → a "password changed" notice.
  3. Sign in as that user in another browser → a "new device" email; sign in again in the same browser → none.
  4. As employee E, open settings: the "Email" column shows assigned, mention, due soon, overdue, escalation, client response and invoice paid on. As manager M, assign a task to E and wait 10 minutes (or run the batch job by hand with `pnpm --filter @vertex-hub/api email:run-notifications [--at <ISO time>]`, development only; the scripts start pg-boss to send only, so the worker sends what they queue) → one email "assigned to you". Assign another and open it in the app within 10 minutes → no email.
  5. Assign two tasks to E at 20:30 (run the batch with `--at` that evening) → no email; run the digest with `pnpm --filter @vertex-hub/api email:run-digest [--date YYYY-MM-DD]` for the next work day → E's digest lists overdue and today's tasks and the two held notifications; run it again → nothing new. Turn the digest off → the next run sends E nothing.
  6. As the account manager, on a sent quote use "Send by email" to two contacts → the email has the PDF attached, CC the account manager, `Reply-To` the sender; the quote's history and audit log show it.
  7. Create an approval request with "Also send by email" → the contact's email holds the link; the request page shows the history.
  8. As Finance, email an issued invoice, an overdue reminder and a payment receipt; render a statement and email it; as the account manager email the monthly report and an ad budget low notice for a wallet below its threshold → each appears in its history with the attachment named after the document.
  9. Break the SMTP password in a staging-like run → the client email fails after the retries, the sender gets `email_failed`, and the log shows the error.
- Tests:
  - API: every new route: success, 401, 403, out of scope (another account manager's client), and each 409 code; `password-links/request` answers 204 for unknown, invited and active users and emails only the active one, and honours 3 per hour; settings round-trip with `emailTypes` and `digestEnabled`.
  - Mailer (integration): queueing commits or rolls back with the change; redaction of token links in the row; `email.result` sets `sent`/`failed`; `email_failed` reaches the sender; purge removes only staff emails older than 90 days.
  - Batches and digest (integration with a fixed clock): marking by switches and defaults; digest-covered reminders skipped only for the assignee with the digest on; read-skip; 10-minute delay; quiet hours and Friday; merge re-pending; one email per user with 20 items and "n more"; digest content, empty skip, idempotency, held notifications moved into the digest; digest off.
  - Auth (integration): links emailed on create, restore and new link; security notices for each change; new device on first unseen browser, not on the first ever sign-in.
  - Worker: SMTP transport against a local SMTP test server (one integration test), `log` transport writes the `.eml`; decryption of token links; template snapshots of every kind (HTML and text).
  - Unit: the batch window and quiet hours; device key parsing; `packages/messages` renders every notification type (moved tests from the web).
  - Architecture test: `email` imports no other module; `notifications` still imports no emitting module.
  - E2E with RTL screenshots: notification settings with the email column and digest switch, forgot password page, the send by email dialog, an email history, the email log.
