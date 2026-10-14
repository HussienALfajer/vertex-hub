# F05C — Retainer anniversary cycles and contracts

Status: Approved · Date: 2026-10-13 · Scope: `docs/product/v1-scope.md` §F05 (anniversary cycles and contracts, added 2026-10-13), with changes to §F04 (A01), §F13 (A02), §F14, §F15 and A09 · ADRs: 0006, 0015, 0024, 0027, 0029, 0030 (new), 0031 (new)

## Summary
Retainer cycles follow the calendar month today: a retainer that starts on 20 September gets a short first cycle (20–30 September) with full quantities and a full fee, the renewal date is a separate manual field that does not match the cycle the team sees, and a fixed-term retainer that started last month cannot be entered (a term never starts in a past month). F05C anchors every cycle on the retainer's **start date**: one full month from the anchor day to the day before it in the next month (20 Sep – 19 Oct, 20 Oct – 19 Nov), never partial and never prorated. Terms, charges, amendments, invoice drafts, renewal and the behind alerts count these cycles. A retainer may start up to 12 months in the past, with a catch-up step for the cycles that closed before it was entered. On the first day of each cycle the system closes the previous one, opens the new one, drafts its invoice and prepares the **cycle report** for the account manager. F05C also adds the **retainer contract**: a numbered, branded Arabic PDF ("عقد تقديم خدمات", modelled on the agency's paper contract) per term, or one for an open-ended retainer, with the two parties' legal details, articles from a template the agency edits, the scope, term and payment schedule filled in from the system, signed copies kept, and numbered **annexes** for amendments.

## In scope / out of scope
- In:
  - Anniversary cycles for every retainer, with or without a term: cycle numbers, periods from the start date, the end-of-month clamp, the day-one sequence of the daily job.
  - Terms counted in cycles (1–36), schedules per cycle, renewal date derived from the term (no manual renewal date), renewal 30 days before the end, end actions unchanged.
  - Charges, invoice drafts (labelled with the cycle and its period), credits and amendments per cycle ("this cycle only", "from cycle N onward").
  - Pause, resume and reactivation on anchored cycles; the resume choice for open-ended retainers.
  - Backdated start (up to 12 months) with a catch-up step: billing and delivery of each past cycle.
  - The retainer header and lists showing "cycle k of N · period · X days left"; behind badges and A09 on cycle periods.
  - Cycle reports: the F15 report sections over a cycle's period, prepared automatically on day one, with a summary, PDF and a notification to the account manager.
  - Contracts: contract settings (agency legal details, number prefix, slogan, article template), client legal details (registration number; the signatory contact's father's name and national ID with restricted access), contracts per term or open-ended retainer (draft, preview, issue with number, void, signed copy), annexes for amendments on demand, the PDFs.
  - Delivery in five PRs, contracts last: PR 1 anniversary cycles (schema, engine, job, terms, charges, amendments, resume, screens); PR 2 backdated start and catch-up; PR 3 cycle reports; PR 4 legal details (contract settings with the article template, client and contact legal fields); PR 5 contracts and annexes with their PDFs.
- Out (later or never):
  - Prorating, partial cycles, moving the anchor day (owner decision: dates never shift; pausing keeps the anchor).
  - Extending a term by the days it was paused.
  - Converting existing retainers: the owner archives the only production retainer and enters it again after the deploy (owner decision, 2026-10-13). The migration only keeps existing rows valid (see Data, Migration).
  - Calendar-month agency reports change nothing: revenue, invoiced and collected stay by invoice and payment date (F15).
  - Sending cycle reports, contracts or annexes to the client from the system; e-signature; contracts in English; per-client article templates (each contract can be edited instead).
  - Backdating from the quote accept dialog (its start date stays within the current cycle, rule B6).

## Roles and access

### Permission map changes (`packages/contracts/src/permissions.ts`)
None. Money access stays F05's: `invoices.read` covering the client.

| Action | Permission | Roles and scope |
|---|---|---|
| See cycles, periods, terms and amendments | `projects.read` | Every active user: all (amounts only with money access, F05B G3) |
| Create a backdated retainer and its catch-up | `projects.manage` (client scope) + money access | General Manager, Operations manager · the client's account manager |
| Resume or reactivate with "start now" | as F05 status changes | as F05 |
| Read a cycle report, edit its summary, download its PDF | `reports.read` covering the client | General Manager, Operations manager: all · Account Manager: own_clients |
| Read contract settings | `projects.manage` with client scope (`all` or `own_clients`; the `assigned` scope every user holds does not count) + `invoices.read` (any scope) | General Manager, Operations manager, account managers |
| Edit contract settings (agency details, prefix, slogan, articles) | `catalog.manage` | General Manager, Operations manager (as quote company details, F04) |
| Read and edit a client's registration number | `clients.read` / `clients.manage` covering the client | F02 unchanged |
| Read and edit a contact's father's name | `clients.read` / `clients.manage` covering the client | F02 unchanged |
| Read and edit a contact's **national ID** | `clients.manage` **and** `invoices.read`, both covering the client | General Manager, Operations manager · the client's account manager (owner decision) |
| See contracts and annexes, download their PDFs and signed copies | `projects.read` + money access | General Manager, Operations manager, Finance, the client's account manager |
| Create, edit and issue contracts and annexes; void; upload the signed copy | `projects.manage` (client scope) + money access | General Manager, Operations manager · the client's account manager |

## Data

Dates without a time are calendar days in Asia/Damascus. The `projects` module owns every new table except the client columns (`clients` module) and `retainer_cycle_reports` (`reports` module: ADR 0027 lets no module import `reports`, so `projects` tells it a cycle closed through `CycleClosedHooks`, in the closing transaction). Money is integer minor units in the retainer's currency (ADR 0006).

### Cycle arithmetic (`packages/contracts/src/retainer-cycles.ts`, pure)
- `cyclePeriod(startDate, n)`: cycle `n` (1, 2, 3…) runs from `addMonths(startDate, n − 1)` to the day before `addMonths(startDate, n)`. `addMonths` clamps a missing day to the month's end and is always computed from the start date, so the anchor day returns: start 31 Jan → 31 Jan–27 Feb, 28 Feb–30 Mar, 31 Mar–29 Apr.
- `cycleAt(startDate, date)`: the cycle number whose period contains `date`; null before the start date.
- Every function that names a cycle uses these two; nothing else computes periods.

### Changes to `retainers`
| Field | Change |
|---|---|
| `start_date` | the anchor. Required; from today − 12 months (B1) with no upper limit change. Editable only while the retainer has no cycle and no charge (`RETAINER_STARTED`). |
| `renewal_date` | derived only: the day after the end of the last non-cancelled term (F05B T11); null without a term. No longer accepted by `POST`/`PATCH /api/retainers` or the accept dialog. |
| `cycles_from` | new, date, optional: the job opens no cycle and creates no open-ended charge for a cycle that starts before it (resume or reactivation "from the next cycle", rule P3). Cleared when that cycle opens. |

### Changes to `retainer_cycles`
| Field | Change |
|---|---|
| `number` | new, integer, required: the cycle number (`cycleAt`); unique with `retainer_id`. Replaces `month` as the cycle's identity. |
| `period_start`, `period_end` | the cycle's period from `cyclePeriod`, except: `period_start` is the resume or reactivation day for a cycle started "now" (P2); `period_end` is the end day when the retainer ends (F05 R5). |
| `backdated` | new, boolean, default false: created by the catch-up (B3). |
| `untracked` | new, boolean, default false: a backdated cycle whose delivery was not recorded (B4); its lines have no `delivered_at_close` and its delivery rate is null. |
| `month` | made optional and no longer written; dropped by a later contract migration. |

### Changes to `retainer_charges`
- `cycle_number` (integer) and `cycle_start` (date, the cycle's `cyclePeriod` start) replace `month` as the charge's cycle; required. Unique `(retainer_id, cycle_number)` among `monthly` charges that are not `cancelled` replaces the month index. `month` becomes optional, unused, dropped later.
- `status` `settled_outside` is also allowed for a backdated `monthly` charge billed outside the system (B3), with `settle_note`.

### Changes to `retainer_terms`
- `start_cycle` (integer), `cycles` (integer, 1–36), `start_date`, `end_date` (dates, the periods of the first and last cycle; stored for queries) replace `start_month`, `months` and `end_month`, which become optional, unused, dropped later.

### Changes to `retainer_amendments`
- `effective_cycle` (integer) and `effective_date` (that cycle's start) replace `effective_month`. `schedule` items are `{ cycle, amountMinor }`. `effects` name cycles.

### Changes to clients (`clients` module)
- `clients.registration_number`: text, optional, ≤ 60 chars (commercial registration or licence).
- `client_contacts.father_name`: text, optional, ≤ 60 chars.
- `client_contacts.national_id`: text, optional, ≤ 30 chars, restricted (Roles). Omitted from every response to other users; audit entries record that it changed, never the value.

### `contract_settings` (single row, seeded by its migration)
| Field | Type | Rules |
|---|---|---|
| `singleton` | boolean | primary key, always true |
| `legal_name`, `trade_name`, `company_type` | text | ≤ 120 chars each; empty by default |
| `registration_number` | text | ≤ 60 |
| `address`, `phone`, `email`, `website` | text | ≤ 200, ≤ 30, ≤ 120, ≤ 120 |
| `representative_name`, `representative_title` | text | ≤ 120 each (the agency's signatory) |
| `slogan` | text | ≤ 200; printed under the parties (default "نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.") |
| `number_prefix` | text | 2–20 chars of `A–Z`, digits and `-`; default `VM-CCS` |
| `updated_at`, `updated_by_id` | | |

### `contract_article_templates` (business table: the default articles)
`id`, `position`, `title` (1–120), `body` (≤ 6,000 chars), timestamps, `archived_at` (archived = removed from the template). Every article can be edited, added, removed and reordered (owner decision); at most 40 non-archived articles, none required. Seeded by the migration with the articles of the appendix.

### `retainer_contracts` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `retainer_id` | uuid → `retainers.id` | required, indexed |
| `kind` | enum `contract_kind` (`term`, `open_ended`) | required |
| `term_id` | uuid → `retainer_terms.id` | required for `term`, null for `open_ended` |
| `start_cycle` | integer | `open_ended`: the first cycle it covers (the current or next cycle when drafted) |
| `status` | enum `contract_status` (`draft`, `issued`, `signed`, `void`) | required |
| `number` | text | set at issue: `<prefix>-<year>-<nnn>` (3 digits, more when needed), year of the issue date; unique |
| `contract_date` | date | required, default today; printed |
| `signatory_contact_id` | uuid → `client_contacts.id` | required to issue; the client's signatory |
| `snapshot` | jsonb | set at issue: the whole render payload (parties, articles with their numbers, scope, term, schedule, quote reference), frozen |
| `pdf_status`, `pdf_file_item_id`, `draft_pdf_*` | as `invoices` | the issued PDF and the draft preview (F13 rule 15, F04 rules 12–13) |
| `signed_on`, `signed_file_item_id` | date, uuid → `file_items.id` | set when the signed copy is uploaded |
| `void_reason`, `voided_at` | text ≤ 500, timestamptz | set when voided |
| `issued_at`, `issued_by_id` | timestamptz, uuid | |
| timestamps, `archived_at` | | archived = a discarded draft (K8); an issued contract is voided, never archived |

At most one non-void, non-archived contract per term, and one per retainer and `start_cycle` for `open_ended` (partial unique indexes).

### `retainer_contract_articles`
`id`, `contract_id` (indexed), `position`, `title`, `body`, timestamps: the contract's own copy of the articles, taken from the template when the draft is created and edited freely on the draft (add, change, remove, reorder any article). Frozen at issue (`snapshot`). At most 40 per contract.

### `retainer_contract_annexes` (business table)
`id`, `contract_id` (indexed), `amendment_id` (→ `retainer_amendments.id`, unique among non-void annexes), `annex_number` (1, 2, 3… per contract), `status` (`issued`, `signed`, `void`), `annex_date`, `snapshot`, `pdf_status`, `pdf_file_item_id`, `signed_on`, `signed_file_item_id`, `void_reason`, `voided_at`, `issued_by_id`, timestamps.

### `retainer_cycle_reports` (one row per cycle; listed in `conventions.test.ts` as a natural key: `cycle_id`)
`cycle_id` (primary key → `retainer_cycles.id`), `summary` (text ≤ 4,000, default empty), `pdf_status`, `storage_key`, `hash`, `size_bytes`, `rendered_at`, `created_at`, `updated_at` (the summary's last save only: the report shows it, so a render never touches it), `updated_by_id`. Created when the cycle closes or its summary is first saved. Kept as long as the cycle; a new render replaces the object.

### Other changes
- `document_number_kind` gains `contract`.
- `file_owner_type` gains `retainer_contract` (F10). Its owner policy: readable by contract readers of the client (Roles); read-only through the file endpoints, except the signed copy, which contract managers upload through the contract endpoints (each upload is a new version of the "signed copy" item). Contract PDFs, annex PDFs and signed copies are documents of the contract.
- Notification types: `retainer_cycle_report_ready` (F14 catalog, below).

### Migration
Expand only, as F05B (the dev and test databases are shared with checkouts that run the old code). New columns are added and backfilled so constraints hold; existing rows are not re-cut into anchored periods (owner decision):
- a cycle's `number` = `cycleAt(start_date, last day of its month)` (settled in PR 1: `period_end` would give two cycles the same number when a retainer ended early in a month or started after its first day); a charge's `cycle_number` = the number of its cycle when the month has one, else `cycleAt(start_date, last day of its month)`, and `cycle_start` from `cyclePeriod`; a term's `start_cycle` = `cycleAt(start_date, last day of start_month)`, `cycles` = `months`; an amendment's `effective_cycle` the same from `effective_month`; schedules mapped the same way.
- a retainer without an active or scheduled term gets `renewal_date` null.
- the amendment scope enum gains `cycle` and keeps `month` (Drizzle runs pending migrations in one transaction, so a new enum value cannot be used to rewrite rows in the same run): the API reads `month` as `cycle` and writes `cycle` only; the later contract migration rewrites and drops `month`.
- the job then treats such a retainer like any other (rule J1 closes an open cycle whose number is below the current one). Dev seed data (`db:seed`) is rewritten to anchored cycles.
- `month`, `start_month`, `months`, `end_month`, `effective_month` are dropped by a later contract migration, together with F05B's `invoice_lines.retainer_cycle_id`.

## States and rules

### Cycles
- Y1. A retainer's cycles are numbered from its start date (`cycleAt`); cycle `n`'s period is `cyclePeriod(start_date, n)`. Every cycle is a full period with the full quantities and the full charge: no partial cycle, no prorating. A cycle that a pause skipped keeps its number (history shows the gap).
- Y2. The **current cycle** of a retainer on day D is `cycleAt(start_date, D)`. A retainer whose start date is in the future has no cycle and no charge until that day.
- Y3. Creating a retainer whose start date ≤ today opens the current cycle at once (F05 R3) with full quantities and makes its charge due (F05B C3); earlier cycles are created by the catch-up (B2). Resuming and reactivating follow P1–P4.
- Y4. Ending closes the open cycle at once with `period_end` = the end day (F05 R5); the current cycle stays billed (F05B E1).
- Y5. **Behind** (F05 R11, `isLineBehind`) and the delivery rate (R13) work on the cycle's `period_start`–`period_end`. A09 (P2A) runs on cycles: texts say "end of the cycle" instead of "end of the month"; its "short cycle" rule now only skips cycles of 7 days or fewer started "now" by a resume.
- Y6. Header and lists show "cycle k of N · 20 Oct – 19 Nov · 6 days left" for a term cycle (k = position in the term), "cycle 7 · 20 Oct – 19 Nov · 6 days left" without a term.

### Day one (job `retainers.cycles`, 00:05, per retainer, one transaction under the retainer lock)
- J1. In this order, for day D: (1) start scheduled terms whose `start_date` ≤ D and complete active terms whose `end_date` < D (F05B T7–T9), ending retainers per T8; (2) apply scheduled amendments whose `effective_date` ≤ D, in number order (F05B A5); (3) close every open cycle whose `period_end` < D or whose number is below the current cycle's, freezing delivered counts and the final delivery rate (F05 R8, R13); (4) when the retainer is `active`, started, and the current cycle starts on or after `cycles_from`, open the current cycle if it has none (full quantities, A02 tasks, F07); (5) create the open-ended charge of the current cycle (F05B C2) and run the due hooks of due charges (C3), which draft the cycle's invoice (C4); (6) queue the report of each cycle closed in step 3 that is not `backdated` (R1); (7) create renewal terms (T7).
- J2. Idempotent as F05B: cycle `(retainer_id, number)` and monthly charge `(retainer_id, cycle_number)` are unique, `due_at` and term and amendment statuses guard the rest. A run missed while the worker was down catches up the current cycle only (F05 R2); closed cycles are closed on the next run, and their reports queued.
- J3. Invoice draft lines name the cycle: "<retainer> — الدورة 7 (20 تشرين الأول – 19 تشرين الثاني 2026)" and, for a term cycle, " (3 من 6)" (F05B C4). Supplementary and termination drafts name the cycle the same way. Pending credits go on the next cycle's draft (C5).

### Terms (changes to F05B)
- T1'. A term covers `cycles` (1–36) consecutive cycles from `start_cycle`; `end_date` = the day before `addMonths(start_date of the retainer, start_cycle − 1 + cycles)`. The schedule has one amount per cycle (F05B T3).
- T2'. A term starts at the current cycle or a later one, never before the retainer's first cycle (`INVALID_DATES`), and after the end of any other non-cancelled term (`TERM_OVERLAP`); the current cycle follows F05B T4 (`MONTH_ALREADY_CHARGED` becomes `CYCLE_ALREADY_CHARGED`). Exception: a term created with a backdated retainer starts at its first cycle (B5).
- T3'. Renewal (F05B T7): on the first run on or after 30 days before `end_date`, the next term starts at the cycle after the last one, with the same number of cycles. `renewal_date` = `end_date` + 1; `retainer_renewal_due` (F14 rule 12) uses it, from 30 days before. An open-ended retainer has no renewal date and no renewal reminder.
- T4'. End actions are unchanged: `renew` (same anchor, same number of cycles), `continue` (open-ended cycles at `monthly_fee_minor`), `end` (the retainer ends on the term's last day).
- T5'. Pausing never moves a term (F05B T12): its cycles' charges become due and are drafted while paused; dates never shift.

### Amendments (changes to F05B)
- A1'. Scope `cycle` ("this cycle only", replaces `month`) or `onward` ("from cycle N onward"); the effective cycle is the current cycle or later (`INVALID_EFFECTIVE_CYCLE`, replaces `INVALID_EFFECTIVE_MONTH`). Every F05B rule A1–A9 reads "cycle" for "month": reductions need the General Manager, and a reduction on an invoiced cycle credits the next cycle's draft.
- A2'. A `cycle` change for a cycle that has not opened is taken when it opens; a closed cycle refuses it (`CYCLE_CLOSED`).

### Pause, resume, reactivate
- P1. Pausing keeps the open cycle until its `period_end` (F05 R5); no cycle opens while paused. An open-ended retainer gets no charge for a cycle that starts while paused; a term's charges stay due (T5').
- P2. Resuming an **open-ended** retainer whose current cycle has no cycle row asks (owner decision): **from the next cycle** (default; `cycles_from` = the next cycle's start; nothing for the rest of this period) or **start now** (opens the current cycle with `period_start` = today, `period_end` = the period's end, full quantities and a full charge, due at once). With a cycle row already open (paused and resumed in the same cycle) nothing is asked: the cycle continues.
- P3. Resuming a retainer **with a term**: the current cycle's charge is already due (T5'), so the current cycle opens at once with full quantities and `period_start` = today. No choice.
- P4. Reactivating an ended retainer (F05, scope all): it has no term any more (F05B E3), so P2 applies; a cycle that closed when it ended stays closed, and "start now" in that same cycle is refused (`CYCLE_CLOSED`): it starts from the next cycle.

### Backdated start
- B1. A new retainer's start date may be up to 12 months before today (`INVALID_DATES` beyond). Past cycles are the cycles from 1 to `cycleAt(start, today) − 1`. A start date beyond that is `INVALID_DATES`; editing the start date (edge case 8) and the accept dialog (B6) keep the current cycle as the earliest.
- B2. A start date before the current cycle's start needs the **catch-up** in the same request: one entry per past cycle (at most 12), each with a billing choice and a delivery choice (`CATCH_UP_REQUIRED` when missing or incomplete; a catch-up sent without past cycles too). `delivered[]` holds one count per deliverable line of the request, in its order. Sending the catch-up needs money access, so a user without it cannot backdate (the form keeps the current cycle as the earliest start for them).
- B3. Billing: `billed_externally` (default): the cycle's `monthly` charge is created `settled_outside` with the note "billed outside the system" and never drafts; `draft_now`: the charge is created due now and drafts its invoice at once (C4), labelled with that cycle (J3). The amount is the term's schedule amount for that cycle, else the monthly fee; a cycle with no amount gets no charge.
- B4. Delivery: `untracked` (default): a closed, `backdated`, `untracked` cycle with its lines' committed quantities and no delivered counts; `entered`: delivered per line (0–999), frozen as `delivered_at_close`. Backdated cycles get no tasks (A02, F07), no A09 alerts, no cycle report and no notifications.
- B5. A term on a backdated retainer may start at cycle 1 when created in the same request; it must include the current cycle (`INVALID_DATES`), so it is created `active`. Its renewal (T3') follows as usual.
- B6. The quote accept dialog (F04 A5) takes a start date from the current cycle's start of that date onward: a start date from today − 1 month + 1 day; earlier needs the new retainer form (`INVALID_DATES`). Its renewal date field is removed (T3').
- B7. The creation writes `retainer.created` and one `retainer.backdated` audit entry listing each past cycle with its billing and delivery choices and entered counts.

### Cycle reports
- R1. When the job closes a cycle (J1 step 3), or ending closes one (Y4), the API queues the PDF of its **cycle report** with the stored summary (empty at first) and notifies the client's account manager once (`retainer_cycle_report_ready`). Backdated cycles get none. Reports are never sent to the client automatically (F14: the account manager sends them by hand).
- R2. Content: the sections of F15 rule 18 over the cycle's period instead of a calendar month, except that the retainers section shows this retainer's cycle only (lines, committed, frozen delivered, percent, delivery rate) and the projects section is left out. Other sections (delivered work, published content, shoots, approvals, ad campaigns and budget with `campaigns.read`, next period) cover the client over the period, as F15 does for a month. An open cycle's report is marked **preliminary**.
- R3. The summary is edited by any reader of the report (F15 rule 19); saving it marks the stored PDF outdated, and "Download PDF" renders it again. Rendering follows F15's pipeline (worker `reports.pdf`), stored in `retainer_cycle_reports` instead of the 24-hour table. The stored PDF is current while the report as the reader sees it hashes the same as its render (a summary save, or any later change to the cycle's period, makes it outdated); the render prepared at close is the account manager's view, with the campaign sections. A backdated cycle's report answers 404.
- R4. F15's calendar-month client report keeps working; its retainers section lists each cycle whose period overlaps the month, with its period.

### Contracts
- K1. **Unit** (owner decision): one contract per term (`kind = term`), and one for an open-ended retainer (`open_ended`, covering from its `start_cycle`). A renewal term is a new contract with a new number. A `continue` after a term is covered by the term's contract (its term article says so).
- K2. **Draft.** "Prepare contract" on a term card (scheduled or active) or on an open-ended retainer creates a `draft` with the template's articles copied, the contract date today and the signatory contact preset to the client's contact with final approval (F02), else none. On a draft, the user edits the date, the signatory and the articles: add, edit, remove and reorder any article (owner decision: no fixed articles). Articles are numbered by position on render ("المادة 1 — …").
- K3. **Live data.** A draft's preview and its issue read the parties, the scope, the term and the schedule live (K6). Issuing freezes them all in `snapshot`; later changes never change an issued contract.
- K4. **Issue** requires a draft, a non-cancelled covering term (or an open-ended retainer that is `active` or `paused`), the agency's legal name, trade name and representative name in the settings, and a signatory contact (`CONTRACT_INCOMPLETE` with the missing fields). Other missing fields are allowed: they print as an empty line to fill in by hand, and the issue dialog lists them first (owner decision). Issuing assigns the next number of the year (`document_numbers` kind `contract`), sets `issued`, freezes the snapshot and queues the PDF.
- K5. **Signed copy.** On an issued contract, uploading the signed scan (PDF or image, F10 limits) with the signing date sets `signed`. A new upload replaces it as a new version.
- K6. **Content** (the PDF, Arabic RTL, in the brand, following the paper contract's layout): page number badge, logo, contract date and number, title "عقد تقديم خدمات"; the two party tables with a dark header row — first party (the agency, from the settings: legal name as the header, trade name, company type, registration number, address, phone, email, legal representative and title), second party (the client: signatory's full name as the header, father's name, trade name, national ID, registration number, phone, email, address (the client's billing address), title (the contact's job title)); the slogan; the preamble "ويشار إلى الطرف الأول بـ«الوكالة» وإلى الطرف الثاني بـ«العميل»، وإليهما مجتمعين بـ«الطرفين»."; the numbered articles, with the generated blocks of K7 where their placeholders stand; the signature block (both parties: name, title, signature, stamp); the footer on every page (website, address, phone, the brand's triangle row) and "page x of y".
- K7. **Placeholders** in article bodies (the editor inserts them from a menu): values `{agency_name}` (trade name), `{client_name}` (client trade name), `{retainer_name}`, `{payment_terms_days}` (F13 settings); blocks, each on a line of its own, filled from the system: `{services}` (the accepted quote's number and its monthly services and packages, when the retainer has one, and the deliverables table: kind or label, quantity per cycle, revision rounds), `{term}` (start date, number of cycles, end date, the cycle day and the end action's clause, or "open-ended, cycle by cycle" for `open_ended`), `{fees}` (the agreed total and the schedule table: cycle number, period, amount; or the fee per cycle; with the currency). A block may appear in any article, more than once or not at all; the issue dialog warns when `{services}`, `{term}` or `{fees}` appears nowhere, without blocking. Any other `{…}` is refused on save (`UNKNOWN_PLACEHOLDER`).
- K8. **Void** an issued or signed contract with a reason (≤ 500 chars): the number stays used; its PDF and signed copy stay; a new draft may then be prepared. A draft is discarded by archiving it (it holds no number); a new draft may then be prepared.
- K9. **Changes after issue.** The contract page shows "changed since issue" when the term was edited or cancelled, or applied amendments of its cycles have no annex; nothing changes automatically. A cancelled term's contract is voided by hand.
- K10. **Annexes** (owner decision: on demand). On an applied `change` or `reschedule` amendment whose effective cycle lies in a cycle covered by an issued or signed contract, "Issue annex" creates the next annex of that contract (`annex_number`), snapshot and PDF: title "ملحق رقم n للعقد رقم <number>", date, the parties' names, "يُعد هذا الملحق جزءاً لا يتجزأ من العقد المذكور، وقد اتفق الطرفان على التعديل الآتي:", the amendment (scope and cycle, line changes, amount per cycle or new schedule, reason), "تبقى سائر أحكام العقد سارية دون تعديل.", signatures. No annex for `quote_renewal` (a new term has its own contract) or pending, rejected, withdrawn or cancelled amendments (`INVALID_TRANSITION`). Annexes are voided and signed like contracts.
- K11. Contract and annex texts outside the editable articles (headings, labels, preamble, end-action clauses, annex wording) live in `packages/messages` (ADR 0028), shared by the API's checks and the worker's template.
- K12. Settings: every field is plain text; the article template is edited as a list (add, edit, remove, reorder any article). Changes apply to drafts prepared afterwards, never to existing drafts or issued contracts.
- Settled in PR 5a (implementation):
  - An open-ended contract starts at the current cycle (cycle 1 before the start date); it is refused (`INVALID_TRANSITION`), when prepared and when issued, while a scheduled or active term holds that cycle: the term's contract covers it.
  - The contract covering a cycle (K9, K10) is the issued or signed term contract whose term holds the cycle, else the issued or signed contract covering onward with the latest start cycle at or before it: an open-ended contract, or the contract of a term whose end action is `continue` (K1).
  - K9 is computed on read: the term cancelled; its start, cycles, end, end action or agreed total different from the snapshot; or an applied `change` or `reschedule` amendment applied after the issue, in a covered cycle, without a live annex of the contract. The schedule amounts are compared only while there is no such amendment, since amendments move them too and are answered by annexes.
  - The second party's phone, email and title are the signatory contact's; the address is the client's billing address.
  - The fees schedule prints each term cycle's base amount (the schedule plus onward amendments applied before the issue).
  - Contract numbers come from `invoices`' yearly counters (kind `contract`) through `projects`' `ContractSources`, which `quotes` also fills with the accepted quote's monthly services (no module import cycle).
  - A signed copy (contract or annex) is a PDF or an image; another type is refused (`FILE_TYPE_NOT_ACCEPTED`).
  - An annex PDF that failed is rendered again with `POST …/annexes/:annexId/pdf` (as contracts).
  - Documents of the contract: `<number>.pdf`, `<number> - annex <n>.pdf`, and the signed copies named `<number> signed <file>` and `<number> annex <n> signed <file>`; a new signed upload is the next version of the same document.

### General
- G1. Every change writes an audit entry in the same transaction; the job writes them with a null actor.
- G2. All cycle, term, charge, amendment, contract and annex changes of a retainer take the retainer row lock.
- G3. Money appears only with money access (F05 M1); contract pages and PDFs need it (Roles).

## API

Schemas: `packages/contracts/src/retainers.ts` (cycles, terms, amendments, catch-up, resume), `retainer-cycles.ts` (arithmetic), `retainer-contracts.ts` (contracts, annexes, settings, articles), `clients.ts` (legal fields), `reports.ts` (cycle report). A record outside read access is a 404.

| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `POST /api/retainers` | `projects.manage` (client) | F05 + F05B, without `renewalDate`; `startDate` from today − 12 months; `catchUp[]` (`cycle`, `billing`: `billed_externally` \| `draft_now`, `delivery`: `untracked` \| `entered`, `delivered[]` per deliverable line) when backdated, money access needed for it; optional `term` (B5) | `retainerDetailSchema` | F05 codes, `INVALID_DATES`, `CATCH_UP_REQUIRED` |
| `PATCH /api/retainers/:id` | as F05 | without `renewalDate` (400 when sent) | `retainerDetailSchema` | F05 codes, `RETAINER_STARTED` (a cycle or a charge exists) |
| `POST /api/retainers/:id/status` | as F05 | `{ status, startNow? }` (`startNow` for P2 and P4) | `retainerDetailSchema` | F05 codes, `CYCLE_CLOSED` |
| `GET /api/retainers` · `/:id` | `projects.read` | as F05 | gains `currentCycle { number, periodStart, periodEnd, daysLeft, termPosition?, termCycles? }` and `nextCycleStart` (paused, or `cycles_from`) | — |
| `GET /api/retainers/:id/cycles` · `/:cycleId` | `projects.read` | as F05 | `number`, `backdated`, `untracked` replace `month` | 404 |
| Terms, amendments, charges, billing (F05B) | as F05B | `startCycle`, `cycles`, `effectiveCycle`, `{ cycle, amountMinor }` replace months | items carry `cycle`, `periodStart`, `periodEnd` instead of `month` | F05B codes, `INVALID_EFFECTIVE_CYCLE`, `CYCLE_ALREADY_CHARGED` |
| `GET /api/retainers/:id/cycles/:cycleId/report` · `/export` | `reports.read` covering the client | — | `cycleReportSchema` (R2) · xlsx | 404 |
| `PUT /api/retainers/:id/cycles/:cycleId/report/summary` | `reports.read` covering the client | `{ summary }` | `cycleReportSchema` | 404 |
| `POST /api/retainers/:id/cycles/:cycleId/report/pdf` · `GET` same path | `reports.read` covering the client | — | `{ state }` · the PDF inline, `<client> - <retainer> - cycle <n>.pdf` | 404 |
| `GET /api/contract-settings` | Roles: read | — | `contractSettingsSchema` + articles + `canEdit` | 403 |
| `PATCH /api/contract-settings` | `catalog.manage` | `updateContractSettingsSchema` | `contractSettingsSchema` | 403 |
| `PUT /api/contract-settings/articles` | `catalog.manage` | `{ articles: { id?, title, body }[] }` in order; articles left out are archived | articles | 403, `UNKNOWN_PLACEHOLDER`, `LIMIT_REACHED` |
| `GET /api/retainers/:id/contracts` | `projects.read` + money | — | `{ items: retainerContractSchema[] }` newest first, with annexes and `changedSinceIssue` | 404, 403 |
| `POST /api/retainers/:id/contracts` | `projects.manage` (client) + money | `{ kind, termId? }` | `retainerContractDetailSchema` (the draft with its articles and `missing[]`) | 403, 404, `CONTRACT_EXISTS`, `RETAINER_ENDED`, `RETAINER_ARCHIVED`, `INVALID_TRANSITION` (a cancelled or completed term) |
| `GET /api/retainers/:id/contracts/:contractId` | `projects.read` + money | — | `retainerContractDetailSchema` | 404, 403 |
| `PATCH /api/retainers/:id/contracts/:contractId` | `projects.manage` (client) + money | draft only: `contractDate`, `signatoryContactId`, `articles[]` | `retainerContractDetailSchema` | 403, 404, `INVALID_TRANSITION`, `UNKNOWN_CONTACT`, `UNKNOWN_PLACEHOLDER`, `LIMIT_REACHED` |
| `POST /api/retainers/:id/contracts/:contractId/discard` | same | draft only | `retainerContractDetailSchema` | 403, 404, `INVALID_TRANSITION` |
| `POST /api/retainers/:id/contracts/:contractId/issue` · `/void` · `/signed` | same | — · `{ reason }` · `{ signedOn, uploadId }` | `retainerContractDetailSchema` | 403, 404, `INVALID_TRANSITION`, `CONTRACT_INCOMPLETE`, `UPLOAD_NOT_FOUND` |
| `POST` · `GET /api/retainers/:id/contracts/:contractId/pdf` | read; preview of a draft: manage | `?draft=true` for the preview | `{ state }` · the PDF inline, `<client> - <number>.pdf` | 404, 403 |
| `POST /api/retainers/:id/amendments/:amendmentId/annex` | `projects.manage` (client) + money | `{ annexDate }` | `contractAnnexSchema` | 403, 404, `INVALID_TRANSITION`, `NO_CONTRACT` |
| `POST /api/retainers/:id/contracts/:contractId/annexes/:annexId/void` · `/signed` · `GET …/pdf` | as contracts | as contracts | `contractAnnexSchema` · PDF `<client> - <number> - annex <n>.pdf` | as contracts |
| Clients (F02) | F02 | `registrationNumber` on the client; `fatherName`, `nationalId` on contacts (national ID refused with 403 without the Roles access) | fields included per Roles | F02 codes |

F04: `acceptQuoteSchema` retainer part loses `renewalDate`; its `startDate` follows B6.

## Screens

All Arabic RTL through i18next, dates in Asia/Damascus with Latin digits, periods as "20 تشرين الأول – 19 تشرين الثاني 2026", loading, empty and error states.

1. **New retainer** (F05, F05B) — start date with the note "Cycles run from day 20 to day 19 of the next month" (or "from the last day of the month" for 29–31); no renewal date field. A start date before the current cycle opens a **Past cycles** step: one row per past cycle (number, period, amount) with billing (billed outside / draft invoice now) and delivery (not tracked / enter delivered, which expands the lines with an input each). The term section counts cycles and shows each cycle's period in the schedule editor.
2. **Retainer page header** — "Cycle 3 of 6 · 20 Oct – 19 Nov · 6 days left", the term chip with its end date and "renews on <date>", the renewal badge from 30 days before. Paused: "Paused · next cycle starts <date>".
3. **This cycle** tab (was "This month") — the open cycle with its number and period; behind badges on the period. **History** — cycles by number with period, delivery rate, "backdated" and "not tracked" badges, "Report" link per closed cycle.
4. **Resume / reactivate dialog** — for an open-ended retainer without a cycle row in the current period: "From the next cycle (<date>)" (default) or "Start now: a full cycle until <date> and a full fee".
5. **Contract tab** (F05B) — schedules and amendments by cycle; the amendment dialog picks "this cycle only" or "from cycle N onward" with the periods shown; a **Contracts** section: each contract (number or "draft", kind, term, status, date, signed date), actions "Prepare contract", "Open", "Preview PDF", "Issue", "Void", "Upload signed copy", annexes under it; per applied amendment "Issue annex" when a contract covers it; a "changed since issue" warning (K9).
6. **Contract editor** `/retainers/$retainerId/contracts/$contractId` (draft) — date, signatory picker (the client's contacts), the parties as they will print with missing fields flagged and links to fix them (settings, client, contact), the articles list (edit title and body, insert placeholders and blocks from a menu, add, remove, reorder by drag and up/down buttons; blocks show their generated content read-only in the preview), "Preview PDF", "Issue" (dialog listing the fields that will print empty), "Discard". Issued: read-only with the PDF, signed copy, annexes and "Void".
7. **Contract settings** `/settings/contracts` (beside quote and invoice settings) — agency legal details, number prefix with the next number preview, slogan; the article template editor; read-only for readers who cannot edit.
8. **Client** (F02) — the client's registration number beside the billing name and address on the Invoices tab; the contact dialog gains father's name and, for the allowed roles only, national ID.
9. **Cycle report** `/retainers/$retainerId/cycles/$cycleId/report` — the sections of R2 as they will print, the preliminary badge for the open cycle, the summary editor, "Download PDF", "Export to Excel"; reached from History, the notification and the client's report page.

## Audit, notifications and jobs
- Audit: `retainer.backdated` (B7); `retainer_cycle.created` and `.closed` carry `number` and the period; F05B entries name cycles; `client.updated` and `client_contact.updated` for the legal fields (the national ID as "changed" only); `contract_settings.updated`, `contract_settings.articles_updated`; `retainer_contract.created`, `.updated`, `.discarded`, `.issued`, `.signed`, `.voided`; `retainer_contract_annex.issued`, `.signed`, `.voided` (entities carry `retainerId` so the log links the retainer page); `retainer_cycle_report.summary_changed`.
- Notifications (F14 catalog):
  | Type | Category | Subject | Mutable | Recipients | Data |
  |---|---|---|---|---|---|
  | `retainer_cycle_report_ready` | `clients_projects` | `retainer` | yes | the client's account manager | retainer, client, cycle number, period, delivery rate |
  `retainer_renewal_due` is sent for terms only (T3'). A09 texts name the cycle (Y5).
- Jobs: no new scheduled job. `retainers.cycles` follows J1. The closing transaction queues `reports.cycle-report` (API, `{ retainerId, cycleId }`), which renders the report once the frozen counts are committed; a missed nudge is caught by the next PDF request. The worker's `reports.pdf` gains the kind `cycle_report`; a new `contracts.pdf` (worker, kinds `contract`, `contract_draft`, `annex`; retry 3) and `contracts.pdf-ready` (API: attaches the PDF as a document of the contract) follow F04 rule 12's hashing and idempotency; `invoices.daily` also queues contract and annex PDFs still `pending`. `retainers:run-daily --date` exercises the whole day-one sequence.

## Edge cases
1. Start date on the 31st: cycles 31 Jan–27 Feb, 28 Feb–30 Mar, 31 Mar–29 Apr; the header note says "from the last day of the month" for months without the day.
2. Start date on 29 February: 29 Feb–28 Mar, 29 Mar–28 Apr…; in a non-leap year the February cycle starts on the 28th.
3. The job did not run on the anchor day: the next run closes the previous cycle, opens the current one, drafts its invoice and queues the report (J2); the frozen counts include deliveries up to the close.
4. A retainer paused across the whole of cycle 5 and resumed in cycle 6 "from the next cycle": cycles 5 and 6 are missing in History, cycle 7 opens on its day; with a term, cycles 5–7 are still charged (T5').
5. Ending on the anchor day before the job: ending closes the previous cycle too (F05 edge case 6); its report is queued.
6. A backdated retainer with 12 past cycles, all "draft invoice now": 12 drafts in one transaction, each labelled with its cycle; Finance reviews them before issuing.
7. A backdated term whose schedule gives a past cycle 0: no charge for it (B3).
8. Editing the start date: only while no cycle and no charge exist (RETAINER_STARTED), so cycle numbers never move.
9. A contract issued, then the scheduled term edited: the contract keeps its snapshot and shows "changed since issue"; void it and prepare a new one, or keep it if the change was agreed otherwise.
10. Two drafts for the same term: refused (`CONTRACT_EXISTS`); open the existing draft.
11. A signatory contact archived after issue: the issued contract keeps its snapshot; a draft refuses to issue until another contact is chosen (`UNKNOWN_CONTACT`).
12. A user without national ID access edits a contact: the field is neither shown nor sent; the stored value is kept. A contract draft preview shows it only to allowed users; an issued PDF contains it and is readable only by contract readers, who all hold money access (Roles).
13. A contract number year: numbers restart each year by issue date; a void number is never reused.
14. Article texts longer than one page: the PDF breaks between paragraphs; party tables and the signature block are never split across pages.
15. Reports for a cycle that closed early (retainer ended): the period runs to the end day.

## Open questions
- None blocks F05C. Owner decisions recorded on 2026-10-13: cycles anchored on the start date with the month-end clamp; no partial cycles or prorating; renewal derived from the term; amendments per cycle; pausing never shifts dates; backdating up to 12 months with the catch-up; existing retainers are not converted (archived and entered again); resuming an open-ended retainer asks "now" or "next cycle"; an automatic cycle report on day one with a notification; one contract per term (one for an open-ended retainer), annexes on demand; the national ID stored with restricted access; missing contract fields print as empty lines with a warning; every article is editable, addable and removable, in the template and in each contract, the system's tables being placeholder blocks; the articles below are a first draft the owner approved and edits in the settings (owner: "add whatever a professional, complete contract needs").

## Acceptance
- Owner check in the browser (General Manager G, account manager A of client C, Finance F; `pnpm --filter @vertex-hub/api retainers:run-daily --date <date>` to move days):
  1. As A, create a retainer for C, open-ended, fee 500 USD, lines designs 12 and reels 4, with a start date chosen so that exactly one cycle has closed (for example the 20th two months ago, on a day before the 20th). The Past cycles step shows cycle 1; choose "billed outside" and "enter delivered" (designs 10, reels 4). Saved: History shows cycle 1 closed at 87 % with "backdated".
  2. The header shows "Cycle 2 · <period> · n days left"; one draft invoice of 500 labelled "الدورة 2 (…)" exists; none for cycle 1.
  3. Add a 3-cycle term starting at cycle 3, 1,200 USD, 400 / 400 / 400, renew. The term card shows the three periods and "renews on <date>".
  4. Run the job for the 20th of next month: cycle 2 closes, cycle 3 opens with full quantities, its draft of 400 says "(1 من 3)", A gets "Cycle report ready"; open the report, write a summary, download the PDF.
  5. Pause, then run the job for the next anchor day: no cycle opens, the term charge of cycle 4 is drafted. Resume: cycle 4 opens at once (term, no choice).
  6. Add an amendment "this cycle only" +2 reels and a reduction "from cycle 5 onward" −50; G approves; the preview and effects name cycles.
  7. As G, fill the contract settings (agency details) and review the articles. As A, give C a registration number and give the signatory contact a father's name and a national ID; sign in as an employee and check the national ID is not visible.
  8. As A, prepare the term's contract, edit one article and add one, preview, issue: number `VM-CCS-<year>-001`; open the PDF and check both party tables, the articles, the scope table, the schedule and the footer against the paper contract.
  9. Issue an annex for the reduction amendment; upload a signed copy of the contract and see it marked signed.
  10. Create another open-ended retainer starting today, pause and resume it in the same day of a later cycle: the dialog offers "from the next cycle" and "start now".
  11. Find every change in the audit log.
- Tests:
  - Unit (`packages/contracts`): `cyclePeriod` and `cycleAt` (anchors 1, 15, 28, 29, 30, 31; leap years; before the start), term end dates, catch-up schema (B2), placeholder check (K7), contract number format.
  - API (`retainer-cycles.test.ts`, `retainer-terms.test.ts`, `retainer-amendments.test.ts`, `retainers.test.ts`, `retainer-contracts.test.ts`, `retainer-cycle-reports.test.ts`, `clients.test.ts`, `quote-accept.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; an employee; Finance on manage endpoints; national ID without money access); every error code; rules Y1–Y6, J1–J3, T1'–T5', A1'–A2', P1–P4, B1–B7, R1–R4, K1–K12; the job's order and idempotency across a missed day; the migration backfill; audit entries.
  - Worker: the contract, annex and cycle report templates render (Arabic, RTL, page breaks, empty-line fields), screenshots from the worker test as F04.
  - E2E: a backdated retainer with the catch-up; the day-one run producing the draft and the report notification; preparing and issuing a contract.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): new retainer with Past cycles, the header with the cycle chip, the resume dialog, History with backdated badges, the cycle report, the contract settings with the article editor, the contract editor with missing fields, an issued contract with annexes, the contact dialog with and without the national ID.

## Appendix — default contract articles (seed, Arabic)

Seeded into `contract_article_templates` in this order; the owner edits, adds and removes them in the settings. The blocks `{services}`, `{term}` and `{fees}` (K7) stand on their own lines at the end of articles 2, 3 and 4. Article texts are product content in Arabic.

1. **موضوع العقد** — تلتزم الوكالة بتقديم الخدمات الإعلامية والتسويقية والإبداعية والتقنية المتفق عليها مع العميل، وفق عرض السعر ونطاق العمل المعتمدين، واللذين يُعدّان جزءاً لا يتجزأ من هذا العقد. ولا تلتزم الوكالة بأي خدمات أو أعمال غير واردة ضمن نطاق العمل إلا بموافقة الطرفين على عرض أو ملحق إضافي.
2. **نطاق الخدمات** — تشمل الخدمات المتفق عليها ما يلي، بالكميات المحددة لكل دورة. تُحتسب الكميات لكل دورة على حدة، ولا يُرحَّل ما لم يُستخدم منها إلى دورة لاحقة، ويُعالَج أي نقص من جهة الوكالة بالاتفاق على تعويضه في دورة لاحقة.
   {services}
3. **مدة العقد ودورات الخدمة** — يسري هذا العقد للمدة وبعدد الدورات المبينة أدناه. تبدأ كل دورة في اليوم المحدد من الشهر وتنتهي في اليوم السابق له من الشهر التالي، وإذا لم يوجد هذا اليوم في شهرٍ ما بدأت الدورة في آخر يوم منه. لا يغيّر الإيقاف المؤقت للخدمة تواريخ الدورات.
   {term}
4. **الأتعاب وطريقة الدفع** — تُستحق أتعاب كل دورة مقدماً في اليوم الأول منها، وتُصدر الوكالة بها فاتورة تُسدَّد خلال {payment_terms_days} أيام من تاريخ إصدارها، بالعملة المحددة أدناه. لا تشمل الأتعاب ميزانيات الإعلانات المدفوعة للمنصات، ولا تكاليف الطباعة أو الإنتاج الخارجي أو السفر أو استئجار المواقع، وتُدفع هذه بشكل مستقل بعد موافقة العميل عليها. وإذا تأخر العميل عن السداد أكثر من خمسة عشر يوماً من تاريخ الاستحقاق، يحق للوكالة إيقاف تقديم الخدمات مؤقتاً بعد إخطاره، دون أن يُعد ذلك إخلالاً منها بالتزاماتها.
   {fees}
5. **التزامات الوكالة** — تلتزم الوكالة بما يلي:
   - تنفيذ الخدمات بمهنية وجودة وفق أفضل الممارسات وفي المواعيد المتفق عليها.
   - تعيين مدير حساب مسؤول عن التواصل مع العميل ومتابعة العمل.
   - الالتزام بالهوية البصرية للعميل وتوجيهاته المعتمدة.
   - عدم نشر أي محتوى باسم العميل قبل موافقته عليه.
   - تقديم تقرير في نهاية كل دورة يبين ما أُنجز مقارنة بما اتُّفق عليه.
6. **التزامات العميل** — يلتزم العميل بما يلي:
   - تزويد الوكالة بالمعلومات والمواد والصلاحيات اللازمة لتنفيذ العمل في الوقت المناسب، بما فيها صلاحيات الوصول إلى حساباته على المنصات.
   - تسمية شخص مخوّل باعتماد الأعمال والرد على طلبات الموافقة خلال ثلاثة أيام عمل، ويحق للوكالة تأجيل المواعيد المتأثرة بمقدار أي تأخير في الرد.
   - صحة المعلومات والادعاءات المتعلقة بمنتجاته وخدماته، وحيازته للتراخيص اللازمة لها، وتحمّله المسؤولية عنها.
   - سداد الأتعاب في مواعيدها وفق المادة الخاصة بالأتعاب.
7. **الموافقات وجولات التعديل** — تُرسل الأعمال إلى العميل للموافقة عبر قنوات التواصل المعتمدة. تشمل الأتعاب جولات التعديل المحددة لكل بند في نطاق الخدمات، وأي تعديل يتجاوزها أو يغيّر الفكرة أو المادة المعتمدة يُعد عملاً إضافياً تُقدَّم له تسعيرة مستقلة.
8. **الأعمال الإضافية وتعديل العقد** — أي خدمة أو كمية خارج نطاق الخدمات تتطلب عرض سعر مستقلاً أو ملحقاً لهذا العقد يوافق عليه الطرفان. ولا يُعدَّل هذا العقد إلا بملحق مكتوب مرقّم، ويُعد كل ملحق جزءاً لا يتجزأ منه.
9. **الملكية الفكرية** — تنتقل إلى العميل ملكية الأعمال النهائية المعتمدة بعد سداد أتعابها كاملة. وتحتفظ الوكالة بالملفات المصدرية والمسودات والأفكار غير المعتمدة ما لم يُتفق على غير ذلك. ويحق للوكالة عرض الأعمال المنجزة ضمن معرض أعمالها ما لم يعترض العميل كتابياً. وتخضع العناصر المرخصة من أطراف ثالثة (كالصور والخطوط والموسيقى) لشروط تراخيصها.
10. **السرية** — يلتزم الطرفان بالحفاظ على سرية المعلومات التي يطّلع عليها كل منهما بسبب هذا العقد، وعدم استخدامها لغير أغراضه، وتلتزم الوكالة باستخدام بيانات الدخول إلى حسابات العميل لتنفيذ الخدمات فقط. ويستمر هذا الالتزام سنتين بعد انتهاء العقد.
11. **الحسابات والمنصات والنتائج** — تبقى حسابات العميل على المنصات ملكاً له. ولا تتحمل الوكالة مسؤولية سياسات المنصات أو قراراتها، كإيقاف الحسابات أو رفض الإعلانات أو تغيير خوارزميات الوصول. وتبذل الوكالة أفضل جهودها لتحقيق أهداف العميل، دون أن تضمن أرقاماً محددة من المتابعين أو المبيعات أو النتائج.
12. **الإيقاف المؤقت** — يجوز إيقاف الخدمات مؤقتاً باتفاق الطرفين. ولا يغيّر الإيقاف تواريخ الدورات، وتبقى أتعاب الدورات المشمولة بمدة هذا العقد مستحقة خلاله ما لم يتفق الطرفان على غير ذلك بملحق.
13. **إنهاء العقد** — يحق لأي من الطرفين إنهاء هذا العقد إذا أخلّ الطرف الآخر بأحد التزاماته الجوهرية ولم يعالج الإخلال خلال خمسة عشر يوماً من إخطاره كتابياً. وإذا أنهى العميل العقد قبل انتهاء مدته لغير هذا السبب، تبقى أتعاب الدورة الجارية مستحقة، ولا تُرد الأتعاب المدفوعة عن دورات بدأت، ويُستحق أي رسم إنهاء متفق عليه. وعند انتهاء العقد تسلّم الوكالة الأعمال المعتمدة المسددة أتعابها، ويستعيد العميل صلاحيات حساباته.
14. **القوة القاهرة** — لا يُسأل أي من الطرفين عن التأخير أو الإخفاق في تنفيذ التزاماته إذا نتج عن قوة قاهرة خارجة عن إرادته، كالكوارث وانقطاع الاتصالات أو الكهرباء العام والقرارات الرسمية، على أن يُخطر الطرف الآخر بها فور حدوثها، وتُستأنف الالتزامات بزوالها.
15. **المراسلات والإخطارات** — تُعد العناوين وأرقام الهواتف والبريد الإلكتروني المبينة في هذا العقد معتمدة للتواصل بين الطرفين، وتُعد الرسائل المرسلة عبرها، بما فيها رسائل البريد الإلكتروني وتطبيقات المراسلة، إخطاراً كتابياً. ويلتزم كل طرف بإبلاغ الآخر بأي تغيير فيها.
16. **القانون الواجب التطبيق وحل النزاعات** — يخضع هذا العقد للقوانين النافذة في الجمهورية العربية السورية. ويسعى الطرفان إلى حل أي خلاف ودياً خلال خمسة عشر يوماً من نشوئه، فإن تعذّر ذلك فالاختصاص للمحاكم المختصة في مكان مقر الوكالة.
17. **أحكام ختامية** — حُرر هذا العقد من نسختين أصليتين بيد كل طرف نسخة للعمل بموجبها. ويُعد عرض السعر المعتمد وملاحق هذا العقد جزءاً لا يتجزأ منه، وفي حال التعارض تُقدَّم أحكام الملحق الأحدث ثم هذا العقد ثم عرض السعر.
