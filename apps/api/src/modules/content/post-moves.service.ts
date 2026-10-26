import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CalendarDate,
  type MovedPost,
  type MovePost,
  moveWorkDays,
  type PostMovePreview,
} from '@vertex-hub/contracts';
import { contentPosts, type Database } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { HolidayCalendar } from '../hr/index.js';
import { PostTasks, type ShiftedTask } from '../tasks/index.js';
import { ContentService } from './content.service.js';
import {
  actorOf,
  assertPostWritable,
  type PostAccess,
  postRights,
  readablePost,
} from './post-access.js';
import { PostNotices, toTimeOfDay } from './post-notices.js';

/**
 * Moving a post to another day (spec F08B rules B6–B9): F08's date edit (any open status, no
 * re-approval, audited), with the option of shifting the open linked tasks' due dates by the same
 * number of work days.
 */
@Injectable()
export class PostMovesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly content: ContentService,
    private readonly tasks: PostTasks,
    private readonly notices: PostNotices,
    private readonly holidays: HolidayCalendar,
  ) {}

  /** Rule B7: the tasks the shift would move, and whether to offer it ticked. */
  async preview(
    actor: CurrentUserInfo,
    id: string,
    publishDate: CalendarDate,
  ): Promise<PostMovePreview> {
    const post = await readablePost(this.db, this.clients, actor, id);
    this.assertMovable(actor, post, publishDate);
    const today = businessDate();
    const holidays = await this.holidays.from(today);
    const workDays = moveWorkDays(post.publishDate, publishDate, holidays);
    const plan = await this.tasks.shiftPlan(this.db, id, workDays, today, holidays);
    return {
      workDays,
      tasks: plan.map(({ assigneeId: _, ...task }) => task),
      // Rule B7: ticked when an open task or subtask would be due after the new date.
      suggestShift: plan.some((task) => task.dueDate > publishDate),
    };
  }

  /** Rules B8–B9: the move, and the shift when asked, in one transaction. */
  async move(actor: CurrentUserInfo, id: string, input: MovePost): Promise<MovedPost> {
    const shifted = await this.db.transaction(async (tx) => {
      // Edge case 6: the second of two moves waits and counts from the date the first left.
      const post = await readablePost(tx, this.clients, actor, id, { forUpdate: true });
      this.assertMovable(actor, post, input.publishDate);
      if (post.publishDate === input.publishDate) return [];
      const today = businessDate();
      const holidays = await this.holidays.from(today, tx);
      const workDays = moveWorkDays(post.publishDate, input.publishDate, holidays);
      await tx
        .update(contentPosts)
        .set({ publishDate: input.publishDate })
        .where(eq(contentPosts.id, id));
      const moved: ShiftedTask[] = input.shiftTasks
        ? await this.tasks.shiftDueDates(tx, id, workDays, actorOf(actor), today, holidays)
        : [];
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.moved',
        entityType: 'post',
        entityId: id,
        before: { publishDate: post.publishDate },
        after: {
          publishDate: input.publishDate,
          ...(moved.length > 0 && { shiftedTaskIds: moved.map((task) => task.id) }),
        },
      });
      // Rule B8: the client keeps its snapshot date; the account manager is told.
      await this.notices.sendChange(tx, post, actor.id, [
        await this.content.movedNotice(
          tx,
          { ...post, publishDate: input.publishDate },
          { date: post.publishDate, time: toTimeOfDay(post.publishTime) },
          moved,
          actor.id,
        ),
      ]);
      return moved;
    });
    return {
      ...(await this.content.detail(actor, id)),
      shiftedTaskIds: shifted.map((task) => task.id),
    };
  }

  /**
   * Rule B6: an open post the actor may edit, to a day of today or later; published and
   * cancelled posts stay where they are (`POST_LOCKED`).
   */
  private assertMovable(actor: CurrentUserInfo, post: PostAccess, publishDate: CalendarDate) {
    if (!postRights(actor, post.client).edit) throw new ForbiddenException();
    assertPostWritable(post);
    if (post.status === 'published' || post.status === 'cancelled') {
      throw new CodedException(409, 'POST_LOCKED', `A ${post.status} post does not move`);
    }
    if (publishDate < businessDate()) {
      throw new CodedException(400, 'INVALID_DATES', 'A post moves to today or later');
    }
  }
}
