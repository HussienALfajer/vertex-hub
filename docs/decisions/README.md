# Decision records

Short records of decisions that shape the system. Each has a status: **Accepted**, **Superseded by NNNN**, or **Proposed**. To change a decision, add a new record that supersedes the old one; don't rewrite history.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-modular-monolith.md) | One repository, separate apps, modular monolith backend | Accepted |
| [0002](0002-backend-nestjs.md) | NestJS backend with Zod contracts and Better Auth | Accepted (validation superseded by 0012) |
| [0003](0003-frontend-react-vite-spa.md) | React + Vite SPA frontend | Accepted |
| [0004](0004-design-system-shadcn-base-ui.md) | Vertex design system on shadcn/ui + Base UI | Accepted |
| [0005](0005-database-postgres-drizzle.md) | PostgreSQL 17 with Drizzle ORM | Accepted |
| [0006](0006-money-and-currencies.md) | Money in minor units; SYP and USD with stored rates | Accepted |
| [0007](0007-organization-roles.md) | Account managers, finance ownership, medical review | Accepted |
| [0008](0008-background-jobs-and-pdf.md) | pg-boss jobs and Chromium PDF in a worker app | Accepted |
| [0009](0009-deployment-existing-vps.md) | Deploy to the existing VPS with PM2 and nginx | Accepted |
| [0010](0010-ai-assisted-development.md) | Claude Code (Opus 5.5) as the primary developer; AGENTS.md shared with Codex | Accepted |
| [0011](0011-brand-identity-and-fonts.md) | Brand identity from the logo; Madani Arabic + Montserrat | Accepted |
| [0012](0012-nestjs-12-native-standard-schema.md) | NestJS 12 with native Standard Schema validation instead of nestjs-zod | Accepted |
| [0013](0013-engineering-conventions.md) | Engineering conventions: layout, module anatomy, data, errors, tests | Accepted |
| [0014](0014-permissions-roles-and-departments.md) | Permissions from roles and department capabilities | Accepted |
| [0015](0015-retainer-cycles-and-deliverables.md) | Retainer monthly cycles and the deliverables counter | Accepted |
| [0016](0016-task-workflow-and-revisions.md) | Task workflow, requests between departments and revision counting | Accepted |
| [0017](0017-work-templates.md) | Work templates in work days; automatic tasks for each retainer cycle | Accepted |
| [0018](0018-in-app-notifications.md) | In-app notifications: stored per user, pushed over SSE, reminders from one daily job | Accepted |
| [0019](0019-files-and-versions.md) | Files: versioned items on local disk, attached through owner policies, served by nginx | Accepted |

Template:

```markdown
# NNNN — Title
Status: Proposed | Accepted | Superseded by NNNN · Date: YYYY-MM-DD
## Context
## Decision
## Consequences
```
