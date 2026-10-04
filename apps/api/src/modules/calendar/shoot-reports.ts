import { Inject, Injectable } from '@nestjs/common';
import { businessDate, type ReportPeriod, type ShootStatus } from '@vertex-hub/contracts';
import { type Database, shoots } from '@vertex-hub/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { inBusinessPeriod } from '../../core/database/business-date.js';
import { DATABASE } from '../../core/database/database.module.js';

/** A shoot of a client on a day (F15 rules 18.6 and 18.10). */
export interface ShootDay {
  id: string;
  date: string;
  title: string;
  location: string;
}

/**
 * Read-only figures of shoots for reports (F15, ADR 0027): non-archived shoots of a client, dated
 * by their start in Asia/Damascus. Callers check the scope.
 */
@Injectable()
export class ShootReports {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Rule 18.6: the client's completed shoots that took place in the period. */
  completed(clientId: string, period: ReportPeriod): Promise<ShootDay[]> {
    return this.inPeriod(clientId, period, 'completed');
  }

  /** Rule 18.10: the client's shoots booked (still scheduled) in the period. */
  booked(clientId: string, period: ReportPeriod): Promise<ShootDay[]> {
    return this.inPeriod(clientId, period, 'scheduled');
  }

  private async inPeriod(
    clientId: string,
    period: ReportPeriod,
    status: ShootStatus,
  ): Promise<ShootDay[]> {
    const rows = await this.db
      .select({
        id: shoots.id,
        startsAt: shoots.startsAt,
        title: shoots.title,
        location: shoots.location,
      })
      .from(shoots)
      .where(
        and(
          eq(shoots.clientId, clientId),
          eq(shoots.status, status),
          isNull(shoots.archivedAt),
          inBusinessPeriod(shoots.startsAt, period),
        ),
      )
      .orderBy(asc(shoots.startsAt), asc(shoots.id));
    return rows.map(({ startsAt, ...row }) => ({ ...row, date: businessDate(startsAt) }));
  }
}
