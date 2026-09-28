# Vertex Hub

Operations and automation platform for Vertex Media, a full-service media and marketing agency. It runs the client lifecycle end to end: leads, quotes, projects and monthly retainers, cross-department tasks, content calendars, client approvals, files, shoots, ad budgets, invoicing and reporting.

Arabic-first (RTL) web application.

## Status

Early development — Phase 0 (foundation). See [docs/ROADMAP.md](docs/ROADMAP.md).

## Documentation

- [V1 scope](docs/product/v1-scope.md)
- [Architecture](docs/architecture.md)
- [Decision records](docs/decisions/README.md)
- [Working method](docs/workflow.md)
- [Open questions](docs/open-questions.md)

## Stack

TypeScript monorepo (pnpm, Turborepo): NestJS API and worker, PostgreSQL with Drizzle, React + Vite SPA, and a design system built on shadcn/ui and Base UI.
