import {
  type CreateApprovalRequestInput,
  type IssuedApprovalRequest,
  issuedApprovalRequestSchema,
  type TaskDetail,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import type { api } from './helpers.js';
import { seedTaskCast } from './task-cast.js';

/*
 * The people and factories of the F09 approval tests, on top of the F06 cast: a medical
 * reviewer, tasks ready to send and approval requests.
 */

type Api = ReturnType<typeof api>;

export async function seedApprovalCast(db: Database, client: Api) {
  const cast = await seedTaskCast(db, client);
  const reviewer = await cast.signedIn({
    name: `مراجع طبي ${cast.run}`,
    departments: [{ code: 'medical_consultation' }],
  });

  /** A task of a non-healthcare client waiting for the client, with a text to approve. */
  const readyTask = (clientId: string): Promise<TaskDetail> =>
    cast.taskAt('awaiting_client', { clientId });

  /** A task of a healthcare client cleared by the medical reviewer. */
  async function medicalReadyTask(clientId: string): Promise<TaskDetail> {
    const task = await cast.taskAt('internal_review', { clientId });
    await cast.moveOk(task.id, cast.designManager.cookie, { status: 'awaiting_client' });
    const response = await client.post(`/api/tasks/${task.id}/medical-review`, reviewer.cookie, {
      decision: 'approve',
    });
    if (response.status !== 200) {
      throw new Error(`Medical review failed: ${response.status} ${await response.text()}`);
    }
    return cast.detail(task.id, cast.gm.cookie);
  }

  const createRequest = (cookie: string | undefined, input: CreateApprovalRequestInput) =>
    client.post('/api/approvals/requests', cookie, input);

  /** A request for the tasks, to the client's final-approval contact, by its account manager. */
  async function requestOk(
    clientId: string,
    taskIds: string[],
    cookie: string = cast.am.cookie,
  ): Promise<IssuedApprovalRequest> {
    const response = await createRequest(cookie, {
      clientId,
      contactId: await cast.contactOf(clientId),
      items: taskIds.map((taskId) => ({ taskId })),
    });
    if (response.status !== 201) {
      throw new Error(`Request creation failed: ${response.status} ${await response.text()}`);
    }
    return issuedApprovalRequestSchema.parse(await response.json());
  }

  /** The token of a link, as the client page reads it from `/a/<token>`. */
  const tokenOf = (issued: { link: string }) => issued.link.split('/a/')[1] ?? '';

  return { ...cast, reviewer, readyTask, medicalReadyTask, createRequest, requestOk, tokenOf };
}
