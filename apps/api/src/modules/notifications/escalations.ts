import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  ESCALATING_TYPES,
  ESCALATION_NAMES_SHOWN,
  ESCALATION_TYPES,
  type EscalationStep,
  type EscalationTarget,
  escalationDue,
  NOTIFICATION_CATALOG,
  type NotificationContent,
  type NotificationSubjectType,
  type NotificationType,
  workDaysSince,
} from '@vertex-hub/contracts';
import {
  type Database,
  notificationReminders,
  notifications,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq, gte, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { DailyReminders } from './daily-reminders.js';
import { NotificationCenter } from './notification-center.js';

type OpenRow = Pick<
  typeof notifications.$inferSelect,
  'recipientId' | 'type' | 'subjectType' | 'subjectId' | 'data' | 'createdAt'
>;

/** The open rows of one original: one type on one subject. */
interface Original {
  type: NotificationType;
  subject: { type: NotificationSubjectType; id: string };
  /** The day the earliest open row was created: the key of every step. */
  anchor: CalendarDate;
  /** The snapshot of that row. */
  data: Record<string, unknown>;
  openRecipients: string[];
}

/**
 * F16 rule B11: the escalation chain, a source of the `notifications.daily` job. While an
 * original of an escalating type stays unresolved for at least one recipient, each of its steps
 * is sent once, when due, keyed in `notification_reminders` by the subject and the day the
 * original was created. Rows from before F16 have no resolution type and never escalate (edge
 * case 21). Each step resolves with the original.
 */
@Injectable()
export class Escalations implements OnModuleInit {
  private readonly logger = new Logger(Escalations.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly daily: DailyReminders,
    private readonly center: NotificationCenter,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    this.daily.register('escalation', (today) => this.run(today));
  }

  /** Returns the number of steps sent. */
  async run(today: CalendarDate): Promise<number> {
    const rows = await this.db
      .select({
        recipientId: notifications.recipientId,
        type: notifications.type,
        subjectType: notifications.subjectType,
        subjectId: notifications.subjectId,
        data: notifications.data,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(
          inArray(notifications.type, ESCALATING_TYPES),
          eq(notifications.resolutionType, notifications.type),
          isNull(notifications.resolvedAt),
        ),
      );
    let sent = 0;
    await runEach(
      originals(rows),
      this.logger,
      (original) => `Escalation of ${original.type} on ${original.subject.id}`,
      async (original) => {
        for (const step of NOTIFICATION_CATALOG[original.type].escalation) {
          const daysOverdue =
            typeof original.data.daysOverdue === 'number' ? original.data.daysOverdue : 0;
          if (!escalationDue(step, original.anchor, today, daysOverdue)) continue;
          const done = await this.db.transaction((tx) => this.send(tx, original, step, today));
          if (done) sent += 1;
        }
      },
    );
    return sent;
  }

  /**
   * Records the step's key and, when this call recorded it, sends it. A step with no one left to
   * receive it is recorded and skipped. Returns whether it was sent.
   */
  private async send(
    tx: Transaction,
    original: Original,
    step: EscalationStep,
    today: CalendarDate,
  ): Promise<boolean> {
    const keyed = await tx
      .insert(notificationReminders)
      .values({
        kind: `escalation_${step.step}`,
        subjectId: original.subject.id,
        occurrence: original.anchor,
        sentOn: today,
      })
      .onConflictDoNothing()
      .returning({ kind: notificationReminders.kind });
    if (keyed.length === 0) return false;
    const recipients = await this.recipients(tx, original, step.target);
    if (recipients.length === 0) return false;
    const names = await this.users.summaries(original.openRecipients, tx);
    const waitingOn = original.openRecipients.flatMap((id) => {
      const name = names.get(id)?.name;
      return name ? [name] : [];
    });
    const content = {
      type: ESCALATION_TYPES[step.step],
      data: {
        originalType: original.type,
        originalData: original.data,
        waitingWorkDays: workDaysSince(original.anchor, today),
        waitingOn: waitingOn.slice(0, ESCALATION_NAMES_SHOWN),
        waitingOnMore: Math.max(0, waitingOn.length - ESCALATION_NAMES_SHOWN),
      },
    } as NotificationContent;
    const stored = await this.center.notify(tx, {
      ...content,
      recipients,
      actorId: null,
      subjectId: original.subject.id,
      subjectType: original.subject.type,
    });
    return stored > 0;
  }

  /**
   * Who a step goes to. Step 1 goes to the open recipients; later steps leave out everyone who
   * already received the original or a step of it (edge case 11).
   */
  private async recipients(
    tx: Transaction,
    original: Original,
    target: EscalationTarget,
  ): Promise<string[]> {
    if (target.to === 'open_recipients') return original.openRecipients;
    let candidates: string[];
    switch (target.to) {
      case 'managers':
        candidates = await this.managersOf(tx, original.openRecipients);
        break;
      case 'top': {
        const [managers, ops] = await Promise.all([
          this.users.withRole('general_manager', tx),
          this.users.departmentManagers(['internal_operations'], tx),
        ]);
        candidates = [...managers, ...(ops.get('internal_operations') ?? [])];
        break;
      }
      case 'department':
        candidates =
          (await this.users.departmentManagers([target.department], tx)).get(target.department) ??
          [];
        break;
      case 'role':
        candidates = await this.users.withRole(target.role, tx);
        break;
    }
    const received = await this.received(tx, original);
    return [...new Set(candidates)].filter((id) => !received.has(id));
  }

  /**
   * Rule B11 step 2: the managers of each open recipient's primary department; a recipient who
   * manages it, or has none, escalates to the General Managers.
   */
  private async managersOf(tx: Transaction, recipientIds: string[]): Promise<string[]> {
    const primary = await this.users.primaryDepartments(recipientIds, tx);
    const managers = await this.users.departmentManagers([...primary.values()], tx);
    const result: string[] = [];
    let toTop = false;
    for (const id of recipientIds) {
      const code = primary.get(id);
      const ofDepartment = code ? (managers.get(code) ?? []) : [];
      if (ofDepartment.length === 0 || ofDepartment.includes(id)) toTop = true;
      else result.push(...ofDepartment);
    }
    if (toTop) result.push(...(await this.users.withRole('general_manager', tx)));
    return result;
  }

  /** Everyone who received the original, or a step of it, since its anchor day. */
  private async received(tx: Transaction, original: Original): Promise<Set<string>> {
    const since = new Date(`${original.anchor}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 1);
    const rows = await tx
      .select({ recipientId: notifications.recipientId })
      .from(notifications)
      .where(
        and(
          eq(notifications.subjectType, original.subject.type),
          eq(notifications.subjectId, original.subject.id),
          gte(notifications.createdAt, since),
          or(
            eq(notifications.type, original.type),
            and(
              inArray(notifications.type, Object.values(ESCALATION_TYPES)),
              isNotNull(notifications.resolutionType),
              eq(notifications.resolutionType, original.type),
            ),
          ),
        ),
      );
    return new Set(rows.map((row) => row.recipientId));
  }
}

/** Groups the open rows by type and subject, anchored on the earliest one. */
function originals(rows: OpenRow[]): Original[] {
  const groups = new Map<string, OpenRow[]>();
  for (const row of rows) {
    const key = `${row.type}:${row.subjectType}:${row.subjectId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((group) => {
    const first = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!first) return [];
    return [
      {
        type: first.type,
        subject: { type: first.subjectType, id: first.subjectId },
        anchor: businessDate(first.createdAt),
        data: first.data as Record<string, unknown>,
        openRecipients: [...new Set(group.map((row) => row.recipientId))],
      },
    ];
  });
}
