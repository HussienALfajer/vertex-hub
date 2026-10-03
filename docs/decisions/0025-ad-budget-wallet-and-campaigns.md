# 0025 — Client ad budgets in a USD wallet apart from invoices; campaigns with manual periodic updates
Status: Accepted · Date: 2026-10-04

## Context
F12 (`docs/specs/F12-ad-campaigns.md`) tracks ad campaigns and the money clients pay for ads. Problem 8 of the V1 scope is that client ad budgets are mixed with agency fees; ADR 0006 says ad budgets are tracked separately, normally in USD, because ad platforms bill in USD. F13 (ADR 0024) already has invoices, payments, a current rate, document numbering and the PDF pipeline. Platform APIs are out of V1, so spend and results are typed in by hand. The owner decided: ad money is recorded as deposits of its own, not through invoices; one USD wallet per client; spend and results are entered as periodic updates per campaign; Marketing members, the client's account manager and management manage campaigns, while only Finance, the Operations manager and the General Manager record money; a campaign may be paid by the client directly to the platform; spend beyond the balance is accepted and shown as a negative balance; a low-balance alert per client threshold (default 100 USD) goes to the account manager and the active campaigns' owners, then weekly; campaigns have five statuses; links to work are optional and have no effect; deposits get numbered receipts and refunds to the client exist; only campaign managers and Finance read campaigns and wallets.

## Decision
- **The wallet is not an invoice.** A new `campaigns` module owns campaigns, updates, wallets and wallet entries (deposits and refunds). Wallet money never appears on invoices, statements or the F13 totals; agency fees for managing ads are invoiced as usual.
- **One USD wallet per client, balance computed.** Deposits and refunds keep their currency and rate and store a USD amount converted once with F13's `convertMinor`. The balance is deposits − refunds − the spend of updates on the client's wallet-funded campaigns, computed on read and allowed to go negative. Mistakes are voided with a reason, never deleted; spend updates are edited or archived.
- **Spend lives on periodic updates.** Each update covers a period inside one calendar month with spend (USD), reach, clicks and results; periods of a campaign never overlap, so monthly totals for F15 are exact. Cost per result is computed. A campaign's funding (`wallet` or `client_direct`) is fixed once it has updates.
- **Separate money permission.** New `campaigns.fund` (General Manager, Finance, Operations manager) records deposits and refunds; `campaigns.manage` (Marketing members, Operations manager, General Manager, account managers for their clients) runs campaigns and thresholds; Finance gains `campaigns.read`.
- **Reuse F13 infrastructure.** Deposit receipts take numbers from F13's `document_numbers` (kind `ad_deposit`, `AD-<year>-<n>`) through an `invoices` export, the rate default from the invoice settings, and the worker's PDF template through a `campaigns.pdf` queue.
- **A11 on the change, reminders daily.** Each balance change locks the client's wallet row and sets or clears a `low_since` marker, alerting once on crossing below the threshold; a `notifications.daily` source repeats the alert every 7 days while it stays low.

## Consequences
- F15's monthly client report reads campaign updates by month and their optional project, retainer and task links; the retainer `ad_campaign` deliverable still counts delivered tasks, unaffected by campaign status.
- No ad money flows through invoices, so the invoiced vs collected reports stay agency revenue only.
- A future Meta/Google Ads integration can write updates through the same rules (one period per month, no overlap) instead of hand entry.
- The worker renders one more document kind; Q7 (swap) matters before the Phase 3 deploy.
