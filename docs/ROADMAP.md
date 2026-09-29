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
- [ ] Pilot with 2–3 real clients
- [ ] Production deploy of Phase 1

## Phase 2 — Production and client
- [ ] F08 Content calendar
- [ ] F09 Internal review and client approval (incl. medical review)
- [ ] F10 Files and versions
- [ ] F11 Unified calendar and shoots
- [ ] Automations A04, A05, A06, A09, A13 (A02 task part moved to F07)
- [ ] Production deploy of Phase 2

## Phase 3 — Money and sales
- [ ] F04 Service catalog and quotes
- [ ] F13 Invoicing and collection
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
