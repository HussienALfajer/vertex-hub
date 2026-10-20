# 0038 — Announcements and one audience resolver

Status: Accepted · Date: 2026-10-20

## Context
F16 adds announcements written by people: everyone may send to any audience (owner, 2026-10-20), with receipts, reminders, scheduling, pinning, attachments, templates and a poll. The board (F22), chat (F21) and the client portal (F20) will also address audiences, such as departments, roles, people, or a project's or client's team. There is no team table: a team is implied by the project manager, the account manager, task assignees and the record's departments.

## Decision
- **An `audiences` module** exports `AudienceResolver.resolve(tx, audience)`, plus a preview endpoint. An audience is a union of everyone, departments, roles, people, projects and clients, minus excluded people. Project and client teams are derived when resolved (owner): no team table is kept. The web has one `AudiencePicker` component. Later features reuse both.
- **An `announcements` module** owns announcements, their frozen recipient list (resolved when sent), polls and templates. It notifies through `NotificationCenter` with the announcement's priority. Critical announcements and pinning need `announcements.manage`, granted to the General Manager and the Internal Operations manager over everyone and to department managers over their departments' members. Withdrawing archives the announcement and voids its notifications.
- **Light rich text.** The body is a TipTap document limited to paragraphs, headings, bold, italic, lists and links. It is stored as validated JSON and rendered from the same schema, never as raw HTML. The editor is reused later by chat and the board.
- **Attachments** use F10 with a new owner type `announcement`.

## Consequences
- Resolving a project or client team reads through the exported services of `projects`, `tasks`, `content` and `clients`. `audiences` depends on them, and they never depend on it.
- Recipients are frozen at sending, so receipts are stable; people who join later do not receive old announcements.
- An anonymous poll still stores who voted, to keep one vote per person; the API never returns it.
