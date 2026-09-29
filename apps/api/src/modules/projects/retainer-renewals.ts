import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { addDays, type CalendarDate, daysInclusive } from '@vertex-hub/contracts';
import { type Database, retainers } from '@vertex-hub/db';
import { and, isNotNull, isNull, lte, ne } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { ClientDirectory } from '../clients/index.js';
import { DailyReminders } from '../notifications/index.js';

/** Days before the renewal date the first reminder goes out (F14 rule 12). */
const RENEWAL_NOTICE_DAYS = 30;

/**
 * The retainer renewal reminder (F05 R6, F14 rule 12), registered as a source of the
 * `notifications.daily` job: once 30 days before the renewal date and once on or after it, to
 * the client's primary account manager.
 */
@Injectable()
export class RetainerRenewals implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('retainer-renewals', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    const due = await this.db
      .select({
        id: retainers.id,
        name: retainers.name,
        clientId: retainers.clientId,
        renewalDate: retainers.renewalDate,
      })
      .from(retainers)
      .where(
        and(
          isNull(retainers.archivedAt),
          ne(retainers.status, 'ended'),
          isNotNull(retainers.renewalDate),
          lte(retainers.renewalDate, addDays(today, RENEWAL_NOTICE_DAYS)),
        ),
      );
    const clients = await this.clients.summaries(due.map((retainer) => retainer.clientId));
    let sent = 0;
    for (const retainer of due) {
      const client = clients.get(retainer.clientId);
      const renewalDate = retainer.renewalDate;
      if (!client || !renewalDate) continue;
      const reached = renewalDate <= today;
      const recorded = await this.db.transaction((tx) =>
        this.reminders.remindOnce(
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
            },
          },
        ),
      );
      if (recorded) sent += 1;
    }
    return sent;
  }
}
