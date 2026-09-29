import { randomUUID } from 'node:crypto';
import {
  type ClientDetailResponse,
  type CreateClientInput,
  type CreateProjectInput,
  clientDetailResponseSchema,
  type ErrorResponse,
  type ProjectDetail,
  projectDetailSchema,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { expect } from 'vitest';
import { type api, removeClients, removeUsers, seedUser } from './helpers.js';

/*
 * The people the F02 and F05 tests act as, and client and project factories. Names and trade names carry the run id,
 * so searches see only this run's rows; `cleanup` removes clients first, then users.
 */

type Api = ReturnType<typeof api>;

export async function seedClientCast(db: Database, client: Api) {
  const run = randomUUID().slice(0, 8);
  const users: string[] = [];
  const clients: string[] = [];
  const track = <T extends { id: string }>(user: T) => {
    users.push(user.id);
    return user;
  };
  const signedIn = async (input: Parameters<typeof seedUser>[1] = {}) => {
    const user = track(await seedUser(db, { name: `عضو ${run}`, ...input }));
    return { ...user, cookie: await client.signIn(user.email) };
  };

  const gm = track(await client.signInWithTwoFactor(db, { roles: ['general_manager'] }));
  const operations = track(
    await client.signInWithTwoFactor(db, {
      departments: [{ code: 'internal_operations', manager: true }],
    }),
  );
  const am = await signedIn({ name: `مدير حساب ${run}`, roles: ['account_manager'] });
  const otherAm = await signedIn({ name: `مدير حساب آخر ${run}`, roles: ['account_manager'] });
  const employee = await signedIn();

  async function createClient(
    input: Partial<CreateClientInput> = {},
  ): Promise<ClientDetailResponse> {
    const response = await client.post('/api/clients', gm.cookie, {
      tradeName: `عميل ${run} ${randomUUID().slice(0, 6)}`,
      accountManagerId: am.id,
      ...input,
    });
    expect(response.status).toBe(201);
    const created = clientDetailResponseSchema.parse(await response.json());
    clients.push(created.id);
    return created;
  }

  /** A project of `clientId` created by the General Manager; the employee manages it. */
  async function createProject(
    clientId: string,
    input: Partial<CreateProjectInput> = {},
  ): Promise<ProjectDetail> {
    const response = await client.post('/api/projects', gm.cookie, {
      clientId,
      name: `مشروع ${run} ${randomUUID().slice(0, 6)}`,
      projectManagerId: employee.id,
      departments: ['design'],
      startDate: '2026-10-01',
      dueDate: '2099-12-31',
      ...input,
    });
    expect(response.status).toBe(201);
    return projectDetailSchema.parse(await response.json());
  }

  return {
    run,
    gm,
    operations,
    am,
    otherAm,
    employee,
    /** Seeds another user and signs them in. */
    signedIn,
    createClient,
    createProject,
    /** Tracks a client created some other way, for cleanup. */
    trackClient: (id: string) => clients.push(id),
    trackUser: (id: string) => users.push(id),
    async cleanup() {
      await removeClients(db, clients);
      await removeUsers(db, users);
    },
  };
}

export async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = (await response.json()) as ErrorResponse;
  expect(body.code).toBe(code);
  return body;
}
