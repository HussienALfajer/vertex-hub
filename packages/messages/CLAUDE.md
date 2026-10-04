# packages/messages

The user-facing Arabic texts that more than one app renders (ADR 0028): the emails the worker sends and, from F14 email PR 2, the notification texts the web app and the emails share. Framework-free, so the web app (bell, toasts) and the worker (emails) render the same words.

## Rules
- Pure functions from contract data to text: no I/O, no React, no i18next. Depends on `@vertex-hub/contracts` only.
- One file per subject (`src/emails.ts`), re-exported from `src/index.ts`.
- Arabic only (V1). Dates and times in `Asia/Damascus` with Latin digits, as the web app shows them.
- Strings the web app alone shows stay in `apps/web/src/i18n/locales/ar.json`.

Run: `pnpm --filter @vertex-hub/messages test`.
