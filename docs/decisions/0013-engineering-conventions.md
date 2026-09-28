# 0013 — Engineering conventions: layout, module anatomy, data, errors, tests

Status: Accepted · Date: 2026-09-28

## Context
V1 has about twenty API modules, built by AI coding agents across many sessions and accounts (ADR 0010). Without one written shape, each session invents its own, and the codebase drifts. Rules that live only in prose are followed unevenly, so every rule that can be checked by a machine is enforced by a test or lint rule, not by review.

## Decision

### Layout
- `apps/api/src/`: `main.ts`, `app.module.ts`, `app.setup.ts`; `core/` for cross-cutting infrastructure (config, database, later errors); `modules/<module>/` for domain modules, named as in `docs/architecture.md`; `cli/` for command-line entry points.
- `apps/worker/src/`: `core/` (same role as in the API) and `jobs/` (one file per queue, `<name>.job.ts`).
- `packages/contracts/src/<module>.ts` and `packages/db/src/schema/<module>.ts`: one file per owning module.
- `apps/web/src/`: `routes/` (TanStack file routes, thin), `features/<module>/` (queries, mutations, components, forms of one domain), `components/` (app-wide), `lib/` (infrastructure), `i18n/`.

### API module anatomy
- Files: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `index.ts`. A large service splits by topic (`<module>-<topic>.service.ts`). File names are kebab-case with a role suffix; one exported class per file.
- `index.ts` is the module's public surface: its Nest module, the services other modules may call, and its decorators. Code outside the folder imports only from it.
- No repository layer: Drizzle is the data mapper, and services query it directly.
- Controllers are thin: validate with contract schemas (`{ schema }`, `@SerializeOptions({ schema })`), document with `@nestjs/swagger` (`standardSchema`), delegate to the service. No business logic and no database access in controllers.
- A module queries only the tables it owns. Other modules' data comes through their exported services.

### Access
- Every route declares who may call it: `@RequirePermissions(...)`, `@RequireSession()` (any signed-in user) or `@AllowAnonymous()`. A route with none of them fails the architecture test.
- Guards check that a permission is granted; services turn `permissionScopes()` into query filters, so a list or a read never returns records outside the caller's scope.

### Contracts
- Schemas are named `<thing>Schema` with the type `Thing = z.infer<...>`; inputs are `create<Thing>Schema` and `update<Thing>Schema`. Every schema that appears in the API has `.meta({ id })`, so it has a stable name in OpenAPI.
- Contracts hold shapes and pure rules only: no I/O and no framework imports.

### Data
- A business table is `{ id: id(), ...fields, ...timestamps(), archivedAt: archivedAt() }`, using the helpers in `packages/db/src/schema/columns.ts`. Tables are plural snake_case; exceptions are listed, with a reason, in `packages/db/src/conventions.test.ts`.
- Every foreign key is indexed. Timestamps are `timestamptz`. There are no floating-point columns.
- Money (ADR 0006): a `bigint` column in `mode: 'number'` holding minor units, named `<name>_minor`, next to a currency code column. Exchange rates are `numeric`. The column helper is added to `columns.ts` with the first table that stores money.
- Migrations come from `pnpm db:generate` and are never edited afterwards. Hand-written SQL (data fixes, extensions) goes in a custom migration (`drizzle-kit generate --custom`). The `migrations/meta` files are never edited.
- Changes that touch more than one row run in `db.transaction`, and the audit entry for a change is written in the same transaction (audit module, built with F01).

### Errors
- Services throw Nest's `HttpException` family. An error the UI must tell apart carries a stable code: `throw new ConflictException({ statusCode: 409, code: 'CLIENT_ARCHIVED', message: '...' })`. The body is `{ statusCode, code?, message }`; the shared schema is added to contracts with the first such error.
- Server messages are English and meant for logs. The web app shows the translation of `code` (`errors.<code>`), or a generic message, and never the raw server text.

### Lists
- List endpoints take `page` (from 1) and `pageSize` (default 50, maximum 100), plus `sort` and `order` where sorting is offered, and filters as named query parameters, all validated by a contract schema. They return `{ items, total, page, pageSize }`. The shared schemas are added to contracts with the first list endpoint.

### Web
- Route files stay thin: loader and guard, then the page component from `features/<module>/`.
- Server state lives in TanStack Query. Query options and mutations sit in `features/<module>/<module>.queries.ts`, with keys that start with the module name. API calls go through the client generated from OpenAPI (ADR 0003), introduced with the first feature.
- Every page handles its loading, empty and error states. Translation keys are namespaced by feature (`clients.list.title`); shared strings live under `common`.

### Tests
- Unit tests sit next to the code (`*.test.ts`). API integration tests call the real app over HTTP against the test database (`apps/api/test/<module>.test.ts`). Every endpoint is tested with no session (401), without the permission (403) and outside the caller's scope.
- Test data is unique per run and removed in `afterAll`. Tests never depend on each other or on their order.
- UI changes add or update a Playwright RTL screenshot in `apps/web/e2e/screens.spec.ts`.

### Enforcement
| Rule | Enforced by |
|---|---|
| Every route declares its access | `apps/api/test/architecture.test.ts` |
| Modules meet only through `index.ts` and query only their own tables | `apps/api/test/architecture.test.ts` |
| UUID ids, business columns, timestamptz, no floats, indexed foreign keys | `packages/db/src/conventions.test.ts` |
| Logical CSS only, brand patterns, colors from tokens | `packages/ui/src/conventions.test.ts` |
| Migrations match the schema | CI (`pnpm db:generate` leaves no diff) |
| Formatting, imports, lint rules | Biome (CI, and the Claude Code hook on every edit) |
| Anything else in this record | Review against this record |

## Consequences
- New modules are shaped the same way, which lets an agent learn the pattern from one module and apply it everywhere.
- Moving a rule from "review" to a test is always welcome. Changing a rule means a new record that supersedes this one, and an update to the tests.
- The shared list, error and money helpers are written with their first real use, not ahead of it, so that no speculative code lands before a feature needs it.
