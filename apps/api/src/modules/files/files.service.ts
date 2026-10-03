import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateFileItem,
  type CreateFileVersion,
  defaultFileItemName,
  FILE_LIMITS,
  FILE_PREVIEW_MAX_BYTES,
  FILES_PREVIEW_JOB,
  type FileItem,
  type FileItemList,
  type FileItemListQuery,
  type FileRole,
  type FileSource,
  isPreviewableMimeType,
  POST_LIMITS,
  type SetFinal,
  type UpdateFileItem,
} from '@vertex-hub/contracts';
import {
  type Database,
  fileItems,
  fileUploads,
  fileVersions,
  type Transaction,
} from '@vertex-hub/db';
import { and, count, desc, eq, inArray, isNull, max, ne, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { JobQueue } from '../../core/jobs/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import {
  actorOf,
  assertNotSent,
  assertVisible,
  assertWritable,
  auditRefs,
  canEdit,
  canRemoveItem,
  canRemoveVersionBy,
  canSetConfidential,
  type ItemRow,
  ownerFilter,
  ownerRights,
  ownerValues,
  peopleOf,
  toItem,
  type VersionRow,
} from './file-access.js';
import { type FileOwner, FileOwnerRegistry } from './file-owner-registry.js';

type Executor = Database | Transaction;

/** What a new version stores from its source (rule 2). */
type SourceValues = Pick<
  typeof fileVersions.$inferInsert,
  | 'kind'
  | 'storageKey'
  | 'originalName'
  | 'mimeType'
  | 'sizeBytes'
  | 'sha256'
  | 'width'
  | 'height'
  | 'previewStatus'
  | 'url'
  | 'linkLabel'
>;

/**
 * Items and versions (spec F10 rules 2–11, 15): attach, version, rename, remove, restore, the
 * manual final marker. Owners are read through the policies their modules register.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly owners: FileOwnerRegistry,
    private readonly users: UserDirectory,
    private readonly center: NotificationCenter,
    private readonly jobs: JobQueue,
  ) {}

  async list(actor: CurrentUserInfo, query: FileItemListQuery): Promise<FileItemList> {
    const owner = await this.owners.policy(query.ownerType).find(this.db, actor, query.ownerId);
    const includeArchived = !!query.includeArchived && owner.rights.scopeAll;
    const items = await this.db
      .select()
      .from(fileItems)
      .where(
        and(
          ownerFilter(owner.type, owner.id),
          query.role ? eq(fileItems.role, query.role) : undefined,
          includeArchived ? undefined : isNull(fileItems.archivedAt),
          owner.rights.confidentialReader ? undefined : eq(fileItems.confidential, false),
        ),
      )
      .orderBy(desc(fileItems.createdAt), desc(fileItems.id));
    return {
      items: await this.toItems(this.db, actor, owner, items, includeArchived),
      rights: ownerRights(owner),
    };
  }

  async create(actor: CurrentUserInfo, input: CreateFileItem): Promise<FileItem> {
    const { id, preview } = await this.db.transaction(async (tx) => {
      const owner = await this.owners
        .policy(input.ownerType)
        .find(tx, actor, input.ownerId, { forUpdate: true });
      this.assertMayAdd(owner, input.role);
      if (input.confidential && !canSetConfidential(owner)) {
        throw new CodedException(
          403,
          'NOT_CONFIDENTIAL_READER',
          'Only confidential readers flag documents',
        );
      }
      assertWritable(owner);
      assertSourceAllowed(input.role, input.source);
      await this.assertItemLimit(tx, owner, input.role);

      const source = await this.takeSource(tx, actor, input.source);
      const name =
        input.name ??
        defaultFileItemName(
          source.kind === 'upload'
            ? { originalName: source.originalName as string }
            : { url: source.url as string, label: source.linkLabel ?? null },
        );
      if (input.role !== 'reference') {
        await this.assertNameFree(tx, owner, input.role, name);
      }
      const [item] = await tx
        .insert(fileItems)
        .values({
          ...ownerValues(owner),
          role: input.role,
          name,
          brandKind: input.brandKind ?? null,
          confidential: input.confidential,
          createdById: actor.id,
        })
        .returning();
      if (!item) throw new Error('File item not created');
      const note = input.note ?? null;
      await tx
        .insert(fileVersions)
        .values({ fileItemId: item.id, number: 1, ...source, note, uploadedById: actor.id });
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_item.created',
        entityType: 'file_item',
        entityId: item.id,
        after: {
          ...auditRefs(item),
          role: item.role,
          name,
          ...(item.brandKind && { brandKind: item.brandKind }),
          ...(item.confidential && { confidential: true }),
          ...versionAudit(1, source, note),
        },
      });
      await this.notifyFileAdded(tx, actor, owner, name);
      return { id: item.id, preview: source.previewStatus === 'pending' };
    });
    if (preview) await this.jobs.send(FILES_PREVIEW_JOB.queue);
    return this.detail(actor, id);
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateFileItem): Promise<FileItem> {
    await this.db.transaction(async (tx) => {
      const { item, owner } = await this.load(tx, actor, id);
      if (item.archivedAt) throw new NotFoundException();
      const renames = input.name !== undefined || input.brandKind !== undefined;
      if (renames && !canEdit(owner, item)) throw new ForbiddenException();
      if (input.brandKind !== undefined && item.role !== 'brand') {
        throw new BadRequestException('Only brand files have a kind');
      }
      if (input.confidential !== undefined) {
        if (item.role !== 'document') {
          throw new BadRequestException('Only documents can be confidential');
        }
        if (!owner.rights.manageDocuments) throw new ForbiddenException();
        if (!canSetConfidential(owner)) {
          throw new CodedException(
            403,
            'NOT_CONFIDENTIAL_READER',
            'Only confidential readers flag documents',
          );
        }
      }
      assertWritable(owner);

      const names = changedFields(
        { name: item.name, brandKind: item.brandKind },
        { name: input.name, brandKind: input.brandKind },
      );
      const confidential = changedFields(
        { confidential: item.confidential },
        { confidential: input.confidential },
      );
      if (!names && !confidential) return;
      if (names?.after.name !== undefined && item.role !== 'reference') {
        await this.assertNameFree(tx, owner, item.role, names.after.name, item.id);
      }
      await tx
        .update(fileItems)
        .set({ ...names?.after, ...confidential?.after })
        .where(eq(fileItems.id, id));
      if (names) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'file_item.renamed',
          entityType: 'file_item',
          entityId: id,
          before: names.before,
          after: { ...auditRefs(item), ...names.after },
        });
      }
      if (confidential) {
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'file_item.confidential_changed',
          entityType: 'file_item',
          entityId: id,
          before: confidential.before,
          after: { ...auditRefs(item), ...confidential.after },
        });
      }
    });
    return this.detail(actor, id);
  }

  async addVersion(
    actor: CurrentUserInfo,
    id: string,
    input: CreateFileVersion,
  ): Promise<FileItem> {
    const preview = await this.db.transaction(async (tx) => {
      // Rule 3: the item row lock gives concurrent versions consecutive numbers.
      const { item, owner } = await this.load(tx, actor, id, { forUpdate: true });
      if (item.archivedAt) throw new NotFoundException();
      if (item.role === 'reference') {
        throw new CodedException(409, 'NOT_VERSIONED', 'References have one version');
      }
      if (!canEdit(owner, item)) throw new ForbiddenException();
      assertWritable(owner);
      const [counts] = await tx
        .select({
          live: sql<number>`count(*) filter (where ${fileVersions.archivedAt} is null)`.mapWith(
            Number,
          ),
          highest: max(fileVersions.number),
        })
        .from(fileVersions)
        .where(eq(fileVersions.fileItemId, id));
      if ((counts?.live ?? 0) >= FILE_LIMITS.versions) throw limitReached();
      const number = (counts?.highest ?? 0) + 1;

      const source = await this.takeSource(tx, actor, input.source);
      const note = input.note ?? null;
      await tx
        .insert(fileVersions)
        .values({ fileItemId: id, number, ...source, note, uploadedById: actor.id });
      await tx.update(fileItems).set({ updatedAt: new Date() }).where(eq(fileItems.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_version.created',
        entityType: 'file_item',
        entityId: id,
        after: { ...auditRefs(item), ...versionAudit(number, source, note) },
      });
      await this.notifyFileAdded(tx, actor, owner, item.name);
      return source.previewStatus === 'pending';
    });
    if (preview) await this.jobs.send(FILES_PREVIEW_JOB.queue);
    return this.detail(actor, id);
  }

  /** Rule 7: removing an item archives it; its versions stay as they are. */
  async archiveItem(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { item, owner } = await this.load(tx, actor, id, { forUpdate: true });
      if (item.archivedAt) throw new NotFoundException();
      if (!canRemoveItem(actor, owner, item)) throw new ForbiddenException();
      assertWritable(owner);
      const versions = await tx
        .select({ id: fileVersions.id })
        .from(fileVersions)
        .where(eq(fileVersions.fileItemId, id));
      assertNotSent(
        owner,
        versions.map((version) => version.id),
      );
      await tx.update(fileItems).set({ archivedAt: new Date() }).where(eq(fileItems.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_item.archived',
        entityType: 'file_item',
        entityId: id,
        after: { ...auditRefs(item), name: item.name },
      });
    });
  }

  /** Rule 8: scope all restores, if the name is free and the limit allows. */
  async restoreItem(actor: CurrentUserInfo, id: string): Promise<FileItem> {
    await this.db.transaction(async (tx) => {
      const { item, owner } = await this.load(tx, actor, id, { forUpdate: true });
      if (!owner.rights.scopeAll) throw new ForbiddenException();
      assertWritable(owner);
      if (!item.archivedAt) return;
      await this.assertItemLimit(tx, owner, item.role);
      if (item.role !== 'reference') {
        await this.assertNameFree(tx, owner, item.role, item.name, item.id);
      }
      await tx.update(fileItems).set({ archivedAt: null }).where(eq(fileItems.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_item.restored',
        entityType: 'file_item',
        entityId: id,
        after: { ...auditRefs(item), name: item.name },
      });
    });
    return this.detail(actor, id);
  }

  /** Rule 7: never the last live version, never the final one, never one that is sent (F09). */
  async archiveVersion(actor: CurrentUserInfo, versionId: string): Promise<FileItem> {
    const itemId = await this.db.transaction(async (tx) => {
      const { item, owner, version } = await this.loadVersion(tx, actor, versionId);
      if (item.archivedAt || version.archivedAt) throw new NotFoundException();
      if (!canRemoveVersionBy(actor, owner, item, version)) throw new ForbiddenException();
      assertWritable(owner);
      if (version.isFinal) {
        throw new CodedException(409, 'VERSION_FINAL', 'Clear the final marker first');
      }
      assertNotSent(owner, [versionId]);
      const [live] = await tx
        .select({ count: count() })
        .from(fileVersions)
        .where(and(eq(fileVersions.fileItemId, item.id), isNull(fileVersions.archivedAt)));
      if ((live?.count ?? 0) <= 1) {
        throw new CodedException(409, 'LAST_VERSION', 'Remove the file instead');
      }
      await tx
        .update(fileVersions)
        .set({ archivedAt: new Date() })
        .where(eq(fileVersions.id, versionId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_version.archived',
        entityType: 'file_item',
        entityId: item.id,
        after: { ...auditRefs(item), number: version.number },
      });
      return item.id;
    });
    return this.detail(actor, itemId);
  }

  async restoreVersion(actor: CurrentUserInfo, versionId: string): Promise<FileItem> {
    const itemId = await this.db.transaction(async (tx) => {
      const { item, owner, version } = await this.loadVersion(tx, actor, versionId);
      if (!owner.rights.scopeAll) throw new ForbiddenException();
      assertWritable(owner);
      if (!version.archivedAt) return item.id;
      const [live] = await tx
        .select({ count: count() })
        .from(fileVersions)
        .where(and(eq(fileVersions.fileItemId, item.id), isNull(fileVersions.archivedAt)));
      if ((live?.count ?? 0) >= FILE_LIMITS.versions) throw limitReached();
      await tx.update(fileVersions).set({ archivedAt: null }).where(eq(fileVersions.id, versionId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_version.restored',
        entityType: 'file_item',
        entityId: item.id,
        after: { ...auditRefs(item), number: version.number },
      });
      return item.id;
    });
    return this.detail(actor, itemId);
  }

  /** Rule 10: manage scope sets the marker on an approved or delivered task, or clears it. */
  async setFinal(actor: CurrentUserInfo, versionId: string, input: SetFinal): Promise<FileItem> {
    const itemId = await this.db.transaction(async (tx) => {
      const { item, owner, version } = await this.loadVersion(tx, actor, versionId);
      // Post files carry no final marker (F08): the linked tasks' versions do.
      if (item.role !== 'deliverable' || owner.type === 'post') {
        throw new CodedException(400, 'NOT_DELIVERABLE', 'Only task deliverables are marked final');
      }
      if (item.archivedAt || version.archivedAt) throw new NotFoundException();
      if (!owner.rights.manageTask) throw new ForbiddenException();
      if (owner.archivedCode) {
        throw new CodedException(409, owner.archivedCode, 'The task is archived');
      }
      const status = owner.task?.status;
      if (status === 'cancelled') {
        throw new CodedException(409, 'TASK_CLOSED', 'The task is cancelled');
      }
      if (!input.final) {
        if (!version.isFinal) return item.id;
        await tx.update(fileVersions).set(NOT_FINAL).where(eq(fileVersions.id, versionId));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'file_version.final_cleared',
          entityType: 'file_item',
          entityId: item.id,
          before: { number: version.number, source: version.finalSource },
          after: auditRefs(item),
        });
        return item.id;
      }
      if (status !== 'approved' && status !== 'delivered') {
        throw new CodedException(409, 'TASK_NOT_APPROVED', 'Approve the task first');
      }
      if (version.isFinal && version.finalSource === 'manual') return item.id;
      const previous = await clearFinal(tx, item.id);
      await tx
        .update(fileVersions)
        .set({
          isFinal: true,
          finalSource: 'manual',
          finalMarkedById: actor.id,
          finalMarkedAt: new Date(),
        })
        .where(eq(fileVersions.id, versionId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'file_version.final_set',
        entityType: 'file_item',
        entityId: item.id,
        after: {
          ...auditRefs(item),
          number: version.number,
          source: 'manual',
          previousFinal: previous,
        },
      });
      return item.id;
    });
    return this.detail(actor, itemId);
  }

  /** One item as the actor sees it; removed versions only for scope all. */
  async detail(actor: CurrentUserInfo, id: string): Promise<FileItem> {
    const { item, owner } = await this.load(this.db, actor, id);
    const [response] = await this.toItems(this.db, actor, owner, [item], owner.rights.scopeAll);
    if (!response) throw new NotFoundException();
    return response;
  }

  /** Items with their versions, as responses. */
  async toItems(
    executor: Executor,
    actor: CurrentUserInfo,
    owner: FileOwner,
    items: ItemRow[],
    includeArchived: boolean,
  ): Promise<FileItem[]> {
    if (items.length === 0) return [];
    const versions = await executor
      .select()
      .from(fileVersions)
      .where(
        and(
          inArray(
            fileVersions.fileItemId,
            items.map((item) => item.id),
          ),
          includeArchived ? undefined : isNull(fileVersions.archivedAt),
        ),
      );
    const people = await this.users.summaries(peopleOf(items, versions), executor);
    const byItem = new Map<string, VersionRow[]>();
    for (const version of versions) {
      byItem.set(version.fileItemId, [...(byItem.get(version.fileItemId) ?? []), version]);
    }
    return items.map((item) => toItem(actor, owner, item, byItem.get(item.id) ?? [], people));
  }

  /** An item the actor may see, with its owner, else 404. The owner row is locked first. */
  private async load(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<{ item: ItemRow; owner: FileOwner }> {
    const [found] = await executor
      .select({ ownerType: fileItems.ownerType, ownerId: ownerIdSql })
      .from(fileItems)
      .where(eq(fileItems.id, id));
    if (!found) throw new NotFoundException();
    const owner = await this.owners
      .policy(found.ownerType)
      .find(executor, actor, found.ownerId, { forUpdate: options.forUpdate });
    const query = executor.select().from(fileItems).where(eq(fileItems.id, id));
    const [item] = options.forUpdate ? await query.for('update') : await query;
    if (!item) throw new NotFoundException();
    assertVisible(owner, item);
    return { item, owner };
  }

  private async loadVersion(tx: Transaction, actor: CurrentUserInfo, versionId: string) {
    const [found] = await tx
      .select({ itemId: fileVersions.fileItemId })
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId));
    if (!found) throw new NotFoundException();
    const { item, owner } = await this.load(tx, actor, found.itemId, { forUpdate: true });
    const [version] = await tx.select().from(fileVersions).where(eq(fileVersions.id, versionId));
    if (!version) throw new NotFoundException();
    return { item, owner, version };
  }

  private assertMayAdd(owner: FileOwner, role: FileRole): void {
    const allowed =
      role === 'deliverable'
        ? owner.rights.addDeliverable
        : role === 'reference'
          ? owner.rights.addReference
          : owner.rights.manageDocuments;
    if (!allowed) throw new ForbiddenException();
  }

  private async assertItemLimit(tx: Transaction, owner: FileOwner, role: FileRole) {
    const [live] = await tx
      .select({ count: count() })
      .from(fileItems)
      .where(
        and(
          ownerFilter(owner.type, owner.id),
          eq(fileItems.role, role),
          isNull(fileItems.archivedAt),
        ),
      );
    // A post holds fewer files than a task (F08 edge case 14).
    const limit = owner.type === 'post' ? POST_LIMITS.files : FILE_LIMITS[role];
    if ((live?.count ?? 0) >= limit) throw limitReached();
  }

  /** Names are unique per owner and role among live items, regardless of case (data table). */
  private async assertNameFree(
    tx: Transaction,
    owner: FileOwner,
    role: FileRole,
    name: string,
    exceptId?: string,
  ) {
    const [taken] = await tx
      .select({ id: fileItems.id })
      .from(fileItems)
      .where(
        and(
          ownerFilter(owner.type, owner.id),
          eq(fileItems.role, role),
          isNull(fileItems.archivedAt),
          sql`lower(${fileItems.name}) = lower(${name})`,
          exceptId ? ne(fileItems.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    if (taken) {
      throw new CodedException(409, 'FILE_NAME_TAKEN', 'A file with this name exists here');
    }
  }

  /** Rule 2: an upload of the actor, used once, or a link. */
  private async takeSource(
    tx: Transaction,
    actor: CurrentUserInfo,
    source: FileSource,
  ): Promise<SourceValues> {
    if (!('uploadId' in source)) {
      return {
        kind: 'link',
        url: source.url,
        linkLabel: source.label ?? null,
        previewStatus: 'none',
      };
    }
    const [upload] = await tx
      .delete(fileUploads)
      .where(and(eq(fileUploads.id, source.uploadId), eq(fileUploads.userId, actor.id)))
      .returning();
    if (!upload) {
      throw new CodedException(400, 'UPLOAD_NOT_FOUND', 'Upload the file again');
    }
    return {
      kind: 'upload',
      storageKey: upload.storageKey,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      width: upload.width,
      height: upload.height,
      previewStatus:
        isPreviewableMimeType(upload.mimeType) && upload.sizeBytes <= FILE_PREVIEW_MAX_BYTES
          ? 'pending'
          : 'none',
    };
  }

  /** `task_file_added` for the task's assignee, when someone else adds a file. */
  private async notifyFileAdded(
    tx: Transaction,
    actor: CurrentUserInfo,
    owner: FileOwner,
    file: string,
  ) {
    if (!owner.task?.assigneeId) return;
    await this.center.notify(tx, {
      type: 'task_file_added',
      data: { task: owner.task.snapshot, file },
      recipients: [owner.task.assigneeId],
      actorId: actor.id,
      subjectId: owner.id,
    });
  }
}

/** The owner id of an item row, in SQL. */
const ownerIdSql = sql<string>`coalesce(${fileItems.taskId}, ${fileItems.projectId}, ${fileItems.retainerId}, ${fileItems.postId}, ${fileItems.quoteId}, ${fileItems.invoiceId}, ${fileItems.clientId})`;

export const NOT_FINAL = {
  isFinal: false,
  finalSource: null,
  finalMarkedById: null,
  finalMarkedAt: null,
} as const;

/** Clears the live final version of an item; returns its number, or null. */
export async function clearFinal(tx: Transaction, itemId: string): Promise<number | null> {
  const [previous] = await tx
    .update(fileVersions)
    .set(NOT_FINAL)
    .where(
      and(
        eq(fileVersions.fileItemId, itemId),
        eq(fileVersions.isFinal, true),
        isNull(fileVersions.archivedAt),
      ),
    )
    .returning({ number: fileVersions.number });
  return previous?.number ?? null;
}

/** A version in an audit entry: links keep their host only, never the full URL (as F06). */
function versionAudit(number: number, source: SourceValues, note: string | null) {
  return {
    number,
    kind: source.kind,
    ...(source.kind === 'upload'
      ? { sizeBytes: source.sizeBytes }
      : { host: new URL(source.url as string).host }),
    ...(note && { note }),
  };
}

function assertSourceAllowed(role: FileRole, source: FileSource): void {
  if (role === 'reference' && !('uploadId' in source)) {
    throw new CodedException(400, 'LINK_NOT_ALLOWED', 'References are uploads');
  }
}

const limitReached = () => new CodedException(409, 'LIMIT_REACHED', 'The limit is reached');
