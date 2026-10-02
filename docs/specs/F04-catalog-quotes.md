# F04 — Service catalog and quotes

Status: Approved · Date: 2026-10-02 · Scope: `docs/product/v1-scope.md` §F04 (and the engagement part of A01) · ADRs: 0006, 0007, 0008, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0023

## Summary
Prices live in people's heads, quotes are typed by hand in different formats, discounts are given without anyone above agreeing, and when a client says yes the project or retainer is set up again from memory. F04 adds a **service catalog** (services with a default price, performing department, allowed revision rounds, an optional counted deliverable kind and a work template) and **packages** (monthly, like "Gold social: 12 designs + 4 reels + monthly report", or one-off), and a **quote builder**: a quote for a client in one currency with a one-off section (paid in installments tied to milestones) and a monthly section (a monthly fee with an optional term). Discounts of 10 % or more, measured against the catalog prices, need the General Manager's approval before sending. A sent quote is locked, rendered as a branded Arabic PDF and versioned when it changes; it expires after its validity. Recording the client's acceptance runs the engagement part of **A01**: one confirmation dialog creates the project (milestones, installments, tasks from the services' templates) and the retainer (deliverable lines, fee, renewal date, monthly template), or renews an existing retainer, with each line's revision rounds carried to the tasks, and notifies the account manager and the department managers.

## In scope / out of scope
- In:
  - Catalog services: create, edit, archive and restore. Name, description, performing department, billing (`one_off` or `monthly`), USD price and optional SYP price, revision rounds, a counted deliverable kind (monthly services, optional) and a work template (optional).
  - Catalog packages, monthly or one-off: services with quantities, a package price (USD, optional SYP), and for monthly packages a monthly template.
  - Quote settings: company details and default terms printed on the PDF, default validity (14 days), discount threshold (10 %).
  - Quotes: one client, one currency, a title, an optional addressee contact, a one-off section and a monthly section (either or both), lines from services or packages with editable quantity, price and revision rounds, a discount per section, installments (name and percentage) for the one-off section, an optional term in months for the monthly section, notes and terms for the client, a validity.
  - States `draft → sent → accepted | rejected | expired`, plus `superseded` for a version replaced by a newer one; discount approval on drafts; versions (`Q-2026-0007 v2`); extending an expired quote; automatic expiry by a daily job.
  - Branded Arabic PDF rendered by the worker (Chromium): a draft preview with a "draft" mark, and the frozen PDF of every sent version kept as a document of the quote.
  - Recording the client's response by hand: accepted (contact, date, note, optional proof file) or rejected (reason from a fixed list, note).
  - **A01, engagement part:** the accept dialog creates the project and/or the retainer, or renews an existing retainer, applies the templates and notifies (rules A1–A12).
  - The revision rounds of each quote line carried to generated tasks: a per-run override in F07 and a new revision limit on retainer deliverable lines (F05 change).
  - Screens: catalog (services, packages), quote settings, quote list, quote builder, quote page, the client's Quotes tab, the "From quote" link on project and retainer pages.
- Out (later or never):
  - The first invoice drafted on acceptance (A01 invoice part) and invoices from installments: F13.
  - Quotes for leads and converting a won lead: F03 (owner decision: quotes are for registered clients only in F04).
  - Sending the quote by email (Q5, Phase 4) or through a client link; the client's approval link stays an F09 feature for work. The PDF is downloaded and sent by hand (WhatsApp).
  - E-signature, a legal contract editor, taxes (owner decision: no tax in V1), PDF in English (owner decision: Arabic only), exchange-rate conversion inside quotes (owner decision), free-text lines outside the catalog.
  - Several projects from one quote (owner decision: the one-off section becomes one project; write two quotes for two projects); changing an existing project from a quote (the one-off section always creates a new project).
  - Conversion and revenue reports: F15 reads quote states and rejection reasons.

## Roles and access

### Permission map changes (from `packages/contracts/src/permissions.ts`)
- `catalog.manage`: General Manager `all` (unchanged); new department capability for the Internal Operations **manager** `all` (owner decision). The Operations manager also gets `catalog.read` `all`.
- `quotes.read` and `quotes.manage`: new department capability for the Internal Operations manager, `all` (owner decision). Account Manager keeps `own_clients` for both; Finance keeps `quotes.read` `all`; General Manager keeps everything.
- `quotes.approve_discount`: General Manager only (unchanged).
- Every holder of `quotes.read` also holds `invoices.read` with the same or a wider scope, so quotes are shown with their amounts and need no separate money rule.

### Actions
| Action | Permission | Roles and scope |
|---|---|---|
| List and open services and packages (non-archived) | `catalog.read` | General Manager, Operations manager, Department Managers, Account Managers, Finance: all |
| Create, edit, archive and restore services and packages; see archived ones | `catalog.manage` | General Manager, Operations manager |
| Read quote settings | `quotes.read` | every quote reader |
| Edit company details, default terms, default validity | `catalog.manage` | General Manager, Operations manager |
| Edit the discount threshold | `quotes.approve_discount` | General Manager |
| List and open quotes, download PDFs | `quotes.read` | General Manager, Operations manager, Finance: all · Account Manager: own_clients |
| Create, edit, archive (discard) drafts; request discount approval; mark sent; extend; record rejection; create a new version | `quotes.manage` | General Manager, Operations manager: all · Account Manager: own_clients |
| Approve or return a discount | `quotes.approve_discount` | General Manager |
| Record acceptance and run A01 | `quotes.manage` + `projects.manage` covering the client | General Manager, Operations manager: all · Account Manager: own_clients |

"Operations manager" means the manager of Internal Operations, as in F01, F02 and F05. "Client scope" below means `quotes.manage` with `all`, or `own_clients` covering the quote's client.

## Data

Module ownership: a new `catalog` module owns the catalog tables and exports a `CatalogDirectory` (services and packages with their items, prices and template ids). A new `quotes` module owns the quote tables and the settings. `quotes` imports `catalog`, `clients` (`ClientDirectory`), `projects` (a new exported `EngagementFactory` that creates a project with milestones, a retainer with deliverable lines and template link, and renews a retainer, inside the caller's transaction, with F05's rules and audit), `templates` (a new exported `TemplateRunner` that applies a template to a project as F07's apply does, with the revision override below), `files` (owner policy for `quote`), `notifications` and `auth`. `catalog` reads template names and kinds through a new `templates` export (`TemplateDirectory`).

Money fields are integer minor units (ADR 0006). Catalog prices name their currency in the column (`price_usd_minor`, `price_syp_minor`); quote amounts are in the quote's `currency`. Dates without a time are calendar days in Asia/Damascus.

### `catalog_services` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `name` | text | required, trimmed, 1–120 chars; unique case-insensitively among non-archived services (`SERVICE_NAME_TAKEN`) |
| `description` | text | optional, ≤ 1000 chars; copied to quote lines and printed |
| `department` | department code | required; the performing department |
| `billing` | enum `catalog_billing` (`one_off`, `monthly`) | required; cannot change after the service is used in a package or a quote (`SERVICE_IN_USE`) |
| `price_usd_minor` | bigint | required, ≥ 0; per unit (one-off) or per unit per month (monthly) |
| `price_syp_minor` | bigint | optional, ≥ 0 |
| `revision_rounds` | integer | required, 0–20, default 2 |
| `deliverable_kind`, `deliverable_label` | `deliverable_kind` enum (F05), text | optional, `monthly` only; set = the service is **counted** and becomes a retainer deliverable line; label 1–60 chars, required for `other` |
| `template_id` | uuid → `work_templates.id` | optional; a `project` template for `one_off`, a `retainer_cycle` template for `monthly` (`INVALID_TEMPLATE`) |
| timestamps, `archived_at` | | archived = no longer offered in the builder or packages; existing quotes keep their copied lines |

### `catalog_packages` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `name` | text | required, 1–120 chars; unique case-insensitively among non-archived packages (`PACKAGE_NAME_TAKEN`) |
| `description` | text | optional, ≤ 1000 chars |
| `billing` | `catalog_billing` | required; cannot change after use |
| `price_usd_minor`, `price_syp_minor` | bigint | USD required, SYP optional, ≥ 0; the package price (per month for monthly packages) |
| `template_id` | uuid → `work_templates.id` | optional, `monthly` only, a `retainer_cycle` template; one-off packages use their services' templates |
| timestamps, `archived_at` | | as for services |

### `catalog_package_items` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `package_id` | uuid → `catalog_packages.id` | required, indexed |
| `service_id` | uuid → `catalog_services.id` | required; same `billing` as the package (`INVALID_PACKAGE_ITEM`); unique per package |
| `quantity` | integer | required, 1–999 (per month for monthly) |
| `position` | integer | order |

1–20 items per package; the items are replaced as a whole on save. Items have no price of their own: the package has one price.

### `quote_settings` (single row)
| Field | Type | Rules |
|---|---|---|
| `company_details` | text | ≤ 600 chars; printed in the PDF header and footer (name, address, phones, email, website) |
| `default_terms` | text | ≤ 4000 chars; copied into each new quote |
| `default_validity_days` | integer | 1–90, default 14 (owner decision) |
| `discount_threshold_percent` | integer | 1–100, default 10 (owner decision) |
| `updated_at`, `updated_by_id` | | |

Seeded by the migration with the defaults and empty texts.

### `quotes` (business table; one row per version)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `year`, `number`, `version` | integer ×3 | `year` and `number` assigned at creation from `quote_numbers` (rule 2) and shared by every version; `version` from 1; unique `(year, number, version)`. Display `Q-<year>-<number padded to 4>` and ` v<version>` when > 1 |
| `client_id` | uuid → `clients.id` | required, indexed; the same for every version |
| `contact_id` | uuid → `client_contacts.id` | optional addressee; a non-archived contact of the client when set (`UNKNOWN_CONTACT`) |
| `title` | text | required, 1–120 chars; the default project and retainer name |
| `currency` | `currency` enum | required, default `USD` |
| `status` | enum `quote_status` (`draft`, `sent`, `accepted`, `rejected`, `expired`, `superseded`) | required, default `draft`, indexed |
| `discount_approval` | enum `discount_approval` (`none`, `pending`, `approved`, `returned`) | required, default `none` |
| `discount_decided_by_id`, `discount_decided_at`, `discount_note` | uuid, timestamptz, text | the last decision; note ≤ 500 chars, required when returning |
| `one_off_discount_minor`, `monthly_discount_minor` | bigint | required, default 0, ≥ 0, ≤ the section's subtotal (`INVALID_DISCOUNT`) |
| `monthly_term_months` | integer | optional, 1–36 (owner decision) |
| `validity_days` | integer | required, 1–90, default from settings |
| `valid_until` | date | set when sent: sent day + `validity_days`; replaced on extend |
| `client_notes` | text | optional, ≤ 2000 chars, printed |
| `terms` | text | ≤ 4000 chars, printed; copied from the settings at creation |
| `sent_at`, `sent_by_id` | | set when sent |
| `responded_on`, `response_contact_id`, `response_note`, `responded_by_id` | date, uuid, text, uuid | the client's answer as recorded; note ≤ 1000 chars |
| `rejection_reason` | enum `quote_rejection_reason` (`price`, `timing`, `competitor`, `scope`, `no_response`, `other`) | required when rejected; `other` needs a note (owner decision) |
| `project_id`, `retainer_id` | uuid → `projects.id`, `retainers.id` | set by A01; `retainer_id` is the created or renewed retainer |
| `snapshot` | jsonb | the frozen render payload of a sent version (rule 12) |
| `pdf_status`, `pdf_file_item_id` | enum `quote_pdf_status` (`pending`, `ready`, `failed`), uuid → `file_items.id` | the PDF of a sent version (rule 12): set `pending` on send, `ready` with the attached document, `failed` after the worker's last retry |
| `draft_pdf_status`, `draft_pdf_requested_hash` | `quote_pdf_status`, text | the draft preview asked for last and its payload hash (rule 13) |
| `draft_pdf_object_key`, `draft_pdf_at`, `draft_pdf_hash` | text, timestamptz, text | the last draft preview rendered (rule 13) |
| `created_by_id` | uuid → `users.id` | from the session |
| timestamps, `archived_at` | | archived = a discarded draft (only drafts can be archived): hidden, read-only; visible to scope-all holders |

### `quote_numbers` (counter)
`year` (primary key), `last_number`. Locked and incremented in the transaction that creates version 1.

### `quote_lines` (business table)
| Field | Type | Rules |
|---|---|---|
| `id` | uuid | `id()` |
| `quote_id` | uuid → `quotes.id` | required, indexed |
| `section` | enum `quote_section` (`one_off`, `monthly`) | required; the service's or package's billing |
| `service_id` / `package_id` | uuid → catalog | exactly one set (check constraint) |
| `name`, `description` | text | copied from the catalog at add; description editable (≤ 1000) |
| `department` | department code | service lines: copied from the service |
| `quantity` | integer | 1–999; always 1 for package lines |
| `unit_price_minor` | bigint | required, ≥ 0, in the quote's currency; prefilled from the catalog price in that currency, editable |
| `list_unit_price_minor` | bigint | the catalog price in the quote's currency when the line was added or the version created; null when the catalog has no price in that currency |
| `revision_rounds` | integer | service lines: 0–20, from the service, editable |
| `deliverable_kind`, `deliverable_label` | | monthly service lines: copied from the service |
| `template_id` | uuid | copied from the service or package, editable in the accept dialog only |
| `position` | integer | order within the section |

### `quote_line_items` (business table; the services inside a package line)
`id`, `line_id` → `quote_lines.id` (indexed), `service_id`, `name`, `department`, `quantity` (1–999, editable), `revision_rounds` (0–20, editable), `deliverable_kind`, `deliverable_label`, `template_id` (one-off items), `position`. Copied from the package when the line is added.

### `quote_installments` (business table)
`id`, `quote_id` (indexed), `name` (1–60 chars), `percent` (integer 1–100), `position`. 1–10 installments, percentages summing to 100 (`INVALID_INSTALLMENTS`), required when the one-off section has lines; none otherwise.

Limits: 50 lines per quote, 20 items per package line. Every child table is replaced with its quote version, never edited after the version is sent.

### Changes to other modules
- F05 `retainer_deliverables` and `retainer_cycle_lines` gain `revision_limit` (integer 0–20, optional); copied to cycle lines like `kind` and `label`. Editable on the retainer's deliverable lines editor; null means "the template's".
- F07: a template run accepts an optional `revisionLimit` that replaces every step's revision limit (project runs from A01); cycle runs give tasks generated for a cycle line (repeat steps) the line's `revision_limit` when set.
- F10: `file_owner_type` gains `quote`; `file_items.quote_id`. The `quotes` module registers the owner policy: readable by quote readers of the client and read-only: the quote attaches the PDF of each sent version itself, and nobody versions, renames, removes or adds quote documents through the file endpoints, so the frozen PDF stays as sent (settled in PR 3). Quote documents are confidential to quote readers.

## States and rules

### Quote status
```
draft ──send (rule 6)──→ sent ──accept (A01)──→ accepted
                          sent ──reject──→ rejected
                          sent ──daily job, valid_until passed──→ expired ──extend──→ sent
                       expired ──reject──→ rejected
sent | expired ──newer version sent──→ superseded
draft ──archive (discard)──→ archived
```
Discount approval on a draft: `none | returned ──request──→ pending ──approve──→ approved`, `pending ──return (note)──→ returned`, `pending ──withdraw──→ none`.

### Building
1. A quote is created only for a non-archived client whose status is `active` or `paused` (`CLIENT_ARCHIVED`, `CLIENT_ENDED`); the same check repeats on send and accept.
2. Numbering: version 1 takes the next number of the current year (Asia/Damascus), starting at 1 each year; numbers are never reused, including for discarded drafts.
3. Only a `draft` is editable (`QUOTE_LOCKED`), and not while its discount approval is `pending` (`APPROVAL_PENDING`). The currency can change while drafting; changing it re-prices every line from the catalog in the new currency (lines without a price there keep 0 and must be priced by hand).
4. Lines come only from non-archived services and packages (`CATALOG_ITEM_ARCHIVED`); a service or package archived later stays on drafts with a warning and can be removed.
5. Totals, all in the quote's currency and integer minor units, computed by one pure function in `packages/contracts` (`quoteTotals`) used by the API, the web and the PDF:
   - line total = `quantity × unit_price_minor`; section subtotal = Σ line totals; section net = subtotal − section discount.
   - section list = Σ `quantity × list_unit_price_minor`, using `unit_price_minor` where the list price is null.
   - **effective discount** of a section = (list − net) ÷ list, as a percentage with two decimals (the API sends `effectiveDiscountBasisPoints`, rounded half up); 0 when list is 0 or the net is above the list.
   - installment amount = ⌊one-off net × percent ÷ 100⌋, the remainder added to the last installment, so the installments always sum to the one-off net.
   - The monthly net is per month; the PDF also shows net × `monthly_term_months` when a term is set.
6. **Send** requires: at least one line; valid installments when there are one-off lines; every line priced (a 0 price needs `confirmZeroPrice`); and discount approval `approved` when either section's effective discount is ≥ the threshold (`DISCOUNT_APPROVAL_REQUIRED`). A sender who holds `quotes.approve_discount` (the General Manager) needs no request: sending records the approval. Sending freezes the snapshot, sets `sent_at` and `valid_until`, queues the PDF (rule 12) and supersedes the previous version when it is `sent` or `expired`.
7. **Discount approval** is requested only when it is needed (`APPROVAL_NOT_NEEDED`). The approver sees the effective discounts against the threshold. Any change to lines, prices, quantities, discounts or currency after approval sets it back to `none` (and returns 409 `APPROVAL_PENDING` while pending). The threshold in force is the one at send time.
8. **Versions:** "New version" is allowed on the latest version when it is `sent`, `expired` or `rejected` and no newer draft exists (`VERSION_EXISTS`); never on `accepted`. It copies the version's fields, lines, items and installments into a new `draft` with the next `version`, refreshes `list_unit_price_minor` from the current catalog (prices are not changed), and resets approval and response fields. The previous version keeps its state until the new one is sent (rule 6); rejected versions stay rejected.
9. **Expiry:** the daily `quotes.daily` job sets `expired` on every `sent` quote whose `valid_until` is before today. Idempotent.
10. **Extend:** an `expired` quote returns to `sent` with a new `valid_until` (≥ today, ≤ today + 90 days); prices and PDF are unchanged (owner decision). An expired quote cannot be accepted until extended (`QUOTE_EXPIRED`).
11. **Reject:** from `sent` or `expired`, with a reason, an optional contact, the response date (≤ today, ≥ the sent day) and a note (required for `other`). Final: a later deal starts with a new version.
12. **PDF of a sent version:** the API stores the render payload (company details, client, addressee, lines and items, totals, installments, term, notes, terms, dates, number) in `snapshot` and queues `quotes.pdf`; the worker renders it with Chromium from an Arabic RTL HTML template in the brand (fallback font until Q11) and writes the bytes to file storage; a `quotes.pdf-ready` job worked by the API attaches them as a `document` file item of the quote named `<number> v<version>.pdf`. Rendering is idempotent per version; the quote page shows "PDF being prepared" until it exists and offers "Render again" after a failure. The job carries the payload and its SHA-256 (over sorted-key JSON, so the `jsonb` round trip keeps it); the worker writes `objects/quotes/<quote id>/<hash>.pdf` under `FILES_ROOT` once and reports it, and the API attaches it once (system actor in the audit, created by the sender). The daily job queues again the sent versions still `pending`. PDF state changes keep `updated_at` (edge case 1).
13. **Draft preview:** "Preview PDF" on a draft queues the same render with a "draft" watermark from the current draft; the result replaces the previous preview (`draft_pdf_*`, old object deleted) and is discarded when the quote is sent or archived. A result whose hash no longer matches the draft is shown as outdated. A result for a hash that is no longer the one asked for is deleted; asking again for an unchanged draft whose preview is ready renders nothing.
14. A quote shows no internal list prices or effective discounts in its PDF; those appear only in the app.

### Acceptance and A01
- A1. **Accept** is allowed on a `sent` quote (`INVALID_TRANSITION`, `QUOTE_EXPIRED`), by a client-scope holder who also holds `projects.manage` over the client. It records the response date (≤ today, ≥ the sent day), an optional contact, a note and an optional proof file (an F10 upload attached as a document of the quote).
- A2. The accept dialog collects, for the **one-off section** (when it has lines): project name (default: the quote title), project manager (default: the client's account manager), departments (default: the departments of the section's services and package items), start date (default today), due date (default: the latest due date of the templates' plan, or start + 30 days without templates; editable), the templates to apply (default: the distinct templates of the section's services and package items, in line order; each can be unticked), and the milestone of each installment.
- A3. **Milestones** of the new project: the stages of the selected templates in order, de-duplicated by name; without templates, one milestone per installment named after it. Each installment is attached to one milestone (default: the first installment to the first milestone, the last to the last, the others in order); a milestone's `installment_minor` is the sum of its installments. Templates are then applied to the project (their stages map to these milestones by name, F07).
- A4. Each template is applied once, with its default assignees, the project start date, and a revision limit equal to the highest `revision_rounds` of the lines and items that brought it. Tasks are created with no creator (F07).
- A5. For the **monthly section** (when it has lines), the dialog offers **New retainer** or **Renew** an existing `active` or `paused` retainer of the client in the same currency (owner decision). New retainer: name (default: the quote title), departments (from the lines), start date (default today), renewal date (start + `monthly_term_months` when set, editable), monthly template (default: the package's, else the first monthly service's with a template, else none), currency and `monthly_fee_minor` = the monthly net.
- A6. **Deliverable lines** from the monthly section: one line per counted service line or package item, merged by `(kind, label)` with quantities summed and the highest revision rounds as the line's `revision_limit`; uncounted services appear only in the quote and its PDF (owner decision). More than 20 merged lines is refused (`LIMIT_REACHED`).
- A7. **Renew** replaces the retainer's deliverable lines with the quote's (F05 R10: from the next cycle; the open cycle is unchanged), sets the monthly fee (F13 reads it when the next cycle's invoice is drafted), sets the renewal date to the first day of next month + the term when a term is set (otherwise unchanged), and replaces the template link when one is chosen.
- A8. A new retainer whose start date is today or earlier opens its current cycle in the same transaction (F05 R3) after the template link is set, so F07 generates the month's tasks.
- A9. Everything in A1–A8 happens in one transaction: the quote becomes `accepted` with `project_id` and `retainer_id`, the engagements and tasks exist, the audit entries are written. Any failure (an archived template, a refused F05 rule) rolls everything back and returns its error code; the dialog shows it and keeps the inputs.
- A10. A newer draft version of the accepted quote is archived in the same transaction.
- A11. Notifications (`quote_accepted`): the client's account manager and the managers of the departments of the created or renewed engagements, except the actor. The project manager gets F14's `project_manager_assigned` as for any new project.
- A12. A01's invoice part (first invoice draft) is added by F13; the quote keeps the one-off net, installments and monthly net it needs.
- Settled in PR 4: the new project is `planned`; each template run starts on the later of the project's start date and today (F07 rule 6), and its tasks have no creator while the run is recorded as the accepting user's. A milestone's due date is its stage's latest task; a milestone without installments has no installment amount. Without stages in the selected templates, the milestones are the installments (A3). A package item counts its quantity per month (A6). Renewing keeps the identity of lines with the same kind and label (R10). The proof keeps its uploaded name (`FILE_NAME_TAKEN` when the quote has a document of that name). A11's departments are the project's and the new retainer's chosen ones, or the renewed retainer's.

### Catalog rules
- C1. Archiving a service used by a non-archived package is refused (`SERVICE_IN_PACKAGE`, listing the packages); archive or edit the packages first.
- C2. Editing prices never changes existing quotes: lines copy prices at add time.
- C3. A template linked to a service or package must be non-archived when saved; a template archived later is skipped by the accept dialog with a warning.
- C4. A counted monthly service must have a valid `(kind, label)` per F05; `other` needs a label.

### General
- G1. Every change writes an audit entry in the same transaction; the expiry job writes entries with a null actor.
- G2. Archiving a client (F02) hides its quotes with it (read-only, excluded from lists); the expiry job still expires them.
- G3. A change of the client's account manager moves `own_clients` access to its quotes at once.

## API

Schemas live in `packages/contracts/src/catalog.ts` and `quotes.ts` (with `quoteTotals`), reusing the list, money and error schemas. Lists take `page` and `pageSize` and return `{ items, total, page, pageSize }`. A record outside the caller's access is a 404. Detail responses carry `permissions` flags for the UI.

### Catalog
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/catalog/services` | `catalog.read` | `catalogServiceListQuerySchema`: `search`, `billing`, `department`, `archived` (manage) | `catalogServicePageSchema`: all fields + template (id, name, kind, archived) | — |
| `POST /api/catalog/services` | `catalog.manage` | `createCatalogServiceSchema` | `catalogServiceSchema` | 403, `SERVICE_NAME_TAKEN`, `INVALID_TEMPLATE` (400) |
| `PATCH /api/catalog/services/:id` | `catalog.manage` | `updateCatalogServiceSchema`: same, optional; rules checked on the merged service | `catalogServiceSchema` | 403, 404, `SERVICE_ARCHIVED`, `SERVICE_NAME_TAKEN`, `SERVICE_IN_USE`, `INVALID_TEMPLATE` |
| `POST /api/catalog/services/:id/archive` · `/restore` | `catalog.manage` | — | `catalogServiceSchema` | 403, 404, `SERVICE_IN_PACKAGE` (details: the packages), `SERVICE_ARCHIVED`, `SERVICE_NOT_ARCHIVED`, `SERVICE_NAME_TAKEN` |
| `GET /api/catalog/packages` | `catalog.read` | `catalogPackageListQuerySchema`: `search`, `billing`, `archived` (manage) | `catalogPackagePageSchema`: fields + items (service id, name, department, quantity, counted kind, archived) | — |
| `GET /api/catalog/packages/:id` | `catalog.read` | — | `catalogPackageSchema` | 404 (archived ones without `catalog.manage` too) |
| `POST /api/catalog/packages` | `catalog.manage` | `createCatalogPackageSchema` with `items[]` (1–20, checked by the schema) | `catalogPackageSchema` | 403, `PACKAGE_NAME_TAKEN`, `INVALID_PACKAGE_ITEM` (400, details: the service ids), `INVALID_TEMPLATE` |
| `PATCH /api/catalog/packages/:id` | `catalog.manage` | `updateCatalogPackageSchema`: same, optional; `items` replaces every item | `catalogPackageSchema` | 403, 404, `PACKAGE_ARCHIVED`, `PACKAGE_NAME_TAKEN`, `INVALID_PACKAGE_ITEM`, `INVALID_TEMPLATE`, `SERVICE_IN_USE` (once quotes exist) |
| `POST /api/catalog/packages/:id/archive` · `/restore` | `catalog.manage` | — | `catalogPackageSchema` | 403, 404, `PACKAGE_ARCHIVED`, `PACKAGE_NOT_ARCHIVED`, `PACKAGE_NAME_TAKEN` |

### Quote settings
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/quote-settings` | `quotes.read` | — | `quoteSettingsSchema` + `canEdit`, `canEditThreshold` | — |
| `PATCH /api/quote-settings` | any session; the service answers 403 unless `catalog.manage` (texts, validity) and `quotes.approve_discount` (threshold) cover the fields sent | `updateQuoteSettingsSchema` | `quoteSettingsSchema` | 403 |

### Quotes
| Method and path | Permission | Request | Response | Error codes |
|---|---|---|---|---|
| `GET /api/quotes` | `quotes.read` | `quoteListQuerySchema`: `search` (number, title, client), `status[]` (default `draft`, `sent`, `expired`), `clientId`, `accountManagerId`, `approval` (`pending`), `projectId`, `retainerId`, `archived` (scope all), `latestOnly` (default true), `sort` (`updatedAt` default, `number`, `validUntil`), `order` | `quotePageSchema`: id, display number, version, title, client (id, name), account manager, currency, status, approval, one-off net, monthly net, valid until, `expiresSoon` (≤ 3 days) | — |
| `GET /api/quotes/:id` | `quotes.read` | — | `quoteDetailSchema`: all fields, lines with items, installments with amounts, totals and effective discounts, threshold, versions (id, version, status), PDF and draft preview state, response, project and retainer links, `permissions` | 404 |
| `POST /api/quotes` | `quotes.manage` (client scope) | `createQuoteSchema`: clientId, contactId, title, currency | `quoteDetailSchema` | 403, `CLIENT_ARCHIVED`, `CLIENT_ENDED`, `UNKNOWN_CONTACT` |
| `PUT /api/quotes/:id` | `quotes.manage` | `quoteDraftSchema`: updatedAt (edge case 1), contactId, title, currency, validityDays, discounts, monthlyTermMonths, clientNotes, terms, lines[] (id?, section, serviceId or packageId, description, quantity, unitPriceMinor, revisionRounds, items[] (serviceId, quantity, revisionRounds)), installments[]; the whole draft | `quoteDetailSchema` | 403, 404, `QUOTE_LOCKED`, `APPROVAL_PENDING`, `STALE_QUOTE`, `CATALOG_ITEM_ARCHIVED`, `INVALID_DISCOUNT`, `INVALID_INSTALLMENTS` (a draft may still have none), `INVALID_PACKAGE_ITEM` (a package line lists other services than it was copied with), `UNKNOWN_CONTACT`, `LIMIT_REACHED`, `CLIENT_ARCHIVED` |
| `POST /api/quotes/:id/approval` | `quotes.manage` | `{ action: 'request' \| 'withdraw' }` | `quoteDetailSchema` | 403, 404, `QUOTE_LOCKED`, `APPROVAL_NOT_NEEDED`, `INVALID_TRANSITION` |
| `POST /api/quotes/:id/approval/decision` | `quotes.approve_discount` | `{ decision: 'approve' \| 'return', note }` | `quoteDetailSchema` | 403, 404, `INVALID_TRANSITION` |
| `POST /api/quotes/:id/send` | `quotes.manage` | `{ confirmZeroPrice?: boolean }` | `quoteDetailSchema` | 403, 404, `INVALID_TRANSITION`, `APPROVAL_PENDING`, `QUOTE_EMPTY`, `INVALID_INSTALLMENTS`, `ZERO_PRICE`, `DISCOUNT_APPROVAL_REQUIRED`, `CLIENT_ARCHIVED`, `CLIENT_ENDED` |
| `POST /api/quotes/:id/extend` | `quotes.manage` | `{ validUntil }` | `quoteDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES` |
| `POST /api/quotes/:id/reject` | `quotes.manage` | `{ respondedOn, contactId, reason, note }` | `quoteDetailSchema` | 403, 404, `INVALID_TRANSITION`, `INVALID_DATES`, `UNKNOWN_CONTACT`, `NOTE_REQUIRED` |
| `POST /api/quotes/:id/versions` | `quotes.manage` | — | `quoteDetailSchema` (the new draft) | 403, 404, `INVALID_TRANSITION`, `VERSION_EXISTS` |
| `POST /api/quotes/:id/archive` | `quotes.manage` | — | 204 | 403, 404, `INVALID_TRANSITION` |
| `GET /api/quotes/:id/accept-plan` | `quotes.manage` + `projects.manage` | `acceptPlanQuerySchema`: the dialog's current choices (`projectStartDate`, `chooseTemplates` with `templateIds`, `retainerStartDate`) | `acceptPlanSchema`: `sentOn`, defaults (A2–A6), milestones with installment amounts and each installment's default milestone, deliverable lines, renewable retainers, `archivedTemplates` (warnings) | 403, 404, `INVALID_TRANSITION`, `QUOTE_EXPIRED`, `CLIENT_ARCHIVED`, `CLIENT_ENDED` |
| `POST /api/quotes/:id/accept` | `quotes.manage` + `projects.manage` | `acceptQuoteSchema`: respondedOn, contactId, note, proofUploadId, project { name, projectManagerId, departments, startDate, dueDate, templateIds[], installmentMilestones[] }, retainer { mode `new` \| `renew`, retainerId, name, departments, startDate, renewalDate, templateId } | `quoteDetailSchema` | 403, 404, 400 (a section given without lines or missing), `INVALID_TRANSITION`, `QUOTE_EXPIRED`, `INVALID_DATES`, `UNKNOWN_CONTACT`, `UPLOAD_NOT_FOUND`, `FILE_NAME_TAKEN`, `INVALID_INSTALLMENTS` (an installment without one of the milestones), `TEMPLATE_ARCHIVED`, `TEMPLATE_KIND_MISMATCH`, `CURRENCY_MISMATCH`, `LIMIT_REACHED`, and the F05 codes (`INVALID_PROJECT_MANAGER`, `PROJECT_NAME_TAKEN`, `RETAINER_NAME_TAKEN`, `RETAINER_ENDED`, `CLIENT_ENDED`…) |
| `POST /api/quotes/:id/pdf` | `quotes.read` (draft preview: `quotes.manage` client scope) | — | `quotePdfRenderSchema`: `{ state }` (`pending`, `ready`) | 403, 404, `INVALID_TRANSITION` (a discarded draft) |
| `GET /api/quotes/:id/pdf` | `quotes.read` | `?draft=true` for the preview | the PDF, inline, named `<client> - Q-<year>-<number> v<version>.pdf`, never cached (served through F10's storage; the sent version's PDF is also a document of the quote) | 404 (also while not ready) |

Changes to other modules:
- F05: `retainerDeliverableSchema` and cycle lines gain `revisionLimit`; `EngagementFactory` exported from `projects`.
- F07: `TemplateRunner` and `TemplateDirectory` exported from `templates`; run input gains `revisionLimit`.
- F10: owner type `quote`; the client Files tab lists quote documents only to quote readers.
- F14: the types below.

## Screens

All screens: Arabic RTL, strings through i18next (`catalog.*`, `quotes.*`), Latin digits, money with its currency, loading, empty and error states. Navigation: "Quotes" for quote readers; "Catalog" for catalog readers.

1. **Catalog** `/catalog` — tabs **Services** and **Packages**. Services: table of name, department, billing, USD and SYP price, revision rounds, counted kind, template; filters billing and department; "New service" and row edit (dialog) for managers; archive / restore; "Archived" filter. Packages: cards with billing, price, item list ("12 designs · 4 reels · monthly report"), template; editor dialog with service picker filtered by billing and quantities. Empty: "no services yet" with "New service".
2. **Quote settings** `/catalog/settings` (managers; read-only for others) — company details, default terms, default validity; discount threshold editable by the General Manager only.
3. **Quote list** `/quotes` — table: number and version, title, client, account manager, status badge, approval badge ("awaiting approval"), one-off net, monthly net / month, valid until with "expires soon" badge. Filters: status (default draft, sent, expired), client, account manager, "awaiting my approval" (General Manager); "My clients" toggle for account managers. "New quote" (dialog: client, title, currency, addressee).
4. **Quote builder** `/quotes/$quoteId` while `draft` — two sections, "One-off" and "Monthly", each with "Add service" and "Add package" pickers (filtered by billing), line rows (name, description, quantity, unit price with the catalog price hint, revision rounds, line total; package lines expand to items with quantity and revision rounds), section discount (amount or percentage, stored as amount), subtotal, net, and the effective discount against the threshold with a "needs approval" notice. One-off: installments editor (name, %) with amounts. Monthly: term in months and the term total. Notes, terms, validity. Actions: save (autosave off; explicit save with unsaved-changes guard), "Preview PDF", "Request approval" / "Withdraw", "Send" (confirmation showing valid-until), "Discard". While approval is pending the builder is read-only with a banner; a returned approval shows the note.
5. **Quote page** `/quotes/$quoteId` when not a draft — header: number, version, client, status, valid until, sent by and when; the read-only quote as the client sees it plus effective discounts; PDF download (or "being prepared"); versions list; response block. Actions by state: "Record acceptance" (opens the accept dialog), "Record rejection" (dialog), "Extend validity" (expired), "New version"; links to the created project and retainer after acceptance. The General Manager sees "Approve" / "Return with note" on drafts awaiting approval.
6. **Accept dialog** — step 1: response date, contact, note, proof file. Step 2 (one-off): project fields, templates with ticks, milestone list with installment amounts and a milestone picker per installment. Step 3 (monthly): "New retainer" or "Renew" with a retainer picker, retainer fields, deliverable lines preview (merged, with revision limits), template. Summary step and "Accept and create". Errors stay on the dialog.
7. **Client profile** (F02) — new **Quotes** tab for quote readers: the client's latest versions with status and nets, "New quote".
8. **Project and retainer pages** (F05) — a "From quote Q-…" link in the header for quote readers.
9. **Retainer deliverable lines editor** (F05) — a revision limit column (optional).

What roles see differently: account managers see their clients' quotes only; Finance reads quotes and the catalog without actions; department managers see the catalog read-only and no quotes; the General Manager approves discounts.

## Audit, notifications and jobs
- Audit (entity `catalog_service`, `catalog_package`, `quote_settings`, `quote`; quote entries carry `clientId`, number and version): `catalog_service.created` / `updated` (before/after prices) / `archived` / `restored`; `catalog_package.created` / `updated` / `archived` / `restored`; `quote_settings.updated`; `quote.created`, `quote.updated` (one entry per save, with section nets and effective discounts before/after), `quote.approval_requested`, `quote.approval_withdrawn`, `quote.approval_approved`, `quote.approval_returned` (note), `quote.sent`, `quote.extended`, `quote.expired` (null actor), `quote.rejected` (reason), `quote.accepted` (project and retainer ids), `quote.version_created`, `quote.superseded`, `quote.archived`. A01's engagements write their own F05 and F07 entries in the same transaction. Every `audit.read` holder also reads quotes, so entries are unfiltered.
- Notifications (F14 catalog, subject `quote`, category `clients_projects`):
  - `quote_approval_requested` → General Managers (holders of `quotes.approve_discount`), action required, cannot be muted.
  - `quote_approval_decided` → the requester (approved or returned with the note), action required, cannot be muted.
  - `quote_accepted` → rule A11, informational, can be muted.
- Jobs:
  - `quotes.daily`: pg-boss cron `10 0 * * *` Asia/Damascus, scheduled by the worker and worked by the API (rule 9).
  - `quotes.pdf`: worked by the worker (Chromium render, rule 12–13), retry 3; `quotes.pdf-ready`: worked by the API (attach). Both idempotent per version or draft hash.

## Edge cases
1. Two people edit the same draft: the whole-draft `PUT` carries `updatedAt`; a stale one is refused with `STALE_QUOTE` and the builder reloads.
2. The account manager edits a draft while the General Manager approves it: the edit is refused (`APPROVAL_PENDING`); after approval any edit resets it (rule 7).
3. A quote in SYP with services that have no SYP price: those lines start at 0 and must be priced by hand; their list price is their own price, so only the section discount counts toward the effective discount on them (owner decision: no conversion).
4. A service's price changes between versions: the new version keeps the old prices but refreshes list prices, so the effective discount may cross the threshold and need approval.
5. Two accepts at once: the quote row is locked; the second gets `INVALID_TRANSITION`.
6. The client accepts version 1 while version 2 is a draft: accepting v1 archives the v2 draft (A10). Once v2 is sent, v1 is superseded and cannot be accepted.
7. The expiry job and an accept run together: both lock the row; an accept after expiry returns `QUOTE_EXPIRED` and the page offers "Extend validity".
8. A template linked to a line was archived after sending: the accept plan shows it unticked with a warning (C3).
9. Renewing a retainer whose currency differs from the quote's: not offered; the API refuses with `CURRENCY_MISMATCH`.
10. The account manager of the client changes after the quote is sent: the new one sees and manages it at once (G3); `created_by_id` and `sent_by_id` keep the history.
11. The client is paused: quotes can be made, sent and accepted; ended or archived clients are refused (rule 1).
12. A quote with only a monthly section has no installments; one with only one-off lines creates no retainer.
13. The worker is down when sending: the quote is `sent` and the PDF appears when the job runs; "Render again" re-queues it.
14. Rounding: the installments always sum to the one-off net (rule 5); the PDF prints the stored amounts.
15. A discarded draft keeps its number; the next quote gets the next number (rule 2).
16. Volume: ~20 clients and a few quotes a week need no special limits; ADR 0013 list rules apply.

## Open questions
- None blocks F04. Related, not blocking:
  - Q11: the PDF uses the fallback Arabic font until the Madani Arabic license and files arrive; the license must cover server-side PDF embedding before launch.
  - Q7: swap on the server is the safety margin for Chromium PDF rendering; required before the Phase 3 deploy.
  - Q5: sending quotes by email waits for the email provider (Phase 4).

## Acceptance
- Owner check in the browser:
  1. As the General Manager, open **Catalog**: create services "Social media design" (monthly, Design, 15 USD, counted `design`, 2 revisions), "Reel" (monthly, Photography, 60 USD, counted `reel`), "Page management" (monthly, Content Management, 100 USD, not counted), "Brand identity" (one-off, Design, 800 USD, template "Brand identity", 3 revisions). Create the monthly package "Gold social" (12 designs, 4 reels, page management ×2; 450 USD; monthly template "Monthly social media cycle").
  2. As the Operations manager, set the company details and default terms in Quote settings; check that the threshold is read-only.
  3. As a client's account manager, create a quote: "Brand identity" in the one-off section with installments 50 % "Start" and 50 % "Delivery", and "Gold social" in the monthly section with a 6-month term. Give a 15 % one-off discount: the builder says approval is needed and "Send" is blocked.
  4. Request approval. As the General Manager, find it under "awaiting my approval" (and in the bell), return it with a note; as the account manager lower the discount to 12 %, request again; approve.
  5. Preview the PDF, then send. The PDF is Arabic RTL with the brand, both sections, installments with amounts and the term; no list prices.
  6. Create a new version with a lower monthly price; send it: v1 is superseded.
  7. Record acceptance with a contact and a proof image. In the dialog: project manager, start today, the "Brand identity" template ticked, the installments mapped to milestones; new retainer starting today with renewal in 6 months. Accept.
  8. The project exists with its milestones and installments and the template's tasks with revision limit 3; the retainer has lines designs 12 and reels 4 (no page management line), the fee, the renewal date, this month's cycle and its generated tasks. The department managers got `quote_accepted`.
  9. Create another quote for the same client with only a monthly section; accept it with **Renew** on the retainer: its lines and fee change from next month; this month's cycle is unchanged.
  10. Leave a third quote sent; run the daily job with a later date: it expires; extend it; record a rejection with reason "price".
  11. As Finance, read quotes and the catalog without actions; as an ordinary employee, see neither; as another account manager, the quote is not found.
  12. Open the audit log and find each change above.
- Tests:
  - Unit (contracts): `quoteTotals` (line and section totals, discount bounds, effective discount with null list prices, above-list prices, installment rounding and remainder), schemas (limits, installments summing to 100, counted kind rules, billing match in packages), A6 line merging, permission map changes (Operations manager `catalog.manage`, `quotes.read`, `quotes.manage`), the new notification types.
  - API (`apps/api/test/catalog.test.ts`, `quotes.test.ts`, `quote-accept.test.ts`): each endpoint for success, 401, 403 and out of scope (an account manager on another manager's client; Finance on manage endpoints; an employee anywhere; the threshold edit by the Operations manager); every error code above; rules 1–14, A1–A12, C1–C4, G1–G3; numbering per year and under concurrency; the expiry job and its idempotency; the PDF ready handler attaching once; A01 in one transaction with rollback on a refused F05 rule; renew applying from the next cycle; revision limits on generated project and cycle tasks; audit entries in the same transaction.
  - Worker: the `quotes.pdf` handler renders Arabic text (a text extraction check on the output) and is safe to run twice.
  - E2E: build a quote with both sections, send it, accept it and land on the created project.
  - RTL screenshots (`apps/web/e2e/screens.spec.ts`): catalog services and packages, quote settings, quote list, builder (with the approval notice), quote page (sent, accepted), accept dialog steps, client Quotes tab, and one rendered PDF page.
