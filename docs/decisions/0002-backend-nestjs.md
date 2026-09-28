# 0002 — NestJS backend with Zod contracts and Better Auth

Status: Accepted, validation bullet superseded by [0012](0012-nestjs-12-native-standard-schema.md) · Date: 2026-09-28

## Context
The backend has ~19 domain modules, role-based permissions, audit logging and background jobs. Hono was proposed for its small footprint; the owner chose NestJS for its enforced structure (modules, dependency injection, guards, interceptors), which suits a system expected to grow for years.

## Decision
- **NestJS** with the **Express adapter** (the most compatible adapter; the Better Auth integration's Fastify support is still beta, and throughput is not a concern at ~20 users).
- **Validation:** Zod schemas in `packages/contracts`, bridged into NestJS DTOs with **nestjs-zod**, and exposed as an **OpenAPI** document through @nestjs/swagger. No class-validator.
- **Authentication:** **Better Auth** through its NestJS integration (community-maintained, listed in the Better Auth docs). Sessions stored in PostgreSQL via the Drizzle adapter; optional 2FA.
- **Authorization:** NestJS guards that read the shared permission map (ADR 0007).
- **Logging:** nestjs-pino.
- **Tests:** Vitest (with SWC for decorator metadata), consistent with the rest of the monorepo.

## Consequences
- More files per feature than a minimal framework; offset by predictable structure that the agent and future developers can follow.
- Compatibility of nestjs-zod, @nestjs/swagger and the Better Auth integration with the current NestJS major version must be verified at scaffold time; if NestJS's native Standard Schema support covers our needs, prefer it over extra libraries.
- Client-approval links (F09) use our own signed, hashed, expiring tokens, not Better Auth.
