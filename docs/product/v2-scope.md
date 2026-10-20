# Vertex Hub — V2 Scope

Status: direction approved by the owner on 2026-10-20. Each feature is approved in principle here and in full in its spec. Changes to this file need the owner's approval.

## 1. Goal

V1 runs the client lifecycle. V2 makes the system reach every person wherever they are, runs the people side of the agency, gives it real accounting, opens it to its clients, and keeps the company's conversations inside it:

- an installable app with notifications that arrive with the app closed and the phone locked, and a complete notification engine;
- HR: employee files, attendance, leave, payroll, commissions and profit shares;
- full accounting, built as a separate product, **Vertex Mizan**, and integrated with the Hub (ADR 0035);
- a client portal with login;
- chat between staff, and between the company and its clients;
- an interactive board, last.

V2 must not disrupt the adoption of V1: its success metrics (`v1-scope.md` §8) are measured around 2026-12-19.

## 2. How every V2 feature is specified

Each feature gets its own `/spec` session, in this order:

1. **A full, thorough and professional analysis** of the project and of the feature: what V1 already has, what the feature builds on, what professional systems do.
2. **Every possible feature,** professional and creative, including features beyond those listed below.
3. **Questions** to the owner, until every decision is settled.
4. **The spec,** then `/feature-slice`, as in V1.

The directions below are what the owner approved in the V2 discussion (2026-10-20). Points marked "decided" are final; everything else is confirmed or changed in the feature's spec.

## 3. Features and build order

Two tracks run in parallel: the Hub (this repository) and Vertex Mizan (its own repository, ADR 0035).

| Order | Feature | Depends on |
|---|---|---|
| 1 | F16 Notifications 2.0, installable app and announcements | — |
| 2 | F17 HR: employee files, attendance and leave | F16 (installed app, passkeys on registered devices) |
| 3 | F18 Accounting through Vertex Mizan: integration, purchases for clients, profitability | Mizan's posting API, chart of accounts and cash boxes stable (ADR 0035) |
| 4 | F19 HR: payroll, commissions and profit shares | F17, F18; Q15 and Q16 |
| 5 | F20 Client portal (with client conversations) | F16 |
| 6 | F21 Chat | F16, F20 for client conversations |
| 7 | F22 Interactive board | F16; last (owner, 2026-10-20) |

HR is split around accounting because payroll shares need trusted revenue and profit figures (owner, 2026-10-20).

## 4. Features

### F16 — Notifications 2.0, installable app and announcements
The owner wants a complete, comprehensive and very professional notification system: a professional engine and a complete, professional catalog of notification types, so that every action that needs a notification reaches the right person.

- **Installable app (PWA):** installs from the browser on Android, iPhone and computers, with the Vertex icon and no browser bar. An Arabic install guide for iPhone (push needs the app on the home screen, iOS 16.4 or later). Unread count on the app icon. The app opens without a connection and shows the last loaded data.
- **Push notifications (Web Push)** to phones and computers, with the app closed and the phone locked. One subscription per device, tied to the signed-in devices of F01B: signing a device out stops its pushes. Web Push from Syria was tested by the owner in Vertex Digital and works (owner, 2026-10-20).
- **The engine:**
  - channels per type: in-app, push, email, each user choosing within limits set by management;
  - priority levels: critical, important, normal, informational;
  - ~~no double alert: no push while the user is active in the app~~ changed: a push is always sent, and reading a notification on one device clears it from the others (owner, 2026-10-20, F16 spec);
  - grouping ("5 new comments on task X");
  - "remind me later";
  - **self-resolving notifications**: a "review requested" notification closes itself when the review is done, so the bell is a real to-do list;
  - two inboxes: "Needs you" and "For your information";
  - a general escalation chain: an unhandled critical action reminds, then reaches the manager (today only overdue tasks escalate);
  - action buttons in notifications where the platform allows them.
- **A full event audit:** a matrix of every event in the system × its recipients × channel × priority, filling every gap. Candidate gaps noticed in the discussion, not verified: invoice due soon, quote nearing expiry, client opened the approval link, milestone done, project delivered or closed, campaign ended, replies to comments.
- **Announcements written by people:**
  - audience: everyone, departments, roles, specific people, or a project or client team;
  - **everyone may send to any audience (decided, owner, 2026-10-20)**;
  - "I have read this" acknowledgement, with who read and who did not, and reminders to those who did not;
  - scheduled sending, pinning on the home page until a date, an attachment or link, and templates;
  - an optional quick poll.
- **One audience picker,** reused by the board, chat and portal.
- **Decided:** no quiet hours (owner, 2026-10-20). External messaging channels (WhatsApp, Telegram) are not used: the company builds its own notifications and chat (owner, 2026-10-20).

### F17 — HR: employee files, attendance and leave
- **Employee file:** contract details, start date, probation, documents (through F10), payout method, salary history, reminders before a contract or probation ends.
- **Attendance rules:** the Saturday–Thursday week, shifts or flexible hours, a grace period, lateness tiers, early leave, overtime and remote days.
- **How attendance is taken (decided, owner, 2026-10-20):**
  - **at the office:** a QR code on a screen at the entrance changes about every 20 seconds; the employee scans it from the installed app and confirms with their passkey (fingerprint or face on their own phone, a device registered in F01B). The code proves the place, the passkey proves the person.
  - **field work:** GPS check-in, and an employee on a scheduled F11 shoot counts as working in the field without checking in.
  - **forgotten check-in:** a manual correction request approved by the manager.
  - **the entrance screen** greets the employee with their day: "Good morning Ahmad, you have 3 tasks today and a shoot at 2".
- **Lateness deductions apply only after the manager approves them (decided, owner, 2026-10-20);** the employee can submit a justification.
- **Leave:** annual, sick, unpaid and emergency leave, with balances, requests approved by the department manager, and public holidays (the Eids move every year). Leave shows on the company calendar, and assigning a task to someone on leave warns.
- **Privacy:** salaries are visible to the General Manager and finance only; each employee sees their own. Every change is audited.

### F18 — Accounting through Vertex Mizan
The owner wants a complete, comprehensive and professional accounting system. It is built as Vertex Mizan, and the Hub integrates with it (ADR 0035).

- **Roles:** the Hub stays the operational system (invoices, payments, expenses, payroll), and Mizan is the ledger.
- **Integration:**
  - every financial event in the Hub is posted to Mizan through an outbox, with an idempotency key;
  - the Hub chooses the cash box when a payment is recorded;
  - closed periods in Mizan block Hub changes dated inside them;
  - a daily reconciliation report shows any event that did not arrive.
- **Purchases for clients** (the owner's example: fireworks bought for $200 for a shoot and sold to the client for $300):
  - a separate line type with cost, price, supplier and receipt, shown as its own invoice line;
  - its margin is counted on its own, outside the project's service profit and outside every employee share;
  - one concept with the ad budget wallet of F12.
- **Profitability** by client, project, department and service, from Mizan's dimensions, shown in the Hub.
- **Accounting features kept from the analysis,** in Mizan or the Hub as ADR 0035 splits them: a chart of accounts in Arabic, automatic double-entry journals, cash boxes and banks, person wallets, transfers and currency exchange, general and recurring expenses, employee custody and advances, suppliers and payables, monthly period close, the financial statements, partner profit distribution, exchange gains and losses, a cash forecast, and later receipt reading by AI.
- **Open:** how the Hub's history reaches Mizan (Q17).

### F19 — HR: payroll, commissions and profit shares
- **Compensation as components per employee:**
  - a fixed salary;
  - a share of a department's revenue (e.g. a developer gets 50% of the Development department's revenue);
  - a share of the company's profit;
  - salary plus share;
  - piece rates (per shoot, per design);
  - a commission for bringing a client (from the lead owner of F03);
  - bonuses.
- **Deductions:** lateness (after approval), absence, advances repaid in installments, penalties, social insurance and salary tax. Syrian rates are not confirmed; verify them at the spec.
- **Monthly payroll run:** draft → review → General Manager approval → paid → locked. Each employee gets an Arabic payslip PDF, and the payroll is posted to Mizan.
- **A transparent commission statement:** the employee sees how their share was computed, invoice by invoice and payment by payment.
- **Rules for shares:** a share paid on a later voided or refunded amount is deducted the next month, and purchases for clients never count toward any share.
- **Open:** the base of a department share (Q15), the period and losses of a profit share (Q16), and the salary currency (decided in the spec).

### F20 — Client portal
Approved by the owner in full (2026-10-20); the spec's analysis may add more.

- **Sign-in and access:**
  - sign-in with a code sent by email (no password) or a passkey;
  - several users per client with their own access (the owner sees invoices, the marketing contact sees content only);
  - the portal installs as an app and receives push notifications.
- **What the client sees:**
  - home: "Needs you now" (pending approvals, due invoices) and "What we work on this week";
  - the retainer: "8 of 12 posts delivered this cycle", from F05C;
  - projects with their milestones and progress, and the approved and scheduled content calendar;
  - approvals, which move into the portal from today's links;
  - the library of final approved files and the brand kit;
  - invoices, statements and receipts, and the ad wallet balance with campaign results;
  - monthly reports, contracts, and quotes accepted from the portal;
  - shoot and meeting dates.
- **What the client does:**
  - submits a new request (brief);
  - talks with the team (F21);
  - comments on a point of an image or a moment of a video;
  - rates each delivery.
- **Risk: leaking internal data.** A client seeing an internal note, a margin or another client's data would be serious. Rule: **nothing reaches the client unless it is explicitly marked "visible to the client"**, and automated tests prevent any leak between clients and from internal data.

### F21 — Chat
Approved by the owner in full (2026-10-20). The spec's analysis completes it into a complete, professional and creative chat system.

- **Why:** client conversations on employees' personal numbers leave with the employee. Chat in the system keeps them with the company.
- **Conversations:**
  - one-to-one and groups;
  - automatic channels for each department and for each client or project, with the right team;
  - threads, @mentions, reactions, edit and delete within a time limit, and pinned messages;
  - voice messages, and files through F10;
  - read receipts, and presence (online, on leave, at a shoot);
  - turn a message into a task.
- **Client conversations,** in the portal:
  - the client talks to the team, not to one person;
  - internal notes inside the same conversation, hidden from the client;
  - response time measured;
  - an automatic reply outside working hours.
- **Arabic search** with trigram matching.
- **No voice or video calls:** meetings use links, as in F11.
- **Technically,** SSE with `pg_notify` (ADR 0018) carries chat at this size.

### F22 — Interactive board
**Last V2 feature (owner, 2026-10-20).** Its features and how it works are discussed in full when it is reached.

- **Approved in principle:**
  - sharing: only me, everyone, specific people, or the client;
  - saving;
  - customization close to Word;
  - live presenting that the chosen people follow.
- **Deleting (decided, owner, 2026-10-20):** deleted boards go to a trash, restorable for 30 days, then deleted for good.
- **Analysis notes for that discussion:**
  - the request combines three things: a whiteboard canvas, a rich document, and live presenting;
  - the discussion leaned toward building on open-source editors (Excalidraw, TipTap, Yjs) rather than writing editors from scratch.

## 5. Vertex Mizan

Accounting is built in parallel as Vertex Mizan, a separate product in its own repository, `vertex-mizan`, where its scope, phases and roadmap live. The Hub's side of the decision and the integration: ADR 0035.
