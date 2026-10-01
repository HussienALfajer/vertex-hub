import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { auditEntries, clientContacts, createDatabase, extraWorkItems } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task status (rules 1, 2, 13, 14)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    expect((await client.post(`/api/tasks/${randomUUID()}/status`, undefined, {})).status).toBe(
      401,
    );
  });

  it('runs the whole workflow, each move by its roles, audited', async () => {
    const { id: clientId } = await cast.createClient();
    const task = await cast.createTask(cast.designManager.cookie, {
      clientId,
      assigneeId: cast.designer.id,
    });
    expect((await cast.move(task.id, cast.writer.cookie, { status: 'in_progress' })).status).toBe(
      403,
    );
    const started = await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
    expect(started.startedAt).not.toBeNull();
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
    // Review belongs to manage scope, not to the assignee.
    expect(
      (await cast.move(task.id, cast.designer.cookie, { status: 'awaiting_client' })).status,
    ).toBe(403);
    await expectError(
      await cast.move(task.id, cast.designManager.cookie, { status: 'approved' }),
      409,
      'INVALID_TRANSITION',
    );
    const sent = await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'awaiting_client',
    });
    expect(sent.allowedTransitions).toEqual(['internal_review', 'cancelled']);
    // The client's answer belongs to client scope.
    expect(
      (await cast.move(task.id, cast.designManager.cookie, { status: 'approved' })).status,
    ).toBe(403);
    expect((await cast.move(task.id, cast.otherAm.cookie, { status: 'approved' })).status).toBe(
      403,
    );
    await cast.moveOk(task.id, cast.am.cookie, { status: 'approved' });
    const delivered = await cast.moveOk(task.id, cast.designer.cookie, { status: 'delivered' });
    expect(delivered.deliveredAt).not.toBeNull();
    expect(
      (await auditOf(task.id))
        .filter((e) => e.action === 'task.status_changed')
        .map((e) => [e.actorId, e.before?.status, e.after?.status]),
    ).toEqual([
      [cast.designer.id, 'new', 'in_progress'],
      [cast.designer.id, 'in_progress', 'internal_review'],
      [cast.designManager.id, 'internal_review', 'awaiting_client'],
      [cast.am.id, 'awaiting_client', 'approved'],
      [cast.designer.id, 'approved', 'delivered'],
    ]);
  });

  it('approves without the client step when no client approval is needed', async () => {
    const task = await cast.taskAt('internal_review', { needsClientApproval: false });
    expect(task.allowedTransitions).toEqual([]);
    await expectError(
      await cast.move(task.id, cast.designManager.cookie, { status: 'awaiting_client' }),
      409,
      'INVALID_TRANSITION',
    );
    const approved = await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'approved',
    });
    expect(approved.status).toBe('approved');
  });

  it('refuses moves the workflow does not have, and starting without an assignee (rule 2)', async () => {
    const queued = await cast.createTask(cast.writer.cookie);
    await expectError(
      await cast.move(queued.id, cast.designManager.cookie, { status: 'in_progress' }),
      409,
      'ASSIGNEE_REQUIRED',
    );
    await expectError(
      await cast.move(queued.id, cast.designManager.cookie, { status: 'delivered' }),
      409,
      'INVALID_TRANSITION',
    );
    await expectError(
      await cast.move(queued.id, cast.designManager.cookie, { status: 'new' }),
      409,
      'INVALID_TRANSITION',
    );
  });

  it('needs a note to return, cancel or reopen', async () => {
    const task = await cast.taskAt('internal_review');
    expect(
      (await cast.move(task.id, cast.designManager.cookie, { status: 'revisions' })).status,
    ).toBe(400);
    expect(
      (await cast.move(task.id, cast.designManager.cookie, { status: 'cancelled' })).status,
    ).toBe(400);
  });

  it('lets a requester withdraw their own unassigned request only while new (rule 13)', async () => {
    const request = await cast.createTask(cast.writer.cookie);
    expect(
      (await cast.move(request.id, cast.designer.cookie, { status: 'cancelled', note: 'No' }))
        .status,
    ).toBe(403);
    const withdrawn = await cast.moveOk(request.id, cast.writer.cookie, {
      status: 'cancelled',
      note: 'Not needed any more',
    });
    expect(withdrawn).toMatchObject({ status: 'cancelled', cancelReason: 'Not needed any more' });
    expect(withdrawn.cancelledAt).not.toBeNull();
    // Reopening a cancelled unassigned task puts it back in the queue.
    await expectError(
      await cast.move(request.id, cast.designManager.cookie, {
        status: 'in_progress',
        note: 'Back',
      }),
      409,
      'INVALID_TRANSITION',
    );
    const reopened = await cast.moveOk(request.id, cast.designManager.cookie, {
      status: 'new',
      note: 'Needed after all',
    });
    expect(reopened).toMatchObject({ status: 'new', cancelReason: null, cancelledAt: null });
  });

  it('reopens delivered work: internal back to work, client-caused to revisions (rule 14)', async () => {
    const internal = await cast.taskAt('delivered');
    expect(
      (await cast.move(internal.id, cast.designer.cookie, { status: 'in_progress', note: 'x' }))
        .status,
    ).toBe(403);
    const back = await cast.moveOk(internal.id, cast.designManager.cookie, {
      status: 'in_progress',
      note: 'Wrong size',
    });
    expect(back).toMatchObject({ status: 'in_progress', deliveredAt: null });
    expect(back.revisionHistory).toEqual([]);

    const byClient = await cast.taskAt('delivered');
    await expectError(
      await cast.move(byClient.id, cast.am.cookie, {
        status: 'revisions',
        note: 'Client wants blue',
        revisionSource: 'internal',
      }),
      409,
      'INVALID_TRANSITION',
    );
    expect(
      (await cast.move(byClient.id, cast.designManager.cookie, { status: 'revisions', note: 'x' }))
        .status,
    ).toBe(403);
    const reopened = await cast.moveOk(byClient.id, cast.am.cookie, {
      status: 'revisions',
      note: 'Client wants blue',
      revisionSource: 'client',
    });
    expect(reopened.revisionHistory).toMatchObject([
      { source: 'client', number: 1, note: 'Client wants blue', overLimit: false },
    ]);
  });

  it('checks the contact who answered for the client', async () => {
    const task = await cast.taskAt('awaiting_client');
    await expectError(
      await cast.move(task.id, cast.am.cookie, { status: 'approved', contactId: randomUUID() }),
      400,
      'UNKNOWN_CONTACT',
    );
    const clientId = task.client?.id ?? '';
    const [contact] = await db
      .insert(clientContacts)
      .values({ clientId, name: 'Approver' })
      .returning({ id: clientContacts.id });
    expect(
      (
        await cast.move(task.id, cast.designManager.cookie, {
          status: 'cancelled',
          note: 'x',
          contactId: contact?.id,
        })
      ).status,
    ).toBe(400);
    const approved = await cast.moveOk(task.id, cast.am.cookie, {
      status: 'approved',
      contactId: contact?.id,
    });
    expect(approved.status).toBe('approved');
  });

  it('refuses the second of two moves from the same status (edge case 1)', async () => {
    const task = await cast.taskAt('in_progress');
    const [first, second] = await Promise.all([
      cast.move(task.id, cast.designer.cookie, { status: 'internal_review' }),
      cast.move(task.id, cast.designer.cookie, { status: 'internal_review' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it('withdraws the unbilled extra work of a cancelled out-of-scope request (edge case 10)', async () => {
    const { id: clientId } = await cast.createClient();
    const project = await cast.createProject(clientId);
    const request = await cast.createTask(cast.am.cookie, {
      type: 'client_request',
      clientId,
      projectId: project.id,
      requestScope: 'out_of_scope',
    });
    const itemId = request.clientRequest?.extraWork?.id ?? '';
    await cast.moveOk(request.id, cast.am.cookie, { status: 'cancelled', note: 'Dropped' });
    const [item] = await db.select().from(extraWorkItems).where(eq(extraWorkItems.id, itemId));
    expect(item?.archivedAt).not.toBeNull();
  });
});
