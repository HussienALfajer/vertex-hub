import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditAction,
  type AuditEntityType,
  type CreateTaskChecklistItem,
  type CreateTaskLink,
  TASK_LIMITS,
  type TaskChecklist,
  type TaskChecklistItem,
  type TaskChecklistOrder,
  type TaskLink,
  type UpdateTaskChecklistItem,
} from '@vertex-hub/contracts';
import { type Database, type Transaction, taskChecklistItems, taskLinks } from '@vertex-hub/db';
import { and, asc, count, eq, gt, isNull, max, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { actorOf, assertTaskWritable, readableTask, taskRights } from './task-access.js';

type ChecklistRow = typeof taskChecklistItems.$inferSelect;

type LinkRow = typeof taskLinks.$inferSelect;

/**
 * The checklist and the links of a task (spec F06, rule 15 and the actions table): the assignee,
 * the department manager and manage-scope holders change them.
 */
@Injectable()
export class TaskPartsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly engagements: EngagementDirectory,
  ) {}

  async addChecklistItem(
    actor: CurrentUserInfo,
    taskId: string,
    input: CreateTaskChecklistItem,
  ): Promise<TaskChecklistItem> {
    const id = await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const [current] = await tx
        .select({ total: count(), last: max(taskChecklistItems.position) })
        .from(taskChecklistItems)
        .where(liveItems(taskId));
      if ((current?.total ?? 0) >= TASK_LIMITS.checklist) {
        throw new CodedException(409, 'LIMIT_REACHED', 'The checklist is full');
      }
      const position = (current?.last ?? 0) + 1;
      const [created] = await tx
        .insert(taskChecklistItems)
        .values({ taskId, text: input.text, position })
        .returning({ id: taskChecklistItems.id });
      if (!created) throw new Error('Checklist insert returned no row');
      await this.audit(tx, actor, 'task_checklist_item.created', created.id, taskId, {
        after: { text: input.text, position },
      });
      return created.id;
    });
    return this.checklistItem(taskId, id);
  }

  /** Renames, ticks or unticks an item. */
  async updateChecklistItem(
    actor: CurrentUserInfo,
    taskId: string,
    itemId: string,
    input: UpdateTaskChecklistItem,
  ): Promise<TaskChecklistItem> {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const item = await this.liveItem(tx, taskId, itemId);
      const change = changedFields({ text: item.text, done: !!item.doneAt }, input);
      if (!change) return;
      const done = change.after.done as boolean | undefined;
      await tx
        .update(taskChecklistItems)
        .set({
          ...(input.text !== undefined && { text: input.text }),
          ...(done === true && { doneAt: new Date(), doneById: actor.id }),
          ...(done === false && { doneAt: null, doneById: null }),
        })
        .where(eq(taskChecklistItems.id, itemId));
      await this.audit(tx, actor, 'task_checklist_item.updated', itemId, taskId, change);
    });
    return this.checklistItem(taskId, itemId);
  }

  /** Rewrites positions from the given order; every non-archived item once. */
  async reorderChecklist(
    actor: CurrentUserInfo,
    taskId: string,
    order: TaskChecklistOrder,
  ): Promise<TaskChecklist> {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const current = await tx
        .select({ id: taskChecklistItems.id, position: taskChecklistItems.position })
        .from(taskChecklistItems)
        .where(liveItems(taskId));
      const known = new Set(current.map((row) => row.id));
      const complete =
        order.ids.length === current.length &&
        new Set(order.ids).size === order.ids.length &&
        order.ids.every((id) => known.has(id));
      if (!complete) {
        throw new CodedException(
          409,
          'INVALID_ORDER',
          'The order must list every checklist item of the task once',
        );
      }
      const positions = new Map(current.map((row) => [row.id, row.position]));
      for (const [index, id] of order.ids.entries()) {
        const position = index + 1;
        const before = positions.get(id);
        if (before === position) continue;
        await tx.update(taskChecklistItems).set({ position }).where(eq(taskChecklistItems.id, id));
        await this.audit(tx, actor, 'task_checklist_item.reordered', id, taskId, {
          before: { position: before },
          after: { position },
        });
      }
    });
    return { items: await this.checklist(taskId) };
  }

  /** Removes an item from the checklist; the items after it move up. */
  async archiveChecklistItem(actor: CurrentUserInfo, taskId: string, itemId: string) {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const item = await this.liveItem(tx, taskId, itemId);
      await tx
        .update(taskChecklistItems)
        .set({ archivedAt: new Date() })
        .where(eq(taskChecklistItems.id, itemId));
      await tx
        .update(taskChecklistItems)
        .set({ position: sql`${taskChecklistItems.position} - 1` })
        .where(and(liveItems(taskId), gt(taskChecklistItems.position, item.position)));
      await this.audit(tx, actor, 'task_checklist_item.archived', itemId, taskId, {
        before: { archived: false, text: item.text },
        after: { archived: true },
      });
    });
  }

  async addLink(actor: CurrentUserInfo, taskId: string, input: CreateTaskLink): Promise<TaskLink> {
    const row = await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const [current] = await tx
        .select({ total: count() })
        .from(taskLinks)
        .where(and(eq(taskLinks.taskId, taskId), isNull(taskLinks.archivedAt)));
      if ((current?.total ?? 0) >= TASK_LIMITS.links) {
        throw new CodedException(409, 'LIMIT_REACHED', 'The task has too many links');
      }
      const [created] = await tx
        .insert(taskLinks)
        .values({ taskId, url: input.url, label: input.label ?? null, addedById: actor.id })
        .returning();
      if (!created) throw new Error('Link insert returned no row');
      // Links may carry share tokens: the audit keeps the site only (apps/api rules).
      await this.audit(tx, actor, 'task_link.created', created.id, taskId, {
        after: { label: created.label, site: new URL(created.url).host },
      });
      return created;
    });
    return this.presentLink(row, actor.name);
  }

  async archiveLink(actor: CurrentUserInfo, taskId: string, linkId: string) {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId);
      const [link] = await tx
        .select()
        .from(taskLinks)
        .where(
          and(eq(taskLinks.id, linkId), eq(taskLinks.taskId, taskId), isNull(taskLinks.archivedAt)),
        )
        .for('update');
      if (!link) throw new NotFoundException();
      await tx.update(taskLinks).set({ archivedAt: new Date() }).where(eq(taskLinks.id, linkId));
      await this.audit(tx, actor, 'task_link.archived', linkId, taskId, {
        before: { archived: false, label: link.label, site: new URL(link.url).host },
        after: { archived: true },
      });
    });
  }

  /** The task, locked, when the actor works it or holds manage scope and it is writable. */
  private async workableTask(tx: Transaction, actor: CurrentUserInfo, taskId: string) {
    const task = await readableTask(
      tx,
      { clients: this.clients, engagements: this.engagements },
      actor,
      taskId,
      { forUpdate: true },
    );
    const rights = taskRights(actor, task);
    if (!rights.work && !rights.manage) throw new ForbiddenException();
    assertTaskWritable(task);
    return task;
  }

  private async liveItem(tx: Transaction, taskId: string, itemId: string): Promise<ChecklistRow> {
    const [item] = await tx
      .select()
      .from(taskChecklistItems)
      .where(and(eq(taskChecklistItems.id, itemId), liveItems(taskId)))
      .for('update');
    if (!item) throw new NotFoundException();
    return item;
  }

  private async checklist(taskId: string): Promise<TaskChecklistItem[]> {
    const rows = await this.db
      .select()
      .from(taskChecklistItems)
      .where(liveItems(taskId))
      .orderBy(asc(taskChecklistItems.position));
    const people = await this.users.summaries(
      rows.flatMap((row) => (row.doneById ? [row.doneById] : [])),
    );
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      position: row.position,
      done: !!row.doneAt,
      doneAt: row.doneAt?.toISOString() ?? null,
      doneBy: row.doneById
        ? { id: row.doneById, name: people.get(row.doneById)?.name ?? '' }
        : null,
    }));
  }

  private async checklistItem(taskId: string, itemId: string): Promise<TaskChecklistItem> {
    const item = (await this.checklist(taskId)).find((i) => i.id === itemId);
    if (!item) throw new NotFoundException();
    return item;
  }

  private presentLink(row: LinkRow, addedByName: string): TaskLink {
    return {
      id: row.id,
      url: row.url,
      label: row.label,
      addedBy: { id: row.addedById, name: addedByName },
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Entries of a checklist item or link carry their task, for the audit log. */
  private audit(
    tx: Transaction,
    actor: CurrentUserInfo,
    action: AuditAction,
    entityId: string,
    taskId: string,
    change: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    const entityType: AuditEntityType = action.startsWith('task_link.')
      ? 'task_link'
      : 'task_checklist_item';
    return recordAudit(tx, {
      actor: actorOf(actor),
      action,
      entityType,
      entityId,
      ...(change.before && { before: change.before }),
      after: { taskId, ...change.after },
    });
  }
}

/** The non-archived checklist items of the task. */
const liveItems = (taskId: string) =>
  and(eq(taskChecklistItems.taskId, taskId), isNull(taskChecklistItems.archivedAt));
