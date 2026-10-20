# 0035 — Accounting in Vertex Mizan, a separate product integrated with the Hub through an API

Status: Accepted · Date: 2026-10-20

## Context
V1 deferred full accounting to an off-the-shelf tool (`v1-scope.md` §6). For V2 the owner wants a complete, comprehensive and professional accounting system (`v2-scope.md`, F18), and plans to sell it, like Vertex Food and Vertex Shifa. Three options were weighed:

- accounting inside the Hub;
- an extractable accounting core inside the Hub, separated later;
- a separate product built in parallel with the Hub's V2.

The owner chose the third (2026-10-20). Building in parallel is cheap in engineering, since the work is done by Claude Code, and one accounting engine can serve three products. The risk of building a generic product before knowing the needs is contained by making Vertex Media its first tenant.

## Decision
- **Name: Vertex Mizan (فيرتكس ميزان)**, after the scale and the trial balance (ميزان المراجعة). Domain and trademark availability are checked in Mizan's first session (not confirmed).
- **Its own repository, `vertex-mizan`, public** so CI runs free (owner, 2026-10-20; it can turn private when sales start). It is built with Claude Code, with the working method of the Hub, Vertex Digital, Vertex Food and Vertex Shifa copied and adapted to an accounting product.
- **Claude is the accounting consultant** (owner, 2026-10-20). Syrian legal specifics (tax, social insurance, Ministry of Finance requirements) stay marked "not confirmed" until verified.
- **Four phases.** Only the next phase's features are detailed: each phase is specified, built and used before the next is detailed.
  1. **The ledger core and the posting API:**
     - a chart of accounts and double-entry journals;
     - currencies with stored rates;
     - analytical dimensions (client, project, department, service);
     - the versioned API that receives postings.
     Serves Vertex Media through the Hub.
  2. **The rest of Vertex Media's accounting:** cash boxes and banks, expenses, suppliers and payables, financial statements, period close. Vertex Media is then fully served, and Mizan is ready for Food and Shifa.
  3. **Business modules:** sales and customers, purchases, inventory with serial numbers (IMEI), and installment sales. Mizan is first sold on its own after this phase (e.g. to a phone shop).
  4. **The commercial product:** self sign-up, subscriptions and billing, onboarding, support.
- **Three layers:**
  - the ledger core, always present;
  - business modules, enabled per tenant;
  - the integration layer (API and connectors).

  Each tenant has **one source of truth per document type**: when a connected system issues sales, as Food does, Mizan's sales module is off for that tenant, so nothing is recorded twice.
- **Multi-tenant from day one.** Vertex Media is tenant 1 and the design partner.
- **The Hub integration:**
  - **Roles:** the Hub is the operational system (invoices, payments, expenses, payroll), and Mizan is the ledger.
  - **Delivery:** the Hub writes each financial event to an outbox in the change's transaction (the pattern of the email outbox, ADR 0028). The worker posts it to Mizan's API with an idempotency key taken from the Hub event, so a resend never posts twice.
  - **If Mizan is down,** the Hub keeps working and the worker retries. Postings arrive seconds late, which is accepted.
  - **Closed periods:** the Hub refuses changes dated inside a period closed in Mizan.
  - **Checks and dimensions:** a daily reconciliation report shows any event that did not arrive, and journal lines carry the dimensions, so profitability comes from Mizan.
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

- **Vertex Food and Vertex Shifa:**
  - Mizan is an optional add-on, at a bundle price, never required;
  - both keep their built-in finance;
  - each gets an accounting connector after it is complete: connection settings, mapping of its categories to the chart of accounts, an outbox, respect for closed periods, and a sync status screen;
  - that work is done in each product's own sessions after reading its documents, and nothing changes in them now (owner, 2026-10-20).

## Consequences
- The Hub's F18 starts once Mizan's posting API, chart of accounts and cash boxes are stable. Until then the Hub's V1 finance (ADR 0024) stays as it is.
- Two tracks double the owner's decisions. Hub and Mizan sessions alternate, and two large specs are not opened in the same week.
- Events the Hub sends follow ADR 0006 (minor units, a currency code and a stored rate). Mizan's own money decision must be compatible.
- How the Hub's existing financial history reaches Mizan is open (Q17).
- The code of a commercial product is public until the repository turns private.
- For V2 this replaces the V1 deferral "use an off-the-shelf accounting tool in parallel".
