# apps/api

NestJS 12 HTTP API (modular monolith). Conventions and their reasons: ADR 0013. Access model: ADR 0007 and ADR 0014.

## Layout
- `src/core/`: infrastructure (config, database, `access` decorators). No business logic.
- `src/modules/<module>/`: one folder per domain module, named as in `docs/architecture.md`.
- `src/cli/`: command-line entry points. `test/`: integration tests over HTTP against the test database.

## A module
- Files: `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `index.ts` (public surface). Kebab-case, one exported class per file.
- Pattern to copy: `src/modules/audit/` (module skeleton and `index.ts`), `src/modules/auth/departments.controller.ts` and `departments.service.ts` (contract schemas, OpenAPI, current user, transaction with audit, coded errors), and `users.controller.ts`/`users.service.ts` for paged lists and actions. A new feature follows `/feature-slice`.
- Controller: parameters validated with `{ schema }` from `@vertex-hub/contracts`, response shaped with `@SerializeOptions({ schema })`, documented with `@Api*Response({ standardSchema })`, then one call to the service.
- Service: all logic and queries (Drizzle through `@Inject(DATABASE)`). No repository layer.
- Register the module in `src/app.module.ts` through its `index.ts`.
- After changing a route or a contract it uses, run `pnpm build` and `pnpm --filter @vertex-hub/api openapi:export`, and commit `apps/web/src/lib/api/openapi.json` (CI fails when it is stale).
- Coded errors: `throw new CodedException(status, 'CODE', message, details?)` from `src/core/errors/`; the code is listed in `ERROR_CODES` in contracts.
- The signed-in user and their access: `@CurrentUser()` from the `auth` module (set by the guard).

## Access and audit
- Access decorators come from `src/core/access/`: `@RequirePermissions`, `@RequireSession`, `@AllowPendingTwoFactor` (only `GET /api/me`). `@AllowAnonymous` and `@Session` come from `@thallesp/nestjs-better-auth`.
- The `auth` module's global guard resolves effective roles and department capabilities on every request (ADR 0014) and answers `TWO_FACTOR_REQUIRED` to users who must set up 2FA.
- Write audit entries with `recordAudit(tx, ...)` from `modules/audit/index.js`, passing only the changed fields; never passwords, tokens, links or 2FA secrets.

## Rules the tests enforce (`test/architecture.test.ts`)
- Every route has `@RequirePermissions(...)`, `@RequireSession()` or `@AllowAnonymous()`.
- Other code imports a module only from `modules/<module>/index.js`.
- A module imports only its own tables from `@vertex-hub/db`. A new schema file needs an owner in `TABLE_OWNERS`.

## Rules to apply yourself
- Scopes: services turn `permissionScopes(access, permission)` into `where` filters. Lists and reads never return records outside the caller's scope.
- Every state change on a business record writes an audit entry in the same `db.transaction`.
- Archive (`archivedAt`), never delete business records.
- Errors: `HttpException` subclasses; add `code` when the UI must tell the error apart (ADR 0013).
- Slow or scheduled work (PDF, email, reminders) is enqueued with pg-boss for `apps/worker`. A scheduled job whose rule lives in a module service is scheduled by the worker and worked here: register the handler with `JobQueue.work(queue, handler)` from `src/core/jobs/` in `onModuleInit` (pattern: `modules/projects/retainer-cycles.service.ts`). Tests run with `JOBS_ENABLED=false` and call the handler's service method directly.
- ESM: relative imports end in `.js`. Logs through the Nest logger (pino), never `console.log`.

## Tests
For each endpoint in `test/<module>.test.ts`: success, 401 without a session, 403 without the permission, and a record outside the caller's scope. Start the app with `startApp()` from `test/start-app.ts`; seed users with `seedUser` and sign in with `api(url).signIn` / `signInWithTwoFactor` from `test/helpers.ts`, and remove them with `removeUsers`, as `test/auth.test.ts` does. Test files run one at a time: they share the test database and some rows are global (department managers). For the same reason `turbo.json` runs this package's tests after those of `packages/db` and `apps/worker`, never alongside them.

Run: `pnpm --filter @vertex-hub/api test` (needs `TEST_DATABASE_URL`) · `pnpm --filter @vertex-hub/api typecheck`.
