# packages/db

Drizzle schema, migrations and the database client (ADR 0005). Data rules: ADR 0013 (Data), money: ADR 0006.

## Layout
- `src/schema/<module>.ts`: tables of one owning API module, re-exported from `src/schema/index.ts`.
- `src/schema/columns.ts`: `id()`, `timestamps()`, `archivedAt()`. Pattern to copy: `src/schema/auth.ts`.
- `migrations/`: generated SQL. `migrations/meta/` is drizzle-kit state: never read or edit it.

## Rules the tests enforce (`src/conventions.test.ts`)
- A business table is `{ id: id(), ...fields, ...timestamps(), archivedAt: archivedAt() }`.
- Primary keys are a UUIDv7 `id` (composite keys for link tables).
- Every foreign key is indexed: add `index('<table>_<column>_idx').on(...)`.
- Timestamps use `withTimezone: true`. No `real` or `doublePrecision` columns.
- An exception goes in `NOT_BUSINESS_RECORDS` or `NATURAL_KEYS`, with a reason.

## Rules to apply yourself
- Money: `bigint('<name>_minor', { mode: 'number' })` next to a currency column. Exchange rates: `numeric`.
- Enums that the API exposes come from `@vertex-hub/contracts` (`pgEnum('role', ROLES)`), so there is one list.
- A new schema file needs an owner in `apps/api/test/architecture.test.ts` (`TABLE_OWNERS`).

## Changing the schema
1. Edit `src/schema/`, then run `pnpm db:generate` and read the generated SQL.
2. Migrations must stay backward compatible (expand, then contract): the previous release runs against the new schema during a deploy and after a rollback. Never rename or drop in the same release that stops using a column.
3. Run `pnpm test` (it migrates the test database). Apply to the dev database with `pnpm db:migrate` (asks first).
4. Never edit a migration once generated. Hand-written SQL goes in `drizzle-kit generate --custom`. Never use `drizzle-kit push`.

CI fails if `pnpm db:generate` produces a diff, so commit the schema and its migration together.
