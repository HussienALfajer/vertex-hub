import { Injectable } from '@nestjs/common';
import {
  type ErrorCode,
  type FileOwnerType,
  type NotificationData,
  permissionScopes,
  type TaskStatus,
} from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import type { CurrentUserInfo } from '../auth/index.js';

type Executor = Database | Transaction;

/** What the actor may do with the files of one owner (spec F10, "F10 actions"). */
export interface FileOwnerRights {
  /** Task workers and manage scope, or a post's edit scope: add, version and rename deliverables. */
  addDeliverable: boolean;
  /** Every reader of a task. */
  addReference: boolean;
  /** A task's manage scope or a post's edit scope: remove anyone's files; on tasks, the final marker. */
  manageTask: boolean;
  /** Brand files and documents of this owner. */
  manageDocuments: boolean;
  /** Sees and flags confidential documents of the owner's client. */
  confidentialReader: boolean;
  /** Scope `all` of the owner's manage permission: sees removed files and restores them. */
  scopeAll: boolean;
}

/** An owner as one actor sees it. */
export interface FileOwner {
  type: FileOwnerType;
  id: string;
  clientId: string | null;
  /** The client's trade name, for download names; null for an internal task. */
  clientName: string | null;
  /** Task or post title, client, project or retainer name. */
  label: string;
  /** The owner or a record above it is archived: every change answers this code. */
  archivedCode: Extract<
    ErrorCode,
    'TASK_ARCHIVED' | 'CLIENT_ARCHIVED' | 'PROJECT_ARCHIVED' | 'RETAINER_ARCHIVED' | 'POST_ARCHIVED'
  > | null;
  /** For tasks: the status (rule 5) and what the `task_file_added` notification needs. */
  task: {
    status: TaskStatus;
    assigneeId: string | null;
    snapshot: NotificationData<'task_file_added'>['task'];
    /**
     * Versions of the snapshot under medical review or with the client (F09 edge case 4): they
     * are not removed until the task is withdrawn for re-review (`VERSION_SENT`).
     */
    sentVersionIds: readonly string[];
  } | null;
  /** For posts (F08): files change only while the content is unlocked (`POST_LOCKED`). */
  post?: { locked: boolean };
  rights: FileOwnerRights;
}

/** An owner of a client, with its label. */
export interface ClientOwner {
  id: string;
  label: string;
}

/**
 * Registered by the module that owns an owner type (ADR 0019), so `files` never imports it.
 */
export interface FileOwnerPolicy {
  /**
   * The owner as `actor` sees it; throws 404 when they may not read it (an archived owner is for
   * scope-all holders). `forUpdate` locks the owner row, so its state holds until commit.
   */
  find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options?: { forUpdate?: boolean },
  ): Promise<FileOwner>;
  /**
   * The live owners of this type under a client: non-archived, non-cancelled tasks for the
   * library (rule 13); the client itself, or its non-archived projects and retainers, for the
   * documents list (rule 14).
   */
  ownersOfClient(executor: Executor, clientId: string): Promise<ClientOwner[]>;
}

/** The owner policies, one per owner type. */
@Injectable()
export class FileOwnerRegistry {
  private readonly policies = new Map<FileOwnerType, FileOwnerPolicy>();

  register(type: FileOwnerType, policy: FileOwnerPolicy): void {
    this.policies.set(type, policy);
  }

  policy(type: FileOwnerType): FileOwnerPolicy {
    const policy = this.policies.get(type);
    if (!policy) throw new Error(`No file owner policy for ${type}`);
    return policy;
  }
}

/**
 * A confidential reader of a client (spec F10, "Who reads"): `clients.manage` covering it (scope
 * all, or its primary account manager while it is live) or `invoices.read` covering it.
 */
export function isConfidentialReader(
  actor: CurrentUserInfo,
  client: { accountManagerId: string; archived: boolean },
): boolean {
  const manage = permissionScopes(actor.access, 'clients.manage');
  const invoices = permissionScopes(actor.access, 'invoices.read');
  const ownsClient = client.accountManagerId === actor.id;
  return (
    manage.includes('all') ||
    (manage.includes('own_clients') && ownsClient && !client.archived) ||
    invoices.includes('all') ||
    (invoices.includes('own_clients') && ownsClient)
  );
}
