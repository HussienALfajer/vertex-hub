import { randomUUID } from 'node:crypto';
import {
  addDays,
  businessDate,
  type CreateLeadInput,
  catalogServiceSchema,
  type LeadDetail,
  leadDetailSchema,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { ok } from './campaign-cast.js';
import { seedClientCast } from './client-cast.js';
import { type api, removeCatalog, removeLeads, removeQuotes, uniqueEmail } from './helpers.js';

/*
 * The people the F03 tests act as, on top of the client cast: a General Communication member and
 * a Marketing member (lead managers with scope all); lead and catalog factories. Cleanup removes
 * leads, then client quotes and catalog items, then clients and users.
 */

type Api = ReturnType<typeof api>;

export async function seedLeadCast(db: Database, client: Api) {
  const cast = await seedClientCast(db, client);
  const communicator = await cast.signedIn({
    email: uniqueEmail('communicator'),
    name: `تواصل ${cast.run}`,
    departments: [{ code: 'general_communication' }],
  });
  const marketer = await cast.signedIn({
    email: uniqueEmail('marketer'),
    name: `تسويق ${cast.run}`,
    departments: [{ code: 'marketing' }],
  });
  const leadIds: string[] = [];
  const serviceIds: string[] = [];
  const tomorrow = addDays(businessDate(), 1);

  /** A lead created by the General Communication member, owned by the account manager. */
  async function createLead(
    input: Partial<CreateLeadInput> = {},
    cookie = communicator.cookie,
  ): Promise<LeadDetail> {
    const lead = await ok(
      await client.post('/api/leads', cookie, {
        contactName: `أحمد ${cast.run}`,
        companyName: `عيادة ${cast.run} ${randomUUID().slice(0, 6)}`,
        phone: `+9639${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        source: 'instagram',
        nextFollowUpOn: tomorrow,
        ownerId: cast.am.id,
        ...input,
      }),
      leadDetailSchema,
      201,
    );
    leadIds.push(lead.id);
    return lead;
  }

  /** A catalog service created by the General Manager. */
  async function createService(input: Record<string, unknown> = {}) {
    const service = await ok(
      await client.post('/api/catalog/services', cast.gm.cookie, {
        name: `خدمة ${cast.run} ${randomUUID().slice(0, 6)}`,
        department: 'design',
        billing: 'monthly',
        priceUsdMinor: 1500,
        ...input,
      }),
      catalogServiceSchema,
      201,
    );
    serviceIds.push(service.id);
    return service;
  }

  return {
    ...cast,
    communicator,
    marketer,
    tomorrow,
    createLead,
    createService,
    /** Tracks a lead created some other way, for cleanup. */
    trackLead: (id: string) => leadIds.push(id),
    async cleanup() {
      await removeLeads(db, leadIds);
      // Client quotes copy catalog items: they go before the catalog.
      await removeQuotes(db, cast.clientIds());
      await removeCatalog(db, serviceIds, []);
      await cast.cleanup();
    },
  };
}
