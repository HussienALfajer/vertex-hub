# F03 — Leads (sales pipeline)

Status: Approved · Date: 2026-10-04 · Scope: `docs/product/v1-scope.md` §F03 (and automation A12) · ADRs: 0006, 0007, 0013, 0014, 0018, 0023, 0026

## Summary
Inquiries arrive on Instagram, WhatsApp, by phone and through referrals, and live in people's chats: nobody knows how many are open, who answers each one, when the next call is due, or why a deal was lost. F03 adds **leads**: a record per inquiry (who, how to reach them, where they came from, what they want, a rough budget), a **Kanban pipeline** New → Contacted → Meeting → Quote sent → Won / Lost (with a loss reason), an **owner** and a mandatory **next follow-up date** on every open lead, an **activity log** (calls, meetings, WhatsApp…), **quotes written directly on a lead** (F04 quotes, without creating a client first), and a one-click **conversion** of a won lead into a client (or a link to an existing one) that carries the contact, sector, healthcare flag, activity log and quotes over without re-entering anything. Accepting a lead's quote converts the lead in the same step. **A12** reminds the owner on the follow-up date and escalates to the sales managers when it passes by two work days.

## In scope / out of scope
- In:
  - Leads: create, edit, change owner, move between stages, lose (with reason) and reopen, archive and restore (junk and duplicates).
  - Lead fields: contact name, company name, phone, email, social handle, source (fixed list) with a detail, requested services and packages from the catalog, a free description of the request, a rough budget (amount and currency), sector, healthcare flag, owner, next follow-up date.
  - Duplicate warning (not a block) against open leads and clients when creating or editing.
  - Activity log on the lead: date and time, channel, summary; logging an activity on an open lead sets the next follow-up date.
  - Quotes on leads: F04 quotes whose recipient is a lead instead of a client; sending one moves the lead to **Quote sent**; losing the lead rejects its sent and expired quotes.
  - Conversion: a new client created from the lead (trade name, sector, healthcare flag, account manager, contact) or a link to an existing client; the activity log is copied into the client's communication log and the lead's quotes move to the client. From the lead page, or as step 0 of the accept dialog of a lead's quote (A01).
  - **A12:** follow-up due and overdue reminders, sources of the daily notifications job (F14).
  - Screens: Leads board and list, lead dialog, lead page, convert, lose and reopen dialogs; changes to the quote screens (lead as recipient, accept step 0) and a "Converted from lead" line on the client profile.
- Out (later or never):
  - Pulling messages from WhatsApp or Instagram, web forms feeding leads, lead scoring (v1-scope).
  - Leads for existing clients (upsell): the account manager writes a quote for the client directly (owner decision). A returning former client is handled by linking at conversion.
  - Calendar meetings with leads (F11 meetings take client contacts only); the Meeting stage is a stage, not a calendar event.
  - Conversion, source and loss-reason reports: F15 reads the stored stages, sources, reasons and dates.
  - Email reminders: Phase 4 (Q5).

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- New department capability: the Internal Operations **manager** gets `leads.read` (`all`), read only (owner decision), so they can find leads and write quotes on them.
- Unchanged: General Manager everything; General Communication and Marketing **members** `leads.read` and `leads.manage` (`all`); Account Manager `leads.read` and `leads.manage` (`assigned`: the leads they own).
- **Quote scope on lead quotes.** For a quote whose recipient is a lead (no client yet), `quotes.read`, `quotes.manage` and `projects.manage` with scope `own_clients` cover the quote when the caller **owns the lead**. Scope `all` covers every lead quote. After conversion the quote is a client quote and F04's rules apply unchanged (owner decision: quotes on leads are written by the General Manager, the Operations manager and the account manager who owns the lead; members of General Communication and Marketing see them on the lead page without amounts).
- **Creating a client by conversion.** Converting needs `leads.manage` covering the lead (or, in the accept dialog, the quote permissions above), not `clients.manage` with scope all: conversion is the sanctioned path for the sales team to create a client, choose its account manager and set its healthcare flag (owner decision). Every other F02 action keeps its F02 permission.

"Lead managers" below means holders of `leads.manage` covering the lead. "Sales managers" means the managers of the General Communication and Marketing departments.

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| See the board and list, open a lead (details, activity log, quote summaries) | `leads.read` | General Manager, Operations manager, General Communication and Marketing members: all · Account Manager: assigned |
| Create a lead | `leads.manage` | General Manager, General Communication and Marketing members: any owner · Account Manager: owner is themselves |
| Edit a lead, move it between New, Contacted and Meeting, set the next follow-up date | `leads.manage` | General Manager, General Communication and Marketing members: all · Account Manager: assigned |
| Change the owner | `leads.manage` | as above; an account manager can hand over a lead they own |
| Log, edit and archive activities | `leads.manage` | as above; editing a note: its author; archiving: its author or `leads.manage` scope all |
| Lose, reopen, convert | `leads.manage` | as above |
| Archive and restore a lead; see archived leads | `leads.manage` (scope all) | General Manager, General Communication and Marketing members |
| Create, edit, send and record responses on a lead's quote | `quotes.manage` | General Manager, Operations manager: all · Account Manager: the leads they own |
| Accept a lead's quote (converts the lead) | `quotes.manage` + `projects.manage` | General Manager, Operations manager: all · Account Manager: the leads they own (and, when linking an existing client, `projects.manage` covering that client) |
| See a lead's quotes with amounts | `quotes.read` | General Manager, Operations manager, Finance: all · Account Manager: the leads they own |

## Data

Module ownership: a new `leads` module (already listed in `docs/architecture.md`) owns `leads`, `lead_interests` and `lead_notes`. It imports `clients` (`ClientDirectory` for duplicates and the existing-client link, and a new exported `ClientFactory` that creates a client with its contact and copies notes into the communication log, inside the caller's transaction, with F02's rules, audit and `client_account_manager_assigned`), `catalog` (`CatalogDirectory`: names and archived state of services and packages), `auth` (`UserDirectory`), `notifications` (`NotificationCenter`, `DailyReminders`) and `audit`; it registers the lead owner check in `ResponsibilityRegistry`. It exports `LeadDirectory` (summary, display name, stage, owner, scope check, SQL filter over a lead-id column), `LeadPipeline` (moves an open lead to Quote sent; converts a lead inside the caller's transaction) and `LeadClosedHooks` (called inside the transaction that loses or converts a lead). `quotes` imports `leads` and registers into `LeadClosedHooks` (reject on loss, move quotes to the client on conversion); `leads` never imports `quotes` (the architecture test checks it).

Money: the budget is integer minor units with its currency (`USD` or `SYP`, ADR 0006); no conversion. Dates without a time are calendar days in Asia/Damascus.

### Enums (in `packages/contracts/src/leads.ts`)
- `lead_stage`: `new`, `contacted`, `meeting`, `quote_sent`, `won`, `lost`. Open stages: the first four.
- `lead_source`: `instagram`, `facebook`, `tiktok`, `whatsapp`, `website`, `referral`, `paid_ad`, `event`, `walk_in`, `other`.
- `lead_loss_reason`: `price`, `timing`, `competitor`, `not_a_fit`, `no_response`, `other`. Mapped to F04's quote rejection reasons when a loss rejects quotes: same name, and `not_a_fit` → `scope`.

### `leads` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `contact_name` | text | required, trimmed, 1–120 chars |
| `company_name` | text | optional, trimmed, 1–120 chars. **Display name** = company name, else contact name |
| `phone` | text | optional; `+` and 8–15 digits (as F02 contacts); indexed |
| `email` | text | optional; valid email, stored lower-case; indexed |
| `social_handle` | text | optional, trimmed, 1–120 chars (e.g. `@name` or a profile link) |
| — | check | at least one of `phone`, `email`, `social_handle` (`CONTACT_REQUIRED`) |
| `source` | enum `lead_source` | required |
| `source_detail` | text | optional, 1–120 chars (who referred, which ad or event); required for `other` (`NOTE_REQUIRED`) |
| `request` | text | optional, 1–2000 chars: what they asked for, in their words |
| `budget_minor` | bigint | optional, > 0 |
| `budget_currency` | enum `currency` | set together with `budget_minor` (check: both or neither) |
| `sector` | text | optional, 1–60 chars; suggestions from clients' sectors in use (F02) |
| `is_healthcare` | boolean | required, default false; copied to the client on conversion |
| `stage` | enum `lead_stage` | required, default `new`; indexed |
| `stage_changed_at` | timestamptz | required; set on every stage change (cards show days in stage) |
| `owner_id` | uuid → `users.id` | required; indexed |
| `next_follow_up_on` | date | required while the stage is open, null when `won` or `lost` (check constraint); indexed |
| `lost_reason` | enum `lead_loss_reason` | set only while `lost` (check) |
| `lost_note` | text | optional, 1–500 chars; required for `other` |
| `closed_at` | timestamptz | set on win and loss, cleared on reopen; indexed (board's last 30 days) |
| `client_id` | uuid → `clients.id` | set on win (created or linked client), null otherwise (check: set iff `won`); indexed |
| `converted_by_id` | uuid → `users.id` | set on win |
| `created_by_id` | uuid → `users.id` | required |
| `created_at`, `updated_at` | timestamptz | `timestamps()`; `updated_at` is the stale-write token |
| `archived_at` | timestamptz | `archivedAt()`: a junk or duplicate lead, hidden from the board, the list and reminders |

### `lead_interests` (business table: requested services and packages)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `lead_id` | uuid → `leads.id` | required, indexed |
| `service_id` | uuid → `catalog_services.id` | set for a service |
| `package_id` | uuid → `catalog_packages.id` | set for a package |
| — | check, unique | exactly one of `service_id`, `package_id`; unique per lead (partial unique indexes); at most 10 per lead (`LIMIT_REACHED`) |
Replaced as a whole on edit. A new interest must be non-archived (`CATALOG_ITEM_ARCHIVED`); one archived later stays, shown as archived.

### `lead_notes` (business table: the activity log)
Same shape as F02's `client_notes`: `id`, `lead_id` (indexed), `author_id`, `occurred_at` (default now, not in the future), `channel` (`note_channel`: call, meeting, whatsapp, email, other), `summary` (required, 1–2000 chars), `timestamps()`, `archived_at`. Notes stay on the lead after conversion; copies go to the client.

### Changes to other modules
- **`quotes`** (F04): `client_id` becomes nullable; new `lead_id` uuid → `leads.id`, nullable, indexed; check `client_id is not null or lead_id is not null`. A lead quote has `client_id` null and `contact_id` null until conversion, which sets `client_id` (and `contact_id` to the added contact where null); `lead_id` stays for history. The snapshot's recipient for a lead quote is the lead's display name and contact name.
- **`notifications`** (F14): types `lead_assigned`, `lead_won`, `lead_follow_up_due`, `lead_follow_up_overdue`; subject `lead`; reminder kinds `lead_follow_up_due`, `lead_follow_up_overdue` (`notification_reminders`, occurrence = the follow-up date).
- **`auth`** (F01): responsibility type `owner_of_open_leads` (blocks archiving the user).
- **`clients`** (F02): exported `ClientFactory` (above) and a `ClientDirectory` lookup of non-archived clients by trade name, contact phone or contact email for duplicates.

## States and rules

### Lead stage
```
new ⇄ contacted ⇄ meeting          (manual, any direction among the three)
new | contacted | meeting ──a quote of the lead is sent──→ quote_sent
quote_sent ──manual, no quote in `sent`──→ contacted | meeting
any open stage ──convert (or accept a lead quote)──→ won      (final)
any open stage ──lose (reason)──→ lost ──reopen (follow-up date)──→ new | contacted
```

### Leads
1. A lead is created by a lead manager with an owner, a source, the contact name, one contact method and a next follow-up date. The owner must be an active user holding `leads.manage` (General Manager, General Communication or Marketing member, account manager) (`INVALID_LEAD_OWNER`); an account manager without scope all can only own leads themselves.
2. **Duplicates** (warning only): on create and edit the dialog shows open, non-archived leads with the same phone or email, and non-archived clients whose trade name equals the company or contact name (case-insensitive) or whose contact has the same phone or email. Saving is never blocked. A match the caller cannot read shows its display name, owner and stage only.
3. **Next follow-up date**: required on every open lead, from today to today + 180 days (`INVALID_DATES`). The UI defaults it to the next work day (Saturday–Thursday).
4. **Logging an activity** on an open lead requires a new next follow-up date in the same request (owner decision); on a won or lost lead it is refused (`LEAD_CLOSED`: notes after a win go to the client's log).
5. **Manual moves** are allowed among `new`, `contacted` and `meeting` in any direction. `quote_sent` is entered only by sending a quote of the lead (rule 14, owner decision); leaving it manually for `contacted` or `meeting` is allowed only when the lead has no quote in `sent` (`LEAD_HAS_SENT_QUOTE`). Moving to `won` or `lost` uses rules 8–11 (`INVALID_TRANSITION` otherwise).
6. **Owner change**: to another eligible owner (rule 1). The new owner gets `lead_assigned` unless they made the change.
7. **Edit**: every field of rule 1 and the data table except stage, owner and closing fields, on open leads only (`LEAD_CLOSED`). The request carries `updatedAt`; a stale one is refused (`STALE_LEAD`).
8. **Lose**: from any open stage, with a reason and a note (required for `other`). In the same transaction every latest-version quote of the lead in `sent` or `expired` is recorded as rejected (F04 rule 11) with the mapped reason, the loss note, today as the response date and the caller as responder, regardless of the caller's quote permissions (owner decision). Drafts stay as they are and cannot be sent while the lead is lost. The next follow-up date is cleared.
9. **Reopen** a lost lead to `new` or `contacted` with a next follow-up date; the reason and note are cleared (the audit keeps them). Rejected quotes stay rejected. The reopened lead needs an eligible owner (rule 1, `INVALID_LEAD_OWNER`); the request may name a new one, who gets `lead_assigned` (owner decision: the way back for a lost lead whose owner was archived since).
10. **Convert** from any open stage, in one transaction (owner decision), in one of two modes:
    - **New client**: trade name (default: the display name; F02 uniqueness, `CLIENT_NAME_TAKEN`), sector and healthcare flag (default: the lead's), account manager (default: the owner when they hold the Account Manager role, otherwise chosen; `INVALID_ACCOUNT_MANAGER`), status `active`, and a contact from the lead (name, phone, email, optional job title, final approval on by default).
    - **Existing client**: a non-archived client (`CLIENT_ARCHIVED`); an `ended` client becomes `active` (F02 status change, audited). Adding the lead's contact is optional; it defaults to on unless a contact of the client has the same phone or email. The client's account manager and healthcare flag are unchanged.
    Then: every non-archived lead note is copied into the client's communication log (same author, time, channel and summary; the contact is the added one when there is one); every quote of the lead gets the client (and the added contact as addressee where it has none); the lead becomes `won` with `client_id`, `closed_at`, `converted_by_id`, and its next follow-up date is cleared. Won is final: the lead becomes read-only.
11. **Accepting a lead's quote** (F04 A01) runs rule 10 first, as step 0 of the accept dialog, inside the acceptance transaction; everything after it works on the client. Any refusal rolls back the conversion too. Renewing a retainer is offered only when step 0 links an existing client (F04 A5).
12. **Archive** (junk, spam, duplicates): an open or lost lead with no non-archived quote (`LEAD_HAS_QUOTES`: discard the drafts or lose the lead instead); won leads are never archived. Archived leads are read-only, hidden from the board, list (unless the "Archived" filter) and reminders. **Restore** returns the lead to its stage; an open lead whose follow-up date has passed is reminded by the next daily run.
13. Every change writes an audit entry in the same transaction (ADR 0013).

### Quotes on leads (F04 changes)
14. A quote is created for exactly one of a client or a lead (400 otherwise). A lead quote needs an open, non-archived lead (`LEAD_CLOSED`, `LEAD_ARCHIVED`), at create, send and accept. **Sending** it moves the lead from `new`, `contacted` or `meeting` to `quote_sent` (audited as a lead stage change by the sender); a lead already in `quote_sent` stays.
15. Recording a rejection or an expiry of a lead quote does not move the lead; the owner decides (lose, or back to Meeting under rule 5).
16. Versions of a lead quote keep the lead. The quote list, search and the `accountManagerId` filter treat the lead's display name as the client name and its owner as the account manager, with a "Lead" badge.
17. After conversion the quote is a client quote; its PDF of an already sent version is not re-rendered (it shows the lead's name, as sent).

### A12 — follow-up reminders (sources of `notifications.daily`, F14 rule 8)
18. **Due**: on work day D, every open, non-archived lead whose next follow-up date is after the previous work day and on or before D (so a Friday date is reminded on Saturday) gets `lead_follow_up_due` to its owner, once per `(lead, date)`. A date set to today after the day's run gets no due reminder for that date.
19. **Overdue**: on work day D, every open, non-archived lead whose next follow-up date is on or before the second work day before D (two full work days passed without a new date) gets `lead_follow_up_overdue` to its owner and the sales managers, de-duplicated, once per `(lead, date)` (owner decision).
20. Setting a new date (an edit, an activity, a reopen) starts the cycle again for that date. Both types require action and cannot be muted.

## API

All routes need a session; permissions as in "Roles and access". Lists follow ADR 0013 (paging, `sort`, `order`). New error codes: `CONTACT_REQUIRED`, `INVALID_LEAD_OWNER`, `STALE_LEAD`, `LEAD_CLOSED`, `LEAD_ARCHIVED`, `LEAD_HAS_SENT_QUOTE`, `LEAD_HAS_QUOTES`.

### Leads
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/leads` | `leads.read` | `leadListQuerySchema`: `search` (names, phone, email), `stage[]` (default open stages), `ownerId`, `source[]`, `followUp` (`overdue`, `today`, `week`), `clientId`, `archived` (scope all), `sort` (`nextFollowUpOn` default, `createdAt`, `updatedAt`, `stageChangedAt`), `order` | `leadPageSchema`: id, display name, contact name, company, source, stage, days in stage, owner, next follow-up (with `overdue` and `dueToday` flags), budget, interests (names), client (when won) | — |
| `GET /api/leads/board` | `leads.read` | `leadBoardQuerySchema`: `search`, `ownerId`, `source[]`, `followUp` | `leadBoardSchema`: one column per stage with its cards (as the list items) and count; `won` and `lost` hold leads closed in the last 30 days; at most 200 cards per column with `truncated` | — |
| `GET /api/leads/:id` | `leads.read` | — | `leadDetailSchema`: every field, interests (with archived marks), owner, creator, client link, notes (newest first), `permissions` (edit, move, lose, reopen, convert, archive, newQuote) | 404 |
| `POST /api/leads` | `leads.manage` | `createLeadSchema`: the fields of rule 1 and the data table, `interests[]` (`serviceId` or `packageId`), `ownerId` | `leadDetailSchema` | 403, `CONTACT_REQUIRED`, `INVALID_LEAD_OWNER`, `INVALID_DATES`, `CATALOG_ITEM_ARCHIVED`, `NOTE_REQUIRED`, `LIMIT_REACHED` |
| `PATCH /api/leads/:id` | `leads.manage` | `updateLeadSchema`: `updatedAt` and any field of create except owner | `leadDetailSchema` | 403, 404, `STALE_LEAD`, `LEAD_CLOSED`, `LEAD_ARCHIVED`, and the create codes |
| `POST /api/leads/duplicates` | `leads.read` | `leadDuplicateQuerySchema`: `phone`, `email`, `names[]`, `excludeLeadId` (in the body, so personal data stays out of URLs) | `leadDuplicatesSchema`: leads (id, display name, owner, stage, `readable`), clients (id, trade name, status, account manager) | — |
| `POST /api/leads/:id/stage` | `leads.manage` | `{ stage: 'new' \| 'contacted' \| 'meeting', nextFollowUpOn? }` | `leadDetailSchema` | 403, 404, `INVALID_TRANSITION`, `LEAD_HAS_SENT_QUOTE`, `LEAD_ARCHIVED`, `INVALID_DATES` |
| `POST /api/leads/:id/owner` | `leads.manage` | `{ ownerId }` | `leadDetailSchema` | 403, 404, `INVALID_LEAD_OWNER`, `LEAD_CLOSED`, `LEAD_ARCHIVED` |
| `POST /api/leads/:id/lose` | `leads.manage` | `{ reason, note }` | `leadDetailSchema` + `rejectedQuotes` (numbers) | 403, 404, `INVALID_TRANSITION`, `NOTE_REQUIRED`, `LEAD_ARCHIVED` |
| `POST /api/leads/:id/reopen` | `leads.manage` | `{ stage: 'new' \| 'contacted', nextFollowUpOn, ownerId? }` | `leadDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES`, `LEAD_ARCHIVED`, `INVALID_LEAD_OWNER` |
| `GET /api/leads/:id/conversion-plan` | `leads.manage` | `?clientId` (existing mode) | `leadConversionPlanSchema`: defaults (trade name, sector, healthcare, account manager or null, contact), eligible account managers, duplicate clients (suggested links), counts of notes and quotes that move, whether the existing client already has the contact | 403, 404, `INVALID_TRANSITION`, `CLIENT_ARCHIVED` |
| `POST /api/leads/:id/convert` | `leads.manage` | `convertLeadSchema`: `mode` `new` \| `existing`; new: `client` { tradeName, sector, isHealthcare, accountManagerId }; existing: `clientId`; `contact` { add, name, jobTitle, phone, email, hasFinalApproval } | `leadDetailSchema` (with the client link) | 403, 404, 400, `INVALID_TRANSITION`, `LEAD_ARCHIVED`, `CLIENT_NAME_TAKEN`, `INVALID_ACCOUNT_MANAGER`, `CLIENT_ARCHIVED`, and F02's contact codes |
| `POST /api/leads/:id/archive` / `restore` | `leads.manage` (scope all) | — | 204 | 403, 404, `INVALID_TRANSITION` (won), `LEAD_HAS_QUOTES` |
| `POST /api/leads/:id/notes` | `leads.manage` | `createLeadNoteSchema`: `occurredAt`, `channel`, `summary`, `nextFollowUpOn` (required on open leads) | `leadNoteSchema` | 403, 404, `LEAD_CLOSED`, `LEAD_ARCHIVED`, `INVALID_DATES` |
| `PATCH /api/leads/:id/notes/:noteId` | `leads.manage` (author) | `updateLeadNoteSchema`: `occurredAt`, `channel`, `summary` | `leadNoteSchema` | 403, 404, `LEAD_CLOSED` |
| `POST /api/leads/:id/notes/:noteId/archive` | `leads.manage` (author or scope all) | — | 204 | 403, 404, `LEAD_CLOSED` |
| `GET /api/leads/owners` | `leads.manage` | — | eligible owners (rule 1): id, name, departments | — |

### Quotes (F04 changes, in the `quotes` module)
| Method and path | Change |
|---|---|
| `POST /api/quotes` | `createQuoteSchema`: `clientId` or `leadId` (exactly one); `contactId` only with a client. New codes `LEAD_CLOSED`, `LEAD_ARCHIVED`. |
| `GET /api/quotes` | New filter `leadId`; items carry `recipient` { kind `client` \| `lead`, id, name } and the lead owner as account manager. |
| `GET /api/quotes/:id` | Adds `lead` (id, display name, stage) when set. |
| `POST /api/quotes/:id/send` | Rule 14 (lead stage) and its codes. |
| `GET /api/quotes/:id/accept-plan` | For a lead quote: `?clientId` for the existing-client mode; returns the conversion plan (as `GET /api/leads/:id/conversion-plan`) and renewable retainers only for an existing client. |
| `POST /api/quotes/:id/accept` | `acceptQuoteSchema` gains `conversion` (the body of `convertLeadSchema`), required for a lead quote and refused for a client quote (400); the response contact may be omitted (the added contact is recorded). Adds the convert codes. |
| `GET /api/quotes/by-lead/:leadId` | `leads.read` covering the lead: the lead's quotes (latest versions and their versions): number, version, title, status, sent and valid-until dates; nets only when `quotes.read` covers the quote. 404 when the lead is not readable. |

## Screens

All screens: Arabic RTL, strings through i18next (`leads.*`), Latin digits, money with its currency, dates in Asia/Damascus, loading (skeletons), empty and error (inline with retry) states. Navigation: "Leads" for `leads.read` holders.

1. **Leads** `/leads` — toggle **Board** (default) / **List**, remembered per user in local storage.
   - Board: columns New, Contacted, Meeting, Quote sent, Won (last 30 days), Lost (last 30 days), each with its count. A card: display name, contact name, source icon, interests (first two, "+n"), budget, owner avatar, next follow-up (red when overdue, amber today), days in stage, "Lead" quote count. Drag and drop follows rule 5: between New, Contacted and Meeting directly; out of Quote sent only without a sent quote (otherwise the card snaps back with the reason); onto Won opens the convert dialog; onto Lost opens the lose dialog; Quote sent is not a drop target. Drag has a keyboard and menu alternative ("Move to…") on each card. On phones the board becomes stage tabs with a card list.
   - List: table of the list fields, sortable, paged (20).
   - Filters (both views): search, owner ("Mine" is the default for account managers; "All" for others), source, follow-up (overdue, today, this week); "Archived" for scope-all managers. "New lead" for lead managers.
   - Empty: "No leads yet" with "New lead"; per filter: "No leads match".
2. **Lead dialog** (create and edit) — contact name, company name, phone, email, social handle, source and its detail, interests (catalog picker of services and packages), request, budget and currency, sector (suggestions), healthcare switch, owner (create; default the caller when eligible), next follow-up (default next work day). A live duplicate panel (debounced, rule 2) lists matches with links where readable. Save errors stay on the dialog.
3. **Lead page** `/leads/$leadId` — header: display name, stage stepper, owner, source, next follow-up with "Set date"; actions by permission and stage: Edit, Move to…, Log activity, New quote, Convert to client, Mark lost, Reopen, Change owner, Archive / Restore. Sections: contact details (tap to call, WhatsApp link, email), request and interests, budget, sector and healthcare; **Activity** (notes newest first, channel icon, author, time; "Log activity" dialog with the required next follow-up date; edit or archive own notes); **Quotes** (from `GET /api/quotes/by-lead`: number and version, title, status, sent and valid-until; nets when allowed; "New quote" for quote managers opens the F04 dialog with the lead preselected). Won: a banner "Converted to <client>" with the link, page read-only. Lost: a banner with reason, note and "Reopen". Archived: a banner with "Restore".
4. **Convert dialog** — tabs **New client** / **Existing client** (a client picker with duplicate suggestions on top). New: trade name, sector, healthcare switch (with the hint that it turns on medical review), account manager picker. Contact block (add switch, name, job title, phone, email, final approval). Summary: "n activities are copied to the client's log; n quotes move to the client". "Convert" lands on the client's profile.
5. **Lose dialog** — reason, note (required for "Other"); when quotes will be rejected, a warning lists them by number. **Reopen dialog** — stage (New or Contacted) and next follow-up date.
6. **Quote screens** (F04) — the new quote dialog gets "For: Client / Lead" with a picker of open leads in scope; the list and quote page show the lead name with a "Lead" badge and a link to the lead; the accept dialog of a lead quote starts with step 0 **Client** (the convert dialog's fields) before F04's steps, and its summary names the client to be created or linked.
7. **Client profile** (F02) — "Converted from lead <name> on <date>" in the header for `leads.read` holders (from `GET /api/leads?clientId=`).

What roles see differently: account managers see and act on the leads they own only; members of General Communication and Marketing see every lead and its quotes without amounts, and cannot write quotes; the Operations manager reads every lead and writes quotes on them, with no lead actions; Finance sees lead quotes in the quote list only; everyone else sees no Leads entry.

## Audit, notifications and jobs
- Audit (entity `lead`, entries carry the lead id and display name): `lead.created`, `lead.updated` (changed fields, before/after), `lead.stage_changed` (from, to; by a quote send it names the quote), `lead.owner_changed`, `lead.follow_up_changed` (when only the date changes, including through an activity), `lead.lost` (reason, note, rejected quote ids), `lead.reopened`, `lead.converted` (mode, client id), `lead.archived`, `lead.restored`; `lead_note.created` / `updated` / `archived`. The conversion's client, contact, status and copied notes write F02's entries, and the quote rejections and client moves write `quote.rejected` and `quote.updated` (client set), all in the same transaction. Every `audit.read` holder also holds `leads.read` scope all, so entries are unfiltered.
- Notifications (F14 catalog, subject `lead`):
  - `lead_assigned` → the new owner when someone else creates the lead for them or changes the owner (category `clients_projects`, action required, cannot be muted).
  - `lead_won` → the owner and, for an existing client, its account manager, except the actor and anyone who got `client_account_manager_assigned` for the same conversion (category `clients_projects`, informational, can be muted).
  - `lead_follow_up_due` → owner (rule 18) and `lead_follow_up_overdue` → owner and sales managers (rule 19) (category `reminders`, action required, cannot be muted). Both have no actor.
- Jobs: no new queue. `leads` registers two sources in `DailyReminders`, run by `notifications.daily` (09:00 Asia/Damascus, work days), idempotent through `notification_reminders` (F14 rule 8). The development command `notifications:run-daily --date` runs them too.

## Edge cases
1. Two people edit a lead at once: `updatedAt` refuses the second (`STALE_LEAD`); stage, owner, lose and convert lock the lead row, so a second conversion gets `INVALID_TRANSITION`.
2. A lead quote is accepted while someone loses the lead: both lock the lead row; whichever comes second is refused (`LEAD_CLOSED` or `INVALID_TRANSITION`).
3. The owner is archived: refused while they own open leads, archived ones included (F01 rule 9, responsibility `owner_of_open_leads`, listing them); hand them over first. Lost and won leads keep their owner; reopening a lost one names a new owner (rule 9).
4. The owner loses `leads.manage` (leaves General Communication or Marketing, or loses the Account Manager role): the lead keeps them as owner and shows "Owner cannot manage leads"; reminders still reach them and the overdue escalation reaches the sales managers, who reassign it.
5. No sales managers exist (no manager in General Communication or Marketing): the overdue reminder goes to the owner only.
6. Converting with a company name equal to an existing client: `CLIENT_NAME_TAKEN`; the dialog suggests linking that client instead.
7. Converting while a lead quote is `sent`: allowed; the quote moves to the client and can be accepted there as a client quote.
8. A lead quote's draft while the lead is lost: it stays; sending it is refused (`LEAD_CLOSED`) until the lead is reopened.
9. An account manager hands a lead to someone else: they lose access to the lead and its quotes at once (scope follows the owner).
10. The interests reference a service archived later: shown with an "archived" mark; saving the lead keeps it, adding it again is refused.
11. A follow-up date on a Friday: reminded on Saturday (rule 18); overdue on Monday (rule 19).
12. Duplicate checks against leads the caller cannot read show only name, owner and stage (rule 2).
13. Volume: tens of open leads; the board caps at 200 cards per column with a "show in list" link, and the list pages.

## Open questions
- None blocks F03. Related, not blocking:
  - Q5: email reminders for follow-ups wait for the email provider (Phase 4).

## Acceptance
- Owner check in the browser:
  1. As a General Communication member, create a lead "Dental Clinic Al-Noor" (contact Ahmad, phone, source Instagram, interests "Gold social", budget 400 USD, sector "Healthcare", healthcare on, owner an account manager A, follow-up tomorrow). A gets `lead_assigned`.
  2. Create a second lead with the same phone: the duplicate panel shows the first one; save anyway, then archive it from the list's actions.
  3. As A, open the board: only A's leads show. Drag the lead to Contacted, log a WhatsApp activity with a new follow-up date, then move it to Meeting.
  4. As A, create a quote for the lead (New quote on the lead page), add "Gold social", and send it: the lead moves to Quote sent; dragging it back to Meeting is refused.
  5. As a Marketing member, open the lead: the quote shows its number and status without amounts, and there is no "New quote".
  6. Run `notifications:run-daily` on the follow-up date: A gets the due reminder; run it two work days later without changing the date: A and the sales managers get the overdue reminder; running it again sends nothing.
  7. As A, record the quote's acceptance: step 0 creates the client "Dental Clinic Al-Noor" with A as account manager and the healthcare flag on, then the retainer as in F04. The lead is Won, the client's log has the WhatsApp activity, the quote shows the client, and the client header says "Converted from lead".
  8. Create a third lead and convert it from the lead page by linking an existing ended client: the client becomes active and gains the contact.
  9. Create a fourth lead with a sent quote, mark it lost with reason "Price": the quote is rejected with reason "price". Reopen it to Contacted with a follow-up date.
  10. As the Operations manager, see every lead without lead actions, and write a quote on one. As Finance, see lead quotes in the quote list. As a designer, see no Leads entry.
  11. Try to archive account manager A: refused while A owns open leads.
  12. Open the audit log and find each change above.
- Tests:
  - Unit (contracts): lead schemas (contact method, budget pair, source detail, follow-up bounds, interest limits), stage transition rules, the loss-to-rejection reason mapping, the due and overdue date rules over work days (Fridays, consecutive runs), permission map change (Operations manager `leads.read`), the new notification types and reminder kinds.
  - API (`apps/api/test/leads.test.ts`, `lead-conversion.test.ts`, and additions to `quotes.test.ts`, `quote-accept.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another owner's lead; a General Communication member writing a quote; the Operations manager editing a lead; an employee anywhere); every error code above; rules 1–20; conversion in one transaction with rollback on a refused F02 rule; acceptance of a lead quote converting and creating engagements, with rollback; quotes moved to the client and rejected on loss; the reminder sources and their idempotency; the user archive blocker; audit entries in the same transaction; the architecture test (`leads` never imports `quotes`).
  - E2E: create a lead, write and send a quote on it, accept it with a new client, land on the project.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): board (desktop and phone), list, lead dialog with the duplicate panel, lead page (open, won, lost), convert dialog (both tabs), lose dialog, accept dialog step 0.
