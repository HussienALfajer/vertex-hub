# 0026 — Leads: a follow-up date on every open lead, quotes on leads, and conversion by the sales team
Status: Accepted · Date: 2026-10-04

## Context
F03 (`docs/specs/F03-leads.md`) adds the sales pipeline. ADR 0023 limited quotes to registered clients and left "quotes for leads and converting a won lead" to F03. F02 lets only the General Manager and the Operations manager create clients, choose their account manager and set the healthcare flag, while leads are worked by General Communication and Marketing members and by account managers (ADR 0014). A12 asks for a reminder when a lead goes "N days" without follow-up. The owner decided: quotes are written directly on a lead; whoever manages the lead converts it and chooses the account manager and the healthcare flag; every open lead has a mandatory next follow-up date, reminded on the day and escalated after two work days; a loss has a reason from a fixed list and can be reopened; losing a lead rejects its sent quotes; Quote sent is entered only by sending a quote; won leads can link to an existing client.

## Decision
- **A quote has a client or a lead.** `quotes.client_id` becomes nullable and `quotes.lead_id` is added (at least one set). Lead quotes are written by the General Manager, the Operations manager (who gains `leads.read` `all`) and the account manager who owns the lead: `own_clients` on quote and project permissions covers a lead quote through lead ownership. Sending one moves the lead to Quote sent. Accepting one converts the lead first, inside A01's transaction.
- **Conversion is the sales team's path to a new client.** A holder of `leads.manage` covering the lead creates the client (trade name, sector, healthcare flag, account manager) or links an existing one, without `clients.manage` scope all. The lead's contact, activity log and quotes are carried over in one transaction. Won is final.
- **Follow-up is a date, not an idle timer.** Every open lead has a next follow-up date; logging an activity sets a new one. A12 is two sources of the daily notifications job: due on the date (to the owner) and overdue after two full work days (to the owner and the managers of General Communication and Marketing), once per lead and date.
- **Losing closes the quotes.** A loss records a fixed reason and rejects the lead's sent and expired quotes with the mapped rejection reason; drafts stay but cannot be sent until the lead is reopened.
- **Modules.** A new `leads` module owns the lead tables, imports `clients` (a new `ClientFactory`), `catalog`, `auth`, `notifications` and `audit`, and exports `LeadDirectory`, `LeadPipeline` and `LeadClosedHooks`. `quotes` imports `leads` and registers its loss and conversion hooks; `leads` never imports `quotes`.

## Consequences
- F04's quote list, PDF snapshot, scope checks and accept dialog handle a lead recipient; after conversion a quote is an ordinary client quote.
- F02's rule that only scope-all managers create clients and set the healthcare flag has one exception: conversion. Healthcare clients get medical review from their first task.
- F01's user archive check gains `owner_of_open_leads`.
- F15 can report conversion, sources, loss reasons and time in stage from the stored stages, dates and reasons.
