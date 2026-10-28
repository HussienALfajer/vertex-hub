---
name: db-migration
description: Change the database schema safely in packages/db — edit the Drizzle schema, generate the migration, review its SQL for backward compatibility, and test it. Use whenever a table, column, index, enum or constraint is added, changed or removed.
argument-hint: <what changes>
effort: high
---

Schema change: **$ARGUMENTS**. Rules: `packages/db/CLAUDE.md` and ADR 0013 (Data).

1. **Edit** `packages/db/src/schema/<module>.ts` with the helpers from `columns.ts`. A new schema file is exported from `schema/index.ts` and gets an owner in `TABLE_OWNERS` (`apps/api/test/architecture.test.ts`). Every new foreign key gets an index.
2. **Generate:** `pnpm db:generate`. Read the new `.sql` file in `packages/db/migrations/` (never the `meta/` folder).
3. **Review the SQL.** The previous release must keep working against the migrated database (deploys and rollbacks). Stop and ask the owner, with a redesign as expand, then contract, if you see:
   - `DROP TABLE`, `DROP COLUMN`, or a `RENAME` of anything code still uses;
   - `ALTER COLUMN ... TYPE` that rewrites or narrows data;
   - `SET NOT NULL`, or a new `NOT NULL` column without a default, on a table that has rows;
   - a removed or renamed enum value.
   Contract steps (drops and renames) ship in a later release, once no deployed code uses the old shape. Data backfills go in a custom migration (`pnpm --filter @vertex-hub/db exec drizzle-kit generate --custom`).
4. **Test:** `pnpm verify packages/db/src/conventions.test.ts` (runs the migrations and the conventions test), then the test files of the packages that use the tables, with `pnpm verify <files>`.
5. **Confirm no drift:** running `pnpm db:generate` again reports nothing to migrate.
6. **Dev database:** run `pnpm db:migrate` once the migration is final (reviewed and committed); it needs no approval. A migration applied to the dev database and then regenerated leaves that database out of step with the branch.

Never use `drizzle-kit push`, never edit a generated migration, and commit the schema and its migration together.
