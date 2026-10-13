import { readFileSync } from 'node:fs';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import {
  clients,
  invoiceLines,
  invoices,
  retainerAmendments,
  retainerCharges,
  retainerCycles,
  retainers,
  retainerTerms,
  users,
} from './schema/index.js';

const connection = createDatabase(process.env.DATABASE_URL as string);

afterAll(() => connection.close());

/** The statements of a migration file, as the migrator runs them. */
const statements = (file: string) =>
  readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

class Rollback extends Error {}

describe('data migrations', () => {
  it('moves retainer cycles and their invoice lines to charges (F05B, 0047)', async () => {
    const seen = await connection.db
      .transaction(async (tx) => {
        const [manager] = await tx
          .insert(users)
          .values({ name: 'Backfill', email: `backfill-${crypto.randomUUID()}@example.test` })
          .returning();
        const [client] = await tx
          .insert(clients)
          .values({ tradeName: 'Backfill', accountManagerId: manager?.id ?? '' })
          .returning();
        const retainer = async (monthlyFeeMinor: number | null) => {
          const [row] = await tx
            .insert(retainers)
            .values({
              clientId: client?.id ?? '',
              name: `Backfill ${monthlyFeeMinor}`,
              departments: [],
              startDate: '2026-01-01',
              monthlyFeeMinor,
            })
            .returning();
          return row?.id ?? '';
        };
        const cycle = async (retainerId: string, month: string) => {
          const [row] = await tx
            .insert(retainerCycles)
            .values({ retainerId, month, periodStart: month, periodEnd: month })
            .returning();
          return row?.id ?? '';
        };
        const line = async (
          retainerId: string,
          cycleId: string,
          unitPriceMinor: number,
          holdsSource: boolean,
        ) => {
          const [invoice] = await tx
            .insert(invoices)
            .values({
              clientId: client?.id ?? '',
              retainerId,
              origin: 'cycle_opened',
              currency: 'USD',
              paymentTermsDays: 7,
              totalMinor: unitPriceMinor,
            })
            .returning();
          const [row] = await tx
            .insert(invoiceLines)
            .values({
              invoiceId: invoice?.id ?? '',
              description: 'Month',
              quantity: 1,
              unitPriceMinor,
              retainerCycleId: cycleId,
              holdsSource,
              position: 1,
            })
            .returning();
          return row?.id ?? '';
        };

        const paid = await retainer(30_000);
        const invoiced = await cycle(paid, '2026-01-01');
        const voidedLine = await line(paid, invoiced, 25_000, false);
        const liveLine = await line(paid, invoiced, 28_000, true);
        const onlyVoided = await cycle(paid, '2026-02-01');
        const onlyVoidedLine = await line(paid, onlyVoided, 27_000, false);
        await cycle(paid, '2026-03-01');
        const unpriced = await retainer(null);
        await cycle(unpriced, '2026-01-01');
        const free = await retainer(0);
        await cycle(free, '2026-01-01');

        for (const statement of statements('0047_f05b_charges_backfill.sql')) {
          await tx.execute(sql.raw(statement));
        }

        const charges = await tx
          .select()
          .from(retainerCharges)
          .where(sql`${retainerCharges.retainerId} in (${paid}, ${unpriced}, ${free})`)
          .orderBy(asc(retainerCharges.month));
        const chargeOf = async (lineId: string) =>
          (await tx.select().from(invoiceLines).where(eq(invoiceLines.id, lineId)))[0];
        const result = {
          charges: charges.map((charge) => ({
            retainerId: charge.retainerId,
            month: charge.month,
            kind: charge.kind,
            amountMinor: charge.amountMinor,
            status: charge.status,
            due: charge.dueAt !== null,
          })),
          lines: await Promise.all(
            [voidedLine, liveLine, onlyVoidedLine].map(async (id) => {
              const row = await chargeOf(id);
              return charges.find((charge) => charge.id === row?.retainerChargeId)?.month;
            }),
          ),
          cycleKept: (await chargeOf(liveLine))?.retainerCycleId === invoiced,
          paid,
        };
        throw new Rollback(JSON.stringify(result));
      })
      .catch((error: unknown) => {
        if (error instanceof Rollback) return JSON.parse(error.message);
        throw error;
      });

    const charge = (month: string, amountMinor: number) => ({
      retainerId: seen.paid,
      month,
      kind: 'monthly',
      amountMinor,
      status: 'pending',
      due: true,
    });
    // The live line's amount, else the latest line's, else the fee; no fee and no line: none.
    expect(seen.charges).toEqual([
      charge('2026-01-01', 28_000),
      charge('2026-02-01', 27_000),
      charge('2026-03-01', 30_000),
    ]);
    expect(seen.lines).toEqual(['2026-01-01', '2026-01-01', '2026-02-01']);
    expect(seen.cycleKept).toBe(true);
  });

  it('names anchored cycles on existing retainer rows (F05C, 0055)', async () => {
    const seen = await connection.db
      .transaction(async (tx) => {
        const [manager] = await tx
          .insert(users)
          .values({ name: 'Backfill', email: `backfill-${crypto.randomUUID()}@example.test` })
          .returning();
        const [client] = await tx
          .insert(clients)
          .values({ tradeName: 'Backfill', accountManagerId: manager?.id ?? '' })
          .returning();
        const retainer = async (name: string, startDate: string, renewalDate: string | null) => {
          const [row] = await tx
            .insert(retainers)
            .values({ clientId: client?.id ?? '', name, departments: [], startDate, renewalDate })
            .returning();
          return row?.id ?? '';
        };
        // Started on the 20th: September is its short first month, October its second.
        const anchored = await retainer('Anchored', '2026-09-20', '2027-01-01');
        const openEnded = await retainer('Open-ended', '2026-01-31', '2026-12-01');
        for (const [month, periodStart, periodEnd] of [
          ['2026-09-01', '2026-09-20', '2026-09-30'],
          ['2026-10-01', '2026-10-01', '2026-10-05'],
        ] as const) {
          await tx
            .insert(retainerCycles)
            .values({ retainerId: anchored, month, periodStart, periodEnd, status: 'closed' });
        }
        await tx.insert(retainerCycles).values({
          retainerId: openEnded,
          month: '2026-02-01',
          periodStart: '2026-02-01',
          periodEnd: '2026-02-28',
        });
        const [term] = await tx
          .insert(retainerTerms)
          .values({
            retainerId: anchored,
            number: 1,
            startMonth: '2026-10-01',
            months: 3,
            endMonth: '2026-12-01',
            agreedTotalMinor: 90_000,
            status: 'active',
          })
          .returning();
        for (const month of ['2026-10-01', '2026-11-01', '2026-12-01']) {
          await tx.insert(retainerCharges).values({
            retainerId: anchored,
            month,
            kind: 'monthly',
            amountMinor: 30_000,
            termId: term?.id ?? null,
            baseAmountMinor: 30_000,
          });
        }
        await tx.insert(retainerCharges).values({
          retainerId: openEnded,
          month: '2026-02-01',
          kind: 'monthly',
          amountMinor: 50_000,
        });
        await tx.insert(retainerAmendments).values({
          retainerId: anchored,
          number: 1,
          kind: 'reschedule',
          effectiveMonth: '2026-11-01',
          schedule: [
            { month: '2026-11-01', amountMinor: 20_000 },
            { month: '2026-12-01', amountMinor: 40_000 },
          ] as unknown as { cycle: number; amountMinor: number }[],
          reason: 'Backfill',
          status: 'applied',
          effects: [
            {
              month: '2026-11-01',
              effect: 'charge_changed',
              invoice: null,
              beforeMinor: 30_000,
              afterMinor: 20_000,
            },
          ] as unknown as (typeof retainerAmendments.$inferInsert)['effects'],
        });

        for (const statement of statements('0055_f05c_cycles_backfill.sql')) {
          await tx.execute(sql.raw(statement));
        }

        const ids = sql`(${anchored}, ${openEnded})`;
        const result = {
          anchored,
          openEnded,
          cycles: await tx
            .select({
              retainerId: retainerCycles.retainerId,
              month: retainerCycles.month,
              number: retainerCycles.number,
            })
            .from(retainerCycles)
            .where(sql`${retainerCycles.retainerId} in ${ids}`)
            .orderBy(asc(retainerCycles.month)),
          charges: await tx
            .select({
              retainerId: retainerCharges.retainerId,
              month: retainerCharges.month,
              cycleNumber: retainerCharges.cycleNumber,
              cycleStart: retainerCharges.cycleStart,
            })
            .from(retainerCharges)
            .where(sql`${retainerCharges.retainerId} in ${ids}`)
            .orderBy(asc(retainerCharges.month)),
          term: (
            await tx
              .select({
                startCycle: retainerTerms.startCycle,
                cycles: retainerTerms.cycles,
                startDate: retainerTerms.startDate,
                endDate: retainerTerms.endDate,
              })
              .from(retainerTerms)
              .where(eq(retainerTerms.retainerId, anchored))
          )[0],
          amendment: (
            await tx
              .select({
                effectiveCycle: retainerAmendments.effectiveCycle,
                effectiveDate: retainerAmendments.effectiveDate,
                schedule: retainerAmendments.schedule,
                effects: retainerAmendments.effects,
              })
              .from(retainerAmendments)
              .where(eq(retainerAmendments.retainerId, anchored))
          )[0],
          renewalDates: await tx
            .select({ id: retainers.id, renewalDate: retainers.renewalDate })
            .from(retainers)
            .where(sql`${retainers.id} in ${ids}`),
        };
        throw new Rollback(JSON.stringify(result));
      })
      .catch((error: unknown) => {
        if (error instanceof Rollback) return JSON.parse(error.message);
        throw error;
      });

    // One cycle per month: the one holding its last day, also for a month that ended early.
    expect(seen.cycles).toEqual([
      { retainerId: seen.openEnded, month: '2026-02-01', number: 2 },
      { retainerId: seen.anchored, month: '2026-09-01', number: 1 },
      { retainerId: seen.anchored, month: '2026-10-01', number: 2 },
    ]);
    expect(seen.charges).toEqual([
      // 31 Jan anchor: cycle 1 runs 31 Jan – 27 Feb, cycle 2 from 28 Feb.
      { retainerId: seen.openEnded, month: '2026-02-01', cycleNumber: 2, cycleStart: '2026-02-28' },
      { retainerId: seen.anchored, month: '2026-10-01', cycleNumber: 2, cycleStart: '2026-10-20' },
      { retainerId: seen.anchored, month: '2026-11-01', cycleNumber: 3, cycleStart: '2026-11-20' },
      { retainerId: seen.anchored, month: '2026-12-01', cycleNumber: 4, cycleStart: '2026-12-20' },
    ]);
    expect(seen.term).toEqual({
      startCycle: 2,
      cycles: 3,
      startDate: '2026-10-20',
      endDate: '2027-01-19',
    });
    expect(seen.amendment).toEqual({
      effectiveCycle: 3,
      effectiveDate: '2026-11-20',
      schedule: [
        { cycle: 3, amountMinor: 20_000 },
        { cycle: 4, amountMinor: 40_000 },
      ],
      effects: [
        {
          cycle: 3,
          effect: 'charge_changed',
          invoice: null,
          beforeMinor: 30_000,
          afterMinor: 20_000,
        },
      ],
    });
    // Derived from the terms: the day after the active term; none without one.
    expect(
      Object.fromEntries(
        seen.renewalDates.map((row: { id: string; renewalDate: string | null }) => [
          row.id,
          row.renewalDate,
        ]),
      ),
    ).toEqual({
      [seen.anchored]: '2027-01-20',
      [seen.openEnded]: null,
    });
  });
});
