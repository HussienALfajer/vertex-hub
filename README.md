# Vertex Hub

Operations and automation platform for Vertex Media, a full-service media and marketing agency. It runs the client lifecycle end to end: leads, quotes, projects and monthly retainers, cross-department tasks, content calendars, client approvals, files, shoots, ad budgets, invoicing and reporting.

Arabic-first (RTL) web application.

## Status

Early development — Phase 0 (foundation). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

Requirements: Node 24, pnpm (via Corepack), PostgreSQL 17 running locally.

```bash
pnpm install
pnpm db:setup-local   # creates .env, the vertex_hub role and databases (asks for the postgres password)
pnpm db:migrate
pnpm build            # needed once for the next command
pnpm --filter @vertex-hub/api user:create --email you@example.com --name "Your Name" --department general_management --role general_manager
pnpm dev              # api http://127.0.0.1:3000/api/docs · web http://127.0.0.1:5173
```

`user:create` prints a generated password once; sign in with it at http://127.0.0.1:5173/login. Self sign-up is disabled.

All commands are listed in [AGENTS.md](AGENTS.md#commands).

## Documentation

- [V1 scope](docs/product/v1-scope.md)
- [Architecture](docs/architecture.md)
- [Decision records](docs/decisions/README.md)
- [Working method](docs/workflow.md)
- [Open questions](docs/open-questions.md)

## Stack

TypeScript monorepo (pnpm, Turborepo): NestJS API and worker, PostgreSQL with Drizzle, React + Vite SPA, and a design system built on shadcn/ui and Base UI.
