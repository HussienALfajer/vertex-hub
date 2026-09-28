# Architecture

Decisions behind this document are in `docs/decisions/`. Library versions are pinned in the lockfile once the workspace is scaffolded; verify peer-dependency compatibility at install time.

## Shape

One repository (pnpm workspaces + Turborepo) with separately deployable apps and shared packages. The backend is a **modular monolith**: one NestJS API, split internally into domain modules with explicit boundaries (ADR 0001).

```
vertex-hub/
├── apps/
│   ├── api/          NestJS HTTP API (Express adapter), one module per domain
│   ├── worker/       NestJS standalone context: pg-boss jobs, PDF, email
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

`auth` · `users` · `clients` · `leads` · `catalog` · `quotes` · `projects` · `retainers` · `tasks` · `templates` · `content` · `approvals` · `files` · `shoots` · `campaigns` · `billing` · `notifications` · `reports` · `audit`

Rules:
- A module owns its tables. Other modules call its exported service; they never query its tables.
- Controllers stay thin: validate (Zod DTO), authorize (guard), delegate to a service.
- Anything slow or scheduled (PDF, email, reminders, monthly cycles) is enqueued with pg-boss and handled by `apps/worker`, which reuses the same modules.

## Authentication and authorization

- Better Auth is mounted by the `auth` module at `/api/auth` (email and password, sessions in the `sessions` table, self sign-up disabled). Until F01 ships, accounts are created with `pnpm --filter @vertex-hub/api user:create`.
- Every API route requires a session unless marked `@AllowAnonymous()` (Better Auth's global guard). `@RequirePermissions(...)` adds a role check against `PERMISSION_MAP` in `packages/contracts`; roles live in `user_roles` (several per user, ADR 0007).
- A permission is granted with a scope (`all`, `department`, `own_clients`, `assigned`). Guards check the permission; services turn the scopes from `permissionScopes()` into query filters.
- `GET /api/me` returns the user, roles and permissions; the web app uses it for route guards and to hide what the user cannot do (cosmetic only).
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
