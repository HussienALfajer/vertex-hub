# 0006 — Money in minor units; SYP and USD with stored rates

Status: Accepted · Date: 2026-09-28

## Context
The agency invoices in the new Syrian pound (after redenomination) and in US dollars. Exchange rates move, and a client may pay an invoice in a different currency than it was issued in. Ad platforms bill in USD.

## Decision
- Amounts are stored as **integer minor units** plus a **currency code**. Floats are never used for money.
- Supported currencies in V1: **SYP** (new Syrian pound) and **USD**. The redenominated pound is stored as `SYP` with 2 decimal places (owner decision, 2026-09-29).
- Each **invoice** has one currency and stores the exchange rate to the reporting currency at issue time.
- Each **payment** stores its own currency and the rate used, so a USD invoice can be paid in SYP.
- **Reporting currency: USD** (more stable), with SYP views available.
- Client **ad budgets** are tracked separately from agency fees, normally in USD.
- Rates are exact decimals; rounding rules are explicit and tested.

## Consequences
- Every money calculation lives in one tested module and is reused.
- Reports convert using stored rates, never today's rate, so historical figures never change.
