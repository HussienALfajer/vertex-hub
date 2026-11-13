# 0035 — Accounting is built inside the Hub

Status: Accepted · Date: 2026-11-13 (owner)

## Context
V1 deferred full accounting to an off-the-shelf tool (`v1-scope.md` §6). For V2 the owner wants a complete, comprehensive and professional accounting system for Vertex Media (`v2-scope.md`, F18). The Hub already holds every operational financial record: quotes, invoices with exchange rates, payments, project expenses, retainer charges, the ad budget wallet (F12) and employee salaries (F17). Keeping the ledger in a separate system would double those records, add an integration to keep in step, and split the owner's decisions across two products.

## Decision
- **Accounting is a part of the Hub,** built in this repository as its own api module (`accounting`) with its screens in `apps/web`, under the same conventions as every other module (ADR 0013): it reaches other modules only through their exported services, and they reach it the same way.
- **The Hub is both the operational system and the ledger.** Invoices, payments, expenses, the ad budget wallet and payroll stay the source documents; each one, when it changes the books, writes its double-entry journal entry in the same database transaction as the change. No outbox, no external API, no reconciliation between two systems.
- **Money follows ADR 0006:** integer minor units, a currency code and the rate stored on every document and every journal line.
- **What the module covers, the build order and the decisions still open** are settled by the F18 spec (`/spec`), split into several features and PRs.

## Consequences
- F18 does not wait on another product. Its first package can start as soon as its spec is approved.
- Every financial change gains a ledger effect, so posting rules are part of the code of the module that owns the document, tested with it, and a failed posting fails the change.
- The Hub's existing financial history enters the books through opening balances and documents dated from the books' start date, decided in the F18 spec.
- For V2 this replaces the V1 deferral "use an off-the-shelf accounting tool in parallel".
