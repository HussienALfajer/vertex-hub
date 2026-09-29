# feature-slice: wiring and patterns

## Wiring checklist

Everything a new module, permission, error or screen must be connected to. Tests catch the items marked **(test)**; the others fail silently, so tick each one that applies in `TASKS.md`.

### contracts (`packages/contracts/src/`)
- [ ] `<module>.ts` created and re-exported from `index.ts`.
- [ ] Every schema the API exposes has `.meta({ id })`; list responses use `pageSchema(item)` from `lists.ts` with their own id.
- [ ] Permissions: the `<module>.*` entries in `PERMISSIONS` and their grants in `PERMISSION_MAP` (`permissions.ts`) match the spec's "Roles and access" table; a grant with a new scope gets a case in `permissions.test.ts`.
- [ ] New error codes added to `ERROR_CODES` (`errors.ts`).
- [ ] New error codes, audit actions, audit entity types and responsibility types get their `ar.json` keys in the **same PR**, even an API-only one: the web app's translation keys are typed, so `web` typecheck fails without them (then regenerate the API client, see bridge).
- [ ] New audit actions (`<entity>.<verb>`) and entity types added to `AUDIT_ACTIONS` and `AUDIT_ENTITY_TYPES` (`audit.ts`).
- [ ] Fixed value lists (statuses, kinds) are `as const` arrays with a `z.enum`, reused by the db enum.

### db (`packages/db/src/schema/`), through `/db-migration`
- [ ] `<module>.ts` created and re-exported from `schema/index.ts`.
- [ ] The file has an owner in `TABLE_OWNERS` (`apps/api/test/architecture.test.ts`) **(test)**.
- [ ] Business columns, UUIDv7 ids, timestamptz, indexed foreign keys **(test: `conventions.test.ts`)**; indexes for the filters and sorts the list endpoint offers.
- [ ] Schema and generated migration committed together **(CI: drift)**.

### api (`apps/api/src/`)
- [ ] `modules/<module>/` with `<module>.module.ts`, `<module>.controller.ts`, `<module>.service.ts`, `index.ts` (exports the Nest module and only the services other modules call).
- [ ] The module is imported in `app.module.ts` through its `index.ts`.
- [ ] Every route has `@RequirePermissions(...)` or `@RequireSession()` **(test)**; imports from other modules go through their `index.ts` **(test)**; only the module's own tables **(test)**.
- [ ] `@CurrentUser()` and `CurrentUserInfo` come from `modules/auth/index.js`. They are not exported there yet: the first module outside `auth` that needs them adds the export.
- [ ] Reads and lists filter by `permissionScopes(actor.access, permission)` from `@vertex-hub/contracts`; a direct read outside the scope answers the status the spec's API table gives (ask if it gives none).
- [ ] Every state change writes `recordAudit(tx, …)` with `changedFields(...)` in the same `db.transaction`.
- [ ] Archive and restore set and clear `archivedAt`; no `DELETE` of business rows.
- [ ] `test/<module>.test.ts`: per endpoint, success, 401, 403 and out of scope; the spec's numbered rules each have a test; seeded rows removed in `afterAll`.
- [ ] `docs/architecture.md` ("API modules") updated if module ownership differs from the list there.

### bridge
- [ ] `apps/web/src/lib/api/openapi.json` and `schema.gen.ts` regenerated and committed **(CI: OpenAPI drift)**.

### web (`apps/web/src/`)
- [ ] `features/<module>/<module>.queries.ts`: a `<module>Keys` object whose keys start with the module name; mutations invalidate every query the change affects (other modules' lists, `['me']` when access changes).
- [ ] Thin routes under `routes/_app/<path>/`: `validateSearch` for URL filters, `beforeLoad` redirect for pages the user may not use (cosmetic; the API enforces).
- [ ] Navigation item in `components/app-shell.tsx` (`navItems` with its `permission`, and the `label` union type) and its `nav.<key>` string.
- [ ] `i18n/locales/ar.json`: the `<module>` namespace, `errors.<CODE>` for each new error code, and `audit.entityTypes`, `audit.actions` and `audit.fields` entries for new audit values.
- [ ] Every page: loading (`Skeleton`), empty (`EmptyState`), error (`LoadError`); forms show server errors with `FormAlert` and `errorMessage()`.
- [ ] A component missing from `@vertex-hub/ui` is added there, with a place on the design-system page.

### e2e (`apps/web/e2e/`)
- [ ] Contract-typed mock data and routes in `fixtures.ts` (`mockApi`).
- [ ] `<id>.spec.ts` for the feature's main flows and the role differences the spec names.
- [ ] Every new screen in `screens.spec.ts`, light and dark.

### docs
- [ ] The spec updated where implementation settled a detail it left open; `docs/open-questions.md` if an answer was recorded.
- [ ] The folder `CLAUDE.md` updated if this feature became the better pattern to copy.

## Patterns to copy (from F01)

Open these by range when writing the layer. F01 lives inside the `auth` module; a new feature gets its own module with the same file shapes.

| Need | Copy from |
|---|---|
| Contract: entity, create/update inputs, list query, page | `packages/contracts/src/users.ts` (`userListQuerySchema`, `userPageSchema`), `departments.ts` |
| Contract unit tests | `packages/contracts/src/users.test.ts` |
| Table with foreign keys, enums and indexes | `packages/db/src/schema/auth.ts` (`departments`, `departmentMembers`) |
| Seed or backfill migration | `packages/db/migrations/0003_seed_departments.sql` |
| Module skeleton (module, index) | `apps/api/src/modules/audit/` |
| Controller: list, detail, update, actions | `apps/api/src/modules/auth/users.controller.ts`, `departments.controller.ts` |
| Service: queries, transaction, audit, coded errors | `apps/api/src/modules/auth/departments.service.ts` (small), `users.service.ts` (full) |
| API integration test | `apps/api/test/departments.test.ts` (small), `users.test.ts` (full); helpers in `test/helpers.ts` |
| Queries and mutations | `apps/web/src/features/users/users.queries.ts` |
| List page with URL filters and paging | `apps/web/src/features/users/team-page.tsx` (`parseTeamSearch`) with `routes/_app/team/index.tsx` |
| Create/edit form | `apps/web/src/features/users/user-form.tsx`, `new-user-page.tsx` |
| Detail page with actions and confirmations | `apps/web/src/features/departments/department-page.tsx`, `users/user-profile-page.tsx` |
| Guarded route | `apps/web/src/routes/_app/team/new.tsx` |
| E2E flow and screenshots | `apps/web/e2e/f01.spec.ts`, `screens.spec.ts`, `fixtures.ts` |
