# 0044 — The Hub's side of the Mizan integration: an ordered outbox, a fail-open period check, and a one-time cutover replaying each document's final state

Status: Accepted · Date: 2026-11-13 (owner, with the F18A spec)

## Context
ADR 0035 makes Vertex Mizan the ledger and the Hub the operational system. It fixes the shape of the integration: an outbox written in the change's transaction, delivery with an idempotency key, closed periods respected, and a daily reconciliation. Mizan's contract (its ADR 0006, 0008, 0014, 0017, 0019; specs S05, S06, S08, S10) is now implemented and deployed. It also requires:
- arrival in Hub's order per item;
- an opening snapshot as of 2026-09-30;
- the replay of every event dated from 2026-10-01.

The Hub has been in production since 2026-10-19 with no outbox, so its history since 2026-10-01 must be sent once, and live capture must start without a fact being sent twice or missed. F18A (`docs/specs/F18A-mizan-integration.md`) needed to settle:
- how events leave the Hub;
- what the Hub does when Mizan cannot answer a period check;
- how the history is rebuilt;
- how the history meets live capture.

## Decision
- **A new api module `mizan` owns the integration.** Producing modules build their events from their own records and append them through `mizan/index.ts`, in their own transaction. The module owns:
  - the outbox table `mizan_events`;
  - the cached period states;
  - the reconciliation days and the snapshots;
  - the Mizan client.
- **Delivery is one ordered loop,** in the outbox's sequence:
  - **a transport failure** blocks every later event until it is answered;
  - **a `4xx` refusal** does not block (a refused event is a Hub defect, rebuilt by the General Manager after the fix);
  - **a hold** is Mizan's to retry, and Hub never resends it.

  The api works the delivery job, as `invoices.daily`, and the HTTP client lives in the api.
- **The `/v1` schemas are copied** into `packages/contracts` and tested against Mizan's exported JSON Schema and examples, vendored in the repository. The two repositories stay independent.
- **The period check fails open** (owner, 2026-11-13). Hub reads month states every 15 minutes and refuses a new document dated in a month last read as closed. When Mizan is unreachable it decides on the last states read and never waits. A race ends as an event held `PERIOD_CLOSED` in Mizan, which the accountant posts in the next open month.
- **History is each document's final state** (owner, 2026-11-13). The replay sends every document dated from the books start as it is at the cutover, with voids as events of their own. Edits, archives and reopens made before the cutover are folded into the documents' state, and archived documents are absent. Nothing is closed in Mizan before the opening, so the final balances are the same as a faithful replay of every edit, without rebuilding edits from the audit log.
- **Capture starts at a one-time cutover**, run by the General Manager from the Mizan page:
  - **Preconditions:** the readiness list is empty and a snapshot was accepted.
  - **One transaction** under the lock of `mizan_settings` writes the replay events and switches capture on.
  - **Every producer** reads that row with a share lock, so each fact is either replayed or captured, never both and never neither.

## Consequences
- Until the cutover, the Hub's production behavior changes only through the new required fields and the period check once configured. After it, every financial action writes an event in its transaction.
- **A day without Mizan** costs nothing but delay. A long outage is notified once.
- **The Hub carries copies of Mizan's schemas.** A change in Mizan's `/v1` is additive (Mizan ADR 0006), and the Hub adopts it by refreshing the fixtures and the copy.
- **Facts `/v1` cannot carry** (a reopened project, a credit settled outside) are notices to the accountant until Mizan adds their events.
- **A cash box on payments, purchases for clients and profitability** come with Mizan's additions (F18 remainder) and extend this module.
