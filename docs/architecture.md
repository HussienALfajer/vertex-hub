# Architecture

Decisions behind this document are in `docs/decisions/`. Library versions are pinned in the lockfile once the workspace is scaffolded; verify peer-dependency compatibility at install time.

## Shape

One repository (pnpm workspaces + Turborepo) with separately deployable apps and shared packages. The backend is a **modular monolith**: one NestJS API, split internally into domain modules with explicit boundaries (ADR 0001).

```
vertex-hub/
├── apps/
│   ├── api/          NestJS HTTP API (Express adapter): src/core (infrastructure), src/modules (one per domain)
│   ├── worker/       NestJS standalone context: src/core, src/jobs (pg-boss jobs, PDF, email)
│   └── web/          React 19 + Vite SPA
├── packages/
│   ├── contracts/    Zod schemas, shared types, permission map
│   ├── db/           Drizzle schema, migrations, seed
│   ├── ui/           Vertex design system (shadcn/ui on Base UI, Tailwind v4 tokens)
│   └── config/       Shared TypeScript and Biome configuration
├── docs/
├── AGENTS.md
└── CLAUDE.md
```

## Stack by layer

| Layer | Choice | ADR |
|---|---|---|
| Language / runtime | TypeScript strict (~6.0), ESM, Node 24 | 0001, 0012 |
| Monorepo | pnpm workspaces, Turborepo | 0001 |
| API framework | NestJS 12, Express adapter | 0002, 0012 |
| Validation / API docs | Zod in `packages/contracts`, NestJS native Standard Schema pipe and serializer, OpenAPI via @nestjs/swagger | 0012 |
| Database | PostgreSQL 17 | 0005 |
| Data access | Drizzle ORM, drizzle-kit migrations | 0005 |
| Authentication | Better Auth (sessions in PostgreSQL, optional 2FA) | 0002 |
| Authorization | Own role/permission map in `packages/contracts`, enforced by NestJS guards | 0007 |
| Background jobs | pg-boss (queue and cron inside PostgreSQL) | 0008 |
| PDF | HTML → PDF with Playwright/Chromium in the worker | 0008 |
| Files | Local disk behind a storage interface; nginx serves after API authorization | 0009 |
| Images | sharp (thumbnails) | — |
| Email | Nodemailer over SMTP, React Email templates | — |
| Logging | pino (nestjs-pino) | — |
| Frontend | React 19, Vite, TanStack Router / Query / Table | 0003 |
| API client | Generated from the OpenAPI document (openapi-typescript + openapi-fetch) | 0003 |
| Design system | shadcn/ui on Base UI, Tailwind CSS v4, RTL | 0004 |
| Forms | React Hook Form + Zod | 0003 |
| Calendar views | FullCalendar (MIT core), RTL and Arabic locale | 0003 |
| Drag and drop | dnd-kit | — |
| Charts | Recharts | — |
| Rich text | Tiptap (briefs, captions, comments with mentions) | — |
| i18n | i18next; Intl for dates and numbers | 0003 |
| Icons | Lucide | — |
| Tests | Vitest (unit, API integration against a real test database), Playwright (E2E, RTL screenshots) | — |
| Lint / format | Biome | — |
| CI | GitHub Actions: typecheck, lint, test, build, gitleaks | — |

## API modules

`auth` · `clients` · `leads` · `catalog` · `quotes` · `projects` · `tasks` · `templates` · `content` · `approvals` · `files` · `shoots` · `campaigns` · `billing` · `notifications` · `reports` · `audit`

Rules (module anatomy, naming and the tests that enforce them: ADR 0013):
- A module owns its tables. Other modules call its exported service; they never query its tables.
- Controllers stay thin: validate (Zod DTO), authorize (guard), delegate to a service.
- `auth` owns identity and access: the Better Auth tables, `user_roles`, `departments` and `department_members`, with the team, department and `/api/me` endpoints. Better Auth needs the `users` table and the guard needs roles and departments, so splitting them into another module would create a dependency cycle (F01 plan).
- `clients` owns `clients`, `client_contacts`, `client_platform_accounts` and `client_notes` (F02). It reads users through `auth`'s exported `UserDirectory`. Modules that make a user responsible for something (F02: the account manager of a live client) register a check in `auth`'s `ResponsibilityRegistry`, which archiving a user or removing their role consults, so `auth` never imports them.
- `projects` owns projects, milestones, retainers, their monthly cycles and extra work (F05; retainers share its permissions, so there is no separate `retainers` module). It reads clients through `clients`' exported `ClientDirectory` (summaries and SQL filters over a client-id column, never the tables), registers the project manager check in `ResponsibilityRegistry`, and exports `WorkProgress`, where `tasks` (F06) registers task counts and the project close hooks (open tasks refuse completion; cancelling a project cancels them), and `EngagementDirectory` (project, milestone, cycle and line summaries, SQL filters, and the extra work a task logs or withdraws).
- `tasks` owns `tasks`, `task_dependencies`, `task_checklist_items`, `task_links`, `task_revisions` and `task_comments` (F06, ADR 0016). It reads users and department memberships through `UserDirectory`, clients through `ClientDirectory` and engagements through `EngagementDirectory`; it registers into `WorkProgress` and registers open assigned tasks in `ResponsibilityRegistry`. Nothing imports `tasks`.
- `audit` sits below every other module: it owns `audit_entries` and exports `recordAudit`, which each module calls inside the transaction of its change. The access decorators live in `src/core/access/` so that `audit` does not depend on `auth`.
- Anything slow or scheduled (PDF, email, reminders, monthly cycles) goes through pg-boss (ADR 0008). `apps/worker` owns the schedules and runs work that needs no module state (PDF, email). A scheduled job whose rule lives in a module service is worked by the API process through `src/core/jobs/` (`JobQueue.work`), so it sees what other modules registered (F05: `retainers.cycles`, which reads F06 task counts through `WorkProgress`).

## Authentication and authorization

- Better Auth is mounted by the `auth` module at `/api/auth` (email and password, sessions in the `sessions` table, self sign-up disabled, TOTP two-factor plugin, sign-in rate limiting). User managers create accounts in the app (F01); `pnpm --filter @vertex-hub/api user:create` bootstraps the first General Manager.
- Every API route requires a session unless marked `@AllowAnonymous()` (Better Auth's global guard). The `auth` module's global guard resolves the user's access on every request: effective roles (assigned roles in `user_roles` plus derived Employee and Department Manager) and department capabilities (ADR 0014). `@RequirePermissions(...)` checks the union of their grants from `packages/contracts`. Users who must use two-factor sign-in get `TWO_FACTOR_REQUIRED` until they enable it.
- A permission is granted with a scope (`all`, `department`, `own_clients`, `assigned`). Guards check the permission; services turn the scopes from `permissionScopes()` into query filters.
- `GET /api/me` returns the user, effective roles, departments, permissions with scopes and 2FA state; the web app uses it for route guards and to hide what the user cannot do (cosmetic only).
- The SPA and API share one origin (nginx in production, the Vite proxy locally), so no CORS is enabled.

## Data conventions

- Primary keys: UUIDv7 generated in the application.
- Timestamps: `timestamptz` stored in UTC; displayed in the business timezone (`Asia/Damascus`).
- Money: integer minor units + currency code; exchange rates as exact decimals (ADR 0006).
- Business records are archived (`archived_at`), not hard-deleted.
- Every business state change writes an audit entry (actor, action, entity, before/after).

## Runtime topology (production)

```
Internet → nginx (TLS, rate limits, the only public listener)
   ├── /        → static SPA build (served by nginx)
   ├── /api     → 127.0.0.1:<port> → apps/api   (PM2)
   └── /files   → internal redirect after the API authorizes the download
apps/worker (PM2) → pg-boss jobs, PDF (Chromium), email
PostgreSQL 17 → dedicated database and role for Vertex Hub
```

Deployment follows the server's existing conventions (ADR 0009): a dedicated system user and PM2 service, code in `/srv/<domain>/`, app logs in `/var/log/<site>/`, nginx logs in `/var/log/nginx/<site>.*.log`, backups in `/var/backups/<site>/`.

## Environments

- **Local (Windows):** PostgreSQL 17 installed natively; `pnpm db:setup-local` creates the role and the `vertex_hub` and `vertex_hub_test` databases. `pnpm dev` runs api (:3000), worker and web (:5173, proxies `/api`).
- **CI:** GitHub Actions with a PostgreSQL service container.
- **Production:** https://hub.vertexmedia.pro on the owner's VPS, atomic releases with automatic rollback (runbook: `docs/deployment.md`). No staging in V1.
