# F15 — Dashboards and basic reports

Status: Approved · Date: 2026-10-04 · Scope: `docs/product/v1-scope.md` §F15 · ADRs: 0006, 0008, 0013, 0014, 0015, 0016, 0021, 0022, 0024, 0025, 0026, 0027

## Summary
Management asks people for the company's status because the numbers live in many screens (success metric 6). F15 turns the home page `/` into **one dashboard with a section per role** the user holds — company, finance, department, my clients, my work — computed on read from the records the system already keeps, and adds a **Reports** area with four exportable reports: **department productivity**, **revenue by client and service**, **overdue invoices** (Excel) and the **monthly client report** (on screen, Excel and a branded Arabic PDF, with a summary the account manager writes). To report revenue by service, invoice lines gain an optional catalog service; lines without one are split automatically by the accepted quote of their project or retainer.

## In scope / out of scope
- In:
  - Home page `/` with sections by permission, in this order: **Company** (General Manager, Operations manager), **Finance** (General Manager, Operations manager, Finance), **Departments** (department managers), **My clients** (account managers), **My work** (everyone). Monthly figures show this month beside the previous month.
  - Reports: department productivity, revenue by client and service, overdue invoices, monthly client report. Excel for all four; PDF for the monthly client report only (owner decision).
  - Monthly client report summary: an optional text per client and month, written by the account manager and printed on the report (owner decision).
  - Invoice line service: an optional catalog service per invoice line, set in the draft editor and changeable on issued invoices; automatic split by the accepted quote for milestone and cycle lines without one (owner decision).
  - Permission: the Operations manager gains `reports.finance` (owner decision).
- Out (later or never):
  - Leads reports beyond the dashboard numbers (sources, loss reasons, time in stage): the data is stored (ADR 0026); no export in V1.
  - Scheduled or emailed reports, automatic monthly client reports, sending the report to the client from the system (owner decision: on demand; email is Phase 4 F14 / Q5).
  - Agency fees, invoices and balances in the monthly client report (owner decision: the statement, F13, covers them).
  - Custom report builders, charts beyond the dashboard cards, saved filters, live (pushed) dashboard updates.
  - Time tracking (scope §6): cycle time is elapsed calendar time, not hours worked.
  - Delivering the retainer `monthly_report` deliverable: it stays counted by its task (ADR 0015); downloading the report changes nothing.
  - Leads, campaigns and wallet data for department managers (no grant today).

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `reports.finance`: the **Internal Operations manager** gains `all` as a department capability (owner decision; they already issue invoices and record payments). General Manager and Finance keep `all`.
- No other change. `reports.read` stays: General Manager `all`, Operations manager `all`, Department Manager `department` (the departments they manage), Account Manager `own_clients`. Finance holds no `reports.read` (F01).

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| Company section of the home page | `reports.read` `all` | General Manager, Operations manager |
| Finance section of the home page | `reports.finance` | General Manager, Operations manager, Finance |
| Departments section | `reports.read` `department` or `all` | Department Manager: departments they manage · `all` holders: any department (picker) |
| My clients section | `reports.read` `own_clients` | Account Manager: clients they are primary account manager of |
| My work section | `tasks.read` | every active user |
| Department productivity report (screen and Excel) | `reports.read` `department` or `all` | as Departments section |
| Revenue by client and service, overdue invoices (screen and Excel) | `reports.finance` | General Manager, Operations manager, Finance |
| Monthly client report: read, Excel, PDF, edit summary | `reports.read` covering the client (`all` or `own_clients`) | General Manager, Operations manager: all · Account Manager: own_clients |
| Ad sections of the monthly client report and the low-wallet flags | also `campaigns.read` covering the client | all current report readers hold it |
| Money figures in My clients (outstanding, overdue) | also `invoices.read` covering the client | Account Manager: own_clients |
| Set or change the service of invoice lines | `invoices.manage` | General Manager, Operations manager, Finance |

A user with several roles sees every section they qualify for (owner decision). A General Manager who is also the account manager of some clients sees My clients for those clients.

## Data
Module ownership (ADR 0027): a new `reports` module owns the two tables below and owns no business rules of other modules. It reads every other module through read-only report services that each module exports (new: `TaskReports`, `EngagementReports`, `InvoiceReports`, `LeadReports`, `CampaignReports`, `ContentReports`, `ShootReports`, `ApprovalReports`; existing: `ClientDirectory`, `UserDirectory`). Each export takes a scope filter (all, department codes, or client ids) and a period and returns aggregates or rows, so no module queries another's tables. No module imports `reports`.

All periods are calendar dates in Asia/Damascus; months are calendar months; the week runs Saturday to Friday (F06). Money in reports is converted to USD (reporting currency, ADR 0006) with the stored rate of each invoice, payment or wallet entry, through `convertMinor`/`toUsdMinor` in `packages/contracts/src/money.ts`; amounts split across rows use the largest-remainder method in USD minor units, so parts always add up to the whole.

### `client_report_notes` (exception to the business table shape, listed in `conventions.test.ts`: one row per client and month, cleared instead of archived)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid → clients | required |
| `month` | date | required, first day of the month |
| `summary` | text | required, 0–4000 chars (empty = no summary) |
| `updated_by_id` | uuid → users | required |
| timestamps | | |

Unique `(client_id, month)`.

### `client_report_pdfs` (temporary, not a business table; same pattern as F13 `statement_pdfs`)
`client_id`, `month`, `hash` (unique: the render payload's hash), `status` (`pdf_status`), `storage_key`, `size_bytes`, `requested_at`. Asking again for the same payload within 24 hours reuses it; the daily `files.purge-uploads` run deletes rows older than 24 hours with their objects.

### Changes to other tables
- `invoice_lines.service_id` uuid → `catalog_services`, nullable, indexed (owned by `invoices`). Not printed on any PDF.

### Indexes
The implementation adds any index the report queries need and that is missing (expected: `tasks.delivered_at`, `payments.paid_on`, `invoices.issued_on`, `content_posts.published_at`), checked with `EXPLAIN` on seeded data.

## States and rules

### Dashboard sections
1. **Company** (`reports.read` `all`):
   - Active engagements: projects in `planned`, `active`, `on_hold` (by status) and retainers in `active` (non-archived).
   - Overdue tasks by department: open tasks past due (F06 overdue rule), per department.
   - Department workload: per department, open tasks, due this week, overdue, unassigned (F06 workload counts).
   - Retainers behind this month: open cycles of active retainers with at least one line behind (`isLineBehind`, ADR 0015): client, retainer, lines behind, overall completion.
   - Approvals waiting more than 48 hours: pending approval items whose request link was issued more than 48 hours ago and is not revoked (expired links included, marked): count and the oldest, linking to the approvals Sent tab.
   - Low ad wallets: wallets with `low_since` set: client, balance (USD).
   - Leads: new leads (created in the month), won, lost and the conversion rate = won ÷ (won + lost) of leads closed in the month (owner decision), this month and last month. No closed leads: "—".
2. **Finance** (`reports.finance`):
   - Invoiced: Σ issued, non-void invoices with `issued_on` in the month, in USD at each invoice's rate; this month and last month.
   - Collected: Σ non-void payments with `paid_on` in the month, in USD at each payment's rate; this month and last month.
   - Outstanding now: balance of issued, non-void invoices per currency and in USD (invoice rate).
   - Overdue now: count and balance of `overdue` invoices per currency and in USD, linking to the overdue invoices report.
3. **Departments** (per department in scope; a picker when the user holds `all` or manages several): open tasks by status, overdue count with the ten oldest overdue tasks, unassigned count, and per person the F06 workload numbers for this week (overdue, due this week, open), linking to the board and the workload screen.
4. **My clients** (`own_clients`): one row per non-archived client the user is primary account manager of: active retainers with this month's overall completion and a behind flag; open projects count; approval items pending the client (count, oldest sent date); with `invoices.read`: outstanding (USD) and overdue invoices count; with `campaigns.read`: a low-wallet flag. Rows with a problem (behind, overdue, low wallet, approvals waiting over 48 hours) come first, then by client name.
5. **My work** (everyone): my overdue tasks, tasks due today and tasks due later this week (to Friday), up to 10 each, from the F06 My tasks counts and list, linking to My tasks.
6. "This month" is the current calendar month to today; "last month" is the whole previous month. Completion of a cycle = Σ min(delivered, committed) ÷ Σ committed over its lines (lines with 0 committed are left out), rounded down to a whole percent (R13's delivery rate, so the dashboard matches the retainer page).
7. Each section loads on its own and shows its own loading, empty and error state; the page shows when it was loaded and has a refresh action. No numbers are stored.

### Department productivity
8. Query: `from`, `to` (default this month; at most 366 days; `to` ≥ `from`, else `INVALID_DATES`), departments in scope (default: all in scope).
9. Rows per department and per person within it. A task counts for its department and its current assignee; people listed are the department's non-archived members plus anyone with a delivered task of it in the period.
10. Measures (non-archived tasks only):
    - New: tasks of the department created in the period.
    - Delivered: tasks with status `delivered` and `delivered_at` in the period.
    - On time: delivered tasks whose `delivered_at` is not after the due moment (the due date's end in Asia/Damascus, or the due time when set) ÷ delivered, whole percent; "—" when none delivered.
    - Average client revisions and average internal revisions (sources `internal` and `medical`) per delivered task, one decimal.
    - Average cycle time: days from `started_at` (else `created_at`) to `delivered_at`, one decimal.
    - Open now and overdue now (at the time of the request, not the period).
    - Department rows only: unassigned now (count and the day the oldest unassigned open task was created).

### Revenue by client and service
11. Query: `from`, `to` (default this month; same limits as rule 8).
12. **Invoiced** = issued, non-void invoices with `issued_on` in the period, each converted to USD at its rate; **collected** = non-void payments with `paid_on` in the period, converted at their own rate (owner decision: invoiced is the revenue, collected beside it).
13. **By client**: client, account manager, invoiced, collected, and outstanding at the end of the period (issued on or before `to`, minus payments on or before `to`, at invoice rates).
14. **By service**: each invoice's USD total is split over its lines by line totals; each payment's USD amount over its invoice's lines in the same shares. A line's share goes to:
    - its `service_id` when set;
    - else, for a milestone line, the project's accepted quote's `one_off` lines, and for a retainer cycle line, the retainer's accepted quote's `monthly` lines (the latest accepted one when the retainer was renewed), in proportion to quantity × unit price (owner decision); a package line counts as its package;
    - else "Unclassified".
    Rows: service or package name (archived ones included, marked), invoiced, collected.
15. The Excel workbook has three sheets: By client, By service, Invoices (number, client, issued on, currency, total, rate, USD total, collected in the period in USD).

### Overdue invoices
16. Invoices in status `overdue` today: number, client, account manager, currency, total, paid, balance, balance in USD, due date, days overdue, aging bucket (1–30, 31–60, 61–90, over 90 days); totals per currency and in USD. Filters: account manager, currency.

### Monthly client report
17. Query: a client and a month. Months after the current one are refused (`INVALID_MONTH`); the current month is marked **preliminary** on screen, in Excel and on the PDF.
18. Sections, each omitted when it has no data (owner decision on contents); when all are empty the report says there was no activity:
    1. Summary: the stored text for the client and month.
    2. Retainers: for each non-archived retainer with a cycle in the month, each line's kind or label, committed, delivered (frozen `delivered_at_close` for a closed cycle, the live count for an open one), percent, and the cycle's completion (rule 6).
    3. Projects: non-archived projects that were open at some point in the month (not completed or cancelled before it, started by its end): status, progress (delivered ÷ total tasks), milestones done in the month.
    4. Delivered work: the client's tasks delivered in the month: the client-facing title of the latest approval item for the task when one exists, else the task title; department; date.
    5. Published content: posts published in the month: date, platforms, title, links.
    6. Shoots: the client's completed shoots that took place in the month (dated by their start in Asia/Damascus): date, title, location.
    7. Approvals: approval items of the client closed in the month as approved or changes requested: the two counts and the average response time (the request's creation to the item's close), in hours under two days, else days.
    8. Ad campaigns (needs `campaigns.read`): each campaign with non-archived updates in the month (an update lies within one month, F12 rule 9, so its start dates it): platform, name, objective, spend (USD), reach, clicks, results, cost per result; totals (reach is the sum of the updates' reach).
    9. Ad budget (needs `campaigns.read`; only when the client has wallet activity: a non-void entry or counted spend up to the month's end): opening balance at the month's start, deposits, refunds, wallet-funded spend, closing balance (USD, non-void entries).
    10. Next month: posts scheduled in the next month that are not cancelled (date, title) and shoots booked in it (date, title).
19. The summary is edited by any reader of the report for that client, any month up to the current one; saving replaces the text (last write wins) and writes an audit entry. An empty text clears it (stored as an empty text; the row stays). Saving the same text again changes nothing.
20. The PDF is Arabic only (as F04 and F13), rendered by the worker on request with the company details from the quote settings, downloadable for 24 hours and not kept as a document (as F13 statements).

### Invoice line services
21. In the draft editor every line has an optional service picker (non-archived catalog services). No line gets a service automatically; rule 14 splits milestone and cycle lines without one.
22. On an issued, non-void invoice, invoice managers set or clear the services of its lines ("Services" dialog). The PDF is not re-rendered and the invoice stays otherwise immutable (F13). A void invoice cannot be changed (`INVALID_TRANSITION`). A service archived later stays on the line; an archived service cannot be newly chosen (`INVALID_SERVICE`).

### General
23. Every number respects the caller's scope: a department manager never sees another department's tasks, an account manager never sees another manager's clients; a section or report the caller cannot read is a 403 from the API and absent from the UI.
24. Excel files are built by the API on request (RTL sheet, Arabic headers through the API's i18n strings, dates as dates, money as numbers in major units with a currency column) and named `<report>-<from>-<to>.xlsx` (`overdue-invoices-<today>.xlsx`) or `client-report-<client>-<YYYY-MM>.xlsx`. The API has no i18n: the Arabic names of printed values and the monthly report's titles live in `packages/contracts/src/report-labels.ts`, shared with the worker's PDF and matching `ar.json`.

## API
Schemas live in `packages/contracts/src/reports.ts` (and the invoice line field in `invoices.ts`). Dates are `YYYY-MM-DD`, months `YYYY-MM`.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/dashboard/company` | `reports.read` `all` | — | `companyDashboardSchema` (rule 1) | 403 |
| `GET /api/dashboard/finance` | `reports.finance` | — | `financeDashboardSchema` (rule 2) | 403 |
| `GET /api/dashboard/departments` | `reports.read` (`department` or `all`) | `department` (default: the first department the caller manages, else the first in scope) | `departmentDashboardSchema` (rule 3) plus the departments in scope | 403 (department out of scope) |
| `GET /api/dashboard/clients` | `reports.read` `own_clients` | — | `myClientsDashboardSchema` (rule 4) | 403 |
| `GET /api/reports/productivity` · `GET /api/reports/productivity/export` | `reports.read` (`department` or `all`) | `productivityQuerySchema`: `from`, `to`, `department[]` | `productivityReportSchema` · xlsx | 403, `INVALID_DATES` |
| `GET /api/reports/revenue` · `GET /api/reports/revenue/export` | `reports.finance` | `revenueQuerySchema`: `from`, `to` | `revenueReportSchema` · xlsx | 403, `INVALID_DATES` |
| `GET /api/reports/overdue-invoices` · `GET /api/reports/overdue-invoices/export` | `reports.finance` | `accountManagerId`, `currency` | `overdueInvoicesReportSchema` · xlsx | 403 |
| `GET /api/clients/:id/monthly-report` · `GET /api/clients/:id/monthly-report/export` | `reports.read` covering the client | `{ month }` | `clientMonthlyReportSchema` (rule 18) · xlsx | 404, `INVALID_MONTH` |
| `PUT /api/clients/:id/monthly-report/summary` | `reports.read` covering the client | `{ month, summary }` | `clientMonthlyReportSchema` | 404, `INVALID_MONTH` |
| `POST /api/clients/:id/monthly-report/pdf` · `GET` same path with `month` | `reports.read` covering the client | `month` query parameter (as F13 statements) | `{ state }` · the PDF inline | 404, `INVALID_MONTH` |
| `PUT /api/invoices/:id/services` | `invoices.manage` | `{ lines: [{ lineId, serviceId \| null }] }` | `invoiceDetailSchema` | 404, `INVALID_TRANSITION`, `INVALID_SERVICE` |

- F13's draft line schemas gain an optional `serviceId`; invoice detail lines return `service` (id, name, archived) or null.
- A client outside the caller's report scope is a 404 (as other client reads). The My work section uses the existing `GET /api/me/tasks/summary` and `GET /api/tasks` (F06).

## Screens
All screens: Arabic RTL, strings through i18next (`dashboard.*`, `reports.*`), Latin digits, dates in Asia/Damascus, money with its currency, design-system components and tokens only; each card and report has loading, empty and error states.

1. **Home** `/` (replaces the redirect to `/tasks`): sections in the order of rules 1–5, each shown only to those who can read it. Cards with a number, the comparison with last month where it applies, and a link to the filtered screen behind it (task list, invoices, approvals, retainers, leads, campaigns). Simple bars for per-department and per-person counts (same pattern as F06 Workload). An employee with no other role sees My work only. Phone: one column, sections collapsible.
2. **Reports** `/reports` (holders of `reports.read` or `reports.finance`): the reports the user can open, with a line on what each shows. Navigation gains "Reports"; "Home" becomes the first item.
3. **Department productivity** `/reports/productivity`: period picker (this month, last month, custom), department filter, the department table and per-person rows under each department; "Export to Excel".
4. **Revenue** `/reports/revenue`: period picker; By client and By service tabs (with "Unclassified" last); "Export to Excel".
5. **Overdue invoices** `/reports/overdue-invoices`: the table with aging badges and totals; account manager and currency filters; rows open the invoice; "Export to Excel".
6. **Monthly client report** `/clients/$clientId/report?month=YYYY-MM`, also reached from `/reports` (client and month pickers) and from a "Monthly report" action on the client profile: the sections of rule 18 as they will print, the preliminary badge for the current month, the summary editor (save), "Download PDF" (preparing state, then download) and "Export to Excel".
7. **Invoices (F13)**: the draft editor gains a Service column; the issued invoice page gains a Service column and, for invoice managers on non-void invoices, a "Services" dialog.

## Audit, notifications and jobs
- Audit: saving a monthly report summary (`client_report.summary_changed`, client and month, old and new text); changing invoice line services (`invoice.services_changed`, per line old and new service). Viewing and exporting reports are not audited.
- Notifications: none.
- Jobs: a `reports.pdf` queue rendered by the worker with the ADR 0008 pipeline, its ready handler storing the file on the `client_report_pdfs` row; the existing daily purge removes rows older than 24 hours.

## Edge cases
1. Permissions change mid-session: the next request is checked again; a section that turns 403 disappears on refresh.
2. A department manager of several departments: the picker lists only theirs; an Operations manager who also manages Internal Operations sees both Company and Departments.
3. Archived records (mistakes) are left out everywhere; archived users still appear in productivity rows for tasks they delivered, marked archived.
4. A task reopened after delivery is not delivered: it leaves "Delivered" until delivered again (its new `delivered_at` counts).
5. A cycle line edited mid-month: the report shows the current committed quantity with its reason trail on the retainer page; closed cycles use frozen counts (ADR 0015).
6. Invoices voided after a period closed drop out of every total, including past periods (F13: void leaves every total).
7. A payment voided later drops out of collected for its period.
8. An engagement without an accepted quote, or a quote whose section has no priced lines (all zero): its lines go to "Unclassified" unless they have a service.
9. A retainer fee changed after acceptance: the split still uses the quote's line proportions, never its amounts.
10. SYP-only clients: every USD figure uses stored rates; no figure uses today's rate.
11. Wallet balance negative: shown as negative, with the low flag.
12. A client with no activity in a month: the report shows only the header and "no activity"; the PDF can still be downloaded.
13. Two people edit the same summary: the last save wins; both are in the audit log.
14. Large periods: 366 days at most for productivity and revenue; data volume (~20 users, ~20 clients) keeps on-read computation fast; every endpoint has an integration test on seeded data with a time budget.
15. Months before the client existed are allowed and empty.

## Open questions
None. Every owner decision above is recorded here and in ADR 0027.

## Acceptance
- End-to-end check the owner runs in the browser:
  1. Sign in as the General Manager: the home page shows Company, Finance and My work; overdue tasks per department match the task list filtered by overdue; invoiced and collected this month match the invoices list.
  2. Open a retainer that is behind: it appears under "Retainers behind this month"; an approval item sent over 48 hours ago appears in its card.
  3. Sign in as a department manager: only their department's section and My work; the workload numbers match F06 Workload.
  4. Sign in as an account manager: My clients lists only their clients with retainer completion, pending approvals and outstanding amounts.
  5. Sign in as Finance: Finance and My work only; open Revenue for this month, check By service splits a retainer invoice from a quote by its services, set a service on a manual line and see it move out of "Unclassified"; export to Excel and open the file (RTL, Arabic headers).
  6. Open Overdue invoices and export it.
  7. Open Department productivity for last month as the Operations manager and export it.
  8. As the account manager, open a client's monthly report for last month, write a summary, save, download the PDF and check its sections against the client's retainer, posts, campaigns and wallet; open the current month and see "preliminary".
- Tests:
  - Unit (contracts): conversion rate, completion, on-time, aging buckets, largest-remainder split, the revenue split by line, quote and payment (rule 14), month and period validation; the permission map change (`reports.finance` for the Operations manager).
  - API (`apps/api/test/dashboard.test.ts`, `reports.test.ts`, `client-report.test.ts`, invoice services in `invoices.test.ts`): each endpoint for success, 401, 403 and out of scope (a department manager asking another department, an account manager asking another manager's client, Finance asking productivity, a department manager asking revenue); rules 1–22 on seeded data, including voided invoices and payments, frozen cycles, SYP rates and unclassified lines; audit entries in the same transaction; Excel files open and hold the expected rows; the PDF job is queued once per payload.
  - Architecture: `reports` reaches other modules only through their exports.
  - E2E and RTL screenshots (`apps/web/e2e/screens.spec.ts`): home for the General Manager, a department manager, an account manager, Finance and an employee; each report screen; the monthly client report; the invoice Services dialog; phone width for the home page.
