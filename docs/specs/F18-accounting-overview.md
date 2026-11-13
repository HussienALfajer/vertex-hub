# F18 — Accounting inside the Hub: overview

Status: Draft · Date: 2026-11-13 · Scope: `docs/product/v2-scope.md` §F18 · ADRs: 0006, 0007, 0013, 0014, 0035, 0045

## Summary
Vertex Media's finance in the Hub is operational only: invoices, payments, project expenses, retainer charges, the ad budget wallet and salary history, with revenue and overdue reports. There is no chart of accounts, no journal, no periods, no cash boxes, suppliers, credit notes, allocations, tax or exchange differences. F18 builds a complete, professional double-entry accounting system inside the Hub (ADR 0035): the Hub stays the operational system and becomes the ledger, and every financial document writes its journal entry in the same transaction as its change.

F18 is too large for one spec or one feature. This overview fixes the cross-cutting decisions every package must follow, the seven packages F18A to F18G with their order and dependencies, and F19's hook into the books. Only F18A has a detailed spec now: `docs/specs/F18A-ledger-core.md`.

## How F18 is specified and built
1. This overview and F18A were settled with the owner on 2026-11-13.
2. **Each later package (F18B to F18G) gets its own `/spec` session when its turn comes**, which interviews the owner on that package's own questions and writes `docs/specs/F18<X>-<name>.md`. Those questions are deliberately not asked now (owner, 2026-11-13). A package spec may refine this overview; changing one of the cross-cutting decisions below needs the owner and an ADR.
3. Each package is then built by `/feature-slice` in the PRs its spec sets, in the order below.

## Cross-cutting decisions (owner, 2026-11-13; ADR 0045)

### D1 — Books' start date and history
- The books start on **2026-10-01**. The first fiscal year is short: October to December 2026.
- **Opening balances** are entered as opening entries dated 2026-10-01 (F18A): cash, receivables per client, ad budget balances per client, payables, partners' capital, against an "opening balance equity" account.
- **Every document dated from 2026-10-01 is posted again by the automatic posting rules** when F18B ships (a one-time backfill in F18B): invoices, payments, voids, project expenses, ad wallet movements, retainer credits and fees. Documents dated before 2026-10-01 enter only through the opening balances.
- No month is closed in production before F18B's backfill has run (a rollout rule; F18B's spec decides whether the code enforces it).

### D2 — Accrual basis
- The books are on the **accrual basis**: revenue is recognized when an invoice is issued, an expense when it is recorded, never when cash moves.
- **Retainer revenue is recognized when the cycle's invoice is issued** (billed monthly in advance, F05B), with no deferral or daily spreading.
- Cash-basis views (collections, cash flow) are reports in F18F, not a second set of books.
- **The ad budget wallet is a liability to the client, never revenue:** a deposit credits the client's ad budget account, campaign spend debits it. Only the agency's management fee is revenue.
- **Purchases for clients** (the fireworks example) post their cost and their resale price to their own accounts, outside service revenue, so their margin stays outside service profit and every employee share (F18D, F19).

### D3 — Functional currency
- The **functional currency is USD** (ADR 0006's reporting currency). SYP is a foreign currency.
- Every journal line keeps its **original amount and currency**, the **rate** used (SYP per 1 USD, for SYP lines) and its **USD amount**. An entry must balance in USD.
- Realized exchange differences are posted when a document is settled at a rate different from its own (F18B for single payments, F18E for allocations). Unrealized differences on SYP balances are revalued at month end (F18F). Until then, the ledger holds SYP balances at their historical rates.

### D4 — Roles and control
- A new assignable role **`accountant`** keeps the books: the chart of accounts, manual entries, review and posting, and period close.
- **`finance`** keeps invoices, payments and collection, and **reads** the books. The **General Manager** has everything. The **Internal Operations manager** does not see the books (they hold salaries and, later, partner accounts).
- **Maker-checker:** a manual entry is always posted by someone other than its author (another accountant or the General Manager). Automatic entries from documents are posted by the document's own action, whose permissions already control it.
- **Period close** by the accountant or the General Manager; **reopening** a closed month or year by the General Manager only, with a written reason.
- Posted entries are never edited or deleted: a mistake is corrected by a reversing entry (or, for a document's entry, by voiding or correcting the document).

### D5 — Chart of accounts
- A **seeded Arabic chart for a media agency**, coded on four levels (F18A lists it), editable by the accountant: add, rename, move and archive accounts.
- **System accounts** (the ones automatic posting uses: receivables, ad budget deposits, cash, retained earnings, exchange differences…) carry a fixed system key, so posting code never depends on a code or a name the accountant can change; they cannot be archived or change type.
- Accounts for later packages (fixed assets, depreciation, taxes, partners) exist from the start, so they can be used by manual entries until their package automates them.

### D6 — Dimensions on journal lines
- Every journal line can carry five dimensions: **client**, **engagement** (a project or a retainer), **department**, **service** (a catalog service) and **employee**.
- Dimensions are optional on a line; an **account can require** some of them (receivables require a client; employee advances require an employee).
- Automatic posting (F18B onward) fills them from the source document; profitability reports (F18F) read them. The gaps found in the Hub (lines without a service, expenses without a department; `v2-scope.md` F18) are closed by the package that posts that document.
- Suppliers and partners are parties of their own packages (F18D, F18G), not line dimensions.

### D7 — Periods and documents in closed periods
- The **fiscal year is the calendar year** with twelve monthly periods (the first year: October to December 2026). The year is closed with an automatic closing entry into retained earnings (F18A).
- **No entry and no document may be created or changed with a date inside a closed period** (`PERIOD_CLOSED`). Voiding an old document stays possible: the void, and the reversal it posts, are dated on the day they happen, in an open period. F18A provides the guard; each package applies it to the documents it posts.

### D8 — Posting engine and module boundaries
- One `accounting` api module (ADR 0035) owns the chart, periods, entries and lines, and exports a **posting service** that builds, checks and posts an entry inside the caller's transaction. The posting rules of a document live in the module that owns the document and call this service; `accounting` never imports those modules (ADR 0013).
- An automatic entry records its **source** (document type and id), so the ledger links back to the document and a document has at most one live entry per event.
- A failed posting fails the document's change (ADR 0035).

### D9 — Tax and fixed assets
In scope, in the last package (F18G). Syrian income and payroll tax rules are verified in that package's spec, not assumed now.

## Packages, order and dependencies

| Order | Package | Depends on |
|---|---|---|
| 1 | F18A Ledger core | — |
| 2 | F18B Automatic posting from existing documents | F18A |
| 3 | F18C Cash and banks | F18B |
| 4 | F18D Purchases, suppliers and expenses | F18C |
| 5 | F18E Advanced receivables | F18B, F18C |
| 6 | F18F Reports | F18B (statements); profitability and cash forecast are richest after F18D and F18E |
| 7 | F18G Partners, tax and fixed assets | F18F |

F19 (payroll, commissions and profit shares) can start after F18B and F18C; its profit share needs F18F's income statement.

### F18A — Ledger core (detailed: `docs/specs/F18A-ledger-core.md`)
The foundation every other package posts into: the `accountant` role and the ledger permissions; the seeded Arabic chart of accounts with system accounts and required dimensions; balanced double-entry journals in USD and SYP with the rate and USD amount on every line and the five dimensions; manual entries going draft → submitted → posted with review by another person, attachments and notifications, corrected only by reversing entries; fiscal years and monthly periods with close, reopen and the year's closing entry; opening balances at 2026-10-01; an account's activity and balances; and the exported posting service and period guard.

### F18B — Automatic posting from existing documents
Every financial document the Hub already has writes its entry in the same transaction: invoice issue (receivables against revenue per line, with the line's service, department and engagement) and void (a reversal dated the void day); payments and their voids (cash against receivables, with the realized exchange difference when the payment's rate differs from the invoice's); ad wallet deposits (cash against the client's ad budget liability) and campaign spend (the liability reduced); project expenses (expense against cash, with a department); retainer credits and termination fees. Payments post to a general "cash not yet assigned" account until F18C assigns boxes. It closes the data gaps the posting needs (a service on automatic invoice lines, a department on expenses, dates instead of timestamps where posting needs a date), applies the closed-period guard to these documents, and runs the one-time backfill of every document dated from 2026-10-01.

### F18C — Cash and banks
Cash boxes, bank accounts and e-wallets as accounts of their own, each in one currency, chosen when a payment is recorded; person wallets and employee custody; transfers between boxes and currency exchange at the actual rate (with its exchange difference); a book per box and a monthly bank reconciliation. Moves the backfilled payments from the unassigned cash account to their boxes.

### F18D — Purchases, suppliers and expenses
Suppliers, purchase bills, payables and supplier payments; general expenses by category (outside projects) and recurring expenses; purchases for clients as their own invoice line type with cost, price, supplier and receipt, whose margin stays outside service profit and every share; receipt attachments, with receipt reading by AI later.

### F18E — Advanced receivables
One payment across several invoices (allocations); prepayments and unapplied credit held for the client; credit notes and refunds (replacing "void and reissue" where a partial correction is needed); receivables and payables aging.

### F18F — Reports
Trial balance, income statement, balance sheet and cash flow; a full ledger per account and a supplier statement; profitability by client, engagement, department and service from the line dimensions; realized and unrealized exchange differences with the monthly revaluation of SYP balances; a cash forecast; the General Manager's finance dashboard; Excel and PDF export.

### F18G — Partners, tax and fixed assets
Partner current accounts, profit distribution and drawings; income tax and payroll tax under Syrian rules (verified in its spec); fixed assets with their depreciation schedules posting monthly.

## F19's hook into the books
F19 (payroll, commissions and profit shares) is a document owner like any other: its own spec decides the details, within these rules.
- **Payroll run approved:** one entry for the month: salary, commission, bonus and share expenses (dimension employee and department) against salaries payable per employee; deductions (lateness, absence, penalties) reduce the payable; advance installments credit the employee advances account; payroll tax and social insurance credit their liabilities (rates from F18G).
- **Payroll paid:** salaries payable against the cash box or bank used (F18C).
- **Advances:** an advance paid to an employee debits employee advances (dimension employee) against cash; repayments come through the payroll deductions above.
- **Commissions and profit shares** read revenue and profit from the books (F18F; Q15, Q16) and never count purchases for clients (D2).
- Payroll postings respect the closed-period guard: a payroll month is posted while its period is open.

## Open questions
None for this overview. Each package's own questions are asked in its `/spec` session.
