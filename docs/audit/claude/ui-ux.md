# UI/UX and design audit

- Date: 2026-09-30 · Commit: 9463f9f
- Scope covered: `packages/ui` (tokens in `theme.css`, `base.css`, `fonts.css`, every component), `apps/web/src` (app shell, auth layout, every feature folder, routes, `lib/format.ts`, `lib/errors.ts`), the whole of `apps/web/src/i18n/locales/ar.json` (read line by line for copy, terms, grammar and plurals), a script comparison of i18n keys used in code with keys in `ar.json`, a script check of every Tailwind colour utility against the defined tokens, WCAG contrast computed for the token pairs the components actually combine, and three local E2E screenshots (`notifications-light`, `notification-bell-dark`, `notification-settings-light`) judged as images. Sources: `brand/identity.md`, `AGENTS.md`, `apps/web/CLAUDE.md`, `packages/ui/CLAUDE.md`, ADR 0004 and 0011, `docs/specs/` where a flow was in question.
- Not covered: a live browser walkthrough (area 6). No screenshots are committed to the repo (`git ls-files` has no PNG under `apps/web`); the local `apps/web/test-results/` held only the notifications screens and was wiped mid-audit by a parallel E2E run, so other screens were judged from code only. Findings that depend on rendering at a given viewport are marked `Likely`.
- Checks run: none of the pnpm scripts (per the rules). Ad-hoc read-only scripts in the scratchpad: i18n key usage diff (2277 keys, 14 unused, 0 missing static keys; static keys are also type-checked), colour-token diff (1 undefined token), contrast calculations (node, WCAG 2.x formula).

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| UX-01 | Medium | Navigation does not scroll: items unreachable on short screens and phones | `apps/web/src/components/app-shell.tsx:106` |
| UX-02 | Medium | Dialogs have no max height or scroll by default; long form dialogs overflow on phones | `packages/ui/src/components/dialog.tsx:34` |
| UX-03 | Medium | Dark theme: muted text on muted surface is 4.34:1 (fails AA) in every table header and filter toggle | `packages/ui/src/components/table.tsx:61` |
| UX-04 | Medium | Toggle-group pressed state is nearly invisible (1.17:1) in the multi-select task filters | `packages/ui/src/components/toggle-group.tsx:34` |
| UX-05 | Medium | "مرحلة" and "محطة" swap meaning between the template and project screens | `apps/web/src/i18n/locales/ar.json:2346` |
| UX-06 | Medium | Communication-log time error says the opposite of the rule | `apps/web/src/i18n/locales/ar.json:1665` |
| UX-07 | Medium | Permission, not-found and session errors all say "try again" | `apps/web/src/lib/errors.ts:29` |
| UX-08 | Medium | Actor sentences always use masculine verbs ("ليان الأحمد أرسل") | `apps/web/src/i18n/locales/ar.json:2674` |
| UX-09 | Medium | The design-system page is in every user's navigation in production | `apps/web/src/components/app-shell.tsx:99` |
| UX-10 | Medium | Template editor loses all edits on navigation, and "discard" has no confirmation | `apps/web/src/features/templates/template-page.tsx:162` |
| UX-11 | Low | "إلغاء" (noun) dismisses dialogs next to "ألغِ المهمة"; "تراجع" elsewhere | `apps/web/src/i18n/locales/ar.json:9` |
| UX-12 | Low | Undefined colour token `text-warning-text` | `apps/web/src/features/tasks/task-parts.tsx:147` |
| UX-13 | Low | The same concept has different Arabic terms across screens | `apps/web/src/i18n/locales/ar.json:1118` |
| UX-14 | Low | Mixed tanween spelling (اً / ًا) | `apps/web/src/i18n/locales/ar.json:262` |
| UX-15 | Low | "X من Y" strings ignore Arabic number agreement | `apps/web/src/i18n/locales/ar.json:1685` |
| UX-16 | Low | Two date styles side by side; month names not Levantine | `apps/web/src/lib/format.ts:12` |
| UX-17 | Low | Directional icons not mirrored in RTL (Send, Undo) | `apps/web/src/features/tasks/task-actions.tsx:90` |
| UX-18 | Low | Task links and checklist items are removed in one click, no confirmation or undo | `apps/web/src/features/tasks/task-parts.tsx:310` |
| UX-19 | Low | Board copy points to a «انقل إلى…» button that is icon-only | `apps/web/src/features/tasks/task-board-page.tsx:447` |
| UX-20 | Low | Button and label copy that is not a verb or is ambiguous | `apps/web/src/i18n/locales/ar.json:2145` |
| UX-21 | Low | Brand drift: raw palette steps, dead shadow class, flat retainer meters, pill switch | `apps/web/src/components/auth-layout.tsx:19` |
| UX-22 | Low | Small ascent meter overflows past 14 milestones | `packages/ui/src/components/meter.tsx:43` |
| UX-23 | Low | Multi-combobox focus is a 1 px border colour change, not the 2 px ring | `packages/ui/src/components/multi-combobox.tsx:84` |
| UX-24 | Low | Users land on a placeholder home page after sign-in | `apps/web/src/routes/_app/index.tsx:12` |
| UX-25 | Low | 14 unused i18n keys | `apps/web/src/i18n/locales/ar.json:19` |
| UX-26 | Low | No skip link past the 14-link sidebar | `apps/web/src/components/app-shell.tsx:105` |
| UX-27 | Info | Design screenshots are not committed, so they cannot be reviewed | `apps/web/e2e/screens.spec.ts:16` |
| UX-28 | Info | Lists joined with a hard-coded "، " | `apps/web/src/components/app-shell.tsx:248` |

Counts: Critical 0 · High 0 · Medium 10 · Low 16 · Info 2

## Findings

### UX-01 — Navigation does not scroll: items unreachable on short screens and phones

- **Severity:** Medium
- **Confidence:** Likely (the layout is certain from the code; the cut-off depends on viewport height and was not rendered)
- **Location:** `apps/web/src/components/app-shell.tsx:106`, `:140`, `:145`, `:191`
  `packages/ui/src/components/sheet.tsx:18`
- **Evidence:** The desktop sidebar is `sticky top-0 hidden h-dvh w-64` (`:106`) and its content `flex h-full ... flex-col` (`:140`); the `<nav>` (`:145`) has no `overflow-y-auto`. On phones the same `Sidebar` renders inside `SheetContent`, which is `fixed inset-y-0 start-0 z-50 flex w-72 ... flex-col` with no overflow either. A general manager sees 10 sections and 4 task sub-pages: 64 (header) + 12 + 178 (Tasks group) + 9 × 40 + 9 × 4 gaps + 12 ≈ 662 px. A 1366×768 laptop gives about 620–657 px of viewport; an iPhone SE in Safari about 550 px, landscape phones about 330 px. The overflowing links sit below a sticky/fixed box and cannot be scrolled into view; on desktop they also spill outside the green `bg-sidebar` (light text on a light page). The last links are "سجل التدقيق" and "نظام التصميم" (plus "الأقسام" on phones).
- **Impact:** On common laptops and on phones, managers cannot reach the audit log or departments from the menu. The Phase 1 spec expects staff to use the app on phones (task updates, notifications).
- **Suggested fix:** Make the nav the scrolling region: `className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3"` on the `<nav>` (the header stays fixed). Add an E2E screenshot of the open sheet at 375×667 as GM in `e2e/screens.spec.ts`.

### UX-02 — Dialogs have no max height or scroll by default; long form dialogs overflow on phones

- **Severity:** Medium
- **Confidence:** Likely
- **Location:** `packages/ui/src/components/dialog.tsx:34`
  `apps/web/src/features/clients/contacts-tab.tsx:329`, `apps/web/src/features/clients/platforms-tab.tsx:306`, `apps/web/src/features/clients/client-profile-page.tsx:529`, `apps/web/src/features/clients/communication-tab.tsx:157`, `apps/web/src/features/tasks/task-actions.tsx:298`, `:540`, `apps/web/src/features/projects/milestones-tab.tsx:688`, `apps/web/src/features/projects/extra-work-tab.tsx:620`, `apps/web/src/features/retainers/cycle-tab.tsx:485`, `:594`, `:717` (20 dialogs in total)
- **Evidence:** The base popup is `fixed start-1/2 top-1/2 ... -translate-y-1/2` with no `max-h` or `overflow`. Seven dialogs add `max-h-[90dvh] overflow-y-auto` themselves (`project-actions.tsx:547`, `history-tab.tsx:155`, `retainer-actions.tsx:262`, `:341`, `task-actions.tsx:457`, `generate-dialog.tsx:86`, `step-dialog.tsx:240`); the other 20 do not. The contact dialog alone holds name, job title, phone, email, final-approval switch, notes and footer (about 600 px). A vertically centred fixed box taller than the viewport loses its top and bottom, and neither can be scrolled; with the on-screen keyboard open the visible height is about 350 px.
- **Impact:** On a phone, adding a contact, logging a communication, moving a task with a note or adjusting a retainer count can leave the submit button (or the first fields) out of reach.
- **Suggested fix:** Put `max-h-[calc(100dvh-2rem)] overflow-y-auto` in the base `DialogContent` and `AlertDialogContent` classes and remove the per-call copies. Add a 375×667 screenshot of the contact dialog.

### UX-03 — Dark theme: muted text on muted surface is 4.34:1 (fails AA) in every table header and filter toggle

- **Severity:** Medium
- **Confidence:** Confirmed (computed)
- **Location:** `packages/ui/src/styles/theme.css:179-180` (dark `--muted: green-800`, `--muted-foreground: neutral-400`)
  `packages/ui/src/components/table.tsx:28` (`thead` `bg-muted`) with `:61` and `:88` (`th` `text-muted-foreground`)
  `packages/ui/src/components/toggle-group.tsx:17`, `:31`
  `apps/web/src/features/clients/contacts-tab.tsx:258`, `apps/web/src/features/clients/platforms-tab.tsx:404`, `apps/web/src/features/account/account-page.tsx:276`
- **Evidence:** neutral-400 `#99A09F` on green-800 `#004139` = 4.34:1, below the 4.5:1 AA minimum for 13 px text (`text-sm`, weight 500). `brand/identity.md` §2 only measured neutral-400 on green-900 (5.55) and on green-950, not on the muted surface the components use. The light pair (neutral-600 on neutral-100) passes at 4.88.
- **Impact:** Column headers of every list (team, clients, projects, retainers, tasks, audit), the inactive options of every toggle group, and the contact and platform note blocks are below AA in dark mode.
- **Suggested fix:** In `.dark`, raise `--muted-foreground` to neutral-300 `#B8BFBE` (6.19:1 on green-800, 7.9 on green-900), or keep it and move `thead`/toggle groups to `bg-surface`. Add the pair to the contrast table in `brand/identity.md` and to `tokens.test.ts`.

### UX-04 — Toggle-group pressed state is nearly invisible (1.17:1) in the multi-select task filters

- **Severity:** Medium
- **Confidence:** Confirmed (computed; seen on `notifications-light.png`, "الكل" versus "غير المقروءة")
- **Location:** `packages/ui/src/components/toggle-group.tsx:17`, `:34`
  `apps/web/src/features/tasks/task-list-page.tsx:394-428`
- **Evidence:** Unpressed items sit on `bg-muted`; pressed items get `data-pressed:bg-surface ... data-pressed:ring-1 data-pressed:ring-border`. White on neutral-100 is 1.17:1, the `ring-border` edge is 1.41:1 (dark: green-900 on green-800 is 1.28:1). The only other cue is weight 500 and a text colour shift. WCAG 1.4.11 asks 3:1 for the visual state of a control. The task list uses two multi-select groups: priority (4 options) and status (8 options, 6 pressed by default).
- **Impact:** Users cannot tell which statuses or priorities are applied, so a filtered list looks like a full list; this is the main "All tasks" screen of F06.
- **Suggested fix:** Give the pressed item a stronger cue: `data-pressed:bg-primary data-pressed:text-primary-foreground` (or a 2 px `sidebar-marker`-style underline in accent), and keep `aria-pressed`. Update the design-system screenshot.

### UX-05 — "مرحلة" and "محطة" swap meaning between the template and project screens

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:2346`, `:2349`, `:2363`, `:2371`, `:2409`, `:2501-2502`, `:2549-2553`, `:2601`
  against `:1898`, `:1904-1907`, `:1685`
- **Evidence:** On project screens a project milestone is "مرحلة": tab "المراحل" (`:1898`), "خطة المشروع بالترتيب" (`:1905`). In templates, "مرحلة" is the template stage and the project milestone is renamed "محطة": "قالب المشروع يُطبَّق على مشروع وتصبح مراحله محطات" (`:2346`), "المراحل تصبح محطات المشروع" (`:2349`), generate preview "محطة موجودة / محطة جديدة" (`:2501-2502`), "{{n}} محطات جديدة" (`:2551`), picker "يستبدل المحطات بمراحله" (`:2601`). The word "محطة" appears nowhere on the project page.
- **Impact:** In the F07 "generate from template" flow a manager is told new "محطات" will be created, then finds new "مراحل" on the project; "مرحلة" in the template editor means something different from "مرحلة" one click away. This is a core Phase 1 flow (A03/F07 on projects).
- **Suggested fix:** Use one word for the project milestone everywhere ("مرحلة") and a different one for the template grouping that becomes it, e.g. "مجموعة" or keep "مرحلة" for both and say "تصبح مراحل القالب مراحلَ في المشروع". Replace every "محطة/محطات" in `templates.*`.

### UX-06 — Communication-log time error says the opposite of the rule

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:1665`, shown at `apps/web/src/features/clients/communication-tab.tsx:543`
- **Evidence:** `"occurredAt": "اختر وقتًا لم يأتِ بعد."` literally "choose a time that has not come yet", i.e. a future time. The contract rejects future times: `packages/contracts/src/clients.test.ts:129` expects `occurredAt: later` to fail.
- **Impact:** A user who picked a future time is told to pick a future time; they cannot fix the field from the message.
- **Suggested fix:** "اختر وقتًا مضى، لا يكون في المستقبل." (matches `tasks.form.errors.requestedOn` at `:1163`).

### UX-07 — Permission, not-found and session errors all say "try again"

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/lib/errors.ts:26-31`, `apps/web/src/i18n/locales/ar.json:219`
- **Evidence:** `errorMessage` maps only `ERROR_CODES` from contracts; anything else becomes `t('errors.generic')` = "تعذّر إتمام الطلب. حاول مجددًا." The API throws code-less `ForbiddenException` (`apps/api/src/modules/auth/permissions.guard.ts:71`), `NotFoundException` (e.g. `apps/api/src/modules/auth/departments.service.ts:66`) and 401s when a session expires; none has an `errors.*` entry.
- **Impact:** A user whose permission changed, who acts on a record just archived by someone else, or whose session expired, is told to retry an action that will fail again. The UI hides actions by permission, so 403 is exactly the case where the UI and API disagree and the user most needs a clear message.
- **Suggested fix:** Branch on `error.status` before the generic fallback: 401 → "انتهت جلستك. ادخل من جديد." (and redirect to `/login`), 403 → "لا تملك صلاحية هذا الإجراء.", 404 → "لم يعد هذا السجل موجودًا. حدّث الصفحة." Add unit tests in `lib/errors.test.ts`.

### UX-08 — Actor sentences always use masculine verbs ("ليان الأحمد أرسل")

- **Severity:** Medium
- **Confidence:** Confirmed (visible on `notifications-light.png` and `notification-bell-dark.png`: "ليان الأحمد أرسل «تصاميم منيو الخريف» للمراجعة الداخلية")
- **Location:** `apps/web/src/i18n/locales/ar.json:2674`, `:2675`, `:2677`, `:2680`, `:2684-2687`, `:2690`, `:2697`, `:2711`, `:2725-2726` (notifications)
  `:1920`, `:1980-1982`, `:2565` (milestones, extra work, template runs)
- **Evidence:** Every sentence puts the actor's name before a masculine past-tense verb: "{{actor}} أسند إليك", "{{actor}} أرسل", "{{actor}} علّق", "أنجزها {{name}}", "طلبه {{name}}", "سجّله {{name}}". The fixtures and seed use female staff (ليان الأحمد, سارة الخطيب). `brand/identity.md` §9 asks for clear Modern Standard Arabic.
- **Impact:** For every female colleague the bell, toasts and notification page show grammatically wrong Arabic; it is the most-read text in the app.
- **Suggested fix:** Without a gender field, phrase around the verb: "«{{task}}»: أرسلها {{actor}} للمراجعة" is still gendered, so use nouns: "إرسال «{{task}}» للمراجعة الداخلية — {{actor}}", "إسناد «{{task}}» إليك من {{actor}}", "تعليق من {{actor}} على «{{task}}»", "أُنجزت · {{name}}". Alternatively add an optional grammatical gender to the user profile and use i18next context (`_female`). Log the choice in `docs/open-questions.md`.

### UX-09 — The design-system page is in every user's navigation in production

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:99`, `apps/web/src/routes/_app/design-system.tsx:1`
- **Evidence:** `{ to: '/design-system', label: 'nav.designSystem', icon: SwatchBookIcon, exact: true }` has no `permission` and no `show`, so all ~20 staff see "نظام التصميم" in the sidebar. The page shows sample clients and tasks ("مطعم الياسمين", "عيادة الشفاء", `ar.json:154-158`) that look like real records, and buttons like "أرشف" that do nothing.
- **Impact:** Staff open a developer page, see fake clients next to real ones, and click actions that have no effect. It also takes the last row of a sidebar that already overflows (UX-01).
- **Suggested fix:** Show the item only in development (`import.meta.env.DEV`) or to `internal_operations` managers via `show`; keep the route for the E2E screenshots.

### UX-10 — Template editor loses all edits on navigation, and "discard" has no confirmation

- **Severity:** Medium
- **Confidence:** Confirmed (no `useBlocker`, `beforeunload` or confirmation anywhere in `apps/web/src`)
- **Location:** `apps/web/src/features/templates/template-page.tsx:162-181`
  `apps/web/src/features/clients/brand-kit-form.tsx:188` (same whole-record save)
- **Evidence:** The template editor saves stages, steps, dependencies and default assignees in one submit. When dirty it shows "تعديلات غير محفوظة" (`:164`) but a sidebar click, the back link or closing the tab drops everything. "تجاهل التعديلات" calls `form.reset()` directly (`:169-172`).
- **Impact:** Building a template is the longest editing session in Phase 1 (F07); one misclick loses it. The brand kit form (colours, fonts, files, references) has the same risk.
- **Suggested fix:** Use TanStack Router `useBlocker({ shouldBlockFn: () => form.formState.isDirty, enableBeforeUnload: true })` with the existing `ConfirmDialog` ("تجاهل التعديلات غير المحفوظة؟"), and route "discard" through the same dialog. Cover it in `e2e/f07.spec.ts`.

### UX-11 — "إلغاء" (noun) dismisses dialogs next to "ألغِ المهمة"; "تراجع" elsewhere

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:9` (`common.cancel: "إلغاء"`), `:928`, `:1815`, `:1841`
  `apps/web/src/components/confirm-dialog.tsx:62`, `apps/web/src/features/tasks/task-actions.tsx:366`
- **Evidence:** §9 asks for verbs on buttons; every other button is a verb (احفظ، أغلق، أرشف). In the cancel-task dialog the footer reads "إلغاء" beside the destructive "ألغِ المهمة" (and "ألغِ المشروع"): two buttons that both mean "cancel". The project-cancel dialog alone uses `projects.cancel.keep: "تراجع"` (`:1841`).
- **Impact:** Users hesitate or press the wrong button in the one dialog where the difference matters.
- **Suggested fix:** Set `common.cancel` to "تراجع" and drop `projects.cancel.keep`.

### UX-12 — Undefined colour token `text-warning-text`

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-parts.tsx:147`
- **Evidence:** `className={cn('size-4', gone ? 'text-muted-foreground' : 'text-warning-text')}`. `theme.css` defines `warning-50…700` and `status-warning-foreground` but no `warning-text`; since the palette is reset (`--color-*: initial`) the class generates no CSS and the hourglass inherits the text colour. It was the only undefined colour class found in the script check.
- **Impact:** The "still waiting" dependency icon loses its warning colour, so waiting and finished dependencies look alike apart from the icon shape.
- **Suggested fix:** Use `text-status-warning-foreground`. A token test that fails on unknown colour utilities would catch the next one.

### UX-13 — The same concept has different Arabic terms across screens

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json` lines below
- **Evidence:**
  - Paused client: "متوقف مؤقتًا" (`:1350`, `:1756`) but "العملاء النشطون والمعلّقون" / "نشطًا أو معلّقًا" in the task form (`:1118`, `:1160`); "معلّق" is the project `on_hold` status (`:1700`).
  - Task checklist: "قائمة الخطوات" on the task (`:1146`, `:1220`) but "قائمة المهام" in the audit field list (`:840`).
  - Task due: "تاريخ/وقت الاستحقاق" in the form (`:1111-1112`) but "تاريخ التسليم" / "وقت التسليم" in audit details (`:797`, `:830`).
  - Clearing filters: "امسح التصفية" (`:1067`, `:1725`), "امسح المرشحات" (`:585`, `:1368`), "عوامل التصفية" (`:1693`, `:2618`).
  - Archive verbs in the audit log: "حذف" for archived milestones, extra work, checklist items, links, comments (`:680`, `:703`, `:731`, `:735`, `:740`) but "أزال" for contacts and platform accounts (`:653`, `:658`), while the product rule is archive, never delete.
  - Milestone status `pending` is "قيد التنفيذ" (`:1952`) even for milestones of a project that has not started.
- **Impact:** Users meet two names for one thing (or one name for two things) between the form, the list and the audit log.
- **Suggested fix:** Pick one term per concept (معلّق only for projects; "قائمة الخطوات"; "الاستحقاق" for tasks; "امسح التصفية"; "أزال" for archived child records; milestone `pending` → "لم تُنجز") and add a short glossary to `brand/identity.md` §9.

### UX-14 — Mixed tanween spelling (اً / ًا)

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:262`, `:275`, `:276`, `:281`, `:283`, `:287`, `:728-740`
- **Evidence:** 14 lines write the tanween before the alif ("مطابقاً"، "أولاً"، "منفّذاً"، "بنداً"، "تعليقاً") while 202 lines use the file's convention after it ("أولًا"، "مؤرشفًا").
- **Impact:** Visible inconsistency in error messages and the audit log; also breaks text search for the same word.
- **Suggested fix:** Normalise the 14 lines to "ًا".

### UX-15 — "X من Y" strings ignore Arabic number agreement

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:1685`, `:1887`, `:1921`, `:210`
- **Evidence:** "{{done}} من {{total}} مراحل منجزة", "{{set}} من {{total}} مراحل لها دفعة", "{{delivered}} من {{total}} مهام مُسلَّمة" use the 3–10 plural whatever the total, so a project with one milestone reads "0 من 1 مراحل" and one with 12 reads "3 من 12 مهام". The file already handles plural forms well elsewhere (174 `_zero…_other` keys).
- **Impact:** Minor grammatical errors on project progress, milestone and aria-label text.
- **Suggested fix:** Pluralise on `total` (`count: total`) with `_one/_two/_few/_many/_other`, or rephrase "المنجز {{done}} من {{total}}".

### UX-16 — Two date styles side by side; month names not Levantine

- **Severity:** Low
- **Confidence:** Confirmed (seen on `notifications-light.png`: "2026/09/20، 1:00 م" in one row and "28 سبتمبر 2026" in another)
- **Location:** `apps/web/src/lib/format.ts:12-18` (`dateStyle: 'medium'` gives numeric dates), `:66-74` (long month names), `:2`
- **Evidence:** `formatDateTime` (used for notifications older than a week, audit rows, link expiry, tooltips) renders "2026/09/20، 1:00 م", while `formatCalendarDate` renders "20 سبتمبر 2026". §9: "Numbers and dates formatted consistently". `APP_LOCALE = 'ar-u-nu-latn'` also yields Egyptian/Gulf month names (سبتمبر، أكتوبر); Damascus staff usually read أيلول، تشرين الأول (`ar-SY`).
- **Impact:** Mixed formats on the same list; month names that feel foreign to the team.
- **Suggested fix:** Give `formatDateTime` `{ day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }`. Ask the owner whether to switch to `ar-SY-u-nu-latn` (see Open questions).

### UX-17 — Directional icons not mirrored in RTL (Send, Undo)

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-actions.tsx:90-91`, `:97` (`SendIcon`, `UndoIcon`)
  `apps/web/src/features/tasks/task-comments.tsx:273`, `apps/web/src/features/tasks/my-tasks-page.tsx:175`, `apps/web/src/features/tasks/new-task-page.tsx:262`, `apps/web/src/features/tasks/task-list-page.tsx:547`
- **Evidence:** §6: "Directional icons mirror in RTL". Arrows, chevrons and log-out are mirrored correctly (`ltr:-scale-x-100`), but the paper plane of "أرسل للمراجعة"/"علّق" points to the top-right and the undo arrow of "أعد للتعديل" curls left-to-right.
- **Impact:** Small; the send and return icons point against the reading direction.
- **Suggested fix:** Add `className="rtl:-scale-x-100"` to `SendIcon` and `UndoIcon` uses (or in `MOVE_ICONS` rendering).

### UX-18 — Task links and checklist items are removed in one click, no confirmation or undo

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-parts.tsx:310-318`, `:415-429`
- **Evidence:** The ✕ buttons call `remove.mutateAsync(...)` directly. The records are archived server-side but the UI offers no way back, and no toast confirms the removal. Comments, contacts, platform accounts and milestones all confirm first (`removeTitle` keys).
- **Impact:** A mis-tap next to the reorder arrows (all three are 32 px ghost buttons in a row) silently loses a checklist step or a Drive link.
- **Suggested fix:** Show a toast with an "تراجع" action that restores (needs a restore endpoint), or a light `ConfirmDialog` for links. At minimum a success toast.

### UX-19 — Board copy points to a «انقل إلى…» button that is icon-only

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-board-page.tsx:447-457`, `apps/web/src/i18n/locales/ar.json:1292`, `:1300`
- **Evidence:** The subtitle says "اسحب البطاقة إلى عمود مسموح أو استخدم «انقل إلى…»", but the trigger shows only `MoveIcon`; the text exists only in `aria-label` and there is no `title` tooltip.
- **Impact:** Sighted keyboard and touch users cannot find the named control; on touch screens (no HTML drag) this menu is the only way to move a card.
- **Suggested fix:** Add `title={t('tasks.board.moveTo', …)}`, or render a small text button "انقل إلى…" at the card's end.

### UX-20 — Button and label copy that is not a verb or is ambiguous

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/i18n/locales/ar.json:2145`, `:412`, `:520`, `:319`, `:1245`
- **Evidence:** Button "البنود" edits a retainer's lines (`retainers.actions.editLines`, rendered at `retainer-actions.tsx:336`); menu item "رابط إعادة تعيين كلمة المرور" next to the verb "انسخ رابط التفعيل"; button "رموز احتياطية جديدة"; column header "خطوتان" for two-factor; revision label "من العميل رقم {{number}}" reads as "from client number N".
- **Impact:** Actions that do not say what they do; §9 asks for verbs on buttons.
- **Suggested fix:** "عدّل البنود"، "انسخ رابط إعادة التعيين"، "أنشئ رموزًا احتياطية جديدة"، "التحقق بخطوتين"، "تعديل العميل رقم {{number}}".

### UX-21 — Brand drift: raw palette steps, dead shadow class, flat retainer meters, pill switch

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/auth-layout.tsx:19-22`
  `apps/web/src/features/tasks/task-board-page.tsx:376`
  `apps/web/src/features/retainers/cycle-tab.tsx:203`, `:224`, `:356`, `apps/web/src/features/retainers/retainer-badges.tsx:140`
  `packages/ui/src/components/switch.tsx:10`
- **Evidence:** The auth panel uses `bg-green-800 ... dark:bg-green-900`, `text-gold-400`, `text-neutral-300` (the only raw palette steps in app code; `packages/ui/CLAUDE.md` says semantic tokens only). The board card has `shadow-xs`, but shadows are reset to `shadow-float` only, so it renders nothing (and §4 says borders, not shadows, for cards). §5 says "the retainer deliverables meter drawn as ascending stepped bars reaching a peak"; retainers use the flat `Meter` while `AscentMeter` is used only for project milestones. The switch track is `rounded-full`; §4 allows full rounding only for avatars and status dots.
- **Impact:** Small inconsistencies that spread when copied; the brand's signature "goal met" moment is missing from the feature it was designed for.
- **Suggested fix:** Use `bg-sidebar text-sidebar-marker text-sidebar-muted-foreground` in the auth panel; drop `shadow-xs`; decide with the owner whether retainer lines should use `AscentMeter` (it overflows for large quantities, see UX-22); give the switch `rounded-md` or record an exception in §4.

### UX-22 — Small ascent meter overflows past 14 milestones

- **Severity:** Low
- **Confidence:** Confirmed (arithmetic)
- **Location:** `packages/ui/src/components/meter.tsx:43-46`, `:83-86`, `apps/web/src/features/projects/project-badges.tsx:118`
- **Evidence:** `size="sm"` is `h-4 w-20` (80 px) with `gap-1` and bars of `min-w-0.5`; n bars need 2n + 4(n−1) px, which exceeds 80 px at n = 15. Projects allow 30 milestones (`PROJECT_LIMITS` in `packages/contracts/src/projects.ts:55`), and template generation can add many.
- **Impact:** In the projects list the meter spills over the "3/20" count and the next cell.
- **Suggested fix:** Above a threshold (e.g. 12) scale the gap to `gap-px` or fall back to the flat `Meter`.

### UX-23 — Multi-combobox focus is a 1 px border colour change, not the 2 px ring

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `packages/ui/src/components/multi-combobox.tsx:84`, `:94`, `:110`
- **Evidence:** The input is `outline-none`; focus shows only through `focus-within:border-primary` on the group (neutral-500 → green-800, 2.95:1 between the two states, 1 px). Every other control uses the global `:focus-visible` 2 px gold ring (`base.css:28-31`, §2).
- **Impact:** Keyboard users lose track of focus on the department, skills and dependency pickers.
- **Suggested fix:** Replace with `focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring` on the group.

### UX-24 — Users land on a placeholder home page after sign-in

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/routes/_app/index.tsx:12-41`, `apps/web/src/routes/login.tsx:42`
- **Evidence:** The home page shows "أدوارك" (role badges) and "حالة النظام: يعمل" (a health probe). Sign-in without a `redirect` goes to `/`. Dashboards are F15 (later phase).
- **Impact:** Every sign-in starts on a page with nothing to act on; staff must then open "مهامي".
- **Suggested fix:** Until F15, redirect `/` to `/tasks` (My tasks) for everyone, or render My tasks' summary tiles on the home page. Move the health badge to the audit or design-system page.

### UX-25 — 14 unused i18n keys

- **Severity:** Low
- **Confidence:** Confirmed (script over `apps/web/src`, including template-literal prefixes and plural suffixes; each hit re-checked with grep)
- **Location:** `apps/web/src/i18n/locales/ar.json:19` (`common.copy`), `:23` (`common.all`), `:28` (`common.continue`), `:195` (`designSystem.controls`), `:311` (`users.count`), `:489` (`account.profile`), `:587-590` (`audit.columns.*`), `:601` (`audit.noDetails`), `:1422-1423` (`clients.profile.contactsCount`, `platformsCount`), `:2625` (`notifications.actions`)
- **Evidence:** No `t('…')` or dynamic prefix reaches these keys. No missing keys were found (static keys are also type-checked through `i18next.d.ts`).
- **Impact:** Dead copy that translators and reviewers keep maintaining.
- **Suggested fix:** Delete them, or wire `audit.noDetails` into the audit row when a change has no details.

### UX-26 — No skip link past the 14-link sidebar

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:105-113`
- **Evidence:** The sidebar (up to 14 links) and the top bar come before `<main>` on every page; there is no "تخطَّ إلى المحتوى" link (WCAG 2.4.1).
- **Impact:** Keyboard users tab through the whole navigation on every page change.
- **Suggested fix:** Add a visually hidden, focus-visible link at the top of `AppShell` to `#main` and give `<main id="main" tabIndex={-1}>`.

### UX-27 — Design screenshots are not committed, so they cannot be reviewed

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/e2e/screens.spec.ts:16`, `apps/web/CLAUDE.md` ("Every new screen gets RTL screenshots in both themes")
- **Evidence:** `git ls-files` has no PNG under `apps/web`; screenshots are written to the git-ignored `test-results/` and are overwritten by the next run (they disappeared during this audit when another run started).
- **Impact:** The "design review evidence" named in the spec file cannot be looked at in a PR or an audit.
- **Suggested fix:** Upload `test-results/**/*.png` as a CI artifact on every run, or use `toHaveScreenshot` baselines committed for a small set of key screens.

### UX-28 — Lists joined with a hard-coded "، "

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:248`, `apps/web/src/features/projects/project-badges.tsx:99`, `apps/web/src/features/templates/generate-dialog.tsx:520`, `apps/web/src/features/templates/template-editor.tsx:683`, `apps/web/src/features/templates/template-page.tsx:134`, `apps/web/src/features/users/team-page.tsx:338`
- **Evidence:** `.join('، ')` in code, i.e. user-facing punctuation outside `ar.json`.
- **Impact:** None visible today; "A، B، C" instead of the natural "A وB وC".
- **Suggested fix:** A `formatList` helper in `lib/format.ts` using `Intl.ListFormat(APP_LOCALE, { type: 'conjunction' })`.

## Strengths

- Tokens are strict: Tailwind's palette, radii and shadows are reset in `theme.css`, so ad-hoc colours cannot compile; the only colour slip found was one undefined class (UX-12). No hex, no physical left/right classes, no italic or letter-spacing anywhere in `apps/web` or `packages/ui`.
- RTL is handled with care: logical properties throughout, mirrored arrows and chevrons, `dir="ltr"` on every email, phone, URL and code, dialogs and sheets centred and animated per direction, switch thumb direction correct (checked in the settings screenshot).
- Arabic plurals are done properly with all six i18next Arabic forms in about 30 strings; copy is concise, mostly imperative, with no exclamation marks.
- Accessibility basics are consistent: labelled fields through `Field`, `role="alert"` on `FormAlert` and `LoadError`, `aria-sort` on sortable headers, `aria-pressed` on filter buttons, `aria-label` on every icon button, a keyboard alternative for board drag (move menu) and milestone and checklist reordering (up/down buttons).
- Consistent patterns: every list has loading, empty (filtered vs never-used) and error states; destructive record actions go through `ConfirmDialog` with a body that explains archive versus end.
- Light-theme token pairs all pass AA as computed; the dark theme is a faithful sand-on-green inverse.

## Open questions

- Gender in UI copy (UX-08): phrase around it, or store a grammatical gender per user? Not in `docs/open-questions.md` yet.
- Month names (UX-16): Levantine (أيلول، تشرين الأول) through `ar-SY`, or the current Egyptian/Gulf names? Related to Q3 (digits), which is resolved as Latin digits.
- Should retainer lines use the ascent meter that `brand/identity.md` §5 designed for them (UX-21), given quantities up to 999?
- What should the home page show before F15 dashboards (UX-24)?
