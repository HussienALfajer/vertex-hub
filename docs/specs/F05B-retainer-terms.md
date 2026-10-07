# F05B — Retainer terms, billing schedule and amendments

Status: Approved · Date: 2026-10-07 · Scope: `docs/product/v1-scope.md` §F05 (retainer terms, added 2026-10-07), with changes to §F04 (A01), §F13 (A02) and §F15 · ADRs: 0006, 0015, 0023, 0024, 0029 (new)

## Summary
Retainers today are open-ended: one monthly fee, a renewal date that is only a reminder, and no record of a fixed agreement ("3 months for 1,000 USD, paid 300 / 300 / 400"). When the agreed amount changes after a month is invoiced or paid, nothing links the change to the invoices, and an extra line a client asks for mid-contract has no price. F05B adds optional **terms** to a retainer (a number of months, the agreed total and a per-month **billing schedule**, with automatic renewal, ending or open-ended continuation at the end), turns every billable amount of a retainer into a **charge** that invoices bill, and records every later change as a numbered **amendment** (one month or onward, deliverable lines and money) that never rewrites an issued invoice: increases on an invoiced month draft a supplementary invoice, decreases become a credit taken off the next month's invoice, and reductions wait for the General Manager.

## In scope / out of scope
- In:
  - Terms: optional, one active and at most one scheduled per retainer; months (1–36), agreed total, per-month schedule (even split by default, editable, sum equals the total), end action `renew` (default), `end` or `continue`.
  - Automatic renewal: the next term is created 30 days before the current one ends with the same schedule (amendments made onward included), editable until it starts; automatic ending; open-ended continuation at the monthly fee.
  - Charges: the month's amount (from the term's schedule, or the monthly fee for open-ended months), additions, credits and an early termination fee; each charge is an invoice source.
  - Monthly invoice drafts from charges (replaces drafting from cycles, F13 rule 4), with pending credits taken off the next month's draft.
  - Amendments: scope this month only or onward from a month; deliverable line changes (add, raise, lower, remove) and an amount change per month; reschedule (redistribute unbilled months, same total); approval by the General Manager for any reduction of agreed amounts, open-ended fees included.
  - Effects on invoices: amounts not yet invoiced change; a draft is synced; an issued month (any payment state) gets a supplementary draft for an increase or a credit for a decrease.
  - Early ending: unbilled future months cancelled, optional termination fee drafted.
  - Quote acceptance (F04 A5, A7): a quote with a monthly term creates the term with its schedule; renewing a retainer with a term starts the new term after the current one.
  - Screens: the term section in the new retainer form, a **Contract** tab on the retainer page (terms, schedule, amendments), the amendment dialog, approvals, the end dialog, the Billing tab and invoice editor with charges, the accept dialog's term block.
- Out (later or never):
  - Credit notes as numbered documents, refunds and a client credit balance outside one retainer (ADR 0024 stays: no credit balance; a credit lives on its retainer).
  - Prorating a partial month (F05 R4, F13: full months, billed in advance).
  - Moving term months when a retainer is paused (owner decision: terms stay on the calendar; an amendment reduces a paused month when agreed).
  - Different deliverable quantities per month of a term without an amendment.
  - Invoicing future months in advance from the picker (a client paying the whole term up front is a schedule such as 1,000 / 0 / 0).
  - Amendments in a past month (effective month is the current month or later).

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
- New `retainers.approve_reduction` (scopes `all`): General Manager (through `everything`). Like `quotes.approve_discount`.
- No other change. **Money access** is F05's: `invoices.read` covering the client.

| Action | Permission | Roles and scope |
|---|---|---|
| See terms, schedule, charges and amendments (amounts only with money access) | `projects.read` | Every active user: all; amounts: General Manager, Finance, Operations manager, the client's account manager |
| Create, edit or cancel a term; change its end action; reschedule; create and withdraw amendments | `projects.manage` (client scope) + money access | General Manager, Operations manager · the client's account manager |
| Approve or reject an amendment awaiting approval | `retainers.approve_reduction` | General Manager |
| End a retainer with a termination fee | `projects.manage` (client scope) + money access | as above |
| Settle a pending credit outside the system | `invoices.manage` | General Manager, Finance, Operations manager |
| Bill charges on invoices, issue, void | F13 unchanged | F13 unchanged |

## Data

Module ownership: the `projects` module owns `retainer_terms`, `retainer_charges`, `retainer_amendments` and `retainer_amendment_lines`; `invoices` keeps the invoice tables and reads charges through `EngagementDirectory` / `BillingSources` (charges replace cycles as a billing source). Dates without a time are calendar days in Asia/Damascus; a "month" is a `date` holding the first day of a calendar month. Amounts are integer minor units in the retainer's currency (ADR 0006).

### `retainer_terms` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required, indexed |
| `number` | integer | required; 1, 2, 3… per retainer; unique with `retainer_id` |
| `start_month` | date | required, first of a month |
| `months` | integer | required, 1–36 |
| `end_month` | date | required, `start_month` + `months` − 1 (stored for queries; set by the service) |
| `agreed_total_minor` | bigint | required, ≥ 0; frozen when the term is created (and while it is `scheduled`, on edit); money field |
| `end_action` | enum `term_end_action` (`renew`, `end`, `continue`) | required, default `renew` |
| `status` | enum `term_status` (`scheduled`, `active`, `completed`, `cancelled`) | required |
| `quote_id` | uuid → `quotes.id` | optional; the accepted quote that created it (arrives with PR 4, its first use) |
| `renewed_from_id` | uuid → `retainer_terms.id` | optional; the term it renews automatically |
| `cancelled_at`, `cancel_reason` | timestamptz, text | set when cancelled |
| timestamps | | terms are never archived; they go with their retainer |

Terms of a retainer never overlap (checked by the service under the retainer lock). At most one `active` and one `scheduled` term per retainer (partial unique indexes).

### `retainer_charges` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required, indexed |
| `month` | date | required; the month the charge belongs to |
| `kind` | enum `retainer_charge_kind` (`monthly`, `addition`, `credit`, `termination_fee`) | required |
| `term_id` | uuid → `retainer_terms.id` | set for `monthly` charges of a term; null for open-ended months |
| `amendment_id` | uuid → `retainer_amendments.id` | set for `addition` and `credit` |
| `amount_minor` | bigint | required; `credit` < 0, every other kind ≥ 0; money field |
| `base_amount_minor` | bigint | `monthly` of a term only: the schedule amount plus onward amendments, without one-month ones (what a renewal copies, rule T7) |
| `status` | enum `retainer_charge_status` (`pending`, `cancelled`, `settled_outside`) | required, default `pending`. Invoicing is read from invoice lines (`holds_source`), as for other sources |
| `due_at` | timestamptz | set once when the charge became due and its due hooks ran (rule C3) |
| `settle_note` | text | ≤ 300 chars; required for `settled_outside` |
| `split_from_id` | uuid → `retainer_charges.id` | a credit's remainder (rule C5) |
| timestamps | | |

Unique `(retainer_id, month)` among `monthly` charges that are not `cancelled`. Indexes on `(retainer_id, month)`, `term_id`, `amendment_id`, `status`.

### `retainer_amendments` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required, indexed |
| `number` | integer | required, 1, 2, 3… per retainer, unique with `retainer_id` |
| `kind` | enum `amendment_kind` (`change`, `reschedule`, `quote_renewal`) | required |
| `scope` | enum `amendment_scope` (`month`, `onward`) | required for `change`; `onward` for `quote_renewal`; null for `reschedule` |
| `effective_month` | date | required; ≥ the current month when created |
| `amount_delta_minor` | bigint | `change`: the change to each affected month (one month for `month`, every month from `effective_month` for `onward`); 0 when only lines change; money field |
| `schedule` | jsonb | `reschedule` only: `{ month, amountMinor }[]`, the new amounts; money field |
| `money_delta_minor` | bigint | Σ of the change over the months it affects when created (rule A4); money field |
| `reason` | text | required, 1–500 chars |
| `status` | enum `amendment_status` (`pending_approval`, `scheduled`, `applied`, `rejected`, `withdrawn`, `cancelled`) | required |
| `created_by_id` | uuid → `users.id` | null for `quote_renewal` (system) |
| `decided_by_id`, `decided_at`, `decision_note` | uuid, timestamptz, text | approval or rejection; note ≤ 500 chars, required for rejection |
| `applied_at` | timestamptz | set when applied |
| `effects` | jsonb | set when applied: per month what happened (`charge_changed`, `draft_synced`, `addition`, `credit`, `fee_changed`, `no_cycle`) with amounts, for the page and the audit |
| `quote_id` | uuid → `quotes.id` | `quote_renewal` only |
| timestamps | | amendments are never archived or edited; a wrong one is corrected by another |

### `retainer_amendment_lines`
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `amendment_id` | uuid → `retainer_amendments.id` | required, indexed |
| `kind`, `label` | as `retainer_deliverables` | required kind; label required for `other` |
| `quantity_delta` | integer | `change`: non-zero, −999…999 |
| `quantity` | integer | `quote_renewal`: the line's new monthly quantity (the quote replaces the lines) |
| `revision_limit` | integer | optional, 0–20, for a new line |
| `position` | integer | |

At most 20 lines per amendment; `(kind, lower(label))` unique per amendment.

### Changes to existing tables
- `retainers`: `renewal_date` is set by the service for a retainer with an active or scheduled term (the day after the last term's end) and is read-only there; `monthly_fee_minor` is the open-ended rate (months without a term).
- `retainer_cycle_lines`: `amendment_id` (optional) — the amendment that added or last changed the line in this cycle.
- `invoice_lines`: `retainer_charge_id` (→ `retainer_charges.id`, indexed, partial unique where `holds_source`) replaces `retainer_cycle_id`; the source check counts it; `unit_price_minor` may be negative only when `retainer_charge_id` is set (credit lines). `invoices.total_minor` ≥ 0 stays.
- Enums: `invoice_origin` keeps `cycle_opened` for a retainer month's draft (settled in PR 1: Postgres cannot use an enum value added in the same transaction, and the migrator runs every pending migration in one, so a rename with a data update is not possible; the label stays "شهرية") and adds `retainer_amendment`, `retainer_termination`; `INVOICE_SOURCE_TYPES` replaces `retainer_cycle` with `retainer_charge`.
- Migration (expand, then contract; owner decision 2026-10-07, because the dev and test databases are shared with another checkout that still runs the old code): for every cycle, one `monthly` charge (open-ended) with the amount of the live invoice line that bills it, else its latest line, else the retainer's fee, `due_at` = the cycle's creation; every invoice line of a cycle points to that charge; cycles with no line and no fee get none. `retainer_cycle_id` stays, unused by F05B code, and is dropped in a later migration once no running checkout uses it.
- Charge columns arrive with the PR that first uses them: PR 1 has `id`, `retainer_id`, `month`, `kind`, `amount_minor`, `status`, `due_at` and timestamps; `term_id` and `base_amount_minor` come with terms, `amendment_id`, `settle_note` and `split_from_id` with amendments.

## States and rules

### Term status
```
scheduled ──start month begins (job)──→ active ──last month ends (job)──→ completed
scheduled ──cancel (manager) / retainer ends──→ cancelled
active ──retainer ends early──→ cancelled (months after the end month)
```

### Amendment status
```
(created) ──money_delta ≥ 0, or creator holds approve_reduction──→ applied | scheduled
(created) ──money_delta < 0──→ pending_approval ──approve──→ applied | scheduled
                                                 ──reject (note)──→ rejected
                                                 ──withdraw──→ withdrawn
scheduled ──effective month begins (job)──→ applied
pending_approval | scheduled ──retainer ends, or its month leaves the term──→ cancelled
```
`applied` when its effective month is the current month or earlier, otherwise `scheduled`.

### Terms
- T1. A term is optional. A retainer without one bills open-ended months at `monthly_fee_minor`, as before F05B.
- T2. A term is created on a non-archived, `active` or `paused` retainer of a non-archived client. `start_month` ≥ the current month, ≥ the month of the retainer's `start_date`, and after the end of any other non-cancelled term (`TERM_OVERLAP`). A start date change on `PATCH /api/retainers/:id` that would put the start date's month after the start of an active or scheduled term is refused (`INVALID_DATES`, settled in PR 2). A partial first month counts as a whole month of the term (F05 R4).
- T3. The schedule has one amount per month, each ≥ 0, summing to the agreed total (`SCHEDULE_TOTAL_MISMATCH`). The default is an even split with the remainder on the last month (`splitEvenly(total, months)` in `packages/contracts`; 1,000.00 over 3 months is 333.33 / 333.33 / 333.34). A month of 0 is allowed (a term paid up front: 1,000 / 0 / 0).
- T4. Creating a term creates its `monthly` charges at once (that is the schedule; `base_amount_minor` = the amount). When the start month is the current month and an open-ended `monthly` charge exists for it: if no live invoice bills it, it is cancelled and replaced; otherwise the term is refused (`MONTH_ALREADY_CHARGED`; start next month). Charges of months already begun become due at once (rule C3).
- T5. A `scheduled` term can be edited (start month, months, agreed total, schedule, end action) or cancelled with a reason; its charges are rebuilt or cancelled. An `active` term changes only its end action, and its amounts only through amendments (rules A1–A9).
- T6. The **current total** of a term is Σ of its months' `monthly`, `addition` and `credit` charges that are not cancelled; the page shows "agreed 1,000 · current 1,150 (amendments +150)".
- T7. **Renew.** On the first job run on or after 30 days before the end of an `active` term with end action `renew`, when the retainer has no scheduled term, the job creates the next term: `scheduled`, the same number of months from the next month, each month's amount = the ending term's month at the same position's `base_amount_minor`, agreed total = their sum, end action `renew`, `renewed_from_id` set; it notifies the account manager (`retainer_term_renewed`). The scheduled term can be edited or cancelled until it starts (T5). A renewal a manager cancelled is not created again for the same term (settled in PR 2); one cancelled by leaving `renew` (T10) is created again when the end action returns to `renew`.
- T8. **End.** When a term with end action `end` completes, the same job run ends the retainer (F05 status `ended`, `ended_on` = the term's last day, closing its cycle as F05 R5), with a null actor.
- T9. **Continue.** After a term with end action `continue` completes, the retainer is open-ended: each month's charge is created when its cycle opens, at `monthly_fee_minor` (none while it is null or 0; F05 M4 shows "fee missing").
- T10. Changing an active term's end action away from `renew` cancels its scheduled renewal term (which has no invoice yet: drafts start only in its first month). Changing it to `renew` within the last 30 days creates the renewal on the next job run.
- T11. `renewal_date` of a retainer with a term = the day after the end of its last non-cancelled term; F05 R6's badges and F14's `retainer_renewal_due` use it; the reminder's payload gains `endAction`.
- T12. Pausing never changes a term (owner decision: months stay on the calendar). A paused month's charge is due and drafted like any other; to waive it, an amendment reduces it (A4).

### Charges and invoices
- C1. Every billable amount of a retainer is a charge; invoices bill charges (one line per charge, quantity 1, price = amount). A charge is on at most one live invoice (partial unique index), as milestones and extra work are (ADR 0024).
- C2. Open-ended months: opening the month's cycle (F05 R2, R3) creates the month's `monthly` charge at `monthly_fee_minor` when the fee is > 0; setting the fee while the current month's open cycle has no charge creates it then, due at once (settled in PR 1: F13 let such a month be billed from the picker). A retainer with a term gets no open-ended charge for a term month.
- C3. **Due.** A charge is due from the first day of its month (`monthly`), or at once (`addition`, `termination_fee`). The daily `retainers.cycles` job, and any transaction that creates a charge that is already due, sets `due_at` once and runs the new `RetainerChargeDueHooks` (the `CycleOpenedHooks` pattern) in the same transaction. Due charges of `ended` or archived retainers (and of archived clients) are skipped; a paused retainer's term charges are not (T12).
- C4. **Drafts** (`invoices` registers into `RetainerChargeDueHooks`; replaces F13 rule 4): a due `monthly` charge with an amount > 0 drafts an invoice (origin `retainer_month`) with the line "<retainer> — <month and year>", and for a term month " (n of N)"; an `addition` drafts a supplementary invoice (origin `retainer_amendment`, line "<retainer> — amendment <number> — <month>"); a `termination_fee` drafts origin `retainer_termination`. Drafts follow F13 rules 5–8 (settings' terms, never issued automatically, a discarded automatic draft is not recreated).
- C5. **Credits** are taken off the next month: a `retainer_month` draft adds the retainer's pending `credit` charges not on a live invoice, oldest first, while the draft's total stays ≥ 0; a credit larger than what is left is split (the applied part stays on the charge; the remainder becomes a new pending `credit` with `split_from_id`). A credit is never added to a supplementary or termination draft automatically; managers may add it from the picker.
- C6. **Amount changes on a monthly charge** (amendments, reschedule): a charge no live invoice bills changes its amount; a charge on a **draft** changes its amount and the draft line's price and total are updated in the same transaction (an audit `invoice.updated` entry with the amendment's actor), overwriting a hand-edited price, and credits from other months that the lower total cannot hold go back to pending, newest line first (settled in PR 3); a charge on an **issued** non-void invoice, in any payment state, keeps its amount, and the difference becomes an `addition` (increase) or a `credit` (decrease) charge of the same month (rule C4, C5). An issued invoice is never changed (F13 rule 12). A due `monthly` charge that never had an automatic draft (its amount was 0) and that no invoice bills drafts at once when its amount becomes > 0 (C4).
- C7. **Picker** (F13 rule 6): billable retainer items are the client's due, `pending` charges in the invoice's currency that no live invoice bills, `credit` charges included, grouped by retainer and month. A line may have a negative price only for a credit charge; an invoice whose total would be < 0 is refused (`INVOICE_NEGATIVE`). F13 rule 9 changes: an invoice may be issued with total 0 when it has a credit line; it is `paid` at issue (`invoiceStatus` with 0 = 0).
- C8. Voiding or discarding an invoice releases its charges (F13 rules 8, 14): monthly and addition charges become billable from the picker, credits pending again.
- C9. A pending credit with no later month to take it (the retainer ended, or its last month is invoiced) stays on the retainer's Billing tab as "credit owed to the client". An invoice manager adds it to a manual invoice of that retainer, or marks it `settled_outside` with a note (refunded or settled outside the system; ADR 0024).
- C10. Charges are never deleted. A charge whose month is cancelled (early end, cancelled term) becomes `cancelled` only when no live invoice bills it.

### Amendments
- A1. `change` amendments: scope `month` (one month) or `onward` (from the effective month to the end of the active term, and the scheduled term's months; on an open-ended retainer, the fee from that month). The effective month is ≥ the current month; on a retainer with a term it lies within the active or scheduled term for `month`, and within them or after them for an open-ended continuation (`INVALID_EFFECTIVE_MONTH`). At least one line change or a non-zero amount delta (`EMPTY_AMENDMENT`). Settled in PR 3: months before the first active or scheduled term, and months after a last term ending with `continue`, are open-ended; an `onward` change starting in a term changes term months only, and the fee only when its effective month is open-ended; the effective month is never before the month of the retainer's start date; a `month` amount on a month without its charge is refused unless an active, started retainer charges it this month (C2: a paused month takes no amount) (`INVALID_EFFECTIVE_MONTH`).
- A2. **Lines.** Each line names a kind and label and a quantity delta. A line not on the retainer needs a delta > 0. `month`: the effective month's cycle gets the change (a new cycle line with committed = delta, or committed changed; never below 0). `onward`: the standing deliverable line is added, changed or archived (resulting quantity 0), from the effective month, and the effective month's open cycle gets the same change. A `month` change for a month whose cycle has not opened is taken by the cycle when it opens (settled in PR 3); a closed cycle refuses it (`CYCLE_CLOSED`). A change that would make a quantity negative or exceed 999 is refused (`INVALID_QUANTITY`). F05's limits (20 standing lines, 30 cycle lines) apply (`LIMIT_REACHED`).
- A3. **Money.** `amount_delta_minor` applies to each affected month through rule C6. No month's total (Σ of its non-cancelled charges) may go below 0 (`NEGATIVE_AMOUNT`). On an open-ended retainer an `onward` delta changes `monthly_fee_minor` from the effective month (the current month's charge through C6 when it is the effective month). Onward amounts are added to `base_amount_minor` of the term months they change, so renewals keep them (T7); `month` amounts are not.
- A4. **Approval** (owner decision). `money_delta_minor` = Σ of the change over the months it affects (for an open-ended `onward` change, the delta itself). When it is < 0 and the creator does not hold `retainers.approve_reduction`, the amendment is `pending_approval`: nothing changes, the General Managers are notified (`retainer_amendment_pending`). Approving re-checks rules A1–A3 against the current state and applies it (`AMENDMENT_INVALID` with the failed rule when the state moved on; the approver rejects it instead). Rejecting needs a note. The creator or any manager of the retainer may withdraw it while pending. The creator is notified of the decision (`retainer_amendment_decided`). Increases, line-only changes and reschedules never need approval.
- A5. **When it applies.** An amendment is applied at once when its effective month is the current month or earlier, otherwise `scheduled`; the job applies scheduled amendments on the first run of their month, before that month's charges become due and its cycle opens (so the month's draft and cycle already include them), in number order. One the state no longer allows is `cancelled` with the failed rule, without holding back the retainer's other steps (settled in PR 3).
- A6. **Reschedule** (`reschedule`): new amounts for the months of the active or a scheduled term that no issued invoice bills (drafts are synced, C6), with the same sum (`SCHEDULE_TOTAL_MISMATCH`), each ≥ 0; applied at once, no approval (owner decision); `base_amount_minor` follows.
- A7. Amendments are numbered per retainer and never edited; a wrong one is corrected by another. At most 300 per retainer (`LIMIT_REACHED`).
- A8. Amendments are allowed on `active` and `paused` retainers (`RETAINER_ENDED`, `RETAINER_ARCHIVED`). Ending a retainer cancels its pending and scheduled amendments and those whose month was cancelled.
- A9. A retainer's `monthly_fee_minor` may be set or changed with `PATCH /api/retainers/:id` only while the retainer has no charge; afterwards a fee change is an `onward` amendment (`FEE_CHANGE_NEEDS_AMENDMENT`), so decreases follow A4.

### Ending early
- E1. Ending a retainer (F05) with an active or scheduled term: the current month stays (billed in advance, F13); `monthly` charges of later months that no live invoice bills are cancelled; the scheduled term is cancelled and the active one becomes `cancelled` with `end_month` unchanged for history; pending credits stay (C9).
- E2. The end dialog takes an optional termination fee (> 0) with a reason (1–500 chars, required with a fee): a `termination_fee` charge of the current month, due at once (C4).
- E3. Reactivating an ended retainer (F05) restores no term; a new term is added like any other.

### Quotes (F04 changes)
- Q1. Accepting a quote whose monthly section has `monthly_term_months`: the accept dialog's monthly step shows a term block — months (default the quote's term), agreed total (default monthly net × months), the schedule (even split, editable), end action (default `renew`). A new retainer gets the term from the month of its start date; its fee is still the monthly net (the rate after a `continue`).
- Q2. **Renew** (A7) on a retainer with an active term: the new term starts the month after the active term's end, replacing a scheduled renewal term (owner decision); the quote's lines and fee become a `quote_renewal` amendment effective in that month (applied by the job, no approval: the quote's own discount approval covers it). On an open-ended retainer, a quote with a term starts the term next month; the lines and fee change next month through the same amendment (as A7 today). A quote without a term renewing a retainer with an active term: the active term's end action becomes `continue`, and the amendment takes effect the month after it ends.
- Q3. Upgrading inside a running term is an amendment, not a quote renewal.

### General
- G1. Every change writes an audit entry in the same transaction; the job writes entries with a null actor.
- G2. All changes to a retainer's terms, charges and amendments take the retainer row lock, as the cycle job does.
- G3. Money fields are omitted for callers without money access (F05 M1); they see the term's months, end action and the amendments' lines and statuses without amounts.

## API

Schemas live in `packages/contracts/src/retainers.ts` (terms, amendments, charges, `splitEvenly`, the approval and month functions) and `invoices.ts` (source type, origins). Lists follow ADR 0013. A record outside read access is a 404.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/retainers/:id/terms` | `projects.read` | — | `{ items: retainerTermSchema[] }` newest first: number, months, start and end month, status, end action, renewed from, `money { agreedTotalMinor, currentTotalMinor }`, `schedule[]` (`month`, position, `chargeId`, charge status, `due`, `money { amountMinor, baseAmountMinor, totalMinor }`). The invoice of a month is read from the retainer's billing (`RetainerCharge`, by `chargeId`, money access) | 404 |
| `POST /api/retainers/:id/terms` | `projects.manage` (client) + money | `createRetainerTermSchema`: startMonth, months, agreedTotalMinor, schedule[] (amountMinor per month), endAction | `retainerTermSchema` | 403, 404, `RETAINER_ENDED`, `RETAINER_ARCHIVED`, `CLIENT_ARCHIVED`, `TERM_OVERLAP`, `INVALID_DATES`, `SCHEDULE_TOTAL_MISMATCH`, `MONTH_ALREADY_CHARGED` |
| `PATCH /api/retainers/:id/terms/:termId` | `projects.manage` (client) + money | `updateRetainerTermSchema`: scheduled: all fields; active: endAction only | `retainerTermSchema` | 403, 404, `TERM_STARTED`, `TERM_OVERLAP`, `SCHEDULE_TOTAL_MISMATCH`, `RETAINER_ENDED` |
| `POST /api/retainers/:id/terms/:termId/cancel` | `projects.manage` (client) + money | `{ reason }` | `retainerTermSchema` | 403, 404, `TERM_STARTED` |
| `POST /api/retainers/:id/terms/:termId/reschedule` | `projects.manage` (client) + money | `{ schedule: { month, amountMinor }[], reason }` | `amendmentSchema` | 403, 404, `SCHEDULE_TOTAL_MISMATCH`, `MONTH_INVOICED` (a month on an issued invoice), `RETAINER_ENDED` |
| `GET /api/retainers/:id/amendments` | `projects.read` | page, `status[]` | `amendmentPageSchema`: number, kind, scope, effective month, lines, status, creator, decision, effects; amounts in `money` | 404 |
| `POST /api/retainers/:id/amendments` | `projects.manage` (client) + money | `createAmendmentSchema`: scope, effectiveMonth, lines[] (kind, label, quantityDelta, revisionLimit), amountDeltaMinor, reason | `amendmentSchema` (with `effects` when applied, or `preview` of them when pending) | 403, 404, `INVALID_EFFECTIVE_MONTH`, `EMPTY_AMENDMENT`, `INVALID_QUANTITY`, `NEGATIVE_AMOUNT`, `DUPLICATE_DELIVERABLE`, `LIMIT_REACHED`, `RETAINER_ENDED`, `RETAINER_ARCHIVED` |
| `POST /api/retainers/:id/amendments/preview` | same | same body | `{ months: { month, before, after, effect }[], needsApproval }` (nothing saved) | same |
| `POST /api/retainers/:id/amendments/:amendmentId/approve` · `/reject` | `retainers.approve_reduction` | `{ note }` (required to reject) | `amendmentSchema` | 403, 404, `INVALID_TRANSITION`, `AMENDMENT_INVALID` |
| `POST /api/retainers/:id/amendments/:amendmentId/withdraw` | `projects.manage` (client) | — | `amendmentSchema` | 403, 404, `INVALID_TRANSITION` |
| `GET /api/retainer-amendments` | `retainers.approve_reduction` | `{ status: 'pending_approval' }`, page | amendments with retainer and client | — |
| `GET /api/retainers/:id/charges` | money access | `status[]`, `kind[]`, page | `retainerChargePageSchema`: month, kind, amount, term, amendment number, status, invoice (number, status) | 404, 403 |
| `POST /api/retainers/:id/charges/:chargeId/settle` | `invoices.manage` | `{ note }` | `retainerChargeSchema` | 403, 404, `INVALID_TRANSITION` (not a pending credit, or on a live invoice) |

Changes to existing endpoints:
- `POST /api/retainers` (F05): optional `term { months, agreedTotalMinor, schedule, endAction }`, starting in the start date's month.
- `PATCH /api/retainers/:id`: `monthlyFeeMinor` refused with `FEE_CHANGE_NEEDS_AMENDMENT` once the retainer has a charge (A9); `renewalDate` refused with `RENEWAL_DATE_FROM_TERM` while it has a term (T11).
- `POST /api/retainers/:id/status` with `ended`: optional `termination { feeMinor, reason }` (money access).
- `GET /api/retainers/:id` and the list: `term` summary (the active term, else the scheduled one: number, status, start and end month, months, end action; `money { agreedTotalMinor, currentTotalMinor }` on the detail only, with money access), `pendingAmendments` count, `money.creditPendingMinor`; the list gains a `pendingApproval` filter. `RetainerCharge` carries `term { number, position, months }` for a term month.
- `GET /api/retainers/:id/billing` (F13): months with their charges and invoices, pending credits.
- F13: `GET /api/invoices/billable` returns `charges` instead of `cycles`; `invoiceDraftSchema` line sources accept `{ type: 'retainer_charge', id }`; `INVOICE_NEGATIVE`; issue accepts total 0 with a credit line.
- F04: `acceptPlanSchema` and `acceptQuoteSchema` retainer part gain `term { months, agreedTotalMinor, schedule, endAction }` (Q1, Q2).

## Screens

All Arabic RTL through i18next (`retainers.terms.*`, `retainers.amendments.*`), money in its currency, months as "تشرين الثاني 2026", loading, empty and error states. Amounts and money actions appear only with money access; others see months, end actions and amendment lines.

1. **New retainer** (F05) — an optional "Fixed term" section: months, agreed total, schedule editor (one row per month with its amount, "Split evenly", the running difference from the total, which must reach 0 to save), end action (renew / end / continue at the monthly fee).
2. **Retainer page header** — a term chip: "Term 2 · Nov 2026 – Jan 2027 · renews automatically" (or "ends", "continues monthly"); a "pending approval" badge when amendments wait.
3. **Contract tab** (new, `?tab=contract`):
   - Current and scheduled term cards: months, agreed and current totals, end action (changeable), the schedule table (month, base amount, amendments, total, state: "not due", "draft", "INV-2026-0012 sent / paid", "cancelled"), actions "Reschedule", "Edit" / "Cancel" (scheduled term), "Add term" when none is scheduled. Empty: "This retainer has no fixed term; it bills <fee> each month" with "Add term".
   - Amendments list: number, date, kind, scope and effective month, lines ("+2 reels", "new: monthly report 1"), amount ("+100 / month from Dec", money access), status badge, creator, decision; GMs see "Approve" / "Reject" on pending ones; managers "Withdraw".
   - "New amendment" dialog: scope (this month only / from a month onward), month picker, lines editor (existing lines with + / −, add a new line), amount change per month, reason; a live preview from `/amendments/preview` per month ("Nov: draft updated 300 → 400", "Oct: INV-… already sent — supplementary invoice of 100", "Oct: paid — credit of 50 on November's invoice") and "Needs the General Manager's approval" when it reduces.
4. **End dialog** (F05) — for a retainer with a term: months that will be cancelled, the optional termination fee and reason.
5. **Billing tab** (F13) — by month: charges with kind, amount and their invoice or "not invoiced"; pending credits with "Settle outside" (invoice managers); "Create invoice" on billable charges.
6. **Invoice editor** (F13) — source chips name the charge ("Nov 2026 (2 of 3)", "Amendment 4", "Credit", "Termination fee"); credit lines show as negative; the picker groups a retainer's months, additions and credits.
7. **Accept dialog** (F04) step 3 — the term block (Q1) and, for Renew on a retainer with a term, "The new term starts in <month>, after the current term" (Q2).
8. **Retainers list** — a "Pending approval" filter for GMs; the term's end month and end action in the renewal column.

## Audit, notifications and jobs
- Audit (entities `retainer_term`, `retainer_charge` and later `retainer_amendment`, whose `after` carries `retainerId` so the log links the retainer page): `retainer_term.created`, `.updated`, `.end_action_changed`, `.cancelled`, `.started`, `.completed`, `.renewed` (null actor); `retainer_charge.created`, `.amount_changed`, `.cancelled`, `.split`, `.settled_outside`; `retainer_amendment.created`, `.approved`, `.rejected`, `.withdrawn`, `.applied` (with `effects`), `.cancelled`; `retainer.updated` for fee changes from amendments. F13's `invoice.created` / `invoice.updated` for drafts and syncs. Amounts are visible to money readers only, as in F05.
- Notifications (F14 catalog, emails per F14's categories):
  | Type | Category | Subject | Mutable | Recipients | Data |
  |---|---|---|---|---|---|
  | `retainer_amendment_pending` | `clients_projects` | `retainer` | no | holders of `retainers.approve_reduction` except the creator | retainer, client, number, `moneyDeltaMinor`, currency, creator |
  | `retainer_amendment_decided` | `clients_projects` | `retainer` | no | the creator | retainer, number, `approved`, note |
  | `retainer_term_renewed` | `reminders` | `retainer` | yes | the client's account manager | retainer, client, term number, start and end month |
  `retainer_renewal_due` gains `endAction`.
- Jobs: no new job. `retainers.cycles` (00:05) runs per retainer, in one transaction under the retainer lock and in this order: start scheduled terms of the current month and complete ended ones; end retainers per T8; apply scheduled amendments of the month (A5); close and open cycles (F05 R2) and create open-ended charges (C2); run due hooks for due charges without `due_at` (C3); create renewal terms (T7). Idempotent: `due_at`, the unique monthly charge, the term and amendment statuses. A development command runs it once as if on a date: `pnpm --filter @vertex-hub/api retainers:run-daily [--date YYYY-MM-DD]` (needs `pnpm build`, like `invoices:run-daily`), documented in `AGENTS.md`.

## Edge cases
1. The job runs twice or late: every step checks its state; a month missed while the worker was down is caught up for the current month only (F05 R2); a term month whose first day passed gets its draft on the next run.
2. Two managers amend the same retainer at once: the retainer lock orders them; the second preview may differ from what it saved, and the saved `effects` are the truth.
3. An amendment is approved after its effective month started: it applies at once (A5) and its month's draft is synced or a supplementary draft or credit follows.
4. An amendment for a month whose invoice was voided between preview and approval: the charge is free again and simply changes (C6).
5. A paused retainer with a term: the month's charge is drafted; a `month` amendment with lines finds no cycle (`no_cycle` effect) but its amount applies.
6. A credit larger than the next month's amount: split (C5); the remainder waits for the following month.
7. The last month's invoice was paid and a reduction is approved: the credit has no later month and stays as "credit owed" until settled (C9).
8. A draft whose price Finance edited by hand is synced by an amendment: the amendment's amount wins and the audit shows both (C6).
9. A term month of 0: no draft when it becomes due. An amendment that later raises it drafts it at once (C6).
10. Renewal created, then the client asks to stop: change the end action to `end` (cancels the scheduled term, T10) or end the retainer.
11. A quote renewal accepted while an amendment is pending: both stay; the pending one is checked again when approved.
12. The currency of a retainer with charges is locked (F05 M2, F13 rule 24).
13. A retainer archived (entered by mistake) keeps its terms and charges hidden with it; the job skips it (F05 G2).
14. Very long terms: 36 months × a few dozen retainers; no special limits.

## Open questions
- None blocks F05B. Owner decisions recorded on 2026-10-07: terms optional; calendar-fixed while paused; end actions renew (default) / end / continue; renewal copies the schedule with onward amendments; early end cancels unbilled months with an optional termination fee; increases on an invoiced month draft a supplementary invoice; decreases become a credit on the next month (void and reissue or settle outside when no month is left); any reduction, open-ended fees included, needs the General Manager; reschedules at the same total need no approval; quotes with a term create it; a quote renewal on a running term starts after it.

## Acceptance
- Owner check in the browser (General Manager G, account manager A of client C, Finance F):
  1. As A, create a retainer for C starting today with a 3-month term of 1,000 USD, schedule 300 / 300 / 400, end action renew, lines designs 12 and reels 4. The Contract tab shows the three months; this month's draft invoice of 300 exists ("1 of 3").
  2. As F, issue this month's invoice and record a payment of 300.
  3. As A, add an amendment "this month only": +2 reels and +100. The cycle shows reels 0/6; a supplementary draft of 100 appears; the term's current total is 1,100.
  4. As A, add an amendment "onward from next month": a new line "monthly report 1" and +50. Next month's amount shows 350 and the line appears in the standing lines.
  5. As A, reduce this month by 80 with a reason: it waits for approval; G gets a notification, approves; a credit of 80 is pending and is on next month's draft when the job runs for the next month's first day (`pnpm --filter @vertex-hub/api retainers:run-daily --date <date>`).
  6. Reschedule the two unbilled months from 350 / 450 to 400 / 400: saved at once, no approval needed.
  7. Run the job for 30 days before the term's end: term 2 is scheduled with 300 / 400 / 400 (the onward +50 and the reschedule kept, the one-month +100 and −80 not) and A is notified.
  8. End the retainer with a termination fee of 200: later months are cancelled and a termination draft of 200 exists.
  9. Sign in as an ordinary employee: the Contract tab shows months and amendments without amounts.
  10. Accept a quote with a 6-month monthly section as Renew on another retainer with a running term: the new term starts after it.
  11. Find every change in the audit log.
- Tests:
  - Unit (`packages/contracts`): `splitEvenly` (remainders, 1 and 36 months, 0 total); schedule and amendment schemas (sum, effective month, empty amendment, quantity deltas); the approval rule (Σ delta, open-ended onward); the month-effect planner used by preview and apply (uninvoiced, draft, issued, paid; credit splitting); `invoiceStatus` with total 0.
  - API (`apps/api/test/retainer-terms.test.ts`, `retainer-amendments.test.ts`, changes to `retainers.test.ts`, `retainer-cycles.test.ts`, `invoices.test.ts`, `quote-accept.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; an employee; Finance on manage endpoints; a non-GM approving); every error code; rules T1–T12, C1–C10, A1–A9, E1–E3, Q1–Q3; the job's order and idempotency (terms start, amendments apply before drafts, renewals once, end action end); drafts and credits in the same transaction; the migration of existing cycles' invoice lines to charges; audit entries.
  - E2E: create a retainer with a term and see the month's draft; add a one-month amendment with an amount and see the supplementary draft; approve a reduction as the General Manager.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): new retainer with the term section, the Contract tab (term card, schedule, amendments), the amendment dialog with its preview and approval notice, the end dialog with a fee, the Billing tab with a pending credit, the invoice editor with a credit line, the accept dialog's term block, the employee view without money.
