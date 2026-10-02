# TASKS — F13 Invoicing and collection (with the invoice parts of A01, A02 and A10)

Spec: `docs/specs/F13-invoicing-collection.md` · ADRs 0006, 0007, 0008, 0013, 0014, 0015, 0018, 0019, 0022, 0023, 0024 · Seven PRs, each leaves `main` green and fully wired.

## PR 1 — `feat/f13-invoices-api`: settings, manual drafts, issue, void
- [x] contracts: `money.ts` (rule 30: `exchangeRateSchema`, `convertMinor`, `toUsdMinor`, `invoiceTotal`) with unit tests; `invoices.ts` (statuses, origins, source types, `invoiceStatus` rule 21, `rateIsStale`, settings, create, draft, issue, due date, void, billable items, list query and page with totals, detail with `permissions`, snapshot) with unit tests; permission map (Operations manager `invoices.manage` + `payments.manage` all; new `expenses.manage` for the four holders) with tests; error codes; audit actions and entity types (`invoice_settings`, `invoice`); client `billingName`, `billingAddress`; `ar.json` keys for errors and audit (actions, entity types, fields)
- [x] db (`/db-migration`): enums `invoice_status`, `invoice_origin`, `document_number_kind`; `invoice_settings` (seeded row, migration 0029), `document_numbers`, `invoices`, `invoice_lines` (partial unique indexes on sources where `holds_source`); `clients.billing_name`, `billing_address`; `TABLE_OWNERS`; conventions exceptions; drift
- [x] api `clients`: billing fields on `PATCH` and in the detail, `ClientDirectory.billingDetails`
- [x] api `projects`: `BillingSources` (billable work, source resolution, engagements, extra work `billed` / `unbilled` with F05's audit)
- [x] api `quotes`: `QuoteDirectory` (company details, quote numbers)
- [x] api `invoices` module: settings get / patch; list (scopes, filters, totals per currency and in USD), detail with `permissions`; billable items; create (rules 1, 6), whole-draft `PUT` (rule 7, `STALE_INVOICE`, 50 lines), archive (rule 8), issue (rules 9–11, numbering under the counter lock, snapshot), due date (rule 13), void (rule 14); audit; source indexes answer `ALREADY_INVOICED`; `app.module.ts`; `docs/architecture.md`
- [x] api tests: `test/invoices.test.ts`; `removeInvoices` in test cleanup
- [x] bridge: build, `openapi:export`, `api:generate`; client detail mock gains the billing fields; web typecheck
- [x] wiring checklist, full checks (+ drift), reviewer (three findings fixed: USD balance of a void invoice, `canEdit` on an archived client's draft, missing 403 and error-code tests), owner acceptance (approved), /ship

## PR 2 — `feat/f13-invoice-drafts`: automatic drafts and billing locks
- [ ] api `quotes`: `QuoteAcceptedHooks` run at the end of the accept transaction
- [ ] api `projects`: `MilestoneDoneHooks`; `BillingLocks` registry; rule 24 `CURRENCY_LOCKED`, rule 25 (`MILESTONE_INVOICED`, `ALREADY_INVOICED`, `BILLED_BY_INVOICE`) with their error codes and `ar.json` keys
- [ ] api `invoices`: A01, milestone done and A02 drafts (rules 2–5, skip rules); registers the billing locks source
- [ ] api tests: `test/invoice-drafts.test.ts` (each trigger incl. job, new retainer, resume, reactivate; rollback with the trigger; skip rules; locks); adapted F05 tests
- [ ] bridge; web typecheck (F05 extra work billing UI no longer offers `billed`)
- [ ] wiring checklist, full checks, reviewer, owner acceptance, /ship

## PR 3 — `feat/f13-payments-api`: payments, overdue and notifications
- [ ] contracts: `applyPayment` with unit tests; payment schemas; audit `payment.*`, `invoice.overdue`; notification types `invoice_overdue`, `invoice_paid` with subject `invoice` (and `ar.json` keys); job `invoices.daily`
- [ ] db (`/db-migration`): `payment_method` enum, `payments`; receipt numbers through `document_numbers`; drift
- [ ] api: record payment (rules 16–21, row lock, proof upload as an invoice document), void payment (rule 22), `invoice_paid` (rule 23); daily job (overdue, null actor) scheduled by the worker; `invoices-overdue` source of `notifications.daily`
- [ ] api tests: `test/payments.test.ts` (concurrency, settle tolerance, overpayment, status recompute, job and reminder idempotency)
- [ ] bridge; web typecheck
- [ ] wiring checklist, full checks (+ drift), reviewer, owner acceptance, /ship

## PR 4 — `feat/f13-billing-api`: statements, expenses, billing summaries, calendar
- [ ] contracts: `statementRows` with unit tests; statement, client / project / retainer billing, expense schemas; audit `project_expense.*`; key date kind `invoice_due`
- [ ] db (`/db-migration`): `project_expenses`; drift
- [ ] api: client billing and statement (rule 28), project billing and margin (rule 27), retainer billing, expenses (rule 26), calendar `invoice_due` key dates filtered by invoice access
- [ ] api tests: `test/project-expenses.test.ts`, statement and billing cases, calendar filtering
- [ ] bridge; web typecheck
- [ ] wiring checklist, full checks (+ drift), reviewer, owner acceptance, /ship

## PR 5 — `feat/f13-invoices-pdf`: invoice, draft, receipt and statement PDFs
- [ ] contracts: jobs `invoices.pdf`, `invoices.pdf-ready` (kinds `invoice`, `invoice_draft`, `receipt`, `statement`), render payloads
- [ ] db (`/db-migration`): `file_owner_type` gains `invoice`, `file_items.invoice_id`; PDF state columns if not added earlier; drift
- [ ] worker: Arabic RTL brand templates for the four kinds, handler idempotent per payload hash; worker test with text extraction
- [ ] api: queue on issue, due date change, payment and preview; ready handler attaching once; `POST` / `GET` PDF endpoints for invoices, receipts and statements; daily re-queue; statement objects purged after 24 hours; `test/invoice-pdf.test.ts`
- [ ] bridge; web: invoice documents in the client Files tab
- [ ] wiring checklist, full checks (+ drift), reviewer, owner acceptance, /ship

## PR 6 — `feat/f13-invoices-web`: invoice screens
- [ ] web `features/invoices/`: list with tabs and totals, new invoice dialog, editor with billable items picker, issue dialog, invoice page with payments, payment dialog, void and due date dialogs, settings page; routes; nav item; `ar.json` `invoices` namespace; loading, empty, error states
- [ ] e2e: fixtures, `f13-invoices.spec.ts` (issue a drafted invoice, two payments, paid; role differences), screenshots light + dark
- [ ] wiring checklist, full checks (+ E2E), reviewer, owner acceptance, /ship

## PR 7 — `feat/f13-billing-web`: client, project, retainer and calendar
- [ ] web: client Invoices tab with balances and statement, billing fields on Basics; project Billing section (milestones, invoices, expenses, margin); retainer Billing section; `invoice_due` on the calendar
- [ ] e2e: fixtures, flows, screenshots light + dark (client Invoices tab, project Billing, rendered PDFs)
- [ ] wiring checklist, full checks (+ E2E), reviewer, owner acceptance (the full spec acceptance), /ship
