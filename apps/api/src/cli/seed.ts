/**
 * Fills the development database with a realistic agency for manual testing: a team in every
 * department, the catalog, leads, quotes, clients, projects, retainers, tasks, content, campaigns,
 * the calendar, invoices and payments. Development only; refuses to run twice.
 *
 *   pnpm --filter @vertex-hub/api db:seed
 *
 * Users are created straight in the database (like `user:create`); everything else goes through
 * the real API as the General Manager, so business rules, audit entries and notifications apply.
 * Every seeded user signs in with `SEED_PASSWORD`. The General Manager's two-factor sign-in is
 * turned off at the end, so the first sign-in shows the setup screen.
 */
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import { NestFactory } from '@nestjs/core';
import {
  type AssignableRole,
  addDays,
  businessDate,
  businessInstant,
  type CalendarDate,
  type DepartmentCode,
  type TimeOfDay,
} from '@vertex-hub/contracts';
import { createDatabase, loadRootEnv } from '@vertex-hub/db';
import { AppModule } from '../app.module.js';
import { configureApp } from '../app.setup.js';
import { createUser, resetTwoFactor, userIdByEmail } from '../modules/auth/index.js';

const SEED_PASSWORD = 'VertexHub-Dev-2026';
const EMAIL_DOMAIN = 'vertexhub.test';
const ADMIN_EMAIL = `admin@${EMAIL_DOMAIN}`;
const ORIGIN = 'http://127.0.0.1:5173';

loadRootEnv();

if (process.env.NODE_ENV === 'production') {
  console.error('The seed is for development databases only.');
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env (see README).');
  process.exit(1);
}

// Team

interface Person {
  key: string;
  name: string;
  department: DepartmentCode;
  roles?: AssignableRole[];
  manager?: boolean;
}

const TEAM: Person[] = [
  {
    key: 'admin',
    name: 'سامر الحلبي',
    department: 'general_management',
    roles: ['general_manager'],
  },
  { key: 'finance', name: 'ريم العلي', department: 'internal_operations', roles: ['finance'] },
  { key: 'ops', name: 'عمر النجار', department: 'internal_operations', manager: true },
  {
    key: 'am1',
    name: 'لينا الخطيب',
    department: 'public_relations',
    roles: ['account_manager'],
    manager: true,
  },
  { key: 'am2', name: 'باسل حداد', department: 'public_relations', roles: ['account_manager'] },
  { key: 'marketingLead', name: 'هبة السيد', department: 'marketing', manager: true },
  { key: 'marketer', name: 'كريم ديب', department: 'marketing' },
  { key: 'designLead', name: 'نور الشامي', department: 'design', manager: true },
  { key: 'designer1', name: 'يزن قاسم', department: 'design' },
  { key: 'designer2', name: 'سلمى عيسى', department: 'design' },
  { key: 'photoLead', name: 'مازن طه', department: 'photography', manager: true },
  { key: 'photographer', name: 'رامي يوسف', department: 'photography' },
  { key: 'videographer', name: 'جود منصور', department: 'photography' },
  { key: 'contentLead', name: 'دانة الأحمد', department: 'content_management', manager: true },
  { key: 'writer1', name: 'تالا حسن', department: 'content_management' },
  { key: 'writer2', name: 'فراس سليمان', department: 'content_management' },
  { key: 'devLead', name: 'أنس المصري', department: 'development', manager: true },
  { key: 'developer', name: 'مهند زين', department: 'development' },
  { key: 'communicator', name: 'رزان عبود', department: 'general_communication', manager: true },
  { key: 'doctor', name: 'د. وسيم الحاج', department: 'medical_consultation', manager: true },
];

// HTTP client

type Body = Record<string, unknown>;
interface Row {
  id: string;
  [key: string]: unknown;
}

const today = businessDate();
const day = (offset: number): CalendarDate => addDays(today, offset);
const at = (offset: number, time: TimeOfDay) => businessInstant(day(offset), time).toISOString();

function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

function httpClient(baseUrl: string) {
  let cookie = '';
  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        ...(cookie && { cookie }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function call<T = Row>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await send(method, path, body);
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}\n${await response.text()}`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
  return {
    get: <T = Row>(path: string) => call<T>('GET', path),
    post: <T = Row>(path: string, body: unknown = {}) => call<T>('POST', path, body),
    put: <T = Row>(path: string, body: unknown) => call<T>('PUT', path, body),
    patch: <T = Row>(path: string, body: unknown) => call<T>('PATCH', path, body),
    /** Signs in as the General Manager and turns on two-factor sign-in, which the role needs. */
    async signInWithTwoFactor(email: string) {
      const signedIn = await send('POST', '/auth/sign-in/email', {
        email,
        password: SEED_PASSWORD,
      });
      if (!signedIn.ok) throw new Error(`Sign-in failed: ${signedIn.status}`);
      cookie = cookieOf(signedIn);
      const { totpURI } = await call<{ totpURI: string }>('POST', '/auth/two-factor/enable', {
        password: SEED_PASSWORD,
      });
      const secret = new URL(totpURI).searchParams.get('secret') ?? '';
      const verified = await send('POST', '/auth/two-factor/verify-totp', { code: totp(secret) });
      if (!verified.ok) throw new Error(`2FA verification failed: ${verified.status}`);
      cookie = cookieOf(verified) || cookie;
    },
  };
}

type Http = ReturnType<typeof httpClient>;

// Data

async function seedData(http: Http, people: Record<string, string>) {
  const log = (line: string) => process.stdout.write(`  ${line}\n`);

  // Department managers (F01).
  const departments = await http.get<{ id: string; code: DepartmentCode }[]>('/departments');
  for (const person of TEAM.filter((p) => p.manager)) {
    const department = departments.find((d) => d.code === person.department);
    if (department)
      await http.patch(`/departments/${department.id}`, { managerId: people[person.key] });
  }
  log('department managers');

  // Catalog (F04).
  const service = (body: Body) => http.post('/catalog/services', body);
  const logo = await service({
    name: 'تصميم شعار',
    department: 'design',
    billing: 'one_off',
    priceUsdMinor: 30_000,
  });
  const identity = await service({
    name: 'هوية بصرية كاملة',
    department: 'design',
    billing: 'one_off',
    priceUsdMinor: 120_000,
  });
  const socialDesign = await service({
    name: 'تصاميم سوشيال ميديا',
    department: 'design',
    billing: 'monthly',
    priceUsdMinor: 2_500,
    deliverableKind: 'design',
  });
  const reels = await service({
    name: 'ريلز',
    department: 'photography',
    billing: 'monthly',
    priceUsdMinor: 6_000,
    deliverableKind: 'reel',
  });
  const posts = await service({
    name: 'كتابة منشورات',
    department: 'content_management',
    billing: 'monthly',
    priceUsdMinor: 1_500,
    deliverableKind: 'post',
  });
  const shoot = await service({
    name: 'جلسة تصوير منتجات',
    department: 'photography',
    billing: 'one_off',
    priceUsdMinor: 25_000,
  });
  const website = await service({
    name: 'موقع تعريفي',
    department: 'development',
    billing: 'one_off',
    priceUsdMinor: 150_000,
  });
  await service({
    name: 'إدارة حملات إعلانية',
    department: 'marketing',
    billing: 'monthly',
    priceUsdMinor: 20_000,
    deliverableKind: 'ad_campaign',
  });
  const gold = await http.post('/catalog/packages', {
    name: 'باقة السوشيال الذهبية',
    description: 'تصاميم وريلز ومنشورات شهرية',
    billing: 'monthly',
    priceUsdMinor: 70_000,
    priceSypMinor: null,
    templateId: null,
    items: [
      { serviceId: socialDesign.id, quantity: 12 },
      { serviceId: reels.id, quantity: 4 },
      { serviceId: posts.id, quantity: 12 },
    ],
  });
  log('catalog: 8 services, 1 package');

  // Clients (F02).
  const clientSpecs = [
    { tradeName: 'مطعم الياسمين', sector: 'مطاعم', am: 'am1' },
    {
      tradeName: 'عيادة الابتسامة لطب الأسنان',
      sector: 'رعاية صحية',
      am: 'am1',
      isHealthcare: true,
    },
    { tradeName: 'متجر لمسة للأزياء', sector: 'أزياء', am: 'am2' },
    { tradeName: 'شركة البناء الحديث', sector: 'عقارات', am: 'am2' },
    { tradeName: 'مقهى الزاوية', sector: 'مطاعم', am: 'am1' },
    { tradeName: 'أكاديمية المستقبل', sector: 'تعليم', am: 'am2' },
    {
      tradeName: 'صيدلية الشفاء',
      sector: 'رعاية صحية',
      am: 'am1',
      isHealthcare: true,
      status: 'paused',
    },
  ];
  const clients: Row[] = [];
  const contacts: Record<string, string> = {};
  for (const [index, spec] of clientSpecs.entries()) {
    const client = await http.post('/clients', {
      tradeName: spec.tradeName,
      sector: spec.sector,
      accountManagerId: people[spec.am],
      isHealthcare: spec.isHealthcare ?? false,
      status: spec.status ?? 'active',
    });
    clients.push(client);
    const contact = await http.post(`/clients/${client.id}/contacts`, {
      name: ['أحمد', 'خالد', 'منى', 'سارة', 'طارق', 'ليلى', 'حسام'][index],
      jobTitle: 'المدير',
      phone: `+96393300${String(index).padStart(4, '0')}`,
      email: `client${index + 1}@${EMAIL_DOMAIN}`,
      hasFinalApproval: true,
    });
    contacts[client.id] = contact.id;
    await http.post(`/clients/${client.id}/contacts`, {
      name: 'مسؤول التسويق',
      phone: `+96394400${String(index).padStart(4, '0')}`,
      hasFinalApproval: false,
    });
    await http.post(`/clients/${client.id}/platform-accounts`, {
      platform: 'instagram',
      url: `https://instagram.com/client${index + 1}`,
      agencyAccess: index % 2 === 0 ? 'granted' : 'pending',
    });
    await http.post(`/clients/${client.id}/notes`, {
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
      channel: 'meeting',
      contactId: contact.id,
      summary: 'اجتماع تعارف: ناقشنا أهداف العميل للربع القادم.',
    });
  }
  const [restaurant, clinic, fashion, construction, cafe, academy] = clients as [
    Row,
    Row,
    Row,
    Row,
    Row,
    Row,
  ];
  log(`clients: ${clients.length} with contacts, platform accounts and notes`);

  // Leads (F03).
  const leadSpecs = [
    { contactName: 'محمد سعيد', companyName: 'فندق النخيل', source: 'instagram', stage: 'new' },
    {
      contactName: 'ياسمين علي',
      companyName: 'مركز تجميل روز',
      source: 'referral',
      stage: 'contacted',
    },
    {
      contactName: 'جورج خوري',
      companyName: 'معرض السيارات الأول',
      source: 'website',
      stage: 'meeting',
    },
    {
      contactName: 'هالة مراد',
      companyName: 'مخبز السنابل',
      source: 'whatsapp',
      stage: 'contacted',
    },
    { contactName: 'وائل الصباغ', companyName: 'شركة نقل سريع', source: 'paid_ad', stage: 'lost' },
    { contactName: 'رنا عثمان', companyName: 'روضة البراعم', source: 'facebook', stage: 'new' },
  ];
  const leads: Row[] = [];
  for (const [index, spec] of leadSpecs.entries()) {
    const lead = await http.post('/leads', {
      contactName: spec.contactName,
      companyName: spec.companyName,
      phone: `+96395500${String(index).padStart(4, '0')}`,
      email: `lead${index + 1}@${EMAIL_DOMAIN}`,
      source: spec.source,
      request: 'يرغب بإدارة حسابات التواصل الاجتماعي وتصميم هوية.',
      nextFollowUpOn: day(index % 3),
      ownerId: people[index % 2 === 0 ? 'am1' : 'am2'],
    });
    leads.push(lead);
    await http.post(`/leads/${lead.id}/notes`, {
      occurredAt: new Date().toISOString(),
      channel: 'call',
      summary: 'مكالمة أولى، طلب عرض سعر مبدئي.',
    });
    if (spec.stage === 'contacted' || spec.stage === 'meeting') {
      await http.post(`/leads/${lead.id}/stage`, { stage: 'contacted', nextFollowUpOn: day(2) });
    }
    if (spec.stage === 'meeting') {
      await http.post(`/leads/${lead.id}/stage`, { stage: 'meeting', nextFollowUpOn: day(3) });
    }
    if (spec.stage === 'lost') {
      await http.post(`/leads/${lead.id}/lose`, {
        reason: 'price',
        note: 'الميزانية أقل من المطلوب',
      });
    }
  }
  log(`leads: ${leads.length} across stages`);

  // Quotes (F04): a lead quote sent, a client draft, a sent one, and two accepted.
  async function draftQuote(
    owner: { clientId?: string; leadId?: string },
    title: string,
    lines: Body[],
  ) {
    const quote = await http.post('/quotes', { ...owner, title, currency: 'USD' });
    return http.put(`/quotes/${quote.id}`, {
      updatedAt: quote.updatedAt,
      contactId: owner.clientId ? contacts[owner.clientId] : null,
      title,
      currency: 'USD',
      validityDays: quote.validityDays,
      oneOffDiscountMinor: 0,
      monthlyDiscountMinor: 0,
      monthlyTermMonths: lines.some((line) => line.section === 'monthly') ? 6 : null,
      clientNotes: 'الأسعار لا تشمل ميزانية الإعلانات المدفوعة.',
      terms: null,
      lines,
      installments: lines.some((line) => line.section === 'one_off')
        ? [
            { name: 'دفعة البداية', percent: 50 },
            { name: 'دفعة التسليم', percent: 50 },
          ]
        : [],
    });
  }
  const serviceLine = (s: Row, unitPriceMinor: number, quantity = 1) => ({
    section: s.billing === 'monthly' ? 'monthly' : 'one_off',
    serviceId: s.id,
    quantity,
    unitPriceMinor,
    revisionRounds: 2,
  });
  const goldLine = {
    section: 'monthly',
    packageId: gold.id,
    quantity: 1,
    unitPriceMinor: 70_000,
    items: (gold.items as { serviceId: string; quantity: number }[]).map((item) => ({
      serviceId: item.serviceId,
      quantity: item.quantity,
      revisionRounds: 2,
    })),
  };
  const send = (quote: Row) => http.post(`/quotes/${quote.id}/send`, { confirmZeroPrice: true });

  const leadQuote = await draftQuote({ leadId: (leads[2] as Row).id }, 'عرض إدارة السوشيال ميديا', [
    goldLine,
  ]);
  await send(leadQuote);
  await draftQuote({ clientId: academy.id }, 'عرض موقع الأكاديمية', [
    serviceLine(website, 150_000),
  ]);
  await send(
    await draftQuote({ clientId: construction.id }, 'عرض الهوية البصرية', [
      serviceLine(identity, 120_000),
    ]),
  );

  async function acceptQuote(quote: Row, projectManager: string) {
    const plan = await http.get<Body & { project: Body | null; retainer: Body | null }>(
      `/quotes/${quote.id}/accept-plan`,
    );
    const project = plan.project as {
      name: string;
      departments: string[];
      startDate: string;
      dueDate: string;
      templates: { id: string; selected: boolean }[];
      installments: { milestone: number }[];
    } | null;
    const retainer = plan.retainer as {
      name: string;
      departments: string[];
      startDate: string;
      renewalDate: string | null;
      template: { id: string } | null;
    } | null;
    return http.post(`/quotes/${quote.id}/accept`, {
      respondedOn: today,
      contactId: quote.contactId ?? null,
      project: project && {
        name: project.name,
        projectManagerId: projectManager,
        departments: project.departments,
        startDate: project.startDate,
        dueDate: project.dueDate,
        templateIds: project.templates.filter((t) => t.selected).map((t) => t.id),
        installmentMilestones: project.installments.map((i) => i.milestone),
      },
      retainer: retainer && {
        mode: 'new',
        name: retainer.name,
        departments: retainer.departments,
        startDate: retainer.startDate,
        renewalDate: retainer.renewalDate,
        templateId: retainer.template?.id ?? null,
      },
    });
  }
  const restaurantQuote = await draftQuote({ clientId: restaurant.id }, 'عرض مطعم الياسمين', [
    serviceLine(logo, 30_000),
    goldLine,
  ]);
  await send(restaurantQuote);
  await acceptQuote(restaurantQuote, people.designLead as string);
  const fashionQuote = await draftQuote({ clientId: fashion.id }, 'عرض جلسات التصوير', [
    serviceLine(shoot, 25_000, 2),
  ]);
  await send(fashionQuote);
  await acceptQuote(fashionQuote, people.photoLead as string);
  log('quotes: lead quote, draft, sent, 2 accepted (with their project and retainer)');

  // Projects (F05) and retainers.
  const websiteProject = await http.post('/projects', {
    clientId: academy.id,
    name: 'موقع أكاديمية المستقبل',
    description: 'موقع تعريفي بخمس صفحات مع نموذج تسجيل.',
    projectManagerId: people.devLead,
    departments: ['development', 'design'],
    startDate: day(-10),
    dueDate: day(30),
    status: 'active',
    milestones: [
      { name: 'التصميم', dueDate: day(5), installmentMinor: 50_000 },
      { name: 'البرمجة', dueDate: day(20), installmentMinor: 70_000 },
      { name: 'الإطلاق', dueDate: day(30), installmentMinor: 30_000 },
    ],
  });
  const identityProject = await http.post('/projects', {
    clientId: construction.id,
    name: 'هوية شركة البناء الحديث',
    projectManagerId: people.designLead,
    departments: ['design'],
    startDate: day(-3),
    dueDate: day(21),
    status: 'active',
    milestones: [{ name: 'تسليم الشعار', dueDate: day(7), installmentMinor: null }],
  });
  await http.post(`/projects/${websiteProject.id}/expenses`, {
    spentOn: day(-2),
    description: 'استضافة ونطاق لسنة',
    amountMinor: 12_000,
    currency: 'USD',
    sypPerUsd: null,
    note: null,
  });
  const clinicRetainer = await http.post('/retainers', {
    clientId: clinic.id,
    name: 'إدارة حسابات العيادة',
    departments: ['design', 'content_management'],
    startDate: day(-5),
    renewalDate: day(180),
    monthlyFeeMinor: 60_000,
    deliverables: [
      { kind: 'design', monthlyQuantity: 10 },
      { kind: 'post', monthlyQuantity: 10 },
      { kind: 'reel', monthlyQuantity: 2 },
    ],
  });
  const cafeRetainer = await http.post('/retainers', {
    clientId: cafe.id,
    name: 'سوشيال مقهى الزاوية',
    departments: ['design', 'marketing'],
    startDate: day(-20),
    renewalDate: day(25),
    monthlyFeeMinor: 40_000,
    deliverables: [
      { kind: 'design', monthlyQuantity: 8 },
      { kind: 'ad_campaign', monthlyQuantity: 1 },
    ],
  });
  log('projects: 2 more with milestones and an expense; retainers: 2 more');

  // Tasks (F06): one per status, across departments.
  const task = (body: Body) =>
    http.post('/tasks', { priority: 'normal', dueDate: day(3), ...body });
  const move = (id: string, status: string, extra: Body = {}) =>
    http.post(`/tasks/${id}/status`, { status, ...extra });
  async function toReview(id: string) {
    await move(id, 'in_progress');
    return move(id, 'internal_review');
  }
  async function passReview(id: string, status: 'approved' | 'awaiting_client') {
    let detail = await http.get(`/tasks/${id}`);
    if (status === 'awaiting_client' && !detail.clientText) {
      detail = await http.put(`/tasks/${id}/client-text`, { clientText: 'نص التصميم للموافقة' });
    }
    return move(id, status, { contentToken: detail.contentToken });
  }

  const tasks: Row[] = [];
  const t = async (body: Body) => {
    const created = await task(body);
    tasks.push(created);
    return created;
  };
  await t({
    title: 'تصميم الصفحة الرئيسية',
    department: 'design',
    assigneeId: people.designer1,
    clientId: academy.id,
    projectId: websiteProject.id,
    priority: 'high',
  });
  const inProgress = await t({
    title: 'برمجة نموذج التسجيل',
    department: 'development',
    assigneeId: people.developer,
    clientId: academy.id,
    projectId: websiteProject.id,
    dueDate: day(10),
  });
  await move(inProgress.id, 'in_progress');
  const reviewTask = await t({
    title: 'اقتراحات الشعار',
    department: 'design',
    assigneeId: people.designer2,
    clientId: construction.id,
    projectId: identityProject.id,
    priority: 'urgent',
    dueDate: day(1),
  });
  await toReview(reviewTask.id);
  const awaiting = await t({
    title: 'تصميم منيو رمضان',
    department: 'design',
    assigneeId: people.designer1,
    clientId: restaurant.id,
    needsClientApproval: true,
  });
  await toReview(awaiting.id);
  await passReview(awaiting.id, 'awaiting_client');
  const approved = await t({
    title: 'بوستر عرض نهاية الأسبوع',
    department: 'design',
    assigneeId: people.designer2,
    clientId: cafe.id,
    needsClientApproval: false,
  });
  await toReview(approved.id);
  await passReview(approved.id, 'approved');
  const delivered = await t({
    title: 'غلاف فيسبوك',
    department: 'design',
    assigneeId: people.designer1,
    clientId: cafe.id,
    needsClientApproval: false,
    dueDate: day(-1),
  });
  await toReview(delivered.id);
  await passReview(delivered.id, 'approved');
  await move(delivered.id, 'delivered');
  const overdue = await t({
    title: 'تقرير أداء الحملة',
    department: 'marketing',
    assigneeId: people.marketer,
    clientId: cafe.id,
    dueDate: day(-2),
  });
  await move(overdue.id, 'in_progress');
  await t({
    title: 'تحديث سياسة الإجازات',
    department: 'internal_operations',
    assigneeId: people.ops,
    clientId: null,
    priority: 'low',
    dueDate: day(14),
  });
  await t({
    title: 'مونتاج ريل الافتتاح',
    department: 'photography',
    assigneeId: null,
    clientId: restaurant.id,
    dueDate: day(4),
  });
  await t({
    title: 'كتابة منشورات الأسبوع',
    department: 'content_management',
    assigneeId: people.writer1,
    clientId: clinic.id,
    dueDate: day(2),
  });
  const commented = tasks[0] as Row;
  await http.post(`/tasks/${commented.id}/comments`, {
    body: 'يرجى الالتزام بألوان الهوية المعتمدة.',
  });
  for (const text of ['مسودة أولى', 'مراجعة الألوان', 'نسخة الجوال']) {
    await http.post(`/tasks/${commented.id}/checklist`, { text });
  }
  log(`tasks: ${tasks.length} across statuses, with a comment and a checklist`);

  // Content (F07).
  const post = (body: Body) =>
    http.post('/content/posts', {
      type: 'post',
      platforms: ['instagram'],
      publishDate: day(5),
      ...body,
    });
  await post({
    clientId: clinic.id,
    title: 'نصائح العناية بالأسنان',
    caption: 'خمس عادات يومية لابتسامة صحية.',
    responsibleId: people.writer1,
  });
  await post({
    clientId: restaurant.id,
    title: 'طبق الأسبوع',
    type: 'reel',
    platforms: ['instagram', 'facebook'],
    publishDate: day(2),
    caption: 'جربوا طبقنا الجديد!',
    responsibleId: people.writer2,
  });
  const inProduction = await post({
    clientId: cafe.id,
    title: 'عرض القهوة الصباحي',
    publishDate: day(1),
    publishTime: '09:00',
    caption: 'قهوتك الأولى علينا.',
    responsibleId: people.writer1,
  });
  await http.post(`/content/posts/${inProduction.id}/status`, { to: 'in_production' });
  await post({
    clientId: fashion.id,
    title: 'تشكيلة الخريف',
    type: 'carousel',
    publishDate: day(7),
    caption: 'وصلت تشكيلة الخريف.',
    responsibleId: people.writer2,
  });
  log('content posts: 4');

  // Calendar (F11).
  await http.post('/meetings', {
    title: 'اجتماع متابعة شهري',
    clientId: restaurant.id,
    startsAt: at(1, '11:00'),
    endsAt: at(1, '12:00'),
    location: 'مكتب الوكالة',
    onlineUrl: null,
    agenda: 'مراجعة أداء الشهر وخطة المحتوى القادمة.',
    attendeeIds: [people.am1, people.contentLead],
    contactIds: [contacts[restaurant.id]],
    acceptConflicts: true,
  });
  await http.post('/meetings', {
    title: 'اجتماع الفريق الأسبوعي',
    clientId: null,
    startsAt: at(2, '10:00'),
    endsAt: at(2, '11:00'),
    location: null,
    onlineUrl: 'https://meet.example.com/vertex-weekly',
    agenda: null,
    attendeeIds: [people.ops, people.designLead, people.contentLead, people.marketingLead],
    contactIds: [],
    acceptConflicts: true,
  });
  await http.post('/shoots', {
    title: 'تصوير تشكيلة الخريف',
    type: 'product',
    startsAt: at(3, '10:00'),
    endsAt: at(3, '14:00'),
    location: 'استوديو الوكالة',
    crew: [
      { userId: people.photographer, role: 'photographer', isLead: true },
      { userId: people.videographer, role: 'videographer', isLead: false },
    ],
    shots: [{ text: 'لقطات المنتج على خلفية بيضاء' }, { text: 'لقطات مع عارضة' }],
    newTask: {},
    clientId: fashion.id,
    acceptConflicts: true,
  });
  log('calendar: 2 meetings, 1 shoot');

  // Campaigns and ad wallets (F12).
  await http.post(`/clients/${cafe.id}/ad-wallet/entries`, {
    kind: 'deposit',
    occurredOn: day(-7),
    amountMinor: 50_000,
    currency: 'USD',
    method: 'bank_transfer',
  });
  const campaign = await http.post('/campaigns', {
    clientId: cafe.id,
    name: 'حملة رسائل الافتتاح',
    platform: 'meta',
    objective: 'messages',
    budgetMinor: 30_000,
    startsOn: day(-6),
    ownerId: people.marketer,
  });
  await http.post(`/campaigns/${campaign.id}/status`, { to: 'active' });
  await http.post(`/campaigns/${campaign.id}/updates`, {
    periodStart: day(-6),
    periodEnd: day(-1),
    spendMinor: 12_000,
    reach: 18_500,
    clicks: 1_200,
    results: 64,
  });
  await http.post('/campaigns', {
    clientId: restaurant.id,
    name: 'حملة الوعي بالعلامة',
    platform: 'meta',
    objective: 'messages',
    budgetMinor: 20_000,
    startsOn: day(5),
    ownerId: people.marketer,
  });
  log('ad wallet deposit, 2 campaigns with an update');

  // Invoices and payments (F13).
  async function invoice(client: Row, lines: Body[], engagement: Body, pay?: number) {
    const draft = await http.post('/invoices', {
      clientId: client.id,
      currency: 'USD',
      ...engagement,
    });
    const saved = await http.put(`/invoices/${draft.id}`, {
      updatedAt: draft.updatedAt,
      projectId: engagement.projectId ?? null,
      retainerId: engagement.retainerId ?? null,
      paymentTermsDays: 14,
      notes: null,
      lines,
    });
    const issued = await http.post(`/invoices/${draft.id}/issue`, { updatedAt: saved.updatedAt });
    if (pay) {
      await http.post(`/invoices/${draft.id}/payments`, {
        paidOn: today,
        amountMinor: pay,
        currency: 'USD',
        method: 'bank_transfer',
        reference: 'TRX-1001',
      });
    }
    return issued;
  }
  await invoice(
    clinic,
    [{ description: 'رسوم الشهر الأول', quantity: 1, unitPriceMinor: 60_000 }],
    { retainerId: clinicRetainer.id },
    60_000,
  );
  await invoice(
    cafe,
    [{ description: 'رسوم الشهر', quantity: 1, unitPriceMinor: 40_000 }],
    { retainerId: cafeRetainer.id },
    15_000,
  );
  await invoice(academy, [{ description: 'دفعة التصميم', quantity: 1, unitPriceMinor: 50_000 }], {
    projectId: websiteProject.id,
  });
  const draftInvoice = await http.post('/invoices', {
    clientId: construction.id,
    currency: 'USD',
    projectId: identityProject.id,
  });
  await http.put(`/invoices/${draftInvoice.id}`, {
    updatedAt: draftInvoice.updatedAt,
    projectId: identityProject.id,
    retainerId: null,
    paymentTermsDays: 7,
    notes: null,
    lines: [{ description: 'تصميم الشعار', quantity: 1, unitPriceMinor: 30_000 }],
  });
  log('invoices: 1 paid, 1 partly paid, 1 issued, 1 draft');
}

// Run

const { db, close } = createDatabase(databaseUrl);
try {
  if (await userIdByEmail(db, ADMIN_EMAIL)) {
    console.error(`Already seeded (${ADMIN_EMAIL} exists). Reset the dev database to seed again.`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Seeding the development database…\n');
    const people: Record<string, string> = {};
    for (const person of TEAM) {
      const { id } = await createUser(
        db,
        {
          email: `${person.key.toLowerCase()}@${EMAIL_DOMAIN}`,
          name: person.name,
          department: person.department,
          roles: person.roles ?? [],
          password: SEED_PASSWORD,
        },
        null,
      );
      people[person.key] = id;
    }
    process.stdout.write(`  users: ${TEAM.length}\n`);

    const app = await NestFactory.create(AppModule, { logger: ['error'], bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    try {
      const http = httpClient((await app.getUrl()).replace('[::1]', '127.0.0.1'));
      await http.signInWithTwoFactor(ADMIN_EMAIL);
      await seedData(http, people);
    } finally {
      (app.getHttpServer() as Server).closeAllConnections();
      await app.close();
    }
    // The owner sets up their own authenticator on first sign-in.
    await db.transaction((tx) => resetTwoFactor(tx, people.admin as string, null));

    process.stdout.write(`
Done. Every seeded user signs in with the password: ${SEED_PASSWORD}
  General Manager: ${ADMIN_EMAIL}
  Others: <key>@${EMAIL_DOMAIN} — ${TEAM.map((p) => p.key.toLowerCase()).join(', ')}
`);
  }
} finally {
  await close();
}
