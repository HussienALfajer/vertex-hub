# Vertex Hub

Internal operations and automation platform for **Vertex Media**, a full-service media and marketing agency (digital marketing, social media management, content, design and branding, photo/video, ad campaigns, web/app development and automation). Ten departments, ~20 staff, ~20 clients.

V1 goal: the smallest system that runs the whole client lifecycle — lead → quote → project or retainer → tasks across departments → internal review → client approval → delivery → invoice → payment → report.

This project is independent. Do not read or reuse other folders on this machine (including other `vertex-*` directories) unless the owner explicitly asks.

## Source of truth

| File | Purpose |
|---|---|
| `docs/product/v1-scope.md` | What V1 includes and excludes. Anything not in it is out of scope: ask before adding. |
| `docs/decisions/` | Architecture and business decisions (ADRs). Follow them; propose a new ADR to change one. ADR 0013 is the code shape: layout, module anatomy, naming, errors, lists, tests. |
| `<app or package>/CLAUDE.md` | Local rules and the pattern to copy for `apps/api`, `apps/web`, `apps/worker`, `packages/{contracts,db,messages,ui}` and `deploy`. Any agent reads it before editing in that folder (Claude Code loads it on its own). |
| `docs/architecture.md` | Stack, repo layout, module map, data conventions, deployment topology. |
| `docs/ROADMAP.md` | Phase and feature status. Update it when a feature ships. |
| `docs/specs/<feature>.md` | Detailed spec per feature, written before implementation. |
| `docs/open-questions.md` | Unresolved decisions. Never guess an answer to one: ask. |
| `docs/workflow.md` | How work is run with AI coding agents (feature cycle, effort, sessions). |
| `brand/identity.md` | Visual identity: colors, typography, shape, motif, logo usage, patterns to avoid. Read before any UI work. |
| `brand/` | The only home of logo files and brand assets. |

Read these on demand. For a feature, read its spec, the ADRs it touches, and its section of `v1-scope.md`.

## Stack

pnpm workspaces + Turborepo · TypeScript (strict) · Node 24 · PostgreSQL 17

- `apps/api` — NestJS (Express adapter), Drizzle ORM, Zod contracts via native Standard Schema validation (ADR 0012), OpenAPI, Better Auth, pg-boss producer
- `apps/worker` — NestJS standalone context: scheduled jobs (pg-boss), PDF rendering (Playwright/Chromium), email
- `apps/web` — React 19 + Vite SPA, TanStack Router / Query / Table, React Hook Form, i18next
- `packages/ui` — Vertex design system: shadcn/ui on Base UI + Tailwind CSS v4 tokens (RTL)
- `packages/contracts` — Zod schemas, shared types, permission map
- `packages/db` — Drizzle schema and migrations
- `packages/messages` — Arabic texts shared by web and worker (emails, notification texts; ADR 0028)
- Tests: Vitest (unit, API integration) and Playwright (E2E, RTL screenshots) · Lint/format: Biome · CI: GitHub Actions

## Commands

Run from the repository root (Node 24, pnpm via Corepack). Turborepo builds dependent packages first.

| Task | Command |
|---|---|
| Install | `pnpm install` |
| First-time local DB (creates `.env`, role, dev + test databases; asks for the postgres password) | `pnpm db:setup-local` |
| Dev (api :3000, worker, web :5173) | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint + format check / fix | `pnpm lint` / `pnpm lint:fix` |
| Unit + integration tests (need `TEST_DATABASE_URL`; migrations run automatically; the packages that share the test database, `db` → `worker` → `api`, run one after another, see `turbo.json`) | `pnpm test` |
| E2E smoke (Playwright, builds web first) | `pnpm test:e2e` |
| Generate a migration after a schema change | `pnpm db:generate` |
| Apply migrations to the dev database | `pnpm db:migrate` |
| Build | `pnpm build` |
| Refresh the web app's OpenAPI document and client types after an API change (CI checks both; needs `pnpm build`) | `pnpm --filter @vertex-hub/api openapi:export` then `pnpm --filter @vertex-hub/web api:generate` |
| Seed the dev database with a sample agency for manual testing (20 users on `@vertexhub.test`, clients, leads, quotes, projects, retainers, tasks, content, calendar, campaigns, invoices; safe to rerun; development only; needs `pnpm build`) | `pnpm --filter @vertex-hub/api db:seed` |
| Create a user (prints a generated password once; needs `pnpm build`) | `pnpm --filter @vertex-hub/api user:create --email <email> --name <name> --department <code> [--role <role>]` |
| Run the daily notifications job once, as if on a date (development only; needs `pnpm build`) | `pnpm --filter @vertex-hub/api notifications:run-daily [--date YYYY-MM-DD]` |
| Run the daily invoices job once (overdue, A10), as if on a date (development only; needs `pnpm build`) | `pnpm --filter @vertex-hub/api invoices:run-daily [--date YYYY-MM-DD]` |
| Run the notification email batches once, as if at an instant (F14 email; development only; needs `pnpm build`; the worker sends what it queues) | `pnpm --filter @vertex-hub/api email:run-notifications [--at <ISO date-time>]` |
| Run the morning digest once, as if at 08:00 on a date (F14 email; development only; needs `pnpm build`) | `pnpm --filter @vertex-hub/api email:run-digest [--date YYYY-MM-DD]` |
| One package only | `pnpm --filter @vertex-hub/<name> <script>` |

API docs (non-production): `http://127.0.0.1:3000/api/docs`. Health: `GET /api/health`.

## Non-negotiable conventions

- **Arabic-first RTL UI.** Use logical CSS (`ms-*`, `ps-*`, `start-*`, `text-start`), never physical left/right. All user-facing strings go through i18next; no hard-coded UI text.
- **Money:** integer minor units + currency code, never floats. Exchange rates are stored on each invoice and each payment. See ADR 0006.
- **One validation source:** Zod schemas live in `packages/contracts` and are reused by api and web. Don't duplicate schemas or types.
- **Authorization is server-side:** every API endpoint enforces the shared permission map. UI permission checks are cosmetic only.
- **Audit:** every state change on a business record writes an audit log entry.
- **Module boundaries:** an api module reaches another module only through its `index.ts` and exported services, never its tables. `apps/api/test/architecture.test.ts` enforces it, with explicit access on every route.
- **Design system only:** the UI uses `packages/ui` components and tokens; no ad-hoc colors, fonts, or spacing.
- **No secrets in the repo** (it is public). Use git-ignored `.env` files and keep `.env.example` with fake values.
- **No licensed fonts in the repo.** Madani Arabic files stay in git-ignored `brand/fonts/private/`; builds must work with the fallback font.
- **Archive, don't delete:** business records are archived, not hard-deleted.

## How to work

- Continue without asking when the next step needs no input from the owner. Put brief status notes in the same message as the next action.
- Stop and ask only when a decision belongs to the owner (scope, business rules, anything in `open-questions.md`), when a spec is ambiguous in a way that changes the result, or before a destructive or outward-facing action (deleting data, dropping tables, force-push, touching the production server, publishing).
- A task is done only when its checks pass: typecheck, lint, and the relevant tests; for UI changes, a Playwright screenshot in RTL. Show the evidence (commands run and their results) instead of asserting success.
- Fix root causes. Never silence a failing test, type error, or lint rule to make a check pass.
- For multi-step work keep a checklist in `TASKS.md`: mark items done and add work you discover.
- Mark anything you could not confirm and say where you looked.
- Match the surrounding code: copy the pattern named in the folder's `CLAUDE.md` rather than inventing a new one. Write no speculative code: helpers, options and abstractions arrive with their first real use.

## Context economy

- Search before reading (file and content search), then read only the relevant range. For `v1-scope.md`, read the feature's section, not the whole file.
- Never read generated or lock files: `pnpm-lock.yaml` (use `pnpm why <pkg>` or the `package.json`), `packages/db/migrations/meta/`, `routeTree.gen.ts`, `dist/`, `.turbo/`. Open Playwright screenshots only to verify a UI change.
- Run the narrowest check first (one package, one test file), and the full `typecheck`, `lint` and `test` once before the PR. With Turborepo, add `--output-logs=errors-only`.
- In replies, point to `path:line` instead of pasting files or diffs.

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One branch per change, named by its type (`feat/<feature>`, `fix/<topic>`, `refactor/<topic>`, `chore/<topic>`, `docs/<topic>`), merged to `main` through a PR after CI passes.
- Right after opening a PR, enable auto-merge with a merge commit: `gh pr merge <number> --auto --merge`. `main` requires the three CI checks, so the PR merges only when CI is green, and GitHub then deletes the remote branch. Never squash or rebase-merge: the owner's cleanup uses `git branch -d`, which refuses branches merged that way.

## Reporting

End every substantial task with these sections, in this order:

1. **Needs from you** — decisions or approvals blocking progress, or "nothing". Whenever the task opened or merged a PR, always end this section with the local cleanup line for that PR's branch, in a code block, to run after the merge. Start it with `cd` to the owner's checkout so it works from any terminal: `cd D:\vertex-hub; git switch main; git pull --ff-only; git branch -d <branch>`
2. **Changed** — what was built or modified.
3. **Verified** — checks run and their results.
4. **Found** — issues, risks, or follow-ups noticed.
5. **Next step** — always last: the next task you recommend (from `docs/ROADMAP.md` or what this task uncovered), why it comes next, and what it needs from the owner before it can start. Then, in this order: whether it needs a new session (`/clear` locally, a new session from the sidebar in the cloud) and whether it can run in the cloud (`docs/workflow.md`, "Cloud sessions"), the model and effort to set before the first message (from the session table in `docs/workflow.md`), and the exact first message to send, in its own code block.

## Language

Talk to the owner in Arabic. Write everything stored in the repo in English: code, comments, docs, commit messages, PR descriptions.

## Production server

Deploys go to the owner's existing Ubuntu VPS: PM2 + nginx, one isolated system user per site, apps listen on `127.0.0.1` only, nginx is the only public gateway. Never run commands on the server without explicit approval in the current conversation. Deploys, rollbacks and server layout: `docs/deployment.md`.
