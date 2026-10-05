# packages/messages

The user-facing Arabic texts that more than one app renders (ADR 0028): the emails the worker sends and the notification texts the web app and the emails share. Framework-free, so the web app (bell, toasts) and the worker (emails) render the same words.

## Layout
- `src/notifications.ts`: the text and link of every notification type (`NOTIFICATION_TEXT`, `notificationText`, `notificationLink`, `linkPath`). A new notification type gets its text here, not in the web app.
- `src/emails.ts`: sender names, the layout texts, `EmailContent` and the `test` email. `src/staff-emails.ts`: notification batches, the digest and the account emails. `src/client-emails.ts`: the client emails (the dialog's prefilled subject and message, `clientEmailDraft`, and the rendered content around the sent message, `clientEmailContent`) and the kinds' names.
- `src/format.ts`: the formatters these texts use (the web app re-exports them). `src/text.ts`: `fill` (`{{name}}` placeholders) and `plural` (Arabic plural forms).

## Rules
- Pure functions from contract data to text: no I/O, no React, no i18next. Depends on `@vertex-hub/contracts` only.
- One file per subject, re-exported from `src/index.ts`.
- Arabic only (V1). Dates and times in `Asia/Damascus` with Latin digits, as the web app shows them.
- Strings the web app alone shows stay in `apps/web/src/i18n/locales/ar.json`.

Run: `pnpm --filter @vertex-hub/messages test`.
