import {
  businessInstant,
  type CreateShootInput,
  cyclePageSchema,
  type NotificationType,
  type ShootDetail,
  shootDetailSchema,
  type TimeOfDay,
} from '@vertex-hub/contracts';
import { auditEntries, type Database, notifications } from '@vertex-hub/db';
import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import type { api } from './helpers.js';
import { seedTaskCast } from './task-cast.js';

/*
 * The people the F11 tests act as, on top of the F06 cast: a photographer and a videographer of
 * Photography and its manager; the designer stands for any other employee. Department managers
 * are global rows: test files run one at a time.
 */

type Api = ReturnType<typeof api>;

export async function seedShootCast(db: Database, client: Api) {
  const cast = await seedTaskCast(db, client);
  const photographer = await cast.signedIn({
    name: `مصور ${cast.run}`,
    departments: [{ code: 'photography' }],
  });
  const videographer = await cast.signedIn({
    name: `مصور فيديو ${cast.run}`,
    departments: [{ code: 'photography' }],
  });
  const photographyManager = await cast.signedIn({
    name: `مدير التصوير ${cast.run}`,
    departments: [{ code: 'photography', manager: true }],
  });

  /** An instant `days` from today at a Damascus time, as the form sends it. */
  const at = (days: number, time: TimeOfDay) =>
    businessInstant(cast.inDays(days), time).toISOString();

  /** An open Photography task of `clientId` (internal when null), created by the GM. */
  const photoTask = (clientId: string | null, input: Record<string, unknown> = {}) =>
    cast.createTask(cast.gm.cookie, {
      title: `تصوير ${cast.run}`,
      department: 'photography',
      clientId,
      needsClientApproval: false,
      ...input,
    });

  /**
   * The fields of a booking: tomorrow 10:00–13:00, the photographer leading, two shots. Tests
   * share the photographer's time, so conflicts are accepted unless a test says otherwise.
   */
  const booking = (input: Partial<CreateShootInput> = {}): CreateShootInput => ({
    title: `جلسة ${cast.run}`,
    type: 'product',
    startsAt: at(1, '10:00'),
    endsAt: at(1, '13:00'),
    location: 'الاستوديو',
    crew: [{ userId: photographer.id, role: 'photographer', isLead: true }],
    shots: [{ text: 'لقطة أمامية' }, { text: 'لقطة جانبية' }],
    acceptConflicts: true,
    ...input,
  });

  const book = (cookie: string | undefined, input: Partial<CreateShootInput>) =>
    client.post('/api/shoots', cookie, booking(input));

  async function bookOk(cookie: string, input: Partial<CreateShootInput>): Promise<ShootDetail> {
    const response = await book(cookie, input);
    if (response.status !== 201) {
      throw new Error(`Booking failed: ${response.status} ${await response.text()}`);
    }
    return shootDetailSchema.parse(await response.json());
  }

  async function detail(id: string, cookie = cast.gm.cookie): Promise<ShootDetail> {
    const response = await client.get(`/api/shoots/${id}`, cookie);
    expect(response.status, await response.clone().text()).toBe(200);
    return shootDetailSchema.parse(await response.json());
  }

  /** The open cycle of a new retainer of the client with a `photo_shoot` line of 1. */
  async function shootRetainer(clientId: string) {
    const retainer = await cast.createRetainer(clientId, {
      departments: ['photography'],
      deliverables: [{ kind: 'photo_shoot', monthlyQuantity: 1 }],
    });
    const read = async () => {
      const response = await client.get(`/api/retainers/${retainer.id}/cycles`, cast.gm.cookie);
      const [cycle] = cyclePageSchema.parse(await response.json()).items;
      const line = cycle?.lines.find((item) => item.kind === 'photo_shoot');
      if (!cycle || !line) throw new Error('The retainer has no open cycle');
      return { cycle, line };
    };
    return { retainer, ...(await read()), read };
  }

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

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

  return {
    ...cast,
    photographer,
    videographer,
    photographyManager,
    at,
    photoTask,
    booking,
    book,
    bookOk,
    detail,
    shootRetainer,
    auditOf,
    typesOf,
  };
}
