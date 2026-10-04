# TASKS — F12 Ad campaigns and ad budget (with A11)

Spec: `docs/specs/F12-ad-campaigns.md` · ADRs 0006, 0007, 0008, 0013, 0014, 0018, 0019, 0024, 0025 · Four PRs, each leaves `main` green and fully wired.

## PR 1 — `feat/f12-campaigns-api`: campaigns and updates
- [x] contracts: `campaigns.ts` (enums platform, objective, status, funding; campaign create / update / status / list query and page; detail with links, totals, monthly totals, updates and `permissions`; update input; rule 23 functions `costPerResult`, `budgetUsed`, `periodsOverlap`, `periodInOneMonth`, status transitions) with unit tests; permissions (`campaigns.read` / `manage` for Marketing members and the Operations manager, `campaigns.read` for Finance, new `campaigns.fund`) with tests; error codes `INVALID_OWNER`, `INVALID_ENGAGEMENT`, `FUNDING_LOCKED`, `CAMPAIGN_HAS_UPDATES`, `PERIOD_CROSSES_MONTH`, `PERIOD_OVERLAP`; audit actions and entity types `ad_campaign`, `ad_campaign_update`; `ar.json` keys (errors, audit actions, entity types, fields)
- [x] db (`/db-migration`, 0033): enums `ad_platform`, `ad_objective`, `ad_campaign_status`, `ad_funding`; `ad_campaigns` (checks: one engagement, cancel reason), `ad_campaign_updates`; `TABLE_OWNERS`; drift
- [x] api `tasks`: `TaskLinks` read export (`projects`' `EngagementDirectory` already has the project and retainer summaries)
- [x] api `campaigns` module: list (scopes, filters, sort, badges), create (rules 1–4), detail, `PUT` (rules 5–6, `CONCURRENT_CHANGE`), status (state machine, cancel reason), archive / restore (rule 7), updates add / edit / archive (rules 9–11, campaign row lock); audit; `app.module.ts`; `docs/architecture.md`
- [x] api tests: `test/campaigns.test.ts`, `test/campaign-updates.test.ts` (shared `campaign-cast.ts`); `removeCampaigns` in `removeClients`; edit and archive of updates stay open on cancelled campaigns (permission flags `canAddUpdate` / `canEditUpdates`)
- [x] bridge: build, `openapi:export`, `api:generate`; web typecheck
- [x] wiring checklist, full checks (lint, typecheck, build, test, drift pass), reviewer (one finding fixed: missing 401 / 403 / out-of-scope tests on PUT, status, archive, restore and update archive), owner acceptance (approved, incl. editing updates of cancelled campaigns), dev database migrated, /ship

## PR 2 — `feat/f12-ad-wallet-api`: wallet, deposits, refunds and A11
- [ ] contracts: wallet entry kind; `adWalletBalance`, `isLowBalance` with unit tests; wallet, ledger, entry, record / void, threshold, wallet list schemas; `REFUND_EXCEEDS_BALANCE`; audit `ad_wallet.*`, `ad_wallet_entry.*`; notification type `ad_budget_low` (subject `client`) and reminder kind, `notification-content.ts`; file owner type `ad_wallet_entry`; document number kind `ad_deposit`; `ar.json` keys
- [ ] db (`/db-migration`): `ad_wallets`, `ad_wallet_entries` (checks: number for deposits only, void fields together); `document_number_kind` + `ad_deposit`; `file_owner_type` + `ad_wallet_entry` and `file_items.ad_wallet_entry_id`; notification enums; drift
- [ ] api `invoices`: export `DocumentNumbers` and the current rate; `files`: `ad_wallet_entry` owner policy (hidden from the client library)
- [ ] api `campaigns`: wallet read / threshold, record entry (rules 16–17, proof), void (rule 18), wallet list; wallet row lock on every balance change (updates, funding change, archive / restore); campaign detail gains the wallet balance; A11 crossing (rule 20) and the `ad-budget-low` daily source (rules 21–22)
- [ ] api tests: `test/ad-wallets.test.ts` (balance, concurrent refunds and updates, numbering, A11 once per crossing, clearing, weekly reminders, idempotency)
- [ ] bridge; web typecheck
- [ ] wiring checklist, full checks (+ drift), reviewer, owner acceptance, /ship

## PR 3 — `feat/f12-ad-receipts-pdf`: deposit receipt PDFs
- [ ] contracts: jobs `campaigns.pdf`, `campaigns.pdf-ready`, kind `ad_deposit_receipt`, `adDepositReceiptSnapshotSchema`; entry `receiptPdf` state
- [ ] db (`/db-migration`): `receipt_snapshot`, `receipt_pdf_status`, `receipt_file_item_id` on `ad_wallet_entries` (first use here); drift
- [ ] worker: Arabic RTL receipt template (F13 document styles), idempotent per payload hash; worker test with text extraction
- [ ] api: snapshot and queue on deposit, ready handler attaching once, receipt archived on void, `POST` / `GET` receipt endpoints; `test/ad-receipts.test.ts`
- [ ] bridge; web typecheck
- [ ] wiring checklist, full checks (+ drift), reviewer, owner acceptance, /ship

## PR 4 — `feat/f12-web`: campaign, wallet and Ads screens
- [ ] web `features/campaigns/`: Campaigns page (Campaigns and Ad budgets tabs), campaign dialog, campaign page (cards, monthly totals, updates, status actions with dialogs, start warning), add / edit update dialog with warnings; client Ads tab (wallet cards, threshold edit, ledger, campaigns, new campaign), deposit / refund dialog (SYP rate, live USD, balance after, proof), void dialog, receipt links; `ad_budget_low` notification opens the Ads tab; routes; nav item; `ar.json` `campaigns` namespace; loading, empty, error states
- [ ] e2e: fixtures, `f12.spec.ts` (deposit, wallet campaign, start, update, balance drops; role differences), screenshots light + dark (Campaigns list, Ad budgets, campaign dialog, campaign page, update dialog with warnings, client Ads tab, deposit dialog in SYP)
- [ ] wiring checklist, full checks (+ E2E), reviewer, owner acceptance, /ship; `docs/ROADMAP.md`
