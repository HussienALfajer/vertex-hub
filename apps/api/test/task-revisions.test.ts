import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { businessDate, taskPageSchema, taskRevisionSchema } from '@vertex-hub/contracts';
import { auditEntries, clientContacts, createDatabase, extraWorkItems } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

describe('task revisions (rules 9, 10)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const decide = (taskId: string, revisionId: string, cookie: string | undefined, body: unknown) =>
    client.post(`/api/tasks/${taskId}/revisions/${revisionId}/decision`, cookie, body);

  /** Client changes requested, then back through review to the client. */
  async function clientChanges(taskId: string, note: string, contactId?: string) {
    const changed = await cast.moveOk(taskId, cast.am.cookie, {
      status: 'revisions',
      note,
      ...(contactId && { contactId }),
    });
    await cast.moveOk(taskId, cast.designer.cookie, { status: 'internal_review' });
    await cast.moveOk(taskId, cast.designManager.cookie, { status: 'awaiting_client' });
    return changed;
  }

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
    expect((await decide(randomUUID(), randomUUID(), undefined, { decision: 'free' })).status).toBe(
      401,
    );
  });

  it('records internal returns without counting them, and numbers client revisions', async () => {
    const { id: clientId } = await cast.createClient();
    const project = await cast.createProject(clientId);
    const [contact] = await db
      .insert(clientContacts)
      .values({ clientId, name: 'Marketing lead' })
      .returning({ id: clientContacts.id });
    const task = await cast.taskAt('internal_review', { clientId, projectId: project.id });

    const returned = await cast.moveOk(task.id, cast.designManager.cookie, {
      status: 'revisions',
      note: 'Fix the logo size',
    });
    expect(returned.revisionHistory).toMatchObject([
      { source: 'internal', number: null, overLimit: false, author: { id: cast.designManager.id } },
    ]);
    expect(returned.revisions).toEqual({ clientCount: 0, limit: 2 });
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
    await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });

    await clientChanges(task.id, 'Warmer colours', contact?.id);
    await clientChanges(task.id, 'Bigger headline');
    const third = await cast.moveOk(task.id, cast.am.cookie, {
      status: 'revisions',
      note: 'Another font',
    });
    expect(third.revisions).toEqual({ clientCount: 3, limit: 2 });
    expect(third.overLimitPending).toBe(true);
    expect(third.revisionHistory.map((r) => [r.source, r.number, r.overLimit])).toEqual([
      ['internal', null, false],
      ['client', 1, false],
      ['client', 2, false],
      ['client', 3, true],
    ]);
    expect(third.revisionHistory[1]?.contact).toMatchObject({ id: contact?.id });
    const pending = taskPageSchema.parse(
      await (
        await client.get(`/api/tasks?clientId=${clientId}&overLimit=true`, cast.gm.cookie)
      ).json(),
    );
    expect(pending.items.map((t) => t.id)).toEqual([task.id]);

    // Work is never blocked by the limit.
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });

    const over = third.revisionHistory[3]?.id ?? '';
    const within = third.revisionHistory[1]?.id ?? '';
    expect(
      (await decide(task.id, over, cast.designManager.cookie, { decision: 'free', note: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (await decide(task.id, over, cast.otherAm.cookie, { decision: 'free', note: 'x' })).status,
    ).toBe(403);
    await expectError(
      await decide(task.id, within, cast.am.cookie, { decision: 'extra_work' }),
      409,
      'NOT_OVER_LIMIT',
    );
    expect((await decide(task.id, over, cast.am.cookie, { decision: 'free' })).status).toBe(400);
    const decided = taskRevisionSchema.parse(
      await (await decide(task.id, over, cast.am.cookie, { decision: 'extra_work' })).json(),
    );
    expect(decided).toMatchObject({
      decision: 'extra_work',
      decidedBy: { id: cast.am.id },
      extraWork: { title: `التعديل 3: ${task.title}` },
    });
    const [item] = await db
      .select()
      .from(extraWorkItems)
      .where(eq(extraWorkItems.id, decided.extraWork?.id ?? ''));
    expect(item).toMatchObject({
      projectId: project.id,
      requestedOn: businessDate(),
      loggedById: cast.am.id,
      billingStatus: 'unbilled',
    });
    await expectError(
      await decide(task.id, over, cast.am.cookie, { decision: 'free', note: 'Changed my mind' }),
      409,
      'ALREADY_DECIDED',
    );
    expect((await cast.detail(task.id, cast.gm.cookie)).overLimitPending).toBe(false);
    const entries = await db.select().from(auditEntries).where(eq(auditEntries.entityId, task.id));
    expect(entries.find((e) => e.action === 'task.revision_decided')?.after).toMatchObject({
      revisionId: over,
      revisionNumber: 3,
      decision: 'extra_work',
    });
  });

  it('treats the first client revision as over a limit of 0, and decides it free (edge case 12)', async () => {
    const task = await cast.taskAt('awaiting_client', { revisionLimit: 0 });
    const changed = await cast.moveOk(task.id, cast.am.cookie, {
      status: 'revisions',
      note: 'Small change',
    });
    const revision = changed.revisionHistory[0];
    expect(revision).toMatchObject({ number: 1, overLimit: true });
    // Without a project or retainer, extra work has nowhere to go.
    await expectError(
      await decide(task.id, revision?.id ?? '', cast.am.cookie, { decision: 'extra_work' }),
      409,
      'NO_ENGAGEMENT',
    );
    const free = taskRevisionSchema.parse(
      await (
        await decide(task.id, revision?.id ?? '', cast.gm.cookie, {
          decision: 'free',
          note: 'Goodwill',
        })
      ).json(),
    );
    expect(free).toMatchObject({ decision: 'free', decisionNote: 'Goodwill', extraWork: null });
    expect(
      (await decide(task.id, randomUUID(), cast.am.cookie, { decision: 'free', note: 'x' })).status,
    ).toBe(404);
  });

  it('logs no extra work on an ended retainer (M3)', async () => {
    const { id: clientId } = await cast.createClient();
    const retainer = await cast.createRetainer(clientId);
    const task = await cast.taskAt('awaiting_client', {
      clientId,
      retainerCycleId: retainer.currentCycle?.id ?? '',
      revisionLimit: 0,
    });
    const changed = await cast.moveOk(task.id, cast.am.cookie, { status: 'revisions', note: 'x' });
    await client.post(`/api/retainers/${retainer.id}/status`, cast.gm.cookie, { status: 'ended' });
    await expectError(
      await decide(task.id, changed.revisionHistory[0]?.id ?? '', cast.am.cookie, {
        decision: 'extra_work',
      }),
      409,
      'RETAINER_ENDED',
    );
  });

  it('counts a client change after approval (A06)', async () => {
    const task = await cast.taskAt('approved');
    const changed = await cast.moveOk(task.id, cast.am.cookie, {
      status: 'revisions',
      note: 'Client changed their mind',
    });
    expect(changed.revisions.clientCount).toBe(1);
  });
});
