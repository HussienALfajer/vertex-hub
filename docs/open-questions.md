# Open questions

Decisions that belong to the owner. Agents must not guess answers to these. When one is resolved, record the answer (and an ADR if it shapes the system) and move it to the resolved list.

| ID | Question | Needed before | Recommendation |
|---|---|---|---|

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
| Domain for the system (was Q1) | `hub.vertexmedia.pro`, a subdomain of the company domain (docs/deployment.md) | 2026-09-28 |
| Brand assets and fonts (was Q2) | Logo provided (`brand/logo/`); identity derived in `brand/identity.md`; Arabic font Madani Arabic, Latin Montserrat (ADR 0011) | 2026-09-28 |
| Digits in the UI (was Q3) | Latin digits (123), formatted with the `ar-u-nu-latn` locale | 2026-09-28 |
| Permission map details (was Q13) | Users, roles and the audit log: General Manager + Internal Operations manager. Medical review: members of Medical Consultation. Leads: General Communication and Marketing (all), account managers (their own). Templates: managed by General Manager + Internal Operations manager, read by department managers. Finance: financial reports only (`docs/specs/F01-users-roles.md`, ADR 0014) | 2026-09-28 |
| Local PostgreSQL for development (was Q6) | PostgreSQL 17 installed natively on Windows, matching production | 2026-09-28 |
| Currency code of the new Syrian pound (was Q8) | `SYP` with 2 decimal places, final (owner) | 2026-09-29 |
| Work week (was Q9) | Saturday to Thursday, Friday off; weeks start on Saturday (`docs/specs/F06-tasks.md`, ADR 0016) | 2026-09-29 |
| Email provider (was Q5) | Hostinger Email SMTP, sending as `info@vertexmedia.pro` (`docs/specs/F14-email-digest.md`, ADR 0028) | 2026-10-04 |
| Operations manager across departments (was Q14) | Yes: reads and manages tasks in every department (`tasks.manage` `all`) and `reports.read` `all` (`docs/specs/F06-tasks.md`, ADR 0016) | 2026-09-29 |
| Off-server backup destination (was Q4) | Backups stay on the server for now; the owner reports when a storage service is subscribed, and the off-server copy is added then (ADR 0034) | 2026-10-19 |
| License for the public repository (was Q10) | None: the repository stays without a license (all rights reserved) | 2026-10-19 |
| Madani Arabic license and files (was Q11) | Dropped: Noto Kufi Arabic is the Arabic typeface (ADR 0033) | 2026-10-19 |
| Original vector logo files (was Q12) | Not needed: the traced SVGs in `brand/logo/` are the logo, and the wordmark stays as traced | 2026-10-19 |
| Swap on the server (was Q7) | Yes: a 4 GB swap file with `vm.swappiness=10`, added on 2026-10-19 and kept by `provision.sh` (`docs/deployment.md`) | 2026-10-19 |
