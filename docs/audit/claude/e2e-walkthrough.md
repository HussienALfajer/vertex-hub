# End-to-end walkthrough audit

- Date: 2026-09-30 · Commit: 9463f9f
- Method: dev servers started with the built-in browser's `preview_start` (`dev`, `pnpm dev`: web :5173, api :3000, worker). The built-in browser pane was used for the first sign-in, 2FA setup, departments and the new-user form; it could not draw while hidden (clicks timed out), so the rest of the walkthrough ran as headless Playwright scripts (Chromium, `@playwright/test` from the workspace) kept in the session scratchpad, one browser context per user, recording every console error/warning, `pageerror`, HTTP ≥ 400 response and failed request. API-level permission probes used the same sessions (Playwright request context or curl with the user's cookie jar). Local dev database only; `pnpm db:migrate` run once (nothing pending).
- Test users (created with `user:create`, fake `@example.test` emails, passwords kept only in the scratchpad): General Manager (general_management, 2FA set up through the UI), Account Manager (general_communication), Design department manager (design; made manager through the Departments screen), Designer (design, plain employee), Writer (content_management, plain employee), plus one Photography employee created and activated through `/team/new` and `/activate`.
- Scope covered (flows completed):
  - Auth: sign-in, wrong password message, rate limit (HTTP 429 after 5 attempts per minute), required 2FA setup for the General Manager (password → TOTP → 10 backup codes), 2FA verification at sign-in, sign-out from the account menu, session persistence on reload, deep link while signed out → `/login?redirect=…`, back after sign-out.
  - Users and departments: set a department manager, new-user form (empty-form validation, duplicate e-mail with different case → `EMAIL_TAKEN` message, double submit), activation link dialog, activation page (validation, success, reused link → "invalid link", no token → "invalid link"), team directory and profile, department pages.
  - Clients: create (validation, account-manager picker, healthcare switch, double submit → one client), profile header and all tabs (URL keeps the tab), contact with final approval (phone/e-mail validation, `+963…` normalization, approval warning disappears), brand kit (colors, fonts, tone, forbidden words), platform account (URL validation, access state), communication log (validation, double submit → one note, Damascus time).
  - Projects: create from the client profile (validation incl. due < start, suggested milestones, installments, money only with money access), milestones (add, complete, action menu), status hold/resume as project manager, cancel with reason as account manager, reopen as General Manager, extra work logged by the project manager, client Projects tab, project list.
  - Retainers: create with lines, fee, renewal date and monthly template; This month tab (rate, behind/renewal badges, adjust delivered with reason), generate this month's tasks from the template (preview, double click → one run), per-line task counts and "missing tasks" buttons.
  - Tasks: assign/reassign through the dialog, full workflow through the task page buttons (start → internal review → return to revisions → resume → review → send to client → client changes requested ×3 → over-limit decision "extra work" → approved by client → delivered), dependency editing, dependency cycle refused (`DEPENDENCY_CYCLE`), blocked task: no start for the assignee, "start anyway" with reason for the department manager, board "Move to…" menu and mouse drag to Internal review, checklist item, comments with the @mention picker (double submit → one comment), request to another department as a plain employee, self-assign in another department refused.
  - Templates: list, open (project and monthly), create with stage and step (validation per field), rename, archive (banner, read-only, hidden from employees), generate on a project (existing/new milestones, work-day due dates, dependencies) and on a retainer cycle.
  - Notifications: live SSE update of the bell count and toast when another user assigns a task or @mentions, dropdown, page with Unread filter in the URL, mark all as read, settings switches (action-required types locked; save toast), recipients checked through the API for `task_assigned`, `task_opened`, `task_review_requested`, `task_returned`, `task_approved`, `task_mentioned`, `request_finished`, `tasks_generated`, `project_manager_assigned`, `client_account_manager_assigned`.
  - Permission boundaries (API responses): 403 for employee/department-manager edits of projects and clients, project manager cancel / change PM / change currency, account manager creating or archiving clients, employee creating users or listing archived users, department manager renaming a department, account manager reading the audit log, employee editing a template, employee assigning a task to someone else. No money fields in project responses for non-money roles. Forbidden screens (`/audit`, `/clients/new`, `/team/new`, `/templates/new`, `/projects/new`, `/retainers/new`) redirect for roles without the permission.
  - Page sweep (43 URLs incl. not-found and malformed ids) as General Manager, Account Manager, Department Manager and Designer, recording console and network errors; 375 px viewport sweep (no horizontal overflow on any page); light and dark theme screenshots of retainer, workload, board and task pages.
  - Second pass (dev server restarted after an interruption): 2FA step on the sign-in page (wrong code message, correct code, redirect kept to `/clients`), My account screen, archiving a user with responsibilities (refused, lists "project manager of …" and "assignee of open task …" with links), client archive and restore (banner, read-only), audit log screen and entries per entity type (client, contact, platform account, note, project, milestone, retainer, cycle, extra work, task, comment, checklist, link, user, department), cycle actions (change committed quantity with reason, add-line validation), History tab empty state, retainer pause and resume, task cancel with reason and the reopen actions, comment edit/remove controls for the author, task list with a status filter, back/forward and reload on a task deep link, My tasks sections for a manager and an employee, daily notifications job run for 2026-10-01 (8 sent: `task_overdue` to assignees and to managers for unassigned tasks, `retainer_renewal_due` to the account manager), same date again (0 sent: idempotent) and 2026-10-03 (3 escalations to the Design manager).
- Not covered: changing a password and 2FA disable/regenerate on My account (would sign the shared test sessions out), ending and reactivating a retainer, the History tab with a closed cycle (needs a month rollover and the cycle job), extra work billing states (menu reached, not changed), milestone drag reordering, users restore and link reissue, Operations-manager and Finance roles (not created: both require 2FA set up per user; their permissions were not probed in the browser), board drag for forbidden moves, and a second real browser tab receiving SSE after network loss.
- Checks run: none of the repository check suites (area 5 owns them). One transient `ETIMEDOUT 127.0.0.1:3000` from the Vite proxy at 05:05:45 was seen while another auditor ran the test suite on the same machine; it did not reproduce and is not reported.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| E2E-01 | Medium | Pressing Enter in a "type and add" chip field submits the whole form and drops the typed value | `packages/ui/src/components/multi-combobox.tsx:63` |
| E2E-02 | Medium | Over-limit revision creates an extra work item titled in English ("Revision 3: …") while the dialog promises the Arabic title | `apps/api/src/modules/tasks/task-workflow.service.ts:195` |
| E2E-03 | Low | Base UI console errors on almost every page (`nativeButton`, `nativeLabel`) | `packages/ui/src/components/button.tsx:36`, `apps/web/src/features/account/activate-page.tsx:65` |
| E2E-04 | Low | Board and Workload open on the user's own department, empty for the General Manager and account managers | `apps/web/src/features/tasks/task-board-page.tsx:52` |
| E2E-05 | Low | "Not found" pages tell the user to reload and report the error | `apps/web/src/features/tasks/task-page.tsx:54` |
| E2E-06 | Low | Queries keep firing after sign-out and log 401 errors | `apps/web/src/components/app-shell.tsx:223` |
| E2E-07 | Low | Missing Madani font files log three 404 errors on every page load | `packages/ui/src/styles/fonts.css:31` |
| E2E-08 | Low | "Design system" page is in every user's navigation | `apps/web/src/components/app-shell.tsx:99` |
| E2E-09 | Info | Requests to a department without a manager notify nobody | data (Content Management has no manager locally) |

Counts: Critical 0 · High 0 · Medium 2 · Low 6 · Info 1

## Findings

### E2E-01 — Pressing Enter in a "type and add" chip field submits the whole form and drops the typed value

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `packages/ui/src/components/multi-combobox.tsx:63` (Root without auto-highlight), `apps/web/src/features/clients/brand-kit-form.tsx:302` (doc comment "typed and added with Enter")
- **Evidence:** URL `/clients/<id>?tab=brand-kit`, role Account Manager (the client's AM). Steps: "Fill in the brand kit" → type `Cairo` in Fonts (the list shows `أضف «Cairo»`, nothing highlighted) → press Enter. Expected: `Cairo` becomes a chip (the field hint and code comment say chips are added with Enter). Actual: the form submits and closes; `GET /api/clients/<id>` returns `"fonts":[],"toneOfVoice":null`. Clicking the `أضف «…»` option, or ArrowDown then Enter, adds the chip correctly. The same component with `create` is used for skills (`user-form.tsx`) and in the task and template step forms.
- **Impact:** Users lose what they typed and save a half-filled record without noticing (the kit saved with no fonts and no tone of voice).
- **Suggested fix:** Highlight the first item (`autoHighlight`) in `MultiCombobox`, or stop Enter from submitting the form while the input has text; add a Playwright test "type a font, press Enter → chip shown, form still open".

### E2E-02 — Over-limit revision creates an extra work item titled in English

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/api/src/modules/tasks/task-workflow.service.ts:195`; `apps/web/src/i18n/locales/ar.json:1259-1260`
- **Evidence:** Task on the Audit retainer; three client revisions with limit 2; Account Manager clicks "قرّر" → "عمل إضافي". The dialog says the item will be named `«التعديل 3: خطة المحتوى الشهرية والنصوص»`. `GET /api/retainers/<id>/extra-work` returns `"title":"Revision 3: خطة المحتوى الشهرية والنصوص"`. Code: `` title: `Revision ${revision.number}: ${task.title}` ``.
- **Impact:** English text in the Arabic UI on the Extra work tab and later on invoices built from extra work (F13); the dialog preview does not match what is saved.
- **Suggested fix:** Store the Arabic title (or keep a neutral format and render it through i18n); make the web preview and the API use the same string; extend the F06 API test to assert the title.

### E2E-03 — Base UI console errors on almost every page

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `packages/ui/src/components/button.tsx:36` with `render={<Link …/>}` (about 30 uses, e.g. `apps/web/src/features/account/activate-page.tsx:65`, `apps/web/src/features/tasks/task-page.tsx:46`); `FieldLabel` rendered on a non-`label` element (`packages/ui/src/components/field.tsx:18`)
- **Evidence:** Page sweep, every role: 1–4 console errors per page, e.g. on `/clients/new`: "Base UI: A component that acts as a button expected a native <button> because the `nativeButton` prop is true…" and "Base UI: <Field.Label> expected a <label> element because the `nativeLabel` prop is true…". Seen on `/activate`, `/tasks`, `/tasks/new`, `/clients/<id>`, `/projects/new`, `/retainers/new`, `/templates/new`, `/team/new` and most detail pages.
- **Impact:** Links rendered through `Button` get button semantics, which screen readers announce wrongly; the console noise hides real errors during debugging and in E2E runs.
- **Suggested fix:** Pass `nativeButton={false}` when `Button` renders a link (or add a `ButtonLink` to `packages/ui`), and `nativeLabel={false}` where `FieldLabel` renders a non-label; add a Playwright assertion that pages load with no console errors.

### E2E-04 — Board and Workload open empty for the General Manager and account managers

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-board-page.tsx:52` ("Unset means the API's default: the departments the user manages, else their own"); same default on `/tasks/workload`
- **Evidence:** General Manager at `/tasks/board` (375 px and desktop): filter "الإدارة العامة", "لا مهام في هذه الأقسام". Account Manager at `/tasks/workload`: only General Communication, all zeros, while their client's 18 tasks sit in Design, Content, Photography, Marketing and Development. The spec says the board defaults to the managed departments; it is silent for people who manage none.
- **Impact:** The roles the board is linked for (General Manager, account managers) land on an empty screen and must add departments by hand each time.
- **Suggested fix:** When the user manages no department, default to all departments (General Manager, Operations) or to the departments of the user's clients' open tasks (account managers); record the choice in the F06 spec.

### E2E-05 — "Not found" pages tell the user to reload and report the error

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-page.tsx:54` (shared `LoadError`); same on `/clients/<id>` and `/templates/<id>`
- **Evidence:** `/tasks/00000000-0000-7000-8000-000000000000` (404): "المهمة غير موجودة · أعد تحميل الصفحة. إن تكرر الخطأ فأبلغ فريق العمليات. · أعد المحاولة". An employee opening an archived template link sees "القالب غير موجود" with the same hint. `/clients/not-a-uuid` returns 400 and shows the generic load error.
- **Impact:** Users retry and report errors for records that are simply archived or deleted from the link.
- **Suggested fix:** For 404/400 show a not-found state with a link back to the list and no retry.

### E2E-06 — Queries keep firing after sign-out

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:223`
- **Evidence:** After "سجّل الخروج": `[http 401] GET /api/departments`, `[http 401] GET /api/me/notifications/unread-count`, `[http 401] GET /api/me` with console errors on `/login`.
- **Impact:** Noise only: `signOut()` calls `queryClient.clear()` while the shell is still mounted, so its active queries (departments, unread count, `/api/me`) refetch without a session before the navigation to `/login`.
- **Suggested fix:** Navigate to `/login` first (or cancel queries and close the notification stream), then clear the cache.

### E2E-07 — Missing Madani font files log three 404 errors on every page

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `packages/ui/src/styles/fonts.css:31`, `:44`, `:57`
- **Evidence:** Every page: `GET /fonts/madani/MadaniArabic-{Regular,Medium,Bold}.woff2 → 404` with three console errors. The fallback font renders correctly.
- **Impact:** If the licensed files are not copied to the server, production logs the same errors on every load; they drown real errors in the console.
- **Suggested fix:** Confirm the deploy copies the private fonts (`docs/deployment.md`), or load the `@font-face` block only when the files exist at build time.

### E2E-08 — "Design system" page is in every user's navigation

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:99`
- **Evidence:** Navigation for a plain employee: "… الفريق | الأقسام | نظام التصميم"; `/design-system` renders the component gallery.
- **Impact:** A developer page shown to all ~20 staff in production.
- **Suggested fix:** Show it only in development builds or to General Managers.

### E2E-09 — Requests to a department without a manager notify nobody

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** local data; F14 `task_requested` / `tasks_generated` recipients
- **Evidence:** Content Management has no manager in the local database. The template run left "خطة المحتوى الشهرية والنصوص" unassigned there, and the Designer's request "Audit request: captions for October" went to that queue; no notification was created for anyone (Writer's list empty). Works as specified.
- **Impact:** On production, every department needs a manager before go-live, or unassigned work there goes unseen.
- **Suggested fix:** Add "every department has a manager" to the deploy checklist, or notify the General Manager/Operations manager when a department has none.

## Strengths

- Server-side permissions held on every probe: no 2xx for an action the role lacks, money fields absent for non-money roles, `DEPENDENCY_CYCLE` and duplicate-run conflicts handled.
- Double submits (client, note, comment, template, template run) never created duplicates.
- Validation messages are clear Arabic, field-level, and match the contract rules (phone format, URL, dates, reasons).
- Live notifications work end to end: SSE updates the bell count and shows a toast within about two seconds of another user's action; action-required types cannot be muted.
- The task workflow, revisions and over-limit decision behave as F06 describes; transitions offered in the UI match `allowedTransitions`.
- Sign-in rate limiting is active; the activation token is removed from the URL and single-use.
- No horizontal overflow at 375 px on any page; both themes render correctly.

## Open questions

- Flows still not covered are listed in the header; none of them blocked a Phase 1 core flow.
- E2E-04: which departments should the board and workload show by default for people who manage none? (owner decision; not in `docs/open-questions.md`).
