import type { Page, Route, TestInfo } from '@playwright/test';
import {
  type AuditEntry,
  type BrandKit,
  type ClientDetailResponse,
  type ClientResponse,
  type ClientStatus,
  type Contact,
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type CreateExtraWork,
  type CreateMilestone,
  type CreateProject,
  type CreateRetainer,
  type Currency,
  type Cycle,
  type CycleDetail,
  type CycleStatus,
  type DeliverableKind,
  type DepartmentCode,
  type DepartmentDetailResponse,
  type DepartmentResponse,
  type ExtraWork,
  type ExtraWorkBilling,
  type ExtraWorkBillingChange,
  firstOfMonth,
  grantedPermissions,
  type HealthResponse,
  isLineBehind,
  isProjectClosed,
  lastOfMonth,
  type MeResponse,
  type Milestone,
  type MilestoneStatus,
  type Note,
  type NoteChannel,
  type PlatformAccount,
  type Project,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectStatusChange,
  type Retainer,
  type RetainerDeliverables,
  type RetainerDetail,
  type RetainerStatus,
  type RetainerStatusChange,
  deliveryRate as rateOf,
  renewalState,
  type UpdateCycleLine,
  type UpdateExtraWork,
  type UserResponse,
} from '@vertex-hub/contracts';

/*
 * The E2E suite covers the SPA alone: API responses are mocked here with the shared contract
 * types, and the API is exercised by its own integration tests (apps/api/test).
 */

export const healthy: HealthResponse = {
  status: 'ok',
  checks: { database: 'up' },
  timestamp: '2026-09-28T10:00:00.000Z',
};

const id = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;

const dept = (code: DepartmentResponse['code'], name: string, n: number) => ({
  id: id(900 + n),
  code,
  name,
});

export const departmentsSeed = [
  dept('general_management', 'الإدارة العامة', 1),
  dept('internal_operations', 'العمليات الداخلية', 2),
  dept('public_relations', 'العلاقات العامة', 3),
  dept('marketing', 'التسويق', 4),
  dept('design', 'التصميم', 5),
  dept('photography', 'التصوير', 6),
  dept('content_management', 'إدارة المحتوى', 7),
  dept('development', 'التطوير', 8),
  dept('general_communication', 'التواصل العام', 9),
  dept('medical_consultation', 'الاستشارات الطبية', 10),
] as const;

type Department = (typeof departmentsSeed)[number];

function seeded(code: Department['code']): Department {
  const department = departmentsSeed.find((d) => d.code === code);
  if (!department) throw new Error(`No seeded department ${code}`);
  return department;
}

const general = seeded('general_management');
const operations = seeded('internal_operations');
const marketing = seeded('marketing');
const design = seeded('design');
const photography = seeded('photography');
const content = seeded('content_management');

export const manager: MeResponse = {
  user: { id: id(1), name: 'سارة الخطيب', email: 'sara@vertex.example', image: null },
  roles: ['general_manager', 'employee', 'account_manager'],
  departments: [{ ...general, isPrimary: true, isManager: false }],
  permissions: grantedPermissions({
    roles: ['general_manager', 'employee', 'account_manager'],
    departments: [{ code: 'general_management', isManager: false }],
  }),
  twoFactor: { enabled: true, required: true },
};

/** A finance user who has not set up two-factor sign-in yet (F01 rule 15). */
export const financeWithoutTwoFactor: MeResponse = {
  ...manager,
  user: { ...manager.user, id: id(7), name: 'رنا المصري', email: 'rana@vertex.example' },
  roles: ['employee', 'finance'],
  permissions: grantedPermissions({ roles: ['employee', 'finance'], departments: [] }),
  twoFactor: { enabled: false, required: true },
};

/** Layan: a department manager who is also an Account Manager (F02 own_clients scope). */
export const accountManagerMe: MeResponse = {
  user: { id: id(3), name: 'ليان الأحمد', email: 'layan@vertex.example', image: null },
  roles: ['account_manager', 'department_manager', 'employee'],
  departments: [
    { ...design, isPrimary: true, isManager: true },
    { ...marketing, isPrimary: false, isManager: false },
  ],
  permissions: grantedPermissions({
    roles: ['account_manager', 'department_manager', 'employee'],
    departments: [
      { code: 'design', isManager: true },
      { code: 'marketing', isManager: false },
    ],
  }),
  twoFactor: { enabled: false, required: false },
};

/** Karim: an employee with no role beyond the default one. */
export const employeeMe: MeResponse = {
  user: { id: id(4), name: 'كريم الزين', email: 'karim@vertex.example', image: null },
  roles: ['employee'],
  departments: [{ ...photography, isPrimary: true, isManager: false }],
  permissions: grantedPermissions({
    roles: ['employee'],
    departments: [{ code: 'photography', isManager: false }],
  }),
  twoFactor: { enabled: false, required: false },
};

function member(
  n: number,
  name: string,
  email: string,
  departments: { d: Department; primary?: boolean; manager?: boolean }[],
  extra: Partial<UserResponse> = {},
): UserResponse {
  return {
    id: id(n),
    name,
    email,
    title: null,
    phone: null,
    skills: [],
    departments: departments.map(({ d, primary, manager: isManager }) => ({
      ...d,
      isPrimary: primary ?? false,
      isManager: isManager ?? false,
    })),
    status: 'active',
    roles: [],
    twoFactorEnabled: false,
    ...extra,
  };
}

export function teamSeed(): UserResponse[] {
  return [
    member(1, 'سارة الخطيب', 'sara@vertex.example', [{ d: general, primary: true }], {
      title: 'المديرة العامة',
      phone: '+963944100200',
      skills: ['إدارة المشاريع', 'تفاوض'],
      roles: ['account_manager', 'general_manager'],
      twoFactorEnabled: true,
    }),
    member(
      2,
      'عمر حداد',
      'omar@vertex.example',
      [{ d: operations, primary: true, manager: true }],
      {
        title: 'مدير العمليات',
        phone: '+963944300400',
        skills: ['جدولة', 'Notion'],
        twoFactorEnabled: true,
      },
    ),
    member(
      3,
      'ليان الأحمد',
      'layan@vertex.example',
      [{ d: design, primary: true, manager: true }, { d: marketing }],
      {
        title: 'مصممة أولى',
        phone: '+963933500600',
        skills: ['Figma', 'هوية بصرية', 'Illustrator', 'موشن جرافيك'],
        roles: ['account_manager'],
      },
    ),
    member(4, 'كريم الزين', 'karim@vertex.example', [{ d: photography, primary: true }], {
      title: 'مصور',
      skills: ['تصوير منتجات', 'Lightroom'],
    }),
    member(5, 'نور السيد', 'nour@vertex.example', [{ d: content, primary: true }, { d: design }], {
      title: 'كاتبة محتوى',
      skills: ['كتابة إعلانية'],
      status: 'invited',
    }),
    member(6, 'باسل يوسف', 'basel@vertex.example', [{ d: design, primary: true }], {
      title: 'مصمم',
      skills: ['Photoshop'],
      status: 'archived',
    }),
  ];
}

export const auditSeed: AuditEntry[] = [
  {
    id: id(501),
    occurredAt: '2026-09-28T09:40:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'department.updated',
    entityType: 'department',
    entityId: design.id,
    before: { manager: null },
    after: { manager: { id: id(3), name: 'ليان الأحمد' } },
  },
  {
    id: id(502),
    occurredAt: '2026-09-28T09:10:00.000Z',
    actorId: id(2),
    actorName: 'عمر حداد',
    action: 'user.roles_changed',
    entityType: 'user',
    entityId: id(3),
    before: { roles: [] },
    after: { roles: ['account_manager'] },
  },
  {
    id: id(503),
    occurredAt: '2026-09-27T15:00:00.000Z',
    actorId: id(2),
    actorName: 'عمر حداد',
    action: 'user.created',
    entityType: 'user',
    entityId: id(5),
    before: null,
    after: { name: 'نور السيد', email: 'nour@vertex.example', roles: [] },
  },
  {
    id: id(504),
    occurredAt: '2026-09-27T14:00:00.000Z',
    actorId: null,
    actorName: null,
    action: 'user.two_factor_reset',
    entityType: 'user',
    entityId: id(1),
    before: { twoFactorEnabled: true },
    after: { twoFactorEnabled: false },
  },
  {
    id: id(505),
    occurredAt: '2026-09-27T12:20:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'client.account_manager_changed',
    entityType: 'client',
    entityId: id(601),
    before: { accountManager: { id: id(1), name: 'سارة الخطيب' } },
    after: { accountManager: { id: id(3), name: 'ليان الأحمد' } },
  },
  {
    id: id(506),
    occurredAt: '2026-09-27T12:05:00.000Z',
    actorId: id(3),
    actorName: 'ليان الأحمد',
    action: 'client_contact.created',
    entityType: 'client_contact',
    entityId: id(611),
    before: null,
    after: { clientId: id(601), name: 'هالة الشامي', hasFinalApproval: true },
  },
  {
    id: id(507),
    occurredAt: '2026-09-26T10:00:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'project.status_changed',
    entityType: 'project',
    entityId: id(801),
    before: { status: 'planned' },
    after: { status: 'active' },
  },
  {
    id: id(508),
    occurredAt: '2026-09-26T09:30:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'project_milestone.updated',
    entityType: 'project_milestone',
    entityId: id(813),
    before: { projectId: id(801), name: 'التنفيذ', installmentMinor: 100_000 },
    after: { projectId: id(801), name: 'التنفيذ', installmentMinor: 120_000 },
  },
  {
    id: id(509),
    occurredAt: '2026-09-25T11:00:00.000Z',
    actorId: id(3),
    actorName: 'ليان الأحمد',
    action: 'retainer.status_changed',
    entityType: 'retainer',
    entityId: id(901),
    before: { status: 'paused' },
    after: { status: 'active' },
  },
  {
    id: id(510),
    occurredAt: '2026-09-25T10:30:00.000Z',
    actorId: id(3),
    actorName: 'ليان الأحمد',
    action: 'retainer.deliverables_updated',
    entityType: 'retainer',
    entityId: id(901),
    before: { deliverables: [{ kind: 'design', label: null, monthlyQuantity: 10 }] },
    after: {
      deliverables: [
        { kind: 'design', label: null, monthlyQuantity: 12 },
        { kind: 'reel', label: null, monthlyQuantity: 4 },
      ],
    },
  },
];

interface ClientRecord {
  id: string;
  tradeName: string;
  sector: string | null;
  status: ClientStatus;
  isHealthcare: boolean;
  accountManagerId: string;
  brandKit: BrandKit;
  archived: boolean;
  contacts: (Contact & { archived: boolean })[];
  platformAccounts: (PlatformAccount & { archived: boolean })[];
  notes: {
    id: string;
    occurredAt: string;
    channel: NoteChannel;
    summary: string;
    authorId: string;
    contactId: string | null;
    archived: boolean;
  }[];
}

const emptyKit: BrandKit = {
  colors: [],
  fonts: [],
  toneOfVoice: null,
  forbiddenWords: [],
  files: [],
  references: [],
};

const contact = (
  n: number,
  clientId: string,
  name: string,
  extra: Partial<Contact> = {},
): Contact & { archived: boolean } => ({
  id: id(n),
  clientId,
  name,
  jobTitle: null,
  phone: null,
  email: null,
  hasFinalApproval: false,
  notes: null,
  archived: false,
  ...extra,
});

export function clientsSeed(): ClientRecord[] {
  const jasmine = id(601);
  const shifa = id(602);
  const nukhba = id(603);
  return [
    {
      id: jasmine,
      tradeName: 'مطعم الياسمين',
      sector: 'مطاعم',
      status: 'active',
      isHealthcare: false,
      accountManagerId: id(3),
      archived: false,
      brandKit: {
        // Client data, not design tokens: a brand's own colors are stored as hex codes.
        colors: [
          { name: 'أخضر الياسمين', hex: '#1F5C4A' },
          { name: 'ذهبي', hex: '#C9A45C' },
          { name: 'كريمي', hex: '#F5EFE3' },
          { name: null, hex: '#2B2B2B' },
        ],
        fonts: ['Tajawal', 'Playfair Display'],
        toneOfVoice:
          'دافئ وعائلي، يتحدث عن الطبخ البيتي والضيافة الشامية. جمل قصيرة، ودعوة واضحة للحجز.',
        forbiddenWords: ['رخيص', 'وجبات سريعة', 'عرض خيالي'],
        files: [
          {
            kind: 'logo',
            label: 'الشعار بخلفية شفافة',
            url: 'https://drive.example.com/jasmine/logo',
          },
          {
            kind: 'guidelines',
            label: 'دليل الهوية 2026',
            url: 'https://drive.example.com/jasmine/guide',
          },
        ],
        references: [
          {
            kind: 'liked',
            url: 'https://www.instagram.com/p/warm-table',
            note: 'الإضاءة الدافئة وزوايا الطاولة',
          },
          {
            kind: 'disliked',
            url: 'https://www.behance.net/gallery/neon-food',
            note: 'ألوان النيون',
          },
        ],
      },
      contacts: [
        contact(611, jasmine, 'هالة الشامي', {
          jobTitle: 'المالكة',
          phone: '+963944555666',
          email: 'hala@jasmine.example',
          hasFinalApproval: true,
          notes: 'تفضّل التواصل مساءً عبر واتساب.',
        }),
        contact(612, jasmine, 'سامر العلي', {
          jobTitle: 'مدير الصالة',
          phone: '+963933222111',
        }),
      ],
      platformAccounts: [
        {
          id: id(621),
          clientId: jasmine,
          platform: 'instagram',
          label: null,
          url: 'https://www.instagram.com/jasmine.restaurant',
          agencyAccess: 'granted',
          adminNote: 'هالة على رقمها الشخصي',
          archived: false,
        },
        {
          id: id(622),
          clientId: jasmine,
          platform: 'facebook',
          label: null,
          url: 'https://www.facebook.com/jasmine.restaurant',
          agencyAccess: 'pending',
          adminNote: null,
          archived: false,
        },
        {
          id: id(623),
          clientId: jasmine,
          platform: 'google_business',
          label: 'فرع المزة',
          url: 'https://maps.google.com/?cid=123',
          agencyAccess: 'none',
          adminNote: 'حساب غوغل لدى المحاسب',
          archived: false,
        },
      ],
      notes: [
        {
          id: id(631),
          occurredAt: '2026-09-28T09:30:00.000Z',
          channel: 'meeting',
          summary: 'اتفقنا على خطة محتوى أكتوبر: ثلاثة منشورات أسبوعيًا وريلز للأطباق الموسمية.',
          authorId: id(3),
          contactId: id(611),
          archived: false,
        },
        {
          id: id(632),
          occurredAt: '2026-09-28T07:10:00.000Z',
          channel: 'whatsapp',
          summary: 'أرسلت هالة صور القائمة الجديدة.',
          authorId: id(4),
          contactId: id(611),
          archived: false,
        },
        {
          id: id(633),
          occurredAt: '2026-09-25T12:00:00.000Z',
          channel: 'call',
          summary: 'طلب سامر تعديل موعد جلسة التصوير إلى الأحد.',
          authorId: id(1),
          contactId: id(612),
          archived: false,
        },
      ],
    },
    {
      id: shifa,
      tradeName: 'عيادة الشفاء',
      sector: 'عيادات',
      status: 'paused',
      isHealthcare: true,
      accountManagerId: id(1),
      archived: false,
      brandKit: emptyKit,
      contacts: [contact(613, shifa, 'د. رامي حسن', { jobTitle: 'المدير الطبي' })],
      platformAccounts: [],
      notes: [],
    },
    {
      id: nukhba,
      tradeName: 'متجر النخبة',
      sector: 'متاجر',
      status: 'ended',
      isHealthcare: false,
      accountManagerId: id(3),
      archived: false,
      brandKit: emptyKit,
      contacts: [],
      platformAccounts: [],
      notes: [],
    },
    {
      id: id(604),
      tradeName: 'عميل تجريبي',
      sector: null,
      status: 'active',
      isHealthcare: false,
      accountManagerId: id(1),
      archived: true,
      brandKit: emptyKit,
      contacts: [],
      platformAccounts: [],
      notes: [],
    },
  ];
}

/** What the mocked enable step returns; any 6-digit code but 000000 is accepted. */
export const TOTP_URI =
  'otpauth://totp/Vertex%20Hub:sara%40vertex.example?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Vertex%20Hub';
export const BACKUP_CODES = [
  '7KQ2M9XA',
  'P4TR8WZC',
  'H6NB3LQE',
  'D2VF9KTY',
  'X8CM5RJU',
  'B3ZQ7NHW',
  'L9WE2GPA',
  'R5YK6SDM',
  'F7UJ4BVX',
  'N2HC8QLT',
];
export const VALID_LINK_TOKEN = 'valid-activation-token';

interface MockOptions {
  signedIn: boolean;
  acceptPassword?: string;
  me?: MeResponse;
  /** Sign-in answers with the two-factor step. */
  twoFactorOnSignIn?: boolean;
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
const fail = (route: Route, status: number, code: string, details?: unknown) =>
  route.fulfill({ status, json: { statusCode: status, code, message: code, details } });

function activationLink(kind: 'activation' | 'reset') {
  return {
    url: `http://127.0.0.1:4173/activate#token=${VALID_LINK_TOKEN}`,
    expiresAt: '2026-10-01T10:00:00.000Z',
    kind,
  };
}

/** Mocks the API with an in-memory team. `signedIn` decides whether /api/me finds a session. */
export async function mockApi(page: Page, options: MockOptions): Promise<void> {
  let signedIn = options.signedIn;
  let me = options.me ?? manager;
  const users = teamSeed();
  const clients = clientsSeed();
  const clientsApi = clientRoutes({ users, clients, me: () => me });
  const projects = projectsSeed();
  const projectsApi = projectRoutes({ users, clients, projects, me: () => me });
  const retainers = retainersSeed();
  const retainersApi = retainerRoutes({ users, clients, retainers, me: () => me });
  const managers = new Map<string, string | null>(
    departmentsSeed.map((d) => [
      d.id,
      users.find((u) => u.departments.some((x) => x.id === d.id && x.isManager))?.id ?? null,
    ]),
  );

  const membersOf = (d: Department) =>
    users.filter((u) => u.status !== 'archived' && u.departments.some((x) => x.id === d.id));
  const departmentOf = (d: Department): DepartmentResponse => {
    const head = users.find((u) => u.id === managers.get(d.id));
    return {
      ...d,
      manager: head ? { id: head.id, name: head.name } : null,
      memberCount: membersOf(d).length,
    };
  };
  const departmentDetail = (d: Department): DepartmentDetailResponse => ({
    ...departmentOf(d),
    members: membersOf(d)
      .map((u) => ({
        id: u.id,
        name: u.name,
        title: u.title,
        isPrimary: u.departments.find((x) => x.id === d.id)?.isPrimary ?? false,
        status: u.status === 'invited' ? ('invited' as const) : ('active' as const),
      }))
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/health') return json(route, healthy);
    if (path === '/api/me' && method === 'GET') {
      return signedIn ? json(route, me) : fail(route, 401, 'UNAUTHORIZED');
    }

    // Better Auth.
    if (path === '/api/auth/sign-in/email') {
      const body = request.postDataJSON() as { email: string; password: string };
      if (body.password !== options.acceptPassword) {
        return json(
          route,
          { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' },
          401,
        );
      }
      if (options.twoFactorOnSignIn) return json(route, { twoFactorRedirect: true });
      signedIn = true;
      return json(route, { redirect: false, token: 'test-token', user: me.user });
    }
    if (path === '/api/auth/two-factor/verify-totp') {
      const { code } = request.postDataJSON() as { code: string };
      if (code === '000000') {
        return json(route, { code: 'INVALID_CODE', message: 'Invalid code' }, 401);
      }
      signedIn = true;
      me = { ...me, twoFactor: { ...me.twoFactor, enabled: true } };
      return json(route, { token: 'test-token', user: me.user });
    }
    if (path === '/api/auth/two-factor/verify-backup-code') {
      signedIn = true;
      return json(route, { token: 'test-token', user: me.user });
    }
    if (path === '/api/auth/two-factor/enable') {
      return json(route, { totpURI: TOTP_URI, backupCodes: BACKUP_CODES });
    }
    if (path === '/api/auth/two-factor/generate-backup-codes') {
      return json(route, { status: true, backupCodes: BACKUP_CODES });
    }
    if (path === '/api/auth/change-password') return json(route, { token: null, user: me.user });
    if (path === '/api/auth/sign-out') {
      signedIn = false;
      return json(route, { success: true });
    }
    if (path === '/api/password-links/redeem') {
      const { token } = request.postDataJSON() as { token: string };
      return token === VALID_LINK_TOKEN
        ? route.fulfill({ status: 204 })
        : fail(route, 400, 'LINK_INVALID');
    }
    if (!signedIn) return fail(route, 401, 'UNAUTHORIZED');

    // Users.
    if (path === '/api/users' && method === 'GET') {
      const status = url.searchParams.get('status') ?? 'active';
      const search = url.searchParams.get('search')?.toLowerCase();
      const departmentId = url.searchParams.get('departmentId');
      const role = url.searchParams.get('role');
      // Like the API: status and assigned-role filters are for user managers only.
      const userManager = me.permissions.some((g) => g.permission === 'users.manage');
      if ((status !== 'active' || (role && role !== 'department_manager')) && !userManager) {
        return fail(route, 403, 'FORBIDDEN');
      }
      const items = users.filter(
        (u) =>
          u.status === status &&
          (!role || u.roles?.includes(role as NonNullable<UserResponse['roles']>[number])) &&
          (!search || u.name.toLowerCase().includes(search) || u.email?.includes(search)) &&
          (!departmentId || u.departments.some((d) => d.id === departmentId)),
      );
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/users/skills') {
      return json(route, { items: [...new Set(users.flatMap((u) => u.skills))].sort() });
    }
    if (path === '/api/users' && method === 'POST') {
      const body = request.postDataJSON() as {
        name: string;
        email: string;
        primaryDepartmentId: string;
        roles?: UserResponse['roles'];
      };
      const primary = departmentsSeed.find((d) => d.id === body.primaryDepartmentId) ?? design;
      const created = member(99, body.name, body.email, [{ d: primary, primary: true }], {
        status: 'invited',
        roles: body.roles ?? [],
      });
      users.push(created);
      return json(route, { user: created, link: activationLink('activation') }, 201);
    }
    const userMatch = path.match(/^\/api\/users\/([^/]+)(?:\/(.+))?$/);
    if (userMatch) {
      const user = users.find((u) => u.id === userMatch[1]);
      if (!user) return fail(route, 404, 'NOT_FOUND');
      const action = userMatch[2];
      if (!action && method === 'GET') return json(route, user);
      if (!action && method === 'PATCH') {
        Object.assign(user, request.postDataJSON());
        return json(route, user);
      }
      if (action === 'link') {
        return json(route, activationLink(user.status === 'invited' ? 'activation' : 'reset'));
      }
      if (action === 'archive') {
        const managed = departmentsSeed.filter((d) => managers.get(d.id) === user.id);
        // F02 rule 8: active or paused clients they are account manager of.
        const accounts = clients.filter(
          (c) => !c.archived && c.status !== 'ended' && c.accountManagerId === user.id,
        );
        // F05 rule 4: open projects they are project manager of.
        const running = projects.filter(
          (p) => !p.archived && OPEN_STATUSES.includes(p.status) && p.projectManagerId === user.id,
        );
        if (managed.length > 0 || accounts.length > 0 || running.length > 0) {
          return fail(route, 409, 'USER_HAS_RESPONSIBILITIES', [
            ...managed.map((d) => ({ type: 'manages_department', id: d.id, name: d.name })),
            ...accounts.map((c) => ({
              type: 'account_manager_of_client',
              id: c.id,
              name: c.tradeName,
            })),
            ...running.map((p) => ({ type: 'project_manager_of_project', id: p.id, name: p.name })),
          ]);
        }
        user.status = 'archived';
        return json(route, user);
      }
      if (action === 'restore') {
        user.status = 'invited';
        return json(route, { user, link: activationLink('activation') });
      }
      if (action === 'two-factor/reset') {
        user.twoFactorEnabled = false;
        return json(route, user);
      }
    }
    if (path === '/api/me/profile') {
      const self = users.find((u) => u.id === me.user.id);
      if (self) Object.assign(self, request.postDataJSON());
      return json(route, self);
    }

    // Departments.
    if (path === '/api/departments')
      return json(route, { items: departmentsSeed.map(departmentOf) });
    const departmentMatch = path.match(/^\/api\/departments\/([^/]+)$/);
    if (departmentMatch) {
      const department = departmentsSeed.find((d) => d.id === departmentMatch[1]);
      if (!department) return fail(route, 404, 'NOT_FOUND');
      if (method === 'PATCH') {
        const body = request.postDataJSON() as { managerId?: string | null };
        if (body.managerId !== undefined) managers.set(department.id, body.managerId);
        for (const user of users) {
          user.departments = user.departments.map((x) => ({
            ...x,
            isManager: managers.get(x.id) === user.id,
          }));
        }
      }
      return json(route, departmentDetail(department));
    }

    // Clients (F02).
    const handled = clientsApi(route, method, url, request);
    if (handled) return handled;

    // Projects (F05).
    const answered = projectsApi(route, method, url, request);
    if (answered) return answered;
    const retained = retainersApi(route, method, url, request);
    if (retained) return retained;

    if (path === '/api/audit') {
      return json(route, { items: auditSeed, total: auditSeed.length, page: 1, pageSize: 30 });
    }
    return fail(route, 404, 'NOT_FOUND');
  });
}

interface ClientState {
  users: UserResponse[];
  clients: ClientRecord[];
  me: () => MeResponse;
}

type Request = ReturnType<Route['request']>;

/** The clients API over the in-memory records, with the F02 access rules the screens rely on. */
function clientRoutes({ users, clients, me }: ClientState) {
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? '';
  const canManage = (c: ClientRecord) =>
    !c.archived &&
    (holds('clients.manage', 'all') ||
      (holds('clients.manage', 'own_clients') && c.accountManagerId === me().user.id));

  const summary = (c: ClientRecord): ClientResponse => {
    const manager = users.find((u) => u.id === c.accountManagerId);
    return {
      id: c.id,
      tradeName: c.tradeName,
      sector: c.sector,
      status: c.status,
      isHealthcare: c.isHealthcare,
      accountManager: {
        id: c.accountManagerId,
        name: manager?.name ?? '',
        archived: manager?.status === 'archived',
      },
      hasApprovalContact: c.contacts.some((x) => !x.archived && x.hasFinalApproval),
    };
  };
  const strip = <T extends { archived: boolean }>({ archived: _, ...rest }: T) => rest;
  const detail = (c: ClientRecord): ClientDetailResponse => ({
    ...summary(c),
    brandKit: c.brandKit,
    contacts: c.contacts.filter((x) => !x.archived).map(strip),
    platformAccounts: c.platformAccounts.filter((x) => !x.archived).map(strip),
    archivedAt: c.archived ? '2026-09-20T10:00:00.000Z' : null,
    canManage: canManage(c),
  });
  const note = (c: ClientRecord, n: ClientRecord['notes'][number]): Note => {
    const who = c.contacts.find((x) => x.id === n.contactId);
    const own = n.authorId === me().user.id;
    return {
      id: n.id,
      clientId: c.id,
      occurredAt: n.occurredAt,
      channel: n.channel,
      summary: n.summary,
      author: { id: n.authorId, name: nameOf(n.authorId) },
      contact: who ? { id: who.id, name: who.name, archived: who.archived } : null,
      canEdit: own && !c.archived,
      canArchive: (own || holds('clients.manage', 'all')) && !c.archived,
    };
  };
  let next = 700;

  // Answers a clients request, or returns undefined to let the other mocks try.
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const body = () => request.postDataJSON() as Record<string, unknown>;

    if (path === '/api/clients' && method === 'GET') {
      const q = url.searchParams;
      const statuses = q.getAll('status');
      const archived = q.get('archived') === 'true';
      const search = q.get('search');
      const items = clients
        .filter(
          (c) =>
            c.archived === archived &&
            (statuses.length === 0 || statuses.includes(c.status)) &&
            (!search || c.tradeName.includes(search)) &&
            (!q.get('accountManagerId') || c.accountManagerId === q.get('accountManagerId')) &&
            (!q.get('sector') || c.sector === q.get('sector')) &&
            (!q.get('healthcare') || String(c.isHealthcare) === q.get('healthcare')),
        )
        .sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ar'))
        .map(summary);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/clients/sectors') {
      const sectors = clients.filter((c) => !c.archived && c.sector).map((c) => c.sector);
      return json(route, { items: [...new Set(sectors)].sort() });
    }
    if (path === '/api/clients' && method === 'POST') {
      const input = body() as {
        tradeName: string;
        sector?: string | null;
        accountManagerId: string;
        status?: ClientStatus;
        isHealthcare?: boolean;
      };
      const created: ClientRecord = {
        id: id(next++),
        tradeName: input.tradeName,
        sector: input.sector ?? null,
        status: input.status ?? 'active',
        isHealthcare: input.isHealthcare ?? false,
        accountManagerId: input.accountManagerId,
        brandKit: emptyKit,
        archived: false,
        contacts: [],
        platformAccounts: [],
        notes: [],
      };
      clients.push(created);
      return json(route, detail(created), 201);
    }

    const match = path.match(/^\/api\/clients\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!match) return undefined;
    const [, clientId, part, childId, childAction] = match;
    const client = clients.find((c) => c.id === clientId);
    if (!client || (client.archived && !holds('clients.manage', 'all'))) {
      return fail(route, 404, 'NOT_FOUND');
    }

    if (!part) {
      if (method === 'GET') return json(route, detail(client));
      if (!canManage(client)) return fail(route, 403, 'FORBIDDEN');
      Object.assign(client, body());
      return json(route, detail(client));
    }
    if (part === 'archive' || part === 'restore') {
      client.archived = part === 'archive';
      return json(route, detail(client));
    }
    if (part === 'brand-kit') {
      client.brandKit = body() as BrandKit;
      return json(route, client.brandKit);
    }
    if (part === 'contacts' || part === 'platform-accounts') {
      const list = (part === 'contacts' ? client.contacts : client.platformAccounts) as {
        id: string;
        archived: boolean;
      }[];
      if (!canManage(client)) return fail(route, 403, 'FORBIDDEN');
      if (!childId) {
        const created = { id: id(next++), clientId: client.id, archived: false, ...body() };
        list.push(created);
        return json(route, strip(created), 201);
      }
      const item = list.find((x) => x.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      Object.assign(item, body());
      return json(route, strip(item));
    }
    if (part === 'notes') {
      if (!childId && method === 'GET') {
        const channel = url.searchParams.get('channel');
        const contactId = url.searchParams.get('contactId');
        const items = client.notes
          .filter(
            (n) =>
              !n.archived &&
              (!channel || n.channel === channel) &&
              (!contactId || n.contactId === contactId),
          )
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .map((n) => note(client, n));
        return json(route, { items, total: items.length, page: 1, pageSize: 20 });
      }
      if (!childId) {
        const input = body() as {
          summary: string;
          channel: NoteChannel;
          contactId?: string | null;
          occurredAt?: string;
        };
        const created = {
          id: id(next++),
          summary: input.summary,
          channel: input.channel,
          contactId: input.contactId ?? null,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
          authorId: me().user.id,
          archived: false,
        };
        client.notes.push(created);
        return json(route, note(client, created), 201);
      }
      const item = client.notes.find((n) => n.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        if (!note(client, item).canArchive) return fail(route, 403, 'NOT_NOTE_AUTHOR');
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      if (!note(client, item).canEdit) return fail(route, 403, 'NOT_NOTE_AUTHOR');
      Object.assign(item, body());
      return json(route, note(client, item));
    }
    return undefined;
  };
}

/** The day the project screens are shot on, so schedules and overdue badges stay stable. */
export const PROJECTS_TODAY = '2026-10-10';

interface MilestoneRecord {
  id: string;
  name: string;
  dueDate: string | null;
  status: MilestoneStatus;
  doneAt: string | null;
  doneById: string | null;
  installmentMinor: number | null;
  archived: boolean;
}

interface ExtraWorkRecord {
  id: string;
  title: string;
  description: string | null;
  requestedOn: string;
  contactId: string | null;
  estimateMinor: number | null;
  billingStatus: ExtraWorkBilling;
  billingNote: string | null;
  loggedById: string;
  createdAt: string;
  archived: boolean;
}

interface ProjectRecord {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  projectManagerId: string;
  departments: DepartmentCode[];
  status: ProjectStatus;
  startDate: string;
  dueDate: string;
  currency: Currency;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  archived: boolean;
  milestones: MilestoneRecord[];
  extraWork: ExtraWorkRecord[];
}

const milestone = (
  n: number,
  name: string,
  dueDate: string | null,
  installmentMinor: number | null,
  done?: { at: string; by: string },
): MilestoneRecord => ({
  id: id(n),
  name,
  dueDate,
  status: done ? 'done' : 'pending',
  doneAt: done?.at ?? null,
  doneById: done?.by ?? null,
  installmentMinor,
  archived: false,
});

export function projectsSeed(): ProjectRecord[] {
  const base = {
    description: null,
    currency: 'USD' as const,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    archived: false,
    extraWork: [],
  };
  return [
    {
      ...base,
      id: id(801),
      clientId: id(601),
      name: 'الهوية البصرية الجديدة',
      description: 'شعار جديد ودليل هوية وتطبيقات المطبوعات والقوائم لفروع المطعم الثلاثة.',
      projectManagerId: id(4),
      departments: ['design', 'content_management', 'photography'],
      status: 'active',
      startDate: '2026-09-01',
      dueDate: '2026-11-15',
      milestones: [
        milestone(811, 'الاستكشاف', '2026-09-10', 60_000, {
          at: '2026-09-09T12:00:00.000Z',
          by: id(4),
        }),
        milestone(812, 'التصميم', '2026-10-05', 150_000, {
          at: '2026-10-04T15:30:00.000Z',
          by: id(3),
        }),
        milestone(813, 'التنفيذ', '2026-10-25', 120_000),
        milestone(814, 'الاختبار', '2026-11-05', null),
        milestone(815, 'التسليم', '2026-11-20', 70_000),
      ],
      extraWork: [
        {
          id: id(821),
          title: 'تصميم إضافي لإعلان العيد',
          description: 'ثلاثة مقاسات لإعلان العيد خارج نطاق الاتفاق.',
          requestedOn: '2026-09-28',
          contactId: id(611),
          estimateMinor: 25_000,
          billingStatus: 'unbilled',
          billingNote: null,
          loggedById: id(4),
          createdAt: '2026-09-28T09:00:00.000Z',
          archived: false,
        },
        {
          id: id(822),
          title: 'جلسة تصوير للقائمة الجديدة',
          description: null,
          requestedOn: '2026-09-15',
          contactId: null,
          estimateMinor: 40_000,
          billingStatus: 'billed',
          billingNote: 'فاتورة 2026-041',
          loggedById: id(3),
          createdAt: '2026-09-15T11:00:00.000Z',
          archived: false,
        },
      ],
    },
    {
      ...base,
      id: id(802),
      clientId: id(601),
      name: 'حملة الافتتاح',
      projectManagerId: id(1),
      departments: ['marketing', 'design'],
      status: 'planned',
      startDate: '2026-10-20',
      dueDate: '2026-11-30',
      milestones: [],
    },
    {
      ...base,
      id: id(803),
      clientId: id(602),
      name: 'موقع العيادة',
      // Invited users may manage projects (rule 2).
      projectManagerId: id(5),
      departments: ['development', 'design', 'content_management'],
      status: 'active',
      startDate: '2026-08-01',
      dueDate: '2026-10-01',
      currency: 'SYP',
      milestones: [
        milestone(831, 'التصميم', '2026-08-20', 50_000_000, {
          at: '2026-08-19T10:00:00.000Z',
          by: id(1),
        }),
        milestone(832, 'البرمجة', '2026-09-20', 90_000_000),
      ],
    },
    {
      ...base,
      id: id(804),
      clientId: id(602),
      name: 'تصوير المنتجات الطبية',
      projectManagerId: id(4),
      departments: ['photography'],
      status: 'on_hold',
      startDate: '2026-09-15',
      dueDate: '2026-12-01',
      milestones: [milestone(841, 'جلسة التصوير', '2026-10-15', null)],
    },
    {
      ...base,
      id: id(805),
      clientId: id(601),
      name: 'قائمة الطعام الصيفية',
      projectManagerId: id(3),
      departments: ['design'],
      status: 'completed',
      startDate: '2026-05-01',
      dueDate: '2026-06-15',
      completedAt: '2026-06-12T10:00:00.000Z',
      milestones: [
        milestone(851, 'التصميم', '2026-06-01', 80_000, {
          at: '2026-06-01T10:00:00.000Z',
          by: id(3),
        }),
      ],
      extraWork: [
        {
          id: id(852),
          title: 'نسخة مطبوعة من القائمة',
          description: null,
          requestedOn: '2026-06-05',
          contactId: null,
          estimateMinor: 15_000,
          billingStatus: 'unbilled',
          billingNote: null,
          loggedById: id(3),
          createdAt: '2026-06-05T09:00:00.000Z',
          archived: false,
        },
      ],
    },
  ];
}

interface ProjectState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  me: () => MeResponse;
}

const OPEN_STATUSES: ProjectStatus[] = ['planned', 'active', 'on_hold'];

/** The projects API (F05) over the in-memory records, with its access and money rules. */
function projectRoutes({ users, clients, projects, me }: ProjectState) {
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const user = (userId: string) => users.find((u) => u.id === userId);
  const clientOf = (p: ProjectRecord) => clients.find((c) => c.id === p.clientId);
  const clientScope = (p: ProjectRecord) =>
    holds('projects.manage', 'all') ||
    (holds('projects.manage', 'own_clients') && clientOf(p)?.accountManagerId === me().user.id);
  const isManager = (p: ProjectRecord) =>
    holds('projects.manage', 'assigned') && p.projectManagerId === me().user.id;
  const seesMoney = (p: ProjectRecord) =>
    holds('invoices.read', 'all') ||
    (holds('invoices.read', 'own_clients') && clientOf(p)?.accountManagerId === me().user.id);
  // Mirrors `projectPermissions` in the API: closed projects are read-only except billing (M3).
  const permissions = (p: ProjectRecord): ProjectDetail['permissions'] => {
    const closed = isProjectClosed(p.status);
    const canManage = !p.archived && !closed && (clientScope(p) || isManager(p));
    return {
      canManage,
      canChangeManager: canManage && clientScope(p),
      canCancel: canManage && clientScope(p),
      canReopen: !p.archived && closed && holds('projects.manage', 'all'),
      canArchive: holds('projects.manage', 'all'),
      canSeeMoney: seesMoney(p),
      canEditMoney: canManage && clientScope(p) && seesMoney(p),
      canBill: !p.archived && clientScope(p) && seesMoney(p),
    };
  };
  const live = (p: ProjectRecord) => p.milestones.filter((m) => !m.archived);
  const noTasks = { total: 0, delivered: 0, open: 0 };

  const milestoneOf = (p: ProjectRecord, m: MilestoneRecord): Milestone => ({
    id: m.id,
    projectId: p.id,
    name: m.name,
    position: live(p).indexOf(m) + 1,
    dueDate: m.dueDate,
    status: m.status,
    overdue: m.status === 'pending' && !!m.dueDate && m.dueDate < PROJECTS_TODAY,
    doneAt: m.doneAt,
    doneBy: m.doneById ? { id: m.doneById, name: user(m.doneById)?.name ?? '' } : null,
    tasks: noTasks,
    ...(seesMoney(p) && { money: { installmentMinor: m.installmentMinor } }),
  });
  const summary = (p: ProjectRecord): Project => {
    const manager = user(p.projectManagerId);
    const milestones = live(p);
    return {
      id: p.id,
      name: p.name,
      client: { id: p.clientId, name: clientOf(p)?.tradeName ?? '' },
      projectManager: {
        id: p.projectManagerId,
        name: manager?.name ?? '',
        archived: manager?.status === 'archived',
      },
      departments: p.departments,
      status: p.status,
      startDate: p.startDate,
      dueDate: p.dueDate,
      overdue: OPEN_STATUSES.includes(p.status) && p.dueDate < PROJECTS_TODAY,
      milestoneProgress: {
        done: milestones.filter((m) => m.status === 'done').length,
        total: milestones.length,
      },
      progress: null,
    };
  };
  const detail = (p: ProjectRecord): ProjectDetail => ({
    ...summary(p),
    description: p.description,
    milestones: live(p).map((m) => milestoneOf(p, m)),
    tasks: noTasks,
    completedAt: p.completedAt,
    cancelledAt: p.cancelledAt,
    cancelReason: p.cancelReason,
    archivedAt: p.archived ? '2026-10-01T10:00:00.000Z' : null,
    ...(seesMoney(p) && {
      money: {
        currency: p.currency,
        totalMinor: live(p).reduce((sum, m) => sum + (m.installmentMinor ?? 0), 0),
      },
    }),
    permissions: permissions(p),
  });
  const extraWorkOf = (p: ProjectRecord, item: ExtraWorkRecord): ExtraWork => {
    const who = clientOf(p)?.contacts.find((x) => x.id === item.contactId);
    return {
      id: item.id,
      projectId: p.id,
      retainerId: null,
      title: item.title,
      description: item.description,
      requestedOn: item.requestedOn,
      contact: who ? { id: who.id, name: who.name, archived: who.archived } : null,
      loggedBy: { id: item.loggedById, name: user(item.loggedById)?.name ?? '' },
      billingStatus: item.billingStatus,
      billingNote: item.billingNote,
      createdAt: item.createdAt,
      ...(seesMoney(p) && { money: { estimateMinor: item.estimateMinor, currency: p.currency } }),
    };
  };
  let next = 870;

  // Answers a projects request, or returns undefined to let the other mocks try.
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const body = <T>() => request.postDataJSON() as T;

    if (path === '/api/projects' && method === 'GET') {
      const q = url.searchParams;
      const statuses = q.getAll('status');
      const wanted = statuses.length > 0 ? statuses : OPEN_STATUSES;
      const archived = q.get('archived') === 'true';
      const search = q.get('search');
      const department = q.get('department') as DepartmentCode | null;
      const items = projects
        .filter(
          (p) =>
            p.archived === archived &&
            !clientOf(p)?.archived &&
            wanted.includes(p.status) &&
            (!search || p.name.includes(search) || !!clientOf(p)?.tradeName.includes(search)) &&
            (!q.get('clientId') || p.clientId === q.get('clientId')) &&
            (!q.get('projectManagerId') || p.projectManagerId === q.get('projectManagerId')) &&
            (!department || p.departments.includes(department)) &&
            (q.get('overdue') !== 'true' || summary(p).overdue),
        )
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map(summary);
      const pageSize = Number(q.get('pageSize') ?? 50);
      return json(route, {
        items: items.slice(0, pageSize),
        total: items.length,
        page: 1,
        pageSize,
      });
    }
    if (path === '/api/projects' && method === 'POST') {
      const input = body<CreateProject>();
      const created: ProjectRecord = {
        id: id(next++),
        clientId: input.clientId,
        name: input.name,
        description: input.description ?? null,
        projectManagerId: input.projectManagerId,
        departments: input.departments,
        status: input.status ?? 'planned',
        startDate: input.startDate,
        dueDate: input.dueDate,
        currency: input.currency ?? 'USD',
        completedAt: null,
        cancelledAt: null,
        cancelReason: null,
        archived: false,
        milestones: (input.milestones ?? []).map((m) =>
          milestone(next++, m.name, m.dueDate ?? null, m.installmentMinor ?? null),
        ),
        extraWork: [],
      };
      if (!clientScope(created)) return fail(route, 403, 'FORBIDDEN');
      projects.push(created);
      return json(route, detail(created), 201);
    }

    const match = path.match(
      /^\/api\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/,
    );
    if (!match) return undefined;
    const [, projectId, part, childId, childAction] = match;
    const project = projects.find((p) => p.id === projectId);
    if (!project || (project.archived && !holds('projects.manage', 'all'))) {
      return fail(route, 404, 'NOT_FOUND');
    }
    const allowed = permissions(project);

    if (!part) {
      if (method === 'GET') return json(route, detail(project));
      if (!allowed.canManage) return fail(route, 403, 'FORBIDDEN');
      Object.assign(project, body<Partial<ProjectRecord>>());
      return json(route, detail(project));
    }
    if (part === 'status') {
      const change = body<ProjectStatusChange>();
      if (change.status === 'completed') {
        const pending = live(project).filter((m) => m.status === 'pending');
        if (pending.length > 0) {
          const open = pending.map((m) => ({ id: m.id, name: m.name }));
          return fail(route, 409, 'MILESTONES_OPEN', open);
        }
        project.completedAt = new Date().toISOString();
      }
      if (change.status === 'cancelled') {
        project.cancelledAt = new Date().toISOString();
        project.cancelReason = change.reason ?? null;
      }
      if (change.projectManagerId) project.projectManagerId = change.projectManagerId;
      project.status = change.status;
      return json(route, detail(project));
    }
    if (part === 'archive' || part === 'restore') {
      project.archived = part === 'archive';
      return json(route, detail(project));
    }
    if (part === 'milestones') {
      if (!allowed.canManage) return fail(route, 403, 'FORBIDDEN');
      if (childId === 'order') {
        const { ids } = body<{ ids: string[] }>();
        project.milestones.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        return json(route, { items: detail(project).milestones });
      }
      if (!childId) {
        const input = body<CreateMilestone>();
        const created = milestone(
          next++,
          input.name,
          input.dueDate ?? null,
          input.installmentMinor ?? null,
        );
        project.milestones.push(created);
        return json(route, milestoneOf(project, created), 201);
      }
      const item = project.milestones.find((m) => m.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      if (childAction === 'complete') {
        Object.assign(item, {
          status: 'done',
          doneAt: new Date().toISOString(),
          doneById: me().user.id,
        });
      } else if (childAction === 'reopen') {
        Object.assign(item, { status: 'pending', doneAt: null, doneById: null });
      } else {
        Object.assign(item, body<Partial<MilestoneRecord>>());
      }
      return json(route, milestoneOf(project, item));
    }
    if (part === 'extra-work') {
      if (!childId && method === 'GET') {
        const items = project.extraWork
          .filter((item) => !item.archived)
          .sort((a, b) => b.requestedOn.localeCompare(a.requestedOn))
          .map((item) => extraWorkOf(project, item));
        return json(route, { items, total: items.length, page: 1, pageSize: 20 });
      }
      if (childAction === 'billing' ? !allowed.canBill : !allowed.canManage) {
        return fail(route, 403, 'FORBIDDEN');
      }
      if (!childId) {
        const input = body<CreateExtraWork>();
        const created: ExtraWorkRecord = {
          id: id(next++),
          title: input.title,
          description: input.description ?? null,
          requestedOn: input.requestedOn ?? PROJECTS_TODAY,
          contactId: input.requestedByContactId ?? null,
          estimateMinor: input.estimateMinor ?? null,
          billingStatus: 'unbilled',
          billingNote: null,
          loggedById: me().user.id,
          createdAt: new Date().toISOString(),
          archived: false,
        };
        project.extraWork.push(created);
        return json(route, extraWorkOf(project, created), 201);
      }
      const item = project.extraWork.find((x) => x.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      if (childAction === 'billing') {
        Object.assign(item, body<ExtraWorkBillingChange>());
        return json(route, extraWorkOf(project, item));
      }
      const { requestedByContactId, ...changes } = body<UpdateExtraWork>();
      Object.assign(item, changes);
      if (requestedByContactId !== undefined) item.contactId = requestedByContactId;
      return json(route, extraWorkOf(project, item));
    }
    return undefined;
  };
}
interface AdjustmentRecord {
  id: string;
  delta: number;
  reason: string;
  authorId: string;
  createdAt: string;
}

interface CycleLineRecord {
  id: string;
  deliverableId: string | null;
  kind: DeliverableKind;
  label: string | null;
  committed: number;
  /** Frozen when the cycle closes (R8). */
  deliveredAtClose: number | null;
  /** Tasks delivered after the cycle closed (F06; seeded here). */
  afterClose: number;
  adjustments: AdjustmentRecord[];
}

interface CycleRecord {
  id: string;
  month: string;
  periodStart: string;
  periodEnd: string;
  status: CycleStatus;
  closedAt: string | null;
  lines: CycleLineRecord[];
}

interface DeliverableRecord {
  id: string;
  kind: DeliverableKind;
  label: string | null;
  monthlyQuantity: number;
  archived: boolean;
}

interface RetainerRecord {
  id: string;
  clientId: string;
  name: string;
  departments: DepartmentCode[];
  status: RetainerStatus;
  startDate: string;
  renewalDate: string | null;
  endedOn: string | null;
  currency: Currency;
  monthlyFeeMinor: number | null;
  archived: boolean;
  deliverables: DeliverableRecord[];
  cycles: CycleRecord[];
  extraWork: ExtraWorkRecord[];
}

const deliverable = (
  n: number,
  kind: DeliverableKind,
  monthlyQuantity: number,
  label: string | null = null,
): DeliverableRecord => ({ id: id(n), kind, label, monthlyQuantity, archived: false });

/** A cycle line with a delivered count: frozen when `closed`, otherwise one adjustment. */
const cycleLine = (
  n: number,
  source: DeliverableRecord | { kind: DeliverableKind; label: string },
  committed: number,
  delivered: number,
  closed: boolean,
  afterClose = 0,
): CycleLineRecord => ({
  id: id(n),
  deliverableId: 'id' in source ? source.id : null,
  kind: source.kind,
  label: source.label,
  committed,
  deliveredAtClose: closed ? delivered : null,
  afterClose,
  adjustments: [],
});

export function retainersSeed(): RetainerRecord[] {
  const design = deliverable(911, 'design', 12);
  const reel = deliverable(912, 'reel', 4);
  const story = deliverable(913, 'story', 8);
  const report = deliverable(914, 'monthly_report', 1);
  const ads = deliverable(915, 'ad_campaign', 2);
  const adsReport = deliverable(916, 'monthly_report', 1);
  const shoot = deliverable(917, 'photo_shoot', 1);
  const october: CycleRecord = {
    id: id(921),
    month: '2026-10-01',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'open',
    closedAt: null,
    lines: [
      cycleLine(931, design, 12, 0, false),
      cycleLine(932, reel, 4, 0, false),
      cycleLine(933, story, 8, 0, false),
      cycleLine(934, report, 1, 0, false),
    ],
  };
  const [octoberDesign, , octoberStory] = october.lines;
  octoberDesign?.adjustments.push({
    id: id(961),
    delta: 3,
    reason: 'تصاميم حملة الخريف سُلّمت خارج المهام',
    authorId: id(3),
    createdAt: '2026-10-06T08:15:00.000Z',
  });
  octoberStory?.adjustments.push({
    id: id(962),
    delta: 4,
    reason: 'ستوريات الأسبوع الأول',
    authorId: id(3),
    createdAt: '2026-10-07T12:40:00.000Z',
  });
  const closedOn = (day: string) => `${day}T21:05:00.000Z`;
  return [
    {
      id: id(901),
      clientId: id(601),
      name: 'إدارة السوشيال ميديا',
      departments: ['marketing', 'design', 'content_management'],
      status: 'active',
      startDate: '2026-03-01',
      renewalDate: '2026-11-01',
      endedOn: null,
      currency: 'USD',
      monthlyFeeMinor: 150_000,
      archived: false,
      deliverables: [design, reel, story, report],
      cycles: [
        october,
        {
          id: id(922),
          month: '2026-09-01',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          status: 'closed',
          closedAt: closedOn('2026-09-30'),
          lines: [
            cycleLine(941, design, 12, 12, true),
            cycleLine(942, reel, 4, 4, true),
            cycleLine(943, story, 8, 7, true),
            cycleLine(944, report, 1, 1, true),
          ],
        },
        {
          id: id(923),
          month: '2026-08-01',
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          status: 'closed',
          closedAt: closedOn('2026-08-31'),
          lines: [
            cycleLine(945, design, 12, 10, true, 1),
            cycleLine(946, reel, 4, 4, true),
            cycleLine(947, story, 8, 8, true),
            cycleLine(948, report, 1, 1, true),
            cycleLine(949, { kind: 'other', label: 'تغطية افتتاح الفرع' }, 1, 1, true),
          ],
        },
      ],
      extraWork: [
        {
          id: id(981),
          title: 'ريل إضافي لافتتاح الفرع الثاني',
          description: null,
          requestedOn: '2026-10-04',
          contactId: id(611),
          estimateMinor: 20_000,
          billingStatus: 'unbilled',
          billingNote: null,
          loggedById: id(3),
          createdAt: '2026-10-04T10:00:00.000Z',
          archived: false,
        },
      ],
    },
    {
      id: id(902),
      clientId: id(602),
      name: 'الإعلانات الممولة',
      departments: ['marketing'],
      status: 'paused',
      startDate: '2026-05-01',
      renewalDate: '2027-05-01',
      endedOn: null,
      currency: 'SYP',
      monthlyFeeMinor: null,
      archived: false,
      deliverables: [ads, adsReport],
      cycles: [
        {
          id: id(924),
          month: '2026-09-01',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          status: 'closed',
          closedAt: closedOn('2026-09-30'),
          lines: [cycleLine(951, ads, 2, 1, true), cycleLine(952, adsReport, 1, 1, true)],
        },
      ],
      extraWork: [],
    },
    {
      id: id(903),
      clientId: id(601),
      name: 'تصوير المنيو الموسمي',
      departments: ['photography'],
      status: 'ended',
      startDate: '2026-06-01',
      renewalDate: null,
      endedOn: '2026-09-30',
      currency: 'USD',
      monthlyFeeMinor: 40_000,
      archived: false,
      deliverables: [shoot],
      cycles: [
        {
          id: id(925),
          month: '2026-09-01',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          status: 'closed',
          closedAt: closedOn('2026-09-30'),
          lines: [cycleLine(953, shoot, 1, 1, true)],
        },
      ],
      extraWork: [],
    },
  ];
}

interface RetainerState {
  users: UserResponse[];
  clients: ClientRecord[];
  retainers: RetainerRecord[];
  me: () => MeResponse;
}

/** The retainers API (F05) over the in-memory records, with its access, cycle and money rules. */
function retainerRoutes({ users, clients, retainers, me }: RetainerState) {
  const today = PROJECTS_TODAY;
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const user = (userId: string) => users.find((u) => u.id === userId);
  const clientOf = (r: RetainerRecord) => clients.find((c) => c.id === r.clientId);
  const clientScope = (r: RetainerRecord) =>
    holds('projects.manage', 'all') ||
    (holds('projects.manage', 'own_clients') && clientOf(r)?.accountManagerId === me().user.id);
  const seesMoney = (r: RetainerRecord) =>
    holds('invoices.read', 'all') ||
    (holds('invoices.read', 'own_clients') && clientOf(r)?.accountManagerId === me().user.id);
  // Mirrors `retainerPermissions` in the API: ended retainers are read-only except billing (M3).
  const permissions = (r: RetainerRecord): RetainerDetail['permissions'] => {
    const readOnly = r.archived || !!clientOf(r)?.archived;
    const canManage = !readOnly && r.status !== 'ended' && clientScope(r);
    return {
      canManage,
      canReactivate: !readOnly && r.status === 'ended' && holds('projects.manage', 'all'),
      canArchive: holds('projects.manage', 'all'),
      canSeeMoney: seesMoney(r),
      canEditMoney: canManage && seesMoney(r),
      canBill: !readOnly && clientScope(r) && seesMoney(r),
    };
  };
  const noTasks = { total: 0, delivered: 0, open: 0 };
  const deliveredOf = (line: CycleLineRecord) =>
    line.deliveredAtClose ?? line.adjustments.reduce((sum, a) => sum + a.delta, 0);

  const lineOf = (r: RetainerRecord, c: CycleRecord, line: CycleLineRecord) => {
    const delivered = deliveredOf(line);
    return {
      id: line.id,
      cycleId: c.id,
      deliverableId: line.deliverableId,
      kind: line.kind,
      label: line.label,
      position: c.lines.indexOf(line) + 1,
      committed: line.committed,
      delivered,
      deliveredAfterClose: c.status === 'closed' ? line.afterClose : 0,
      behind:
        c.status === 'open' &&
        r.status === 'active' &&
        isLineBehind({ committed: line.committed, delivered }, c, today),
      tasks: noTasks,
    };
  };
  const cycleOf = (r: RetainerRecord, c: CycleRecord): Cycle => {
    const lines = c.lines.map((line) => lineOf(r, c, line));
    return {
      id: c.id,
      retainerId: r.id,
      month: c.month,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      status: c.status,
      closedAt: c.closedAt,
      deliveryRate: rateOf(lines),
      behind: lines.some((line) => line.behind),
      lines,
    };
  };
  const cycleDetailOf = (r: RetainerRecord, c: CycleRecord): CycleDetail => ({
    ...cycleOf(r, c),
    lines: c.lines.map((line) => ({
      ...lineOf(r, c, line),
      adjustments: [...line.adjustments].reverse().map((a) => ({
        id: a.id,
        delta: a.delta,
        reason: a.reason,
        author: { id: a.authorId, name: user(a.authorId)?.name ?? '' },
        createdAt: a.createdAt,
      })),
    })),
  });
  const newest = (r: RetainerRecord) =>
    [...r.cycles].sort((a, b) => b.month.localeCompare(a.month));
  const current = (r: RetainerRecord) => newest(r).find((c) => c.status === 'open');
  const live = (r: RetainerRecord) => r.deliverables.filter((d) => !d.archived);

  const summary = (r: RetainerRecord): Retainer => {
    const client = clientOf(r);
    const open = current(r);
    return {
      id: r.id,
      name: r.name,
      client: { id: r.clientId, name: client?.tradeName ?? '' },
      accountManager: {
        id: client?.accountManagerId ?? '',
        name: user(client?.accountManagerId ?? '')?.name ?? '',
      },
      departments: r.departments,
      status: r.status,
      renewalDate: r.renewalDate,
      renewal: renewalState(r.renewalDate, r.status, today),
      currentCycle: open ? cycleOf(r, open) : null,
    };
  };
  const detail = (r: RetainerRecord): RetainerDetail => ({
    ...summary(r),
    startDate: r.startDate,
    endedOn: r.endedOn,
    deliverables: live(r).map((d, index) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      monthlyQuantity: d.monthlyQuantity,
      position: index + 1,
    })),
    archivedAt: r.archived ? '2026-10-01T10:00:00.000Z' : null,
    ...(seesMoney(r) && {
      money: { currency: r.currency, monthlyFeeMinor: r.monthlyFeeMinor },
    }),
    permissions: permissions(r),
  });
  const extraWorkOf = (r: RetainerRecord, item: ExtraWorkRecord): ExtraWork => {
    const who = clientOf(r)?.contacts.find((x) => x.id === item.contactId);
    return {
      id: item.id,
      projectId: null,
      retainerId: r.id,
      title: item.title,
      description: item.description,
      requestedOn: item.requestedOn,
      contact: who ? { id: who.id, name: who.name, archived: who.archived } : null,
      loggedBy: { id: item.loggedById, name: user(item.loggedById)?.name ?? '' },
      billingStatus: item.billingStatus,
      billingNote: item.billingNote,
      createdAt: item.createdAt,
      ...(seesMoney(r) && { money: { estimateMinor: item.estimateMinor, currency: r.currency } }),
    };
  };
  let next = 1900;

  /** R3: this month's cycle, opened at once with the full quantities, if none exists. */
  const openCurrent = (r: RetainerRecord, from: string) => {
    const month = firstOfMonth(today);
    if (r.cycles.some((c) => c.month === month)) return;
    r.cycles.push({
      id: id(next++),
      month,
      periodStart: from > month ? from : month,
      periodEnd: lastOfMonth(today),
      status: 'open',
      closedAt: null,
      lines: live(r).map((d) => cycleLine(next++, d, d.monthlyQuantity, 0, false)),
    });
  };

  // Answers a retainers request, or returns undefined to let the other mocks try.
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const body = <T>() => request.postDataJSON() as T;

    if (path === '/api/retainers' && method === 'GET') {
      const q = url.searchParams;
      const statuses = q.getAll('status');
      const wanted: string[] = statuses.length > 0 ? statuses : ['active', 'paused'];
      const archived = q.get('archived') === 'true';
      const search = q.get('search');
      const department = q.get('department') as DepartmentCode | null;
      const items = retainers
        .filter((r) => {
          const shown = summary(r);
          return (
            r.archived === archived &&
            !clientOf(r)?.archived &&
            wanted.includes(r.status) &&
            (!search || r.name.includes(search) || !!clientOf(r)?.tradeName.includes(search)) &&
            (!q.get('clientId') || r.clientId === q.get('clientId')) &&
            (!q.get('accountManagerId') ||
              clientOf(r)?.accountManagerId === q.get('accountManagerId')) &&
            (!department || r.departments.includes(department)) &&
            (q.get('behind') !== 'true' || !!shown.currentCycle?.behind) &&
            (q.get('renewalDue') !== 'true' || shown.renewal !== null)
          );
        })
        .map(summary)
        .sort((a, b) => a.client.name.localeCompare(b.client.name, 'ar'));
      const pageSize = Number(q.get('pageSize') ?? 50);
      return json(route, {
        items: items.slice(0, pageSize),
        total: items.length,
        page: 1,
        pageSize,
      });
    }
    if (path === '/api/retainers' && method === 'POST') {
      const input = body<CreateRetainer>();
      const created: RetainerRecord = {
        id: id(next++),
        clientId: input.clientId,
        name: input.name,
        departments: input.departments,
        status: 'active',
        startDate: input.startDate,
        renewalDate: input.renewalDate ?? null,
        endedOn: null,
        currency: input.currency ?? 'USD',
        monthlyFeeMinor: input.monthlyFeeMinor ?? null,
        archived: false,
        deliverables: (input.deliverables ?? []).map((d) =>
          deliverable(next++, d.kind, d.monthlyQuantity, d.label ?? null),
        ),
        cycles: [],
        extraWork: [],
      };
      if (!clientScope(created)) return fail(route, 403, 'FORBIDDEN');
      if (created.startDate <= today) openCurrent(created, created.startDate);
      retainers.push(created);
      return json(route, detail(created), 201);
    }

    const match = path.match(
      /^\/api\/retainers\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/,
    );
    if (!match) return undefined;
    const [, retainerId, part, childId, childPart, lineId, lineAction] = match;
    const retainer = retainers.find((r) => r.id === retainerId);
    if (!retainer || (retainer.archived && !holds('projects.manage', 'all'))) {
      return fail(route, 404, 'NOT_FOUND');
    }
    const allowed = permissions(retainer);

    if (!part) {
      if (method === 'GET') return json(route, detail(retainer));
      if (!allowed.canManage) return fail(route, 403, 'FORBIDDEN');
      Object.assign(retainer, body<Partial<RetainerRecord>>());
      return json(route, detail(retainer));
    }
    if (part === 'deliverables') {
      if (!allowed.canManage) return fail(route, 403, 'FORBIDDEN');
      const { lines } = body<RetainerDeliverables>();
      const kept = new Set(lines.flatMap((line) => (line.id ? [line.id] : [])));
      for (const d of retainer.deliverables) if (!kept.has(d.id)) d.archived = true;
      const ordered = lines.map((line) => {
        const existing = retainer.deliverables.find((d) => d.id === line.id);
        if (!existing)
          return deliverable(next++, line.kind, line.monthlyQuantity, line.label ?? null);
        return Object.assign(existing, {
          kind: line.kind,
          label: line.label ?? null,
          monthlyQuantity: line.monthlyQuantity,
        });
      });
      retainer.deliverables = [...ordered, ...retainer.deliverables.filter((d) => d.archived)];
      return json(route, { items: detail(retainer).deliverables });
    }
    if (part === 'status') {
      const { status } = body<RetainerStatusChange>();
      if (status === 'active' ? !allowed.canManage && !allowed.canReactivate : !allowed.canManage) {
        return fail(route, 403, 'FORBIDDEN');
      }
      if (status === 'ended') {
        for (const c of retainer.cycles.filter((c) => c.status === 'open')) {
          for (const line of c.lines) line.deliveredAtClose = deliveredOf(line);
          Object.assign(c, {
            status: 'closed',
            closedAt: new Date().toISOString(),
            periodEnd: c.periodEnd > today ? today : c.periodEnd,
          });
        }
        retainer.endedOn = today;
      }
      if (status === 'active') {
        retainer.endedOn = null;
        openCurrent(retainer, today);
      }
      retainer.status = status;
      return json(route, detail(retainer));
    }
    if (part === 'archive' || part === 'restore') {
      retainer.archived = part === 'archive';
      return json(route, detail(retainer));
    }
    if (part === 'cycles') {
      if (!childId) {
        const items = newest(retainer).map((c) => cycleOf(retainer, c));
        return json(route, { items, total: items.length, page: 1, pageSize: 12 });
      }
      const cycle = retainer.cycles.find((c) => c.id === childId);
      if (!cycle) return fail(route, 404, 'NOT_FOUND');
      if (!childPart) return json(route, cycleDetailOf(retainer, cycle));
      if (!allowed.canManage) return fail(route, 403, 'FORBIDDEN');
      if (cycle.status === 'closed') return fail(route, 409, 'CYCLE_CLOSED');
      if (!lineId) {
        const input = body<CreateCycleLine>();
        const line = cycleLine(
          next++,
          { kind: input.kind, label: input.label ?? '' },
          input.committedQuantity,
          0,
          false,
        );
        line.label = input.label ?? null;
        cycle.lines.push(line);
        return json(route, lineOf(retainer, cycle, line), 201);
      }
      const line = cycle.lines.find((l) => l.id === lineId);
      if (!line) return fail(route, 404, 'NOT_FOUND');
      if (lineAction === 'adjustments') {
        const input = body<CreateCycleAdjustment>();
        if (deliveredOf(line) + input.delta < 0) return fail(route, 409, 'NEGATIVE_DELIVERED');
        line.adjustments.push({
          id: id(next++),
          delta: input.delta,
          reason: input.reason,
          authorId: me().user.id,
          createdAt: new Date().toISOString(),
        });
        return json(route, lineOf(retainer, cycle, line), 201);
      }
      line.committed = body<UpdateCycleLine>().committedQuantity;
      return json(route, lineOf(retainer, cycle, line));
    }
    if (part === 'extra-work') {
      if (!childId && method === 'GET') {
        const items = retainer.extraWork
          .filter((item) => !item.archived)
          .sort((a, b) => b.requestedOn.localeCompare(a.requestedOn))
          .map((item) => extraWorkOf(retainer, item));
        return json(route, { items, total: items.length, page: 1, pageSize: 20 });
      }
      if (childPart === 'billing' ? !allowed.canBill : !allowed.canManage) {
        return fail(route, 403, 'FORBIDDEN');
      }
      if (!childId) {
        const input = body<CreateExtraWork>();
        const created: ExtraWorkRecord = {
          id: id(next++),
          title: input.title,
          description: input.description ?? null,
          requestedOn: input.requestedOn ?? today,
          contactId: input.requestedByContactId ?? null,
          estimateMinor: input.estimateMinor ?? null,
          billingStatus: 'unbilled',
          billingNote: null,
          loggedById: me().user.id,
          createdAt: new Date().toISOString(),
          archived: false,
        };
        retainer.extraWork.push(created);
        return json(route, extraWorkOf(retainer, created), 201);
      }
      const item = retainer.extraWork.find((x) => x.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childPart === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      if (childPart === 'billing') {
        Object.assign(item, body<ExtraWorkBillingChange>());
        return json(route, extraWorkOf(retainer, item));
      }
      const { requestedByContactId, ...changes } = body<UpdateExtraWork>();
      Object.assign(item, changes);
      if (requestedByContactId !== undefined) item.contactId = requestedByContactId;
      return json(route, extraWorkOf(retainer, item));
    }
    return undefined;
  };
}

/** Ids of the seeded team, for navigating straight to a profile or department. */
export const seedIds = {
  sara: id(1),
  omar: id(2),
  layan: id(3),
  design: design.id,
  karim: id(4),
  jasmine: id(601),
  shifa: id(602),
  identityProject: id(801),
  launchProject: id(802),
  clinicSite: id(803),
  summerMenu: id(805),
  socialRetainer: id(901),
  adsRetainer: id(902),
  endedRetainer: id(903),
};

/** Viewport screenshot kept in the test output and attached to the HTML report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
