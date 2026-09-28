# 0001 — One repository, separate apps, modular monolith backend

Status: Accepted · Date: 2026-09-28

## Context
The system will grow beyond V1: a mobile app, WhatsApp and Meta/Google integrations, a full client portal, auto-publishing, AI features. All of these need a backend that is independent of any single frontend. Development is done by one owner with an AI coding agent, so shared types and one context matter.

Options considered:
- One full-stack Next.js app: fast to start, but business logic ends up inside the web framework and must be extracted later.
- Two repositories (frontend, backend): clean separation, but contracts drift, types are duplicated, and the agent cannot see both sides at once.
- One repository with separate apps and shared packages.

## Decision
One pnpm + Turborepo repository with separately deployable apps (`api`, `worker`, `web`) and shared packages (`contracts`, `db`, `ui`, `config`). The API is a modular monolith: one deployable NestJS app split into domain modules with explicit boundaries. No microservices.

## Consequences
- Any future client (mobile, integrations) talks to the same API.
- A contract change in `packages/contracts` surfaces every affected caller through the type checker.
- Module boundaries are enforced by convention and review: a module only calls another module's exported service. A module can be extracted into its own service later if ever needed.
