import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AuditAction,
  type AuditEntityType,
  type ChecklistItemKind,
  type CreateTaskChecklistItem,
  type CreateTaskLink,
  type PersonRef,
  TASK_LIMITS,
  type TaskRights,
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
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { EngagementDirectory } from '../projects/index.js';
import {
  actorOf,
  assertTaskWritable,
  editsCriteria,
  readableTask,
  taskRights,
  ticksCriteria,
} from './task-access.js';

type ChecklistRow = typeof taskChecklistItems.$inferSelect;

type LinkRow = typeof taskLinks.$inferSelect;

/** What a change of a checklist row needs: F06's work right, or F06B rule C6's criteria rights. */
type ItemRight = 'work' | 'editCriteria' | 'tickCriteria';

const RIGHTS: Record<ItemRight, (rights: TaskRights) => boolean> = {
  work: (rights) => rights.work || rights.manage,
  editCriteria: editsCriteria,
  tickCriteria: ticksCriteria,
};

/** The right to add, rename, order or remove rows of a kind. */
const writeRight = (kind: ChecklistItemKind): ItemRight =>
  kind === 'criterion' ? 'editCriteria' : 'work';

const LIMITS: Record<ChecklistItemKind, number> = {
  checklist: TASK_LIMITS.checklist,
  criterion: TASK_LIMITS.criteria,
};

/**
 * The checklist, the acceptance criteria and the links of a task (spec F06, rule 15 and the
 * actions table; F06B rule C6): the assignee, the department manager and manage-scope holders
 * change the checklist and links; manage scope writes the criteria, which the assignee, a
 * reviewer or manage scope tick. The two kinds are ordered and limited apart.
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
    kind: ChecklistItemKind = 'checklist',
  ): Promise<TaskChecklistItem> {
    const id = await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId, [writeRight(kind)]);
      const [current] = await tx
        .select({ total: count(), last: max(taskChecklistItems.position) })
        .from(taskChecklistItems)
        .where(liveItems(taskId, kind));
      if ((current?.total ?? 0) >= LIMITS[kind]) {
        throw new CodedException(409, 'LIMIT_REACHED', 'The list is full');
      }
      const position = (current?.last ?? 0) + 1;
      const [created] = await tx
        .insert(taskChecklistItems)
        .values({ taskId, text: input.text, kind, position })
        .returning({ id: taskChecklistItems.id });
      if (!created) throw new Error('Checklist insert returned no row');
      await this.audit(tx, actor, 'task_checklist_item.created', created.id, taskId, {
        after: { kind, text: input.text, position },
      });
      return created.id;
    });
    return this.checklistItem(taskId, id, kind);
  }

  /** Renames, ticks or unticks an item. */
  async updateChecklistItem(
    actor: CurrentUserInfo,
    taskId: string,
    itemId: string,
    input: UpdateTaskChecklistItem,
    kind: ChecklistItemKind = 'checklist',
  ): Promise<TaskChecklistItem> {
    await this.db.transaction(async (tx) => {
      const needs: ItemRight[] =
        kind === 'criterion'
          ? [
              ...(input.text !== undefined ? (['editCriteria'] as const) : []),
              ...(input.done !== undefined ? (['tickCriteria'] as const) : []),
            ]
          : ['work'];
      await this.workableTask(tx, actor, taskId, needs);
      const item = await this.liveItem(tx, taskId, itemId, kind);
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
      await this.audit(tx, actor, 'task_checklist_item.updated', itemId, taskId, {
        before: change.before,
        after: { kind, ...change.after },
      });
    });
    return this.checklistItem(taskId, itemId, kind);
  }

  /** Rewrites positions from the given order; every non-archived item once. */
  async reorderChecklist(
    actor: CurrentUserInfo,
    taskId: string,
    order: TaskChecklistOrder,
    kind: ChecklistItemKind = 'checklist',
  ): Promise<TaskChecklist> {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId, [writeRight(kind)]);
      const current = await tx
        .select({ id: taskChecklistItems.id, position: taskChecklistItems.position })
        .from(taskChecklistItems)
        .where(liveItems(taskId, kind));
      const known = new Set(current.map((row) => row.id));
      const complete =
        order.ids.length === current.length &&
        new Set(order.ids).size === order.ids.length &&
        order.ids.every((id) => known.has(id));
      if (!complete) {
        throw new CodedException(
          409,
          'INVALID_ORDER',
          'The order must list every item of the list once',
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
          after: { kind, position },
        });
      }
    });
    return { items: await this.checklist(taskId, kind) };
  }

  /** Removes an item from its list; the items after it move up. */
  async archiveChecklistItem(
    actor: CurrentUserInfo,
    taskId: string,
    itemId: string,
    kind: ChecklistItemKind = 'checklist',
  ) {
    await this.db.transaction(async (tx) => {
      await this.workableTask(tx, actor, taskId, [writeRight(kind)]);
      const item = await this.liveItem(tx, taskId, itemId, kind);
      await tx
        .update(taskChecklistItems)
        .set({ archivedAt: new Date() })
        .where(eq(taskChecklistItems.id, itemId));
      await tx
        .update(taskChecklistItems)
        .set({ position: sql`${taskChecklistItems.position} - 1` })
        .where(and(liveItems(taskId, kind), gt(taskChecklistItems.position, item.position)));
      await this.audit(tx, actor, 'task_checklist_item.archived', itemId, taskId, {
        before: { archived: false, text: item.text },
        after: { kind, archived: true },
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
    return this.presentLink(row, personRef(await this.users.summaries([actor.id]), actor.id));
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

  /** The task, locked, when the actor holds each of `needs` (F06's work right by default) and it is writable. */
  private async workableTask(
    tx: Transaction,
    actor: CurrentUserInfo,
    taskId: string,
    needs: readonly ItemRight[] = ['work'],
  ) {
    const task = await readableTask(
      tx,
      { clients: this.clients, engagements: this.engagements },
      actor,
      taskId,
      { forUpdate: true },
    );
    const rights = taskRights(actor, task);
    if (!needs.every((need) => RIGHTS[need](rights))) throw new ForbiddenException();
    assertTaskWritable(task);
    return task;
  }

  private async liveItem(
    tx: Transaction,
    taskId: string,
    itemId: string,
    kind: ChecklistItemKind,
  ): Promise<ChecklistRow> {
    const [item] = await tx
      .select()
      .from(taskChecklistItems)
      .where(and(eq(taskChecklistItems.id, itemId), liveItems(taskId, kind)))
      .for('update');
    if (!item) throw new NotFoundException();
    return item;
  }

  private async checklist(taskId: string, kind: ChecklistItemKind): Promise<TaskChecklistItem[]> {
    const rows = await this.db
      .select()
      .from(taskChecklistItems)
      .where(liveItems(taskId, kind))
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
      doneBy: row.doneById ? personRef(people, row.doneById) : null,
    }));
  }

  private async checklistItem(
    taskId: string,
    itemId: string,
    kind: ChecklistItemKind,
  ): Promise<TaskChecklistItem> {
    const item = (await this.checklist(taskId, kind)).find((i) => i.id === itemId);
    if (!item) throw new NotFoundException();
    return item;
  }

  private presentLink(row: LinkRow, addedBy: PersonRef): TaskLink {
    return {
      id: row.id,
      url: row.url,
      label: row.label,
      addedBy,
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

/** The non-archived items of one kind of the task. */
const liveItems = (taskId: string, kind: ChecklistItemKind) =>
  and(
    eq(taskChecklistItems.taskId, taskId),
    eq(taskChecklistItems.kind, kind),
    isNull(taskChecklistItems.archivedAt),
  );
