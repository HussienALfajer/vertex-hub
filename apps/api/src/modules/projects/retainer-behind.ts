import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  BEHIND_ALERT_DAYS,
  behindAlert,
  type CalendarDate,
  daysInclusive,
  isWorkDay,
} from '@vertex-hub/contracts';
import { type Database, retainerCycles, retainers } from '@vertex-hub/db';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders } from '../notifications/index.js';
import { RetainerCyclesService } from './retainer-cycles.service.js';

/**
 * The retainer behind alert (A09, spec P2A rules 1–7), registered as a source of the
 * `notifications.daily` job: once when 7 days or fewer remain in an open cycle with a line behind,
 * and once more at 3 days or fewer, to the client's primary account manager and the managers of
 * Internal Operations. Cycles of 7 days or shorter get neither.
 */
@Injectable()
export class RetainerBehindAlerts implements OnModuleInit {
  private readonly logger = new Logger(RetainerBehindAlerts.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly cycles: RetainerCyclesService,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('retainer-behind', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    // Rule 1: open cycles of active, live retainers of live clients, inside the alert window.
    const inWindow = and(
      eq(retainerCycles.status, 'open'),
      gte(retainerCycles.periodEnd, today),
      lte(retainerCycles.periodEnd, addDays(today, BEHIND_ALERT_DAYS - 1)),
      eq(retainers.status, 'active'),
      isNull(retainers.archivedAt),
      this.clients.isLive(retainers.clientId),
    );
    const candidates = await this.db
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .innerJoin(retainers, eq(retainers.id, retainerCycles.retainerId))
      .where(inWindow)
      .orderBy(asc(retainerCycles.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Behind alert ${id}`,
      async ({ id }) => {
        // Read again under the retainer lock, so a change since the candidates were read counts.
        const recorded = await this.db.transaction(async (tx) => {
          const [retainer] = await tx
            .select({ id: retainers.id, name: retainers.name, clientId: retainers.clientId })
            .from(retainerCycles)
            .innerJoin(retainers, eq(retainers.id, retainerCycles.retainerId))
            .where(and(eq(retainerCycles.id, id), inWindow))
            .for('update', { of: retainers });
          if (!retainer) return false;
          const client = await this.clients.summary(retainer.clientId, tx);
          if (!client || client.archived) return false;
          const cycle = await this.cycles.counted(tx, id, today);
          const alert = cycle && behindAlert(cycle, today);
          if (!alert) return false;
          // Rule 4: the badge's rule; rule 6: only the lines that are behind, by position.
          const behind = cycle.lines.filter((line) => line.behind);
          if (behind.length === 0) return false;
          const managers = await this.users.departmentManagers(['internal_operations'], tx);
          return this.reminders.remindOnce(
            tx,
            {
              kind: alert === 'final' ? 'cycle_behind_final' : 'cycle_behind',
              subjectId: cycle.id,
              occurrence: cycle.periodEnd,
            },
            today,
            {
              type: 'retainer_behind',
              recipients: [client.accountManagerId, ...[...managers.values()].flat()],
              actorId: null,
              subjectId: retainer.id,
              data: {
                retainer: retainer.name,
                client: client.name,
                periodEnd: cycle.periodEnd,
                daysLeft: daysInclusive(today, cycle.periodEnd),
                final: alert === 'final',
                lines: behind.map((line) => ({
                  kind: line.kind,
                  label: line.label,
                  delivered: line.delivered,
                  committed: line.committed,
                  ready: line.tasks.ready,
                })),
              },
            },
          );
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
