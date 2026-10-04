import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  type CalendarDate,
  followUpReminderBounds,
  isWorkDay,
  leadDisplayName,
  OPEN_LEAD_STAGES,
} from '@vertex-hub/contracts';
import { type Database, leads, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders, type Notice } from '../notifications/index.js';
import type { LeadRow } from './leads.service.js';

/** The managers of these departments get the overdue escalation (spec F03, "sales managers"). */
const SALES_DEPARTMENTS = ['general_communication', 'marketing'] as const;

/**
 * A12, two sources of the `notifications.daily` job (spec F03 rules 18–20): the follow-up date is
 * due (to the owner), and it passed by two full work days (to the owner and the sales managers).
 * Each is sent once per lead and date; a new date starts again.
 */
@Injectable()
export class LeadReminders implements OnModuleInit {
  private readonly logger = new Logger(LeadReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly reminders: DailyReminders,
  ) {}

  onModuleInit(): void {
    this.reminders.register('lead-follow-ups', (today) => this.remind(today));
  }

  async remind(today: CalendarDate): Promise<number> {
    if (!isWorkDay(today)) return 0;
    const bounds = followUpReminderBounds(today);
    let sent = 0;
    // The two kinds run independently: one failing does not hold back the other.
    const kinds: [string, () => Promise<number>][] = [
      [
        'Lead follow-up due reminders',
        () =>
          this.send(
            today,
            'lead_follow_up_due',
            [gt(leads.nextFollowUpOn, bounds.dueAfter), lte(leads.nextFollowUpOn, today)],
            async (lead) => ({
              type: 'lead_follow_up_due',
              data: { lead: leadDisplayName(lead), followUpOn: lead.nextFollowUpOn ?? today },
              recipients: [lead.ownerId],
              actorId: null,
              subjectId: lead.id,
            }),
          ),
      ],
      [
        'Lead follow-up overdue reminders',
        () =>
          this.send(
            today,
            'lead_follow_up_overdue',
            [lte(leads.nextFollowUpOn, bounds.overdueOnOrBefore)],
            async (lead, tx) => {
              const managers = await this.users.departmentManagers([...SALES_DEPARTMENTS], tx);
              const owner = (await this.users.summaries([lead.ownerId], tx)).get(lead.ownerId);
              return {
                type: 'lead_follow_up_overdue',
                data: {
                  lead: leadDisplayName(lead),
                  followUpOn: lead.nextFollowUpOn ?? today,
                  owner: owner?.name ?? '',
                },
                recipients: [lead.ownerId, ...[...managers.values()].flat()],
                actorId: null,
                subjectId: lead.id,
              };
            },
          ),
      ],
    ];
    await runEach(
      kinds,
      this.logger,
      ([name]) => name,
      async ([, run]) => {
        sent += await run();
      },
    );
    return sent;
  }

  /** Open, non-archived leads matching `filters`. */
  private eligible(filters: SQL[]): SQL {
    return and(
      inArray(leads.stage, [...OPEN_LEAD_STAGES]),
      isNull(leads.archivedAt),
      ...filters,
    ) as SQL;
  }

  /**
   * One transaction per reminder (F14 rule 8). The lead is locked and checked again inside it, so
   * a lead closed or re-dated since the candidates were read gets no stale notice; the reminder
   * is recorded first and sent only if this run recorded it.
   */
  private async send(
    today: CalendarDate,
    kind: 'lead_follow_up_due' | 'lead_follow_up_overdue',
    filters: SQL[],
    build: (lead: LeadRow, tx: Transaction) => Promise<Notice>,
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: leads.id })
      .from(leads)
      .where(this.eligible(filters))
      .orderBy(asc(leads.id));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Lead ${kind} reminder ${id}`,
      async ({ id }) => {
        const recorded = await this.db.transaction(async (tx) => {
          const [lead] = await tx
            .select()
            .from(leads)
            .where(and(eq(leads.id, id), this.eligible(filters)))
            .for('update');
          if (!lead?.nextFollowUpOn) return false;
          const key = { kind, subjectId: lead.id, occurrence: lead.nextFollowUpOn };
          return this.reminders.remindOnce(tx, key, today, await build(lead, tx));
        });
        if (recorded) sent += 1;
      },
    );
    return sent;
  }
}
