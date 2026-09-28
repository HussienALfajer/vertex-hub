# 0012 — NestJS 12 with native Standard Schema validation instead of nestjs-zod

Status: Accepted · Date: 2026-09-28 · Supersedes the validation bullet of ADR 0002

## Context
ADR 0002 chose nestjs-zod to bridge Zod schemas into NestJS and asked for a compatibility check at scaffold time, preferring NestJS's own Standard Schema support if it covers our needs. The check, run on 2026-09-28 against the npm registry and the packages' published type definitions:

| Package | Version checked | Finding |
|---|---|---|
| @nestjs/core, common, platform-express | 12.1 (12.0 released 2026-08-27) | **ESM-only**. Built-in `StandardSchemaValidationPipe`, a `schema` option on `@Body`/`@Query`/`@Param`, and `StandardSchemaSerializerInterceptor` with `@SerializeOptions({ schema })`. Express 5. |
| @nestjs/swagger | 12.0 | Converts Standard JSON Schema into OpenAPI (`standardSchema` option on `@ApiResponse`, schemas with a Zod `.meta({ id })` become components). Peer: TypeScript ^5.5 \|\| ^6. |
| zod | 4.6 | Implements Standard Schema and Standard JSON Schema. |
| nestjs-zod | 5.5.0 (latest) | Peers `@nestjs/common` ^10 \|\| ^11 and `@nestjs/swagger` up to ^11. **No NestJS 12 support**; tracked in BenLorantfy/nestjs-zod#471, unreleased. |
| @thallesp/nestjs-better-auth | 2.8.0 | Compatible: `@nestjs/*` ^11.1.6 \|\| ^12, better-auth >=1.5 <2 (current 1.7), Express ^5.1, TypeScript ^5.9 \|\| ^6, Node >=22.22.1. Requires `bodyParser: false` in `NestFactory.create` (it re-adds parsers for non-auth routes). |
| pg-boss | 12.35 | Compatible: no NestJS dependency, Node >=22.12, ESM (`import { PgBoss } from 'pg-boss'`). |
| typescript | 7.0 latest, 6.0.3 | TypeScript 7 is outside the peer ranges of @nestjs/swagger and the Better Auth integration, and @nestjs/cli 12 bundles TypeScript ~6.0. |

## Decision
- **NestJS 12** with the Express adapter (unchanged from ADR 0002).
- **Validation and response shaping use NestJS's native Standard Schema support** with the Zod schemas from `packages/contracts`. nestjs-zod is not used. Global `StandardSchemaValidationPipe` and `StandardSchemaSerializerInterceptor`; handlers declare `@Body({ schema })` / `@Query({ schema })` / `@Param(name, { schema })` and `@SerializeOptions({ schema })`.
- **OpenAPI** comes from @nestjs/swagger 12's Standard JSON Schema conversion (`standardSchema` on response decorators). Shared schemas get a stable component name with `.meta({ id })`.
- **TypeScript is pinned to ~6.0** until the NestJS ecosystem supports 7.
- The backend and all shared packages are **ESM** (`"type": "module"`, `NodeNext` resolution, `.js` suffixes on relative imports).

## Consequences
- One fewer dependency on the critical path, and no wait for nestjs-zod to support NestJS 12.
- No DTO classes: request and response types are `z.infer<>` types from `packages/contracts`, the same ones the web app uses.
- If a needed feature turns out to be missing from the native support (for example a Zod-specific error format), revisit nestjs-zod once it supports NestJS 12, through a new ADR.
- Tests keep Vitest with SWC (`unplugin-swc`) for decorator metadata, as ADR 0002 planned. `tsx`/esbuild cannot run Nest code because they do not emit decorator metadata.
- When Better Auth is added, `main.ts` must create the app with `bodyParser: false`.
