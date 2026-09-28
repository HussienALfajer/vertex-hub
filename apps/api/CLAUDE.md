# apps/api

NestJS 12 HTTP API (modular monolith). Conventions and their reasons: ADR 0013. Access model: ADR 0007.

## Layout
- `src/core/`: infrastructure (config, database). No business logic.
- `src/modules/<module>/`: one folder per domain module, named as in `docs/architecture.md`.
- `src/cli/`: command-line entry points. `test/`: integration tests over HTTP against the test database.

## A module
- Files: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `index.ts` (public surface). Kebab-case, one exported class per file.
- Pattern to copy: `src/modules/health/` (controller, service, module, index) and `src/modules/auth/me.controller.ts` (contract schema, OpenAPI, session).
- Controller: parameters validated with `{ schema }` from `@vertex-hub/contracts`, response shaped with `@SerializeOptions({ schema })`, documented with `@Api*Response({ standardSchema })`, then one call to the service.
- Service: all logic and queries (Drizzle through `@Inject(DATABASE)`). No repository layer.
- Register the module in `src/app.module.ts` through its `index.ts`.

## Rules the tests enforce (`test/architecture.test.ts`)
- Every route has `@RequirePermissions(...)`, `@RequireSession()` or `@AllowAnonymous()`.
- Other code imports a module only from `modules/<module>/index.js`.
- A module imports only its own tables from `@vertex-hub/db`. A new schema file needs an owner in `TABLE_OWNERS`.

## Rules to apply yourself
- Scopes: services turn `permissionScopes(roles, permission)` into `where` filters. Lists and reads never return records outside the caller's scope.
- Every state change on a business record writes an audit entry in the same `db.transaction`.
- Archive (`archivedAt`), never delete business records.
- Errors: `HttpException` subclasses; add `code` when the UI must tell the error apart (ADR 0013).
- Slow or scheduled work (PDF, email, reminders) is enqueued with pg-boss for `apps/worker`.
- ESM: relative imports end in `.js`. Logs through the Nest logger (pino), never `console.log`.

## Tests
For each endpoint in `test/<module>.test.ts`: success, 401 without a session, 403 without the permission, and a record outside the caller's scope. Start the app with `startApp()` from `test/start-app.ts` and seed users with `createUser`, as `test/auth.test.ts` does.

Run: `pnpm --filter @vertex-hub/api test` (needs `TEST_DATABASE_URL`) · `pnpm --filter @vertex-hub/api typecheck`.
