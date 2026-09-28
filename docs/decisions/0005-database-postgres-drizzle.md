# 0005 — PostgreSQL 17 with Drizzle ORM

Status: Accepted · Date: 2026-09-28

## Context
Financial data, audit history and relational business records need a reliable relational database. PostgreSQL 17 is already installed on the production server.

## Decision
- **PostgreSQL 17**, with a dedicated database and role for Vertex Hub.
- **Drizzle ORM** and drizzle-kit migrations in `packages/db`: strict types, SQL-close queries, exact decimals, no engine binary.
- Migrations are generated, reviewed, committed, and never edited after they have been applied.

Rejected: Prisma (heavier runtime, less direct decimal handling).

## Consequences
- Conventions in `docs/architecture.md` (UUIDv7 keys, UTC `timestamptz`, archive instead of delete, audit entries).
- Tests run against a real PostgreSQL database, not mocks.
