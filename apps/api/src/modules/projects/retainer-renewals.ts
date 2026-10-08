import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  addDays,
  type CalendarDate,
  daysInclusive,
  RENEWAL_NOTICE_DAYS,
} from '@vertex-hub/contracts';
import { type Database, retainers } from '@vertex-hub/db';
import { and, asc, eq, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders } from '../notifications/index.js';
import { RetainerTermsService } from './retainer-terms.service.js';

/**
 * The retainer renewal reminder (F05 R6, F14 rule 12), registered as a source of the
 * `notifications.daily` job: once 30 days before the renewal date and once on or after it, to
 * the client's primary account manager. Retainers of archived clients are skipped (F05 G2).
 */
@Injectable()
export class RetainerRenewals implements OnModuleInit {
  private readonly logger = new Logger(RetainerRenewals.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly reminders: DailyReminders,
    private readonly terms: RetainerTermsService,
  ) {}

  onModuleInit(): void {
    this.reminders.register('retainer-renewals', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    const due = (on: CalendarDate) =>
      and(
        isNull(retainers.archivedAt),
        ne(retainers.status, 'ended'),
        isNotNull(retainers.renewalDate),
        lte(retainers.renewalDate, addDays(on, RENEWAL_NOTICE_DAYS)),
        this.clients.isLive(retainers.clientId),
      );
    const candidates = await this.db
      .select({ id: retainers.id })
      .from(retainers)
      .where(due(today))
      .orderBy(asc(retainers.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Renewal reminder ${id}`,
      async ({ id }) => {
        // Read again under the retainer lock, so an edit since the candidates were read counts.
        const recorded = await this.db.transaction(async (tx) => {
          const [retainer] = await tx
            .select({
              id: retainers.id,
              name: retainers.name,
              clientId: retainers.clientId,
              renewalDate: retainers.renewalDate,
            })
            .from(retainers)
            .where(and(eq(retainers.id, id), due(today)))
            .for('update', { of: retainers });
          const renewalDate = retainer?.renewalDate;
          if (!retainer || !renewalDate) return false;
          const client = await this.clients.summary(retainer.clientId, tx);
          if (!client || client.archived) return false;
          const reached = renewalDate <= today;
          const endAction = await this.terms.lastEndAction(tx, retainer.id);
          return this.reminders.remindOnce(
            tx,
            {
              kind: reached ? 'renewal_reached' : 'renewal_due',
              subjectId: retainer.id,
              occurrence: renewalDate,
            },
            today,
            {
              type: 'retainer_renewal_due',
              recipients: [client.accountManagerId],
              actorId: null,
              subjectId: retainer.id,
              data: {
                retainer: retainer.name,
                client: client.name,
                renewalDate,
                daysLeft: reached ? 0 : daysInclusive(today, renewalDate) - 1,
                endAction,
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
