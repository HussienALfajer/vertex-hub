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
| Files | Local disk behind a storage interface; nginx serves after API authorization; versioned items | 0009, 0019 |
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

`auth` · `clients` · `leads` · `catalog` · `quotes` · `projects` · `tasks` · `templates` · `content` · `approvals` · `files` · `calendar` · `campaigns` · `invoices` · `notifications` · `reports` · `audit`

Rules (module anatomy, naming and the tests that enforce them: ADR 0013):
- A module owns its tables. Other modules call its exported service; they never query its tables.
- Controllers stay thin: validate (Zod DTO), authorize (guard), delegate to a service.
- `auth` owns identity and access: the Better Auth tables, `user_roles`, `departments` and `department_members`, with the team, department and `/api/me` endpoints. Better Auth needs the `users` table and the guard needs roles and departments, so splitting them into another module would create a dependency cycle (F01 plan).
- `clients` owns `clients`, `client_contacts`, `client_platform_accounts` and `client_notes` (F02). It reads users through `auth`'s exported `UserDirectory`. It exports `ClientFlagHooks`, called inside the transaction that changes a client's healthcare flag (F09). Modules that make a user responsible for something (F02: the account manager of a live client) register a check in `auth`'s `ResponsibilityRegistry`, which archiving a user or removing their role consults, so `auth` never imports them.
- `projects` owns projects, milestones, retainers, their monthly cycles and extra work (F05; retainers share its permissions, so there is no separate `retainers` module). It reads clients through `clients`' exported `ClientDirectory` (summaries and SQL filters over a client-id column, never the tables), registers the project manager check in `ResponsibilityRegistry`, and exports `WorkProgress`, where `tasks` (F06) registers task counts and the project close hooks (open tasks refuse completion; cancelling a project cancels them), and `EngagementDirectory` (project, milestone, cycle and line summaries with task counts, SQL filters, access checks for work on a project or retainer, milestone creation, and the extra work a task logs or withdraws). It also exports `CycleOpenedHooks`, called inside the transaction that opens a retainer cycle, where `templates` generates the cycle's tasks (F07). It exports `EngagementFactory` for `quotes` (F04 A01): creates a project with its milestones, a retainer with its lines and first cycle, and renews a retainer, inside the caller's transaction with F05's rules and audit.
- `tasks` owns `tasks`, `task_dependencies`, `task_checklist_items`, `task_links`, `task_revisions` and `task_comments` (F06, ADR 0016). It reads users and department memberships through `UserDirectory`, clients through `ClientDirectory` and engagements through `EngagementDirectory`; it registers into `WorkProgress` and registers open assigned tasks in `ResponsibilityRegistry`. It exports `TaskGenerator`, through which `templates` creates tasks in its own transaction. It also owns the review stage, `task_reviews` (review snapshots) and `task_client_responses` (F09, ADR 0020): it registers into `clients`' `ClientFlagHooks` to apply healthcare flag changes to work not yet sent, and exports `TaskApprovals` and the `ClientReviewHooks` registry for `approvals`, which tells it about pending approval items and hears when a task leaves `awaiting_client`. It also owns the link of a task to a post (`tasks.post_id`, F08, ADR 0021): it exports `PostTasks` (linkable tasks, link, unlink, a task requested from a post, sending one back, delivering them at publish) and the `PostTaskHooks` registry, through which `content` hears that a linked task was approved, cancelled or archived. `tasks` never imports `approvals` or `content`, and `clients` never imports `tasks` (the architecture test checks all three).
- `approvals` owns `approval_requests` and `approval_items` (F09, ADR 0020): ready tasks and posts (F08, ADR 0021) of one client bundled into a link for a contact with final-approval authority, and the public client page behind the link's token (`/api/public/approvals/...`, no session). It reads ready tasks, snapshots and responses and records a link response through `tasks`' `TaskApprovals`, and registers the source of `ClientReviewHooks` (the pending item of a task, and what happens to it when the task leaves `awaiting_client`); it does the same for posts through `content`'s `PostApprovals` and `PostReviewHooks`. It reads the versions it sent and serves them to the holder of a link through `files`' `FileVersions`, reads clients and contacts through `ClientDirectory` and users through `UserDirectory`, and notifies through `NotificationCenter`. It works the hourly `approvals.reminders` job. Nothing imports `approvals`.
- `content` owns `content_posts`, `post_reviews` (review snapshots of posts) and `post_client_responses` (F08, ADR 0021): the content calendar, the post workflow with its medical stage, and the client's answers recorded by hand. It reads users through `UserDirectory` (also the access of a post's responsible person) and registers open posts in `ResponsibilityRegistry`; reads clients through `ClientDirectory` and registers into `ClientFlagHooks`; reads cycle lines through `EngagementDirectory` and adds the posts counted directly on a line to `WorkProgress` (a second source of cycle line counts beside tasks); registers the `post` owner policy in `FileOwnerRegistry` and reads post media through `FileVersions` (its own files, then the final versions of its linked tasks); notifies through `NotificationCenter` and registers the publish reminders in `DailyReminders`. It links tasks to posts through `tasks`' `PostTasks` and registers into its `PostTaskHooks`; publishing a post delivers its linked tasks in the same transaction. It exports `PostApprovals` and the `PostReviewHooks` registry for `approvals`, which tells it about pending approval items and hears when a post leaves `awaiting_client`. `tasks`, `files`, `clients` and `projects` never import `content`, and `content` never imports `approvals` (the architecture test checks both).
- `calendar` owns `shoots`, `shoot_crew`, `shoot_shots`, `meetings`, `meeting_attendees` and `meeting_contacts` (F11, ADR 0022): shoot bookings tied to a Photography task, meetings, schedule conflicts and the company calendar. It books, delivers and cancels shoot tasks and creates the editing task through `tasks`' `ShootTasks`, and registers into its `TaskGuards` so a scheduled shoot keeps its task from being cancelled, archived or moved; reads users through `UserDirectory` and registers scheduled shoots a user leads and upcoming meetings they organize in `ResponsibilityRegistry`; reads clients and contacts through `ClientDirectory` and the key dates of projects and retainers through `EngagementDirectory` and invoice due dates through `invoices`' `InvoiceDueDates`; notifies through `NotificationCenter` and registers the upcoming and not-closed reminders in `DailyReminders`. `tasks`, `clients`, `projects` and `auth` never import `calendar` (the architecture test checks it).
- `templates` owns `work_templates`, their stages, steps, step dependencies and default assignees, `retainer_templates`, `template_runs` and `template_run_tasks` (F07, ADR 0017). It reads users and department memberships through `UserDirectory`, clients through `ClientDirectory` and projects, milestones, retainers and cycles through `EngagementDirectory`; it creates tasks through `TaskGenerator` and registers into `CycleOpenedHooks`, so the daily `retainers.cycles` job generates each new cycle's tasks. It exports `TemplateDirectory` (template names, kinds and archived state) for `catalog` and `TemplateRunner` (plans and applies project templates and links monthly templates inside the caller's transaction) for `quotes`; `templates` never imports `catalog` or `quotes`.
- `catalog` owns `catalog_services`, `catalog_packages` and `catalog_package_items` (F04, ADR 0023): services with their prices, performing department, revision rounds, counted deliverable kind and template, and packages of services under one price. It reads templates through `templates`' `TemplateDirectory`. It exports `CatalogDirectory` (services and packages with items, prices and template ids) and `CatalogUsage`, where modules that copy catalog items register a check so a used item keeps its billing (`SERVICE_IN_USE`); `catalog` never imports them.
- `quotes` owns `quote_settings`, `quote_numbers`, `quotes`, `quote_lines`, `quote_line_items` and `quote_installments` (F04): one `quotes` row per version, children replaced while a draft and frozen once sent. It copies catalog items through `CatalogDirectory` and registers into `CatalogUsage`, reads clients and contacts through `ClientDirectory` and users through `UserDirectory`, notifies through `NotificationCenter`, and works the daily `quotes.daily` expiry job. Its PDFs (rules 12 and 13) are rendered by the worker from a frozen payload (`quotes.pdf`); it works the result (`quotes.pdf-ready`), attaches a sent version's PDF as a document through `files`' `GeneratedFiles` and registers the `quote` owner policy in `FileOwnerRegistry`. Recording an acceptance runs A01's engagement part in one transaction through `projects`' `EngagementFactory` (project with milestones, new or renewed retainer and its first cycle) and `templates`' `TemplateRunner`, and attaches the proof upload through `GeneratedFiles`. It exports `QuoteDirectory` (the company details printed on quotes and invoices, quote numbers) for `invoices`.
- `invoices` owns `invoice_settings`, `document_numbers`, `invoices`, `invoice_lines`, `payments`, `project_expenses` and `statement_pdfs` (F13, ADR 0024): drafts whose lines may bill a milestone, a retainer cycle or an extra work item (one live invoice per source, by partial unique indexes), numbered on issue from a locked counter, frozen and voided instead of corrected. It reads clients and their billing details through `ClientDirectory`, users through `UserDirectory`, company details and quote numbers through `quotes`' `QuoteDirectory`, and the billable work of projects and retainers through `projects`' exported `BillingSources`, which also sets extra work `billed` on issue and `unbilled` on void with F05's audit entries. It drafts invoices automatically inside the transactions of `quotes`' `QuoteAcceptedHooks` (the deposit), `projects`' `MilestoneDoneHooks` (the installment) and `CycleOpenedHooks` (the retainer month), and registers the source of `projects`' `BillingLocks`, which refuses currency changes on invoiced engagements and changes to invoiced milestones and extra work. Payments take receipt numbers from the same counter and keep their proof as a document of the invoice through `files`' `GeneratedFiles` (owner policy `invoice` in `FileOwnerRegistry`); `invoice_paid` and `invoice_overdue` go through `NotificationCenter`. Invoice, draft preview, receipt and statement PDFs are rendered by the worker's `invoices.pdf` job from frozen payloads; the API takes the results (`invoices.pdf-ready`), attaching invoice and receipt PDFs as documents of the invoice through `GeneratedFiles` and keeping statement renders in `statement_pdfs` for 24 hours (purged through `files`' `FilePurges`). It works the daily `invoices.daily` job (overdue, and queues pending PDFs again) and registers the `invoices-overdue` source of `notifications.daily` (weekly reminders). It serves client balances and statements, and the billing summaries of projects (milestones with their invoices, expenses and the USD margin) and retainers, reading milestones, cycles and extra work through `BillingSources`; it exports `InvoiceDueDates` (open invoices' due dates, filtered by invoice access) for `calendar`. Neither `projects` nor `quotes` imports `invoices`.
- `campaigns` owns `ad_campaigns`, `ad_campaign_updates`, `ad_wallets` and `ad_wallet_entries` (F12, ADR 0025): a client's ad campaigns with a planned USD budget, a five-status lifecycle and periodic updates of spend, reach, clicks and results (one calendar month per update, no overlapping periods), and the client's USD ad-budget wallet: deposits (numbered `AD-<year>-<n>`) and refunds, voided instead of deleted, with the spend of wallet-funded campaigns deducted from a balance computed on read. Every balance change locks the client's wallet row; crossing below the threshold sends A11 (`ad_budget_low`), repeated weekly by the `ad-budget-low` source of `notifications.daily`. It reads clients through `ClientDirectory`, users through `UserDirectory`, the optional project or retainer link through `projects`' `EngagementDirectory` and the optional task link through `tasks`' `TaskLinks` (the links are for display and reports only), takes receipt numbers and the current rate from `invoices`' `DocumentNumbers`, and keeps entry proofs as documents of the entry (`files`, owner type `ad_wallet_entry`, listed in neither the client library nor its documents). No module imports `campaigns`.
- `notifications` owns `notifications`, `notification_settings` and `notification_reminders` (F14, ADR 0018). It reads users through `UserDirectory` and exports `NotificationCenter`, which emitting modules call inside the transaction of their change (the `pg_notify` it sends is delivered on commit to the one `LISTEN` connection that feeds the SSE streams), and `DailyReminders`, where modules register their part of the daily `notifications.daily` job and record each reminder once. It never imports the modules that emit (the architecture test checks it).
- `files` owns `file_items`, `file_versions` and `file_uploads` (F10, ADR 0019), with content on disk under `FILES_ROOT` behind its `FileStorage` interface. It reads users through `UserDirectory` and notifies through `NotificationCenter`. It never imports `tasks`, `clients`, `projects`, `content` or `quotes` (the architecture test checks it): they register an owner policy per owner type in its exported `FileOwnerRegistry` (visibility, rights, client, archived state, label), and `tasks` calls its exported `FileVersions` inside its own transactions for the final markers (automatic on an approval without the client, `client` on the snapshot a client approved, F09), the client of task files, the file counts and the versions of a review snapshot. The `task` owner policy also names the versions under medical review or with the client, which `files` refuses to remove (`VERSION_SENT`). `GeneratedFiles` attaches and serves files the system renders (F04 quote PDFs, written by the worker under `FILES_ROOT`), and attaches an upload as a document of an owner whose documents are read-only through the file endpoints (F04 acceptance proof). It works the `files.preview` and `files.purge-uploads` jobs.
- `audit` sits below every other module: it owns `audit_entries` and exports `recordAudit`, which each module calls inside the transaction of its change. The access decorators live in `src/core/access/` so that `audit` does not depend on `auth`.
- Cross-cutting request handling lives in `src/core/`: `http/same-origin.ts` refuses cross-origin state changes on every route (CSRF), and `errors/database-error.filter.ts` answers a write that lost a race (unique index, deadlock) with its coded 409 instead of a 500.
- Anything slow or scheduled (PDF, email, reminders, monthly cycles) goes through pg-boss (ADR 0008). `apps/worker` owns the schedules and runs work that needs no module state (PDF, email). A scheduled job whose rule lives in a module service is worked by the API process through `src/core/jobs/` (`JobQueue.work`), so it sees what other modules registered (F05: `retainers.cycles`, which reads F06 task counts through `WorkProgress`; F14: `notifications.daily`, which runs the reminder sources other modules register; F10: `files.preview` and `files.purge-uploads`). A render the worker does is queued by the API with its frozen payload and handed back as a job the API works (F04: `quotes.pdf`, then `quotes.pdf-ready`).

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
   └── /_files/ → internal only: files served after the API authorizes them (X-Accel-Redirect)
apps/worker (PM2) → pg-boss jobs, PDF (Chromium), email
PostgreSQL 17 → dedicated database and role for Vertex Hub
```

Deployment follows the server's existing conventions (ADR 0009): a dedicated system user and PM2 service, code in `/srv/<domain>/`, app logs in `/var/log/<site>/`, nginx logs in `/var/log/nginx/<site>.*.log`, backups in `/var/backups/<site>/`.

## Environments

- **Local (Windows):** PostgreSQL 17 installed natively; `pnpm db:setup-local` creates the role and the `vertex_hub` and `vertex_hub_test` databases. `pnpm dev` runs api (:3000), worker and web (:5173, proxies `/api`).
- **CI:** GitHub Actions with a PostgreSQL service container.
- **Production:** https://hub.vertexmedia.pro on the owner's VPS, atomic releases with automatic rollback (runbook: `docs/deployment.md`). No staging in V1.
