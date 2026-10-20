import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AnnouncementBody,
  type AnnouncementTemplate,
  type AnnouncementTemplateList,
  announcementExcerpt,
  type CreateAnnouncementTemplate,
  type UpdateAnnouncementTemplate,
} from '@vertex-hub/contracts';
import { announcementTemplates, type Database, type Transaction } from '@vertex-hub/db';
import { and, asc, eq, isNull, or, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { managesAll } from './announcement-access.js';

type TemplateRow = typeof announcementTemplates.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** The text an audit entry keeps of a shared template. */
function audited(row: Partial<TemplateRow>) {
  return {
    name: row.name,
    title: row.title,
    body: row.body === undefined ? undefined : announcementExcerpt(row.body as AnnouncementBody),
    priority: row.priority,
    requiresAck: row.requiresAck,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
  };
}

/**
 * Announcement templates (spec F16 rule D12): personal ones belong to their owner; shared ones
 * (no owner) are read by everyone and kept by holders of `announcements.manage` `all`, with
 * audit entries for shared templates only.
 */
@Injectable()
export class AnnouncementTemplatesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The caller's personal templates, then the shared ones, each by name. */
  async list(actor: CurrentUserInfo): Promise<AnnouncementTemplateList> {
    const rows = await this.db
      .select()
      .from(announcementTemplates)
      .where(and(isNull(announcementTemplates.archivedAt), this.readable(actor)))
      .orderBy(
        sql`${announcementTemplates.ownerId} is null`,
        asc(announcementTemplates.name),
        asc(announcementTemplates.id),
      );
    return { items: rows.map((row) => this.toTemplate(actor, row)) };
  }

  async create(
    actor: CurrentUserInfo,
    input: CreateAnnouncementTemplate,
  ): Promise<AnnouncementTemplate> {
    if (input.shared && !managesAll(actor.access)) throw new ForbiddenException();
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(announcementTemplates)
        .values({
          ownerId: input.shared ? null : actor.id,
          name: input.name,
          title: input.title,
          body: input.body,
          priority: input.priority,
          requiresAck: input.requiresAck,
          linkUrl: input.linkUrl ?? null,
          linkLabel: input.linkUrl ? (input.linkLabel ?? null) : null,
        })
        .returning();
      if (!created) throw new Error('Insert returned no row');
      if (input.shared) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'announcement_template.created',
          entityType: 'announcement_template',
          entityId: created.id,
          before: null,
          after: audited(created),
        });
      }
      return created;
    });
    return this.toTemplate(actor, row);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateAnnouncementTemplate,
  ): Promise<AnnouncementTemplate> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lockEditable(tx, actor, id);
      const linkUrl = input.linkUrl === undefined ? current.linkUrl : input.linkUrl;
      const priority = input.priority ?? current.priority;
      const next: Partial<TemplateRow> = {
        ...input,
        // A label without a link is dropped with the link; critical keeps the acknowledgement.
        linkLabel: linkUrl
          ? input.linkLabel === undefined
            ? current.linkLabel
            : input.linkLabel
          : null,
        requiresAck: priority === 'critical' ? true : (input.requiresAck ?? current.requiresAck),
      };
      const [updated] = await tx
        .update(announcementTemplates)
        .set(next)
        .where(eq(announcementTemplates.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      const changes = changedFields(audited(current), audited(next));
      if (current.ownerId === null && changes) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'announcement_template.updated',
          entityType: 'announcement_template',
          entityId: id,
          before: changes.before,
          after: changes.after,
        });
      }
      return updated;
    });
    return this.toTemplate(actor, row);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<AnnouncementTemplate> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.lockEditable(tx, actor, id);
      const [archived] = await tx
        .update(announcementTemplates)
        .set({ archivedAt: new Date() })
        .where(eq(announcementTemplates.id, id))
        .returning();
      if (!archived) throw new NotFoundException();
      if (current.ownerId === null) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'announcement_template.archived',
          entityType: 'announcement_template',
          entityId: id,
          before: { archived: false },
          after: { archived: true },
        });
      }
      return archived;
    });
    return this.toTemplate(actor, row);
  }

  /** Own personal templates and every shared one. */
  private readable(actor: CurrentUserInfo): SQL {
    return or(
      eq(announcementTemplates.ownerId, actor.id),
      isNull(announcementTemplates.ownerId),
    ) as SQL;
  }

  private editable(actor: CurrentUserInfo, row: TemplateRow): boolean {
    return row.ownerId === null ? managesAll(actor.access) : row.ownerId === actor.id;
  }

  /** A template the caller keeps; someone else's personal one answers 404, a shared one 403. */
  private async lockEditable(tx: Transaction, actor: CurrentUserInfo, id: string) {
    const [row] = await tx
      .select()
      .from(announcementTemplates)
      .where(
        and(
          eq(announcementTemplates.id, id),
          isNull(announcementTemplates.archivedAt),
          this.readable(actor),
        ),
      )
      .for('update');
    if (!row) throw new NotFoundException();
    if (!this.editable(actor, row)) throw new ForbiddenException();
    return row;
  }

  private toTemplate(actor: CurrentUserInfo, row: TemplateRow): AnnouncementTemplate {
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      body: row.body as AnnouncementBody,
      priority: row.priority,
      requiresAck: row.requiresAck,
      linkUrl: row.linkUrl,
      linkLabel: row.linkLabel,
      shared: row.ownerId === null,
      editable: this.editable(actor, row),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
