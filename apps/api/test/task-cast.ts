import {
  addDays,
  businessDate,
  type CreateTaskInput,
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

  /** Moves the task and expects success. */
  async function moveOk(id: string, cookie: string, change: TaskStatusChangeInput) {
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
    detail,
    taskAt,
  };
}
