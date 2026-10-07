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
| [0020](0020-review-snapshots-and-approval-links.md) | Review snapshots, medical review stage and client approval links | Accepted |
| [0021](0021-content-posts-and-linked-tasks.md) | Content posts: linked tasks, approval of the finished post, counting at publish | Accepted |
| [0022](0022-shoots-meetings-and-company-calendar.md) | Shoots tied to tasks, warned conflicts and one company calendar | Accepted |
| [0023](0023-quotes-versions-discounts-and-acceptance.md) | Quotes: catalog-priced sections, versions, discount approval and acceptance into engagements | Accepted |
| [0024](0024-invoices-payments-and-collection.md) | Invoices: automatic drafts, numbering at issue, voids, and payments with their own rate | Accepted |
| [0025](0025-ad-budget-wallet-and-campaigns.md) | Client ad budgets in a USD wallet apart from invoices; campaigns with manual periodic updates | Accepted |
| [0026](0026-leads-pipeline-quotes-and-conversion.md) | Leads: a follow-up date on every open lead, quotes on leads, conversion by the sales team | Accepted |
| [0027](0027-reports-on-read-and-revenue-by-service.md) | Reports computed on read through module report services; revenue by service from invoice lines | Accepted |
| [0028](0028-email-outbox-digest-and-client-emails.md) | Email: one outbox sent by the worker over Hostinger SMTP; batched notification emails, a morning digest, client emails sent by hand | Accepted |
| [0029](0029-retainer-terms-charges-and-amendments.md) | Retainer terms, charges as the billing source, and amendments with approval of reductions | Accepted |

Template:

```markdown
# NNNN — Title
Status: Proposed | Accepted | Superseded by NNNN · Date: YYYY-MM-DD
## Context
## Decision
## Consequences
```
