import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateNote, Note, NoteListQuery, NotePage, UpdateNote } from '@vertex-hub/contracts';
import { clientContacts, clientNotes, type Database, type Transaction } from '@vertex-hub/db';
import { and, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory, type UserSummary } from '../auth/index.js';
import {
  actorOf,
  assertNotArchived,
  type ClientAccessRow,
  covers,
  holdsAll,
  readableClient,
} from './client-access.js';

const noteColumns = {
  id: clientNotes.id,
  clientId: clientNotes.clientId,
  authorId: clientNotes.authorId,
  occurredAt: clientNotes.occurredAt,
  channel: clientNotes.channel,
  contactId: clientNotes.contactId,
  summary: clientNotes.summary,
  archivedAt: clientNotes.archivedAt,
  contactName: clientContacts.name,
  contactArchivedAt: clientContacts.archivedAt,
};

type NoteRow = {
  id: string;
  clientId: string;
  authorId: string;
  occurredAt: Date;
  channel: Note['channel'];
  contactId: string | null;
  summary: string;
  archivedAt: Date | null;
  contactName: string | null;
  contactArchivedAt: Date | null;
};

/** The communication log: notes any staff member writes about a client (rules 10–11). */
@Injectable()
export class ClientNotesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
  ) {}

  async list(actor: CurrentUserInfo, clientId: string, query: NoteListQuery): Promise<NotePage> {
    const client = await readableClient(this.db, actor, clientId);
    const filters: SQL[] = [eq(clientNotes.clientId, clientId), isNull(clientNotes.archivedAt)];
    if (query.channel) filters.push(eq(clientNotes.channel, query.channel));
    if (query.contactId) filters.push(eq(clientNotes.contactId, query.contactId));
    if (query.authorId) filters.push(eq(clientNotes.authorId, query.authorId));
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select(noteColumns)
        .from(clientNotes)
        .leftJoin(clientContacts, eq(clientContacts.id, clientNotes.contactId))
        .where(where)
        .orderBy(desc(clientNotes.occurredAt), desc(clientNotes.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(clientNotes).where(where),
    ]);
    const authors = await this.users.summaries(rows.map((row) => row.authorId));
    return {
      items: rows.map((row) => toNote(actor, client, row, authors)),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(actor: CurrentUserInfo, clientId: string, input: CreateNote): Promise<Note> {
    const client = await this.db.transaction(async (tx) => {
      const client = await this.writableClient(tx, actor, clientId);
      const contactId = input.contactId ?? null;
      if (contactId) await this.assertContactOf(tx, clientId, contactId);
      const values = {
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
        channel: input.channel,
        contactId,
        summary: input.summary,
      };
      const [note] = await tx
        .insert(clientNotes)
        .values({ clientId, authorId: actor.id, ...values })
        .returning({ id: clientNotes.id });
      if (!note) throw new Error('Note insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_note.created',
        entityType: 'client_note',
        entityId: note.id,
        after: { clientId, ...values, occurredAt: values.occurredAt.toISOString() },
      });
      return { ...client, noteId: note.id };
    });
    return this.note(actor, client, client.noteId);
  }

  async update(
    actor: CurrentUserInfo,
    clientId: string,
    noteId: string,
    input: UpdateNote,
  ): Promise<Note> {
    const client = await this.db.transaction(async (tx) => {
      const client = await this.writableClient(tx, actor, clientId);
      const current = await this.lockedNote(tx, clientId, noteId);
      if (current.authorId !== actor.id) {
        throw new CodedException(403, 'NOT_NOTE_AUTHOR', 'Only the author edits a note');
      }
      assertNoteNotArchived(current);
      if (input.contactId && input.contactId !== current.contactId) {
        await this.assertContactOf(tx, clientId, input.contactId);
      }
      const change = changedFields(
        {
          occurredAt: current.occurredAt.toISOString(),
          channel: current.channel,
          contactId: current.contactId,
          summary: current.summary,
        },
        {
          ...input,
          occurredAt: input.occurredAt && new Date(input.occurredAt).toISOString(),
        },
      );
      if (change) {
        const { occurredAt, ...rest } = change.after;
        await tx
          .update(clientNotes)
          .set({ ...rest, ...(occurredAt && { occurredAt: new Date(occurredAt) }) })
          .where(eq(clientNotes.id, noteId));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'client_note.updated',
          entityType: 'client_note',
          entityId: noteId,
          before: change.before,
          after: { clientId, ...change.after },
        });
      }
      return client;
    });
    return this.note(actor, client, noteId);
  }

  /** Withdraws a note: its author, or a `clients.manage` scope-all holder (rule 11). */
  async archive(actor: CurrentUserInfo, clientId: string, noteId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.writableClient(tx, actor, clientId);
      const current = await this.lockedNote(tx, clientId, noteId);
      if (current.authorId !== actor.id && !holdsAll(actor, 'clients.manage')) {
        throw new CodedException(403, 'NOT_NOTE_AUTHOR', 'Only the author archives a note');
      }
      assertNoteNotArchived(current);
      await tx
        .update(clientNotes)
        .set({ archivedAt: new Date() })
        .where(eq(clientNotes.id, noteId));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'client_note.archived',
        entityType: 'client_note',
        entityId: noteId,
        before: { summary: current.summary },
        after: { clientId },
      });
    });
  }

  /** A readable, non-archived client covered by `clients.log`. */
  private async writableClient(
    tx: Transaction,
    actor: CurrentUserInfo,
    clientId: string,
  ): Promise<ClientAccessRow> {
    const client = await readableClient(tx, actor, clientId, { forUpdate: true });
    assertNotArchived(client);
    if (!covers(actor, 'clients.log', client)) throw new ForbiddenException();
    return client;
  }

  private async lockedNote(tx: Transaction, clientId: string, noteId: string) {
    const [note] = await tx
      .select({
        authorId: clientNotes.authorId,
        occurredAt: clientNotes.occurredAt,
        channel: clientNotes.channel,
        contactId: clientNotes.contactId,
        summary: clientNotes.summary,
        archivedAt: clientNotes.archivedAt,
      })
      .from(clientNotes)
      .where(and(eq(clientNotes.id, noteId), eq(clientNotes.clientId, clientId)))
      .for('update');
    if (!note) throw new NotFoundException();
    return note;
  }

  /** Rule 10: a non-archived contact of the same client, when it is set. */
  private async assertContactOf(tx: Transaction, clientId: string, contactId: string) {
    const [contact] = await tx
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, contactId),
          eq(clientContacts.clientId, clientId),
          isNull(clientContacts.archivedAt),
        ),
      );
    if (!contact) {
      throw new CodedException(400, 'UNKNOWN_CONTACT', 'The contact is not one of this client');
    }
  }

  private async note(actor: CurrentUserInfo, client: ClientAccessRow, noteId: string) {
    const [row] = await this.db
      .select(noteColumns)
      .from(clientNotes)
      .leftJoin(clientContacts, eq(clientContacts.id, clientNotes.contactId))
      .where(eq(clientNotes.id, noteId));
    if (!row) throw new NotFoundException();
    return toNote(actor, client, row, await this.users.summaries([row.authorId]));
  }
}

function assertNoteNotArchived(note: { archivedAt: Date | null }): void {
  if (note.archivedAt) {
    throw new CodedException(409, 'NOTE_ARCHIVED', 'The note was withdrawn');
  }
}

function toNote(
  actor: CurrentUserInfo,
  client: ClientAccessRow,
  row: NoteRow,
  authors: Map<string, UserSummary>,
): Note {
  const writable = !client.archivedAt && !row.archivedAt && covers(actor, 'clients.log', client);
  const isAuthor = row.authorId === actor.id;
  return {
    id: row.id,
    clientId: row.clientId,
    occurredAt: row.occurredAt.toISOString(),
    channel: row.channel,
    summary: row.summary,
    author: { id: row.authorId, name: authors.get(row.authorId)?.name ?? '' },
    contact:
      row.contactId && row.contactName !== null
        ? { id: row.contactId, name: row.contactName, archived: !!row.contactArchivedAt }
        : null,
    canEdit: writable && isAuthor,
    canArchive: writable && (isAuthor || holdsAll(actor, 'clients.manage')),
  };
}
