import {
  type CampaignDetail,
  type CampaignUpdateFormInput,
  type CreateCampaignInput,
  campaignDetailSchema,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { seedClientCast } from './client-cast.js';
import { type api, uniqueEmail } from './helpers.js';

/*
 * The people the F12 tests act as, on top of the client cast: a Marketing member and Finance;
 * campaign and update factories. Cleanup removes clients (and their campaigns) first, then users.
 */

type Api = ReturnType<typeof api>;

export async function ok<T>(
  response: Response,
  schema: { parse: (value: unknown) => T },
  status = 200,
): Promise<T> {
  if (response.status !== status) {
    throw new Error(`Expected ${status}, got ${response.status} ${await response.text()}`);
  }
  return schema.parse(await response.json());
}

export async function seedCampaignCast(db: Database, client: Api) {
  const cast = await seedClientCast(db, client);
  const marketer = await cast.signedIn({
    email: uniqueEmail('marketer'),
    departments: [{ code: 'marketing' }],
  });
  const finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
  cast.trackUser(finance.id);

  /** A campaign of `clientId` created by the Marketing member, owned by them, planned. */
  async function createCampaign(
    clientId: string,
    input: Partial<CreateCampaignInput> = {},
    cookie = marketer.cookie,
  ): Promise<CampaignDetail> {
    return ok(
      await client.post('/api/campaigns', cookie, {
        clientId,
        name: `حملة ${cast.run}`,
        platform: 'meta',
        objective: 'messages',
        budgetMinor: 60_000,
        startsOn: '2026-08-01',
        ownerId: marketer.id,
        ...input,
      }),
      campaignDetailSchema,
      201,
    );
  }

  const changeStatus = (id: string, to: string, reason?: string, cookie = marketer.cookie) =>
    client.post(`/api/campaigns/${id}/status`, cookie, { to, reason });

  /** A campaign moved to `active`. */
  async function activeCampaign(
    clientId: string,
    input: Partial<CreateCampaignInput> = {},
  ): Promise<CampaignDetail> {
    const created = await createCampaign(clientId, input);
    return ok(await changeStatus(created.id, 'active'), campaignDetailSchema);
  }

  const addUpdate = (
    campaignId: string,
    input: Partial<CampaignUpdateFormInput> = {},
    cookie = marketer.cookie,
  ) =>
    client.post(`/api/campaigns/${campaignId}/updates`, cookie, {
      periodStart: '2026-09-01',
      periodEnd: '2026-09-07',
      spendMinor: 20_000,
      reach: 15_000,
      clicks: 900,
      results: 45,
      ...input,
    });

  return {
    ...cast,
    marketer,
    finance,
    createCampaign,
    activeCampaign,
    changeStatus,
    addUpdate,
  };
}
