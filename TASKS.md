# TASKS — F05C Retainer anniversary cycles and contracts

Spec: `docs/specs/F05C-retainer-anniversary-cycles.md` · ADRs 0030, 0031 (and 0015, 0029 they amend).

PR split (from the spec): PR 1 anniversary cycles · PR 2 backdated start and catch-up · PR 3 cycle reports · PR 4 legal details · PR 5 contracts and annexes. PR 1 changes response shapes that screens of F05/F05B/F04/F15 read, so it carries its web and E2E layers (a PR never leaves `main` broken).

## PR 1 — anniversary cycles (branch `claude/retainer-anniversary-cycles-cbb84j`)

Not in PR 1: the catch-up and start dates before the current cycle (PR 2: until then a start date before today − 1 month + 1 day is `INVALID_DATES`), cycle reports and `retainer_cycle_report_ready` (PR 3), legal details and contracts (PR 4, PR 5).

### 1. contracts
- [x] `retainer-cycles.ts`: `addMonths` (clamped, from the start date), `cyclePeriod`, `cycleAt`, term end date, days left; re-exported from `index.ts`; unit tests (anchors 1, 15, 28, 29, 30, 31; leap years; before the start)
- [x] `retainers.ts`: `renewalDate` removed from create/update inputs; `cycles_from`/`nextCycleStart`, `currentCycle { number, periodStart, periodEnd, daysLeft, termPosition?, termCycles? }` on list and detail; cycles carry `number` (no `month`); terms `startCycle`/`cycles`/`startDate`/`endDate`; charges `cycle`/`periodStart`/`periodEnd`; amendments scope `cycle`|`onward`, `effectiveCycle`, schedule `{ cycle, amountMinor }`, effects by cycle; status change `startNow?`
- [x] `quotes.ts` accept: retainer part without `renewalDate`; start date rule B6
- [x] `reports.ts`: client report retainers section by cycles overlapping the month (R4)
- [x] Error codes: `CYCLE_ALREADY_CHARGED`, `CYCLE_INVOICED`, `INVALID_EFFECTIVE_CYCLE` replace the month codes; `RENEWAL_DATE_FROM_TERM` removed (the renewal date is never sent: strict inputs answer 400); `ar.json` keys
- [x] Gate: `contracts` test, root `typecheck`

### 2. db (`/db-migration`, expand only)
- [x] `retainers.cycles_from`; `retainer_cycles.number` (unique with `retainer_id`), `backdated`, `untracked`, `month` optional
- [x] `retainer_charges.cycle_number`, `cycle_start`, new unique monthly index on `(retainer_id, cycle_number)`; `month` optional; `settled_outside` allowed for `monthly` (used in PR 2, check only)
- [x] `retainer_terms.start_cycle`, `cycles`, `start_date`, `end_date`; old columns optional
- [x] `retainer_amendments.effective_cycle`, `effective_date`, scope `cycle`; `effective_month` optional
- [x] Backfill SQL per spec "Migration" (numbers from `cycleAt`, schedules and effects mapped, `renewal_date` null without an active or scheduled term); SQL reviewed
- [x] Gate: `db` test, migration drift

### 3. api
- [x] Cycle engine on `cyclePeriod`/`cycleAt` (Y1–Y4): create opens the current cycle, ending closes with the end day
- [x] Day-one job `retainers.cycles` in J1 order, idempotent (J2), drafts named by cycle (J3)
- [x] Terms in cycles (T1'–T5'), derived `renewal_date`, renewal 30 days before `end_date`, `retainer_renewal_due` for terms only
- [x] Charges and billing sources by cycle; invoice draft labels (J3)
- [x] Amendments by cycle (A1'–A2')
- [x] Pause / resume / reactivate (P1–P4) with `startNow` and `cycles_from`
- [x] `PATCH` start date only before a cycle or charge (`RETAINER_STARTED`); `renewalDate` refused
- [x] Behind and delivery rate on the period; A09 texts and the short-cycle rule (Y5) in `packages/messages`
- [x] Quote accept (B6, no renewal date); quote renewal hooks by cycle
- [x] F15 client report and dashboard: cycles overlapping the month (R4)
- [x] `db:seed` rewritten to anchored cycles
- [x] Tests: `retainer-cycles`, `retainer-terms`, `retainer-amendments`, `retainers`, `quote-accept`, report tests updated; every PR 1 rule and error code
- [x] Gate: api test files above, `test/architecture.test.ts`, `api` typecheck

- [x] Found while testing: templates contracts (run and retainer template cycle) named the month; worker client report PDF and Excel name each cycle (R4); `cast.onDay` test helper for later cycles

### 4. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`; commit `openapi.json` and `schema.gen.ts`
- [x] Gate: `web` typecheck (runs with the web layer)

### 5. web
- [x] New retainer: start-date note (cycle day / last day of the month), no renewal date, term section in cycles with each cycle's period
- [x] Retainer header and lists: cycle chip (Y6), term chip with end date and "renews on", paused "next cycle starts"
- [x] "This cycle" tab (was "This month"), History by cycle number with period and badges
- [x] Resume / reactivate dialog (P2, P4)
- [x] Contract tab: schedules and amendments by cycle; amendment dialog "this cycle only" / "from cycle N onward"
- [x] Billing tab and invoice picker by cycle; quote accept dialog without renewal date; client report retainers section
- [x] `ar.json`: texts, errors, audit fields
- [x] Gate: `web` typecheck, lint, `web` test

### 6. e2e
- [x] `fixtures.ts` mocks moved to cycles
- [x] Flow spec: the header chip and the resume dialog
- [x] Screenshots light and dark: header with the cycle chip, resume dialog, History
- [x] Gate: `pnpm test:e2e` (374: 372 passed; the F05C P3 test locator fixed, then 12/12; the f15 line-service test failed once under load and passed 3/3 alone); screenshots opened and checked (header with the cycle chip, resume dialog, History, client report)
- [x] Found: task-generation, template and audit texts still said "this month"; now "this cycle" (runs already count on the cycle's period)

### Close PR 1
- [x] Wiring checklist against the diff; docs (spec: backfill by the month's last day, `month` scope kept in the enum, the PR 1 start-date rule: done)
- [x] Full checks through `checker` (lint, typecheck, test, build, migration drift, OpenAPI fresh: all pass; E2E above)
- [x] `reviewer` with the spec; blocking findings fixed (edit dialog start-date check, backfill keeps the month keys, cycle numbers never below 1)
- [ ] Owner acceptance (browser steps); then `/ship`

## PR 2 — backdated start and catch-up (branch `ccr-3689328e-v5jhy8`)

PR 1 is merged (#111). No migration: `retainer_cycles.backdated`/`untracked` and `settled_outside` on `monthly` charges shipped in PR 1. Not in PR 2: cycle reports (PR 3; backdated cycles never get one), legal details and contracts (PR 4, PR 5). The quote accept dialog keeps rule B6 (no backdating there).

### 1. contracts
- [x] `retainers.ts`: `catchUpEntrySchema` (`cycle`, `billing` `billed_externally`|`draft_now`, `delivery` `untracked`|`entered`, `delivered[]` per deliverable line 0–999) and `catchUp[]` (≤ 12) on `createRetainerSchema`; the term may start at cycle 1 with a backdated start (B5)
- [x] Error code `CATCH_UP_REQUIRED`; audit action `retainer.backdated`; `ar.json` keys (error, audit action and fields)
- [x] Unit tests: catch-up schema (B2: entries, choices, delivered counts, limits)
- [x] Gate: `contracts` test, root `typecheck`

### 2. api
- [x] `POST /api/retainers`: start date from today − 12 months (B1); past cycles 1…current − 1 need one complete catch-up entry each (B2, `CATCH_UP_REQUIRED`), money access for it
- [x] B3 billing: `billed_externally` → monthly charge `settled_outside` with the note; `draft_now` → charge due now, drafted at once with the cycle label (J3); amount from the term schedule or the fee; no amount → no charge
- [x] B4 delivery: closed `backdated` cycles, `untracked` (no delivered counts, null rate) or `entered` (frozen `delivered_at_close`); no tasks, no A09, no notifications
- [x] B5 term from cycle 1 that includes the current cycle, created `active` (`INVALID_DATES` otherwise); renewal as usual
- [x] B7 audit: `retainer.created` and one `retainer.backdated` with each cycle's choices and counts
- [x] Tests in `retainers.test.ts` (or `retainer-backdated.test.ts`): B1–B5, B7, edge cases 6 and 7, 403 without money access, the current cycle still opens and drafts as Y3
- [x] Gate: api test files, `test/architecture.test.ts`, `api` typecheck

### 3. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`; commit `openapi.json` and `schema.gen.ts`

### 4. web
- [x] New retainer: start date back to 12 months; a **Past cycles** step for a start before the current cycle: one row per past cycle (number, period, amount), billing (billed outside / draft invoice now), delivery (not tracked / enter delivered, expanding an input per line)
- [x] Term section: may start at cycle 1 on a backdated start, schedule periods per cycle
- [x] History: "backdated" and "not tracked" badges (already in PR 1; checked in the screenshot)
- [x] `ar.json` texts
- [x] Gate: `web` typecheck, lint, `web` test

### 5. e2e
- [x] `fixtures.ts`: backdated create and History mocks
- [x] Flow spec: a backdated retainer with the catch-up
- [x] Screenshots light and dark: new retainer with Past cycles, History with backdated badges
- [x] Gate: f05c and screens specs pass; screenshots opened and checked (new retainer with Past cycles, History with both badges); full `pnpm test:e2e` at close

### Close PR 2
- [x] Wiring checklist against the diff; spec updated (B1's PR 1 note removed, B2 details)
- [x] Full checks through `checker` (lint, typecheck, test, build, OpenAPI fresh; E2E 378 passed); after the review fix: lint, typecheck, test, build, OpenAPI fresh pass, E2E 377/378: `f13-invoices.spec.ts:51` timed out once (5 s) under the full run, then passed 9/9 alone (`--repeat-each=3`); it does not touch retainers
- [x] `reviewer` with the spec; blocking finding fixed (an untracked cycle's lines showed 0 delivered and 0 % in History and the client report; now no count: `delivered` and `percent` null in the report, "—" on screen, PDF and Excel; API test added)
- [x] Owner acceptance (accepted 2026-10-13); PR opened with auto-merge

## PR 3 — cycle reports (branch `claude/charming-hopper-85pv60`)

PR 2 is merged (#112). Ownership: ADR 0027 lets no module import `reports`, so `retainer_cycle_reports`, the cycle report service and its routes belong to `reports` (spec updated: it said `projects` owns every new table); `projects` tells it a cycle closed through a new `CycleClosedHooks` (as `CycleOpenedHooks`). Not in PR 3: legal details and contracts (PR 4, PR 5).

### 1. contracts
- [x] `reports.ts`: `cycleReportSchema` (R2: client, retainer, cycle number and period, `preliminary`, summary, this cycle's lines with committed, frozen delivered, percent and delivery rate; delivered work, published content, shoots, approvals, campaigns and ad budget with `campaigns.read`, next period; no projects), `updateCycleReportSummarySchema`, `cycleReportSnapshotSchema`, `CYCLE_REPORT_LABELS`; monthly report retainers carry `cycleId`; `reportPdfJobSchema` gains kind `cycle_report`; `reports.cycle-report` nudge queue (`jobs.ts`)
- [x] Notification type `retainer_cycle_report_ready` (`clients_projects`, subject `retainer`, mutable) with its data; text and link in `packages/messages`; audit action `retainer_cycle_report.summary_changed` and entity type; `ar.json` keys
- [x] Unit tests (schemas, notification data); gate: `contracts` test, root `typecheck`

### 2. db (`/db-migration`, expand only)
- [x] `retainer_cycle_reports` (`cycle_id` PK → `retainer_cycles.id`, `summary` ≤ 4,000 default empty, `pdf_status`, `storage_key`, `hash`, `size_bytes`, `rendered_at`, `updated_at`, `updated_by_id`); owner `reports` in `TABLE_OWNERS`; natural key in `conventions.test.ts`; `notification_type` enum value
- [x] Gate: `db` test, migration drift

### 3. api
- [x] `projects`: `CycleClosedHooks` run in the closing transaction by the job (J1 step 3, with `backdated` skipped) and by ending (Y4); `EngagementReports` read of one cycle with its retainer and client
- [x] `reports`: `CycleReportService`: R1 (row, queued PDF, one `retainer_cycle_report_ready` to the account manager), R2 (sections over the cycle period), R3 (summary saves audit and mark the PDF outdated; render again on download), `reports.pdf-ready` for kind `cycle_report`
- [x] Controller: `GET …/report`, `/export` (xlsx), `PUT …/report/summary`, `POST` · `GET …/report/pdf`; `reports.read` covering the client, 404 outside
- [x] Tests `retainer-cycle-reports.test.ts`: each endpoint success, 401, 403, out of scope; R1–R3, backdated none, edge cases 3, 5 and 15, idempotent job; gate: api test files, `architecture.test.ts`, `api` typecheck

### 4. worker
- [x] `reports.pdf` kind `cycle_report`: template (Arabic RTL, preliminary mark), worker test with screenshot; gate: `worker` test, typecheck

### 5. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`

### 6. web
- [x] Cycle report page `/retainers/$retainerId/cycles/$cycleId/report` (sections, preliminary badge, summary editor, Download PDF, Export to Excel); "Report" link per closed cycle in History; link from the client's report page; notification link
- [x] `ar.json` texts; gate: `web` typecheck, lint, `web` test

### 7. e2e
- [x] `fixtures.ts` mocks; flow spec: the report from History, summary saved; screenshots light and dark of the cycle report
- [x] Gate: f05c (7/7), f05, f15 and the retainer and report screens (70) pass; screenshots opened and checked (cycle report light and dark, History with the Report links, monthly report with the cycle link); full `pnpm test:e2e` at close

- [x] Found while building: `timestamps()` bumps `updated_at` on every update, so a render changed the report's hash (the summary shows its time); `retainer_cycle_reports.updated_at` is set by summary saves only (no SQL change). `retainers:run-daily` now starts sending jobs, so the report nudge reaches the running dev API. The report sections the two reports share moved to `report-sections.tsx` (web) and shared helpers in the PDF template and Excel builder. `$retainerId.tsx` became `$retainerId/index.tsx` for the nested report route.

### Close PR 3
- [x] Wiring checklist; spec updated (table ownership, `updated_at`, PDF currency by hash, the nudge job); `docs/architecture.md` (`reports`, `CycleClosedHooks`)
- [x] Full checks: lint, typecheck, build, OpenAPI fresh, migration drift, E2E (382 passed); after the last fix lint, typecheck and `pnpm test` (11/11 tasks) pass
- [x] `reviewer` with the spec; blocking findings fixed (no report link for backdated cycles in the monthly report, 403 tests on every endpoint, ADR 0027 amendment; also a send-only script now creates the `reports.cycle-report` queue); tests that delete cycles or read a retainer's inbox adjusted for the report row and notice
- [x] Owner waived acceptance in this session (asked for the PR with auto-merge); PR opened with auto-merge

## PR 4 — legal details (branch `claude/clever-gauss-ele680`)

PR 3 is merged (#113). Owner `projects` for the contract settings (new schema file `retainer-contracts.ts`, which PR 5 extends with the contract tables); `clients` for the legal fields. Not in PR 4: contracts, annexes, their PDFs, `file_owner_type` `retainer_contract`, K11 texts in `packages/messages` (PR 5). The contract number counter stays for PR 5: `invoices` imports `projects`, so `projects` cannot take `document_numbers` through `invoices`; PR 5 decides where the year's counter lives. Until then no contract is issued and the settings preview shows `<prefix>-<year>-001`.

### 1. contracts
- [x] `retainer-contracts.ts`: `contractSettingsSchema` (+ `articles`, `nextNumber`, `canEdit`), `updateContractSettingsSchema` (field limits, prefix `A–Z`, digits, `-`, 2–20), `contractArticleSchema`, `updateContractArticlesSchema` (≤ 40, title 1–120, body ≤ 6,000), `CONTRACT_PLACEHOLDERS` and `unknownPlaceholders()` (K7), `formatContractNumber()`; re-exported from `index.ts`
- [x] `clients.ts`: `registrationNumber` (≤ 60) on client inputs and responses; `fatherName` (≤ 60), `nationalId` (≤ 30, optional in responses) on contacts
- [x] Error code `UNKNOWN_PLACEHOLDER`; audit actions `contract_settings.updated`, `contract_settings.articles_updated`, entity type `contract_settings`; `ar.json` keys (error, audit action, entity type, fields)
- [x] Unit tests: placeholder check, number format, settings and articles schemas, legal fields
- [x] Gate: `contracts` test, root `typecheck`

### 2. db (`/db-migration`, expand only)
- [x] `clients.registration_number`, `client_contacts.father_name`, `client_contacts.national_id` (nullable, limits checked by the contracts, as the billing columns)
- [x] `contract_settings` (singleton row seeded, defaults: slogan, prefix `VM-CCS`); `contract_article_templates` seeded with the 17 appendix articles; `TABLE_OWNERS` entry
- [x] Gate: `db` test, migration drift

### 3. api
- [x] `projects`: `ContractSettingsService` and controller: `GET /api/contract-settings` (`projects.manage` any + `invoices.read` any, else 403), `PATCH` (`catalog.manage`), `PUT /articles` (order, archive left out, `UNKNOWN_PLACEHOLDER`, `LIMIT_REACHED`); audit in the transaction; next number preview from `document_numbers`
- [x] `clients`: registration number on create/update/detail; contacts' father's name; national ID only with `clients.manage` + `invoices.read` covering the client (omitted from responses otherwise, 403 when sent, stored value kept); audit records the national ID as changed, never the value
- [x] Tests `contract-settings.test.ts` (success, 401, 403 per endpoint, errors, audit) and `clients.test.ts` additions (national ID visibility and 403, audit without the value)
- [x] Gate: api test files, `architecture.test.ts`, `api` typecheck

### 4. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`

### 5. web
- [x] Contract settings page `/settings/contracts` (agency details, prefix with next number preview, slogan; article template editor: add, edit, remove, reorder with up/down, insert placeholder menu; read-only for readers); link from the retainers list for readers
- [x] Client: registration number in the billing details (Invoices tab and edit form); contact dialog: father's name, national ID for allowed roles only
- [x] `ar.json` texts; gate: `web` typecheck, lint, `web` test

### 6. e2e
- [x] `fixtures.ts` mocks; flow spec: save settings and articles, contact national ID shown and hidden by role
- [x] Screenshots light and dark: contract settings with the article editor, contact dialog with and without the national ID
- [x] Gate: specs pass; screenshots opened and checked

### Close PR 4
- [x] Wiring checklist; spec and `docs/architecture.md` updated where settled
- [x] Full checks through `checker`: lint, typecheck, build, migration drift, OpenAPI fresh, E2E (390 passed; `f04-accept.spec.ts:85` and `f07.spec.ts:31` failed once under the timed run and passed alone); after the review fixes lint, typecheck, `pnpm test` (11/11) and the F05C PR 4 E2E specs pass
- [x] `reviewer` with the spec; blocking finding fixed (the audit log showed the national ID marker as the English word "changed": now a shared constant translated on the audit page); saved articles reset the form from the response, so new ones keep their ids
- [x] Owner waived acceptance (asked for the PR directly); PR opened with auto-merge

- [x] Found while building: Finance and employees hold `projects.manage` with scope `assigned` (derived employee role), so "any scope" let Finance read the settings, against the Roles column; reading needs client scope (`all` or `own_clients`), spec updated. The lead conversion contact omits the legal fields (out of its scope).

## PR 5 — contracts and annexes (split in two, as the skill's default: 5a API and PDFs, 5b screens)

PR 4 is merged (#114). Owner `projects` for `retainer_contracts`, `retainer_contract_articles`, `retainer_contract_annexes` (schema file `retainer-contracts.ts`). Contract numbers: `document_numbers` belongs to `invoices`, which imports `projects`, so `projects` declares a port, `ContractSources` (as the hooks: `projects` defines it, `invoices` registers the numbering and payment terms on start-up, `quotes` the accepted quote's monthly services); `document_number_kind` `contract` stays in `invoices`; the settings' next number preview reads it the same way.

### PR 5a — contracts, annexes and their PDFs (API and worker; branch `ccr-ff8a3197-xvm14a`)

#### 1. contracts
- [x] `retainer-contracts.ts`: `contractKind`/`contractStatus`/`annexStatus` lists, `retainerContractSchema` (number or null, kind, term, status, dates, signed, void, `changedSinceIssue`, annexes), `retainerContractDetailSchema` (articles, signatory, parties as they print, `missing[]`, blocks absent), `createContractSchema` (`kind`, `termId?`), `updateContractSchema` (`contractDate`, `signatoryContactId`, `articles[]` ≤ 40), `voidContractSchema` (reason ≤ 500), `signedCopySchema` (`signedOn`, `uploadId`), `issueAnnexSchema` (`annexDate`), `contractAnnexSchema`, `contractSnapshotSchema` and `annexSnapshotSchema` (the frozen render payloads)
- [x] `jobs.ts`: `contracts.pdf` (kinds `contract`, `contract_draft`, `annex`; retry 3), `contracts.pdf-ready`, object paths
- [x] Error codes `CONTRACT_EXISTS`, `CONTRACT_INCOMPLETE`, `NO_CONTRACT` (others exist); audit actions `retainer_contract.created/.updated/.discarded/.issued/.signed/.voided`, `retainer_contract_annex.issued/.signed/.voided` and entity types; `file_owner_type` value; `ar.json` keys
- [x] K11 texts in `packages/messages` (headings, party labels, preamble, end-action clauses, block captions, annex wording)
- [x] Unit tests (schemas, snapshot shapes, `missing` rule helper if pure); gate: `contracts` test, root `typecheck`

#### 2. db (`/db-migration`, expand only)
- [x] Enums `contract_kind`, `contract_status`, `contract_annex_status`; `document_number_kind` + `contract`; `file_owner_type` + `retainer_contract`
- [x] `retainer_contracts` (partial unique indexes: one live per term, one live per retainer and `start_cycle` for `open_ended`; unique `number`), `retainer_contract_articles`, `retainer_contract_annexes` (unique live annex per amendment, unique `(contract_id, annex_number)`); `TABLE_OWNERS`
- [x] Gate: `db` test, migration drift

#### 3. api
- [x] `projects`: `ContractSources` port (numbering and payment terms registered by `invoices`, quote services by `quotes`); settings preview of the next number reads it
- [x] `RetainerContractsService` + controller: list, create (K1, K2), detail with live parties/blocks and `missing[]` (K3, K6, K7), patch draft (articles, date, signatory; `UNKNOWN_PLACEHOLDER`, `UNKNOWN_CONTACT`, `LIMIT_REACHED`), discard (K8), issue (K4: number, snapshot, PDF queued), void (K8), signed copy upload (K5, F10 version of the "signed copy" item), `changedSinceIssue` (K9); money access and client scope, national ID per Roles in the live preview; retainer lock (G2); audit (G1)
- [x] Annexes: `POST …/amendments/:amendmentId/annex` (K10, `NO_CONTRACT`, `INVALID_TRANSITION`), void, signed, PDF
- [x] PDFs: `POST`/`GET …/pdf` (`?draft=true` preview for managers), `contracts.pdf-ready` attaches the PDF as a document of the contract (F04 rule 12 hashing and idempotency); `invoices.daily` re-queues pending contract and annex PDFs
- [x] `files`: owner policy for `retainer_contract` (contract readers; read-only through file endpoints)
- [x] `files`: `GeneratedFiles.addUploadVersion` (a signed copy uploaded again); test cleanup removes contracts before file items (`removeRetainerContracts`)
- [x] Tests `retainer-contracts.test.ts`: every endpoint success, 401, 403 (employee, Finance on manage, AM of another client), out of scope 404; K1–K12, edge cases 9–14, every error code, audit entries
- [x] Gate: api test file, `architecture.test.ts`, `api` typecheck

#### 4. worker
- [x] `contracts.pdf` job and templates for contract and annex (K6: page badge, logo, party tables, slogan, preamble, numbered articles with blocks, signatures, footer, "page x of y"; empty lines for missing fields; no split tables or signature block); worker test with screenshots
- [x] Gate: `worker` test, typecheck

#### 5. bridge
- [x] `pnpm build`, `openapi:export`, `api:generate`

#### Close PR 5a
- [x] Wiring checklist; spec ("Settled in PR 5a") and `docs/architecture.md` (the `ContractSources` port)
- [x] Full checks: lint, typecheck, `pnpm test` (11/11, 1058 API tests), build, migration drift, OpenAPI fresh; E2E stopped by the owner at 321 passed, none failed (CI runs it in full)
- [x] `reviewer` with the spec; blocking findings fixed (a scheduled term blocks an open-ended contract, also at issue; a `continue` term's contract covers onward; 403 and out-of-scope tests on every endpoint, `RETAINER_ENDED`, `RETAINER_ARCHIVED`, yearly numbering; signed copies PDF or image only, `FILE_TYPE_NOT_ACCEPTED`)
- [x] Owner accepted ("اقبل كل شئ"), the end-action clauses included
- [x] `/ship`: PR opened with auto-merge

### PR 5b — contract screens (branch `ccr-ac3d4856-0hg08e`)

PR 5a is merged (#115). No API, db or bridge change.

- [x] web: queries and mutations (`retainers.queries.ts`); `contract-coverage.ts` (covering contract, annex state, as the API's `coveringContract`) with unit tests; Contracts section on the Contract tab (`contracts-section.tsx`: list, Open, PDF, Issue, signed copy, Void, annexes; "Prepare contract" on term cards and for an open-ended retainer; "changed since issue"); "Issue annex" and "in annex n" on applied amendments; dialogs (`contract-dialogs.tsx`: issue with required and empty fields and absent blocks, void, signed copy, annex); contract editor `/retainers/$retainerId/contracts/$contractId` (`contract-page.tsx`: date, signatory, articles editor reused from the settings, parties with missing fields and links, generated blocks from `@vertex-hub/messages`, Preview PDF, Issue, Discard; issued: read-only articles with blocks, annexes, documents, signed copy, Void); `ar.json`; gate: `web` typecheck, lint, `web` test
- [x] e2e: contract and annex mocks in `fixtures.ts` (settings state shared with drafts; `retainer_contract` file owner); `f05c-contracts.spec.ts` (prepare, edit, issue, signed copy; annex; Finance read-only, employee none); screenshots light and dark (contract editor with missing fields, issue dialog, issued contract with an annex); gate: specs pass, screenshots opened and checked
- [ ] Close: wiring, full checks, `reviewer`, owner acceptance steps 7–9 and 11, `/ship`; ROADMAP marks F05C done
