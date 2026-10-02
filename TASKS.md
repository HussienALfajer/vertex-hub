# TASKS — F04 Service catalog and quotes (with the engagement part of A01)

Spec: `docs/specs/F04-catalog-quotes.md` · ADRs 0006, 0007, 0008, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0023 · Six PRs, each leaves `main` green and fully wired.

## PR 1 — `feat/f04-catalog`: catalog end to end (services, packages)
- [x] contracts: `catalog.ts` (billing enum, service and package schemas with `.meta({ id })`, inputs, list queries and pages, counted kind rules C4, billing match and 1–20 items), permission map (Operations manager `catalog.read` + `catalog.manage` all, and `quotes.read` + `quotes.manage` all), error codes (`SERVICE_NAME_TAKEN`, `SERVICE_ARCHIVED`, `SERVICE_IN_USE`, `SERVICE_IN_PACKAGE`, `PACKAGE_NAME_TAKEN`, `PACKAGE_ARCHIVED`, `INVALID_PACKAGE_ITEM`, `INVALID_TEMPLATE`), audit actions and entity types (`catalog_service.*`, `catalog_package.*`); unit tests; `ar.json` keys for errors and audit
- [x] db (`/db-migration`): `catalog_billing` enum, `catalog_services`, `catalog_packages`, `catalog_package_items`; `TABLE_OWNERS`; one additive migration; `db` test, drift
- [x] api `templates`: export `TemplateDirectory` (names, kinds, archived state)
- [x] api `catalog` module: services and packages list / detail / create / update / archive / restore (rules C1–C4, `SERVICE_IN_USE` on billing change once used in a package), audit in the transaction (package items carry the service name); `app.module.ts`; unique-index codes in the database error filter; `docs/architecture.md`; spec API table settled (schema names, `*_NOT_ARCHIVED`, error details); `test/catalog.test.ts`; `test/architecture.test.ts`
- [x] bridge: `pnpm build`, `openapi:export`, `api:generate`; web typecheck
- [x] web: `features/catalog/` (queries, Services tab table with filters and edit dialog, Packages tab cards with editor dialog, archive / restore, archived filter), route `/catalog`, nav item "Catalog", `ar.json` `catalog` namespace; loading, empty, error states
- [x] e2e: fixtures, `f04-catalog.spec.ts`, screenshots light + dark (services, packages)
- [x] wiring checklist, full checks (+ E2E, drift), reviewer (two findings fixed: package items audit order, C1 package names in the UI), owner acceptance (approved), /ship

## PR 2 — `feat/f04-quotes-api`: quote settings, drafts, approval, send, versions, expiry
- [x] contracts: `quotes.ts` (statuses, approval, sections, rejection reasons, settings, draft, detail, list query and page, actions, snapshot), `quoteTotals` (rule 5) with unit tests, error codes, audit actions and entity types (`quote_settings`, `quote`), notification types `quote_approval_requested`, `quote_approval_decided` with subject `quote` (and their `ar.json` keys), job `quotes.daily`
- [x] db (`/db-migration`): enums, `quote_settings` (seeded row), `quote_numbers`, `quotes`, `quote_lines`, `quote_line_items`, `quote_installments`; `TABLE_OWNERS`; drift
- [x] api `catalog`: `CatalogDirectory` export (services and packages with items, prices, template ids) for quotes; `CatalogUsage` hook so `SERVICE_IN_USE` also covers services and packages on a quote
- [x] api `quotes` module: settings get / patch (threshold by `quotes.approve_discount`); create (numbering rule 2 under the counter lock), whole-draft `PUT` with `STALE_QUOTE`, approval request / withdraw / decision, send (rule 6, snapshot frozen, supersede), versions (rule 8), extend, reject, archive; list and detail with scopes and `permissions`; rules 1–11, 14, G1–G3; notifications; daily expiry job (worker schedule, API handler)
- [x] api tests: `test/quotes.test.ts` (each endpoint 200 / 401 / 403 / out of scope, every error code, numbering per year and under concurrency, expiry idempotent, audit)
- [x] bridge; web typecheck
- [x] wiring checklist, full checks (+ drift), reviewer (four findings fixed: missing 403 and out-of-scope tests, decision on an archived client, archived drafts of archived clients listed, untranslated audit link fields), owner acceptance (approved), /ship

## PR 3 — `feat/f04-quotes-pdf`: the PDF pipeline
- [x] contracts: jobs `quotes.pdf`, `quotes.pdf-ready` (payload schemas, storage key), PDF and draft preview state in the detail, `canRenderPdf`, `quotePdfRenderSchema`; F10 owner type `quote`; unit tests
- [x] db (`/db-migration`): `file_owner_type` gains `quote`, `file_items.quote_id` (checks, name index); `quotes.pdf_status`, `pdf_file_item_id`, `draft_pdf_*`; drift
- [x] worker: Playwright/Chromium dependency, Arabic RTL brand HTML template (fallback font), `quotes.pdf` handler writing to file storage, idempotent per version / draft hash; worker test with text extraction
- [x] api: queue on send and on preview, `quotes.pdf-ready` handler attaching once as a `document` of the quote (`GeneratedFiles` in `files`), draft preview replace / discard / outdated, `POST` and `GET /api/quotes/:id/pdf`, file owner policy for `quote` (client documents list for quote readers), `JobQueue` job data, daily re-queue of pending PDFs; `test/quote-pdf.test.ts`
- [x] bridge: `pnpm build`, `openapi:export`, `api:generate`
- [x] web: quote documents named in the client Files tab (`files.documents.ofQuote`)
- [x] `docs/deployment.md`, `deploy.sh` (Chromium download), `provision.sh` (Chromium libraries), CI installs Chromium for the worker test; `docs/architecture.md`, spec details settled
- [x] wiring checklist, full checks (+ drift, E2E), reviewer (one finding fixed: quote documents read-only so the frozen PDF stays), owner acceptance (approved), /ship

## PR 4 — `feat/f04-quote-accept-api`: acceptance and A01
- [ ] contracts: `revisionLimit` on retainer deliverables and cycle lines, template run `revisionLimit`, accept plan and accept schemas, A6 merge function with unit tests, error codes (`TEMPLATE_ARCHIVED`, `CURRENCY_MISMATCH`, …), notification `quote_accepted`
- [ ] db (`/db-migration`): `revision_limit` on `retainer_deliverables` and `retainer_cycle_lines`, `quotes.project_id` / `retainer_id` foreign keys if not in PR 2; drift
- [ ] api `projects`: `EngagementFactory` (create project with milestones, create retainer with lines and template link and current cycle, renew per R10) inside the caller's transaction; deliverable editor accepts `revisionLimit`
- [ ] api `templates`: `TemplateRunner` with the revision override; cycle runs use the line's `revision_limit`
- [ ] list filters `projectId`, `retainerId` and detail links to the project and retainer (columns arrive here)
- [ ] api `quotes`: `GET accept-plan`, `POST accept` (A1–A12 in one transaction, proof upload, A10 archives a newer draft, row lock); `test/quote-accept.test.ts` (rollback, renew from next cycle, revision limits on generated tasks)
- [ ] bridge; adapt retainer screens and fixtures to `revisionLimit`; web typecheck
- [ ] wiring checklist, full checks (+ E2E, drift), reviewer, owner acceptance, /ship

## PR 5 — `feat/f04-quotes-web`: quote screens
- [ ] web: the `quote` notification link opens `/quotes/$quoteId` (it opens the home page until this PR)
- [ ] web `features/quotes/`: quote settings page `/catalog/settings`, quote list `/quotes` with filters and "New quote" dialog, builder (sections, pickers, line rows, discounts, installments, term, approval banner, unsaved-changes guard, preview PDF, send confirmation, discard), quote page (read-only quote, PDF state, versions, response, extend, reject, new version, approve / return), client Quotes tab; nav "Quotes"; `ar.json`
- [ ] e2e: fixtures, flow spec, screenshots light + dark (settings, list, builder with the approval notice, quote page sent, client Quotes tab)
- [ ] wiring checklist, full checks (+ E2E), reviewer, owner acceptance (steps 2–6, 10, 11), /ship

## PR 6 — `feat/f04-quote-accept-web`: accept dialog and links
- [ ] web: accept dialog (response, project, retainer, summary, errors kept), "From quote" links on project and retainer pages, revision limit column on the retainer deliverable lines editor; `ar.json`
- [ ] e2e: full flow (build, send, accept, land on the project), screenshots (accept dialog steps, quote page accepted, one rendered PDF page)
- [ ] `docs/ROADMAP.md`, spec details settled during implementation
- [ ] wiring checklist, full checks (+ E2E), reviewer, owner acceptance (steps 7–9, 12), /ship
