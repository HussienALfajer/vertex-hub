# 0023 — Quotes: catalog-priced sections, versions, discount approval and acceptance into engagements
Status: Accepted · Date: 2026-10-02

## Context
F04 (`docs/specs/F04-catalog-quotes.md`) adds the service catalog and quotes, and A01 turns an accepted quote into work. Projects and retainers (ADR 0015), templates (ADR 0017), revision limits (ADR 0016), files (ADR 0019) and the PDF worker (ADR 0008) already exist, so the quote has to feed them rather than duplicate them. The owner decided: quotes are for registered clients only; one quote may hold a one-off section and a monthly section; discounts of 10 % or more against catalog prices need the General Manager; a sent quote is locked and changes become a new version; the client's answer is recorded by hand; acceptance opens a confirmation dialog that creates or renews the engagements; catalog prices are in USD with an optional SYP price and no conversion; no tax; Arabic-only PDF.

## Decision
- **Catalog.** Services carry a billing (`one_off` or `monthly`), a USD price and an optional SYP price, revision rounds, an optional counted deliverable kind (monthly) and an optional template. Packages (monthly or one-off) group services with quantities under one price. Quote lines copy names, prices and revision rounds, so catalog edits never change quotes.
- **One quote, two sections.** A one-off section (paid by percentage installments, tied to milestones on acceptance) becomes **one** project; a monthly section (a monthly fee and an optional term) becomes a retainer, or renews an existing one of the same currency. Either section may be empty.
- **Effective discount.** Each section's discount is measured as (list − net) ÷ list, where list uses the catalog price in the quote's currency at the time the line was added or the version created (the line's own price when there is none). At or above the configurable threshold (default 10 %), sending needs the General Manager's approval; any later change clears it. One pure function in `packages/contracts` computes totals, discounts and installment amounts for the API, the web and the PDF.
- **Versions, not edits.** A sent quote is immutable. A new version shares the number (`Q-<year>-<number> v<n>`), and sending it supersedes the previous one. `superseded` is added to the scope's five states. An expired quote can be extended without a new version because its prices did not change.
- **PDF.** The API freezes a render payload on the version and queues a job; the worker renders it with Chromium and writes the bytes to file storage; an API job attaches them as a document of the quote (new F10 owner type `quote`). Draft previews use the same path with a watermark and are not kept.
- **Acceptance (A01, engagement part).** One transaction records the response, creates the project (milestones from the templates' stages, installments attached to milestones, templates applied with the line's revision rounds) and creates or renews the retainer (counted lines merged by kind and label, the fee, the renewal date from the term, the monthly template), then notifies. Any refused rule rolls back the whole acceptance. The invoice part of A01 belongs to F13.
- **Revision rounds reach the tasks.** F07 runs accept a revision limit override, and retainer deliverable and cycle lines gain an optional revision limit used for the tasks generated for them.
- **Modules.** New `catalog` and `quotes` modules. `quotes` reaches `projects` through an exported `EngagementFactory` and `templates` through an exported `TemplateRunner`; neither of those modules imports `quotes`.

## Consequences
- F13 drafts the first invoices from the stored nets and installments of the accepted quote, and invoices milestones whose installments came from it.
- F03 later attaches quotes to leads and converts a won lead into a client before acceptance.
- F15 reads quote states, versions and rejection reasons for conversion reports.
- SYP quotes need SYP catalog prices (or hand pricing) to be checked against the threshold; there is no exchange rate in quotes.
