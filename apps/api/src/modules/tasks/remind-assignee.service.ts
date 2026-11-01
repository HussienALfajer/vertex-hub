import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { isTaskFinished, type TaskReminderInput } from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { actorOf, assertTaskWritable, readableTask, remindsAssignee } from './task-access.js';
import { TaskNotices } from './task-notices.js';

/**
 * F06C: a reminder sent by hand to a task's assignee by its creator or a manager, as an
 * important notification with an optional note. No limit on how often (owner, 2026-11-01).
 */
@Injectable()
export class RemindAssigneeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly notices: TaskNotices,
    private readonly center: NotificationCenter,
  ) {}

  async remind(actor: CurrentUserInfo, id: string, input: TaskReminderInput): Promise<void> {
    const directories = { clients: this.clients, engagements: this.engagements };
    await this.db.transaction(async (tx) => {
      const access = await readableTask(tx, directories, actor, id);
      if (access.assigneeId === actor.id) {
        throw new CodedException(
          409,
          'CANNOT_REMIND_SELF',
          'The assignee cannot remind themselves',
        );
      }
      if (!remindsAssignee(actor, access)) throw new ForbiddenException();
      assertTaskWritable(access);
      if (isTaskFinished(access.status) || access.status === 'cancelled') {
        throw new CodedException(409, 'TASK_CLOSED', 'The task is finished or cancelled');
      }
      const assigneeId = access.assigneeId;
      if (!assigneeId) {
        throw new CodedException(409, 'TASK_NOT_ASSIGNED', 'The task has no assignee to remind');
      }
      const note = input.note ?? null;
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'task.reminded',
        entityType: 'task',
        entityId: id,
        after: { assigneeId, note },
      });
      const task = await this.notices.load(tx, id);
      await this.center.notify(
        tx,
        this.notices.notice(task, 'task_reminder', [assigneeId], actor.id, { note }),
      );
    });
  }
}
