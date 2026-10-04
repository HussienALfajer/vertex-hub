# TASKS — F15 Dashboards and basic reports

Spec: `docs/specs/F15-dashboards-reports.md` · ADRs 0006, 0008, 0013, 0014, 0015, 0016, 0021, 0022, 0024, 0025, 0026, 0027 · Three PRs (owner decision: web in one PR; `exceljs` approved for Excel), each leaves `main` green and fully wired.

## PR 1 — `feat/f15-dashboard-api`: dashboard API and invoice line services
- [x] contracts: `reports.ts` dashboard schemas (company, finance, departments, my clients) with `.meta({ id })`; rules `reportMonths`, `conversionRate`, `isApprovalWaiting` with unit tests (cycle completion reuses `deliveryRate`, R13, so the dashboard matches the retainer page; the largest-remainder split arrives in PR 2 with revenue); `reports.finance` `all` for the Operations manager with a `permissions.test.ts` case; `invoices.ts` optional `serviceId` on draft lines, detail line `service`, `canEditServices`, `updateInvoiceServicesSchema`; error code `INVALID_SERVICE`; audit action `invoice.services_changed`; `ar.json` keys. Root typecheck waits for the api layer (invoice line `service`, `canEditServices`)
- [x] db (`/db-migration`, 0040, additive): `invoice_lines.service_id` (nullable, indexed, → `catalog_services`); indexes `tasks.delivered_at`, `payments.paid_on`, `invoices.issued_on`; drift clean
- [x] api report exports used by the dashboard: `TaskReports` (department counts, department section, `personCounts` shared with F06 Workload), `EngagementReports` (active counts, open projects, retainer progress through `RetainerCyclesService.openOf`), `InvoiceReports` (invoiced, collected, outstanding), `LeadReports`, `CampaignReports` (low wallets), `ApprovalReports` (waiting, pending by client); `ClientDirectory.managed`; `ReportClients` scope type in contracts; `businessDateSql` in `core/database`
- [x] api `reports` module: `GET /api/dashboard/company|finance|departments|clients` (rules 1–7, 23); `app.module.ts`; architecture test: no module imports `reports`; `docs/architecture.md` and module comments
- [x] api `invoices`: draft lines accept `serviceId` (rule 21), `PUT /api/invoices/:id/services` (rule 22, audit), `canEditServices`; `CatalogModule` imported
- [x] api tests: `test/dashboard.test.ts` (401, 403 per role, out of scope department, rules 1–4 with deltas on seeded data, voids, SYP rates, last month, expired and revoked approval links, time budget); line services in `test/invoices.test.ts` (an out-of-scope 404 cannot happen: only holders of `invoices.manage` reach the route and they cover all clients)
- [x] bridge: build, `openapi:export`, `api:generate`; web typecheck (invoice mocks gain `service` and `canEditServices`; the draft editor keeps line services on save)
- [x] wiring checklist (spec: completion rounds down as R13; department default)
- [x] full checks (lint, typecheck, build, test, E2E pass; drift clean: `db:generate` reports nothing to migrate — the checker's `git status` probe flagged the uncommitted 0040 files), reviewer (no blocking issues)
- [x] owner acceptance (approved), dev database migrated (0040)
- [x] /ship

## PR 2 — `feat/f15-reports-api`: reports, Excel and the monthly client report PDF
- [x] contracts: productivity, revenue, overdue invoices, monthly client report schemas and queries; rules (on-time, aging buckets, revenue split by line, quote and payment, period ≤ 366 days, month validation) with unit tests; error codes `INVALID_DATES` / `INVALID_MONTH` if missing; audit action and entity `client_report.summary_changed`; `reports.pdf` queue in `jobs.ts`; `ar.json` keys
- [x] db (`/db-migration`, 0041, additive): `client_report_notes` (exception in `conventions.test.ts`), `client_report_pdfs`; `TABLE_OWNERS`; `content_posts.published_at` index if missing; drift
- [x] api exports extended (also `QuoteDirectory.acceptedLines`, `RetainerCyclesService.ofMonth`, `UserDirectory.departmentNames`, `contentDisposition` from `files`): `TaskReports` (productivity), `InvoiceReports` (revenue split through `quotes` exports, overdue), `EngagementReports` (cycles, projects), `ContentReports`, `ShootReports`, `CampaignReports` (campaign updates, wallet), `ApprovalReports` (closed items)
- [x] api `reports`: productivity, revenue, overdue invoices (rules 8–16), monthly client report and summary (rules 17–19), Excel builder (rule 24; `exceljs`, approved by the owner), PDF request / download (rule 20) with the `files.purge-uploads` cleanup
- [x] worker (with `test/reports-pdf.test.ts`; shared Arabic labels in `contracts/report-labels.ts`): `reports-pdf.job.ts` and the Arabic client report template (ADR 0008 pipeline)
- [x] api tests: `test/reports.test.ts`, `test/client-report.test.ts` (rules 8–20, Excel contents, PDF queued once per payload, audit)
- [x] bridge; web typecheck
- [x] wiring checklist (`docs/architecture.md`, spec details settled), full checks (incl. drift), reviewer (no blocking issues; period filters made index-friendly with `inBusinessPeriod`)
- [x] owner acceptance (approved, with the spec details settled in this PR), dev database migrated (0041)
- [x] /ship

## PR 3 — `feat/f15-web`: home dashboard, invoice services, reports screens and the monthly client report
- [ ] web `features/dashboard/`: home `/` with the five sections (rules 1–7), each with loading, empty and error states, refresh, phone collapsible; navigation: "Home" first
- [ ] web invoices: Service column in the draft editor and the issued invoice page, "Services" dialog
- [ ] web: a report period error message (`INVALID_DATES` from the reports means "to before from, or over 366 days"; today's `errors.INVALID_DATES` text speaks of a project's dates)
- [ ] web `features/reports/`: `/reports` index, productivity, revenue, overdue invoices (period pickers, filters, Excel download); navigation "Reports"
- [ ] web monthly client report `/clients/$clientId/report` (sections, preliminary badge, summary editor, PDF and Excel) and the client profile action
- [ ] e2e: mocks, `f15.spec.ts` (role sections, reports, summary), screenshots (home for General Manager, department manager, account manager, Finance, employee; phone; Services dialog; each report screen; monthly client report), both themes
- [ ] wiring checklist, full checks, reviewer, owner acceptance (browser steps 1–8), /ship
