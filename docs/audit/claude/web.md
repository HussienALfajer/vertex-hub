# Web code quality audit

- Date: 2026-09-30 · Commit: 9463f9f
- Scope covered: `apps/web/src` (routes, `features/*` for auth/account, users/team, departments, clients, projects, retainers, tasks/board/workload/My tasks, templates, notifications, audit; `components/`, `lib/`, `main.tsx`), `packages/ui/src/components` (toast, pagination, spot checks), `apps/web/vite.config.ts`, against `AGENTS.md`, `apps/web/CLAUDE.md`, `packages/ui/CLAUDE.md`, ADR 0013 (Web), specs F01, F02, F05, F06, F07, F14. Cross-checked the API where the web relies on it (task cascade on project cancel, task visibility rules, comment ordering, list defaults, users list permissions, error codes, nginx HTTP/2 for SSE).
- Not covered: pixel-level UI, copy and RTL (area 4); running the app or the test suites (areas 5 and 6); built bundle size (reading `dist/` is out of bounds, so bundle findings are limited to configuration). `design-system.tsx`, `audit-value.tsx`, `brand-kit-form.tsx`, `communication-tab.tsx`, `contacts-tab.tsx`, `platforms-tab.tsx`, `extra-work-tab.tsx`, `history-tab.tsx` were skimmed via targeted greps, not read line by line.
- Checks run: read-only greps and scripts only. A Python scan confirmed every code in `ERROR_CODES` has an `errors.<code>` string in `ar.json` (70/70), every `code === '…'` comparison in the web uses a known code, and the API throws no code outside `ERROR_CODES`. Greps found no `any`, no non-null assertions and no `@ts-ignore` in `apps/web/src`. No `pnpm` commands were run.

## Summary

| ID | Severity | Title | Location |
|---|---|---|---|
| WEB-01 | Medium | Archiving or cancelling a client, project or retainer leaves task views stale | `apps/web/src/features/projects/projects.queries.ts:40` |
| WEB-02 | Medium | Task comments stop at 100: newer comments never show | `apps/web/src/features/tasks/tasks.queries.ts:49` |
| WEB-03 | Medium | Session expiry keeps the previous user's cache and loses the page | `apps/web/src/main.tsx:22` |
| WEB-04 | Low | Notification read/unread actions fail silently | `apps/web/src/features/notifications/notification-item.tsx:33` |
| WEB-05 | Low | A page past the end shows "no records" with no way back | `apps/web/src/features/users/team-page.tsx:108` |
| WEB-06 | Low | URL filter parsing is hand-written, duplicated and inconsistent | `apps/web/src/features/clients/clients-page.tsx:72` |
| WEB-07 | Low | Background refetch silently discards unsaved edits | `apps/web/src/features/templates/template-page.tsx:67` |
| WEB-08 | Low | Some form submits fail without any message | `apps/web/src/features/tasks/task-actions.tsx:528` |
| WEB-09 | Low | Ctrl+Enter in the comment box skips the pending guard | `apps/web/src/features/tasks/task-comments.tsx:240` |
| WEB-10 | Low | Dependent pickers briefly offer the previous client's projects and tasks | `apps/web/src/features/tasks/task-form.tsx:477` |
| WEB-11 | Low | Clipboard copy has no error handling (activation links) | `apps/web/src/lib/clipboard.ts:10` |
| WEB-12 | Low | Design-system page is in every user's production navigation | `apps/web/src/components/app-shell.tsx:99` |
| WEB-13 | Low | Fat route files against the thin-route rule | `apps/web/src/routes/login.tsx:15` |
| WEB-14 | Low | Option and name lookups capped at 100 rows | `apps/web/src/features/audit/audit-page.tsx:174` |
| WEB-15 | Info | Search-box debounce copied into six pages | `apps/web/src/features/clients/clients-page.tsx:190` |
| WEB-16 | Info | Every task mutation refetches all task, project and retainer queries | `apps/web/src/features/tasks/tasks.queries.ts:85` |
| WEB-17 | Info | Stream events parsed without a guard | `apps/web/src/features/notifications/notification-stream.ts:52` |

Counts: Critical 0 · High 0 · Medium 3 · Low 11 · Info 3

## Findings

### WEB-01 — Archiving or cancelling a client, project or retainer leaves task views stale

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/projects/projects.queries.ts:40`
  `apps/web/src/features/retainers/retainers.queries.ts:81`
  `apps/web/src/features/clients/clients.queries.ts:90`
  `apps/web/src/features/tasks/project-tasks-tab.tsx:45`
- **Evidence:** Project mutations refresh only the `projects` cache:
  ```ts
  onSettled: () => queryClient.invalidateQueries({ queryKey: projectsKeys.all }),
  ```
  Client mutations refresh only `clients` (`clients.queries.ts:94`), and retainer mutations refresh only `retainers` and `['templates','retainer']` (`retainers.queries.ts:86-89`). The API changes tasks as a side effect of these calls:
  - cancelling a project cancels its open tasks (`apps/api/src/modules/tasks/task-hooks.service.ts:91-112`, F06 "cascade cancel");
  - archiving a client, project or retainer hides its tasks from every list, the board and the summary (`tasks.service.ts:709-714`, `visibleSql()` checks `clients.isLive` and `engagements.isLive`);
  - resuming or reactivating a retainer opens a cycle, and that generates template tasks (F07 rule 16).

  This breaks the rule in the task brief and ADR 0013 (Web) that server state stays consistent after a mutation.
- **Impact:** Take a manager on a project's Tasks tab who cancels the project from the header. The tab badge (`project.tasks.open`, refreshed from `projects`) drops to 0, but the list under it (`taskListQuery`, key `tasks`) still shows every task as open until the window regains focus or the tab remounts. The same happens on a client's Tasks tab after the client is archived. Any mounted task view (board, list, My tasks in another pane) keeps showing hidden or cancelled tasks.
- **Suggested fix:** In `useProjectsMutation`, `useRetainersMutation` and `useClientsMutation`, also invalidate `tasksKeys.all` (`['tasks']`). At minimum, do this for status changes, archive and restore. Guard it with an E2E step: cancel a project while its Tasks tab is open, then assert the rows show "cancelled".

### WEB-02 — Task comments stop at 100: newer comments never show

- **Severity:** Medium
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/tasks.queries.ts:49`
  `apps/web/src/features/tasks/task-comments.tsx:41`
- **Evidence:**
  ```ts
  /** Every comment of a task, oldest first (a task holds far fewer than the page maximum). */
  export const taskCommentsQuery = (id: string) => queryOptions({ ...
      api.GET('/api/tasks/{id}/comments', { params: { path: { id }, query: { pageSize: 100 } } })
  ```
  The API sorts oldest first (`apps/api/src/modules/tasks/task-comments.service.ts:53`, `orderBy(asc(taskComments.createdAt))`). `TASK_LIMITS` sets no comment limit (`packages/contracts/src/tasks.ts:86-91`), and the UI never reads `total`. This breaks the F06 screen 6 requirement ("comments with @mention picker") that the whole conversation shows.
- **Impact:** On a long-running task (a retainer's recurring work, a disputed revision) with more than 100 comments, the newest comments are exactly the ones that never appear. A newly posted comment "succeeds" but does not show, and @mentions look lost.
- **Suggested fix:** Use an infinite query with a "Show older" or "Show newer" control (the same pattern as `notesQuery`), or ask the API for the newest page and render it in reverse. At the least, show a notice when `total > items.length`. Add a unit or E2E test with 101 comments.

### WEB-03 — Session expiry keeps the previous user's cache and loses the page

- **Severity:** Medium
- **Confidence:** Confirmed (code path); the cross-user flash is Likely in practice (it needs a different user signing in in the same tab)
- **Location:** `apps/web/src/main.tsx:22`
  `apps/web/src/routes/login.tsx:35`
- **Evidence:**
  ```ts
  } else if (error.status === 401) {
    queryClient.setQueryData(['me'], null);
    void router.navigate({ to: '/login' });
  }
  ```
  Only `me` is cleared, and no `redirect` search is passed. Sign-out, by contrast, calls `queryClient.clear()` (`components/app-shell.tsx:225`). After sign-in, `enter()` refetches only `me` (`login.tsx:37`) and then navigates to `/` (the redirect target was dropped). This breaks F01 edge case handling ("a 401 means the session ended") and the privacy expectation that one user's data is not shown to another.
- **Impact:**
  1. When a session expires mid-work (including inside a mutation, which also routes through `MutationCache.onError`), the user lands on `/login` and after signing in goes home instead of back to the page. Any unsaved dialog content is gone.
  2. If a different person signs in in that tab, every cached list (clients, tasks, notifications bell, audit) renders the previous user's data until each query refetches. With `staleTime` 0 this is a brief flash, but it shows records outside the new user's scope.
- **Suggested fix:** On 401, call `queryClient.clear()` (or `removeQueries` except `me`) and navigate with `search: { redirect: router.state.location.href }`. Add an E2E test: mock a 401 on a list request, then assert the redirect param and an empty cache.

### WEB-04 — Notification read/unread actions fail silently

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/notifications/notification-item.tsx:33`
  `apps/web/src/features/notifications/notifications-page.tsx:94`
  `apps/web/src/features/notifications/notifications-page.tsx:201`
  `apps/web/src/features/notifications/notification-bell.tsx:76`
  `apps/web/src/features/notifications/notification-stream.ts:131`
- **Evidence:** `markRead.mutate(notification.id)`, `markUnread.mutate(...)` and `markAll.mutate()` pass no `onError`. The hooks (`notifications.queries.ts:90-114`) only have `onSuccess`, and the global `MutationCache.onError` handles only 401 and 403. This breaks `apps/web/CLAUDE.md`: "Server errors show the translation of their `code`".
- **Impact:** A failed "Mark all as read" or row toggle does nothing visible. The unread dot and count stay, and the user retries without knowing why.
- **Suggested fix:** Add `onError: (error) => toast.add({ title: errorMessage(t, error), type: 'error' })` inside the hooks or at each call site.

### WEB-05 — A page past the end shows "no records" with no way back

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/users/team-page.tsx:108`
  `apps/web/src/features/clients/clients-page.tsx:141`
  `apps/web/src/features/projects/projects-page.tsx:168`
  `apps/web/src/features/retainers/retainers-page.tsx:169`
  `apps/web/src/features/tasks/task-list-page.tsx:247`
  `apps/web/src/features/templates/templates-page.tsx:107`
  `apps/web/src/features/notifications/notifications-page.tsx:140`
  `apps/web/src/features/audit/audit-page.tsx:117`
- **Evidence:** Each list renders its empty state when `data.items.length === 0` without checking `page`, and the `Pagination` component, the only control that moves back, is rendered only in the non-empty branch.
- **Impact:** Page 2 empties when its last record is archived or finished elsewhere, or when an old bookmarked `?page=5` is opened. The user then sees "No tasks yet / create one" (or similar) even though `total > 0`, and has no button back to page 1.
- **Suggested fix:** When `items.length === 0 && page > 1 && total > 0`, navigate (replace) to the last valid page, or render the pagination alongside the empty state. One shared helper would cover all eight lists.

### WEB-06 — URL filter parsing is hand-written, duplicated and inconsistent

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/clients/clients-page.tsx:72`
  `apps/web/src/features/projects/projects-page.tsx:94`
  `apps/web/src/features/retainers/retainers-page.tsx:93`
  `apps/web/src/features/users/team-page.tsx:53`
  `apps/web/src/features/projects/new-project-page.tsx:52`
  `apps/web/src/features/retainers/new-retainer-page.tsx:48`
  `apps/web/src/features/tasks/task-list-page.tsx:114` (and `task-board-page.tsx:59`, `new-task-page.tsx:67`, `project-page.tsx:67`)
- **Evidence:** Clients, projects, retainers, team, new project and new retainer accept any string up to 36 characters as an id (`accountManagerId: text(search.accountManagerId, 36)`, `search.clientId.length <= 36`). The task pages and audit check a UUID regex instead, and the same `const UUID = /^[0-9a-f]{8}-…$/i` is declared four times. Every page re-implements the list query rules that `packages/contracts` already holds (`clientListQuerySchema`, `taskListQuerySchema`, …). This breaks AGENTS.md ("One validation source … Don't duplicate schemas") and the task brief's URL-validation check.
- **Impact:** A malformed `?clientId=abc` on `/projects` is sent to the API, which answers 400, and the page shows its load-error state instead of ignoring the bad filter as the parse comment promises ("dropping anything malformed"). Each new list page copies the drift further.
- **Suggested fix:** Build `validateSearch` from the contract list schemas: pick the URL-facing fields and `.catch(undefined)` each one, so invalid values drop. Put a shared `uuidParam`/`pageParam` helper in `src/lib`. Add a unit test per parser for malformed ids.

### WEB-07 — Background refetch silently discards unsaved edits

- **Severity:** Low
- **Confidence:** Likely (needs a concurrent change by another user or tab)
- **Location:** `apps/web/src/features/templates/template-page.tsx:67`
  `apps/web/src/features/clients/client-profile-page.tsx:488` (and the other `useForm({ values: … })` forms: `contacts-tab.tsx:290`, `platforms-tab.tsx:263`, `milestones-tab.tsx:645`, `extra-work-tab.tsx:376`, `project-actions.tsx:494`, `retainer-actions.tsx:211`, `retainer-actions.tsx:299`, `cycle-tab.tsx:459`)
- **Evidence:** The template form remounts on every stored change: `key={`${template.data.updatedAt}:${template.data.archivedAt ?? ''}`}`. The other forms take server data through RHF's `values` prop, which resets the form whenever the fetched data changes. Queries refetch on window focus by default.
- **Impact:** A manager spends minutes editing a template's steps and switches windows. If a colleague saved the template meanwhile, the refetch changes `updatedAt` and the editor's unsaved work vanishes without a word. The same applies to an open edit dialog on a client, contact or milestone. The risk is small at ~20 users, but the loss is silent.
- **Suggested fix:** Key the template editor only on `archivedAt` and on the user's own save. Use `resetOptions: { keepDirtyValues: true }` on `values:` forms, or pass `defaultValues` captured when the dialog opens. When the stored `updatedAt` differs from the loaded one, show a "changed by someone else" callout.

### WEB-08 — Some form submits fail without any message

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-actions.tsx:528`
  `apps/web/src/features/tasks/task-parts.tsx:334`
  `apps/web/src/features/retainers/retainer-form.tsx:320`
- **Evidence:**
  - `ReassignDialog`: `if (!parsed.success) return;` shows no failure.
  - `AddChecklistItem` uses `standardSchemaResolver(createTaskChecklistItemSchema)` but renders no `FieldError`, so an empty or whitespace item does nothing on submit.
  - `parseLines` maps only `label` and `monthlyQuantity` issues. Any other issue (for example, too many lines) returns `null` with no message.

  This breaks `apps/web/CLAUDE.md` (errors through `FormAlert`, `role="alert"`).
- **Impact:** The user clicks Save or Add and nothing happens.
- **Suggested fix:** Set a `FormAlert` or field error in each branch (`t('errors.generic')` or a specific key), and add a `FieldError` under the checklist input.

### WEB-09 — Ctrl+Enter in the comment box skips the pending guard

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/task-comments.tsx:240`
- **Evidence:** The Send button is `disabled={pending || !draft.trim()}` (line 272). The keyboard path calls `void submit()` directly, and `submit()` never checks `pending`.
- **Impact:** Pressing Ctrl+Enter twice, or once more while a slow request runs, posts the same comment twice, with duplicate mention notifications.
- **Suggested fix:** Return early in `submit()` when `pending` is true.

### WEB-10 — Dependent pickers briefly offer the previous client's projects and tasks

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/web/src/features/tasks/task-form.tsx:477`
  `apps/web/src/features/tasks/task-form.tsx:820`
- **Evidence:** `EngagementFields` and `useDependencyOptions` read `projectListQuery`, `retainerListQuery` and `taskListQuery`, which all set `placeholderData: keepPreviousData` (`projects.queries.ts:27`, `retainers.queries.ts:38`, `tasks.queries.ts:39`). When the client field changes, the previous client's projects, cycles and open tasks stay listed until the new request returns.
- **Impact:** A quick pick right after changing the client submits a mismatched link, and the API refuses it (`INVALID_LINK` / `INVALID_DEPENDENCY`). The refusal is mapped to the field, so there is no data harm, only a confusing error.
- **Suggested fix:** Override with `placeholderData: undefined` in these pickers, or hide options while `isPlaceholderData`.

### WEB-11 — Clipboard copy has no error handling (activation links)

- **Severity:** Low
- **Confidence:** Likely
- **Location:** `apps/web/src/lib/clipboard.ts:10`
  `apps/web/src/features/users/link-dialog.tsx:63`
- **Evidence:** `await navigator.clipboard.writeText(text);` has no try/catch, and the caller does `onClick={() => copy(link.url)}`.
- **Impact:** When the Clipboard API refuses (the document is not focused, a permission policy blocks it, or a non-HTTPS preview), the promise rejects unhandled and the button gives no feedback. Activation links are the only onboarding path until email exists (F01, Q5). The input's select-on-focus lets the user copy by hand, so the fallback exists but is not signalled.
- **Suggested fix:** Catch the rejection, select the input text, and show a toast ("select and copy the link").

### WEB-12 — Design-system page is in every user's production navigation

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/components/app-shell.tsx:99`
- **Evidence:** `{ to: '/design-system', label: 'nav.designSystem', icon: SwatchBookIcon, exact: true },` has no `permission`, no `show` and no `import.meta.env.DEV` check. No spec lists it as a staff screen.
- **Impact:** All ~20 staff see a developer component gallery as a main navigation item after the deploy.
- **Suggested fix:** Show the item only in development (`import.meta.env.DEV`) or to `users.manage` holders. Keep the route for the screenshot tests.

### WEB-13 — Fat route files against the thin-route rule

- **Severity:** Low
- **Confidence:** Confirmed
- **Location:** `apps/web/src/routes/login.tsx:15` (273 lines: page, three forms, step links)
  `apps/web/src/routes/_app/index.tsx:12` (home page and system status card)
- **Evidence:** ADR 0013 Web says "Route files stay thin: loader and guard, then the page component from `features/<module>/`", and `apps/web/CLAUDE.md` says the same. All other routes follow it. Separately, no route defines a `loader`: data loads in components, so `defaultPreload: 'intent'` (`main.tsx:43`) preloads code only. This is allowed, but it means a hover prefetches no data.
- **Impact:** The pattern agents copy from drifts. Login logic (2FA steps, redirect) is not in `features/account` beside the other auth screens.
- **Suggested fix:** Move `LoginPage` and its forms to `features/account/login-page.tsx` and the home page to `features/home/`. Optionally add `loader: ({ context }) => context.queryClient.ensureQueryData(...)` on detail routes for hover prefetch.

### WEB-14 — Option and name lookups capped at 100 rows

- **Severity:** Low
- **Confidence:** Likely (depends on data growth)
- **Location:** `apps/web/src/features/audit/audit-page.tsx:174`
  `apps/web/src/features/tasks/task-form.tsx:820`
  `apps/web/src/features/tasks/task-comments.tsx:189`
- **Evidence:** Audit names for projects and retainers come from `projectListQuery({ status: [...PROJECT_STATUSES], pageSize: 100 })`. Dependency options come from `taskListQuery({ …, pageSize: 100 })`, and the mention picker from `userListQuery({ pageSize: 100 })`. None of them reads `total`.
- **Impact:** Users and clients stay well under 100, so those lists are fine. Projects accumulate over the years, though, and once there are more than 100 the audit log shows raw ids for older ones. A client or the internal queue with more than 100 open tasks loses dependency options silently.
- **Suggested fix:** Resolve audit names from the entries (the API can embed names), and use a searchable async picker for dependencies. Until then, show a "refine search" hint when `total > items.length`.

### WEB-15 — Search-box debounce copied into six pages

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/clients/clients-page.tsx:190`
  `projects/projects-page.tsx:324`, `retainers/retainers-page.tsx:339`, `tasks/task-list-page.tsx:323`, `templates/templates-page.tsx:151`, `users/team-page.tsx:152`
- **Evidence:** The same two `useEffect` blocks (sync the text from the URL, then a 300 ms debounce into `onChange({ search })`) appear six times. `const ALL = 'all'` appears in nine files.
- **Impact:** None today. Fixes (for example, the page reset) must be applied six times.
- **Suggested fix:** Add a `useDebouncedSearch(search.search, onChange)` hook in `src/lib`.

### WEB-16 — Every task mutation refetches all task, project and retainer queries

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/tasks/tasks.queries.ts:85`
- **Evidence:** `useTasksMutation` invalidates `['tasks']`, `['projects']`, `['retainers']` and `['templates','retainer']` for every call, including ticking a checklist item or posting a comment.
- **Impact:** Correct but broad. The task page refetches its detail, its comments and any other mounted task list on each tick. That is fine at the current scale; note it before adding heavier views.
- **Suggested fix:** Optionally narrow comment and checklist mutations to `tasksKeys.detail(id)` and `tasksKeys.comments(id)`.

### WEB-17 — Stream events parsed without a guard

- **Severity:** Info
- **Confidence:** Confirmed
- **Location:** `apps/web/src/features/notifications/notification-stream.ts:52`
- **Evidence:** `JSON.parse((message as MessageEvent<string>).data) as NotificationStreamEvent` has no try/catch and no schema check, although `notificationStreamEventSchema` exists in `packages/contracts/src/notifications.ts:266`.
- **Impact:** A malformed or future-shaped event throws inside the listener. The stream keeps running, but the event is lost without a trace.
- **Suggested fix:** Wrap it in try/catch, or `safeParse` with the contract schema and fall back to `refreshNotifications`.

## Strengths

- Query keys are uniform (`<module>Keys` factories with `all/list/detail`), mutations live in `<module>.queries.ts`, and every mutation hook invalidates its module on settle, including on failure, so a 403 after a scope change reloads without the lost actions.
- Error handling is centralised: `call()` → `ApiError`, `errorMessage()` never shows server text, all 70 error codes have translations, and forms map codes to fields (`FIELD_OF_CODE` in task, project and retainer forms).
- Forms consistently use contract schemas through `standardSchemaResolver`, and dirty-field diffs send only changed fields.
- UI permission hiding relies on server-computed `permissions` / `allowedTransitions` / `readOnly` per record; scope helpers (`task-access.ts`, `project-access.ts`) match the F06 and F05 scope tables.
- The SSE client is well built: one connection in the shell, cleanup on unmount, the browser's own reconnect, a refresh on reopen and on focus, a 30 s retry after an auth refusal, and cache updates that cancel in-flight requests. The deploy serves HTTP/2, so many tabs do not exhaust connections.
- Type safety is strong: no `any`, no non-null assertions, and only narrow `as` casts on Select values.
- `autoCodeSplitting` is on, and every page, `qrcode.react` included, loads per route.
- Loading, empty and error states exist on every page reviewed.

## Open questions

- WEB-12: should the design-system page stay reachable in production (for example, for the owner)? Owner decision; it is not listed in `docs/open-questions.md`.
- WEB-02: is there an intended cap on comments per task? F06 sets none. If a cap is wanted, it belongs in `TASK_LIMITS` and the API.
