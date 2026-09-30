# UI/UX and design audit

## Scope and revision

Date: 2026-09-30 (Asia/Damascus). Authored-code revision: `9463f9f4366c133ec55bfa577c1fa08605581554`, branch `docs/phase-1-audit`. Reviewed the Phase 0 shell/design system and Phase 1 F01/F02/F05/F06/F07/F14 user interfaces against the brand identity, folder rules, ADR 0004/0011/0013 and feature screen requirements. No application code, records, notification settings or dependencies changed.

This combines static inspection, the live observations recorded in [browser-walkthrough.md](browser-walkthrough.md), and a focused additional read-only browser check of an existing client contact dialog and the navigation drawer. Live observations apply to the already-running local app; its process/build revision was not independently established.

## Findings

### UX-001 — Healthcare setting claims medical review is already enforced
- Severity: Medium
- Confidence: confirmed
- Location: `apps/web/src/i18n/locales/ar.json:1400`; `apps/web/src/features/clients/client-form.tsx:220`; `apps/web/src/features/clients/client-form.tsx:239`
- Requirement: F02 Scope and business-rule edge case 8 record the healthcare flag for later F09 enforcement; F06 Scope explicitly defers the medical review step to F09; `docs/ROADMAP.md:34` leaves F09 in Phase 2. Brand identity section 9 requires clear Arabic copy.
- Evidence: The new-client/edit form renders `clients.form.healthcareHint`, whose Arabic text says enabling the setting enables medical review before this client's content is sent. Immediately above the implementation, the comment explicitly says it switches on medical review later in F09. The browser walkthrough observed this promise in the live new-client form and mobile edit dialog. F02 only records the flag; Phase 1 does not implement the claimed gate.
- Impact: People creating or managing healthcare clients can reasonably believe setting the flag guarantees a review that is not part of the deployed Phase 1 workflow. This is a misleading current capability claim, not a request to implement the future F09 feature in Phase 1.
- Suggested fix: Change the Arabic hint to say this marks a healthcare client and that mandatory medical review is introduced with the later approval workflow. Keep the Phase 1 record-only behavior.
- Verification: Inspect the new-client and edit-basics forms in Arabic; the hint must accurately describe current behavior and must not promise a currently enforced review.

### UX-002 — Contact dialog loses its title and actions on a shorter phone viewport
- Severity: Medium
- Confidence: confirmed
- Location: `packages/ui/src/components/dialog.tsx:34`; `apps/web/src/features/clients/contacts-tab.tsx:329`
- Requirement: `docs/product/v1-scope.md:63` requires a responsive Arabic-first web app; apps/web local rules require accessible controls. F02 Screens require usable add/edit contact dialogs.
- Evidence: The shared popup is fixed at the viewport center without a maximum height or scrolling; the contact caller adds only `max-w-xl`. Opened Add contact for the existing local client without entering or submitting anything. At 390×844 it fit, but at 390×667 its measured height was 814.67 px, top −73.67 px and bottom 741 px. Computed popup `overflowY` was `visible`, with `clientHeight=scrollHeight=813`; the modal locked body overflow to `hidden`. The close button occupied y=−61 to −29, Cancel y=680.33 to 716.33, and Save y=636.33 to 672.33. The inspected screenshot showed the missing title/close control and clipped Save button. Escape closed the unsaved dialog.
- Impact: On common shorter phone viewports or reduced available height, a client manager cannot see the full contact form and its close/cancel/save controls together or scroll the popup itself to reach them. A keyboard Escape route exists, but does not make the touch flow usable.
- Suggested fix: Give the shared DialogContent a viewport-relative maximum height and vertical scrolling, with appropriate viewport margins. Audit callers that currently provide only max-width; retain the working height/overflow overrides already used by template and project edit dialogs.
- Verification: At 390×667 and a short landscape viewport, open add/edit contacts and other long dialogs, including validation messages. Confirm title and every field/action can be reached by touch scrolling and keyboard; test both themes and restore focus on closing.

### UX-003 — Mobile navigation has no scrolling when its links exceed available height
- Severity: Low
- Confidence: confirmed
- Location: `apps/web/src/components/app-shell.tsx:140`; `apps/web/src/components/app-shell.tsx:145`; `packages/ui/src/components/sheet.tsx:18`
- Requirement: `docs/product/v1-scope.md:63` requires responsive web; ADR 0004 requires accessible RTL component behavior.
- Evidence: Sidebar is a height-constrained flex column, but its header may shrink and its nav has no flex scroll region. SheetContent also has no overflow scrolling. In the live GM session at 390×600, measured sheet `clientHeight=600`, `scrollHeight=627`, `overflowY=visible`; nav `clientHeight=scrollHeight=598`, `overflowY=visible`; body overflow was `hidden`. The last Design system link ended at y=614.67, beyond the 600 px viewport. The screenshot confirmed its clipping and a compressed header. At 390×667 the same links fit, which explains why the earlier taller-phone check did not expose it.
- Impact: Lower navigation becomes partially offscreen when available height is short; the existing drawer provides no internal scroll region to reveal it. The demonstrated clipped destination is the design-system page, so current impact is limited; shorter viewports can also affect business destinations higher in the same list.
- Suggested fix: Keep the header from shrinking and make the navigation the remaining-height scroll region (`min-h-0`, flexible sizing and vertical overflow) in the shared sidebar, used by both desktop and mobile.
- Verification: Open the full GM navigation at 390×600 and in landscape; scroll through every destination with touch and keyboard, retain the brand header, and confirm the drawer closes and restores focus after navigation.

## Coverage

| Area | Sources and review depth |
|---|---|
| Brand foundations and both themes | Read `brand/identity.md`, ADR 0004/0011, UI folder rules, `styles/theme.css`, `base.css`, `fonts.css`, component variants and token/convention tests. Palette, semantic roles, Arabic-friendly type scale, radii, focus styling, reduced motion and private-font fallback are explicitly implemented. The brand-font license remains owner question Q11, not a new audit defect. |
| Arabic and RTL | Enumerated authored routes/features and reviewed translated copy, logical CSS, mirrored directional arrows, numeric/date helpers and LTR islands for telephone/email/URLs/OTP codes. `lib/format.ts` centralizes `ar-u-nu-latn`, calendar-day formatting and Damascus timestamps; money uses the shared formatter. Reviewed status/priority badges for text labels in addition to color. |
| Shared accessibility | Inspected button/input/field/select/autocomplete/multi-combobox/checkbox/switch/toggle/tab/dialog/sheet/pagination/meter/color-input families and error presentation. Base UI primitives provide the component interaction foundation; Field connects ordinary controls to labels/descriptions/errors; FormAlert uses `role=alert`. Reordering has labelled buttons; the task board supplies a menu alternative to drag and drop. This is source review, not a full assistive-technology certification. |
| F01 people and account | Reviewed shell navigation, department/profile/dialog actions, user form labels/pickers, login/activation/2FA screens and copy. Browser walkthrough covers GM directory/departments/account and invalid activation; credential/2FA mutations were excluded. |
| F02 clients | Reviewed basics, contacts, platform access, brand-kit colors/references, communication forms/timeline, profile tabs and action confirmations. Additional live check opened and cancelled an empty contact dialog; verified the responsive defect with DOM geometry and a screenshot. |
| F05 projects/retainers | Reviewed page/list hierarchy, milestone editor/reorder/action labels, deliverable-line editor, current-cycle counters/history adjustments and edit/action dialogs; read new-form, cycle and money screen requirements. Live walkthrough covers empty lists and unsaved new forms; existing populated cycle/project pages were unavailable. |
| F06 tasks | Reviewed list/board/workload status displays, accessible workload counters, task form/parts/comments/revisions and transition-dialog labels/reasons. Examined dependency links, checklist controls and external-link labels. Populated workflow interaction was not exercised. |
| F07 work templates | Reviewed editor hierarchy, step dialog, dependencies/default-assignee controls, generation dialog height constraints and retainer template panel. Live walkthrough inspected stored templates and cancelled a step dialog. No generation or template save occurred. |
| F14 notifications and audit | Reviewed labelled bell/page/settings controls, locked settings explanation, unread text plus marker, notification subject presentation and audit detail/navigation affordances. Empty live notifications prevented populated visual review; notification opening/settings changes were excluded because they mutate. |
| Responsive/live visual evidence | Browser walkthrough records desktop home/team/audit and 390×844 account/client/profile/edit views in light/dark. This reviewer added contact-dialog screenshots at 390×667 and navigation at 390×600. Temporary viewport overrides were reset; dialogs/drawer closed without submitting. |

Web data-flow defects affecting usability remain owned by [web-quality.md](web-quality.md): comment-history truncation, ambiguous mention parsing and empty-page pagination recovery. They are not counted again here. Security/session findings remain owned by [security-access.md](security-access.md).

## Checks and observations

- Static inventory/search commands included `rg --files docs/decisions docs/specs apps/web/src packages/ui/src`, targeted `rg -n` searches for dialog sizing, ARIA, logical/token utilities, locale formatting and screen requirements, followed by focused source reads. These commands completed with exit 0. Generated router/client files were enumerated but not read.
- The tests/CI reviewer ran the installed direct executables in `D:\vertex-hub\packages\ui`: `& .\node_modules\.bin\vitest.cmd run --no-cache` exited 0, with 3 files / 12 tests passing (conventions 4, tokens 6, avatar 2); `& .\node_modules\.bin\tsc.cmd --noEmit --incremental false` exited 0 without diagnostics. See [tests-ci.md](tests-ci.md) for execution ownership and environment limits. These checks validate static conventions/tokens/types, not dialog geometry or full UX.
- Additional browser used a hidden IAB tab at `http://127.0.0.1:5173/` in the existing GM session, fresh accessibility/DOM observations, semantic navigation to Templates and the existing Client, unsaved Add contact, and the mobile drawer. Documented viewport capability set 390×844, 390×667 and 390×600; read-only DOM evaluation measured bounding rectangles and computed overflow; screenshots were visually inspected. Escape cancelled both popup checks, and the viewport override was reset.
- No form values were saved, business actions submitted, notification read states/settings changed, auth credentials entered, or services started. Browser screenshots remain observations in tool output; no screenshot files were added under the report-only edit boundary.

## Limitations and unverified items

- Existing local projects, retainers and tasks were empty, as checked through all/closed/archive filters by the browser reviewer. Populated project milestones, cycle counters, revisions, task boards, dependencies and generation previews therefore have static review only. Notifications were also empty.
- Other role sessions, real password/login/activation/2FA flows, assistive-technology announcements, browser-native date/color pickers, full keyboard traversal and all localized validation branches were not verified live. Labels and Base UI usage are evidence of intended accessibility, not proof that every rendered control is accessible.
- The browser walkthrough supplies representative dark-theme evidence; the two new mobile geometry findings were observed in light mode and arise from theme-independent layout classes. No new automated Playwright RTL suite was run by this reviewer. The screen suite was inspected for coverage, not declared passed.
- Data-driven long names, maximum-length descriptions, maximum numbers of template/dependency/deliverable entries, zoomed layouts, populated narrow tables/boards and transport/session-expiry errors need a later authorized acceptance run. Findings identify only supported defects; untested screens are not automatically considered faulty.
- Private Madani files/license were not inspected. `docs/open-questions.md:11` is the existing owner-controlled Q11 dependency; the committed fallback stack exists. No owner decision was guessed.

## Deploy implications

Two Medium UX issues should be assessed before the client pilot: remove the current medical-review promise and make long dialogs usable at shorter viewport heights. The Low navigation overflow should be corrected with the same responsive acceptance pass. No independent Critical/High UX defect was demonstrated, but the populated lifecycle and non-GM acceptance gaps prevent a complete UI readiness conclusion. Future F09 functionality remains outside Phase 1; correcting its copy does not require expanding scope.
