import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  BUSINESS_TIME_ZONE,
  type ClientDocumentsQuery,
  type FileItemPage,
  type FileLibraryPage,
  type FileLibraryQuery,
  type FileType,
  type FileUsage,
  type FileUsageQuery,
  permissionScopes,
} from '@vertex-hub/contracts';
import { type Database, fileItems, fileUploads, fileVersions } from '@vertex-hub/db';
import { and, count, desc, eq, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { ownerIdOf, peopleOf, toVersion } from './file-access.js';
import { type FileOwner, FileOwnerRegistry } from './file-owner-registry.js';
import { FileStorage } from './file-storage.js';
import { FilesService } from './files.service.js';

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The library's type filter (rule 13) as SQL on versions. */
function typeFilter(type: FileType): SQL {
  const image = sql`${fileVersions.mimeType} like 'image/%'`;
  const video = sql`${fileVersions.mimeType} like 'video/%'`;
  const pdf = sql`${fileVersions.mimeType} = 'application/pdf'`;
  switch (type) {
    case 'link':
      return eq(fileVersions.kind, 'link');
    case 'image':
      return and(eq(fileVersions.kind, 'upload'), image) as SQL;
    case 'video':
      return and(eq(fileVersions.kind, 'upload'), video) as SQL;
    case 'pdf':
      return and(eq(fileVersions.kind, 'upload'), pdf) as SQL;
    case 'other':
      return sql`${fileVersions.kind} = 'upload' and not (${image} or ${video} or ${pdf})`;
  }
}

/**
 * The client's files (spec F10 rules 13, 14, 19): the library of final deliverables, the
 * documents of the client, its projects and retainers, and storage usage.
 */
@Injectable()
export class FileLibraryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly owners: FileOwnerRegistry,
    private readonly users: UserDirectory,
    private readonly files: FilesService,
    private readonly storage: FileStorage,
  ) {}

  async library(actor: CurrentUserInfo, query: FileLibraryQuery): Promise<FileLibraryPage> {
    await this.owners.policy('client').find(this.db, actor, query.clientId);
    const tasks = await this.owners.policy('task').ownersOfClient(this.db, query.clientId);
    const titles = new Map(tasks.map((task) => [task.id, task.label]));
    const search = query.q?.toLocaleLowerCase('ar');
    const titleMatches = search
      ? tasks.filter((task) => task.label.toLocaleLowerCase('ar').includes(search))
      : [];
    const where = and(
      eq(fileItems.clientId, query.clientId),
      eq(fileItems.role, 'deliverable'),
      isNull(fileItems.archivedAt),
      inArray(
        fileItems.taskId,
        tasks.map((task) => task.id),
      ),
      eq(fileVersions.isFinal, true),
      isNull(fileVersions.archivedAt),
      query.type ? typeFilter(query.type) : undefined,
      query.month
        ? sql`to_char(${fileVersions.finalMarkedAt} at time zone ${BUSINESS_TIME_ZONE}, 'YYYY-MM') = ${query.month}`
        : undefined,
      query.q
        ? or(
            ilike(fileItems.name, `%${escapeLike(query.q)}%`),
            inArray(
              fileItems.taskId,
              titleMatches.map((task) => task.id),
            ),
          )
        : undefined,
    );
    const from = () =>
      this.db
        .select({ item: fileItems, version: fileVersions })
        .from(fileVersions)
        .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId));
    const [rows, [total]] = await Promise.all([
      from()
        .where(where)
        .orderBy(desc(fileVersions.finalMarkedAt), desc(fileVersions.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ count: count() })
        .from(fileVersions)
        .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
        .where(where),
    ]);
    const people = await this.users.summaries(
      peopleOf(
        [],
        rows.map((row) => row.version),
      ),
    );
    return {
      items: rows.map(({ item, version }) => ({
        itemId: item.id,
        itemName: item.name,
        task: { id: item.taskId as string, title: titles.get(item.taskId as string) ?? '' },
        version: toVersion(version, people, false),
      })),
      total: total?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async documents(actor: CurrentUserInfo, query: ClientDocumentsQuery): Promise<FileItemPage> {
    const client = await this.owners.policy('client').find(this.db, actor, query.clientId);
    const [projects, retainers] = await Promise.all([
      this.owners.policy('project').ownersOfClient(this.db, query.clientId),
      this.owners.policy('retainer').ownersOfClient(this.db, query.clientId),
    ]);
    const labels = new Map([
      [client.id, client.label],
      ...projects.map((owner) => [owner.id, owner.label] as const),
      ...retainers.map((owner) => [owner.id, owner.label] as const),
    ]);
    const where = and(
      eq(fileItems.role, 'document'),
      isNull(fileItems.archivedAt),
      or(
        and(eq(fileItems.ownerType, 'client'), eq(fileItems.clientId, query.clientId)),
        inArray(
          fileItems.projectId,
          projects.map((owner) => owner.id),
        ),
        inArray(
          fileItems.retainerId,
          retainers.map((owner) => owner.id),
        ),
      ),
      // Confidential readers are the client's (rule 15), whichever owner holds the document.
      client.rights.confidentialReader ? undefined : eq(fileItems.confidential, false),
    );
    const [items, [total]] = await Promise.all([
      this.db
        .select()
        .from(fileItems)
        .where(where)
        .orderBy(desc(fileItems.updatedAt), desc(fileItems.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ count: count() }).from(fileItems).where(where),
    ]);

    const owners = new Map<string, FileOwner>([[client.id, client]]);
    for (const item of items) {
      const id = ownerIdOf(item);
      if (!owners.has(id)) {
        owners.set(id, await this.owners.policy(item.ownerType).find(this.db, actor, id));
      }
    }
    const responses = [];
    for (const item of items) {
      const owner = owners.get(ownerIdOf(item)) as FileOwner;
      const [response] = await this.files.toItems(this.db, actor, owner, [item], false);
      if (response) {
        responses.push({
          ...response,
          owner: { type: item.ownerType, id: owner.id, label: labels.get(owner.id) ?? owner.label },
        });
      }
    }
    return {
      items: responses,
      total: total?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Rule 19: removed versions count, they stay on disk; pending uploads count in the total. */
  async usage(actor: CurrentUserInfo, query: FileUsageQuery): Promise<FileUsage> {
    if (!permissionScopes(actor.access, 'clients.manage').includes('all')) {
      throw new ForbiddenException();
    }
    const bytes = sql<number>`coalesce(sum(${fileVersions.sizeBytes}), 0)`.mapWith(Number);
    const [[versions], [uploads], clientRow, freeBytes] = await Promise.all([
      this.db.select({ bytes }).from(fileVersions),
      this.db
        .select({ bytes: sql<number>`coalesce(sum(${fileUploads.sizeBytes}), 0)`.mapWith(Number) })
        .from(fileUploads),
      query.clientId
        ? this.db
            .select({ bytes })
            .from(fileVersions)
            .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
            .where(eq(fileItems.clientId, query.clientId))
        : Promise.resolve(null),
      this.storage.freeBytes(),
    ]);
    return {
      clientBytes: clientRow ? (clientRow[0]?.bytes ?? 0) : null,
      totalBytes: (versions?.bytes ?? 0) + (uploads?.bytes ?? 0),
      freeBytes,
    };
  }
}
