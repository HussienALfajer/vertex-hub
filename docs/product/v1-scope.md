# Vertex Hub — V1 Scope

Status: approved by the owner on 2026-09-28. Changes to this file need the owner's approval.

## 1. Business context

Vertex Media sells two kinds of work, and V1 must model both from day one:

| Kind | Examples | What defines it |
|---|---|---|
| **Retainer** (monthly, recurring) | Social media management, content production, campaign management | A monthly commitment to a counted set of deliverables (e.g. 12 designs + 4 reels + 1 campaign), repeated every month |
| **Project** (one-off) | Brand identity, website, app, automation system, photo shoot | Milestones, deliveries, payment installments, an end date |

Client lifecycle the system must cover:

```
Lead → Quote → Accepted → Project or Retainer → Tasks across departments
→ Internal review → Client approval → Delivery / publishing → Invoice → Payment → Client report
```

Every V1 feature serves a step of this lifecycle. Anything that does not is deferred.

### Problems V1 must solve

1. Requests and approvals are lost in WhatsApp; there is no record of what the client approved and when.
2. No visibility of who works on what, who is overloaded, who is free.
3. Missed deadlines are discovered too late.
4. Unlimited revision rounds.
5. Retainer deliverables are not tracked against the monthly commitment.
6. Delivered work is not invoiced; overdue invoices are not followed up.
7. Client brand assets are scattered; nobody knows which file is final.
8. Client ad budgets are mixed with agency fees.

## 2. Organization

Departments: General Management · Internal Operations · Public Relations · Marketing · Design · Photography · Content Management · Development · General Communication · Medical Consultation.

Size: ~2 people per department (~20 users), ~20 active clients.

| Department | Main use of the system |
|---|---|
| General Management | Dashboards, approving quotes and discounts, finance oversight |
| Internal Operations | Users and permissions, workload distribution, templates, invoicing and collection |
| Public Relations | Key client relationships, partnerships, client satisfaction |
| Marketing | Client campaign planning; the agency's own lead generation |
| Design | Design tasks, versions, revisions |
| Photography | Scheduled shoots, editing, delivery |
| Content Management | Content calendar, captions, scheduling and publishing |
| Development | Website/app/automation projects by milestone; post-delivery support |
| General Communication | First point of contact: inquiries, leads, client requests |
| Medical Consultation | Reviews medical accuracy of content for healthcare clients; offers consultations as a service |

Key role — **Account Manager**: every client has exactly one primary account manager, accountable for requests, approvals and satisfaction. The role can be held by staff from General Communication, Public Relations, or any department manager. A user can hold several roles (e.g. designer + account manager).

Business decisions are recorded in `docs/decisions/` (see ADR 0007 and ADR 0006).

## 3. Design principles for V1

1. **The task is the core unit.** Every piece of work becomes a task with an owner, a due date and a status.
2. **Departments are configuration, not modules.** One task engine serves all ten departments; they differ by templates and fields.
3. **The client is in the loop from day one** through approval links, because approvals are the biggest source of chaos.
4. **Manual entry before integrations.** No Meta/Google/accounting APIs in V1.
5. **Arabic RTL first, responsive web** (no native mobile app).

## 4. Features

### F01 — Users, departments, roles and permissions
- The ten departments; each has a manager and members.
- Roles: General Manager (sees everything), Department Manager (their department), Employee (own tasks and projects they are on), Account Manager (their clients in full), Finance (invoices and payments). Users may hold multiple roles.
- Employee profile: name, department, title, skills (used when assigning tasks).
- Audit log of important actions (status changes, invoice edits, file deletion/archival).
- Security basics: secure login, optional 2FA for management and finance, daily automatic backups.
- **Not in V1:** field-level custom permissions, attendance, payroll.

### F02 — Clients (unified client profile)
- Basics: trade name, sector, primary account manager, status (active / paused / ended).
- Contacts: several per client, with a flag for who has final approval authority.
- Brand kit: logo files, color codes, fonts, brand guidelines, tone of voice, forbidden words, liked/disliked references.
- Platform accounts: page links and who holds admin access. Client passwords are **not** stored in V1; prefer the client granting access to the agency's business account.
- **Healthcare flag:** turns on mandatory medical review in the workflow (F09).
- Tabs: projects, retainer, open tasks, invoices and balance, communication history.

### F03 — Leads (sales pipeline)
- Lead record: name, contact, source (Instagram, referral, website, ad…), requested service, rough budget.
- Kanban stages: New → Contacted → Meeting → Quote sent → Won / Lost (with loss reason).
- Owner and next follow-up date per lead.
- One-click conversion of a won lead into a client, without re-entering data.
- **Not in V1:** pulling messages from WhatsApp/Instagram, lead scoring.

### F04 — Service catalog and quotes
- Catalog: each service has a name, default price, performing department, and allowed revision rounds.
- Packages: e.g. "Gold social package: 12 designs + 4 reels + 2 pages managed + monthly report, X per month". Packages count deliverables; this drives retainer tracking.
- Quote builder: pick services or a package, adjust price, discount, payment terms (installments or monthly); branded PDF.
- Internal approval: discounts above a threshold need General Management approval.
- Quote states: draft, sent, accepted, rejected, expired.
- Accepting a quote triggers automation A01.
- **Not in V1:** e-signature, full legal contract editor.

### F05 — Projects and retainers
- **Projects:** milestones (e.g. discovery → design → build → test → delivery), start and due dates, project manager, participating departments, a payment installment per milestone, progress computed from tasks.
- **Retainers:** a monthly cycle created automatically on the 1st of each month; a **deliverables counter** ("designs 9/12, reels 2/4, monthly report not delivered"); an alert before month end when deliverables are behind; out-of-scope extra work logged for separate billing; status (active / paused / ended) and renewal date.

### F06 — Task engine and workflow (the core)
- Task: title, brief, client and project, department, assignee, priority, due date, attachments, subtasks.
- Unified statuses: `new → in progress → internal review → awaiting client → revisions → approved → delivered/published`.
- Dependencies: a task opens when the tasks it depends on finish, and its assignee is notified.
- Revision counter per task; the account manager is alerted when the agreed limit (from the quote) is exceeded.
- Inter-department requests (e.g. Content requests a design from Design; the Design manager assigns it).
- Client requests are logged by the account manager as tasks of type "client request".
- Views: My tasks; Kanban by status (department managers); filterable list (client, department, assignee, overdue); workload (open tasks per person this week).
- Comments with @mentions on each task.
- **Not in V1:** time tracking, Gantt charts, full real-time chat.

### F07 — Work templates (task auto-generation)
- One template per service that generates ordered tasks with dependencies, department, and relative due dates (day 1, day 3…) computed from the start date.
- Default assignee per department, editable after generation.
- Seed templates: brand identity, promotional reel, website, monthly social media cycle.

### F08 — Content calendar
- Monthly/weekly calendar per client showing planned posts per platform.
- Post card: platforms, type (post, reel, story, carousel), caption and hashtags, attached design/video, publish date and time, status.
- A post that needs a design creates a linked design task.
- Post statuses: idea → in production → internal review → awaiting client → approved → scheduled → published.
- Send a whole month's plan to the client for approval in one batch.
- Published posts count toward the retainer deliverables counter.
- **Not in V1:** automatic publishing through platform APIs. Posts are published manually and marked as published.

### F09 — Internal review and client approval
- Internal review: before anything goes to the client, an internal reviewer (department manager or account manager) approves or returns it with notes.
- **Healthcare clients:** a mandatory Medical Consultation review step; content is not sent to the client before the medical reviewer approves it.
- Client approval via a **secure link with no account or password**, valid for a limited time. The client sees the work (image, video, text, or the month plan) and chooses **Approve** or **Request changes** with notes.
- Recorded automatically: who approved, when, and which exact version.
- Automatic reminder if the client has not responded within 48 hours.
- **Not in V1:** full client portal with login, pinpoint comments on images/videos.

### F10 — Files and versions
- Upload files to tasks with automatic version numbering (v1, v2, v3…) and a "final approved" marker.
- In-app preview for images, PDFs and short videos.
- Per-client library of all final approved files.
- External links for large raw files (Google Drive, Dropbox) instead of uploading them.

### F11 — Unified calendar and shoots
- Shoot booking: client, date and time, location, crew, shoot type (product, video, event), shot list.
- Conflict warning when a person is booked twice at overlapping times.
- Company calendar: shoots, client meetings, key deadlines.
- Closing a shoot creates the follow-up editing task.
- **Not in V1:** equipment inventory, Google Calendar sync.

### F12 — Ad campaigns and ad budget
- Campaign record: client, platform, objective, budget, dates, owner, status.
- **Client ad-budget wallet:** amounts the client paid for ads, amounts spent (entered manually), remaining balance, low-balance alert.
- Short results per campaign: reach, clicks, messages/sales, cost per result (entered manually).
- **Not in V1:** Meta Ads / Google Ads API integration.

### F13 — Invoicing and collection
- Invoices created from an accepted quote, a project milestone, automatically for retainers, or manually for extra work.
- Branded PDF with sequential numbering.
- Payments, including partial payments, with method (cash, bank transfer, local e-wallets).
- Invoice states: draft, sent, partially paid, paid, overdue.
- Client statement: invoiced, paid, outstanding.
- Two currencies (new Syrian pound and USD); rate fixed on the invoice at issue; a payment may be in a different currency with its own rate (ADR 0006).
- Optional direct project expenses (e.g. location rental) for a basic project margin.
- **Not in V1:** full accounting (journals, balance sheet, tax), online payment, payroll.

### F14 — Notifications
- In-app notifications and email.
- Triggers: assignment, @mention, due soon, overdue, client response to an approval, invoice paid.
- Daily morning digest per user: today's tasks and overdue ones.
- Per-user settings to mute notification types.
- **Not in V1:** WhatsApp notifications (first item for V2).

### F15 — Dashboards and basic reports
- General Manager: active projects and retainers, overdue tasks by department, department workload, invoiced vs collected this month, outstanding amounts, new leads and conversion rate.
- Department Manager: department tasks by status, overdue, workload per employee.
- Employee: my tasks today and this week.
- Account Manager: my clients, retainer status for each, pending approvals.
- Exportable reports (Excel, PDF): department productivity, revenue by client and service, overdue invoices, **monthly client report** (delivered vs committed, plus campaign results).

## 5. Automations (fixed rules in V1, no rule builder)

| ID | Trigger | Automatic result |
|---|---|---|
| A01 | Quote accepted | Create project or retainer, generate tasks from template, draft first invoice, notify account manager and department managers |
| A02 | 1st of each month | Create the monthly cycle for every active retainer with its tasks, and a draft monthly invoice |
| A03 | Task completed | Open dependent tasks and notify their assignees |
| A04 | Work sent to client | Generate approval link; remind after 48 h without a response |
| A05 | Client responds | Approve → task becomes approved; changes requested → back to assignee, revision counter +1 |
| A06 | Revision limit exceeded | Alert account manager to decide: free revision or paid extra work |
| A07 | One day before due date | Remind the assignee |
| A08 | Task overdue | Alert the assignee; escalate to department manager after 24 h |
| A09 | Month end near and retainer behind | Alert account manager and operations manager |
| A10 | Invoice past due date | Alert finance and the account manager |
| A11 | Client ad budget below threshold | Alert the account manager |
| A12 | Lead without follow-up for N days | Remind the lead owner |
| A13 | Content for a healthcare client | Insert mandatory medical review before client approval |

## 6. Explicitly out of V1

| Deferred | Why |
|---|---|
| Auto-publishing to social platforms | Platform app review takes weeks; manual publishing is enough for now |
| Meta Ads / Google Ads integration | Complex; weekly manual entry is enough initially |
| WhatsApp notifications | Needs a verified WhatsApp Business API account and per-message cost; first V2 item |
| Full client portal with login | Approval links deliver most of the value for a fraction of the effort |
| Time tracking | Needs team discipline; add after the team adopts the system |
| Full accounting and tax | Use an off-the-shelf accounting tool in parallel |
| HR (attendance, leave, payroll) | Not part of the client lifecycle |
| Equipment inventory | Scheduling matters more first |
| AI features | Valuable later, not needed for launch |
| Native mobile app | Responsive web is enough; the separate API keeps this open |
| Flexible automation rule builder | The 13 fixed rules cover current needs |
| Support ticketing for dev projects | Logged as "client request" tasks for now |

## 7. Build phases

| Phase | Contents | Outcome |
|---|---|---|
| 0. Foundation | Repo scaffold, CI, design system, auth, deployment skeleton | A deployable empty shell |
| 1. Core | F01, F02, F05, F06, F07, internal notifications (F14 in-app) | The team runs internal work in the system instead of WhatsApp |
| 2. Production and client | F08, F09, F10, F11 | Approvals are recorded; retainers are tracked |
| 3. Money and sales | F04, F13, F12, F03 | The full cycle from inquiry to payment |
| 4. Visibility | F15, email and daily digest (F14), monthly client report | Management sees everything |

Launch advice: after Phase 1, run the system with 2–3 real clients before moving everyone.

## 8. V1 success metrics (two months after launch)

1. 100% of client requests are logged in the system.
2. 100% of approvals are recorded through approval links.
3. Overdue tasks drop measurably.
4. No retainer month closes without a known delivery rate.
5. No delivered work without an invoice; collection time drops.
6. The General Manager reads the company status from the dashboard without asking anyone.
