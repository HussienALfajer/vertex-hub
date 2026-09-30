# Web code quality audit

## Scope and revision

Date: 2026-09-30 (Asia/Damascus). Revision: `9463f9f4366c133ec55bfa577c1fa08605581554`, branch `docs/phase-1-audit`. This area covers the authored web application, its shared contracts and UI interactions, Phase 0 infrastructure and completed Phase 1 features F01, F02, F05, F06, F07 and F14. Review followed the [audit plan](README.md), `apps/web/CLAUDE.md`, `packages/ui/CLAUDE.md`, ADRs 0003 and 0013, and the relevant feature specs. Application code and business data were not changed.

Depth: inventory and structural scans across authored routes/features/infrastructure, focused source tracing of queries, mutations, forms and list behavior, and safe web type/unit checks. This is not an exhaustive live test of every screen. Visual assessment and browser navigation belong to the [UI/UX](ui-ux-design.md) and [browser](browser-walkthrough.md) reports. The redirect defect is already counted as SEC-002 in [security and access](security-access.md), rather than repeated here.

## Findings

### WEB-001 — Expired-session recovery retains the previous user's query data
- Severity: High
- Confidence: static evidence
- Location: `apps/web/src/main.tsx:22`; `apps/web/src/routes/login.tsx:35`; `apps/web/src/features/notifications/notifications.queries.ts:26`; `apps/web/src/routes/_app.tsx:7`; `apps/web/src/features/notifications/notifications-page.tsx:59`
- Requirement: F14 "Roles and access": notifications are personal and only the recipient reads them; F05 money access rule M1: financial fields depend on the caller; F01 session/access changes must take effect while a tab is open.
- Evidence: The global 401 handler sets only `['me']` to null and navigates to `/login`. Unlike explicit sign-out (`app-shell.tsx:225`), it never clears the other queries. Login refreshes only `me`. Notification keys contain filters but no user id; `/notifications` has no loader that waits for fresh personal data, and its page renders any successful query result immediately. A safe in-memory probe using the installed `QueryClient`/`QueryObserver` seeded user A's notification list, applied the same null-me/new-me steps, and obtained A's data with `status: 'success'`, `isStale: true`. Staleness schedules a refresh; it does not hide cached data. This demonstrates the cache mechanism, not an executed sign-in as two real users. The same unpartitioned detail keys can retain responses containing caller-specific money/permission fields. Separately, `fetchMe()` returns null on 401 (`auth.ts:19`) while `useMe()` falls back to the previous route-context user (`auth.ts:40`), so a session-query refresh alone does not establish a reliable session boundary.
- Impact: If a tab recovers from session expiry/revocation and another user signs in through the same SPA, prior personal notifications can appear before the new request completes. Previously cached privileged detail responses can similarly appear on a route the new user may read with fewer fields. The server's per-request authorization does not remove data already in the browser cache. No live cross-user disclosure was performed in this audit.
- Suggested fix: Establish one session boundary that cancels outstanding private requests and clears private query state before rendering an absent or changed user. Handle null `me` without retaining old route-context identity. Partition personal/caller-dependent cache keys by identity or reset them on identity/access changes; do not rely on `staleTime: 0` alone.
- Verification: In a mocked browser regression, load A's personal notifications and a money-bearing project, expire the session via a separate request, then sign in as B in the same SPA. Delay B's responses and assert no A notification, money field or action renders, including during focus refresh and retries.

### WEB-002 — A task's comments after the first 100 are unreachable
- Severity: Medium
- Confidence: static evidence
- Location: `apps/web/src/features/tasks/tasks.queries.ts:49`; `apps/web/src/features/tasks/task-comments.tsx:41`; `apps/web/src/features/tasks/task-comments.tsx:57`; `apps/api/src/modules/tasks/task-comments.service.ts:53`
- Requirement: F06 comments rule 16 and task-page screen 6; the comments API explicitly returns a page, oldest first. ADR 0013 lists return `{ items, total, page, pageSize }`.
- Evidence: `taskCommentsQuery()` always requests `pageSize: 100` with no page argument. The server orders ascending by creation time and id, then applies limit/offset. `CommentsSection` renders only `comments.data.items`; it does not inspect total or expose pagination/load-more. The create path has no limit of 100 comments. A successful submission invalidates the same first-page query, and the composer clears its draft.
- Impact: Once a task has 100 historical comments, its newest discussions, including a freshly saved comment or a mentioned colleague's response, never appear on its task page. Removed-comment placeholders also consume slots. This affects ordinary conversation history, not merely an unusually large page size.
- Suggested fix: Consume all comment pages through a paginated or infinite query with a visible history/newer-comments control. Ensure a newly submitted comment is reachable immediately and preserve the required oldest-first ordering.
- Verification: Mock or seed 101 comments in a later authorized test. Confirm the 101st is visible/reachable, adding another comment preserves the body and shows the saved comment, and removed placeholders do not strand newer messages.

### WEB-003 — Name-based mention conversion changes the selected person's identity
- Severity: Medium
- Confidence: confirmed
- Location: `apps/web/src/features/tasks/mentions.ts:30`; `apps/web/src/features/tasks/mentions.ts:42`; `apps/web/src/features/tasks/task-comments.tsx:119`; `apps/web/src/features/tasks/task-comments.tsx:214`
- Requirement: F06 task-page screen 6: the picker inserts `@Name`, and only the chosen people are stored as `@{userId}` tokens; rule 16 routes mentions to those users.
- Evidence: `toDraft()` discards token identity by converting every id into display text; `toBody()` globally replaces each picked name with an id using `split(...).join(...)`. The authored functions were executed directly without any API/database call. Two distinct users both named `Sara` produced the draft `@Sara @Sara`; round-tripping converted both tokens to the first user's id. Picking `Sara` and then typing `@Sarah` produced the Sara token followed by `h`, rather than retaining the typed name. User display names are not constrained to be unique (`packages/contracts/src/users.ts:36`). Existing mention tests cover two different-length chosen names and an entirely unpicked name, but neither collision.
- Impact: Creating or editing a comment with duplicate names can silently notify the wrong person or omit the intended one. Prefix replacement can introduce a mention the writer did not select. Even saving an existing comment without changing its text can alter stored mention identities.
- Suggested fix: Preserve id-bearing mention spans/segments in the draft instead of reconstructing identity from names. Keep unselected text separate and use position-aware edits so identical names and name prefixes remain distinguishable.
- Verification: Add focused tests for two users with identical names, prefix names when only one was chosen, deletion/retyping, repeated selected mentions, and an unchanged stored comment containing both users. Every selected token must retain its original id and typed text must remain text.

### WEB-004 — Dependency search cannot select tasks beyond the first page
- Severity: Medium
- Confidence: static evidence
- Location: `apps/web/src/features/tasks/task-form.tsx:819`; `apps/web/src/features/tasks/task-form.tsx:850`; `apps/web/src/features/tasks/task-parts.tsx:178`; `packages/ui/src/components/multi-combobox.tsx:74`
- Requirement: F06 new-task screen 5 requires dependencies through task search; task dependency rules allow eligible work of the same client or other internal tasks. ADR 0013 defines paged list endpoints.
- Evidence: `useDependencyOptions()` requests the first 100 open tasks for the client/internal queue, excludes the current task and maps only those items. Both the new-task form and existing-task dependencies dialog use that result. The shared `MultiCombobox` filters its supplied `items` locally; it has no server-search or next-page callback. Typing a task's title therefore cannot reach an eligible task outside the returned 100. The total/page information is discarded rather than used to expose more results.
- Impact: When a client or the shared internal queue exceeds 100 open tasks, authorized users cannot create a dependency on eligible work past the first page from either form. Templates/retainer cycles can grow task volume independently of the small staff/client count.
- Suggested fix: Make the picker search the task endpoint by the typed title and paginate matching results, or load remaining pages explicitly. Preserve currently selected dependencies while results change and keep the existing client/internal/unfinished constraints.
- Verification: Provide more than 100 eligible open tasks and place a uniquely named target outside page one. Search and select it from both creation and edit dialogs; ensure the chosen id is retained across searches and unrelated client tasks remain excluded.

### WEB-005 — An empty later page removes the controls needed to return to existing records
- Severity: Medium
- Confidence: static evidence
- Location: `apps/web/src/features/notifications/notifications-page.tsx:140`; `apps/web/src/features/notifications/notifications-page.tsx:168`; `apps/web/src/features/users/team-page.tsx:122`; `apps/web/src/features/clients/clients-page.tsx:141`
- Requirement: ADR 0013 web pages handle empty states; F14 notifications screen 2 and F01/F02/F05/F06/F07 list screens require usable paged lists and URL filters.
- Evidence: Notifications and the business lists choose an empty-state branch whenever `items.length === 0`; `Pagination` is only inside the nonempty branch. URL parsers accept any positive page and mutations refresh queries without moving the page. For example, with 21 unread notifications, page 2 contains one item. Marking it read successfully invalidates the list; page 2 now has zero items and total 20, but the URL remains page 2. The screen displays "no unread notifications" and has no Previous control although page 1 still contains 20. Team/client/project/retainer/template/task/audit lists use the same branch structure.
- Impact: A successful read/archive/filter-affecting update, concurrent record change or bookmarked out-of-range page can leave the user at a misleading empty result. Recovery requires clearing filters, re-entering navigation or editing the URL; normal paging cannot recover.
- Suggested fix: Distinguish an empty dataset from an out-of-range page. Clamp/reset the URL page after a successful non-placeholder response when total makes it invalid, or retain an explicit return-to-first/previous control in the empty branch.
- Verification: Start with 21 unread notifications and mark the page-2 item read; the remaining 20 must be reachable automatically or through a visible control. Repeat with a business list shrinking from two pages to one and with an out-of-range bookmarked page.

### WEB-006 — Notification read-state actions fail without feedback
- Severity: Low
- Confidence: static evidence
- Location: `apps/web/src/features/notifications/notifications.queries.ts:90`; `apps/web/src/features/notifications/notifications-page.tsx:94`; `apps/web/src/features/notifications/notifications-page.tsx:200`; `apps/web/src/features/notifications/notification-bell.tsx:76`; `apps/web/src/features/notifications/notification-item.tsx:33`
- Requirement: `apps/web/CLAUDE.md` error handling: show translated server error codes or a generic error; F14 notifications screen 2 exposes mark-read/unread and mark-all-read controls.
- Evidence: Read/unread/read-all hooks configure `onSuccess` only. Page/bell callers invoke `mutate()` without an `onError` and never render the mutation error. Subject links and toast actions similarly fire mark-read without feedback. The global `MutationCache.onError` only reacts to 401/403 and ignores network/5xx failures; it does not display a generic error. In contrast, the notification settings mutation explicitly shows an error toast.
- Impact: A failed mark-read, mark-unread or mark-all-read action silently leaves the count/list unchanged, or a subject opens while the notification remains unread. Users cannot tell whether the click was accepted, failed or needs retrying.
- Suggested fix: Show a translated error toast or inline alert for these mutation failures and retain a usable retry action. Subject navigation may continue, but unsuccessful mark-read must remain apparent.
- Verification: Mock a network failure and a coded 5xx for each read-state action, including bell and toast entry points. Confirm an accessible translated error appears and a retry succeeds without losing other notifications.

## Coverage

| Authored area | Review depth and observations |
|---|---|
| `apps/web/src/routes/` | All route registrations and guards scanned; root/session/login/activation/2FA and guarded create/audit paths traced. Routes stay thin for business screens. Session cache boundaries require WEB-001; redirect validation is SEC-002. |
| `apps/web/src/main.tsx`, `src/lib/`, `src/i18n/`, app components | Query error policy, auth client, API error translation, health polling, money parsing, Damascus/Latin-digit formatting, theme initialization, clipboard lifecycle, shell, confirmation and form alerts inspected. Typed API calls and shared schemas are used; no alternate state store was found. |
| `features/users/`, `features/departments/`, `features/account/` | Directory filters/paging, role/status presentation, create/edit/profile/actions, manager selection, invitation links, own profile/password/2FA flows, query invalidation and shared validation inspected. Server permissions remain authoritative; sensitive actions are conditionally presented. |
| `features/clients/` | List/profile/tabs, creation/editing, account-manager selection, contacts/platforms/brand-kit forms and communication-log pagination traced. Shared schemas and translated field/API failures are the normal pattern. |
| `features/projects/`, `features/retainers/` | Lists/pulse queries/filter parsing, creation/edit/status/archive actions, money access, milestones, extra-work infinite queries, client tabs, retainer deliverables/current-cycle/history forms and task/template links inspected. Mutation invalidation normally includes the owning domain; task/template writes refresh their related project/retainer views. |
| `features/tasks/` | My tasks, list/board/workload, URL filters, server-driven moves/permissions, create/edit/reassign/dependencies, checklist/links/revisions, comments/mentions and client/project tabs traced. Board moves fetch task detail and provide a keyboard menu; oversized columns link to the list. WEB-002 through WEB-005 affect interaction correctness. |
| `features/templates/` | List/new/document editor, stage/step ordering/dependencies, shared schema validation, picker detail loads, preview/generate gating, project origins/runs, retainer linking and missing-task generation inspected. Preview disables generation while fetching or errored; generated tasks invalidate templates/tasks/projects/retainers. |
| `features/notifications/`, `features/audit/` | Personal queries/count/settings, page/bell navigation, SSE setup/close/reconnect/focus refresh and burst toasts, read-state mutations; audit filters, dates, entity lookups and translated before/after values traced. SSE effect closes the source and removes listeners/timers; event payload is asserted after JSON parsing rather than runtime-validated. |
| `packages/ui/src/components/` interactions | Pagination, multi-combobox, field/input/select, tabs/dialog/alert-dialog, toast and money-input integration reviewed for app behavior. Visual identity, keyboard/accessibility completeness, RTL and responsive verification are owned by the UI/browser reports. |
| Authored web test/configuration files | Web package scripts, Vitest/TypeScript/Vite configuration, root HTML/theme script and neighboring unit tests inspected; E2E fixtures and relevant auth/F06/F14 references searched to check coverage. Complete CI/E2E assessment belongs to [tests and CI](tests-ci.md). |

## Checks and observations

All commands ran against this repository or its installed dependencies; no server, worker, migration, seed, sign-in, notification mutation, build or client regeneration was run by this reviewer.

| Command/action | Outcome |
|---|---|
| `git rev-parse HEAD` from `D:\vertex-hub` | Exit 0; revision matches the scope above. |
| `rg --files apps/web/src -g '!routeTree.gen.ts' -g '!schema.gen.ts' -g '!openapi.json'` and focused `rg -n` searches across routes/features/contracts/UI | Authored inventory and finding locations checked. Generated-file contents were not read. |
| `.\node_modules\.bin\tsc.cmd --noEmit` from `D:\vertex-hub\apps\web` | Exit 0, no diagnostics. No emitted files. |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts` from `D:\vertex-hub\apps\web` | Exit 0; 8 files and 40 tests passed. The explicit Vitest configuration includes only colocated web unit tests, with no DB setup, Vite router plugin or server. |
| Direct authored mention-function probe below | Exit 0; duplicate ids collapsed and a name prefix became an unintended token, confirming WEB-003. |
| In-memory installed QueryObserver probe below | Exit 0; old personal data survived the 401/new-me sequence and was available as a successful stale result, supporting WEB-001. |

Exact pure probes, run from `D:\vertex-hub\apps\web` (ids and records are synthetic):

```powershell
node --input-type=module -e "import {toBody,toDraft} from './src/features/tasks/mentions.ts'; const a={id:'01920000-0000-7000-8000-000000000001',name:'Sara'}; const b={id:'01920000-0000-7000-8000-000000000002',name:'Sara'}; const original='@{'+a.id+'} @{'+b.id+'}'; console.log(JSON.stringify({original,draft:toDraft(original,[a,b]),roundTrip:toBody(toDraft(original,[a,b]),[a,b]),prefix:toBody('@Sarah',[a])}));"
node --input-type=module -e "import {QueryClient,QueryObserver} from '@tanstack/react-query'; const q=new QueryClient({defaultOptions:{queries:{retry:false}}}); const key=['notifications','list',{page:1,pageSize:20}]; q.setQueryData(key,{items:[{id:'A-private',title:'User A notice'}]}); q.setQueryData(['me'],null); q.setQueryData(['me'],{user:{id:'B'}}); let finish; const request=new Promise(r=>finish=r); const o=new QueryObserver(q,{queryKey:key,queryFn:()=>request}); const s=o.getOptimisticResult({queryKey:key,queryFn:()=>request}); console.log(JSON.stringify({after401AndNewMe:s.data,status:s.status,isStale:s.isStale})); q.clear(); finish({items:[]});"
```

## Limitations and unverified items

- Live business mutations and alternate-role/session sign-ins are outside the read-only authorization. Browser evidence must be taken from the separate browser report; the cache finding has a static application trace and a library-mechanism probe, not a live two-user reproduction.
- No production host, secret environment files, generated API/router contents, lockfiles, other projects or emitted build files were inspected. Unit/type checks consume their normal installed dependency/type interfaces; no generated artifacts were opened or regenerated by the reviewer.
- Full build/E2E/integration checks were not run here. The ordinary E2E script builds first, and API integration tests write/migrate a database. Passing the eight pure web unit files does not validate all forms or server permission behavior. The coordinator reports repository lint/check evidence separately.
- Picker/list enrichment queries often stop at 100 records (clients, users, templates, engagements, audit names). WEB-004 covers a concrete unselectable task dependency. Other high-volume cases need fixtures before assessing impact; this report does not treat staff/client growth beyond the known V1 volume as a separate deploy blocker.
- Cross-domain identity/permission refresh deserves later tests: user changes invalidate users/departments/clients/me but not every task/project/retainer/template detail; client-account-manager changes invalidate clients only. Server enforcement and some mutation-failure refetches exist, so no additional bypass is claimed. Verify that already mounted/cached action and money presentations disappear promptly when access changes; WEB-001 covers the demonstrated session-boundary root issue.
- Source inspection of `ProjectTemplateField.pick()` found asynchronous selection loads without a last-selection guard. A delayed earlier response may overwrite a newer choice; this was not tested with a browser/mock delay and remains a follow-up rather than an additional finding.
- SSE malformed-event handling and reconnect/order/burst behavior were not exercised. JSON parsing/type assertions and focus/reconnect refresh were inspected; a runtime reconnect/stress test is still needed. No claim of lost events or a race is made solely from the use of asynchronous callbacks.

## Deploy implications

Six findings: **1 High, 4 Medium, 1 Low; no Critical**. WEB-001 should block deploy until fixed or explicitly accepted under the plan's severity policy because private/caller-specific state can survive identity changes. WEB-002 through WEB-005 are bounded task/list correctness defects to assess before the pilot; WEB-006 is failure-feedback polish. No fix was performed. The safe type/unit checks passed, but role transitions, larger histories and delayed/error responses still need focused browser regressions during remediation. This report alone does not establish Phase 1 deploy readiness.
