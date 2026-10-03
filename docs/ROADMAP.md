# Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Feature IDs refer to `docs/product/v1-scope.md`. Production is deployed once at the end of each phase (`docs/workflow.md`).

## Phase 0 — Foundation
- [x] Product scope, decisions and working method documented
- [x] Monorepo scaffold (pnpm, Turborepo, TypeScript, Biome, shared config)
- [x] `packages/db` with Drizzle and first migration; local PostgreSQL (`pnpm db:setup-local`)
- [x] `apps/api` skeleton: NestJS 12, native Standard Schema validation (ADR 0012), OpenAPI, pino, `/api/health`
- [x] `apps/worker` skeleton: pg-boss wiring, sample heartbeat job
- [x] `apps/web` skeleton: Vite, TanStack Router/Query, i18next, RTL shell, Playwright smoke test
- [x] Brand assets and visual identity (`brand/`, ADR 0011)
- [x] Design system: tokens from `brand/identity.md`, base components in `packages/ui`, app shell (Madani font files pending Q11; Noto Kufi Arabic fallback until then)
- [x] Authentication (Better Auth), login page, permission map and guards (map provisional until the F01 spec, Q13)
- [x] CI: typecheck, lint, test, build, e2e smoke, gitleaks
- [x] Engineering conventions (ADR 0013): `core/` + `modules/` layout, architecture tests for route access, module boundaries and data rules
- [x] Claude Code setup: settings (model, effort, permissions, guarded reads, Biome hook), folder `AGENTS.md` rules, skills (`spec`, `db-migration`, `ship`), subagents (`checker`, `reviewer`), spec template
- [x] Deployment on the VPS: https://hub.vertexmedia.pro, atomic releases, health checks, daily local backups (`docs/deployment.md`)

## Phase 1 — Core
- [x] F01 Users, departments, roles and permissions (spec: `docs/specs/F01-users-roles.md`): access core, users and departments API, web screens; owner acceptance passed
- [x] `feature-slice` skill (contracts → db → api → web → tests), extracted from F01: layer gates, new-module wiring checklist, F01 patterns to copy
- [x] F02 Clients (spec: `docs/specs/F02-clients.md`): contracts, schema and API (PR 1); client list, new client and profile with contacts, brand kit, platforms and communication log, audit links (PR 2); owner acceptance passed
- [x] F05 Projects and retainers (spec: `docs/specs/F05-projects-retainers.md`): contracts, schema and API for projects and milestones (PR 1); retainers, monthly cycles and extra work API, daily cycle job (PR 2); project list, new project, project page with milestones and extra work, client Projects tab, audit labels (PR 3); retainer list, new retainer, retainer page with this month, history and extra work, client Retainers tab, audit labels (PR 4); owner acceptance passed
- [x] F06 Task engine and workflow (spec: `docs/specs/F06-tasks.md`, ADR 0016): contracts, schema and API for tasks, workflow, dependencies and revisions, with the F05 and F01 hooks (PR 1); checklist, links, comments with @mentions, board, workload and My tasks counts API (PR 2); My tasks, task list, new task and task page screens with status actions, revisions and comments (PR 3); board, workload, project Tasks tab, retainer line task links and client Open tasks tab (PR 4); owner acceptance passed
- [x] F07 Work templates (spec: `docs/specs/F07-work-templates.md`, ADR 0017; includes the task part of A02): contracts, schema, seed templates and templates API (PR 1); template runs API: preview and apply on projects and cycles, automatic cycle runs, missing tasks, retainer template link (PR 2); templates list and template editor screens (PR 3); generate dialog, run lines, template pickers on new projects and retainers, retainer This month template panel with missing tasks, task origin line (PR 4); owner acceptance passed
- [x] F14 Notifications (in-app) (spec: `docs/specs/F14-notifications.md`, ADR 0018; includes A03, A07, A08): contracts, schema, notifications API (list, read, settings, SSE stream), daily job with reminder keys and purge (PR 1); events from clients, projects, tasks and template runs, and the task and renewal reminders of the daily job (PR 2); bell with live stream and toasts, notifications page, notification settings, nginx stream location (PR 3); owner acceptance passed
- [x] Automations A03, A07, A08 (delivered by F14's daily job and task events)
- [x] Pre-deploy audit and remediation (`docs/audit/claude/`, `docs/audit/codex/`): every finding fixed except off-server backups (SEC-01, waits on Q4 below); owner decisions recorded in F01, F05, F06, F14, ADR 0006, `brand/identity.md` §9 and `docs/deployment.md`
- [ ] Pilot with 2–3 real clients
- [ ] Production deploy of Phase 1 — postponed by the owner (2026-09-30); Phase 2 is built first and deploys follow the owner's call

## Phase 2 — Production and client
Build order (owner, 2026-09-30): F10 → F09 → F08 → F11. F09 approves exact file versions from F10; F08 attaches files and sends month plans for approval through F09.
- [x] F10 Files and versions (spec: `docs/specs/F10-files-versions.md`, ADR 0019): files API, storage, previews and purge jobs, deploy configuration (PR 1); upload control, preview dialog, task Files section (PR 2); client Files tab (library, documents, usage), brand kit uploaded files, project and retainer Documents tabs, file entries in the audit log (PR 3); owner acceptance passed
- [x] F09 Internal review and client approval (incl. medical review) (spec: `docs/specs/F09-review-approval.md`, ADR 0020; includes A04, A05, A13): contracts, schema, review snapshots, medical review stage, text for the client, manual client responses and healthcare flag hooks in the tasks API (PR 1); approval requests and links, the public client page API, the hourly reminders job and the nginx rules (PR 2); the review screens: text for the client, medical stage and its Approvals tab, review history, client responses, file marks (PR 3); the approval request screens: Ready to send and Sent tabs, new request dialog, request page, task Client approval panel, client Approvals tab, and the public client page `/a/<token>` (PR 4)
- [x] F08 Content calendar (spec: `docs/specs/F08-content-calendar.md`, ADR 0021): contracts, schema and the `content` API: posts, calendar and My posts, the post workflow with review snapshots, the medical stage and manual client responses, post files, direct counting on a cycle line and the publish reminders (PR 1); tasks linked to posts (link, unlink, request, send back), media from linked tasks, publishing delivers them, and posts as items of approval requests with the client page and "Approve all" in the API (PR 2); the content screens: the Content page (calendar, My posts), the client Content tab, the post page with its dialogs and the Post line of a linked task (PR 3); posts in the approval screens: the medical queue and Ready to send with a Month picker, "Send month for approval", post items in the request dialog and page, the post page Client approval panel, and the "Content plan" with "Approve all" on the client page (PR 4); owner acceptance passed
- [x] F11 Unified calendar and shoots (spec: `docs/specs/F11-calendar-shoots.md`, ADR 0022): contracts and schema for shoots, meetings and the calendar, and the `calendar` API for shoots: booking on a Photography task or with a new one, edits, the shot list, conflict warnings, close (delivers the shoot task, creates the editing task), cancel, reopen, archive, and the guards that keep a scheduled shoot's task (PR 1); meetings with attendees, client contacts and conflicts, the company calendar read (`GET /api/calendar`) with key dates, the lead and organizer responsibilities, and the daily reminders (PR 2); the web screens for the calendar and shoots: `/calendar` (month, week, phone agenda, filters), booking and editing with live conflict warnings, the shoot page with its shot list, close, cancel, reopen and archive, and the Shoot panel on the task page (PR 3); the meeting dialog with live conflict warnings, the meeting page with edit, cancel, archive and restore, and the meeting links from the calendar, notifications, responsibilities and the audit log (PR 4)
- [x] Automations A04, A05, A06, A09, A13 (spec: `docs/specs/P2A-phase2-automations.md`; A02 task part moved to F07): A04, A05 and A13 delivered by F09 and F08, A06's alert and decision by F06 and F14; the retainer behind alert with its final reminder (A09), the pending revision decision reminder (A06) and the "ready" count on cycle lines as two sources of the daily notifications job; owner acceptance passed
- [ ] Production deploy of Phase 2

## Phase 3 — Money and sales
- [x] F04 Service catalog and quotes (spec: `docs/specs/F04-catalog-quotes.md`, ADR 0023; includes the engagement part of A01): catalog end to end (PR 1); quote settings, drafts, approval, send, versions, expiry API (PR 2); the PDF pipeline (PR 3); acceptance and A01's engagement part in the API: accept plan and accept, `EngagementFactory`, `TemplateRunner`, revision limits on retainer lines and generated tasks (PR 4); quote screens: settings, list, builder, quote page, client Quotes tab (PR 5); the accept dialog, "From quote" links on project and retainer pages and the revision limit column of retainer lines (PR 6); owner acceptance passed
- [~] F13 Invoicing and collection (spec: `docs/specs/F13-invoicing-collection.md`, ADR 0024; includes the invoice parts of A01 and A02, and A10): invoice settings, manual drafts from billable work, issue with numbering, due date changes and voids in the API (PR 1); automatic drafts at quote acceptance, milestone done and cycle opening, and billing locks on milestones, extra work and currencies (PR 2)
- [ ] F12 Ad campaigns and ad budget
- [ ] F03 Leads
- [ ] Automations A01, A02 (invoice part), A10, A11, A12
- [ ] Production deploy of Phase 3

## Phase 4 — Visibility
- [ ] F15 Dashboards and reports (incl. monthly client report)
- [ ] F14 Email and daily digest
- [ ] Production deploy of Phase 4

## Launch checklist
- [ ] Off-server backups configured and a restore tested
- [x] Domain and TLS
- [ ] Production secrets set on the server only
- [ ] All users onboarded; data from the pilot clients verified
