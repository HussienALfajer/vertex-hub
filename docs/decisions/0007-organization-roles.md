# 0007 — Account managers, finance ownership, medical review

Status: Accepted · Date: 2026-09-28

## Context
Owner decisions on how the organization maps to the system.

## Decision
- **Account manager** is a role, not a department. It can be held by staff from General Communication, Public Relations, or any department manager. Each client has exactly one primary account manager.
- **Users can hold multiple roles** (e.g. designer + account manager).
- **Finance** is owned jointly by General Management and Internal Operations: Operations creates invoices and records payments; General Management sees everything and approves discounts above the threshold.
- **Medical Consultation** reviews the medical accuracy of content for clients flagged as healthcare. The review is a mandatory step before client approval. Medical consultation is also a sellable service in the catalog.
- Roles in V1: General Manager, Department Manager, Employee, Account Manager, Finance. Permissions are defined once in `packages/contracts` and enforced by API guards.

## Consequences
- Permission checks combine role and relationship (e.g. an account manager sees their own clients in full).
- The workflow engine supports conditional steps (the medical review) driven by client attributes.
