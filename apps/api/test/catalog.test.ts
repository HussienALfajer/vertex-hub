import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  type CatalogPackage,
  type CatalogService,
  type CreateCatalogPackageInput,
  type CreateCatalogServiceInput,
  catalogPackagePageSchema,
  catalogPackageSchema,
  catalogServicePageSchema,
  catalogServiceSchema,
  templateDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, createDatabase, workTemplates } from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectError, seedClientCast } from './client-cast.js';
import { api, removeCatalog, removeTemplates } from './helpers.js';
import { startApp } from './start-app.js';

describe('catalog', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedClientCast>>;
  let finance: { cookie: string };
  let designManager: { cookie: string };
  let projectTemplateId: string;
  let monthlyTemplateId: string;
  let archivedTemplateId: string;
  const services: string[] = [];
  const packages: string[] = [];
  const templates: string[] = [];

  const name = (label: string) => `${label} ${cast.run} ${randomUUID().slice(0, 6)}`;
  const patch = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', path, { cookie, body });
  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  const serviceInput = (input: Partial<CreateCatalogServiceInput> = {}) => ({
    name: name('خدمة'),
    department: 'design',
    billing: 'monthly',
    priceUsdMinor: 1500,
    deliverableKind: 'design',
    ...input,
  });

  async function createService(input: Partial<CreateCatalogServiceInput> = {}) {
    const response = await client.post(
      '/api/catalog/services',
      cast.gm.cookie,
      serviceInput(input),
    );
    if (response.status !== 201) {
      throw new Error(`Service creation failed: ${response.status} ${await response.text()}`);
    }
    const created = catalogServiceSchema.parse(await response.json());
    services.push(created.id);
    return created;
  }

  async function createPackage(input: Partial<CreateCatalogPackageInput> & { items: unknown[] }) {
    const response = await client.post('/api/catalog/packages', cast.gm.cookie, {
      name: name('باقة'),
      billing: 'monthly',
      priceUsdMinor: 45000,
      ...input,
    });
    if (response.status !== 201) {
      throw new Error(`Package creation failed: ${response.status} ${await response.text()}`);
    }
    const created = catalogPackageSchema.parse(await response.json());
    packages.push(created.id);
    return created;
  }

  async function seedTemplateId(kind: 'project' | 'retainer_cycle') {
    const [row] = await db
      .select({ id: workTemplates.id })
      .from(workTemplates)
      .where(and(eq(workTemplates.kind, kind), isNull(workTemplates.archivedAt)))
      .limit(1);
    if (!row) throw new Error(`No ${kind} template`);
    return row.id;
  }

  beforeAll(async () => {
    let url: string;
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedClientCast(db, client);
    const financeUser = await client.signInWithTwoFactor(db, { roles: ['finance'] });
    cast.trackUser(financeUser.id);
    finance = financeUser;
    designManager = await cast.signedIn({ departments: [{ code: 'design', manager: true }] });
    projectTemplateId = await seedTemplateId('project');
    monthlyTemplateId = await seedTemplateId('retainer_cycle');
    const response = await client.post('/api/templates', cast.gm.cookie, {
      name: name('قالب'),
      kind: 'project',
      stages: [],
      steps: [{ key: 'a', title: 'Step', department: 'design', dueDay: 1 }],
      assignees: [],
    });
    expect(response.status).toBe(201);
    archivedTemplateId = templateDetailSchema.parse(await response.json()).id;
    templates.push(archivedTemplateId);
    expect(
      (await client.post(`/api/templates/${archivedTemplateId}/archive`, cast.gm.cookie)).status,
    ).toBe(200);
  });

  afterAll(async () => {
    await app?.close();
    await removeCatalog(db, services, packages);
    await removeTemplates(db, templates);
    await cast?.cleanup();
    await connection.close();
  });

  it('requires a session', async () => {
    const id = randomUUID();
    expect((await client.get('/api/catalog/services')).status).toBe(401);
    expect((await client.post('/api/catalog/services', undefined, serviceInput())).status).toBe(
      401,
    );
    expect((await patch(`/api/catalog/services/${id}`, undefined, {})).status).toBe(401);
    expect((await client.post(`/api/catalog/services/${id}/archive`)).status).toBe(401);
    expect((await client.post(`/api/catalog/services/${id}/restore`)).status).toBe(401);
    expect((await client.get('/api/catalog/packages')).status).toBe(401);
    expect((await client.get(`/api/catalog/packages/${id}`)).status).toBe(401);
    expect((await client.post('/api/catalog/packages', undefined, {})).status).toBe(401);
    expect((await patch(`/api/catalog/packages/${id}`, undefined, {})).status).toBe(401);
    expect((await client.post(`/api/catalog/packages/${id}/archive`)).status).toBe(401);
    expect((await client.post(`/api/catalog/packages/${id}/restore`)).status).toBe(401);
  });

  describe('access', () => {
    it('lets catalog readers list and an ordinary employee nothing', async () => {
      for (const cookie of [cast.am.cookie, finance.cookie, designManager.cookie]) {
        expect((await client.get('/api/catalog/services', cookie)).status).toBe(200);
        expect((await client.get('/api/catalog/packages', cookie)).status).toBe(200);
      }
      expect((await client.get('/api/catalog/services', cast.employee.cookie)).status).toBe(403);
      expect((await client.get('/api/catalog/packages', cast.employee.cookie)).status).toBe(403);
      expect(
        (await client.get(`/api/catalog/packages/${randomUUID()}`, cast.employee.cookie)).status,
      ).toBe(403);
    });

    it('keeps changes and archived lists to catalog managers', async () => {
      const service = await createService();
      const pkg = await createPackage({ items: [{ serviceId: service.id, quantity: 2 }] });
      for (const cookie of [cast.am.cookie, finance.cookie, designManager.cookie]) {
        expect((await client.post('/api/catalog/services', cookie, serviceInput())).status).toBe(
          403,
        );
        expect((await patch(`/api/catalog/services/${service.id}`, cookie, {})).status).toBe(403);
        expect(
          (await client.post(`/api/catalog/services/${service.id}/archive`, cookie)).status,
        ).toBe(403);
        expect(
          (await client.post(`/api/catalog/services/${service.id}/restore`, cookie)).status,
        ).toBe(403);
        expect((await client.post('/api/catalog/packages', cookie, {})).status).toBe(403);
        expect((await patch(`/api/catalog/packages/${pkg.id}`, cookie, {})).status).toBe(403);
        expect((await client.post(`/api/catalog/packages/${pkg.id}/archive`, cookie)).status).toBe(
          403,
        );
        expect((await client.post(`/api/catalog/packages/${pkg.id}/restore`, cookie)).status).toBe(
          403,
        );
        expect((await client.get('/api/catalog/services?archived=true', cookie)).status).toBe(403);
        expect((await client.get('/api/catalog/packages?archived=true', cookie)).status).toBe(403);
      }
    });

    it('lets the Operations manager manage the catalog', async () => {
      const response = await client.post(
        '/api/catalog/services',
        cast.operations.cookie,
        serviceInput(),
      );
      expect(response.status).toBe(201);
      services.push(catalogServiceSchema.parse(await response.json()).id);
    });
  });

  describe('services', () => {
    it('creates a service with its defaults and an audit entry', async () => {
      const service = await createService({
        name: `  ${name('تصميم')}  `,
        priceSypMinor: 200000,
        templateId: monthlyTemplateId,
      });
      expect(service).toMatchObject({
        description: null,
        billing: 'monthly',
        priceUsdMinor: 1500,
        priceSypMinor: 200000,
        revisionRounds: 2,
        deliverableKind: 'design',
        deliverableLabel: null,
        template: { id: monthlyTemplateId, kind: 'retainer_cycle', archived: false },
        archivedAt: null,
      });
      expect(service.name).toBe(service.name.trim());
      const [entry] = await auditOf(service.id);
      expect(entry).toMatchObject({
        action: 'catalog_service.created',
        entityType: 'catalog_service',
        actorId: cast.gm.id,
      });
      expect(entry?.after).toMatchObject({ priceUsdMinor: 1500, templateId: monthlyTemplateId });
    });

    it('refuses a taken name, case-insensitively, until the other service is archived', async () => {
      const first = await createService({ name: name('Reel').toUpperCase() });
      await expectError(
        await client.post(
          '/api/catalog/services',
          cast.gm.cookie,
          serviceInput({ name: first.name.toLowerCase() }),
        ),
        409,
        'SERVICE_NAME_TAKEN',
      );
      expect(
        (await client.post(`/api/catalog/services/${first.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      const second = await createService({ name: first.name.toLowerCase() });
      expect(second.name).toBe(first.name.toLowerCase());
      await expectError(
        await client.post(`/api/catalog/services/${first.id}/restore`, cast.gm.cookie),
        409,
        'SERVICE_NAME_TAKEN',
      );
    });

    it('checks the template: kind by billing, not archived, existing (C3)', async () => {
      for (const input of [
        { templateId: projectTemplateId },
        { billing: 'one_off', deliverableKind: null, templateId: monthlyTemplateId },
        { billing: 'one_off', deliverableKind: null, templateId: archivedTemplateId },
        { templateId: randomUUID() },
      ] as const) {
        await expectError(
          await client.post('/api/catalog/services', cast.gm.cookie, serviceInput(input)),
          400,
          'INVALID_TEMPLATE',
        );
      }
      const oneOff = await createService({
        billing: 'one_off',
        deliverableKind: null,
        templateId: projectTemplateId,
        revisionRounds: 3,
      });
      expect(oneOff.template?.kind).toBe('project');
    });

    it('counts only monthly services, with a label for "other" (C4)', async () => {
      const bad = [
        { billing: 'one_off', deliverableKind: 'design' },
        { deliverableKind: 'other' },
        { deliverableKind: null, deliverableLabel: 'Newsletter' },
        { revisionRounds: 21 },
        { priceUsdMinor: -1 },
      ] as const;
      for (const input of bad) {
        expect(
          (await client.post('/api/catalog/services', cast.gm.cookie, serviceInput(input))).status,
        ).toBe(400);
      }
      const other = await createService({ deliverableKind: 'other', deliverableLabel: 'نشرة' });
      expect(other.deliverableLabel).toBe('نشرة');
    });

    it('edits prices with an audit entry of before and after (C2)', async () => {
      const service = await createService();
      const response = await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, {
        priceUsdMinor: 2000,
        priceSypMinor: 300000,
      });
      expect(response.status).toBe(200);
      expect(catalogServiceSchema.parse(await response.json())).toMatchObject({
        priceUsdMinor: 2000,
        priceSypMinor: 300000,
        deliverableKind: 'design',
      });
      const entries = await auditOf(service.id);
      expect(entries.at(-1)).toMatchObject({
        action: 'catalog_service.updated',
        before: { priceUsdMinor: 1500, priceSypMinor: null },
        after: { priceUsdMinor: 2000, priceSypMinor: 300000 },
      });
      const unchanged = await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, {
        priceUsdMinor: 2000,
      });
      expect(unchanged.status).toBe(200);
      expect(await auditOf(service.id)).toHaveLength(entries.length);
    });

    it('checks the merged service on a partial update', async () => {
      const service = await createService();
      expect(
        (await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, { billing: 'one_off' }))
          .status,
      ).toBe(400);
      const changed = await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, {
        billing: 'one_off',
        deliverableKind: null,
      });
      expect(changed.status).toBe(200);
      const withTemplate = await createService({ templateId: monthlyTemplateId });
      await expectError(
        await patch(`/api/catalog/services/${withTemplate.id}`, cast.gm.cookie, {
          billing: 'one_off',
          deliverableKind: null,
        }),
        400,
        'INVALID_TEMPLATE',
      );
    });

    it('locks the billing once a package uses the service', async () => {
      const service = await createService();
      await createPackage({ items: [{ serviceId: service.id, quantity: 4 }] });
      await expectError(
        await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, {
          billing: 'one_off',
          deliverableKind: null,
        }),
        409,
        'SERVICE_IN_USE',
      );
      expect(
        (await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, { revisionRounds: 4 }))
          .status,
      ).toBe(200);
    });

    it('answers 404 for an unknown service', async () => {
      const id = randomUUID();
      expect((await patch(`/api/catalog/services/${id}`, cast.gm.cookie, {})).status).toBe(404);
      expect(
        (await client.post(`/api/catalog/services/${id}/archive`, cast.gm.cookie)).status,
      ).toBe(404);
    });

    it('refuses to archive a service of an active package (C1), then archives and restores', async () => {
      const service = await createService();
      const pkg = await createPackage({ items: [{ serviceId: service.id, quantity: 1 }] });
      const refused = await expectError(
        await client.post(`/api/catalog/services/${service.id}/archive`, cast.gm.cookie),
        409,
        'SERVICE_IN_PACKAGE',
      );
      expect(refused.details).toEqual({ packages: [{ id: pkg.id, name: pkg.name }] });

      expect(
        (await client.post(`/api/catalog/packages/${pkg.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      const archived = await client.post(
        `/api/catalog/services/${service.id}/archive`,
        cast.gm.cookie,
      );
      expect(archived.status).toBe(200);
      expect(catalogServiceSchema.parse(await archived.json()).archivedAt).not.toBeNull();
      await expectError(
        await client.post(`/api/catalog/services/${service.id}/archive`, cast.gm.cookie),
        409,
        'SERVICE_ARCHIVED',
      );
      await expectError(
        await patch(`/api/catalog/services/${service.id}`, cast.gm.cookie, { priceUsdMinor: 1 }),
        409,
        'SERVICE_ARCHIVED',
      );

      const listed = await client.get(
        `/api/catalog/services?archived=true&search=${encodeURIComponent(service.name)}`,
        cast.gm.cookie,
      );
      expect(catalogServicePageSchema.parse(await listed.json()).items.map((s) => s.id)).toEqual([
        service.id,
      ]);
      const active = await client.get(
        `/api/catalog/services?search=${encodeURIComponent(service.name)}`,
        cast.am.cookie,
      );
      expect(catalogServicePageSchema.parse(await active.json()).total).toBe(0);

      expect(
        (await client.post(`/api/catalog/services/${service.id}/restore`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/catalog/services/${service.id}/restore`, cast.gm.cookie),
        409,
        'SERVICE_NOT_ARCHIVED',
      );
      expect((await auditOf(service.id)).map((entry) => entry.action)).toEqual([
        'catalog_service.created',
        'catalog_service.archived',
        'catalog_service.restored',
      ]);
    });

    it('filters by billing, department and name, by name order', async () => {
      const label = name('مرشّح');
      const a = await createService({ name: `${label} ب`, department: 'photography' });
      const b = await createService({
        name: `${label} أ`,
        billing: 'one_off',
        deliverableKind: null,
        department: 'design',
      });
      const list = async (query: string) => {
        const response = await client.get(
          `/api/catalog/services?search=${encodeURIComponent(label)}${query}`,
          designManager.cookie,
        );
        expect(response.status).toBe(200);
        return catalogServicePageSchema.parse(await response.json()).items.map((s) => s.id);
      };
      expect(await list('')).toEqual([b.id, a.id]);
      expect(await list('&billing=monthly')).toEqual([a.id]);
      expect(await list('&department=design')).toEqual([b.id]);
    });
  });

  describe('packages', () => {
    let design: CatalogService;
    let reel: CatalogService;
    let management: CatalogService;
    let brand: CatalogService;

    beforeAll(async () => {
      design = await createService({ name: name('تصميم'), deliverableKind: 'design' });
      reel = await createService({
        name: name('ريل'),
        deliverableKind: 'reel',
        department: 'photography',
      });
      management = await createService({
        name: name('إدارة صفحة'),
        deliverableKind: null,
        department: 'content_management',
        priceUsdMinor: 10000,
      });
      brand = await createService({
        name: name('هوية'),
        billing: 'one_off',
        deliverableKind: null,
        priceUsdMinor: 80000,
      });
    });

    it('creates a monthly package with its items in order and an audit entry', async () => {
      const pkg = await createPackage({
        templateId: monthlyTemplateId,
        items: [
          { serviceId: design.id, quantity: 12 },
          { serviceId: reel.id, quantity: 4 },
          { serviceId: management.id, quantity: 2 },
        ],
      });
      expect(pkg).toMatchObject({
        billing: 'monthly',
        priceUsdMinor: 45000,
        priceSypMinor: null,
        template: { id: monthlyTemplateId },
        items: [
          {
            serviceId: design.id,
            name: design.name,
            quantity: 12,
            deliverableKind: 'design',
            archived: false,
          },
          { serviceId: reel.id, quantity: 4, department: 'photography' },
          { serviceId: management.id, quantity: 2, deliverableKind: null },
        ],
      });
      const [entry] = await auditOf(pkg.id);
      expect(entry).toMatchObject({
        action: 'catalog_package.created',
        entityType: 'catalog_package',
      });
      expect(entry?.after).toMatchObject({
        items: [
          { serviceId: design.id, quantity: 12 },
          { serviceId: reel.id, quantity: 4 },
          { serviceId: management.id, quantity: 2 },
        ],
      });

      const detail = await client.get(`/api/catalog/packages/${pkg.id}`, finance.cookie);
      expect(detail.status).toBe(200);
      expect(catalogPackageSchema.parse(await detail.json())).toEqual(pkg);
    });

    it('needs active services of the package billing', async () => {
      const archived = await createService();
      expect(
        (await client.post(`/api/catalog/services/${archived.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      for (const serviceId of [brand.id, archived.id, randomUUID()]) {
        const refused = await expectError(
          await client.post('/api/catalog/packages', cast.gm.cookie, {
            name: name('باقة'),
            billing: 'monthly',
            priceUsdMinor: 100,
            items: [
              { serviceId: design.id, quantity: 1 },
              { serviceId, quantity: 1 },
            ],
          }),
          400,
          'INVALID_PACKAGE_ITEM',
        );
        expect(refused.details).toEqual({ serviceIds: [serviceId] });
      }
    });

    it('links a monthly template to monthly packages only', async () => {
      const body = (input: object) => ({
        name: name('باقة'),
        billing: 'one_off',
        priceUsdMinor: 100,
        items: [{ serviceId: brand.id, quantity: 1 }],
        ...input,
      });
      expect(
        (
          await client.post(
            '/api/catalog/packages',
            cast.gm.cookie,
            body({ templateId: projectTemplateId }),
          )
        ).status,
      ).toBe(400);
      await expectError(
        await client.post(
          '/api/catalog/packages',
          cast.gm.cookie,
          body({
            billing: 'monthly',
            templateId: projectTemplateId,
            items: [{ serviceId: design.id, quantity: 1 }],
          }),
        ),
        400,
        'INVALID_TEMPLATE',
      );
      const oneOff = await createPackage(body({}) as CreateCatalogPackageInput);
      expect(oneOff.template).toBeNull();
    });

    it('refuses a taken name and limits the items', async () => {
      const pkg = await createPackage({ items: [{ serviceId: design.id, quantity: 1 }] });
      await expectError(
        await client.post('/api/catalog/packages', cast.gm.cookie, {
          name: pkg.name.toUpperCase(),
          billing: 'monthly',
          priceUsdMinor: 1,
          items: [{ serviceId: design.id, quantity: 1 }],
        }),
        409,
        'PACKAGE_NAME_TAKEN',
      );
      expect(
        (
          await client.post('/api/catalog/packages', cast.gm.cookie, {
            name: name('باقة'),
            billing: 'monthly',
            priceUsdMinor: 1,
            items: [],
          })
        ).status,
      ).toBe(400);
    });

    it('replaces the items as a whole and audits the change', async () => {
      const pkg = await createPackage({
        items: [
          { serviceId: design.id, quantity: 12 },
          { serviceId: reel.id, quantity: 4 },
        ],
      });
      const response = await patch(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie, {
        priceUsdMinor: 50000,
        items: [
          { serviceId: reel.id, quantity: 6 },
          { serviceId: design.id, quantity: 10 },
        ],
      });
      expect(response.status).toBe(200);
      const updated = catalogPackageSchema.parse(await response.json());
      expect(updated.items.map((item) => [item.serviceId, item.quantity])).toEqual([
        [reel.id, 6],
        [design.id, 10],
      ]);
      expect((await auditOf(pkg.id)).at(-1)).toMatchObject({
        action: 'catalog_package.updated',
        before: {
          priceUsdMinor: 45000,
          items: [
            { serviceId: design.id, quantity: 12 },
            { serviceId: reel.id, quantity: 4 },
          ],
        },
        after: { priceUsdMinor: 50000 },
      });
    });

    it('records only real changes when the whole package is saved again', async () => {
      const items = [
        { serviceId: design.id, quantity: 12 },
        { serviceId: reel.id, quantity: 4 },
      ];
      const pkg = await createPackage({ items });
      const save = (priceUsdMinor: number) =>
        patch(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie, {
          name: pkg.name,
          billing: 'monthly',
          priceUsdMinor,
          items,
        });
      expect((await save(46000)).status).toBe(200);
      const entries = await auditOf(pkg.id);
      expect(entries.at(-1)).toMatchObject({ action: 'catalog_package.updated' });
      expect(entries.at(-1)?.after).toEqual({ priceUsdMinor: 46000 });
      expect((await save(46000)).status).toBe(200);
      expect(await auditOf(pkg.id)).toHaveLength(entries.length);
    });

    it('checks the items against a changed billing', async () => {
      const pkg = await createPackage({ items: [{ serviceId: design.id, quantity: 1 }] });
      await expectError(
        await patch(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie, { billing: 'one_off' }),
        400,
        'INVALID_PACKAGE_ITEM',
      );
      const changed = await patch(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie, {
        billing: 'one_off',
        items: [{ serviceId: brand.id, quantity: 1 }],
      });
      expect(changed.status).toBe(200);
    });

    it('archives and restores; archived packages are hidden from readers', async () => {
      const pkg: CatalogPackage = await createPackage({
        items: [{ serviceId: design.id, quantity: 1 }],
      });
      expect(
        (await client.post(`/api/catalog/packages/${pkg.id}/archive`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/catalog/packages/${pkg.id}/archive`, cast.gm.cookie),
        409,
        'PACKAGE_ARCHIVED',
      );
      await expectError(
        await patch(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie, { priceUsdMinor: 1 }),
        409,
        'PACKAGE_ARCHIVED',
      );
      expect((await client.get(`/api/catalog/packages/${pkg.id}`, cast.am.cookie)).status).toBe(
        404,
      );
      expect((await client.get(`/api/catalog/packages/${pkg.id}`, cast.gm.cookie)).status).toBe(
        200,
      );
      const archivedList = await client.get(
        `/api/catalog/packages?archived=true&search=${encodeURIComponent(pkg.name)}`,
        cast.operations.cookie,
      );
      expect(catalogPackagePageSchema.parse(await archivedList.json()).items[0]?.id).toBe(pkg.id);

      expect(
        (await client.post(`/api/catalog/packages/${pkg.id}/restore`, cast.gm.cookie)).status,
      ).toBe(200);
      await expectError(
        await client.post(`/api/catalog/packages/${pkg.id}/restore`, cast.gm.cookie),
        409,
        'PACKAGE_NOT_ARCHIVED',
      );
      expect((await auditOf(pkg.id)).map((entry) => entry.action)).toEqual([
        'catalog_package.created',
        'catalog_package.archived',
        'catalog_package.restored',
      ]);
    });

    it('answers 404 for an unknown package', async () => {
      const id = randomUUID();
      expect((await client.get(`/api/catalog/packages/${id}`, cast.gm.cookie)).status).toBe(404);
      expect((await patch(`/api/catalog/packages/${id}`, cast.gm.cookie, {})).status).toBe(404);
    });

    it('filters packages by billing and name', async () => {
      const label = name('مرشّح باقة');
      const monthly = await createPackage({
        name: `${label} 1`,
        items: [{ serviceId: design.id, quantity: 1 }],
      });
      const oneOff = await createPackage({
        name: `${label} 2`,
        billing: 'one_off',
        items: [{ serviceId: brand.id, quantity: 1 }],
      });
      const list = async (query: string) => {
        const response = await client.get(
          `/api/catalog/packages?search=${encodeURIComponent(label)}${query}`,
          cast.am.cookie,
        );
        return catalogPackagePageSchema.parse(await response.json()).items.map((p) => p.id);
      };
      expect(await list('')).toEqual([monthly.id, oneOff.id]);
      expect(await list('&billing=one_off')).toEqual([oneOff.id]);
    });
  });
});
