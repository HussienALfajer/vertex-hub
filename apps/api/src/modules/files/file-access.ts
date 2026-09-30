import { NotFoundException } from '@nestjs/common';
import {
  type FileItem,
  type FileItemPermissions,
  type FileOwnerRights as FileOwnerRightsResponse,
  type FileOwnerType,
  type FileVersion,
  fileTypeOf,
} from '@vertex-hub/contracts';
import { fileItems, type fileVersions } from '@vertex-hub/db';
import { and, eq, type SQL } from 'drizzle-orm';
import { CodedException } from '../../core/errors/index.js';
import type { AuditActor } from '../audit/index.js';
import type { CurrentUserInfo, UserSummary } from '../auth/index.js';
import type { FileOwner } from './file-owner-registry.js';

/*
 * Who may see and change which file (spec F10, "Roles and access" and rules 5–8, 15), and the
 * response shapes built from the rows.
 */

export type ItemRow = typeof fileItems.$inferSelect;
export type VersionRow = typeof fileVersions.$inferSelect;

export const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const OWNER_COLUMNS = {
  task: fileItems.taskId,
  client: fileItems.clientId,
  project: fileItems.projectId,
  retainer: fileItems.retainerId,
} as const;

/** The items of one owner. `client_id` is set on every item of a client, so the type filters too. */
export const ownerFilter = (type: FileOwnerType, id: string): SQL =>
  and(eq(fileItems.ownerType, type), eq(OWNER_COLUMNS[type], id)) as SQL;

/** The owner columns of a new item. */
export function ownerValues(owner: FileOwner) {
  return {
    ownerType: owner.type,
    taskId: owner.type === 'task' ? owner.id : null,
    projectId: owner.type === 'project' ? owner.id : null,
    retainerId: owner.type === 'retainer' ? owner.id : null,
    clientId: owner.clientId,
  };
}

export const ownerIdOf = (item: ItemRow): string =>
  (item.taskId ?? item.projectId ?? item.retainerId ?? item.clientId) as string;

/** What an audit entry carries so the audit screen links it to its owner. */
export const auditRefs = (item: ItemRow) => ({
  ownerType: item.ownerType,
  ownerId: ownerIdOf(item),
  clientId: item.clientId,
});

/** Rule 5: a delivered or cancelled task is read-only for files. */
export const isTaskClosed = (owner: FileOwner) =>
  owner.task?.status === 'delivered' || owner.task?.status === 'cancelled';

export const isWritable = (owner: FileOwner) => !owner.archivedCode && !isTaskClosed(owner);

/** Rules 5 and 6. Called after the rights check, so a caller without rights learns nothing. */
export function assertWritable(owner: FileOwner): void {
  if (owner.archivedCode) {
    throw new CodedException(409, owner.archivedCode, 'The owner of these files is archived');
  }
  if (isTaskClosed(owner)) {
    throw new CodedException(409, 'TASK_CLOSED', 'Reopen the task to change its files');
  }
}

/** Rule 15 and "Who reads": confidential items for their readers, removed ones for scope all. */
export const canSee = (owner: FileOwner, item: ItemRow) =>
  (!item.confidential || owner.rights.confidentialReader) &&
  (!item.archivedAt || owner.rights.scopeAll);

/** Loads nothing itself: answers 404 for an item the actor may not see. */
export function assertVisible(owner: FileOwner, item: ItemRow): void {
  if (!canSee(owner, item)) throw new NotFoundException();
}

/** Add a version and rename (the actions table). References have neither. */
export function canEdit(owner: FileOwner, item: ItemRow): boolean {
  if (item.role === 'deliverable') return owner.rights.addDeliverable;
  if (item.role === 'reference') return false;
  return owner.rights.manageDocuments;
}

export function canRemoveItem(actor: CurrentUserInfo, owner: FileOwner, item: ItemRow): boolean {
  const { rights } = owner;
  switch (item.role) {
    case 'deliverable':
      return rights.manageTask || (rights.addDeliverable && item.createdById === actor.id);
    case 'reference':
      return rights.manageTask || item.createdById === actor.id;
    default:
      return rights.manageDocuments;
  }
}

/** The right to remove a version; state (final, last) is checked apart. */
export function canRemoveVersionBy(
  actor: CurrentUserInfo,
  owner: FileOwner,
  item: ItemRow,
  version: VersionRow,
): boolean {
  const { rights } = owner;
  switch (item.role) {
    case 'deliverable':
      return rights.manageTask || (rights.addDeliverable && version.uploadedById === actor.id);
    case 'reference':
      return false;
    default:
      return rights.manageDocuments;
  }
}

/** Setting and clearing confidential: the manage right and a confidential reader (rule 15). */
export const canSetConfidential = (owner: FileOwner) =>
  owner.rights.manageDocuments && owner.rights.confidentialReader;

export function ownerRights(owner: FileOwner): FileOwnerRightsResponse {
  const writable = isWritable(owner);
  return {
    canAddDeliverable: writable && owner.type === 'task' && owner.rights.addDeliverable,
    canAddReference: writable && owner.type === 'task' && owner.rights.addReference,
    canManageDocuments: writable && owner.rights.manageDocuments,
    canSetConfidential: writable && canSetConfidential(owner),
    canSeeRemoved: owner.rights.scopeAll,
  };
}

function itemPermissions(
  actor: CurrentUserInfo,
  owner: FileOwner,
  item: ItemRow,
): FileItemPermissions {
  const live = isWritable(owner) && !item.archivedAt;
  return {
    canAddVersion: live && canEdit(owner, item),
    canRename: live && canEdit(owner, item),
    canRemove: live && canRemoveItem(actor, owner, item),
    canSetFinal:
      item.role === 'deliverable' &&
      !item.archivedAt &&
      !owner.archivedCode &&
      owner.task?.status !== 'cancelled' &&
      owner.rights.manageTask,
    canSetConfidential: live && item.role === 'document' && canSetConfidential(owner),
    canRestore: owner.rights.scopeAll && isWritable(owner),
  };
}

const person = (people: Map<string, UserSummary>, id: string) => ({
  id,
  name: people.get(id)?.name ?? '',
});

export function toVersion(
  version: VersionRow,
  people: Map<string, UserSummary>,
  canRemove: boolean,
): FileVersion {
  return {
    id: version.id,
    number: version.number,
    kind: version.kind,
    type: fileTypeOf(version.kind, version.mimeType),
    originalName: version.originalName,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    previewStatus: version.previewStatus,
    width: version.width,
    height: version.height,
    url: version.url,
    linkLabel: version.linkLabel,
    note: version.note,
    uploadedBy: person(people, version.uploadedById),
    isFinal: version.isFinal,
    finalSource: version.finalSource,
    finalMarkedBy: version.finalMarkedById ? person(people, version.finalMarkedById) : null,
    finalMarkedAt: version.finalMarkedAt?.toISOString() ?? null,
    createdAt: version.createdAt.toISOString(),
    archivedAt: version.archivedAt?.toISOString() ?? null,
    canRemove,
  };
}

/** An item with its versions, newest first, and the actor's permissions. */
export function toItem(
  actor: CurrentUserInfo,
  owner: FileOwner,
  item: ItemRow,
  versions: VersionRow[],
  people: Map<string, UserSummary>,
): FileItem {
  const permissions = itemPermissions(actor, owner, item);
  const liveCount = versions.filter((version) => !version.archivedAt).length;
  const removable = (version: VersionRow) =>
    isWritable(owner) &&
    !item.archivedAt &&
    !version.archivedAt &&
    !version.isFinal &&
    liveCount > 1 &&
    canRemoveVersionBy(actor, owner, item, version);
  return {
    id: item.id,
    ownerType: item.ownerType,
    ownerId: ownerIdOf(item),
    clientId: item.clientId,
    role: item.role,
    name: item.name,
    brandKind: item.brandKind,
    confidential: item.confidential,
    createdBy: person(people, item.createdById),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    archivedAt: item.archivedAt?.toISOString() ?? null,
    versions: [...versions]
      .sort((a, b) => b.number - a.number)
      .map((version) => toVersion(version, people, removable(version))),
    permissions,
  };
}

/** The people a list of items and versions names. */
export const peopleOf = (items: ItemRow[], versions: VersionRow[]): string[] => [
  ...items.map((item) => item.createdById),
  ...versions.flatMap((version) => [
    version.uploadedById,
    ...(version.finalMarkedById ? [version.finalMarkedById] : []),
  ]),
];
