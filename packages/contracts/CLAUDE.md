# packages/contracts

The single source of shapes shared by the API and the web app: Zod schemas, their types, the role list and the permission map (ADR 0007, ADR 0012).

## Rules
- One file per module (`src/<module>.ts`), re-exported from `src/index.ts`. Pattern to copy: `src/auth.ts`.
- Naming: `<thing>Schema` and `type Thing = z.infer<typeof thingSchema>`. Inputs: `create<Thing>Schema`, `update<Thing>Schema`. Responses: `<thing>ResponseSchema`.
- Every schema the API exposes has `.meta({ id: '<Thing>' })`, so OpenAPI names it.
- Pure code only: no I/O, no Node or framework imports. Zod is the only dependency.
- Never define the same shape twice: derive with `.pick()`, `.omit()`, `.extend()`, `.partial()`.
- Fixed value lists are `as const` arrays with a `z.enum` over them (`src/roles.ts`); the database enums reuse them.
- Money amounts are integers in minor units with a currency code (ADR 0006).

## Permissions
- `src/permissions.ts` is the only permission map. A new permission is `<module>.<action>`, added to `PERMISSIONS` and granted per role with a scope.
- Grants that depend on open question Q13 stay with the General Manager only. Don't guess them.
- `src/permissions.test.ts` covers the helpers. Add a case when you add a grant with a new scope.

Changing an exported schema changes the API and the web app: run `pnpm typecheck` at the root.

Run: `pnpm --filter @vertex-hub/contracts test`.
