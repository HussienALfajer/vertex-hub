# 0031 — Retainer contracts and annexes as numbered documents
Status: Accepted · Date: 2026-10-13

## Context
The agency signs a paper service contract ("عقد تقديم خدمات", numbered like VM-CCS-2026-001) with each retainer client, typed by hand from the quote. Its parties, scope, term and fees duplicate what the system already holds, and amendments made in the system (ADR 0029) have no signed counterpart. The owner's decisions are in `docs/specs/F05C-retainer-anniversary-cycles.md`.

## Decision
- One contract per retainer term (a renewal is a new contract), and one for an open-ended retainer. A contract is drafted from an article template the agency edits in its settings (every article can be edited, added or removed; the system's tables are placeholder blocks), edited per contract, then issued: issuing assigns a yearly number with a configurable prefix, freezes the render payload and renders a branded Arabic PDF in the worker, kept as a document of the contract with its signed copy. Issued contracts are never changed; a wrong one is voided and its number stays used.
- The parties, scope (deliverables and the accepted quote's services), term (cycles and end action) and payment schedule are filled in from the system; missing party fields print as empty lines to fill in by hand.
- Amendments get numbered annexes of the covering contract on demand.
- The client's signatory is one of its contacts; the contact's national ID is stored but read and written only by users who manage the client and hold money access, and audit entries never carry its value.

## Consequences
- New tables in the `projects` module (contract settings, article template, contracts, their articles, annexes) and a `retainer_contract` file owner; new client and contact columns in `clients`.
- Contract and annex PDFs reuse the quote and invoice PDF pipeline (ADR 0008, F04 rule 12).
- Still no e-signature and no sending from the system: PDFs are downloaded and sent by hand.
