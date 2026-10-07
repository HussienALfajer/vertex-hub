# 0029 — Retainer terms, charges and amendments
Status: Accepted · Date: 2026-10-07

## Context
ADR 0015 made retainers open-ended monthly commitments with one fee, and ADR 0024 drafts each month's invoice from the cycle at the current fee, never changes an issued invoice and keeps no credit balance. Clients sign fixed agreements ("3 months for 1,000 USD, paid 300 / 300 / 400"), ask for extra lines mid-contract with a price, and amounts change after a month is invoiced or paid. Nothing records the agreement or links a change to the invoices, so contracts and invoices drift apart silently. The owner's decisions are in `docs/specs/F05B-retainer-terms.md`.

## Decision
- **Terms.** A retainer may have fixed terms (1–36 months, an agreed total, a per-month schedule summing to it, and an end action: renew by default, end, or continue open-ended at the monthly fee). Terms stay on the calendar: pausing does not move them. Renewal creates the next term 30 days before the end with the same schedule, amendments made onward included.
- **Charges are the billing source.** Every billable amount of a retainer is a charge (`monthly`, `addition`, `credit`, `termination_fee`); invoice lines bill charges instead of cycles. A month's charge becomes due on its first day and drafts the month's invoice, independently of the cycle (a paused month in a term is still billed).
- **Amendments, never rewrites.** Every later change is a numbered amendment, one month or onward, with deliverable line changes and an amount change. An amount not yet invoiced changes; a draft is synced; an issued invoice, paid or not, is never touched: an increase drafts a supplementary invoice, a decrease becomes a credit charge taken off the next month's draft (split when larger). A credit with no later month is applied by hand or settled outside the system.
- **Reductions need the General Manager** (`retainers.approve_reduction`), open-ended fee cuts included; increases, line-only changes and same-total reschedules apply at once. After a retainer's first charge, its fee changes only through amendments.
- **Quotes.** A quote's monthly term creates a term at acceptance; renewing a retainer with a running term starts the new term after it, through a system amendment.

## Consequences
- Supersedes the part of ADR 0015 where the retainer has one fee and a renewal date that is only a reminder: with a term, the renewal date is derived from it.
- Amends ADR 0024: the cycle source becomes the charge source, invoice lines may carry a negative price for a credit, and an invoice of total 0 with a credit line can be issued (and is paid). Still no credit notes or client-wide credit balance: a credit belongs to its retainer.
- The daily `retainers.cycles` job gains ordered steps (terms, amendments, cycles, due charges, renewals); it must stay idempotent.
- F15 splits charge lines by the retainer's accepted quote as it split cycle lines; credits reduce revenue.
