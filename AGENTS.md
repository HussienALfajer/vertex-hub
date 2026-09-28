# Vertex Hub

Internal operations and automation platform for **Vertex Media**, a full-service media and marketing agency (digital marketing, social media management, content, design and branding, photo/video, ad campaigns, web/app development and automation). Ten departments, ~20 staff, ~20 clients.

V1 goal: the smallest system that runs the whole client lifecycle — lead → quote → project or retainer → tasks across departments → internal review → client approval → delivery → invoice → payment → report.

This project is independent. Do not read or reuse other folders on this machine (including other `vertex-*` directories) unless the owner explicitly asks.

## Source of truth

| File | Purpose |
|---|---|
| `docs/product/v1-scope.md` | What V1 includes and excludes. Anything not in it is out of scope: ask before adding. |
| `docs/decisions/` | Architecture and business decisions (ADRs). Follow them; propose a new ADR to change one. |
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
| Unit + integration tests (need `TEST_DATABASE_URL`; migrations run automatically) | `pnpm test` |
| E2E smoke (Playwright, builds web first) | `pnpm test:e2e` |
| Generate a migration after a schema change | `pnpm db:generate` |
| Apply migrations to the dev database | `pnpm db:migrate` |
| Build | `pnpm build` |
| One package only | `pnpm --filter @vertex-hub/<name> <script>` |

API docs (non-production): `http://127.0.0.1:3000/api/docs`. Health: `GET /api/health`.

## Non-negotiable conventions

- **Arabic-first RTL UI.** Use logical CSS (`ms-*`, `ps-*`, `start-*`, `text-start`), never physical left/right. All user-facing strings go through i18next; no hard-coded UI text.
- **Money:** integer minor units + currency code, never floats. Exchange rates are stored on each invoice and each payment. See ADR 0006.
- **One validation source:** Zod schemas live in `packages/contracts` and are reused by api and web. Don't duplicate schemas or types.
- **Authorization is server-side:** every API endpoint enforces the shared permission map. UI permission checks are cosmetic only.
- **Audit:** every state change on a business record writes an audit log entry.
- **Module boundaries:** an api module reaches another module only through that module's exported service, never its tables directly.
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

## Git

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One branch per feature (`feat/<feature>`), merged to `main` through a PR after CI passes.
- Right after opening a PR, enable auto-merge with a merge commit: `gh pr merge <number> --auto --merge`. `main` requires the three CI checks, so the PR merges only when CI is green, and GitHub then deletes the remote branch. Never squash or rebase-merge: the owner's cleanup uses `git branch -d`, which refuses branches merged that way.

## Reporting

End every substantial task with these sections, in this order:

1. **Needs from you** — decisions or approvals blocking progress, or "nothing". Whenever the task opened or merged a PR, always end this section with the local cleanup line for that PR's branch, in a code block, to run after the merge: `git switch main; git pull --ff-only; git branch -d <branch>`
2. **Changed** — what was built or modified.
3. **Verified** — checks run and their results.
4. **Found** — issues, risks, or follow-ups noticed.

## Language

Talk to the owner in Arabic. Write everything stored in the repo in English: code, comments, docs, commit messages, PR descriptions.

## Production server

Deploys go to the owner's existing Ubuntu VPS: PM2 + nginx, one isolated system user per site, apps listen on `127.0.0.1` only, nginx is the only public gateway. Never run commands on the server without explicit approval in the current conversation.
