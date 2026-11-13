# F18A — Ledger core

Status: Approved · Date: 2026-11-13 · Scope: `docs/product/v2-scope.md` §F18, `docs/specs/F18-accounting-overview.md` · ADRs: 0006, 0007, 0013, 0014, 0035, 0045

## Summary
The Hub has no books: no chart of accounts, no journal and no periods. F18A builds the ledger every later F18 package posts into: an Arabic chart of accounts for a media agency, balanced double-entry journal entries in USD and SYP with the rate, the USD amount and five dimensions on every line, manual entries reviewed by a second person, fiscal years and monthly periods with close and the year's closing entry, and the opening balances at the books' start date (2026-10-01). It adds the `accountant` role and exports the posting service and the period guard that F18B onward use. F18A posts nothing automatically: documents start posting in F18B.

## In scope / out of scope
- In:
  - The `accountant` role (assignable, two-factor sign-in) and the ledger permissions.
  - Ledger settings: the books' start date (2026-10-01, fixed once an entry is posted).
  - The chart of accounts: the seeded tree below; add, edit, move, archive and restore accounts; header and posting accounts; system accounts; required dimensions; an optional currency restriction.
  - Journal entries with lines: date, memo, lines with account, debit or credit, currency, rate, USD amount, line note and five dimensions (client, engagement, department, service, employee).
  - Manual entries: draft → submitted → posted, returned to draft with a note, discarded; posted by someone other than the author; attachments; notifications.
  - Opening entries dated the books' start date, through the same review.
  - Reversing a posted manual or opening entry with a reason, dated in an open period.
  - Fiscal years (calendar years, the first one October to December 2026) and monthly periods, created on demand; closing months in order; reopening (General Manager, with a reason); closing a year with its automatic closing entry into retained earnings; reopening a year (General Manager).
  - Account activity: an account's posted lines over a date range with the opening and running balance, and the balances of the whole chart at a date.
  - Exported services for later packages: the posting service (`LedgerPosting`) and the period guard (`LedgerPeriods`).
  - Screens: Accounts (the chart), Entries (list, editor, page, the review queue), Periods, an account's activity; the role in the user editor.
- Out (later packages, `docs/specs/F18-accounting-overview.md`):
  - Automatic posting from invoices, payments, the ad wallet, expenses and retainers, the backfill from 2026-10-01, and the period guard on those documents (F18B).
  - Cash boxes, banks, wallets, transfers, reconciliation (F18C); suppliers, bills, general and recurring expenses, purchases for clients, recurring entries (F18D); allocations, credit notes, aging (F18E).
  - Trial balance, financial statements, profitability, exchange revaluation, exports, the dashboard (F18F). F18A's balances screen is the working check, not a report.
  - Partners, tax, fixed assets and depreciation (F18G); their accounts are seeded now for manual use.
  - Importing a chart or entries from a file.

## Roles and access

### Role and permission map changes (`packages/contracts/src/roles.ts`, `permissions.ts`)
- New role **`accountant`** in `ROLES` and `ASSIGNABLE_ROLES`; two-factor sign-in is required for it, as for Finance.
- New permissions, all with scope `all` only:
  - `ledger.read`: the chart, entries, periods and balances. General Manager, accountant, Finance.
  - `ledger.manage`: the chart of accounts and the ledger settings. General Manager, accountant.
  - `ledger.draft`: create, edit, submit, withdraw and discard manual entries. General Manager, accountant.
  - `ledger.post`: post or return a submitted entry (never one's own), reverse a posted entry. General Manager, accountant.
  - `ledger.close`: close a month or a year. General Manager, accountant.
  - `ledger.reopen`: reopen a month or a year. General Manager only.
- The accountant also gets `invoices.read`, `campaigns.read` and `reports.finance` (`all`) to see the documents behind the books. Salaries stay outside the role until F19 decides it.
- The Internal Operations manager gets no ledger permission (D4).

### Actions
| Action | Permission | Roles |
|---|---|---|
| Read the chart, entries, periods, balances, an account's activity; download attachments | `ledger.read` | General Manager, accountant, Finance |
| Add, edit, move, archive, restore accounts; edit the ledger settings | `ledger.manage` | General Manager, accountant |
| Create, edit, submit, withdraw, discard a manual or opening entry | `ledger.draft` | General Manager, accountant (edit, withdraw and discard: the author's own entry, or any for the General Manager) |
| Post or return a submitted entry | `ledger.post` | General Manager, accountant; never the entry's author |
| Reverse a posted manual or opening entry | `ledger.post` | General Manager, accountant |
| Close a month or a year | `ledger.close` | General Manager, accountant |
| Reopen a month or a year | `ledger.reopen` | General Manager |
| Assign the accountant role | `users.manage` (F01) | General Manager, Internal Operations manager |

## Data

Module ownership: a new `accounting` api module owns every table below. It imports `clients`, `projects` (projects and retainers), `catalog` (services), `auth` (users and departments) for the dimension checks and labels, `files` (owner policy for `journal_entry`), `notifications` and `audit`. No module imports `accounting` in F18A; F18B onward call its exported services (D8).

Money fields are integer minor units in the line's currency (ADR 0006). A rate is `numeric(12,4)`, SYP per 1 USD, through the existing `exchangeRate` column helper and the tested conversion functions of F13 rule 30. Dates without a time are calendar days in Asia/Damascus.

### `ledger_settings` (single row, seeded by its migration)
| Field | Type | Notes |
|---|---|---|
| `id` | smallint PK = 1 | single row |
| `books_start_date` | date, required | seeded 2026-10-01; a first day of a month; read-only once any entry is posted (`BOOKS_STARTED`) |
| `updated_at`, `updated_by_id` | | |

### `ledger_accounts` (business table)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text, required, unique | digits only; a child's code starts with its parent's code and is longer (`CODE_NOT_UNDER_PARENT`) |
| `name` | text, required | Arabic name, unique among siblings |
| `description` | text | |
| `parent_id` | uuid → `ledger_accounts`, nullable | null for the five roots |
| `type` | enum `asset`, `liability`, `equity`, `revenue`, `expense` | equal to the root's type (`TYPE_MISMATCH`) |
| `is_postable` | boolean | true: holds lines, has no children; false: a header |
| `currency` | `currency` enum, nullable | when set, every line on the account is in this currency (`ACCOUNT_CURRENCY`) |
| `required_dimensions` | text[] of `client`, `engagement`, `department`, `service`, `employee` | checked at posting (`DIMENSION_REQUIRED`) |
| `system_key` | text, nullable, unique | the stable key automatic posting uses; seeded only, never edited |
| `archived_at`, `archived_by_id` | | archived: no new lines; existing lines and balances stay |
| `created_at`, `created_by_id`, `updated_at`, `version` | | `version` for optimistic concurrency |

Indexes: `parent_id`; unique `code`; unique `system_key` where not null.

The normal balance is derived from the type (debit for assets and expenses, credit for the rest); a contra account (accumulated depreciation) simply shows a negative balance.

### Seeded chart of accounts
Seeded by the migration; the names are the Arabic data, the English is for this spec only. Level 1 = 1 digit, level 2 = 2, level 3 = 4 (headers), level 4 = 6 digits (posting accounts). `key` = `system_key`; `dims` = required dimensions; `cur` = currency restriction.

| Code | Name | English | Notes |
|---|---|---|---|
| 1 | الأصول | Assets | type asset |
| 11 | الأصول المتداولة | Current assets | |
| 1101 | النقدية وما في حكمها | Cash and equivalents | |
| 110101 | الصندوق الرئيسي — دولار | Main cash box, USD | cur USD |
| 110102 | الصندوق الرئيسي — ليرة | Main cash box, SYP | cur SYP |
| 110103 | الحساب البنكي — دولار | Bank account, USD | cur USD |
| 110104 | المحافظ الإلكترونية | E-wallets | |
| 110109 | نقدية غير مخصصة لصندوق | Cash not yet assigned to a box | key `cash_unassigned` (F18B, F18C) |
| 1102 | الذمم المدينة | Receivables | |
| 110201 | ذمم العملاء | Client receivables | key `receivables`, dims client |
| 110202 | سلف الموظفين | Employee advances | key `employee_advances`, dims employee |
| 110203 | عهد الموظفين | Employee custody | key `employee_custody`, dims employee |
| 1103 | مدفوعات مقدمة | Prepayments | |
| 110301 | مصروفات مدفوعة مقدماً | Prepaid expenses | |
| 110302 | دفعات مقدمة للموردين | Supplier prepayments | key `supplier_prepayments` |
| 12 | الأصول غير المتداولة | Non-current assets | |
| 1201 | الأصول الثابتة | Fixed assets | |
| 120101 | معدات التصوير والإنتاج | Camera and production equipment | |
| 120102 | أجهزة الحاسوب | Computers | |
| 120103 | الأثاث والتجهيزات | Furniture and fittings | |
| 120104 | السيارات | Vehicles | |
| 1202 | مجمع الإهلاك | Accumulated depreciation | |
| 120201 | مجمع إهلاك الأصول الثابتة | Accumulated depreciation of fixed assets | |
| 2 | الخصوم | Liabilities | type liability |
| 21 | الخصوم المتداولة | Current liabilities | |
| 2101 | الذمم الدائنة | Payables | |
| 210101 | ذمم الموردين | Supplier payables | key `payables` |
| 210102 | رواتب مستحقة | Salaries payable | key `salaries_payable`, dims employee |
| 210103 | مصروفات مستحقة | Accrued expenses | |
| 2102 | أمانات ودفعات العملاء | Client deposits and prepayments | |
| 210201 | أمانات ميزانيات الإعلانات | Ad budget deposits | key `ad_budget_deposits`, dims client |
| 210202 | دفعات مقدمة من العملاء | Client prepayments | key `client_prepayments`, dims client |
| 2103 | الضرائب المستحقة | Taxes payable | |
| 210301 | ضريبة الدخل المستحقة | Income tax payable | |
| 210302 | ضريبة الرواتب والتأمينات المستحقة | Payroll tax and insurance payable | |
| 22 | الخصوم طويلة الأجل | Long-term liabilities | |
| 2201 | القروض | Loans | |
| 220101 | قروض طويلة الأجل | Long-term loans | |
| 3 | حقوق الملكية | Equity | type equity |
| 31 | حقوق الشركاء | Partners' equity | |
| 3101 | رأس المال | Capital | |
| 310101 | رأس المال | Capital | |
| 3102 | جاري الشركاء | Partner current accounts | |
| 310201 | جاري الشركاء | Partner current accounts | (partners as parties in F18G) |
| 3103 | الأرباح المحتجزة | Retained earnings | |
| 310301 | الأرباح المحتجزة | Retained earnings | key `retained_earnings` |
| 3104 | الأرصدة الافتتاحية | Opening balances | |
| 310401 | حساب الأرصدة الافتتاحية | Opening balance equity | key `opening_balance_equity` |
| 4 | الإيرادات | Revenue | type revenue |
| 41 | إيرادات الخدمات | Service revenue | |
| 4101 | إيرادات الخدمات | Service revenue | |
| 410101 | التسويق الرقمي وإدارة الحسابات | Digital marketing and account management | |
| 410102 | المحتوى والتصميم | Content and design | |
| 410103 | التصوير والإنتاج | Photo and video production | |
| 410104 | إدارة الحملات الإعلانية | Ad campaign management fees | |
| 410105 | الهوية والعلامة التجارية | Branding | |
| 410106 | تطوير المواقع والتطبيقات والأتمتة | Web, app and automation development | |
| 410199 | خدمات أخرى | Other services | key `service_revenue_other` |
| 42 | إيرادات أخرى | Other revenue | |
| 4201 | إيرادات أخرى | Other revenue | |
| 420101 | مبيعات مشتريات للعملاء | Purchases for clients, resale | key `client_purchases_revenue` |
| 420102 | رسوم إنهاء العقود | Contract termination fees | key `termination_fees` |
| 420103 | أرباح فروقات الصرف | Exchange gains | key `fx_gain` |
| 420104 | إيرادات متنوعة | Miscellaneous revenue | |
| 5 | تكلفة الإيرادات | Cost of revenue | type expense |
| 51 | التكاليف المباشرة | Direct costs | |
| 5101 | التكاليف المباشرة | Direct costs | |
| 510101 | تكلفة مشتريات للعملاء | Purchases for clients, cost | key `client_purchases_cost` |
| 510102 | تكاليف إنتاج مباشرة للمشاريع | Direct project costs | key `project_direct_costs` |
| 510103 | مستقلون ومتعاقدون | Freelancers and contractors | |
| 510104 | اشتراكات وأدوات للعملاء | Tools and subscriptions for clients | |
| 6 | المصروفات التشغيلية | Operating expenses | type expense |
| 61 | مصروفات الموظفين | Staff costs | |
| 6101 | مصروفات الموظفين | Staff costs | |
| 610101 | الرواتب والأجور | Salaries and wages | |
| 610102 | العمولات والحوافز | Commissions and bonuses | |
| 610103 | حصص الموظفين من الأرباح | Employee profit shares | |
| 610104 | التأمينات الاجتماعية | Social insurance | |
| 62 | المصروفات الإدارية والعمومية | General and administrative | |
| 6201 | المصروفات الإدارية والعمومية | General and administrative | |
| 620101 | الإيجار | Rent | |
| 620102 | الكهرباء والمياه والإنترنت | Utilities and internet | |
| 620103 | الاتصالات | Telephone | |
| 620104 | القرطاسية والضيافة | Stationery and hospitality | |
| 620105 | البرمجيات والاشتراكات | Software and subscriptions | |
| 620106 | النقل والمواصلات | Transport | |
| 620107 | الصيانة | Maintenance | |
| 620108 | الرسوم الحكومية | Government fees | |
| 620109 | الرسوم البنكية والتحويلات | Bank and transfer fees | |
| 63 | تسويق الوكالة | Agency marketing | |
| 6301 | تسويق الوكالة | Agency marketing | |
| 630101 | إعلانات وتسويق الوكالة | Agency advertising and marketing | |
| 64 | الإهلاك | Depreciation | |
| 6401 | الإهلاك | Depreciation | |
| 640101 | مصروف الإهلاك | Depreciation expense | |
| 65 | مصروفات أخرى | Other expenses | |
| 6501 | مصروفات أخرى | Other expenses | |
| 650101 | خسائر فروقات الصرف | Exchange losses | key `fx_loss` |
| 650102 | فروقات التقريب | Rounding differences | key `rounding` |
| 650103 | ديون معدومة | Bad debts | |

### `fiscal_years` (business table)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `year` | integer, unique | calendar year |
| `starts_on`, `ends_on` | date | 1 January (or the books' start date for the first year) to 31 December |
| `closed_at`, `closed_by_id` | | null while open |
| `closing_entry_id` | uuid → `journal_entries`, nullable | the live closing entry |

### `fiscal_periods` (business table)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `fiscal_year_id` | uuid → `fiscal_years` | |
| `month` | date, unique | the first day of the month |
| `closed_at`, `closed_by_id` | | null while open |

A year and its periods are created on demand, in the transaction that first needs them (rule 22); no job is needed.

### `journal_entries` (business table)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `number` | text, unique, nullable | `JE-2026-00001`, taken when the entry is posted (`document_numbers`, new kind `journal_entry`, per year of the entry date) |
| `kind` | enum `manual`, `opening`, `reversal`, `closing`, `automatic` | `automatic` arrives with F18B; the enum value is added then |
| `status` | enum `draft`, `submitted`, `posted`, `discarded` | |
| `entry_date` | date, required | ≥ the books' start date; an opening entry is dated exactly on it |
| `memo` | text, required | |
| `source_type`, `source_id` | text, uuid, nullable | F18B's document link; null in F18A |
| `reverses_entry_id` | uuid → `journal_entries`, nullable, unique | set on a reversal |
| `reversal_reason` | text | required on a reversal |
| `return_note` | text | the last reviewer's note when returned |
| `created_by_id`, `submitted_by_id`, `submitted_at`, `posted_by_id`, `posted_at`, `discarded_at` | | |
| `total_usd_minor` | bigint | the sum of debits in USD, kept for lists |
| `created_at`, `updated_at`, `version` | | |

Indexes: `(status, entry_date)`, `entry_date`, `(source_type, source_id)`, `created_by_id`.

### `journal_lines` (business table, owned by its entry)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `entry_id` | uuid → `journal_entries`, cascade | |
| `position` | smallint | order on the entry |
| `account_id` | uuid → `ledger_accounts` | a posting account |
| `side` | enum `debit`, `credit` | |
| `amount_minor` | bigint, > 0 | in `currency` |
| `currency` | `currency` enum | |
| `rate` | numeric(12,4), nullable | SYP per 1 USD; required for SYP lines, null for USD lines |
| `amount_usd_minor` | bigint, ≥ 0 | equal to `amount_minor` for USD lines; for SYP lines computed by rule 6 (closing lines: rule 29) |
| `note` | text | |
| `client_id` | uuid → `clients`, nullable | |
| `project_id`, `retainer_id` | uuid, nullable | the engagement; at most one (check) |
| `department_id` | uuid → `departments`, nullable | |
| `service_id` | uuid → `catalog_services`, nullable | |
| `employee_id` | uuid → `users`, nullable | |

Indexes: `entry_id`, `(account_id)`, and one per dimension column. Balances are summed from posted lines (status of the entry), with no stored balance table in F18A; F18F may add one if reports need it.

### Changes to other tables
- `document_number_kind` gains `journal_entry`.
- `file_owner_type` gains `journal_entry` (attachments, role `attachment`).
- `user_roles.role` accepts `accountant`.
- New notification types (F16 catalog): `journal_entry_submitted`, `journal_entry_returned`, `journal_entry_posted`.

## States and rules

### Entry states
| From | To | Who | When |
|---|---|---|---|
| — | `draft` | `ledger.draft` | create (manual or opening) |
| `draft` | `submitted` | the author (or the General Manager) | rules 4 to 9 pass, without the period-open check (rule 12) |
| `submitted` | `draft` | the author (withdraw), or a reviewer (return with a required note) | |
| `submitted` | `posted` | `ledger.post`, not the author (`SELF_REVIEW`) | rules 4 to 12 pass again at posting |
| `draft` | `discarded` | the author (or the General Manager) | |
| — | `posted` | the system | reversals (rule 16) and closing entries (rule 29) are posted at once; F18B's automatic entries too |

Posted and discarded entries never change. Only a draft is edited.

### Lines and balance
1. An entry has at least two lines and at most 500.
2. Each line has one posting, non-archived account (`ACCOUNT_NOT_POSTABLE`, `ACCOUNT_ARCHIVED`), one side and an amount > 0.
3. A line's currency is USD or SYP; an account with a currency accepts only it (`ACCOUNT_CURRENCY`).
4. A SYP line carries its rate, > 0 (`RATE_REQUIRED`); the editor fills it from the current rate in the invoice settings (F13) and the author can change it. A USD line has no rate.
5. A line has at most one engagement; a project or retainer must belong to the line's client when both are set (`ENGAGEMENT_CLIENT_MISMATCH`); a missing client is filled from the engagement.
6. A SYP line's USD amount is `amount_minor / rate`, rounded half away from zero to the cent, through the shared conversion function (ADR 0006).
7. **An entry balances in USD:** the sum of debit USD amounts equals the sum of credit USD amounts. When every line is in the same currency, it must also balance in that currency (`UNBALANCED`, with both differences).
8. When the original currencies balance per currency and only the USD conversion leaves a difference of at most one cent per SYP line, posting adds a line to the `rounding` account for the difference. Any other difference is `UNBALANCED`.
9. Every dimension an account requires is set on the line (`DIMENSION_REQUIRED`, naming the line and the dimension). Dimension records must exist; archived ones are refused on new and edited lines (`DIMENSION_ARCHIVED`) but kept on posted lines.

### Dates and periods
10. An entry's date is on or after the books' start date (`BEFORE_BOOKS_START`).
11. An opening entry is dated exactly on the books' start date. Several opening entries may be posted (one per area, or a later correction).
12. **A draft may carry any date, but an entry is posted only into an open period** (`PERIOD_CLOSED`). Submitting into a closed period is allowed (it waits for a reopen or a date change), and the review queue flags it.
13. The books' start date can be changed only while no entry is posted (`BOOKS_STARTED`); it must be the first of a month.

### Numbering, review and reversal
14. Posting takes the next number of the entry date's year (`JE-<year>-<5 digits>`), under the `document_numbers` lock; discarded and draft entries have no number.
15. The reviewer sees the lines, balances, attachments and any warning; returning requires a note, which is shown on the draft until the next submit.
16. **Reversal:** a posted `manual` or `opening` entry is reversed once (`ALREADY_REVERSED`) with a required reason and a date (default today) that is ≥ the original's date and in an open period. The reversal copies every line with the side swapped, the same currency, rate, USD amount and dimensions, has kind `reversal`, `reverses_entry_id` set, and is posted at once by the person reversing. A reversal and a closing entry cannot be reversed by hand (`NOT_REVERSIBLE`); F18B's entries are reversed through their documents.
17. Attachments (any file type the F10 policy allows, up to its size limit) can be added and removed on a draft or submitted entry by its author; on a posted entry they can only be added (by `ledger.draft` or `ledger.post` holders), never removed.

### Chart of accounts
18. A posting account has no children; an account with lines can never become a header (`ACCOUNT_HAS_LINES`); a header with children can never become postable.
19. Moving an account (new parent) keeps its type equal to the new root's (`TYPE_MISMATCH`) and its code under the new parent (rule in the field table); an account's code can change only while it has no posted lines.
20. Archiving: a header only when all its children are archived (`ACCOUNT_HAS_ACTIVE_CHILDREN`); a system account never (`SYSTEM_ACCOUNT`); an account with a non-zero balance only after confirmation (the warning names the balance). Archived accounts are hidden from pickers and listed under "Archived".
21. A system account's type, parent root and key never change; its name, code, description and required dimensions can (its required dimensions keep at least those seeded).

### Periods and years
22. A fiscal year and its periods are created on demand by the first entry, close or listing that needs a month from the books' start date onward: periods from the later of 1 January and the books' start date to 31 December.
23. **Months close in order:** a month closes only after it has ended (Asia/Damascus), when every earlier month since the books' start is closed (`PERIODS_OUT_OF_ORDER`), and when no `submitted` entry is dated in it (`PERIOD_HAS_PENDING`, with the list). Drafts dated in it stay and are shown as a warning.
24. **Reopening** a month (`ledger.reopen`) requires a reason, only for the latest closed month (`PERIODS_OUT_OF_ORDER`) and only while its year is open (`YEAR_CLOSED`).
25. While a month is closed, nothing posts with a date in it: manual entries here; documents from F18B on, through `LedgerPeriods.assertOpen(date)` (overview D7).
26. **Closing a year** (`ledger.close`) requires all its months closed (`YEAR_NOT_COMPLETE`) and every earlier year closed. It posts the closing entry dated 31 December (rule 29) and marks the year closed, in one transaction.
27. **Reopening a year** (`ledger.reopen`, reason required) is allowed only while no month of the next year is closed. It posts the reversal of the closing entry dated 31 December, clears `closing_entry_id`, and reopens the year; its December stays closed until reopened by rule 24.
28. The first year (October to December 2026) closes like any other.
29. **The closing entry** has kind `closing` and no dimensions. For each revenue and expense account and each currency with a non-zero balance for the year, one line clears that balance in its original currency with its USD amount equal to the account's USD balance in that currency (not recomputed from a rate; `rate` stores that USD balance's implied rate, informational). The net in USD goes to `retained_earnings` in USD. Reports exclude closing entries from the income statement.

### Services for later packages
30. `LedgerPosting.post(tx, entry)` (exported): builds an `automatic` (F18B) or other system entry from lines given by account `system_key` or id, applies rules 1 to 12 and 14, and posts it inside the caller's transaction; any failure throws and fails the caller's change. F18A uses it for reversals and closing entries; F18B adds the `automatic` kind and the source link.
31. `LedgerPeriods.assertOpen(tx, date)` (exported): throws `PERIOD_CLOSED` when the date's month is closed, and `BEFORE_BOOKS_START` before the books' start date.
32. Money arithmetic for entries lives in one tested module (sums, rounding, the rounding line) shared by the api and, for the editor's live totals, the web through `packages/contracts`.

## API
All routes under `/api/accounting`. Lists are paginated and sorted per ADR 0013.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /settings` | `ledger.read` | — | `ledgerSettingsSchema` | — |
| `PATCH /settings` | `ledger.manage` | `ledgerSettingsUpdateSchema` | `ledgerSettingsSchema` | `BOOKS_STARTED`, `VALIDATION` |
| `GET /accounts` | `ledger.read` | `?archived` | `ledgerAccountTreeSchema` (with each account's USD balance today) | — |
| `POST /accounts` | `ledger.manage` | `ledgerAccountCreateSchema` | `ledgerAccountSchema` | `CODE_TAKEN`, `CODE_NOT_UNDER_PARENT`, `TYPE_MISMATCH`, `PARENT_POSTABLE` |
| `PATCH /accounts/:id` | `ledger.manage` | `ledgerAccountUpdateSchema` + `version` | `ledgerAccountSchema` | rules 18–21, `STALE` |
| `POST /accounts/:id/archive`, `/restore` | `ledger.manage` | `{ confirmBalance? }` | `ledgerAccountSchema` | `SYSTEM_ACCOUNT`, `ACCOUNT_HAS_ACTIVE_CHILDREN`, `BALANCE_CONFIRMATION` |
| `GET /accounts/:id/activity` | `ledger.read` | `?from&to&currency&dimension filters` | `accountActivitySchema` (opening balance, lines with running USD balance and original amounts, closing balance) | — |
| `GET /balances` | `ledger.read` | `?date` | `ledgerBalancesSchema` (every account and header, USD and per-currency totals) | — |
| `GET /entries` | `ledger.read` | `?status&kind&from&to&accountId&clientId&...&search` | `journalEntryPageSchema` | — |
| `GET /entries/:id` | `ledger.read` | — | `journalEntrySchema` (lines, attachments, reversal links, history) | — |
| `POST /entries` | `ledger.draft` | `journalEntryDraftSchema` (kind `manual` or `opening`) | `journalEntrySchema` | `VALIDATION` |
| `PATCH /entries/:id` | `ledger.draft` (author or General Manager) | `journalEntryDraftSchema` + `version` | `journalEntrySchema` | `ENTRY_NOT_EDITABLE`, `STALE` |
| `POST /entries/:id/submit` | `ledger.draft` | `{ version }` | `journalEntrySchema` | rules 1–11, `ENTRY_NOT_EDITABLE` |
| `POST /entries/:id/withdraw` | `ledger.draft` | `{ version }` | `journalEntrySchema` | `ENTRY_NOT_SUBMITTED` |
| `POST /entries/:id/return` | `ledger.post` | `{ note, version }` | `journalEntrySchema` | `SELF_REVIEW`, `ENTRY_NOT_SUBMITTED` |
| `POST /entries/:id/post` | `ledger.post` | `{ version }` | `journalEntrySchema` | `SELF_REVIEW`, rules 1–12 |
| `POST /entries/:id/discard` | `ledger.draft` | `{ version }` | `journalEntrySchema` | `ENTRY_NOT_EDITABLE` |
| `POST /entries/:id/reverse` | `ledger.post` | `{ date, reason }` | `journalEntrySchema` (the reversal) | `ALREADY_REVERSED`, `NOT_REVERSIBLE`, `PERIOD_CLOSED` |
| `GET/POST/DELETE /entries/:id/attachments[/:fileId]` | as rule 17 | F10 upload flow | F10 file schemas | `ENTRY_NOT_EDITABLE` |
| `GET /years` | `ledger.read` | — | `fiscalYearListSchema` (years with months, status, pending counts) | — |
| `POST /periods/:month/close` | `ledger.close` | — | `fiscalPeriodSchema` | `PERIODS_OUT_OF_ORDER`, `PERIOD_HAS_PENDING`, `PERIOD_NOT_ENDED` |
| `POST /periods/:month/reopen` | `ledger.reopen` | `{ reason }` | `fiscalPeriodSchema` | `PERIODS_OUT_OF_ORDER`, `YEAR_CLOSED` |
| `POST /years/:year/close` | `ledger.close` | — | `fiscalYearSchema` | `YEAR_NOT_COMPLETE`, `PERIODS_OUT_OF_ORDER` |
| `POST /years/:year/reopen` | `ledger.reopen` | `{ reason }` | `fiscalYearSchema` | `NEXT_YEAR_STARTED` |

Every route answers 401 without a session and 403 without the permission.

## Screens
A new **Accounting** group in the navigation for `ledger.read` holders: Entries, Review (for `ledger.post`, with the count of submitted entries by others), Accounts, Periods. Arabic, RTL, design system only; amounts show the original currency and the USD amount.

- **Accounts** `/accounting/accounts`: the chart as an expandable tree (code, name, type, flags for system, currency and required dimensions, USD balance today); search by code or name; add a child, edit, move, archive and restore in a side panel (`ledger.manage`); "Archived" toggle. Each posting account opens its activity. Empty state cannot occur (seeded); loading skeleton; errors inline.
- **Account activity** `/accounting/accounts/:id`: date range (default the current year), currency and dimension filters; opening balance, lines (date, entry number linking to the entry, memo, note, dimensions, debit, credit, original amount, running USD balance), closing balance. Empty: "No posted lines in this range".
- **Entries** `/accounting/entries`: a table (number or "Draft", date, kind, memo, total USD, status, author, posted by) with filters (status, kind, dates, account, client, engagement, department, service, employee) and search; "New entry" and "New opening entry" for `ledger.draft`.
- **Entry editor** `/accounting/entries/new`, `/accounting/entries/:id/edit`: date, memo; a line grid (account picker by code or name showing only postable, active accounts; debit or credit; currency; rate for SYP, prefilled; USD amount read-only; note; dimension pickers, with required ones marked from the account); live totals in USD and per currency with the difference; attachments; Save draft, Submit. Errors from the server are shown on their lines. A returned draft shows the reviewer's note on top.
- **Entry page** `/accounting/entries/:id`: header with status, number, kind, dates, author, reviewer; lines; totals; attachments; links to the reversed or reversing entry; the audit history. Actions by state and role: Edit, Submit, Withdraw, Discard, Post, Return (with note), Reverse (date and reason dialog).
- **Review** `/accounting/review`: submitted entries by others, oldest first, with a "closed period" flag; opening an entry shows Post and Return.
- **Periods** `/accounting/periods`: years with their months (open, closed by whom and when, submitted and draft counts); Close month (the next one in order, `ledger.close`), Reopen month (the latest closed, `ledger.reopen`, reason dialog); Close year and Reopen year with the same rules; the books' start date in a settings card (`ledger.manage`, editable only before the first posting).
- **User editor** (F01): the `accountant` role in the role choices.

Finance sees every screen read-only (no create, review or close actions).

## Audit, notifications and jobs
- Audit entries (ADR, the shared audit log): account created, updated, moved, archived, restored; settings changed; entry created, edited, submitted, withdrawn, returned (with the note), posted, discarded, reversed (with the reason); attachment added or removed; month closed and reopened (with the reason); year closed and reopened (with the reason).
- Notifications (F16 catalog, in-app and push, default on):
  - `journal_entry_submitted`: to holders of `ledger.post` other than the author.
  - `journal_entry_returned`: to the author, with the note.
  - `journal_entry_posted`: to the author when someone else posts it.
- No scheduled jobs: years and periods are created on demand (rule 22).

## Edge cases
1. Two reviewers post the same entry at once: the row lock and `version` let one succeed; the other gets `STALE` and sees it posted.
2. An entry is posted while its month is being closed: the close and the posting lock the period row; whichever comes second sees the new state (`PERIOD_CLOSED` or `PERIOD_HAS_PENDING`).
3. An author loses `ledger.draft` with drafts open: the drafts stay; the General Manager can edit, submit or discard them.
4. The only accountant submits an entry: only the General Manager can post it (rule: never the author).
5. An account is archived while a draft uses it: the draft keeps the line; submitting or posting refuses it (`ACCOUNT_ARCHIVED`) until the line changes.
6. A client, project, retainer, department, service or employee is archived after posting: posted lines keep it and still show it; new lines cannot use it.
7. A SYP-only entry balances in SYP but its USD amounts differ by a cent per line: rule 8 adds a rounding line on posting, shown on the entry page.
8. A mixed entry (USD and SYP lines, an exchange) balances only in USD: allowed (rule 7 checks the original currency only when all lines share it).
9. A draft dated in a closed month: it can be saved and submitted, never posted; the editor and the review queue say so.
10. A year has months with no entries at all: they are closed like any other. A year with no revenue or expense balance closes without a closing entry.
11. The current rate is not set in the invoice settings: SYP lines start without a rate and the author types it.
12. An entry with 500 lines (opening balances per client): the editor stays usable (virtualized grid) and posting stays in one transaction.
13. The books' start date is changed before any posting: existing drafts dated before it are refused on submit (`BEFORE_BOOKS_START`).

## Open questions
None. Rollout note (overview D1): in production, no month is closed before F18B's backfill has run.

## PRs
1. **Ledger API:** contracts (role, permissions, schemas, the money module of rule 32), db (settings, accounts with the seed, years, periods, entries, lines; the enum additions), the `accounting` module with the chart, entries and their review, reversal, attachments, notifications, audit, the exported `LedgerPosting` and `LedgerPeriods`; API tests.
2. **Periods API:** close and reopen months, close and reopen years with the closing entry, account activity and balances; API tests.
3. **Accounting screens, part 1:** the navigation group, Accounts, Entries, the entry editor and page, Review, the role in the user editor; E2E and RTL screenshots.
4. **Accounting screens, part 2:** Periods and the settings card, account activity, the full F18A E2E pass.

## Acceptance
- In the browser:
  1. As the General Manager, give a user the accountant role; sign in as that user (two-factor is asked).
  2. Open Accounts: the seeded chart shows; add a sub-account under Rent, archive it, restore it; try to archive "Client receivables" (refused, system account).
  3. Create an opening entry dated 2026-10-01: cash USD 1,000 debit, client receivables 500 debit with a client, ad budget deposits 300 credit with the client, opening balance equity 1,200 credit; submit. Try to post it as its author (refused).
  4. As the General Manager, open Review, return it with a note; as the accountant, fix and resubmit; as the General Manager, post it: it gets `JE-2026-00001`.
  5. Create a manual SYP entry with a rate; check the USD amounts and totals; post it through review; reverse it with a reason: the reversal is posted and linked.
  6. Open the activity of cash USD: the opening balance line and the running balance.
  7. Open Periods: close October 2026 (allowed after it ended), try to close December before November (refused); try to post an entry dated in October (refused); reopen October as the General Manager with a reason.
  8. As Finance, open the accounting screens: everything is visible, no action buttons.
- Tests:
  - API: every route for success, 401, 403 (Finance on write routes, the Internal Operations manager on every route, the author on post and return), validation and every error code above.
  - Unit: the money module (conversion, rounding, the rounding line, balance per currency and in USD), the closing entry computation, code and type rules of the chart, period order rules.
  - E2E and RTL screenshots: the chart tree, the entry editor with errors, the review flow, the periods screen.
