# F12 — Ad campaigns and ad budget

Status: Approved · Date: 2026-10-04 · Scope: `docs/product/v1-scope.md` §F12 (and A11) · ADRs: 0006, 0007, 0008, 0013, 0014, 0018, 0019, 0024, 0025

## Summary
The money clients pay for ads is mixed with the agency's fees (problem 8): nobody can say how much of a client's ad money is left, campaigns run past what was paid, and the monthly results live in screenshots. F12 adds the **ad campaign** (client, platform, objective, planned budget, dates, owner, status) with **periodic updates** entered by hand (spend, reach, clicks, results, and the computed cost per result), and a **client ad-budget wallet** in USD, kept apart from invoices: Finance and the Operations manager record **deposits** (with a numbered receipt) and **refunds**, the spend of wallet-funded campaigns is deducted from it, and the account manager and the campaign owners are alerted when the balance drops below the client's threshold, then weekly while it stays low (**A11**).

## In scope / out of scope
- In:
  - Campaigns: create, edit, start, pause, resume, complete, reopen, cancel with a reason, archive (mistakes only); funding source `wallet` (default) or `client_direct` (the client pays the platform with their own card); optional links to a project or retainer and to a task of the same client, for display and reports only.
  - Campaign updates: a period (normally a week, inside one calendar month), spend in USD, reach, clicks, results; edit and archive.
  - The client wallet (one per client, USD): deposits in USD or SYP converted at their own rate, refunds to the client, voids with a reason, a low-balance threshold (default 100 USD), the balance and a ledger. Deposits get a numbered Arabic receipt PDF (`AD-<year>-<n>`).
  - A11: alert when the balance of a client that uses the wallet drops below its threshold, then every 7 days while it stays below.
  - Screens: the Campaigns page (Campaigns and Ad budgets tabs), the campaign page, the client's new **Ads** tab (wallet, ledger, campaigns), deposit and refund dialogs.
- Out (later or never):
  - Meta Ads / Google Ads API integration (scope §6).
  - Ad sets and ads below a campaign, creatives, audiences, daily budgets, impressions and other metrics beyond reach, clicks and results (scope: short results).
  - Agency management fees on ad spend: they are agency fees and go on invoices (F13); the wallet holds client money only (owner decision, problem 8).
  - Ad budget through invoices, and a wallet per currency (owner decisions: separate deposits, one USD wallet).
  - Automatic status changes by date, reminders to enter updates, campaign dates on the company calendar, notifications other than A11.
  - Coupling with tasks: completing or starting a campaign never changes a task, and the retainer `ad_campaign` deliverable keeps counting delivered tasks (owner decision).
  - The monthly client report and campaign dashboards: F15 reads campaigns and updates.

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `campaigns.read` and `campaigns.manage`: new department capability for **Marketing members** (`all`; a manager is also a member) and the **Internal Operations manager** (`all`). The General Manager keeps `all`; the Account Manager keeps `own_clients` (owner decision).
- `campaigns.read`: **Finance** role gains `all` (owner decision).
- New permission **`campaigns.fund`** (record and void deposits and refunds): General Manager `all`, Finance `all`, Internal Operations manager `all` (owner decision: money received is recorded by finance owners only).
- Everyone else (employees outside Marketing, department managers without these grants) sees no campaigns and no wallet (owner decision).
- "Campaign managers" below means holders of `campaigns.manage` covering the client.

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| List and open campaigns and their updates | `campaigns.read` | General Manager, Operations manager, Marketing members, Finance: all · Account Manager: own_clients |
| Create, edit, change status, archive campaigns | `campaigns.manage` | General Manager, Operations manager, Marketing members: all · Account Manager: own_clients |
| Add, edit, archive campaign updates | `campaigns.manage` | as above |
| Read a client's wallet, ledger, receipts and proofs | `campaigns.read` covering the client | as for campaigns |
| Edit a client's low-balance threshold | `campaigns.manage` covering the client | campaign managers |
| Record and void deposits and refunds | `campaigns.fund` | General Manager, Finance, Operations manager: all |
| List wallets of all readable clients (Ad budgets tab) | `campaigns.read` | as for campaigns, filtered by scope |

## Data

Module ownership: a new `campaigns` module (listed in `docs/architecture.md`) owns every table below. It imports `clients` (`ClientDirectory`: name, status, account manager, billing name), `projects` (`EngagementDirectory`: project and retainer summaries of a client), `tasks` (a new small read export `TaskLinks`: summary of a task and its client, for the optional link), `invoices` (exported `DocumentNumbers` for the `ad_deposit` counter, and the current rate from the invoice settings), `quotes` (company details printed on the receipt, as F13), `files` (owner policy for `ad_wallet_entry`), `notifications`, `audit` and `auth` (`UserDirectory`). No module imports `campaigns`.

Money: every campaign amount (budget, spend) and every wallet balance is **USD** in integer minor units (ADR 0006: ad platforms bill in USD; ADR 0025). Deposits and refunds keep their own currency and rate and store their USD amount. Rates are `numeric(12,4)` SYP per 1 USD, as F13. Dates without a time are calendar days in Asia/Damascus.

### Enums (in `packages/contracts/src/campaigns.ts`)
- `ad_platform`: `meta` (Facebook and Instagram), `google` (Search, YouTube, Display), `tiktok`, `snapchat`, `linkedin`, `x`, `other`.
- `ad_objective`: `awareness`, `traffic`, `engagement`, `messages`, `leads`, `sales`, `video_views`, `app_installs`, `other`. The objective names what a **result** is (a message, a lead, a sale, a click for traffic, …); the UI labels the results column by it.
- `ad_campaign_status`: `planned`, `active`, `paused`, `completed`, `cancelled`.
- `ad_funding`: `wallet`, `client_direct`.
- `ad_wallet_entry_kind`: `deposit`, `refund`.
- `document_number_kind` (F13) gains `ad_deposit`. `file_owner_type` (F10) gains `ad_wallet_entry`.

### `ad_campaigns` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid → `clients.id` | required, indexed |
| `name` | text | required, 1–200 chars |
| `platform` | `ad_platform` | required |
| `objective` | `ad_objective` | required |
| `funding` | `ad_funding` | required, default `wallet`; changeable only while the campaign has no non-archived updates (rule 6) |
| `budget_minor` | bigint | required, > 0, USD; the planned total for the whole campaign |
| `starts_on` | date | required |
| `ends_on` | date | optional (open-ended), ≥ `starts_on` |
| `owner_id` | uuid → `users.id` | required, an active user; indexed |
| `status` | `ad_campaign_status` | required, default `planned` |
| `project_id` | uuid → `projects.id` | optional; the client's project; indexed |
| `retainer_id` | uuid → `retainers.id` | optional; the client's retainer; at most one of `project_id`, `retainer_id` (check); indexed |
| `task_id` | uuid → `tasks.id` | optional; a task of the same client; indexed |
| `notes` | text | ≤ 2000 chars, default '' |
| `cancel_reason` | text | ≤ 500 chars; set exactly when `status` = `cancelled` (check) |
| `created_by_id`, `created_at`, `updated_at`, `archived_at`, `archived_by_id` | | business table conventions |

Indexes: (`client_id`, `status`), (`owner_id`, `status`). **Archived** means entered by mistake: hidden from lists and totals, readable by direct link to campaign managers, never counted in the wallet (it has no updates, rule 7).

### `ad_campaign_updates` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | |
| `campaign_id` | uuid → `ad_campaigns.id` | required, indexed |
| `period_start`, `period_end` | date | required; `period_start` ≤ `period_end` ≤ today; both in the same calendar month (rule 9) |
| `spend_minor` | bigint | required, ≥ 0, USD |
| `reach` | integer | required, ≥ 0 |
| `clicks` | integer | required, ≥ 0 |
| `results` | integer | required, ≥ 0 |
| `note` | text | ≤ 500 chars, default '' |
| `entered_by_id`, `created_at`, `updated_at`, `updated_by_id`, `archived_at`, `archived_by_id` | | business table conventions |

Index: (`campaign_id`, `period_start`). No stored cost per result: it is computed (rule 11). **Archived** means entered by mistake: left out of every total and of the wallet.

### `ad_wallets`
One row per client that has a wallet setting or entry, created on first use (first deposit, refund, threshold edit, or update on a wallet-funded campaign) and locked by every balance change (rule 17).
| Field | Type | Rules |
|---|---|---|
| `client_id` | uuid → `clients.id` | primary key |
| `low_balance_threshold_minor` | bigint | optional, ≥ 0, USD; default 10000 (100 USD); null turns A11 off for the client |
| `low_since` | timestamptz | set when the balance first falls below the threshold (rule 20), cleared when it is back at or above it |
| `updated_at`, `updated_by_id` | | |

Not archived: it follows the client.

### `ad_wallet_entries` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid → `clients.id` | required, indexed |
| `kind` | `ad_wallet_entry_kind` | required |
| `year`, `number` | integer | the receipt number, deposits only (check: set exactly for deposits); unique together |
| `occurred_on` | date | required, ≤ today |
| `amount_minor` | bigint | required, > 0, in `currency` |
| `currency` | `currency` (USD, SYP) | required |
| `syp_per_usd` | numeric(12,4) | required, > 0; the current rate by default, editable |
| `usd_minor` | bigint | required, > 0; equal to `amount_minor` for USD, else converted half up (`convertMinor`, F13 rule 30) |
| `method` | `payment_method` (F13: cash, bank transfer, e-wallet) | required |
| `reference` | text | ≤ 200 chars |
| `note` | text | ≤ 500 chars |
| `proof_file_item_id` | uuid → `file_items.id` | optional; a `document` of the entry |
| `receipt_snapshot` | jsonb | deposits: the frozen render payload (`adDepositReceiptSnapshotSchema`) |
| `receipt_pdf_status` | `pdf_status` | deposits only |
| `receipt_file_item_id` | uuid → `file_items.id` | deposits: the receipt, a `document` of the entry; archived when the deposit is voided |
| `recorded_by_id`, `created_at` | | |
| `voided_at`, `voided_by_id`, `void_reason` | | set together (check); reason ≤ 500 chars |

Indexes: (`client_id`, `occurred_on`), the file item and user foreign keys. Entries are never archived; a mistake is **voided** and stays visible as void, keeping its receipt number (as F13 payments).

### Changes to other tables
- `document_numbers` (F13): kind `ad_deposit`, display `AD-<year>-<number padded to 4>`, year of `created_at` in Asia/Damascus.
- `file_items` (F10): owner type `ad_wallet_entry` with `ad_wallet_entry_id` (uuid → `ad_wallet_entries.id`, indexed) under the owner check constraint, `client_id` required, role `document` only. The owner policy answers: visible to `campaigns.read` covering the client; added only at entry creation (proof upload) and by the receipt handler; closed when the entry is void. The client library (F10 rule 13) does not list these files.

## States and rules

### Campaign status
```
planned ──start──→ active ⇄ pause/resume ⇄ paused
active | paused ──complete──→ completed ──reopen──→ active
planned | active | paused ──cancel (reason)──→ cancelled   (final)
```
All transitions by campaign managers covering the client; any other move is `INVALID_TRANSITION`.

### Campaigns
1. A campaign is created only for a non-archived client (`CLIENT_ARCHIVED`); paused and ended clients are allowed (a last campaign may still run). It starts `planned`.
2. `owner_id` must be an active user (`INVALID_OWNER`). Any active user may own a campaign; the owner gets no extra permissions from it, only the A11 alert (rule 20).
3. `project_id` / `retainer_id` must be a non-archived project or retainer of the same client, and `task_id` a non-archived task of the same client (`INVALID_ENGAGEMENT`). The links are shown on the campaign page and read by F15; they never change the task, the project or the retainer (owner decision). A link to an engagement or task archived later stays and is shown as archived.
4. Dates: `ends_on` ≥ `starts_on` (`INVALID_DATES`). Dates do not move the status; an `active` campaign past `ends_on` shows an "end date passed" badge.
5. Editable fields (name, platform, objective, budget, dates, owner, links, notes) can be changed in every status except `cancelled` (`INVALID_TRANSITION`); every save is audited with before/after. A whole-campaign save carries `updatedAt` (`CONCURRENT_CHANGE`).
6. `funding` can be changed only while the campaign has no non-archived updates (`FUNDING_LOCKED`), so past spend never moves into or out of the wallet.
7. Archive is allowed for `planned` or `cancelled` campaigns without non-archived updates (`CAMPAIGN_HAS_UPDATES`); restore by campaign managers. Archived campaigns accept no changes except restore.
8. Starting a `wallet` campaign whose remaining budget (budget − spend so far) exceeds the client's wallet balance shows a warning in the dialog; it is never refused.

### Updates and results
9. Updates are added to `active`, `paused` and `completed` campaigns (the last update often arrives after the end); `planned`, `cancelled` and archived campaigns refuse them (`INVALID_TRANSITION`). Existing updates stay editable and archivable on any non-archived campaign, a cancelled one included, so a spend mistake can still be fixed (settled in implementation). The period lies within one calendar month (`PERIOD_CROSSES_MONTH`) so monthly totals are exact, and ends on or before today (`INVALID_DATES`). The dialog defaults to the 7 days ending yesterday, cut at the month start.
10. Periods of one campaign's non-archived updates may not overlap (`PERIOD_OVERLAP`), so nothing is counted twice. Every update write locks the campaign row first, then (for a wallet campaign) the wallet row of rule 17. Edits re-check both rules; archived updates are ignored by them.
11. **Cost per result** of an update, a month or a campaign = Σ spend ÷ Σ results, in USD minor units rounded half up; none when results = 0. Campaign totals: spend, reach, clicks, results, cost per result, and budget used = Σ spend ÷ budget (shown as a percentage, highlighted at ≥ 100 %). Reach is the sum of the entered periods and is labelled "reach (sum of periods)": platforms deduplicate reach, so it is an upper bound.
12. The spend of a `wallet` campaign's non-archived updates is deducted from the client's wallet (rule 15); a `client_direct` campaign's spend is recorded for results and reports only and never touches the wallet (owner decision).
13. Spend may exceed the budget and the wallet balance: it is a fact that already happened on the platform. The update dialog warns when the save makes the campaign exceed its budget or the wallet go below zero; the save is never refused (owner decision).
14. An active campaign whose last update ends more than 7 days ago (or that has none 7 days after its start) shows a "no update for N days" badge in lists. No notification.

### Wallet
15. **Balance** (USD) = Σ `usd_minor` of non-void deposits − Σ `usd_minor` of non-void refunds − Σ `spend_minor` of non-archived updates of the client's non-archived `wallet` campaigns. Computed on read by `adWalletBalance(...)`; never stored. It may be negative, shown in red as "owed by the client" (owner decision). The ledger lists deposits, refunds and updates (one row per update, with its campaign, dated by its period's end; settled in implementation) by date with a running balance; void entries are shown struck through and do not count.
16. **Deposits** and **refunds** are recorded by `campaigns.fund` holders for a non-archived client (`CLIENT_ARCHIVED` for deposits; refunds are allowed on archived clients so a remaining balance can be returned). Currency USD or SYP; the rate defaults to the current rate of the invoice settings and is required (`RATE_REQUIRED` when none is set and none is given); `occurred_on` ≤ today (`INVALID_DATES`). A refund may not exceed the current balance (`REFUND_EXCEEDS_BALANCE`). A proof upload is optional (`UPLOAD_NOT_FOUND`).
17. Every balance change (deposit, refund, void, update add/edit/archive on a wallet campaign, funding change, campaign archive or restore) and every threshold edit runs in one transaction that creates or locks the client's `ad_wallets` row first, so concurrent changes see each other and rules 16 and 20 are exact.
18. **Void** a deposit or refund with a reason (≤ 500 chars) by `campaigns.fund`; already void is `INVALID_TRANSITION`. A void deposit keeps its receipt number, its receipt document is archived, and the balance drops (it may go negative). There is no un-void: record a new entry.
19. **Deposit receipt:** recording a deposit takes the next `ad_deposit` number of the year, freezes the render payload (company details, client billing name, receipt number, date, amount and currency, rate and USD amount when SYP, method and reference, the line "Advertising budget deposit — held for the client's ad spend, not an agency fee", the wallet balance after it) and queues the PDF (F13 rule 15 pipeline: worker render, hash, idempotency, retries, "Render again"); the ready handler attaches it as a `document` of the entry named `AD-<year>-<number>.pdf`. Refunds have no receipt (owner decision: receipts for money received).

### A11 — low balance
20. A client **uses the wallet** when it has at least one non-void deposit. After every transaction of rule 17, for such a client with a threshold set: when the balance is below the threshold and `low_since` is null, set `low_since` and send `ad_budget_low` to the client's account manager and the owners of the client's `active` `wallet` campaigns (owner decision), each once; when the balance is at or above the threshold (or the threshold is null), clear `low_since`. A client that does not use the wallet never alerts.
21. While `low_since` is set, the `ad-budget-low` source of `notifications.daily` repeats `ad_budget_low` to the same recipients every 7 days from `low_since` (`remindOnce` per client and week mark, the `invoices-overdue` pattern). Topping up above the threshold stops it; falling below again starts a new cycle.
22. Recipients are resolved when sent: a new account manager or a newly active campaign owner gets the next reminder; archived users get nothing.

### General
23. Money and metric functions live in `packages/contracts/src/campaigns.ts` and are unit tested: `adWalletBalance(entries, updates)`, `costPerResult(spend, results)`, `budgetUsed(spend, budget)`, `isLowBalance(balance, threshold, usesWallet)`, `periodsOverlap(...)`, `periodInOneMonth(...)`; currency conversion reuses `convertMinor` (F13 rule 30). The API, the web and the receipt use them.
24. Every change writes an audit entry in the same transaction, including setting and clearing `low_since`; the A11 reminders and the PDF handler write none.
25. Detail responses carry `permissions` flags. Outside the caller's scope a campaign, an update, a wallet or an entry is a 404 (an account manager on another manager's client); a user without `campaigns.read` gets 403.

## API

Schemas live in `packages/contracts/src/campaigns.ts`, reusing the list, money, rate and error schemas. Lists take `page` and `pageSize` and return `{ items, total, page, pageSize }`.

### Campaigns
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/campaigns` | `campaigns.read` | `campaignListQuerySchema`: `search` (name, client), `status[]` (default planned, active, paused), `clientId`, `platform`, `funding`, `ownerId`, `accountManagerId`, `mine` (owner = me), `sort` (`updatedAt` default, `startsOn`, `name`), `order` | `campaignPageSchema`: id, name, client, platform, objective, funding, status, dates, owner, budget, spend, budget used, results, cost per result, last update end, `daysWithoutUpdate`, `endPassed` | 403 |
| `POST /api/campaigns` | `campaigns.manage` covering the client | `createCampaignSchema`: clientId, name, platform, objective, funding, budgetMinor, startsOn, endsOn?, ownerId, projectId?, retainerId?, taskId?, notes | `campaignDetailSchema` | 403, 404 (client), `CLIENT_ARCHIVED`, `INVALID_OWNER`, `INVALID_ENGAGEMENT`, `INVALID_DATES` |
| `GET /api/campaigns/:id` | `campaigns.read` | — | `campaignDetailSchema`: all fields, links with names and archived state, totals (rule 11), totals per month, updates (non-archived, newest first), the client's wallet balance when funding is `wallet`, `permissions` | 404 |
| `PUT /api/campaigns/:id` | `campaigns.manage` | `updateCampaignSchema`: updatedAt + the editable fields + funding | `campaignDetailSchema` | 403, 404, `CONCURRENT_CHANGE`, `INVALID_TRANSITION`, `FUNDING_LOCKED`, `INVALID_OWNER`, `INVALID_ENGAGEMENT`, `INVALID_DATES` |
| `POST /api/campaigns/:id/status` | `campaigns.manage` | `{ to: 'active' \| 'paused' \| 'completed' \| 'cancelled', reason? }` (reason required for `cancelled`) | `campaignDetailSchema` | 403, 404, `INVALID_TRANSITION`, `NOTE_REQUIRED` |
| `POST /api/campaigns/:id/archive` · `/restore` | `campaigns.manage` | — | `campaignDetailSchema` | 403, 404, `INVALID_TRANSITION`, `CAMPAIGN_HAS_UPDATES` |

### Updates
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/campaigns/:id/updates` | `campaigns.manage` | `campaignUpdateInputSchema`: periodStart, periodEnd, spendMinor, reach, clicks, results, note | `campaignDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES`, `PERIOD_CROSSES_MONTH`, `PERIOD_OVERLAP` |
| `PATCH /api/campaign-updates/:id` | `campaigns.manage` | same fields, all optional | `campaignDetailSchema` | same |
| `POST /api/campaign-updates/:id/archive` | `campaigns.manage` | — | `campaignDetailSchema` | 403, 404, `INVALID_TRANSITION` (already archived) |

### Wallet
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/ad-wallets` | `campaigns.read` | `walletListQuerySchema`: `search` (client), `low` (only below threshold), `accountManagerId`, `sort` (`balance` default ascending, `client`) | page of clients that use the wallet or have a wallet campaign: client, account manager, deposited, refunded, spent, balance, threshold, `low`, last deposit date | 403 |
| `GET /api/clients/:id/ad-wallet` | `campaigns.read` covering the client | `{ from?, to? }` for the ledger (default: everything) | `adWalletSchema`: totals, balance, threshold, `low`, `usesWallet`, ledger rows with running balance, entries with receipt state and proof, `permissions` (`canFund`, `canEditThreshold`) | 404 |
| `PATCH /api/clients/:id/ad-wallet` | `campaigns.manage` covering the client | `{ lowBalanceThresholdMinor: number \| null }` | `adWalletSchema` | 403, 404 |
| `POST /api/clients/:id/ad-wallet/entries` | `campaigns.fund` | `recordWalletEntrySchema`: kind, occurredOn, amountMinor, currency, sypPerUsd?, method, reference, note, proofUploadId? | `adWalletSchema` | 403, 404, `CLIENT_ARCHIVED` (deposit), `INVALID_DATES`, `RATE_REQUIRED`, `REFUND_EXCEEDS_BALANCE`, `UPLOAD_NOT_FOUND` |
| `POST /api/ad-wallet-entries/:id/void` | `campaigns.fund` | `{ reason }` | `adWalletSchema` | 403, 404, `INVALID_TRANSITION` |
| `POST /api/ad-wallet-entries/:id/receipt` | `campaigns.read` covering the client | — (render again after a failure) | `{ state }` | 404, `INVALID_TRANSITION` (refund) |
| `GET /api/ad-wallet-entries/:id/receipt` | `campaigns.read` covering the client | — | the receipt PDF inline, `<client> - AD-<year>-<number>.pdf`, never cached | 404 (also while not ready) |

Proof files are downloaded through the F10 file endpoints with the `ad_wallet_entry` owner policy.

New error codes: `INVALID_OWNER`, `INVALID_ENGAGEMENT`, `FUNDING_LOCKED`, `CAMPAIGN_HAS_UPDATES`, `PERIOD_CROSSES_MONTH`, `PERIOD_OVERLAP`, `REFUND_EXCEEDS_BALANCE`. Reused: `CLIENT_ARCHIVED`, `INVALID_DATES`, `INVALID_TRANSITION`, `CONCURRENT_CHANGE`, `NOTE_REQUIRED`, `RATE_REQUIRED`, `UPLOAD_NOT_FOUND`.

## Screens

1. **Campaigns** `/campaigns` (campaign readers; menu item "Campaigns") — tab **Campaigns**: table of name, client, platform icon and name, objective, status badge, funding badge ("client pays directly"), dates with "end date passed" badge, owner, budget, spent and budget used bar, results, cost per result, "no update for N days" badge. Filters: status (default planned, active, paused), client, platform, funding, owner, account manager; "My campaigns" toggle. "New campaign" for campaign managers. Empty: "No campaigns yet". Tab **Ad budgets**: clients with wallets: client, account manager, deposited, spent, balance (red when negative), threshold, "low" badge, last deposit; "Only low balances" filter; a row opens the client's Ads tab.
2. **Campaign dialog** (create and edit) — client (fixed when opened from a client), name, platform, objective, funding (wallet / client pays directly; disabled with the reason when locked), budget (USD), start and end dates, owner (user picker), link to a project or retainer of the client and to a task of the client (optional pickers), notes.
3. **Campaign page** `/campaigns/$campaignId` — header: name, client, status, platform, objective, funding, dates, owner, links (project or retainer, task). Cards: budget and budget used, spend, results, cost per result, reach (sum of periods), clicks; for wallet campaigns the client's wallet balance with a link to the Ads tab. Monthly totals table. Updates table (period, spend, reach, clicks, results, cost per result, note, entered by) with edit and archive. Actions by status: "Start" (dialog with the balance warning of rule 8), "Pause", "Resume", "Complete", "Reopen", "Cancel" (reason), "Edit", "Add update" (dialog: period with the default of rule 9, spend, reach, clicks, results labelled by objective, note; shows cost per result and the warnings of rule 13 before saving), "Archive" / "Restore". Readers without `campaigns.manage` see the page read-only.
4. **Client profile** (F02) — new **Ads** tab for campaign readers covering the client: wallet cards (deposited, refunded, spent, balance, threshold with "Edit" for campaign managers and "low" badge), "Record deposit" and "Refund" (fund holders), ledger (date, type, description: receipt number / campaign and period, amount and currency, USD, running balance, receipt PDF and proof links, void state, "Void" for fund holders), and the client's campaigns (as the list, without the client column) with "New campaign".
5. **Deposit / refund dialog** — date, amount, currency, rate (prefilled with the current rate and its date; stale warning after 7 days as F13), USD amount shown live, method, reference, note, proof upload; the balance after the entry; a refund above the balance is blocked in the form as well.
6. **Notifications** (F14) — `ad_budget_low` opens the client's Ads tab: "Ad budget of <client> is low: <balance> USD (threshold <threshold>)".

Loading, empty and error states follow the existing list and detail pages. What roles see differently: campaign managers act on campaigns and thresholds; fund holders record deposits and refunds; Finance reads everything and funds but does not edit campaigns; account managers see only their clients; everyone else sees no Campaigns menu and no Ads tab.

## Audit, notifications and jobs
- Audit (entities `ad_campaign`, `ad_campaign_update`, `ad_wallet`, `ad_wallet_entry`; every entry carries `clientId`): `ad_campaign.created`, `ad_campaign.updated` (before/after of changed fields), `ad_campaign.status_changed` (from, to, reason), `ad_campaign.archived` / `restored`; `ad_campaign_update.created`, `updated` (before/after), `archived` (each with campaign id, period and spend); `ad_wallet.threshold_changed` (before/after), `ad_wallet.low_balance` (balance, threshold) and `ad_wallet.low_balance_cleared`, written in the transaction of the change that crossed the threshold, with that change's actor; `ad_wallet_entry.recorded` (kind, number, amount, currency, rate, USD, balance after), `ad_wallet_entry.voided` (reason, balance after). Every `audit.read` holder (General Manager, Operations manager) also holds `campaigns.read` `all`, so entries are unfiltered.
- Notifications (F14 catalog): new type `ad_budget_low`, category `reminders`, subject `client`, can be muted; recipients and timing in rules 20–22. Reminder kind `ad_budget_low` for `remindOnce`.
- Jobs:
  - A new source `ad-budget-low` of `notifications.daily` (rule 21). `notifications:run-daily --date` runs it in development.
  - Receipt PDFs: a new kind `ad_deposit_receipt` rendered by the worker with the F13 document template and fallback font (Q11), through a `campaigns.pdf` queue and a `campaigns.pdf-ready` handler in the API that attaches the file (the `invoices.pdf` pattern), retry 3, idempotent per payload hash. A receipt still `pending` after its retries is queued again by "Render again" (rule 19); no daily re-queue.

## Edge cases
1. Two people add updates to one campaign at once with overlapping periods: the wallet row lock (wallet campaigns) or the campaign row lock (direct campaigns) orders them; the second gets `PERIOD_OVERLAP`.
2. Two refunds at once that together exceed the balance: the wallet row lock orders them; the second gets `REFUND_EXCEEDS_BALANCE`.
3. A deposit is voided after spend was entered against it: the balance may go negative and A11 fires if below the threshold.
4. An update on a wallet campaign is edited from 300 to 30 USD: the balance rises; if it crosses back above the threshold, `low_since` clears and reminders stop.
5. A client paid in SYP: the deposit stores the SYP amount, the rate and the USD amount; later rate changes never move the balance (ADR 0006).
6. The current rate was never set: deposits and refunds in either currency ask for a rate (`RATE_REQUIRED` when missing).
7. The client's account manager changes: the new one reads the wallet and campaigns at once and receives the next reminder; the old one loses access.
8. A campaign owner is archived: the campaign keeps the owner (shown as archived); editing requires picking an active owner (`INVALID_OWNER` only when the owner field changes to an inactive user).
9. An archived client: campaigns, wallet and receipts stay readable; no new campaigns or deposits; updates on its running campaigns and refunds remain allowed.
10. A campaign switches from `client_direct` to `wallet` before its first update: allowed; afterwards `FUNDING_LOCKED`.
11. A client with direct campaigns only never deposits: no wallet alerts (rule 20), and the Ad budgets tab does not list it.
12. An update period ends in a new month that crosses the boundary (28 Sep – 4 Oct): refused; the user enters two updates (28–30 Sep and 1–4 Oct).
13. The linked task is cancelled or archived: the campaign keeps the link, shown with the task's state; nothing else changes.
14. The worker is down when a deposit is recorded: the deposit and balance are saved, the receipt shows "being prepared" and "Render again".
15. Volume: ~20 clients, a few campaigns each, weekly updates: no special limits; ADR 0013 list rules apply.

## Open questions
- None blocks F12. Related, not blocking:
  - Q11: the receipt uses the fallback Arabic font until the Madani Arabic license and files arrive.
  - Q7: swap on the server before the Phase 3 deploy (one more PDF kind).

## Acceptance
- Owner check in the browser:
  1. As Finance, make sure the current rate is set (Invoice settings). Open a client's **Ads** tab: no wallet yet, balance 0, threshold 100 USD.
  2. Record a deposit of 500 USD by bank transfer with a reference and a proof: the balance is 500, receipt `AD-2026-0001` is ready as an Arabic RTL PDF stating it is an ad budget deposit. Record a second deposit in SYP: the USD amount follows the entered rate.
  3. As a Marketing member, create a Meta campaign for the client (objective messages, budget 600 USD, wallet funding, owner yourself, linked to the client's retainer and its "Ad campaign" task). Start it: the dialog warns if the budget exceeds the balance.
  4. Add a weekly update (spend 200, reach 15 000, clicks 900, results 45): cost per result 4.44 USD, budget used 33 %, the wallet balance drops by 200. Try an overlapping period and a period crossing a month: both refused.
  5. Add updates until the balance falls below 100 USD: the account manager and you (owner) get `ad_budget_low` once. Run the daily notifications job 7 days later: the reminder arrives once. Record a deposit that lifts the balance above 100: the next run sends nothing.
  6. Enter spend beyond the balance: a warning, then the balance shows negative in red.
  7. Create a second campaign with "client pays directly" and add an update: results show, the wallet does not change. Try to switch it to wallet funding: refused (`FUNDING_LOCKED`).
  8. Pause, resume, complete and reopen the first campaign; cancel a planned one with a reason, then archive it.
  9. As Finance, refund part of the balance; try to refund more than the balance: refused. Void the SYP deposit with a reason: it stays visible as void, its receipt number stays used, the balance drops.
  10. Open **Campaigns → Ad budgets**: the client with its balance and the low badge when low.
  11. As the account manager, manage the campaign and edit the threshold, but no deposit or refund actions; as another account manager, the campaign is not found; as a designer, no Campaigns menu and a 403 on the API; as Finance, read and fund but no campaign actions.
  12. Open the audit log and find each change above.
- Tests:
  - Unit (contracts): rule 23 functions (balance with void entries, archived updates, direct campaigns and archived campaigns; cost per result rounding and zero results; budget used; low balance with null threshold and no deposit; overlaps and month crossing at the edges), schemas (limits, dates, rate format, cancel reason), permission map changes (Marketing members and the Operations manager read and manage; Finance reads; `campaigns.fund` for the three holders; nobody else), the notification type, reminder kind and file owner type.
  - API (`apps/api/test/campaigns.test.ts`, `campaign-updates.test.ts`, `ad-wallets.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; an account manager on fund endpoints; Finance on manage endpoints; an employee anywhere); every error code above; rules 1–25; the wallet row lock under concurrent refunds and updates; receipt numbering per year with F13's counter; the A11 alert once per crossing, its clearing, and the daily source's weekly reminders and idempotency; the PDF ready handler attaching once; audit entries in the same transaction.
  - Worker: the receipt renders with Arabic text (a text extraction check) and is safe to run twice.
  - E2E: record a deposit, create and start a wallet campaign, add an update and see the balance drop.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): Campaigns list, Ad budgets tab, campaign dialog, campaign page with updates and monthly totals, add update dialog with warnings, client Ads tab with ledger, deposit dialog in SYP, one rendered receipt.
