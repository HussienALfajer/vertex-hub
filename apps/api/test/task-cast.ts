import {
  addDays,
  businessDate,
  type CreateTaskInput,
  contactSchema,
  type TaskDetail,
  type TaskStatus,
  type TaskStatusChangeInput,
  taskDetailSchema,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { expect } from 'vitest';
import { seedClientCast } from './client-cast.js';
import type { api } from './helpers.js';

/*
 * The people the F06 tests act as, on top of the F02 and F05 cast: a designer and the Design
 * manager, a writer and the Content manager. Department managers are global rows: test files run
 * one at a time.
 */

type Api = ReturnType<typeof api>;

export async function seedTaskCast(db: Database, client: Api) {
  const cast = await seedClientCast(db, client);
  const designer = await cast.signedIn({ name: `مصمم ${cast.run}` });
  const designManager = await cast.signedIn({
    name: `مدير التصميم ${cast.run}`,
    departments: [{ code: 'design', manager: true }],
  });
  const writer = await cast.signedIn({
    name: `كاتب ${cast.run}`,
    departments: [{ code: 'content_management' }],
  });
  const contentManager = await cast.signedIn({
    name: `مدير المحتوى ${cast.run}`,
    departments: [{ code: 'content_management', manager: true }],
  });

  const inDays = (days: number) => addDays(businessDate(), days);

  /** Creates a task as `cookie`; a Design task due in 3 days unless the input says otherwise. */
  async function createTask(cookie: string, input: Partial<CreateTaskInput> = {}) {
    const response = await client.post('/api/tasks', cookie, {
      title: `مهمة ${cast.run}`,
      department: 'design',
      dueDate: inDays(3),
      ...input,
    });
    if (response.status !== 201) {
      throw new Error(`Task creation failed: ${response.status} ${await response.text()}`);
    }
    return taskDetailSchema.parse(await response.json());
  }

  const move = (id: string, cookie: string, change: TaskStatusChangeInput) =>
    client.post(`/api/tasks/${id}/status`, cookie, change);

  const contacts = new Map<string, string>();

  /** A contact of the client with final-approval authority, created once per client. */
  async function contactOf(clientId: string): Promise<string> {
    const known = contacts.get(clientId);
    if (known) return known;
    const response = await client.post(`/api/clients/${clientId}/contacts`, cast.gm.cookie, {
      name: `جهة اتصال ${cast.run}`,
      phone: '+963944000111',
      hasFinalApproval: true,
    });
    if (response.status !== 201) {
      throw new Error(`Contact creation failed: ${response.status} ${await response.text()}`);
    }
    const { id } = contactSchema.parse(await response.json());
    contacts.set(clientId, id);
    return id;
  }

  async function setClientText(id: string, cookie: string, clientText: string | null) {
    const response = await client.request('PUT', `/api/tasks/${id}/client-text`, {
      cookie,
      body: { clientText },
    });
    if (response.status !== 200) {
      throw new Error(`Client text failed: ${response.status} ${await response.text()}`);
    }
    return taskDetailSchema.parse(await response.json());
  }

  /**
   * What the task page sends with a move (F09): an internal pass carries the content token the
   * reviewer was shown, and a client response names a contact of the client. A task with nothing
   * to approve gets a text for the client before it is sent.
   */
  async function asThePageSends(
    id: string,
    cookie: string,
    change: TaskStatusChangeInput,
  ): Promise<TaskStatusChangeInput> {
    const current = await detail(id, cast.gm.cookie);
    const from = current.status;
    if (from === 'internal_review' && ['awaiting_client', 'approved'].includes(change.status)) {
      if (change.contentToken) return change;
      const empty = current.fileCounts.deliverables === 0 && !current.clientText;
      const shown =
        change.status === 'awaiting_client' && empty
          ? await setClientText(id, cookie, `نص المنشور ${cast.run}`)
          : current;
      return { ...change, contentToken: shown.contentToken };
    }
    const answers =
      (from === 'awaiting_client' && ['approved', 'revisions'].includes(change.status)) ||
      (from === 'approved' && change.status === 'revisions');
    if (answers && !change.contactId && current.client) {
      return { ...change, contactId: await contactOf(current.client.id) };
    }
    return change;
  }

  /** Moves the task as its page would (see `asThePageSends`) and expects success. */
  async function moveOk(id: string, cookie: string, input: TaskStatusChangeInput) {
    const change = await asThePageSends(id, cookie, input);
    const response = await move(id, cookie, change);
    if (response.status !== 200) {
      throw new Error(
        `Move to ${change.status} failed: ${response.status} ${await response.text()}`,
      );
    }
    return taskDetailSchema.parse(await response.json());
  }

  async function detail(id: string, cookie: string): Promise<TaskDetail> {
    const response = await client.get(`/api/tasks/${id}`, cookie);
    expect(response.status).toBe(200);
    return taskDetailSchema.parse(await response.json());
  }

  /**
   * A client task of Design assigned to the designer, moved through the workflow to `status` by
   * the people allowed to.
   */
  async function taskAt(status: TaskStatus, input: Partial<CreateTaskInput> = {}) {
    const clientId = input.clientId ?? (await cast.createClient()).id;
    const task = await createTask(designManager.cookie, {
      assigneeId: designer.id,
      clientId,
      ...input,
    });
    const path: [TaskStatus, string, string?][] = [
      ['in_progress', designer.cookie],
      ['internal_review', designer.cookie],
      task.needsClientApproval
        ? ['awaiting_client', designManager.cookie]
        : ['approved', designManager.cookie],
      ...(task.needsClientApproval
        ? ([['approved', cast.am.cookie]] as [TaskStatus, string][])
        : []),
      ['delivered', designer.cookie],
    ];
    let current = task;
    for (const [to, cookie] of path) {
      if (current.status === status) break;
      current = await moveOk(task.id, cookie, { status: to });
    }
    return current;
  }

  return {
    ...cast,
    designer,
    designManager,
    writer,
    contentManager,
    inDays,
    createTask,
    move,
    moveOk,
    asThePageSends,
    contactOf,
    setClientText,
    detail,
    taskAt,
  };
}
