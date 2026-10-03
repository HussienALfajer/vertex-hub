# F13 — Invoicing and collection

Status: Approved · Date: 2026-10-02 · Scope: `docs/product/v1-scope.md` §F13 (and the invoice parts of A01 and A02, and A10) · ADRs: 0006, 0007, 0008, 0013, 0014, 0015, 0018, 0019, 0022, 0023, 0024

## Summary
Delivered work is not invoiced, nobody knows what a client owes, and overdue invoices are not followed up (problem 6, success metric 5). F13 adds **invoices** in USD or SYP with sequential numbers and a branded Arabic PDF, drafted automatically from the work the system already knows — the first installment when a quote is accepted (A01), each project milestone's installment when the milestone is done, each retainer month when its cycle opens (A02) — or by hand for extra work and anything else. Finance and the Operations manager issue them, record **payments** (partial, in either currency, with their own exchange rate and a numbered receipt), void mistakes, and follow the **overdue** alerts (A10). Each client gets a **statement** (invoiced, paid, outstanding) on screen and as a PDF, and each project an optional list of direct **expenses** for a basic margin.

## In scope / out of scope
- In:
  - Invoice settings: the current exchange rate (SYP per USD) with its date, default payment terms (7 days), payment details and a footer printed on invoices.
  - Billing details on the client profile: billing name and billing address, printed on invoices, receipts and statements.
  - Invoices: one client, one currency, optionally one project or retainer; lines with description, quantity and unit price, each optionally tied to a billable source (a milestone installment, a retainer cycle, an extra work item); notes.
  - Automatic drafts: A01 (the installment of the milestone holding the quote's first installment), milestone done (its installment), cycle opened (the retainer's monthly fee, A02). Manual drafts from a "billable items" picker or with free lines.
  - States `draft → sent → partially_paid → paid`, `overdue` while past due with a balance, `void`. Issuing assigns the number, fixes the rate and the due date, and renders the PDF. Changing the due date of an issued invoice. Voiding with a reason.
  - Payments: date, amount, currency, rate, method (cash, bank transfer, e-wallet), provider/reference, note, optional proof file; a numbered receipt PDF; voiding a payment with a reason.
  - A10: the daily job marks invoices overdue and alerts Finance, the Operations manager and the account manager, then reminds them every 7 days while unpaid.
  - `invoice_paid` notification to the client's account manager.
  - Client statement per currency and period, on screen and as a PDF.
  - Project expenses (date, description, amount, currency, rate) and a project margin in USD.
  - Screens: invoice list, invoice editor and page, payment dialog, invoice settings, the client's Invoices tab with the statement, the Billing section of project and retainer pages, invoice due dates on the company calendar for invoice readers.
- Out (later or never):
  - Full accounting: journals, ledgers, balance sheet, tax, exchange gains and losses (scope; ADR 0006 reporting uses stored rates only).
  - Online payment, payroll (scope).
  - Credit notes (owner decision: void and issue a new invoice), client credit balances and overpayments (owner decision: refused), one payment spread over several invoices (owner decision: record one payment per invoice).
  - Prorated first retainer month (owner decision: full fee, billed in advance, consistent with F05 R4).
  - Sending invoices, receipts or statements by email (Q5, Phase 4); the PDFs are downloaded and sent by hand.
  - English PDFs (Arabic only, as F04), discounts on invoices (prices are edited per line; discounts were approved on the quote), retainer expenses.
  - Financial reports and dashboards (invoiced vs collected, revenue by client and service, overdue invoices report): F15 reads these tables with `reports.finance`.

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `invoices.manage` and `payments.manage`: new department capability for the Internal Operations **manager**, `all` (owner decision, ADR 0007). Finance and the General Manager keep `all`.
- New permission **`expenses.manage`**: General Manager `all`, Finance `all`, Internal Operations manager `all`, Account Manager `own_clients` (owner decision).
- `invoices.read` is unchanged: General Manager, Finance, Operations manager `all`; Account Manager `own_clients`. It remains F05's **money access**.
- "Invoice managers" below means holders of `invoices.manage` (General Manager, Finance, Operations manager); all hold it with scope `all`.

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| Read invoice settings | `invoices.read` | every invoice reader |
| Edit invoice settings and the current rate | `invoices.manage` | invoice managers |
| List and open invoices, download invoice and receipt PDFs, see payments | `invoices.read` | General Manager, Finance, Operations manager: all · Account Manager: own_clients |
| Create, edit, discard drafts; issue; change the due date; void | `invoices.manage` | invoice managers |
| Record and void payments | `payments.manage` | invoice managers |
| Read a client's statement and its PDF | `invoices.read` covering the client | as for invoices |
| Read project expenses and margin | `invoices.read` covering the client (money access) | as for invoices |
| Add, edit, archive project expenses | `expenses.manage` covering the client | invoice managers: all · Account Manager: own_clients |
| Edit a client's billing details | `clients.manage` covering the client (F02) | General Manager, Operations manager: all · Account Manager: own_clients |
| See invoice due dates on the calendar | `calendar.read` + `invoices.read` covering the client | invoice readers |

## Data

Module ownership: a new `invoices` module owns the invoice tables, payments, settings and numbers. It imports `clients` (`ClientDirectory`, billing details), `projects` (`EngagementDirectory` for projects, milestones, retainers, cycles and extra work), `quotes` (company details from the quote settings, and the accepted quote's first installment), `files` (owner policy for `invoice`), `notifications`, `audit` and `auth`. It reaches into other modules only through hooks they export, so none of them imports `invoices`:
- `projects` exports **`MilestoneDoneHooks`** (a copy of `CycleOpenedHooks`) and runs it in the transaction that marks a milestone done; `invoices` registers the milestone draft and the A02 draft (`CycleOpenedHooks`, which exists).
- `projects` defines a **`BillingLocks`** registry (the `WorkProgressSource` pattern): `invoices` registers a source answering which milestones, cycles and extra work items are on a non-void invoice and which projects and retainers have invoices, so `projects` can refuse the changes in rule 25.
- `invoices` also owns `project_expenses` (finance data about a project) and serves the project and retainer billing summaries, reading projects, milestones and cycles through `EngagementDirectory`.
- `quotes` exports **`QuoteAcceptedHooks`**, run at the end of the accept transaction (F04 A9) with the quote, the created project and the first installment's milestone; `invoices` registers the A01 draft.

Money fields are integer minor units in the record's currency (ADR 0006). An **exchange rate** is `numeric(12,4)`, SYP per 1 USD, > 0, carried in the API as a decimal string (`"118.5000"`) and converted only through the tested functions of rule 30. Dates without a time are calendar days in Asia/Damascus.

### `invoice_settings` (single row, seeded by its migration)
| Field | Type | Rules |
|---|---|---|
| `singleton` | boolean | primary key, always true |
| `syp_per_usd` | numeric(12,4) | optional until first set; > 0; the **current rate** offered on new documents (owner decision) |
| `rate_updated_at`, `rate_updated_by_id` | timestamptz, uuid → `users.id` | set when the rate changes; the UI warns when older than 7 days |
| `payment_terms_days` | integer | required, default 7, 0–90; the default days from issue to due |
| `payment_details` | text | ≤ 2000 chars, default ''; printed on invoices (bank and wallet details) |
| `invoice_footer` | text | ≤ 2000 chars, default ''; printed on invoices |
| `updated_at`, `updated_by_id` | | |

Company details printed on every invoice, receipt and statement come from the quote settings (F04), relabelled "Company details (quotes and invoices)".

### `document_numbers` (counter)
`kind` (enum `document_number_kind`: `invoice`, `receipt`) + `year` (primary key together), `last_number`. Locked by the transaction that assigns a number. Displays: invoices `INV-<year>-<number padded to 4>`, receipts `RC-<year>-<number padded to 4>`; the year is the Asia/Damascus year of issue.

### `invoices` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `client_id` | uuid → `clients.id` | required, indexed |
| `project_id` / `retainer_id` | uuid → `projects.id` / `retainers.id` | at most one set (check); indexed. Set by the sources of the lines, or chosen for a free-line invoice; the invoice's currency must equal the engagement's (`CURRENCY_MISMATCH`) |
| `quote_id` | uuid → `quotes.id` | set on the A01 draft; indexed |
| `origin` | enum `invoice_origin` (`quote_accepted`, `milestone_done`, `cycle_opened`, `manual`) | required; how the draft started |
| `year`, `number` | integer ×2 | null on drafts; assigned on issue; unique `(year, number)` where set |
| `currency` | `currency` enum | required; fixed after creation |
| `status` | enum `invoice_status` (`draft`, `sent`, `partially_paid`, `paid`, `overdue`, `void`) | required, default `draft`, indexed |
| `payment_terms_days` | integer | draft only: 0–90, default from settings; proposes the due date at issue |
| `issued_on`, `due_on` | date ×2 | set on issue; `due_on` ≥ `issued_on`; `due_on` indexed |
| `syp_per_usd` | numeric(12,4) | set on issue (ADR 0006: the rate at issue); also set on USD invoices for SYP views |
| `total_minor` | bigint | Σ line totals, kept on every save; > 0 to issue |
| `paid_minor` | bigint | Σ `applied_minor` of the invoice's non-void payments; kept by every payment change; ≤ `total_minor` |
| `notes` | text | optional, ≤ 2000 chars, printed |
| `snapshot` | jsonb | the frozen render payload of an issued invoice (rule 15); replaced when the due date changes |
| `pdf_status`, `pdf_file_item_id` | enum `pdf_status` (`pending`, `ready`, `failed`), uuid → `file_items.id` | the PDF of the issued invoice, as F04 rule 12 |
| `draft_pdf_*` | as `quotes` | the draft preview, as F04 rule 13 |
| `issued_by_id`, `voided_by_id`, `voided_at`, `void_reason` | | void reason required, ≤ 500 chars |
| `created_by_id` | uuid → `users.id` | null for automatic drafts |
| timestamps, `archived_at` | | archived = a discarded draft; issued invoices are never archived, they are voided |

### `invoice_lines` (business table)
| Field | Type | Rules |
|---|---|---|
| `id`, `invoice_id` | | indexed `(invoice_id, position)` |
| `description` | text | required, 1–300 chars |
| `quantity` | integer | 1–999 |
| `unit_price_minor` | bigint | ≥ 0, in the invoice's currency |
| `milestone_id` / `retainer_cycle_id` / `extra_work_item_id` | uuid → `project_milestones.id` / `retainer_cycles.id` / `extra_work_items.id` | at most one set (check); each indexed |
| `holds_source` | boolean | true while the invoice is not void and not archived; partial unique indexes on each source column `where holds_source` keep a source on one live invoice (rule 4) |
| `position` | integer | dense from 1 |

At most 50 lines per invoice (`LIMIT_REACHED`).

### `payments` (business table)
| Field | Type | Rules |
|---|---|---|
| `id`, `invoice_id` | | indexed |
| `year`, `number` | integer ×2 | receipt number, assigned when recorded; unique |
| `paid_on` | date | required, ≤ today |
| `amount_minor` | bigint | > 0, in the payment's `currency` |
| `currency` | `currency` enum | required, default the invoice's |
| `syp_per_usd` | numeric(12,4) | required; default the current rate; for reports and for cross-currency application |
| `applied_minor` | bigint | > 0, in the invoice's currency; computed (rule 19) |
| `method` | enum `payment_method` (`cash`, `bank_transfer`, `e_wallet`) | required (owner decision) |
| `reference` | text | optional, ≤ 200 chars: bank or wallet name and transaction number |
| `note` | text | optional, ≤ 500 chars |
| `proof_file_item_id` | uuid → `file_items.id` | optional proof (a document of the invoice, F10) |
| `receipt_snapshot` | jsonb | the frozen render payload of the receipt (rule 20), taken when recorded |
| `receipt_pdf_status`, `receipt_file_item_id` | `pdf_status`, uuid | the receipt PDF (a document of the invoice) |
| `recorded_by_id`, `created_at` | | |
| `voided_at`, `voided_by_id`, `void_reason` | | a payment recorded by mistake; reason required, ≤ 500 chars; void payments keep their receipt number |

### `project_expenses` (business table)
| Field | Type | Rules |
|---|---|---|
| `id`, `project_id` | | indexed |
| `spent_on` | date | required, ≤ today |
| `description` | text | required, 1–200 chars |
| `amount_minor` | bigint | > 0, in `currency` |
| `currency` | `currency` enum | required, default the project's (may differ: ADR 0006, an amount that can differ from its parent's currency has its own column) |
| `syp_per_usd` | numeric(12,4) | required, default the current rate |
| `note` | text | optional, ≤ 500 chars |
| `logged_by_id` | uuid → `users.id` | from the session |
| timestamps, `archived_at` | | archived = entered by mistake; hidden and out of the margin |

### `statement_pdfs` (temporary, not a business table)
`client_id`, `hash` (unique: the render payload's hash), `status` (`pdf_status`), `storage_key`, `size_bytes`, `requested_at`. One row per statement render (rule 29); asking again for the same statement within 24 hours reuses it and restarts its 24 hours; the daily `files.purge-uploads` run deletes rows older than 24 hours with their objects.

### Changes to other tables
- `clients`: `billing_name` (optional, ≤ 160 chars; the client's name is printed when empty) and `billing_address` (optional, ≤ 500 chars).
- F10: new owner type `invoice` with role `document` only; readable by invoice readers covering the client; the client's Files tab lists invoice documents only to them.
- F11: new key date kind `invoice_due`.

## States and rules

### Invoice status
```
draft ──issue (invoice managers)──→ sent
sent | partially_paid | overdue ──payments change──→ recomputed (rule 21)
sent | overdue ──void (no non-void payments)──→ void
draft ──discard──→ archived
```
`overdue` is set by the daily job and by rule 21; `void` is final.

### Drafting
1. An invoice is created only for a non-archived client (`CLIENT_ARCHIVED`); ended and paused clients can be invoiced (work is billed after it is done). Archived projects and retainers give no new drafts (`PROJECT_ARCHIVED`, `RETAINER_ARCHIVED`).
2. **A01 (invoice part):** when a quote is accepted with a one-off section, the same transaction drafts one invoice (origin `quote_accepted`, `quote_id` set) for the milestone that holds the quote's first installment: one line "<project name> — <milestone name>" for that milestone's whole `installment_minor`, tied to the milestone (owner decision: the deposit is billed at acceptance). A quote with only a monthly section drafts nothing here; its retainer's month is drafted by rule 4 when the cycle opens.
3. **Milestone done:** marking a milestone `done` drafts an invoice (origin `milestone_done`) for its installment, unless the installment is null or 0 or the milestone is already on a live invoice (owner decision).
4. **A02 (invoice part):** opening a retainer cycle (the daily job, a new retainer starting today or earlier, resuming, reactivating) drafts an invoice (origin `cycle_opened`) with one line "<retainer name> — <month and year>" for the retainer's current `monthly_fee_minor`, tied to the cycle; billed in advance and in full, also for a partial first month (owner decision). A retainer without a fee gets no draft (F05 M4 keeps showing "fee missing"). A source (milestone, cycle, extra work item) is on at most one live invoice, enforced by the partial unique indexes; an automatic draft is skipped when its source is already taken.
5. Automatic drafts take the currency and engagement of their source, the settings' payment terms and no creator; they are never issued automatically. A hook that fails rolls back the action that triggered it (as `CycleOpenedHooks`).
6. **Manual drafts:** an invoice manager picks a client and a currency, then adds **billable items** of that client in that currency — done or pending milestones with an installment, retainer cycles (default amount: the retainer's current fee), and `unbilled` extra work items (default amount: their estimate, else 0) — and free lines. All sources of one invoice belong to one project or one retainer (`MIXED_ENGAGEMENTS`); a free-line invoice may be linked to a project or retainer of the client for its margin.
7. Draft lines are copies: every description, quantity and price is editable, and later changes to the source (a new installment amount, a new fee) do not change the draft. A whole-draft save carries `updatedAt` (`STALE_INVOICE`).
8. Discarding a draft archives it and releases its sources. An automatic draft that is discarded is not drafted again by its trigger; the source stays billable from the picker.

### Issuing
9. **Issue** requires a non-archived draft, at least one line, `total_minor` > 0 (`INVOICE_EMPTY`), a rate (the current rate by default, editable; `RATE_REQUIRED` when none is set), and a due date ≥ the issue date (default: issue date + the draft's payment terms). The issue date is today. Issuing assigns the next invoice number of the year, sets `issued_on`, `due_on`, `syp_per_usd`, the snapshot, status `sent`, and queues the PDF (rule 15).
10. A rate older than 7 days is a warning in the issue dialog, not a refusal.
11. Issuing sets every extra work item on the invoice to `billed` (F05 M3; `billing_note` not required for it). The invoice page and the extra work row link each other.
12. An issued invoice is immutable except the due date (rule 13), its payments and voiding. Mistakes are corrected by voiding and issuing a new invoice (owner decision).
13. **Change due date:** on `sent`, `partially_paid` and `overdue`, to a date ≥ today, with a reason (≤ 500 chars); the snapshot is updated, the PDF is rendered again as a new version of the same document, and the status is recomputed (rule 21).
14. **Void:** on `sent` and `overdue` only, when the invoice has no non-void payments (`INVOICE_HAS_PAYMENTS`; void those first), with a reason. The number stays used; the invoice drops out of every total; its sources are released (`holds_source` false), and its extra work items return to `unbilled`. Its PDF document stays, and the invoice page and the list show "void".
15. **PDF:** the API freezes the render payload (company details, client billing name and address, number, issue and due dates, lines, total, currency, notes, payment details, footer) and queues `invoices.pdf`; the worker renders it from an Arabic RTL template in the brand (fallback font until Q11); `invoices.pdf-ready` attaches it as a `document` of the invoice named `INV-<year>-<number>.pdf`, with F04 rule 12's hashing, idempotency, retries and "Render again". Draft previews follow F04 rule 13 with a "draft" watermark and no number.

### Payments
16. A payment is recorded on `sent`, `partially_paid` or `overdue` invoices (`INVALID_TRANSITION`), by a holder of `payments.manage`, under the invoice row lock.
17. Its currency defaults to the invoice's and may be the other one; its rate defaults to the current rate and is editable; `paid_on` ≤ today (`INVALID_DATES`), and may be before the issue date (money received before the invoice was issued).
18. A payment belongs to one invoice; an amount covering two invoices is recorded as two payments (owner decision).
19. **Application:** `applied_minor` is the amount in the invoice's currency: equal to `amount_minor` in the same currency; otherwise converted with the payment's rate, rounded half up (rule 30). When the result differs from the remaining balance by less than one minor unit of the payment's currency (converted), it is set to the balance, so a payment of "the rest" settles the invoice exactly. Otherwise an applied amount above the balance is refused (`OVERPAYMENT`; owner decision: no client credit).
20. Recording assigns the next receipt number, writes the payment, updates `paid_minor` and the status, and queues the receipt PDF (company details, client, receipt number, date, amount and currency, method and reference, the invoice number, the invoice's balance after it), attached as a `document` of the invoice named `RC-<year>-<number>.pdf`.
21. **Status** after any payment change, due date change or daily run, for an issued, non-void invoice: `paid` when `paid_minor` = `total_minor`; else `overdue` when `due_on` < today; else `partially_paid` when `paid_minor` > 0; else `sent`.
22. **Void a payment:** with a reason; `paid_minor` and the status are recomputed (a `paid` invoice can return to `partially_paid`, `sent` or `overdue`); the receipt number stays used and its document is archived.
23. `invoice_paid` is sent when an invoice becomes `paid` (rule 31).

### Engagements, expenses and statements
24. Changing a project's or retainer's currency is refused while it has invoices (`CURRENCY_LOCKED`, F05 M2): any invoice that is not a discarded draft, void ones included.
25. **Billing locks** (F05 changes): reopening a done milestone, editing its installment, or archiving it is refused while it is on a live invoice, draft included (`MILESTONE_INVOICED`; discard the draft or void the invoice first). An extra work item on a live invoice cannot be archived, waived or re-estimated (`ALREADY_INVOICED`). Setting `billed` by hand is no longer accepted (`BILLED_BY_INVOICE`); items marked `billed` by hand before F13 keep their note. The extra work billing dialog offers `unbilled` and `waived` only, and is not offered on `billed` items.
26. **Expenses:** allowed on non-archived projects in any status (expenses often arrive after delivery), by `expenses.manage` covering the client. The project must be readable first (F05: an archived project only by `projects.manage` scope-all holders, else 404).
27. **Project margin** (money access): invoiced = Σ `total_minor` of the project's issued, non-void invoices converted to USD with each invoice's rate; collected = Σ of their non-void payments' amounts converted with each payment's rate; expenses = Σ non-archived expenses converted with each expense's rate; margin = invoiced − expenses; shown in USD (reporting currency, ADR 0006), with the planned installments total in the project's currency beside it.
28. **Statement** for a client, a currency and a period (default: the current year to today): opening balance (issued non-void invoices before the period minus their non-void payments' applied amounts before the period), each issued invoice in the period (debit) and each non-void payment in the period (credit, by its applied amount, with its original amount and currency when they differ), closing balance; and the totals invoiced, paid and outstanding. Void documents are left out. One statement per currency (owner decision).
29. The statement PDF is rendered on request by the worker with the same pipeline, downloadable for 24 hours and not kept as a document.

### General
30. **Money functions** in `packages/contracts/src/money.ts`, unit tested at the edges: `toUsdMinor(amount, currency, rate)`, `convertMinor(amount, from, to, rate)` (half up, exact integer arithmetic on the rate × 10⁴), `invoiceTotal(lines)`, `applyPayment(balance, amount, paymentCurrency, invoiceCurrency, rate)` (rule 19) and `statementRows(...)` (rule 28); `invoiceStatus(...)` (rule 21) lives with the invoice statuses in `invoices.ts`. The API, the web and the PDF use them.
31. Every change writes an audit entry in the same transaction; automatic drafts and the daily job write entries with a null actor.
32. Detail responses carry `permissions` flags. Outside the caller's scope a record is a 404 (an account manager on another manager's client).

## API

Schemas live in `packages/contracts/src/invoices.ts` (and the money functions above), reusing the list, money and error schemas. Lists take `page` and `pageSize` and return `{ items, total, page, pageSize }`. A record outside the caller's access is a 404.

### Invoice settings
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/invoice-settings` | `invoices.read` | — | `invoiceSettingsSchema` + `canEdit`, `rateStale` | — |
| `PATCH /api/invoice-settings` | `invoices.manage` | `updateInvoiceSettingsSchema`: sypPerUsd, paymentTermsDays, paymentDetails, invoiceFooter | `invoiceSettingsSchema` | 403 |

### Invoices
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/invoices` | `invoices.read` | `invoiceListQuerySchema`: `search` (number, client), `status[]` (default draft, sent, partially_paid, overdue), `clientId`, `projectId`, `retainerId`, `currency`, `origin`, `accountManagerId`, `dueFrom`/`dueTo`, `sort` (`updatedAt` default, `number`, `dueOn`), `order` | `invoicePageSchema`: id, display number, client, account manager, engagement, currency, status, issued and due dates, total, paid, balance, `daysOverdue`; plus `totals` per currency (outstanding, overdue) and in USD | — |
| `GET /api/invoices/billable` | `invoices.manage` | `{ clientId, currency }` | `billableItemsSchema`: milestones (project, name, status, installment), cycles (retainer, month, current fee), extra work (owner, title, estimate) | 404 (client) |
| `POST /api/invoices` | `invoices.manage` | `createInvoiceSchema`: clientId, currency, projectId?, retainerId?, sources[] ({ type, id }) | `invoiceDetailSchema` (a draft) | 403, `CLIENT_ARCHIVED`, `CURRENCY_MISMATCH`, `MIXED_ENGAGEMENTS`, `ALREADY_INVOICED`, `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED` |
| `GET /api/invoices/:id` | `invoices.read` | — | `invoiceDetailSchema`: all fields, lines with source links, payments (with receipts, proof, void state), USD equivalents, PDF and preview state, linked quote and engagement, `permissions` | 404 |
| `PUT /api/invoices/:id` | `invoices.manage` | `invoiceDraftSchema`: updatedAt, projectId?, retainerId?, paymentTermsDays, notes, lines[] (id?, description, quantity, unitPriceMinor, source?) — the whole draft | `invoiceDetailSchema` | 403, 404, `INVOICE_LOCKED`, `STALE_INVOICE`, `CLIENT_ARCHIVED`, `ALREADY_INVOICED`, `MIXED_ENGAGEMENTS`, `CURRENCY_MISMATCH`, `PROJECT_ARCHIVED`, `RETAINER_ARCHIVED`, `LIMIT_REACHED` |
| `POST /api/invoices/:id/issue` | `invoices.manage` | `{ updatedAt, dueOn, sypPerUsd }` | `invoiceDetailSchema` | 403, 404, `INVALID_TRANSITION`, `STALE_INVOICE`, `INVOICE_EMPTY`, `RATE_REQUIRED`, `INVALID_DATES`, `CLIENT_ARCHIVED` |
| `POST /api/invoices/:id/due-date` | `invoices.manage` | `{ dueOn, reason }` | `invoiceDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES` |
| `POST /api/invoices/:id/void` | `invoices.manage` | `{ reason }` | `invoiceDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVOICE_HAS_PAYMENTS` |
| `POST /api/invoices/:id/archive` | `invoices.manage` | — | 204 | 403, 404, `INVALID_TRANSITION` |
| `POST /api/invoices/:id/pdf` | `invoices.read` (draft preview: `invoices.manage`) | — | `{ state }` | 403, 404, `INVALID_TRANSITION` |
| `GET /api/invoices/:id/pdf` | `invoices.read` | `?draft=true` for the preview | the PDF inline, `<client> - INV-<year>-<number>.pdf`, never cached | 404 (also while not ready) |

### Payments
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/invoices/:id/payments` | `payments.manage` | `recordPaymentSchema`: paidOn, amountMinor, currency, sypPerUsd, method, reference, note, proofUploadId? | `invoiceDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES`, `OVERPAYMENT`, `UPLOAD_NOT_FOUND` |
| `POST /api/payments/:id/void` | `payments.manage` | `{ reason }` | `invoiceDetailSchema` | 403, 404, `INVALID_TRANSITION` (already void) |
| `POST /api/payments/:id/receipt` | `invoices.read` | — (render again after a failure) | `{ state }` | 404 |
| `GET /api/payments/:id/receipt` | `invoices.read` | — | the receipt PDF inline, `<client> - RC-<year>-<number>.pdf` | 404 |

### Statements, expenses, billing summaries
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/clients/:id/billing` | `invoices.read` covering the client | — | `clientBillingSchema`: per currency invoiced, paid, outstanding, overdue; latest invoices | 404 |
| `GET /api/clients/:id/statement` | `invoices.read` covering the client | `{ currency, from, to }` | `clientStatementSchema` (rule 28) | 404, `INVALID_DATES` |
| `POST /api/clients/:id/statement/pdf` · `GET` same path with the query | `invoices.read` covering the client | `{ currency, from, to }` | `{ state }` · the PDF inline | 404 |
| `GET /api/projects/:id/billing` | money access | — | `projectBillingSchema`: milestones with installment and invoice (number, status) or "not invoiced", expenses, margin (rule 27) | 404 (403 without money access) |
| `POST /api/projects/:id/expenses` · `PATCH /api/project-expenses/:id` · `POST /api/project-expenses/:id/archive` | `expenses.manage` covering the client | `projectExpenseSchema` | `projectBillingSchema` | 403, 404, `PROJECT_ARCHIVED`, `INVALID_DATES` |
| `GET /api/retainers/:id/billing` | money access | — | `retainerBillingSchema`: cycles with their invoice or "not invoiced", extra work with invoices | 404 (403 without money access) |

Changes to other endpoints:
- F02: `PATCH /api/clients/:id` accepts `billingName`, `billingAddress`.
- F05: milestone done, reopen, installment edit and archive, extra work billing and archive return the codes of rule 25; `billing_status: 'billed'` is refused (`BILLED_BY_INVOICE`).
- F11: `GET /api/calendar` returns `invoice_due` key dates (number, client, status; no amounts) of open invoices (`sent`, `partially_paid`, `overdue`) only for invoices the caller may read; the `clientId` and `userId` filters apply as for renewals.

## Screens

1. **Invoices** `/invoices` (invoice readers) — tabs **To issue** (drafts, managers only), **Open** (sent, partially paid, overdue), **Overdue**, **Paid**, **Void**, **All**. Table: number (or "draft"), client, engagement, origin badge (from quote, milestone, monthly, manual), currency, total, paid, balance, issued, due with "N days overdue" badge, status badge. Filters: client, currency, account manager, due range; "My clients" toggle for account managers. Outstanding and overdue totals per currency and in USD above the table. "New invoice" (dialog: client, currency). Empty states per tab ("No drafts to issue").
2. **Invoice editor** `/invoices/$invoiceId` while `draft` (managers) — client and billing name, currency, engagement link, origin; lines (description, quantity, unit price, line total, source chip linking to the milestone, cycle or extra work); "Add billable items" (picker grouped by project, retainer and extra work) and "Add line"; payment terms; notes; total; the current rate and its date with a stale warning. Actions: save (explicit, unsaved-changes guard), "Preview PDF", "Issue" (dialog: issue date today, due date, rate, total and USD equivalent, warning when the rate is stale), "Discard".
3. **Invoice page** `/invoices/$invoiceId` when issued — header: number, status, client, engagement, issued and due dates, total, paid, balance (and USD equivalents for managers); PDF download or "being prepared"; lines; payments table (receipt number, date, amount and currency, applied amount, method, reference, recorded by, proof, receipt PDF, void state). Actions: "Record payment" (dialog: date, amount with "Pay the rest", currency, rate shown when it differs or always for SYP, method, reference, note, proof upload; shows the applied amount and the balance after), "Void payment", "Change due date", "Void invoice" (reason; disabled with the reason while payments exist). Account managers see the page read-only.
4. **Invoice settings** `/invoices/settings` — current rate with "updated <date> by <name>" and an update field, payment terms, payment details, footer; read-only for account managers.
5. **Client profile** (F02) — new **Invoices** tab for invoice readers covering the client: balance cards per currency (invoiced, paid, outstanding, overdue), the client's invoices, "New invoice" (managers), and **Statement** (currency, from, to; the table of rule 28; "Download PDF"). The profile has no Basics tab: the billing name and address head the Invoices tab, edited there with `clients.manage` covering the client.
6. **Project page** (F05) — a **Billing** section for money access: milestones with installment and invoice status ("not invoiced", "draft", "INV-… paid"), "Create invoice" on uninvoiced milestones (managers), invoices of the project, expenses (table, "Add expense" for `expenses.manage`, archive), margin card (invoiced, collected, expenses, margin in USD; planned installments).
7. **Retainer page** (F05) — a **Billing** section for money access: cycles with their invoice or "not invoiced" and "Create invoice"; extra work rows link their invoice.
8. **Calendar** (F11) — `invoice_due` key dates for invoice readers ("INV-2026-0012 due — <client>"), opening the invoice.

Loading, empty and error states follow the existing list and detail pages. What roles see differently: invoice managers act; account managers read their clients' invoices, statements and margins and add expenses; everyone else sees no Invoices menu, no Invoices tab, no Billing section and no invoice key dates.

## Audit, notifications and jobs
- Audit (entities `invoice_settings`, `invoice`, `payment`, `project_expense`; invoice and payment entries carry `clientId` and the number): `invoice_settings.updated` (rate before/after), `invoice.created` (origin, source ids; null actor when automatic), `invoice.updated` (total before/after), `invoice.archived`, `invoice.issued` (number, total, rate, due date), `invoice.due_date_changed` (before/after, reason), `invoice.overdue` (null actor), `invoice.voided` (reason), `payment.recorded` (receipt number, amount, currency, rate, applied, invoice status before/after), `payment.voided` (reason, status before/after), `project_expense.created` / `updated` / `archived`; client billing fields through F02's `client.updated`; extra work `billed` / `unbilled` through F05's entries. Every `audit.read` holder also holds `invoices.read` `all`, so entries are unfiltered.
- Notifications (F14 catalog, new subject `invoice`):
  - `invoice_overdue` → users with the Finance role, the Internal Operations manager(s) and the client's account manager (owner decision), when the invoice becomes overdue and again every 7 days while it stays overdue ("INV-… is N days overdue"); category `reminders`, can be muted.
  - `invoice_paid` → the client's account manager, when an invoice becomes `paid`, unless they recorded the payment (owner decision); category `clients_projects`, can be muted.
- Jobs:
  - `invoices.daily`: pg-boss cron `15 0 * * *` Asia/Damascus, scheduled by the worker and worked by the API: sets `overdue` (rule 21) with `invoice_overdue`, one transaction per invoice under its row lock, and queues again issued invoices and receipts whose PDF is still `pending`. Idempotent. `invoices:run-daily --date` runs it in development.
  - A new source `invoices-overdue` of `notifications.daily` sends the 7-day reminders with `remindOnce` per invoice and week (the `retainer-renewals` pattern). `notifications:run-daily --date` runs it in development.
  - `invoices.pdf` (worker; kinds `invoice`, `invoice_draft`, `receipt`, `statement`), retry 3; `invoices.pdf-ready` (API; attaches invoice and receipt PDFs, records statement objects). Idempotent per payload hash. Statement objects older than 24 hours are deleted by the existing files purge job.

## Edge cases
1. Two managers save the same draft: `STALE_INVOICE`; the editor reloads.
2. Two payments recorded at once on one invoice: the row lock orders them; the second sees the new balance and may get `OVERPAYMENT`.
3. Two invoices issued at once: the `document_numbers` row lock gives consecutive numbers; numbers have no gaps except voided invoices, which keep theirs.
4. A milestone is marked done while a manual draft already holds it: no second draft (rule 4).
5. A cycle opens for a retainer whose fee changed after renewal (F04 A7): the draft uses the fee at that moment.
6. A retainer is ended mid-month after its month was invoiced: nothing changes automatically; a manager voids the invoice (if unpaid) and issues a corrected one.
7. A USD invoice paid in SYP at a rate that converts to slightly more or less than the balance: within one SYP minor unit converted, it settles exactly (rule 19); otherwise the remainder stays open or the payment is refused as overpayment, and the dialog shows the converted amount before saving.
8. The current rate is never set: issuing and recording payments ask for a rate (`RATE_REQUIRED` when missing); the settings page prompts to set it.
9. A client's account manager changes: the new one reads the client's invoices and receives later alerts at once.
10. An archived client: its invoices stay readable; no new drafts; payments on open invoices remain allowed (money still comes in).
11. A project is cancelled after its deposit invoice is paid: the invoice stays; refunds are out of V1 (recorded outside the system, noted on the project).
12. The worker is down at issue: the invoice is `sent` with "PDF being prepared"; the daily job and "Render again" re-queue it.
13. An automatic draft is discarded: the trigger does not recreate it; the source appears in "Add billable items".
14. Daily job missed for days: the next run marks every past-due invoice overdue once; reminders are sent only for the current week mark (no back-fill).
15. A payment dated before the issue date: allowed (rule 17); the statement places it on its date, so the opening balance can be negative for a period that ends before the invoice.
16. Volume: ~20 clients and a few dozen invoices a month need no special limits; ADR 0013 list rules apply.

## Open questions
- None blocks F13. Related, not blocking:
  - Q11: PDFs use the fallback Arabic font until the Madani Arabic license and files arrive.
  - Q7: swap on the server, required before the Phase 3 deploy (Chromium renders more PDFs now).
  - Q5: sending invoices, receipts and statements by email waits for the email provider (Phase 4).

## Acceptance
- Owner check in the browser:
  1. As Finance, open **Invoice settings**: set the rate (e.g. 118.50), payment terms 7 days, payment details and a footer. Add a billing name and address to a client.
  2. As the client's account manager, accept a quote with a one-off section (installments 50 % / 50 %) and a monthly section starting today (F04). Open **Invoices → To issue**: a draft for the first milestone's installment and a draft for this month's fee exist.
  3. As the Operations manager, preview the deposit draft's PDF, then issue it: it gets `INV-2026-0001`, the due date is today + 7, the PDF is Arabic RTL with the brand, billing details and payment details.
  4. Record a partial payment in USD by bank transfer with a reference: the invoice is `partially_paid`, a receipt `RC-2026-0001` PDF exists. Record the rest in SYP with "Pay the rest": the invoice is `paid` exactly, and the account manager got `invoice_paid`.
  5. Issue the monthly draft; run the daily job with a date past its due date: it is `overdue`, and Finance, the Operations manager and the account manager got `invoice_overdue`; run it 7 days later: the reminder arrives once.
  6. Mark the last milestone done: its draft appears. Try to reopen the milestone: refused while the draft exists.
  7. Log an extra work item on the retainer; create a manual invoice from "Add billable items" with it and a free line; issue it: the item shows `billed` with the invoice link. Void the invoice with a reason: the item returns to `unbilled`, and the number stays used.
  8. Try to void a paid invoice: refused; void its last payment, then the invoice can be voided.
  9. Add two expenses to the project (one in SYP): the Billing section shows invoiced, collected, expenses and margin in USD.
  10. Open the client's **Invoices** tab: balances per currency; view the statement for this year and download its PDF.
  11. Open the calendar: the open invoice's due date shows for Finance, not for an ordinary employee.
  12. As the account manager, read invoices without actions; as another account manager, the invoices are not found; as an employee, no Invoices menu and a 403 on the API.
  13. Open the audit log and find each change above.
- Tests:
  - Unit (contracts): money functions of rule 30 (half-up rounding at .5, large amounts, SYP↔USD both ways, the settle tolerance, overpayment), `invoiceStatus` for every combination, `statementRows` with payments before issue and voided documents, schemas (limits, rate format, dates), permission map changes (Operations manager `invoices.manage` and `payments.manage`; `expenses.manage` for the four holders), the new notification types and key date kind.
  - API (`apps/api/test/invoices.test.ts`, `payments.test.ts`, `invoice-drafts.test.ts`, `project-expenses.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; an account manager on manage endpoints; an employee anywhere); every error code above; rules 1–32; A01 drafting in the accept transaction and rolling back with it; milestone and cycle hooks (job, new retainer, resume, reactivate) with skip rules; numbering per kind and year under concurrency; payment locking; the daily job and reminder source with their idempotency; the PDF ready handler attaching once; the F05 billing locks; calendar key dates filtered by invoice access; audit entries in the same transaction.
  - Worker: `invoices.pdf` renders invoices, receipts and statements with Arabic text (a text extraction check) and is safe to run twice.
  - E2E: issue a drafted invoice, record two payments and see it `paid`.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): invoice list (To issue, Open), editor with billable items picker, issue dialog, invoice page with payments, payment dialog in the other currency, invoice settings, client Invoices tab with statement, project Billing section, one rendered invoice, receipt and statement page.
