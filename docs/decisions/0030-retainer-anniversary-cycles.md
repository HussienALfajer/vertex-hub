# 0030 — Retainer cycles anchored on the start date
Status: Accepted · Date: 2026-10-13

## Context
ADR 0015 made a retainer cycle one calendar month, with a partial first month at full quantities, and ADR 0029 counted terms, charges and amendments in calendar months. In use the owner found this confusing and unfair: a retainer starting on the 20th got a ten-day first cycle billed as a full month, the manual renewal date did not match the days left in the cycle, and a fixed-term retainer that started last month could not be entered. The owner's decisions are in `docs/specs/F05C-retainer-anniversary-cycles.md`.

## Decision
- A cycle is one full month anchored on the retainer's start date: from the anchor day to the day before it in the next month. A missing day clamps to the month's end and the anchor returns the month after (31 Jan → 31 Jan–27 Feb, 28 Feb–30 Mar). Cycles are numbered from the start date; one pure function in `packages/contracts` computes every period.
- No partial cycles and no prorating. Pausing never moves the anchor or a term; a term's cycles stay billed while paused. Resuming an open-ended retainer starts at the next cycle or, by choice, a full cycle now.
- Terms, charges, amendments, schedules and invoice drafts count cycles. The renewal date is derived from the term; open-ended retainers have none.
- On each cycle's first day the daily job, per retainer, applies scheduled amendments, closes the previous cycle, opens the new one, makes its charge due (drafting the invoice in advance) and prepares the closed cycle's report.
- A retainer may start up to 12 months in the past; the cycles that closed before it was entered are recorded through a catch-up (billed outside or drafted now; delivery entered or untracked) without tasks, alerts or reports.
- Agency revenue and collection reports stay in calendar months by invoice and payment date.

## Consequences
- Supersedes the calendar-month cycle of ADR 0015 (its counters, freezing and behind rule stay) and amends ADR 0029: "month" reads "cycle" for terms, charges and amendments.
- Retainers that existed before the change are not converted: the migration keeps their rows valid and the owner enters them again.
- F15's calendar-month client report lists the cycles overlapping the month; per-cycle reports become the regular delivery report.
