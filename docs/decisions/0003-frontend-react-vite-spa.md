# 0003 — React + Vite SPA frontend

Status: Accepted · Date: 2026-09-28

## Context
The app is internal, behind login; search-engine indexing is irrelevant. The public surface is limited to client approval pages. With a separate API (ADR 0001), a full-stack framework's server layer would duplicate the backend.

## Decision
- **React 19 + Vite**, built to static files served by nginx.
- **TanStack Router** (type-safe routes and params), **TanStack Query** (server state), **TanStack Table** (lists).
- API client generated from the API's OpenAPI document (openapi-typescript + openapi-fetch).
- **React Hook Form + Zod**, reusing schemas from `packages/contracts`.
- **FullCalendar** (MIT core) for the content calendar and shoots, with RTL and Arabic locale.
- **i18next** from day one (Arabic only in V1), **Intl** for dates and numbers.

## Consequences
- No Node process for the frontend in production: less to run and monitor.
- Next.js was rejected because its server features would duplicate the API and add server/client component complexity without benefit here.
- Approval pages are part of the SPA and must be `noindex`.
