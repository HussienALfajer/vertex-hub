# Open questions

Decisions that belong to the owner. Agents must not guess answers to these. When one is resolved, record the answer (and an ADR if it shapes the system) and move it to the resolved list.

| ID | Question | Needed before | Recommendation |
|---|---|---|---|
| Q1 | Domain for the system (e.g. a `hub.` subdomain of the company domain)? | First deployment | — |
| Q2 | Vertex Media brand assets: logo files, color palette, fonts (including an Arabic font) | Design system tokens | — |
| Q3 | Digits in the UI: Latin (123) or Arabic-Indic (١٢٣)? | Design system | Latin, clearer for financial figures |
| Q4 | Off-server backup destination (none exists on the server today) | Launch | Required before launch: the system holds invoices and client data |
| Q5 | Email provider for notifications (SMTP) | F14 email | — |
| Q6 | Local PostgreSQL for development: native Windows install or Docker Desktop? | Phase 0 scaffold | Native PostgreSQL 17, matching production |
| Q7 | Add swap on the server (none today) as a safety margin for Chromium PDF rendering? | Launch | 2–4 GB |
| Q8 | ISO currency code used for the redenominated Syrian pound | F13 | Confirm current official code |
| Q9 | Work week and first day of the week in calendars (weekend days) | F08, F11 | — |
| Q10 | License for the public repository (none means all rights reserved) | Anytime | — |

## Resolved

| Question | Answer | Date |
|---|---|---|
| Role of the Medical Consultation department | Reviews medical content for healthcare clients; also a sellable service (ADR 0007) | 2026-09-28 |
| Who can be an account manager | General Communication, Public Relations, or department managers (ADR 0007) | 2026-09-28 |
| Who owns invoicing and collection | General Management and Internal Operations together (ADR 0007) | 2026-09-28 |
| Currencies | New Syrian pound and USD (ADR 0006) | 2026-09-28 |
| Team and client volume | ~2 people per department (~20 users), ~20 clients | 2026-09-28 |
| Hosting | The owner's existing VPS (ADR 0009) | 2026-09-28 |
| Backend framework | NestJS (ADR 0002) | 2026-09-28 |
| Repository visibility | Public on GitHub | 2026-09-28 |
