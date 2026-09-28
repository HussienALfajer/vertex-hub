# Open questions

Decisions that belong to the owner. Agents must not guess answers to these. When one is resolved, record the answer (and an ADR if it shapes the system) and move it to the resolved list.

| ID | Question | Needed before | Recommendation |
|---|---|---|---|
| Q1 | Domain for the system (e.g. a `hub.` subdomain of the company domain)? | First deployment | — |
| Q4 | Off-server backup destination (none exists on the server today) | Launch | Required before launch: the system holds invoices and client data |
| Q5 | Email provider for notifications (SMTP) | F14 email | — |
| Q7 | Add swap on the server (none today) as a safety margin for Chromium PDF rendering? | Launch | 2–4 GB |
| Q8 | ISO currency code used for the redenominated Syrian pound | F13 | Confirm current official code |
| Q9 | Work week and first day of the week in calendars (weekend days) | F08, F11 | — |
| Q10 | License for the public repository (none means all rights reserved) | Anytime | — |
| Q11 | Madani Arabic: is a license owned that covers web embedding and server-side PDF embedding? Which weights are available (need at least 400, 500, 700)? Provide the font files (WOFF2 preferred) privately | Design system (fallback works until then); required before launch | Buy/confirm a web license covering the number of users and PDF embedding |
| Q12 | Original vector logo files (AI/EPS/SVG) from the designer, and confirmation of the wordmark typeface (appears to be Montserrat) | Before print materials; nice to have for UI | — |

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
| Brand assets and fonts (was Q2) | Logo provided (`brand/logo/`); identity derived in `brand/identity.md`; Arabic font Madani Arabic, Latin Montserrat (ADR 0011) | 2026-09-28 |
| Digits in the UI (was Q3) | Latin digits (123), formatted with the `ar-u-nu-latn` locale | 2026-09-28 |
| Local PostgreSQL for development (was Q6) | PostgreSQL 17 installed natively on Windows, matching production | 2026-09-28 |
