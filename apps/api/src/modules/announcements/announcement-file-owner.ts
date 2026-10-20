import { Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  announcementRecipients,
  announcements,
  type Database,
  type Transaction,
} from '@vertex-hub/db';
import { and, eq } from 'drizzle-orm';
import type { CurrentUserInfo } from '../auth/index.js';
import { type FileOwner, FileOwnerRegistry } from '../files/index.js';
import { mayRead } from './announcement-access.js';

type Executor = Database | Transaction;

/**
 * The `announcement` owner policy of the files module (spec F16, "`announcements`"): attachments
 * are read by whoever reads the announcement, and added, renamed and removed by its author until
 * it is withdrawn. They are listed in no client library.
 */
@Injectable()
export class AnnouncementFileOwner implements OnModuleInit {
  constructor(private readonly registry: FileOwnerRegistry) {}

  onModuleInit(): void {
    this.registry.register('announcement', {
      find: (executor, actor, id, options) => this.find(executor, actor, id, options),
      ownersOfClient: async () => [],
    });
  }

  private async find(
    executor: Executor,
    actor: CurrentUserInfo,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileOwner> {
    const query = executor.select().from(announcements).where(eq(announcements.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    const [receipt] = row
      ? await executor
          .select()
          .from(announcementRecipients)
          .where(
            and(
              eq(announcementRecipients.announcementId, id),
              eq(announcementRecipients.userId, actor.id),
            ),
          )
      : [];
    if (!row || !mayRead(actor, row, receipt ?? null)) throw new NotFoundException();
    return {
      type: 'announcement',
      id,
      clientId: null,
      clientName: null,
      label: row.title,
      archivedCode: null,
      task: null,
      rights: {
        addDeliverable: false,
        addReference: false,
        manageTask: false,
        manageDocuments: row.authorId === actor.id && row.status !== 'withdrawn',
        // Attachments are never confidential: every reader sees them all.
        confidentialReader: true,
        scopeAll: false,
      },
    };
  }
}
