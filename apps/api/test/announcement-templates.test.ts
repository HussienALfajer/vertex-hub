import type { INestApplication } from '@nestjs/common';
import {
  type AnnouncementTemplate,
  announcementTemplateListSchema,
  announcementTemplateSchema,
  type CreateAnnouncementTemplateInput,
} from '@vertex-hub/contracts';
import { announcementTemplates, auditEntries, createDatabase } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, removeUsers, seedUser } from './helpers.js';
import { startApp } from './start-app.js';

type Person = { id: string; cookie: string };

describe('announcement templates (F16 rule D12)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  const seeded: string[] = [];
  const shared: string[] = [];
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let author: Person;
  let colleague: Person;
  let gm: Person;

  const input = (
    overrides: Partial<CreateAnnouncementTemplateInput> = {},
  ): CreateAnnouncementTemplateInput => ({
    name: 'دوام رمضان',
    title: 'دوام رمضان',
    body: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'يبدأ الدوام الساعة العاشرة' }] },
      ],
    },
    priority: 'important',
    requiresAck: true,
    ...overrides,
  });

  async function create(person: Person, overrides: Partial<CreateAnnouncementTemplateInput> = {}) {
    const response = await client.post(
      '/api/announcement-templates',
      person.cookie,
      input(overrides),
    );
    expect(response.status).toBe(201);
    const template = announcementTemplateSchema.parse(await response.json());
    if (template.shared) shared.push(template.id);
    return template;
  }

  const list = async (person: Person) =>
    announcementTemplateListSchema.parse(
      await (await client.get('/api/announcement-templates', person.cookie)).json(),
    ).items;

  const patch = (person: Person | undefined, id: string, body: unknown) =>
    client.request('PATCH', `/api/announcement-templates/${id}`, { cookie: person?.cookie, body });

  const auditOf = (id: string) =>
    db.select().from(auditEntries).where(eq(auditEntries.entityId, id));

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    const signedIn = async () => {
      const user = await seedUser(db);
      seeded.push(user.id);
      return { id: user.id, cookie: await client.signIn(user.email) };
    };
    author = await signedIn();
    colleague = await signedIn();
    const general = await client.signInWithTwoFactor(db, { roles: ['general_manager'] });
    seeded.push(general.id);
    gm = { id: general.id, cookie: general.cookie };
  });

  afterAll(async () => {
    await app?.close();
    if (shared.length > 0) {
      await db.delete(auditEntries).where(inArray(auditEntries.entityId, shared));
      await db.delete(announcementTemplates).where(inArray(announcementTemplates.id, shared));
    }
    await removeUsers(db, seeded);
    await connection.close();
  });

  it('answers 401 without a session', async () => {
    const template = await create(author);
    expect((await client.get('/api/announcement-templates')).status).toBe(401);
    expect((await client.post('/api/announcement-templates', undefined, input())).status).toBe(401);
    expect((await patch(undefined, template.id, { name: 'اسم آخر' })).status).toBe(401);
    expect((await client.post(`/api/announcement-templates/${template.id}/archive`)).status).toBe(
      401,
    );
  });

  it('keeps personal templates private to their owner, without audit', async () => {
    const template = await create(author, { name: 'قالبي الخاص' });
    expect(template).toMatchObject({ shared: false, editable: true, requiresAck: true });
    expect((await list(author)).map((t) => t.id)).toContain(template.id);
    expect((await list(colleague)).map((t) => t.id)).not.toContain(template.id);
    expect((await patch(colleague, template.id, { name: 'ليس لي' })).status).toBe(404);
    expect(
      (await client.post(`/api/announcement-templates/${template.id}/archive`, colleague.cookie))
        .status,
    ).toBe(404);
    const renamed = announcementTemplateSchema.parse(
      await (await patch(author, template.id, { name: 'اسم جديد' })).json(),
    );
    expect(renamed.name).toBe('اسم جديد');
    expect(await auditOf(template.id)).toHaveLength(0);
  });

  it('lets only announcements.manage scope all keep shared templates, read by everyone, audited', async () => {
    expect(
      (await client.post('/api/announcement-templates', author.cookie, input({ shared: true })))
        .status,
    ).toBe(403);
    const template = await create(gm, { name: 'قالب الإدارة', shared: true });
    expect(template.shared).toBe(true);
    const seen = (await list(colleague)).find((t) => t.id === template.id) as AnnouncementTemplate;
    expect(seen.editable).toBe(false);
    expect((await patch(colleague, template.id, { name: 'تغيير' })).status).toBe(403);
    expect((await patch(gm, template.id, { name: 'قالب الإدارة المحدث' })).status).toBe(200);
    const archived = await client.post(
      `/api/announcement-templates/${template.id}/archive`,
      gm.cookie,
    );
    expect(archived.status).toBe(200);
    expect((await list(colleague)).map((t) => t.id)).not.toContain(template.id);
    expect((await auditOf(template.id)).map((entry) => entry.action).sort()).toEqual([
      'announcement_template.archived',
      'announcement_template.created',
      'announcement_template.updated',
    ]);
  });

  it('lists personal templates before shared ones', async () => {
    const mine = await create(colleague, { name: 'ي قالب شخصي' });
    const common = await create(gm, { name: 'أ قالب مشترك', shared: true });
    const ids = (await list(colleague)).map((t) => t.id);
    expect(ids.indexOf(mine.id)).toBeLessThan(ids.indexOf(common.id));
  });

  it('keeps the acknowledgement of a critical template and drops a label without a link', async () => {
    const template = await create(author, {
      priority: 'critical',
      requiresAck: false,
      linkUrl: 'https://vertex.example/form',
      linkLabel: 'النموذج',
    });
    expect(template.requiresAck).toBe(true);
    const changed = announcementTemplateSchema.parse(
      await (await patch(author, template.id, { linkUrl: null })).json(),
    );
    expect(changed.linkUrl).toBeNull();
    expect(changed.linkLabel).toBeNull();
  });
});
