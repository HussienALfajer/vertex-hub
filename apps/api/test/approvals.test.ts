import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  APPROVAL_LIMITS,
  type ApprovalRequestState,
  approvalReadySchema,
  approvalRequestDetailSchema,
  approvalRequestPageSchema,
  clientApprovalsSchema,
  contactSchema,
  emailHistorySchema,
  emailSummarySchema,
  issuedApprovalRequestSchema,
  myTaskSummarySchema,
  type NotificationType,
} from '@vertex-hub/contracts';
import {
  approvalItems,
  approvalRequests,
  auditEntries,
  createDatabase,
  emailMessages,
  notifications,
  taskClientResponses,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redactLinkToken, redactLoggedRequest } from '../src/core/http/redact-link-token.js';
import { hashToken } from '../src/modules/approvals/approval-items.js';
import { ApprovalReminders } from '../src/modules/approvals/approval-reminders.js';
import { seedApprovalCast } from './approval-cast.js';
import { expectError } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

const HOUR = 60 * 60 * 1000;

/*
 * F09 PR 2: approval requests (rules 8–12), the pending item following its task (rules 16–17),
 * a client's approval history and the hourly reminders (rules 24–25).
 */
describe('approval requests (F09 rules 8–12, 16–17, 24–25)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedApprovalCast>>;

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  const itemsOf = (requestId: string) =>
    db
      .select()
      .from(approvalItems)
      .where(eq(approvalItems.requestId, requestId))
      .orderBy(asc(approvalItems.position));

  const typesOf = async (recipientId: string, subjectId: string): Promise<NotificationType[]> =>
    (
      await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
        )
        .orderBy(asc(notifications.createdAt))
    ).map((row) => row.type);

  async function detail(id: string, cookie: string) {
    const response = await client.get(`/api/approvals/requests/${id}`, cookie);
    expect(response.status).toBe(200);
    return approvalRequestDetailSchema.parse(await response.json());
  }

  async function ready(cookie: string, clientId?: string) {
    const response = await client.get(
      `/api/approvals/ready${clientId ? `?clientId=${clientId}` : ''}`,
      cookie,
    );
    expect(response.status).toBe(200);
    return approvalReadySchema.parse(await response.json());
  }

  async function list(cookie: string, query: string) {
    const response = await client.get(`/api/approvals/requests?${query}`, cookie);
    expect(response.status).toBe(200);
    return approvalRequestPageSchema.parse(await response.json());
  }

  const reissue = (id: string, cookie?: string) =>
    client.post(`/api/approvals/requests/${id}/reissue`, cookie);
  const revoke = (id: string, cookie?: string) =>
    client.post(`/api/approvals/requests/${id}/revoke`, cookie);

  /** Moves the link's dates back, as time passing would. */
  const age = (id: string, values: { linkIssuedAt?: Date; expiresAt?: Date }) =>
    db.update(approvalRequests).set(values).where(eq(approvalRequests.id, id));

  const stateOf = async (id: string): Promise<ApprovalRequestState> =>
    (await detail(id, cast.gm.cookie)).state;

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedApprovalCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session, and client scope to send', async () => {
    const id = randomUUID();
    for (const response of [
      await client.get('/api/approvals/ready'),
      await client.get('/api/approvals/requests'),
      await client.get(`/api/approvals/requests/${id}`),
      await cast.createRequest(undefined, { clientId: id, contactId: id, items: [{ taskId: id }] }),
      await reissue(id),
      await revoke(id),
      await client.get(`/api/clients/${id}/approvals`),
    ]) {
      expect(response.status).toBe(401);
    }

    const { id: clientId } = await cast.createClient();
    const task = await cast.readyTask(clientId);
    const input = {
      clientId,
      contactId: await cast.contactOf(clientId),
      items: [{ taskId: task.id }],
    };
    // An employee holds no `tasks.manage`; a department manager and another client's account
    // manager hold it without client scope on this client.
    expect((await cast.createRequest(cast.employee.cookie, input)).status).toBe(403);
    expect((await cast.createRequest(cast.designManager.cookie, input)).status).toBe(403);
    expect((await cast.createRequest(cast.otherAm.cookie, input)).status).toBe(403);
    expect((await client.get('/api/approvals/ready', cast.employee.cookie)).status).toBe(403);
    expect((await client.get('/api/approvals/ready', cast.designManager.cookie)).status).toBe(403);
    expect((await ready(cast.otherAm.cookie)).clients).toEqual([]);

    const request = await cast.requestOk(clientId, [task.id]);
    expect((await reissue(request.id, cast.otherAm.cookie)).status).toBe(403);
    expect((await revoke(request.id, cast.designManager.cookie)).status).toBe(403);
    // Everyone reads requests; only client scope acts on them.
    const read = await detail(request.id, cast.employee.cookie);
    expect(read.permissions).toEqual({ canReissue: false, canRevoke: false });
    expect((await detail(request.id, cast.am.cookie)).permissions).toEqual({
      canReissue: true,
      canRevoke: true,
    });
    expect((await client.get(`/api/approvals/requests/${id}`, cast.gm.cookie)).status).toBe(404);
  });

  describe('ready to send (rule 8)', () => {
    it('lists ready tasks by client with the snapshot and the approvers', async () => {
      const { id: clientId, tradeName } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const first = await cast.readyTask(clientId);
      const working = await cast.taskAt('in_progress', { clientId });

      const mine = await ready(cast.am.cookie, clientId);
      expect(mine.clients).toHaveLength(1);
      expect(mine.clients[0]).toMatchObject({
        client: { id: clientId, name: tradeName },
        isHealthcare: false,
        contacts: [{ id: contactId, phone: '+963944000111' }],
      });
      expect(mine.clients[0]?.tasks.map((task) => task.id)).toEqual([first.id]);
      expect(mine.clients[0]?.tasks[0]?.snapshot).toEqual({ files: 0, hasText: true });
      expect(mine.clients[0]?.tasks.map((task) => task.id)).not.toContain(working.id);
      // Without the filter the General Manager sees every client's ready tasks.
      expect((await ready(cast.gm.cookie)).clients.map((group) => group.client.id)).toContain(
        clientId,
      );

      // Sent: no longer ready, here or in the summary.
      const summary = async () =>
        myTaskSummarySchema.parse(
          await (await client.get('/api/me/tasks/summary', cast.am.cookie)).json(),
        ).readyToSend;
      const before = await summary();
      await cast.requestOk(clientId, [first.id]);
      expect((await ready(cast.am.cookie, clientId)).clients).toEqual([]);
      expect(await summary()).toBe((before ?? 0) - 1);
    });

    it('asks for the medical review of a healthcare client’s task', async () => {
      const { id: clientId } = await cast.createClient();
      const sent = await cast.readyTask(clientId);
      const request = await cast.requestOk(clientId, [sent.id]);
      // Rule 19: turned on, the sent task stays sent; once its link is revoked it needs the
      // medical review before it is sent again.
      const flagged = await client.request('PATCH', `/api/clients/${clientId}`, {
        cookie: cast.operations.cookie,
        body: { isHealthcare: true },
      });
      expect(flagged.status).toBe(200);
      expect((await cast.detail(sent.id, cast.am.cookie)).status).toBe('awaiting_client');
      expect((await revoke(request.id, cast.am.cookie)).status).toBe(200);
      expect((await ready(cast.am.cookie, clientId)).clients).toEqual([]);
      const body = await expectError(
        await cast.createRequest(cast.am.cookie, {
          clientId,
          contactId: await cast.contactOf(clientId),
          items: [{ taskId: sent.id }],
        }),
        409,
        'MEDICAL_REVIEW_REQUIRED',
      );
      expect(body.details).toEqual({ taskId: sent.id });

      const cleared = await cast.medicalReadyTask(clientId);
      const group = (await ready(cast.am.cookie, clientId)).clients[0];
      expect(group?.isHealthcare).toBe(true);
      expect(group?.tasks.map((task) => task.id)).toEqual([cleared.id]);
      await cast.requestOk(clientId, [cleared.id]);
    });
  });

  describe('create (rule 9)', () => {
    it('bundles ready tasks into a link shown once, storing only its hash', async () => {
      const { id: clientId, tradeName } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const first = await cast.readyTask(clientId);
      const second = await cast.readyTask(clientId);
      const before = Date.now();
      const response = await cast.createRequest(cast.am.cookie, {
        clientId,
        contactId,
        message: ' نرجو الاعتماد ',
        items: [{ taskId: second.id, title: 'منشور العيد' }, { taskId: first.id }],
      });
      expect(response.status, await response.clone().text()).toBe(201);
      const issued = issuedApprovalRequestSchema.parse(await response.json());
      const token = cast.tokenOf(issued);
      expect(issued.link).toBe(`http://127.0.0.1:5173/a/${token}`);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(issued).toMatchObject({
        client: { id: clientId, name: tradeName },
        contact: { id: contactId, archived: false },
        state: 'open',
        counts: { total: 2, approved: 0, changesRequested: 0, pending: 2 },
        message: 'نرجو الاعتماد',
        contactPhone: '+963944000111',
        createdBy: { id: cast.am.id },
        remindedAt: null,
      });
      const days = (Date.parse(issued.expiresAt) - before) / (24 * HOUR);
      expect(days).toBeGreaterThanOrEqual(7);
      expect(days).toBeLessThan(7.01);
      expect(issued.items).toMatchObject([
        {
          position: 1,
          title: 'منشور العيد',
          task: { id: second.id },
          status: 'pending',
          text: second.clientText,
          response: null,
        },
        { position: 2, title: first.title, task: { id: first.id }, status: 'pending' },
      ]);

      // The token is neither stored nor audited.
      const [stored] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, issued.id));
      expect(stored?.tokenHash).toBe(hashToken(token));
      const audit = await auditOf(issued.id);
      expect(audit).toMatchObject([
        {
          action: 'approval_request.created',
          entityType: 'approval_request',
          actorId: cast.am.id,
          after: { clientId, contactId, taskIds: [second.id, first.id] },
        },
      ]);
      expect(JSON.stringify([stored, audit])).not.toContain(token);
      expect(JSON.stringify(await detail(issued.id, cast.am.cookie))).not.toContain(token);
      // Nor logged: the request log masks it in the public routes.
      const base = `/api/public/approvals/${token}`;
      expect(redactLinkToken(base)).toBe('/api/public/approvals/[token]');
      expect(redactLinkToken(`${base}/items/1/response?x=1`)).toBe(
        '/api/public/approvals/[token]/items/1/response?x=1',
      );
      expect(redactLinkToken('/api/tasks/1')).toBe('/api/tasks/1');
      expect(
        JSON.stringify(
          redactLoggedRequest({ url: `${base}/versions/1/content`, params: { token } }),
        ),
      ).not.toContain(token);

      // The task shows its pending link and is no longer ready.
      const sent = await cast.detail(first.id, cast.am.cookie);
      expect(sent.pendingApproval).toMatchObject({ requestId: issued.id, state: 'open' });
      expect(sent.permissions.canSendForApproval).toBe(false);
    });

    it('refuses tasks that are not ready, the wrong contact and too many tasks', async () => {
      const { id: clientId } = await cast.createClient();
      const other = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const task = await cast.readyTask(clientId);
      const create = (input: { contactId?: string; taskIds: string[] }) =>
        cast.createRequest(cast.am.cookie, {
          clientId,
          contactId: input.contactId ?? contactId,
          items: input.taskIds.map((taskId) => ({ taskId })),
        });

      const working = await cast.taskAt('in_progress', { clientId });
      const foreign = await cast.readyTask(other.id);
      for (const taskId of [working.id, foreign.id, randomUUID()]) {
        const body = await expectError(
          await create({ taskIds: [task.id, taskId] }),
          409,
          'TASK_NOT_READY',
        );
        expect(body.details).toEqual({ taskId });
      }
      expect((await create({ taskIds: [task.id, task.id] })).status).toBe(400);
      await expectError(
        await create({
          taskIds: Array.from({ length: APPROVAL_LIMITS.items + 1 }, () => randomUUID()),
        }),
        409,
        'LIMIT_REACHED',
      );

      // A contact without final-approval authority, another client's contact, an archived one.
      const plain = contactSchema.parse(
        await (
          await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
            name: `بلا صلاحية ${cast.run}`,
          })
        ).json(),
      );
      const former = contactSchema.parse(
        await (
          await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
            name: `سابق ${cast.run}`,
            hasFinalApproval: true,
          })
        ).json(),
      );
      expect(
        (
          await client.post(
            `/api/clients/${clientId}/contacts/${former.id}/archive`,
            cast.gm.cookie,
          )
        ).status,
      ).toBe(204);
      for (const wrong of [plain.id, former.id, await cast.contactOf(other.id), randomUUID()]) {
        await expectError(
          await create({ contactId: wrong, taskIds: [task.id] }),
          409,
          'CONTACT_NOT_APPROVER',
        );
      }
      // Nothing was created on the way.
      expect((await cast.detail(task.id, cast.am.cookie)).pendingApproval).toBeNull();

      // A task waits on one link at a time: in the API and in the database.
      const request = await cast.requestOk(clientId, [task.id]);
      await expectError(await create({ taskIds: [task.id] }), 409, 'TASK_NOT_READY');
      const [item] = await itemsOf(request.id);
      await expect(
        db.insert(approvalItems).values({
          requestId: request.id,
          taskId: task.id,
          position: 2,
          title: 'مكرر',
          reviewId: item?.reviewId ?? '',
        }),
      ).rejects.toThrow();

      // An archived client is sent nothing.
      expect((await client.post(`/api/clients/${other.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      await expectError(
        await cast.createRequest(cast.gm.cookie, {
          clientId: other.id,
          contactId,
          items: [{ taskId: foreign.id }],
        }),
        409,
        'CLIENT_ARCHIVED',
      );
      expect(
        (
          await cast.createRequest(cast.gm.cookie, {
            clientId: randomUUID(),
            contactId,
            items: [{ taskId: task.id }],
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('lists', () => {
    it('filters requests by state, client and creator, with item counts', async () => {
      const { id: clientId } = await cast.createClient();
      const open = await cast.requestOk(clientId, [(await cast.readyTask(clientId)).id]);
      const revoked = await cast.requestOk(
        clientId,
        [(await cast.readyTask(clientId)).id],
        cast.gm.cookie,
      );
      expect((await revoke(revoked.id, cast.gm.cookie)).status).toBe(200);
      const expired = await cast.requestOk(clientId, [(await cast.readyTask(clientId)).id]);
      await age(expired.id, { expiresAt: new Date(Date.now() - HOUR) });

      const ids = async (query: string, cookie = cast.employee.cookie) =>
        (await list(cookie, `clientId=${clientId}&${query}`)).items.map((item) => item.id);
      // Open and expired by default, newest first.
      expect(await ids('')).toEqual([expired.id, open.id]);
      expect(await ids('state=revoked')).toEqual([revoked.id]);
      expect(await ids('state=open&state=revoked')).toEqual([revoked.id, open.id]);
      expect(await ids('state=completed')).toEqual([]);
      expect(await ids('state=revoked&createdBy=me', cast.gm.cookie)).toEqual([revoked.id]);
      expect(await ids('createdBy=me', cast.gm.cookie)).toEqual([]);
      const page = await list(cast.am.cookie, `clientId=${clientId}&pageSize=1&page=2`);
      expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(page.items).toMatchObject([
        { id: open.id, state: 'open', items: { total: 1, pending: 1 } },
      ]);

      // The requests of an archived client stay readable to scope-all holders only.
      expect((await client.post(`/api/clients/${clientId}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );
      expect(await ids('')).toEqual([]);
      expect(await ids('', cast.gm.cookie)).toEqual([expired.id, open.id]);
      const history = (cookie: string) => client.get(`/api/clients/${clientId}/approvals`, cookie);
      expect((await history(cast.am.cookie)).status).toBe(404);
      expect((await history(cast.gm.cookie)).status).toBe(200);
      expect((await client.get(`/api/approvals/requests/${open.id}`, cast.am.cookie)).status).toBe(
        404,
      );
      expect((await detail(open.id, cast.gm.cookie)).permissions).toEqual({
        canReissue: false,
        canRevoke: true,
      });
      await expectError(await reissue(open.id, cast.gm.cookie), 409, 'CLIENT_ARCHIVED');
    });

    it('shows a client its requests and responses', async () => {
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const answered = await cast.readyTask(clientId);
      const waiting = await cast.readyTask(clientId);
      const request = await cast.requestOk(clientId, [answered.id, waiting.id]);
      await cast.moveOk(answered.id, cast.am.cookie, { status: 'approved', contactId });

      const response = await client.get(`/api/clients/${clientId}/approvals`, cast.employee.cookie);
      expect(response.status).toBe(200);
      const approvals = clientApprovalsSchema.parse(await response.json());
      expect(approvals.requests).toMatchObject({
        total: 1,
        items: [{ id: request.id, items: { total: 2, approved: 1, pending: 1 } }],
      });
      expect(approvals.responses).toMatchObject({
        total: 1,
        items: [
          {
            task: { id: answered.id, title: answered.title },
            decision: 'approved',
            channel: 'manual',
            contact: { id: contactId },
            recordedBy: { id: cast.am.id },
          },
        ],
      });
      expect(
        (await client.get(`/api/clients/${randomUUID()}/approvals`, cast.gm.cookie)).status,
      ).toBe(404);
    });
  });

  describe('reissue and revoke (rules 11 and 12)', () => {
    it('reissues a new link for seven days and clears the notices', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.readyTask(clientId);
      const issued = await cast.requestOk(clientId, [task.id]);
      const old = new Date(Date.now() - 8 * 24 * HOUR);
      await age(issued.id, { linkIssuedAt: old, expiresAt: new Date(old.getTime() + HOUR) });
      await db
        .update(approvalRequests)
        .set({ remindedAt: old, expiryNotifiedAt: old })
        .where(eq(approvalRequests.id, issued.id));
      expect(await stateOf(issued.id)).toBe('expired');

      const response = await reissue(issued.id, cast.am.cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      const again = issuedApprovalRequestSchema.parse(await response.json());
      expect(again.state).toBe('open');
      expect(again.remindedAt).toBeNull();
      expect(cast.tokenOf(again)).not.toBe(cast.tokenOf(issued));
      const [stored] = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, issued.id));
      expect(stored?.tokenHash).toBe(hashToken(cast.tokenOf(again)));
      expect(stored?.expiryNotifiedAt).toBeNull();
      // The old link stops working; the new one opens the page.
      const page = (token: string) => client.get(`/api/public/approvals/${token}`);
      expect((await page(cast.tokenOf(issued))).status).toBe(404);
      expect((await page(cast.tokenOf(again))).status).toBe(200);
      const audit = await auditOf(issued.id);
      expect(audit.at(-1)).toMatchObject({
        action: 'approval_request.link_reissued',
        actorId: cast.am.id,
      });
      expect(JSON.stringify(audit)).not.toContain(cast.tokenOf(again));

      // The contact must still qualify.
      const contactId = await cast.contactOf(clientId);
      const demote = (hasFinalApproval: boolean) =>
        client.request('PATCH', `/api/clients/${clientId}/contacts/${contactId}`, {
          cookie: cast.gm.cookie,
          body: { hasFinalApproval },
        });
      expect((await demote(false)).status).toBe(200);
      await expectError(await reissue(issued.id, cast.am.cookie), 409, 'CONTACT_NOT_APPROVER');
      expect((await demote(true)).status).toBe(200);
      expect((await reissue(randomUUID(), cast.gm.cookie)).status).toBe(404);
    });

    it('revokes a request: its items are withdrawn and the tasks ready again', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.readyTask(clientId);
      const issued = await cast.requestOk(clientId, [task.id]);

      const response = await revoke(issued.id, cast.am.cookie);
      expect(response.status).toBe(200);
      const revoked = approvalRequestDetailSchema.parse(await response.json());
      expect(revoked).toMatchObject({
        state: 'revoked',
        counts: { total: 1, pending: 0 },
        permissions: { canReissue: false, canRevoke: false },
        items: [{ status: 'withdrawn', withdrawnReason: 'revoked' }],
      });
      expect((await auditOf(issued.id)).at(-1)).toMatchObject({
        action: 'approval_request.revoked',
        actorId: cast.am.id,
        after: { taskIds: [task.id] },
      });
      const freed = await cast.detail(task.id, cast.am.cookie);
      expect(freed.status).toBe('awaiting_client');
      expect(freed.pendingApproval).toBeNull();
      expect(freed.permissions.canSendForApproval).toBe(true);

      await expectError(await revoke(issued.id, cast.am.cookie), 409, 'REQUEST_CLOSED');
      await expectError(await reissue(issued.id, cast.am.cookie), 409, 'REQUEST_CLOSED');
      // Ready again: a new request takes the task.
      await cast.requestOk(clientId, [task.id]);
    });

    it('sends a task again when its link expired, withdrawing the old item', async () => {
      const { id: clientId } = await cast.createClient();
      const task = await cast.readyTask(clientId);
      const kept = await cast.readyTask(clientId);
      const expired = await cast.requestOk(clientId, [task.id, kept.id]);
      await age(expired.id, { expiresAt: new Date(Date.now() - HOUR) });

      const waiting = await cast.detail(task.id, cast.am.cookie);
      expect(waiting.pendingApproval).toMatchObject({ requestId: expired.id, state: 'expired' });
      expect(waiting.permissions.canSendForApproval).toBe(true);
      expect(
        (await ready(cast.am.cookie, clientId)).clients[0]?.tasks.map((item) => item.id).sort(),
      ).toEqual([task.id, kept.id].sort());

      const fresh = await cast.requestOk(clientId, [task.id]);
      expect((await detail(expired.id, cast.am.cookie)).items).toMatchObject([
        { task: { id: task.id }, status: 'withdrawn', withdrawnReason: 'resent' },
        { task: { id: kept.id }, status: 'pending' },
      ]);
      expect((await auditOf(expired.id)).at(-1)).toMatchObject({
        action: 'approval_item.withdrawn',
        actorId: cast.am.id,
        after: { taskId: task.id, reason: 'resent' },
      });
      expect((await cast.detail(task.id, cast.am.cookie)).pendingApproval).toMatchObject({
        requestId: fresh.id,
        state: 'open',
      });
      // With its last pending item resent, the old request has nothing left to wait for.
      await cast.requestOk(clientId, [kept.id]);
      expect(await stateOf(expired.id)).toBe('completed');
    });
  });

  describe('the pending item follows its task (rules 16 and 17)', () => {
    it('closes the item with a response recorded by hand', async () => {
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const approved = await cast.readyTask(clientId);
      const changed = await cast.readyTask(clientId);
      const request = await cast.requestOk(clientId, [approved.id, changed.id]);
      const [first, second] = await itemsOf(request.id);

      await cast.moveOk(approved.id, cast.am.cookie, { status: 'approved', contactId });
      expect(await stateOf(request.id)).toBe('open');
      await cast.moveOk(changed.id, cast.am.cookie, {
        status: 'revisions',
        note: 'غيّروا اللون',
        contactId,
      });

      const closed = await detail(request.id, cast.am.cookie);
      expect(closed).toMatchObject({
        state: 'completed',
        counts: { total: 2, approved: 1, changesRequested: 1, pending: 0 },
        items: [
          { status: 'approved', response: { decision: 'approved', channel: 'manual' } },
          {
            status: 'changes_requested',
            response: { decision: 'changes_requested', channel: 'manual', note: 'غيّروا اللون' },
          },
        ],
      });
      // The responses name the items they closed.
      const responses = await db
        .select()
        .from(taskClientResponses)
        .where(eq(taskClientResponses.taskId, approved.id));
      expect(responses).toMatchObject([{ channel: 'manual', approvalItemId: first?.id }]);
      expect((await auditOf(request.id)).slice(-2)).toMatchObject([
        {
          action: 'approval_item.responded',
          actorId: cast.am.id,
          after: { itemId: first?.id, taskId: approved.id, decision: 'approved', via: 'manual' },
        },
        {
          action: 'approval_item.responded',
          after: { itemId: second?.id, decision: 'changes_requested' },
        },
      ]);
      expect((await cast.detail(approved.id, cast.am.cookie)).pendingApproval).toBeNull();
      await expectError(await revoke(request.id, cast.am.cookie), 409, 'REQUEST_CLOSED');
    });

    it('withdraws the item when the task leaves the client otherwise', async () => {
      const { id: clientId } = await cast.createClient();
      const other = await cast.createClient();
      const withdrawn = await cast.readyTask(clientId);
      const cancelled = await cast.readyTask(clientId);
      const archived = await cast.readyTask(clientId);
      const request = await cast.requestOk(clientId, [withdrawn.id, cancelled.id, archived.id]);

      // Rule 17: a task in a link keeps its client.
      await expectError(
        await client.request('PATCH', `/api/tasks/${withdrawn.id}`, {
          cookie: cast.gm.cookie,
          body: { clientId: other.id },
        }),
        409,
        'SENT_TO_CLIENT',
      );
      await cast.moveOk(withdrawn.id, cast.designManager.cookie, { status: 'internal_review' });
      await cast.moveOk(cancelled.id, cast.designManager.cookie, {
        status: 'cancelled',
        note: 'أُلغيت الحملة',
      });
      expect(await stateOf(request.id)).toBe('open');
      expect((await client.post(`/api/tasks/${archived.id}/archive`, cast.gm.cookie)).status).toBe(
        200,
      );

      const closed = await detail(request.id, cast.am.cookie);
      expect(closed.state).toBe('completed');
      expect(closed.items).toMatchObject(
        [withdrawn, cancelled, archived].map((task) => ({
          task: { id: task.id },
          status: 'withdrawn',
          withdrawnReason: 'task_moved',
          response: null,
        })),
      );
      expect((await auditOf(request.id)).at(1)).toMatchObject({
        action: 'approval_item.withdrawn',
        actorId: cast.designManager.id,
        after: { taskId: withdrawn.id, reason: 'task_moved' },
      });
      // Reviewed again, the task is sent in a new request.
      await cast.moveOk(withdrawn.id, cast.designManager.cookie, { status: 'awaiting_client' });
      await cast.requestOk(clientId, [withdrawn.id]);
    });
  });

  describe('reminders (rules 24 and 25, A04)', () => {
    it('sends each notice once per issued link, and again after a reissue', async () => {
      const reminders = app.get(ApprovalReminders);
      const { id: clientId } = await cast.createClient();
      // The General Manager creates it: the account manager and the creator both hear.
      const request = await cast.requestOk(
        clientId,
        [(await cast.readyTask(clientId)).id],
        cast.gm.cookie,
      );
      const types = () =>
        Promise.all([typesOf(cast.am.id, request.id), typesOf(cast.gm.id, request.id)]);

      await reminders.run();
      expect(await types()).toEqual([[], []]);
      const now = Date.now();
      await age(request.id, { linkIssuedAt: new Date(now - 47 * HOUR) });
      await reminders.run();
      expect(await types()).toEqual([[], []]);

      await age(request.id, { linkIssuedAt: new Date(now - 49 * HOUR) });
      await reminders.run();
      await reminders.run();
      expect(await types()).toEqual([['approval_no_response'], ['approval_no_response']]);
      expect((await detail(request.id, cast.am.cookie)).remindedAt).not.toBeNull();
      const [notice] = await db
        .select()
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, cast.am.id), eq(notifications.subjectId, request.id)),
        );
      expect(notice).toMatchObject({ actorId: null, subjectType: 'approval_request' });
      expect(notice?.data).toMatchObject({ contact: `جهة اتصال ${cast.run}` });

      // Expired with a pending item: one notice.
      await age(request.id, { expiresAt: new Date(now - HOUR) });
      await reminders.run();
      await reminders.run();
      expect((await types())[0]).toEqual(['approval_no_response', 'approval_expired']);

      // A reissue starts over.
      expect((await reissue(request.id, cast.am.cookie)).status).toBe(200);
      await age(request.id, { linkIssuedAt: new Date(now - 49 * HOUR) });
      await reminders.run();
      expect((await types())[0]).toEqual([
        'approval_no_response',
        'approval_expired',
        'approval_no_response',
      ]);
    });

    it('stays quiet for revoked, completed and answered requests', async () => {
      const reminders = app.get(ApprovalReminders);
      const { id: clientId } = await cast.createClient();
      const contactId = await cast.contactOf(clientId);
      const old = { linkIssuedAt: new Date(Date.now() - 49 * HOUR) };

      const revoked = await cast.requestOk(clientId, [(await cast.readyTask(clientId)).id]);
      expect((await revoke(revoked.id, cast.am.cookie)).status).toBe(200);
      const done = await cast.readyTask(clientId);
      const completed = await cast.requestOk(clientId, [done.id]);
      await cast.moveOk(done.id, cast.am.cookie, { status: 'approved', contactId });
      // Answered through the link for one of its two tasks.
      const first = await cast.readyTask(clientId);
      const answered = await cast.requestOk(clientId, [
        first.id,
        (await cast.readyTask(clientId)).id,
      ]);
      const [item] = await itemsOf(answered.id);
      const responded = await client.post(
        `/api/public/approvals/${cast.tokenOf(answered)}/items/${item?.id}/response`,
        undefined,
        { decision: 'approved' },
      );
      expect(responded.status, await responded.clone().text()).toBe(200);
      for (const request of [revoked, completed, answered]) await age(request.id, old);

      await reminders.run();
      for (const request of [revoked, completed, answered]) {
        expect(await typesOf(cast.gm.id, request.id)).toEqual([]);
        expect(await typesOf(cast.am.id, request.id)).not.toContain('approval_no_response');
      }
      // Expired and revoked or completed: nothing to tell either.
      for (const request of [revoked, completed]) {
        await age(request.id, { expiresAt: new Date(Date.now() - HOUR) });
      }
      await reminders.run();
      for (const request of [revoked, completed]) {
        expect(await typesOf(cast.am.id, request.id)).not.toContain('approval_expired');
      }
    });
  });

  describe('by email (F14 email rule 19)', () => {
    let clientId: string;
    let contactId: string;
    const setEmail = (email: string | null) =>
      client.request('PATCH', `/api/clients/${clientId}/contacts/${contactId}`, {
        cookie: cast.gm.cookie,
        body: { email },
      });
    const emailReminder = (id: string, cookie?: string) =>
      client.post(`/api/approvals/requests/${id}/email-reminder`, cookie, {});
    const rowOf = async (id: string) =>
      (await db.select().from(emailMessages).where(eq(emailMessages.id, id)))[0];

    beforeAll(async () => {
      clientId = (await cast.createClient()).id;
      contactId = await cast.contactOf(clientId);
    });

    it('emails the link on create to a contact with an email, redacted in the outbox', async () => {
      const input = async () => ({
        clientId,
        contactId,
        message: 'تصاميم الأسبوع',
        email: true,
        items: [{ taskId: (await cast.readyTask(clientId)).id }],
      });
      await expectError(
        await cast.createRequest(cast.am.cookie, await input()),
        409,
        'CONTACT_NO_EMAIL',
      );
      expect((await setEmail('approver@example.com')).status).toBe(200);
      const response = await cast.createRequest(cast.am.cookie, await input());
      expect(response.status, await response.clone().text()).toBe(201);
      const issued = issuedApprovalRequestSchema.parse(await response.json());
      expect(issued.contactEmail).toBe('approver@example.com');
      expect(issued.email).toMatchObject({ kind: 'client_approval_link', cc: [] });
      expect(issued.email?.to.map((address) => address.email)).toEqual(['approver@example.com']);
      const row = await rowOf(issued.email?.id ?? '');
      expect(row).toMatchObject({
        message: 'تصاميم الأسبوع',
        recordType: 'approval_request',
        recordId: issued.id,
      });
      expect(row?.data).toMatchObject({ link: '[redacted]', items: [expect.any(String)] });
      expect(JSON.stringify(row)).not.toContain(cast.tokenOf(issued));
      expect((await auditOf(issued.id)).map((entry) => entry.action)).toContain(
        'approval_request.emailed',
      );
      const history = await client.get(
        `/api/approvals/requests/${issued.id}/emails`,
        cast.employee.cookie,
      );
      expect(history.status).toBe(200);
      expect(emailHistorySchema.parse(await history.json()).items).toHaveLength(1);
      expect((await client.get(`/api/approvals/requests/${issued.id}/emails`)).status).toBe(401);

      // Without `email` nothing is emailed, as before.
      const plain = issuedApprovalRequestSchema.parse(
        await (
          await cast.createRequest(cast.am.cookie, { ...(await input()), email: false })
        ).json(),
      );
      expect(plain.email).toBeNull();
    });

    it('emails the new link on reissue when asked', async () => {
      const issued = await cast.requestOk(clientId, [(await cast.readyTask(clientId)).id]);
      // A reissue without a body, as before F14 email, emails nothing.
      const plain = await client.request('POST', `/api/approvals/requests/${issued.id}/reissue`, {
        cookie: cast.am.cookie,
      });
      expect(plain.status, await plain.clone().text()).toBe(200);
      expect(issuedApprovalRequestSchema.parse(await plain.json()).email).toBeNull();
      const response = await client.post(
        `/api/approvals/requests/${issued.id}/reissue`,
        cast.am.cookie,
        { email: true },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const again = issuedApprovalRequestSchema.parse(await response.json());
      expect(again.email?.kind).toBe('client_approval_link');
    });

    it('sends the reminder once the no-response notice went out, without the link', async () => {
      const issued = await cast.requestOk(clientId, [(await cast.readyTask(clientId)).id]);
      expect((await emailReminder(issued.id)).status).toBe(401);
      expect((await emailReminder(issued.id, cast.employee.cookie)).status).toBe(403);
      // Another account manager's client: no client scope.
      expect((await emailReminder(issued.id, cast.otherAm.cookie)).status).toBe(403);
      await expectError(await emailReminder(issued.id, cast.am.cookie), 409, 'REMINDER_NOT_DUE');
      await db
        .update(approvalRequests)
        .set({ remindedAt: new Date() })
        .where(eq(approvalRequests.id, issued.id));
      const response = await emailReminder(issued.id, cast.am.cookie);
      expect(response.status, await response.clone().text()).toBe(202);
      const summary = emailSummarySchema.parse(await response.json());
      expect(summary.kind).toBe('client_approval_reminder');
      expect((await rowOf(summary.id))?.data).not.toHaveProperty('link');
      await age(issued.id, { expiresAt: new Date(Date.now() - HOUR) });
      await expectError(await emailReminder(issued.id, cast.am.cookie), 409, 'REQUEST_CLOSED');
      await setEmail(null);
      await age(issued.id, { expiresAt: new Date(Date.now() + HOUR) });
      await expectError(await emailReminder(issued.id, cast.am.cookie), 409, 'CONTACT_NO_EMAIL');
    });
  });
});
