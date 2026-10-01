import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  businessDate,
  type CancelShoot,
  type CloseShoot,
  calendarDay,
  type ReopenShoot,
  type ShootDetail,
} from '@vertex-hub/contracts';
import { type Database, shootShots, shoots } from '@vertex-hub/db';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { ShootTasks } from '../tasks/index.js';
import { ScheduleConflicts } from './schedule-conflicts.js';
import {
  actorOf,
  assertScheduled,
  assertShootScope,
  coversClient,
  crewOf,
  readableShoot,
} from './shoot-access.js';
import { ShootNotices } from './shoot-notices.js';
import { noticeShoot, ShootsService } from './shoots.service.js';

/** The site of a link: links may carry share tokens, so the audit keeps the host only. */
const siteOf = (url: string | null) => (url ? new URL(url).host : null);

/** Closing, cancelling and reopening a shoot (spec F11 rules 10–13). */
@Injectable()
export class ShootWorkflowService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly shoots: ShootsService,
    private readonly shootTasks: ShootTasks,
    private readonly conflicts: ScheduleConflicts,
    private readonly notices: ShootNotices,
  ) {}

  /**
   * Rules 10–12: completes a started shoot, delivers its task and creates the editing task.
   * Unticked shots never block (the UI warns).
   */
  async close(actor: CurrentUserInfo, id: string, input: CloseShoot): Promise<ShootDetail> {
    await this.db.transaction(async (tx) => {
      // Serialized with archiving users: the editing task's assignee must stay active.
      if (input.editingTask?.assigneeId) await lockAccessChanges(tx);
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      const crew = (await crewOf(tx, [id])).get(id) ?? [];
      const isLead = crew.some((member) => member.isLead && member.userId === actor.id);
      if (!isLead && !coversClient(actor, 'shoots.manage', client)) {
        throw new ForbiddenException();
      }
      assertScheduled(shoot);
      const now = new Date();
      if (now < shoot.startsAt) {
        throw new CodedException(409, 'SHOOT_NOT_STARTED', 'The shoot has not started yet');
      }
      const editing = input.editingTask;
      if (editing && editing.dueDate < businessDate(now)) {
        throw new BadRequestException('The editing task is due today or later');
      }
      const task = await this.shootTasks.lock(tx, shoot.taskId);
      if (!task) throw new NotFoundException();

      await tx
        .update(shoots)
        .set({
          status: 'completed',
          completedAt: now,
          completedById: actor.id,
          closeNote: input.note,
          rawFilesUrl: input.rawFilesUrl,
        })
        .where(eq(shoots.id, id));
      await this.shootTasks.deliver(tx, task.id, id, actor);
      let editingTaskId: string | null = null;
      if (editing) {
        // Team crew in the department, or nobody: no assign scope needed (rule 12).
        const onBehalf =
          !editing.assigneeId || crew.some((member) => member.userId === editing.assigneeId);
        const created = await this.shootTasks.createEditingTask(tx, actor, task, {
          ...editing,
          brief: input.note,
          rawFilesUrl: input.rawFilesUrl,
          onBehalf,
        });
        editingTaskId = created.id;
        await tx.update(shoots).set({ editingTaskId }).where(eq(shoots.id, id));
      }
      const [unticked] = await tx
        .select({ value: count() })
        .from(shootShots)
        .where(and(eq(shootShots.shootId, id), isNull(shootShots.doneAt)));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.completed',
        entityType: 'shoot',
        entityId: id,
        before: { status: 'scheduled' },
        after: {
          status: 'completed',
          ...(input.note && { closeNote: input.note }),
          ...(input.rawFilesUrl && { rawFilesSite: siteOf(input.rawFilesUrl) }),
          ...(editingTaskId && { editingTaskId }),
          ...(unticked?.value && { untickedShots: unticked.value }),
        },
      });
    });
    return this.shoots.detail(actor, id);
  }

  /**
   * Rule 13: cancels with a reason; the shoot task stays open and bookable unless `cancelTask`
   * cancels it too, through F06, with the same reason.
   */
  async cancel(actor: CurrentUserInfo, id: string, input: CancelShoot): Promise<ShootDetail> {
    await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      assertShootScope(actor, client);
      assertScheduled(shoot);
      await tx
        .update(shoots)
        .set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason })
        .where(eq(shoots.id, id));
      // After the shoot left `scheduled`, so the task guard lets the cancel through.
      if (input.cancelTask) {
        await this.shootTasks.cancel(tx, shoot.taskId, input.reason, id, actorOf(actor));
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.cancelled',
        entityType: 'shoot',
        entityId: id,
        before: { status: 'scheduled' },
        after: {
          status: 'cancelled',
          cancelReason: input.reason,
          ...(input.cancelTask && { taskCancelled: true }),
        },
      });
      const crew = (await crewOf(tx, [id])).get(id) ?? [];
      await this.notices.send(tx, [
        this.notices.notice(
          noticeShoot(shoot, client),
          'shoot_dropped',
          crew.map((member) => member.userId),
          actor.id,
          { cause: 'cancelled' },
        ),
      ]);
    });
    return this.shoots.detail(actor, id);
  }

  /**
   * Rule 13: back to `scheduled` while its task is still bookable, after the conflict check; the
   * task's due date follows the shoot again and the crew is told it is booked.
   */
  async reopen(actor: CurrentUserInfo, id: string, input: ReopenShoot): Promise<ShootDetail> {
    await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      assertShootScope(actor, client);
      if (shoot.archivedAt) {
        throw new CodedException(409, 'SHOOT_ARCHIVED', 'The shoot is archived');
      }
      if (shoot.status !== 'cancelled') {
        throw new CodedException(409, 'SHOOT_NOT_CANCELLED', 'The shoot is not cancelled');
      }
      const task = await this.shootTasks.lock(tx, shoot.taskId);
      if (!task) throw new NotFoundException();
      await this.shoots.assertBookable(tx, task, id);
      const crew = (await crewOf(tx, [id])).get(id) ?? [];
      const accepted = await this.conflicts.check(
        tx,
        {
          kind: 'shoot',
          id,
          startsAt: shoot.startsAt,
          endsAt: shoot.endsAt,
          userIds: crew.map((member) => member.userId),
        },
        input.acceptConflicts,
      );
      await tx
        .update(shoots)
        .set({ status: 'scheduled', cancelledAt: null, cancelReason: null })
        .where(eq(shoots.id, id));
      await this.shootTasks.setDueDate(tx, task, calendarDay(shoot.startsAt), actorOf(actor));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.reopened',
        entityType: 'shoot',
        entityId: id,
        before: { status: 'cancelled', cancelReason: shoot.cancelReason },
        after: {
          status: 'scheduled',
          ...(accepted.length > 0 && { acceptedConflicts: accepted }),
        },
      });
      await this.notices.send(tx, [
        this.notices.notice(
          noticeShoot(shoot, client),
          'shoot_booked',
          crew.map((member) => member.userId),
          actor.id,
        ),
      ]);
    });
    return this.shoots.detail(actor, id);
  }
}
