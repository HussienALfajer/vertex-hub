import type { INestApplication } from '@nestjs/common';
import {
  businessDate,
  CONTRACT_LIMITS,
  contractArticlesResponseSchema,
  contractSettingsSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  contractArticleTemplates,
  contractSettings,
  createDatabase,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api } from './helpers.js';
import { startApp } from './start-app.js';

describe('contract settings (F05C)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { id: string; cookie: string };
  let savedSettings: typeof contractSettings.$inferSelect;
  let savedArticles: (typeof contractArticleTemplates.$inferSelect)[];

  const patch = (cookie: string | undefined, body: unknown) =>
    client.request('PATCH', '/api/contract-settings', { cookie, body });
  const putArticles = (cookie: string | undefined, body: unknown) =>
    client.request('PUT', '/api/contract-settings/articles', { cookie, body });
  const read = async (cookie: string) => {
    const response = await client.get('/api/contract-settings', cookie);
    expect(response.status).toBe(200);
    return contractSettingsSchema.parse(await response.json());
  };
  const lastAudit = async (action: string) => {
    const [entry] = await db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityType, 'contract_settings'), eq(auditEntries.action, action)))
      .orderBy(desc(auditEntries.id))
      .limit(1);
    return entry;
  };

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    finance = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(finance.id);
    [savedSettings] = (await db.select().from(contractSettings)) as [
      typeof contractSettings.$inferSelect,
    ];
    savedArticles = await db.select().from(contractArticleTemplates);
  });

  afterAll(async () => {
    await app?.close();
    if (savedSettings) await db.update(contractSettings).set(savedSettings);
    if (savedArticles) {
      // Test-only cleanup: the template returns to its seeded rows.
      const ids = savedArticles.map(({ id }) => id);
      await db.delete(contractArticleTemplates).where(notInArray(contractArticleTemplates.id, ids));
      for (const row of savedArticles) {
        await db
          .update(contractArticleTemplates)
          .set(row)
          .where(eq(contractArticleTemplates.id, row.id));
      }
    }
    await db.delete(auditEntries).where(eq(auditEntries.entityType, 'contract_settings'));
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    expect((await client.get('/api/contract-settings')).status).toBe(401);
    expect((await patch(undefined, {})).status).toBe(401);
    expect((await putArticles(undefined, { articles: [] })).status).toBe(401);
  });

  it('are read by contract managers with money access, with the seeded defaults', async () => {
    const settings = await read(cast.am.cookie);
    const year = Number(businessDate().slice(0, 4));
    expect(settings).toMatchObject({
      numberPrefix: 'VM-CCS',
      nextNumber: `VM-CCS-${year}-001`,
      slogan: 'نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.',
      canEdit: false,
    });
    expect(settings.articles.map(({ title }) => title).slice(0, 2)).toEqual([
      'موضوع العقد',
      'نطاق الخدمات',
    ]);
    expect(settings.articles).toHaveLength(17);
    expect(settings.articles[1]?.body.endsWith('\n{services}')).toBe(true);
    expect((await read(cast.gm.cookie)).canEdit).toBe(true);
    expect((await read(cast.operations.cookie)).canEdit).toBe(true);
    // Finance has money access but does not manage retainers; an employee has neither.
    expect((await client.get('/api/contract-settings', finance.cookie)).status).toBe(403);
    expect((await client.get('/api/contract-settings', cast.employee.cookie)).status).toBe(403);
  });

  it('let catalog managers edit the agency details, audited (K12)', async () => {
    const response = await patch(cast.operations.cookie, {
      legalName: ' شركة فيرتكس ميديا ',
      tradeName: 'Vertex Media',
      representativeName: 'محمد',
      numberPrefix: 'vm-ct',
    });
    expect(response.status).toBe(200);
    const settings = contractSettingsSchema.parse(await response.json());
    expect(settings).toMatchObject({
      legalName: 'شركة فيرتكس ميديا',
      numberPrefix: 'VM-CT',
      nextNumber: expect.stringMatching(/^VM-CT-\d{4}-001$/),
      updatedBy: { id: cast.operations.id },
    });
    expect(await lastAudit('contract_settings.updated')).toMatchObject({
      before: { legalName: '', tradeName: '', representativeName: '', numberPrefix: 'VM-CCS' },
      after: {
        legalName: 'شركة فيرتكس ميديا',
        tradeName: 'Vertex Media',
        representativeName: 'محمد',
        numberPrefix: 'VM-CT',
      },
    });
    expect((await patch(cast.gm.cookie, { numberPrefix: 'VM CT' })).status).toBe(400);
    expect((await patch(cast.am.cookie, { slogan: 'x' })).status).toBe(403);
    expect((await patch(finance.cookie, { slogan: 'x' })).status).toBe(403);
  });

  it('replace the article template in order, archiving those left out (K12)', async () => {
    const before = (await read(cast.gm.cookie)).articles;
    const [first, second, ...rest] = before;
    if (!first || !second) throw new Error('No seeded articles');
    const response = await putArticles(cast.gm.cookie, {
      articles: [
        { id: second.id, title: second.title, body: second.body },
        { id: first.id, title: 'موضوع العقد المعدل', body: 'بين {agency_name} و{client_name}.' },
        { title: 'مادة جديدة', body: 'خلال {payment_terms_days} يوماً.\n{fees}' },
        ...rest.slice(0, -1),
      ],
    });
    expect(response.status).toBe(200);
    const { articles } = contractArticlesResponseSchema.parse(await response.json());
    expect(articles.map(({ title }) => title).slice(0, 3)).toEqual([
      second.title,
      'موضوع العقد المعدل',
      'مادة جديدة',
    ]);
    expect(articles).toHaveLength(before.length);
    const removed = before.at(-1);
    const [archived] = await db
      .select({ archivedAt: contractArticleTemplates.archivedAt })
      .from(contractArticleTemplates)
      .where(eq(contractArticleTemplates.id, removed?.id ?? ''));
    expect(archived?.archivedAt).not.toBeNull();
    expect((await read(cast.am.cookie)).articles).toEqual(articles);
    const entry = await lastAudit('contract_settings.articles_updated');
    expect(entry?.before).toEqual({ articles: before.map(({ title }) => title) });
    expect(entry?.after).toEqual({ articles: articles.map(({ title }) => title) });

    // An archived article cannot come back by id.
    await expectError(
      await putArticles(cast.gm.cookie, {
        articles: [{ id: removed?.id, title: 'x', body: '' }],
      }),
      400,
      'INVALID_ORDER',
    );
  });

  it('refuses unknown placeholders and more than the limit, unchanged', async () => {
    const before = (await read(cast.gm.cookie)).articles;
    await expectError(
      await putArticles(cast.gm.cookie, {
        articles: [{ title: 'مادة', body: 'السيد {client} يوافق.' }],
      }),
      400,
      'UNKNOWN_PLACEHOLDER',
    );
    await expectError(
      await putArticles(cast.gm.cookie, {
        articles: Array.from({ length: CONTRACT_LIMITS.articles + 1 }, (_, i) => ({
          title: `مادة ${i + 1}`,
          body: '',
        })),
      }),
      409,
      'LIMIT_REACHED',
    );
    expect((await read(cast.gm.cookie)).articles).toEqual(before);
  });

  it('refuses template edits without catalog.manage', async () => {
    expect((await putArticles(cast.am.cookie, { articles: [] })).status).toBe(403);
    expect((await putArticles(finance.cookie, { articles: [] })).status).toBe(403);
    expect((await putArticles(cast.employee.cookie, { articles: [] })).status).toBe(403);
  });

  it('accepts an empty template (no article is required)', async () => {
    const response = await putArticles(cast.gm.cookie, { articles: [] });
    expect(response.status).toBe(200);
    expect(contractArticlesResponseSchema.parse(await response.json()).articles).toEqual([]);
  });
});
