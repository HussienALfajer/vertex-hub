# 0035 — Accounting in Vertex Mizan, a separate product integrated with the Hub through an API

Status: Accepted · Date: 2026-10-20 (revised the same day: the product decisions of Vertex Mizan moved to its own repository, owner)

## Context
V1 deferred full accounting to an off-the-shelf tool (`v1-scope.md` §6). For V2 the owner wants a complete, comprehensive and professional accounting system (`v2-scope.md`, F18), and plans to sell it, like Vertex Food and Vertex Shifa. Three options were weighed:

- accounting inside the Hub;
- an extractable accounting core inside the Hub, separated later;
- a separate product built in parallel with the Hub's V2.

The owner chose the third (2026-10-20).

## Decision
- **Accounting is not built inside the Hub.** It is built as **Vertex Mizan**, a separate product in its own repository, `vertex-mizan`. Its product decisions (phases, layers, tenants, other connected products) are recorded there, not here.
- **Roles:** the Hub stays the operational system (invoices, payments, expenses, payroll), and Mizan is the ledger.
- **The integration, on the Hub's side:**
  - **Delivery:** the Hub writes each financial event to an outbox in the change's transaction (the pattern of the email outbox, ADR 0028). The worker posts it to Mizan's versioned API with an idempotency key taken from the Hub event, so a resend never posts twice.
  - **If Mizan is down,** the Hub keeps working and the worker retries. Postings arrive seconds late, which is accepted.
  - **Closed periods:** the Hub refuses changes dated inside a period closed in Mizan.
  - **Checks and dimensions:** a daily reconciliation report shows any event that did not arrive, and the Hub sends the dimensions (client, project, department, service) with each event, so profitability comes from Mizan.
- **Feature split:**

  | Feature | Lives in |
  |---|---|
  | Chart of accounts, journals, trial balance, financial statements | Mizan |
  | Cash boxes, person wallets, transfers, currency exchange | Mizan (the Hub picks the box when recording a payment) |
  | General and recurring expenses, suppliers and payables | Mizan |
  | Exchange gains and losses, period close, cash forecast | Mizan |
  | Purchases for clients (pass-through and resale) | Hub on the project and invoice; Mizan posts them to their own accounts |
  | Profitability by client, project, department, service | Mizan's dimensions, shown in Hub screens through the API |
  | Employee custody and advances | Mizan accounts; Hub HR screens |
  | Payroll, commissions, partner shares | Hub computes, Mizan posts; net profit comes from Mizan |

## Consequences
- The Hub's F18 starts once Mizan's posting API, chart of accounts and cash boxes are stable. Until then the Hub's V1 finance (ADR 0024) stays as it is.
- Two tracks double the owner's decisions. Hub and Mizan sessions alternate, and two large specs are not opened in the same week.
- Events the Hub sends follow ADR 0006 (minor units, a currency code and a stored rate). Mizan's money rules must be compatible.
- How the Hub's existing financial history reaches Mizan is open (Q17).
- For V2 this replaces the V1 deferral "use an off-the-shelf accounting tool in parallel".
