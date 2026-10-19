import { readFileSync } from 'node:fs';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import {
  clients,
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
        // Ended in October with a fee before its December start: the fee's month is before it.
        const notStarted = await retainer('Not started', '2026-12-20', null);
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
        await tx.insert(retainerCharges).values({
          retainerId: notStarted,
          month: '2026-10-01',
          kind: 'termination_fee',
          amountMinor: 10_000,
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

        const ids = sql`(${anchored}, ${openEnded}, ${notStarted})`;
        const result = {
          anchored,
          openEnded,
          notStarted,
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
            .orderBy(asc(retainerCharges.month), asc(retainerCharges.cycleStart)),
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
      // Before the start month: cycle 1, never below it.
      {
        retainerId: seen.notStarted,
        month: '2026-10-01',
        cycleNumber: 1,
        cycleStart: '2026-12-20',
      },
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
      // Expand only: the month stays for the previous release.
      schedule: [
        { month: '2026-11-01', cycle: 3, amountMinor: 20_000 },
        { month: '2026-12-01', cycle: 4, amountMinor: 40_000 },
      ],
      effects: [
        {
          month: '2026-11-01',
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
      [seen.notStarted]: null,
    });
  });
});
