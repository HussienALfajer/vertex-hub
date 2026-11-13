# 0045 — Ledger foundations: start date, accrual, USD books, control and periods

Status: Accepted · Date: 2026-11-13 (owner)

## Context
ADR 0035 puts accounting inside the Hub and leaves the module's shape to the F18 spec. F18 is split into seven packages (`docs/specs/F18-accounting-overview.md`), each specified in its own session. A few decisions shape every package and every posting rule, so they are fixed once here instead of being reopened per package.

## Decision
- **Books' start date: 2026-10-01.** Opening balances are entered as opening entries on that date; every document dated from then is posted by the automatic posting rules when they ship (F18B's one-time backfill). Earlier history enters only through the opening balances.
- **Accrual basis.** Revenue at invoice issue, expenses when recorded. Retainer revenue is recognized when the cycle's invoice is issued, without deferral. The ad budget wallet is a liability to the client, never revenue; purchases for clients have their own revenue and cost accounts.
- **Functional currency: USD.** SYP is a foreign currency. Every journal line stores its original amount, currency, rate (SYP per 1 USD, for SYP lines) and USD amount; an entry balances in USD. Exchange differences are realized on settlement and SYP balances revalued monthly (later packages).
- **Control.** A new assignable `accountant` role keeps the books; `finance` reads them; the Internal Operations manager does not. A manual entry is posted only by someone other than its author. Posted entries are never edited: corrections are reversing entries or document corrections.
- **Periods.** Calendar fiscal years with monthly periods, closed in order by the accountant or the General Manager and reopened only by the General Manager with a reason. Nothing is created or changed with a date inside a closed period; voids are dated on the day they happen. Closing a year posts a closing entry into retained earnings.
- **Chart and dimensions.** A seeded Arabic chart for a media agency, editable, with system accounts addressed by a stable key. Five optional dimensions on every line (client, engagement, department, service, employee); an account can require some.
- **One posting engine.** The `accounting` module exports the posting service and the period guard; each document's posting rules live in the module that owns the document and run in its transaction (ADR 0035, ADR 0013).
- **Tax and fixed assets** are in scope, in the last package; Syrian rules are verified there.

## Consequences
- Every package spec (F18B to F18G) and F19 builds on these rules; changing one needs the owner and a new ADR.
- F18B must post all documents since 2026-10-01 before any month is closed in production.
- Reports in SYP are views converted from stored rates; the books themselves are kept in USD.
- Accountants see the source documents they post (invoices, campaigns, finance reports), but not salaries until F19 decides it.
