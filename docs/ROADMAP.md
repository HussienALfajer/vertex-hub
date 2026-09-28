# Roadmap

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done. Feature IDs refer to `docs/product/v1-scope.md`.

## Phase 0 — Foundation
- [x] Product scope, decisions and working method documented
- [ ] Monorepo scaffold (pnpm, Turborepo, TypeScript, Biome, shared config)
- [ ] `packages/db` with Drizzle and first migration; local PostgreSQL
- [ ] `apps/api` skeleton: NestJS, nestjs-zod, OpenAPI, pino, health endpoint
- [ ] `apps/worker` skeleton: pg-boss wiring
- [ ] `apps/web` skeleton: Vite, TanStack Router/Query, i18next, RTL shell
- [ ] Design system: tokens from the Vertex brand, base components in `packages/ui` (needs brand assets)
- [ ] Authentication (Better Auth) and permission guards
- [ ] CI: typecheck, lint, test, build, gitleaks
- [ ] Claude Code setup: `.claude/settings.json` (permissions, hooks), path-scoped rules, core skills and subagents
- [ ] Deployment skeleton on the VPS (needs domain decision)

## Phase 1 — Core
- [ ] F01 Users, departments, roles and permissions
- [ ] F02 Clients
- [ ] F05 Projects and retainers
- [ ] F06 Task engine and workflow
- [ ] F07 Work templates
- [ ] F14 Notifications (in-app)
- [ ] Automations A03, A07, A08
- [ ] Pilot with 2–3 real clients

## Phase 2 — Production and client
- [ ] F08 Content calendar
- [ ] F09 Internal review and client approval (incl. medical review)
- [ ] F10 Files and versions
- [ ] F11 Unified calendar and shoots
- [ ] Automations A02 (task part), A04, A05, A06, A09, A13

## Phase 3 — Money and sales
- [ ] F04 Service catalog and quotes
- [ ] F13 Invoicing and collection
- [ ] F12 Ad campaigns and ad budget
- [ ] F03 Leads
- [ ] Automations A01, A02 (invoice part), A10, A11, A12

## Phase 4 — Visibility
- [ ] F15 Dashboards and reports (incl. monthly client report)
- [ ] F14 Email and daily digest

## Launch checklist
- [ ] Off-server backups configured and a restore tested
- [ ] Domain and TLS
- [ ] Production secrets set on the server only
- [ ] All users onboarded; data from the pilot clients verified
