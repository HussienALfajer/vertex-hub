# End-to-end browser walkthrough

## Scope and revision

Date: 2026-09-30 (Asia/Damascus). Authored-code target: `9463f9f4366c133ec55bfa577c1fa08605581554`. Reviewed the running local application through the Codex in-app browser using an existing General Manager session, with safe navigation, filters and unsaved forms. The application and API were already running; this reviewer did not start services. This is a **partial live, read-only walkthrough**, not a successful full lifecycle acceptance test.

Read `README.md`, `apps/web/CLAUDE.md`, `brand/identity.md`, the screen requirements in F01/F02/F05/F06/F07/F14 specs, and the Phase 1 roadmap entries. Source inspection was limited to navigation and mutation safety, including notification opening/settings and project money visibility. No mock routes or fabricated API responses were installed.

## Findings

No independently counted defect was demonstrated by the reachable read-only flows. Missing records, unavailable roles and prohibited writes are coverage limitations, not defects. The healthcare flag's claim that it enables medical review was visible in the new-client form and mobile edit dialog; `apps/web/src/i18n/locales/ar.json:1400` contains the text, while `apps/web/src/features/clients/client-form.tsx:220` says the review switches on later in F09. This observation was handed to the UI/UX reviewer for one consolidated finding, rather than counted twice here.

## Coverage

Status meanings: **Observed** means the page was actually inspected in the live browser; **Partial** means only a reachable view/form or empty state was inspected; **Blocked** means the acceptance flow was not executed. Screens that require writes were deliberately left unsaved.

| Phase 1 step | Browser action and observed evidence | Status and remaining blocker |
|---|---|---|
| Browser/runtime inventory | `cua.getState()` returned IAB and MCP Apps, both initially with no tabs; hidden IAB tab at `http://127.0.0.1:5173/` opened the existing QA General Manager session. | Observed. No additional browser profiles/role sessions were available. |
| Session and home | Home displayed General Manager + Employee roles and the working health state; account menu matched the signed-in user. | Observed existing session; initial sign-in and session creation not tested. |
| Login / activation error | Direct `/activate` without a token displayed an invalid-link explanation and manager guidance. Its sign-in link redirected the already authenticated user to home. | Partial. Password activation, expired/reused real tokens, password login, code/backup-code login and required 2FA enrollment need separate authorized sessions; no logout or credential entry occurred. |
| Team directory | Navigation to `/team` displayed ten active users, department, role and 2FA columns, status/department/skill filters and New user action. | Observed GM view. Employee/manager directory differences not tested. |
| New user / profile | Opened `/team/new` with basic, department, role and skills fields, then the existing QA Employee profile with department, contact, role and 2FA information. | Partial. Creation, activation-link issuance, reset, archive/restore and responsibility refusals require writes and were not run. |
| Departments | `/departments` showed all ten departments; opened Design detail and inspected its three primary members and manager-change action. | Observed. Rename and manager assignment not submitted. |
| Own account | `/account` showed read-only identity, phone/skills form, password fields and enabled/required 2FA state. Save was disabled for unchanged profile. | Partial. Password/2FA/backup-code actions were not invoked. |
| Client list / new client | `/clients` showed one paused healthcare acceptance client with its manager and sector. `/clients/new` exposed identity, manager, status, healthcare flag and live preview. | Observed list; partial creation form, never submitted. |
| Client contacts | Opened the existing client's default Contacts tab: two contacts and a final-approval badge on one. | Observed. Add/edit/archive actions not submitted. |
| Client brand / platforms | Opened Brand and Platforms tabs: two swatches, font, tone, forbidden words and external reference links; one platform with pending access. External destinations were not opened. | Observed stored content; editing, copying and external service access not exercised. |
| Client communication | Opened Communication tab: labelled note form with Damascus datetime, channel and contact, followed by no communication yet. | Observed empty state/form. No note was added or changed. |
| Client work tabs | Opened Projects, Retainers and Open tasks tabs; each displayed an empty explanation and preset create link after data settled. The selected tab was preserved in `?tab=…`. | Observed empty cross-feature views; populated links/counts not verified. |
| Projects / new project | `/projects` showed zero active/planned/held counts and no projects. Included completed/cancelled statuses, then archived filter: still no matching records. `/projects/new` displayed client/manager/departments/dates/status, template picker and five suggested milestones. | Partial. No existing project detail could be opened; milestones, extra work, task groups, project progress, money and status confirmations remain unverified. |
| Retainers / new retainer | `/retainers` showed zero active/paused/behind/renewal counts. Included ended and archived filters: still no matching records. `/retainers/new` displayed start/renewal dates, full first-month quantity explanation, deliverable kinds and monthly template picker. | Partial. No current/history cycle, delivery counter, adjustment history, extra work or renewal detail could be inspected. |
| My tasks / list / new task | My tasks displayed zero overdue/today/this-week/later and no assigned tasks. List showed no open tasks; including delivered, cancelled and archived records produced no matches. New task showed assignment/request mode, department, assignee, due date/time, client, dependencies/checklist/links. | Partial. No populated task detail, workflow, dependencies, checklist, comments/mentions, revision decisions, archive or project-cancellation cascade was exercised. |
| Board / workload | Board defaulted to General Administration and displayed no tasks in these departments. Workload showed the week 26 Sep–2 Oct, an unassigned count of zero and three departmental users with zero counts/bars. | Partial. Card menus/drag transitions and nonzero workload navigation were not testable. |
| Work templates | List displayed four seed templates. Opened Brand identity: three stages, eight steps, dependencies and default assignees. Opened a step dialog, verified Friday/work-day explanation and client-approval/revision fields, then cancelled. Opened monthly social template: one fixed step, eight repeated deliverable steps and no linked retainers. New template form displayed kind/stages/default-assignee controls. | Observed stored template definitions; partial forms. No save/archive/apply/missing-task generation or preview request was issued. Existing target projects/cycles were absent. |
| Notification bell / page | Bell showed no notifications and disabled Mark all read. View all opened `/notifications`; Unread filter changed URL to `?unread=true` and displayed no unread notifications. | Observed empty states/filter. No notification subject/read-state action was clicked. Populated rows, counts, subject access and event toasts remain unverified. |
| Notification settings | `/notifications/settings` showed three categories, optional switches on and action-required switches disabled/on with explanatory text. | Observed. No switch was toggled because changing one immediately saves. Reconnect/event delivery was not forced. |
| Audit | `/audit` showed translated entries, Damascus timestamps, subject links, filters and `1–30 of 32` pagination. Expanded the newest 2FA-enabled entry: before = disabled; after = enabled. | Observed historic display; audit atomicity for a fresh mutation not tested. Second page and every audit entity type not exhaustively inspected. |
| Error state | Navigated once to `/tasks/00000000-0000-4000-8000-000000000000`. After the request settled, main displayed a translated task-not-found alert and Retry control. | Observed missing-record path. No induced 403, network outage, SSE interruption or backend failure. |
| RTL and responsiveness | DOM inspection confirmed `lang=ar`, `dir=rtl`. Screenshots inspected home/team/audit at default 1280-wide viewport and account/client list/client profile/client edit dialog at 390×844. At desktop team and mobile account/profile, document scroll width equalled client width; tables/tab strips scrolled within containers. Mobile navigation drawer opened, moved focus to its first link and closed after client navigation. | Observed representative light/dark mobile behavior. No exhaustive screen-reader, all-breakpoint, all-dialog or populated board visual validation. |
| Themes and cleanup | Switched mobile client profile to dark, inspected profile/dialog, cancelled the dialog, returned to light and reset viewport override. | Observed. These reversible browser preferences were restored; no business changes were submitted. |

### Role and lifecycle coverage matrix

| Role / acceptance path | Actual depth | What is required to finish |
|---|---|---|
| General Manager | Live read-only navigation, existing F01/F02 records and F07 seed definitions; unsaved F01/F02/F05/F06/F07 forms. | Authorized disposable records for populated project/retainer/task screens and a separate mutation acceptance run. |
| Operations manager | Blocked: no existing authenticated role session exposed by browser inventory. | Owner-provided existing local session; then compare management/audit/template controls. |
| Department manager | Blocked as a signed-in role; directory displayed manager labels only. | Existing local manager session plus tasks in managed and other departments. |
| Account manager | Blocked as a signed-in role; a user's role and client manager association were visible as GM. | Existing account-manager session plus own/other-client work to check action and money scopes. |
| Employee | Blocked as a signed-in role; employee profile inspected as GM. | Existing employee session and assigned/requested tasks; then compare board/template navigation and action suppression. |
| Finance / mandatory 2FA | Blocked as a signed-in role; GM account displayed mandatory 2FA. | Existing Finance session with required 2FA state and approved money-bearing local records. |
| Complete project lifecycle | Blocked after list/new-form inspection by absent project/task records and the no-write boundary. | Seeded disposable client → project/milestone → tasks in each workflow state → revisions → delivery, with approval to mutate in a later session. |
| Complete monthly lifecycle | Blocked after list/new-form/template inspection by absent retainers/cycles/tasks and the no-job boundary. | Existing populated retainer/current and closed cycles plus approved mutation/job acceptance outside this audit. |
| Notification/event lifecycle | Blocked after empty page/settings inspection by absent notifications and forbidden mutations/jobs. | Existing unread/read notifications and separate recipient sessions; approved later actions to emit events and test reading/settings. |
| Final invoice/payment/report | Outside Phase 1. | Later-phase implementation/acceptance; not recorded as missing Phase 1 behavior. |

## Checks and observations

Safe shell availability check (exit 0):

```powershell
$ErrorActionPreference = 'Stop'
foreach ($auditUrl in @('http://127.0.0.1:5173/', 'http://127.0.0.1:4173/', 'http://127.0.0.1:3000/api/health')) {
  try {
    $auditResponse = Invoke-WebRequest -Uri $auditUrl -TimeoutSec 3 -UseBasicParsing
    Write-Output "$auditUrl HTTP $($auditResponse.StatusCode)"
  } catch {
    Write-Output "$auditUrl $($_.Exception.Message)"
  }
}
```

Results: web `5173` HTTP 200; preview `4173` connection refused; API health `3000` HTTP 200. This establishes availability, not the version, test coverage or safety of existing server background jobs. `git rev-parse HEAD` confirmed the target revision.

Actual browser operations used `cua.createBrowserTab('iab', 'http://127.0.0.1:5173/', {visible:false})`, fresh `getAXState()`/`playwright.domSnapshot()` after navigation, semantic link/button/tab clicks, read-only DOM layout measurements, `getScreenshot()`, and the documented viewport capability. Visible IAB creation first returned that visibility is unsupported in a subagent; hidden creation succeeded. Native AX calls represented some toggle-group controls as checkboxes while DOM snapshots represented them as buttons; the final notification filter was operated using the observed DOM button. Two selector attempts matched nothing and caused no page action.

Safety tracing before notification navigation: `apps/web/src/features/notifications/notification-item.tsx:33` marks an unread item read on opening; `apps/web/src/features/notifications/notification-settings-page.tsx:109` saves switch changes. Therefore only the empty bell/page, filters and settings display were inspected. Screenshots are observations in tool output; no image artifacts were added because this assignment permits only the Markdown report. None constitutes the repository's automated Playwright screenshot acceptance suite.

## Limitations and unverified items

- No new session/account/token was created, no credential was read or entered, and no logout/password/2FA action was invoked. Role existence in the team directory does not establish a tested session for that role.
- Local authenticated lists and the client's work tabs were the places checked for records. Active/closed and archived filters on projects, retainers and tasks remained empty; no data was seeded to overcome this blocker.
- No API/worker was started, no job/migration/test fixture was run, and no production host or external client link was visited. The already-running services' independent background activity is outside this browser review's control.
- No business form was submitted; notification read/unread/all-read and setting switches were untouched. The walkthrough cannot verify transaction/audit atomicity, workflow enforcement, cross-role authorization, counters after changes or live event fan-out.
- Live frontend/API results were observed without mocks, but the reviewer did not inspect running process identity or prove that the server build corresponds exactly to the checkout. Findings grounded in source would need checkout line evidence; browser observations apply to the running local app.
- Representative RTL screenshots and DOM measurements support the listed layouts only. Full keyboard order, screen-reader announcements, browser locales/date pickers, all themes/screens, narrow populated tables/boards, transport failure and session-expiry behavior remain unverified.

## Deploy implications

The reachable GM read-only screens rendered and the missing-record/invalid-activation paths displayed translated guidance. This does not establish a passed end-to-end Phase 1 lifecycle or permission acceptance. Before deploy, the owner should run a separate authorized local acceptance session with existing role sessions and populated disposable projects, retainers/cycles, tasks in relevant states and notifications. Writes and scheduled jobs belong to that later acceptance run; they were outside this audit. The missing runtime evidence is explicitly retained rather than converted into a deploy-pass statement.
