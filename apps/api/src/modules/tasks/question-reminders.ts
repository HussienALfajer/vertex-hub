import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  businessDate,
  type HolidayRange,
  QUESTION_TIMING_HOURS,
  type TimedReminderKind,
  workHoursBetween,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskComments, tasks } from '@vertex-hub/db';
import { and, asc, eq, lte, notInArray, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { runEach } from '../../core/jobs/index.js';
import { UserDirectory } from '../auth/index.js';
import { HolidayCalendar } from '../hr/index.js';
import { type Notice, TimedNotifications } from '../notifications/index.js';
import { TaskCommentsService } from './task-comments.service.js';
import { TaskNotices } from './task-notices.js';
import { type CommentRow, openQuestionSql } from './task-questions.js';
import { TaskQuestionsService } from './task-questions.service.js';
import { TasksService } from './tasks.service.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * F06B rule B8: a question open 24 work hours reminds its current addressee, and at 48 it
 * escalates, each once per clock (asked or last reopened), through F16's minute job and
 * `timed_reminders`. Work hours skip Fridays and public holidays (rule B9), read on every run,
 * so a holiday added later moves the reminders not yet sent (edge case 16).
 */
@Injectable()
export class QuestionReminders implements OnModuleInit {
  private readonly logger = new Logger(QuestionReminders.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly holidays: HolidayCalendar,
    private readonly timed: TimedNotifications,
    private readonly notices: TaskNotices,
    private readonly comments: TaskCommentsService,
    private readonly questions: TaskQuestionsService,
    private readonly tasks: TasksService,
  ) {}

  /**
   * Open questions of tasks that are not delivered or cancelled (rule B10) and not read-only:
   * archived, or of an archived client, project or retainer (F06 rule 17).
   */
  private remindable(): SQL {
    return and(
      openQuestionSql,
      this.tasks.visibleSql(),
      notInArray(tasks.status, ['delivered', 'cancelled']),
    ) as SQL;
  }

  onModuleInit(): void {
    this.timed.register('task-questions', (now) => this.remind(now));
  }

  /** Sends what is due at `now`; returns how many were sent. */
  async remind(now: Date): Promise<number> {
    // Work hours never outrun calendar hours: a younger clock has nothing due.
    const candidates = await this.db
      .select({ id: taskComments.id, clockStartedAt: taskComments.clockStartedAt })
      .from(taskComments)
      .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
      .where(
        and(
          this.remindable(),
          lte(
            taskComments.clockStartedAt,
            new Date(now.getTime() - QUESTION_TIMING_HOURS.reminder * HOUR_MS),
          ),
        ),
      )
      .orderBy(asc(taskComments.clockStartedAt), asc(taskComments.id));
    const oldest = candidates[0]?.clockStartedAt;
    if (!oldest) return 0;
    const holidays = await this.holidays.from(businessDate(oldest));
    let sent = 0;
    await runEach(
      candidates,
      this.logger,
      ({ id }) => `Question reminder ${id}`,
      async ({ id }) => {
        sent += await this.remindOne(id, now, holidays);
      },
    );
    return sent;
  }

  private remindOne(id: string, now: Date, holidays: readonly HolidayRange[]): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ question: taskComments })
        .from(taskComments)
        .innerJoin(tasks, eq(tasks.id, taskComments.taskId))
        .where(and(eq(taskComments.id, id), this.remindable()))
        .for('update', { of: taskComments });
      const question = row?.question;
      if (!question?.clockStartedAt) return 0;
      const hours = workHoursBetween(question.clockStartedAt, now, holidays);
      const task = await this.notices.load(tx, question.taskId);
      const data = await this.comments.questionData(tx, question);
      let sent = 0;
      const send = async (kind: TimedReminderKind, notice: Notice) => {
        const recorded = await this.timed.remindOnce(
          tx,
          { kind, subjectId: question.id, occursAt: question.clockStartedAt as Date },
          notice,
        );
        if (recorded) sent += 1;
      };
      if (hours >= QUESTION_TIMING_HOURS.reminder) {
        await send(
          'question_reminder',
          this.notices.notice(
            task,
            'task_question_reminder',
            await this.questions.waitingOn(tx, question),
            null,
            data,
          ),
        );
      }
      if (hours >= QUESTION_TIMING_HOURS.escalation) {
        await send(
          'question_escalation',
          this.notices.notice(
            task,
            'task_question_escalated',
            await this.escalationTargets(tx, question),
            null,
            data,
          ),
        );
      }
      return sent;
    });
  }

  /**
   * Rule B8: the managers of the addressee's primary department; the General Managers and the
   * Operations manager when the addressee manages it, has none, or the question is still with its
   * department's managers.
   */
  private async escalationTargets(tx: Transaction, question: CommentRow): Promise<string[]> {
    const addressee = question.addressedUserId;
    if (addressee) {
      const primary = (await this.users.primaryDepartments([addressee], tx)).get(addressee);
      const managers = primary ? await this.notices.managers(tx, primary) : [];
      if (managers.length > 0 && !managers.includes(addressee)) return managers;
    }
    const [generalManagers, operations] = await Promise.all([
      this.users.withRole('general_manager', tx),
      this.notices.managers(tx, 'internal_operations'),
    ]);
    return [...generalManagers, ...operations];
  }
}
