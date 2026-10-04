# 0027 — Reports computed on read through module report services; revenue by service from invoice lines
Status: Accepted · Date: 2026-10-04

## Context
F15 (`docs/specs/F15-dashboards-reports.md`) adds role dashboards and exportable reports over data owned by almost every module: tasks, engagements and cycles, invoices and payments, leads, campaigns and wallets, posts, shoots and approvals. ADR 0013 forbids a module from querying another module's tables. Invoices carry no catalog service, yet the scope asks for revenue by service. The owner decided: one home page with a section per role; Excel for every report and a branded PDF only for the monthly client report; the account manager writes an optional summary on that report; revenue is invoiced (with collected beside it); invoice lines get an optional service and lines covering several services are split by the accepted quote; the Operations manager gets the financial reports.

## Decision
- **On read, no stored aggregates.** Dashboards and reports are computed per request from the source tables; nothing is cached or snapshotted. Data volume (~20 users, ~20 clients) keeps this fast; historical stability comes from the stored rates (ADR 0006) and the frozen cycle counts (ADR 0015), not from snapshots.
- **A `reports` module that owns no business data.** It composes read-only report services exported by each module (`TaskReports`, `EngagementReports`, `InvoiceReports`, `LeadReports`, `CampaignReports`, `ContentReports`, `ShootReports`, `ApprovalReports`), each taking a scope filter and a period. It owns only the monthly report summaries and their temporary PDFs. No module imports `reports`.
- **Revenue by service.** `invoice_lines.service_id` is optional and editable by invoice managers even after issue (it is not printed). A line without one is split by the accepted quote of its project (one-off lines) or retainer (monthly lines) in proportion to the quote's line totals; packages count as themselves; anything else is "Unclassified". `InvoiceReports` does the split, reading quote lines through `quotes`' exports.
- **Exports.** The API builds Excel files on request (RTL sheets). The monthly client report PDF is rendered by the worker through the ADR 0008 pipeline, kept 24 hours and not stored as a document, like F13 statements.
- **Permissions.** The Internal Operations manager gains `reports.finance` `all`; scopes of `reports.read` (`all`, `department`, `own_clients`) decide which sections and reports a user sees.

## Consequences
- Each module gains a small read-only export; report rules (conversion rate, completion, on time, aging, the revenue split) live as pure functions in `packages/contracts` and are unit tested.
- Past reports change when a past record is corrected (a void, an archived mistake); this is intended: reports show the corrected truth.
- A future need for heavy or historical analytics would add snapshot tables or a read replica; nothing in V1 depends on that.
- The home page replaces the redirect to My tasks (UX-24).
