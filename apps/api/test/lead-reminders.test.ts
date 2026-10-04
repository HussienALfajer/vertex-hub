import type { INestApplication } from '@nestjs/common';
import { loseLeadResultSchema } from '@vertex-hub/contracts';
import { createDatabase, departments, leads, notifications } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DailyReminders } from '../src/modules/notifications/index.js';
import { ok } from './campaign-cast.js';
import { api } from './helpers.js';
import { seedLeadCast } from './lead-cast.js';
import { startApp } from './start-app.js';

/*
 * A12 (F03 rules 18–20, edge cases 5 and 11). Dates are fixed: 2026-10-08 is a Thursday,
 * 2026-10-09 a Friday (off), 2026-10-10 a Saturday. Follow-up dates are set in the database,
 * since the API only takes dates from today on.
 */
describe('lead follow-up reminders (F03 A12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedLeadCast>>;
  let reminders: DailyReminders;

  const setFollowUp = (id: string, date: string) =>
    db.update(leads).set({ nextFollowUpOn: date }).where(eq(leads.id, id));

  const recipientsOf = async (id: string, type: 'lead_follow_up_due' | 'lead_follow_up_overdue') =>
    (
      await db
        .select({ recipientId: notifications.recipientId })
        .from(notifications)
        .where(and(eq(notifications.subjectId, id), eq(notifications.type, type)))
    )
      .map((row) => row.recipientId)
      .sort();

  const clearSalesManagers = () =>
    db
      .update(departments)
      .set({ managerId: null })
      .where(inArray(departments.code, ['general_communication', 'marketing']));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedLeadCast(db, client);
    reminders = app.get(DailyReminders);
    await clearSalesManagers();
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('reminds the owner on the date, once, and a Friday date on Saturday', async () => {
    const thursday = await cast.createLead();
    const friday = await cast.createLead();
    await setFollowUp(thursday.id, '2026-10-08');
    await setFollowUp(friday.id, '2026-10-09');
    await reminders.runDaily('2026-10-08');
    expect(await recipientsOf(thursday.id, 'lead_follow_up_due')).toEqual([cast.am.id]);
    expect(await recipientsOf(friday.id, 'lead_follow_up_due')).toEqual([]);
    // Friday is off: no run sends anything.
    await reminders.runDaily('2026-10-09');
    expect(await recipientsOf(friday.id, 'lead_follow_up_due')).toEqual([]);
    await reminders.runDaily('2026-10-10');
    await reminders.runDaily('2026-10-10');
    expect(await recipientsOf(friday.id, 'lead_follow_up_due')).toEqual([cast.am.id]);
    expect(await recipientsOf(thursday.id, 'lead_follow_up_due')).toEqual([cast.am.id]);
  });

  it('escalates after two full work days to the owner only without sales managers', async () => {
    const lead = await cast.createLead();
    await setFollowUp(lead.id, '2026-10-09');
    await reminders.runDaily('2026-10-11');
    expect(await recipientsOf(lead.id, 'lead_follow_up_overdue')).toEqual([]);
    await reminders.runDaily('2026-10-12');
    expect(await recipientsOf(lead.id, 'lead_follow_up_overdue')).toEqual([cast.am.id]);
  });

  it('escalates to the owner and the sales managers, once per date', async () => {
    const communicationManager = await cast.signedIn({
      departments: [{ code: 'general_communication', manager: true }],
    });
    const marketingManager = await cast.signedIn({
      departments: [{ code: 'marketing', manager: true }],
    });
    const lead = await cast.createLead();
    await setFollowUp(lead.id, '2026-10-12');
    await reminders.runDaily('2026-10-14');
    await reminders.runDaily('2026-10-14');
    await reminders.runDaily('2026-10-15');
    const [owner] = await db
      .select({ recipientId: notifications.recipientId, data: notifications.data })
      .from(notifications)
      .where(
        and(
          eq(notifications.subjectId, lead.id),
          eq(notifications.type, 'lead_follow_up_overdue'),
          eq(notifications.recipientId, cast.am.id),
        ),
      );
    expect(owner?.data).toEqual({
      lead: lead.displayName,
      followUpOn: '2026-10-12',
      owner: cast.am.name,
    });
    expect(await recipientsOf(lead.id, 'lead_follow_up_overdue')).toEqual(
      [cast.am.id, communicationManager.id, marketingManager.id].sort(),
    );
    // A new date starts the cycle again (rule 20).
    await setFollowUp(lead.id, '2026-10-15');
    await reminders.runDaily('2026-10-15');
    expect(await recipientsOf(lead.id, 'lead_follow_up_due')).toEqual([cast.am.id]);
    await clearSalesManagers();
  });

  it('skips archived and closed leads', async () => {
    const archived = await cast.createLead();
    const lost = await cast.createLead();
    await setFollowUp(archived.id, '2026-10-17');
    await client.post(`/api/leads/${archived.id}/archive`, cast.communicator.cookie);
    await ok(
      await client.post(`/api/leads/${lost.id}/lose`, cast.communicator.cookie, {
        reason: 'price',
      }),
      loseLeadResultSchema,
    );
    await reminders.runDaily('2026-10-17');
    await reminders.runDaily('2026-10-20');
    for (const id of [archived.id, lost.id]) {
      expect(await recipientsOf(id, 'lead_follow_up_due')).toEqual([]);
      expect(await recipientsOf(id, 'lead_follow_up_overdue')).toEqual([]);
    }
    // Restored, its passed date is reminded by the next run (rule 12).
    expect(
      (await client.post(`/api/leads/${archived.id}/restore`, cast.communicator.cookie)).status,
    ).toBe(204);
    await reminders.runDaily('2026-10-21');
    expect(await recipientsOf(archived.id, 'lead_follow_up_overdue')).toEqual([cast.am.id]);
  });
});
