# 0024 — Invoices: automatic drafts, numbering at issue, voids, and payments with their own rate
Status: Accepted · Date: 2026-10-02

## Context
F13 (`docs/specs/F13-invoicing-collection.md`) adds invoicing and collection. Projects carry installments per milestone (ADR 0015), retainers a monthly fee and cycles, quotes an accepted one-off net and installments (ADR 0023), and money is stored in minor units with stored rates (ADR 0006). The owner decided: Finance, the Operations manager and the General Manager issue invoices and record payments; the deposit is drafted at quote acceptance and every other installment when its milestone is done; a retainer month is drafted in full and in advance when its cycle opens; the rate comes from a "current rate" setting that Finance keeps up to date and that each document may override; a wrong invoice is voided (no credit notes); a payment belongs to one invoice and never exceeds its balance; overdue invoices alert Finance, the Operations manager and the account manager, then weekly; every payment gets a numbered receipt; statements are per currency with a PDF; project expenses are recorded by invoice managers and the client's account manager.

## Decision
- **Drafts, never automatic issue.** Three triggers draft invoices inside the transaction of the event: quote accepted (the milestone holding the first installment), milestone done (its installment), cycle opened (the monthly fee). The `invoices` module registers into hooks exported by `quotes` (`QuoteAcceptedHooks`) and `projects` (`MilestoneDoneHooks`, the existing `CycleOpenedHooks`), so neither imports `invoices`. A human issues every invoice.
- **One live invoice per source.** Invoice lines may point to a milestone, a cycle or an extra work item; a partial unique index over lines of non-void, non-archived invoices keeps each source billed once. `projects` asks a `BillingLocks` registry before changes that would contradict an invoice.
- **Numbers at issue.** Drafts have no number. Issuing takes the next `INV-<year>-<n>` from a locked counter, fixes the rate and the due date, freezes a render payload and renders the PDF through the ADR 0008 pipeline. An issued invoice is immutable except its due date; mistakes are voided with a reason, keeping the number.
- **Rates.** One current rate (SYP per USD, `numeric(12,4)`) lives in the invoice settings and is copied onto each invoice at issue, each payment and each expense, where it can be edited. Every invoice stores a rate, USD ones included, so SYP views are possible. Reports convert with the stored rates only.
- **Payments.** Each payment has its own currency and rate and an amount applied to its single invoice in the invoice's currency, rounded half up; a difference smaller than one minor unit of the payment's currency settles the balance, anything more than the balance is refused. Status (`sent`, `partially_paid`, `paid`, `overdue`) is recomputed from the applied total and the due date by one pure function.
- **Collection.** A daily job marks overdue invoices and alerts; a `notifications.daily` source repeats the alert every 7 days. Statements are computed per client and currency, never stored.

## Consequences
- F05 gains billing locks: a milestone on a live invoice cannot be reopened, re-priced or archived, and `billed` on extra work is set by issuing, not by hand.
- F15 reads invoices, payments and expenses with their stored rates for invoiced vs collected, outstanding, revenue by client and overdue reports.
- No credit balance exists: refunds and overpayments stay outside the system in V1.
- The worker renders three more document kinds (invoice, receipt, statement); Q7 (swap) matters more before the Phase 3 deploy.
