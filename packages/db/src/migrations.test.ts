import { readFileSync } from 'node:fs';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';
import {
  clients,
  invoiceLines,
  invoices,
  retainerCharges,
  retainerCycles,
  retainers,
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
});
