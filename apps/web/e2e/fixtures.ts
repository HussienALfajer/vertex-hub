import type { Page, Route, TestInfo } from '@playwright/test';
import {
  type AuditEntry,
  allowedTaskTransitions,
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
  type CreateTaskInput,
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
  isTaskBlocked,
  isTaskFinished,
  isTaskOpen,
  isTaskOverdue,
  lastOfMonth,
  type MeResponse,
  type Milestone,
  type MilestoneStatus,
  type MyTaskSummary,
  mentionedUserIds,
  type Note,
  type NoteChannel,
  OPEN_TASK_STATUSES,
  type PlatformAccount,
  type Project,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectStatusChange,
  type RequestScope,
  type Retainer,
  type RetainerDeliverables,
  type RetainerDetail,
  type RetainerStatus,
  type RetainerStatusChange,
  type RevisionDecision,
  type RevisionDecisionInput,
  type RevisionSource,
  deliveryRate as rateOf,
  renewalState,
  revisionSourceOf,
  TASK_PRIORITIES,
  type Task,
  type TaskComment,
  type TaskDependenciesInput,
  type TaskDetail,
  type TaskPriority,
  type TaskRights,
  type TaskStatus,
  type TaskStatusChange,
  type TaskType,
  taskMove,
  type UpdateCycleLine,
  type UpdateExtraWork,
  type UpdateTaskInput,
  type UserResponse,
  weekOf,
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

/** Switches the signed-in user mid-test, keeping the in-memory data; reload the page after. */
export interface MockedApi {
  signInAs: (next: MeResponse) => void;
}

/** Mocks the API with an in-memory team. `signedIn` decides whether /api/me finds a session. */
export async function mockApi(page: Page, options: MockOptions): Promise<MockedApi> {
  let signedIn = options.signedIn;
  let me = options.me ?? manager;
  const users = teamSeed();
  const clients = clientsSeed();
  const clientsApi = clientRoutes({ users, clients, me: () => me });
  const projects = projectsSeed();
  const projectsApi = projectRoutes({ users, clients, projects, me: () => me });
  const retainers = retainersSeed();
  const retainersApi = retainerRoutes({ users, clients, retainers, me: () => me });
  const tasks = tasksSeed();
  const tasksApi = taskRoutes({ users, clients, projects, retainers, tasks, me: () => me });
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
        // F06: open tasks they are assignee of.
        const assigned = tasks.filter(
          (t) => !t.archived && isTaskOpen(t.status) && t.assigneeId === user.id,
        );
        if (
          managed.length > 0 ||
          accounts.length > 0 ||
          running.length > 0 ||
          assigned.length > 0
        ) {
          return fail(route, 409, 'USER_HAS_RESPONSIBILITIES', [
            ...managed.map((d) => ({ type: 'manages_department', id: d.id, name: d.name })),
            ...accounts.map((c) => ({
              type: 'account_manager_of_client',
              id: c.id,
              name: c.tradeName,
            })),
            ...running.map((p) => ({ type: 'project_manager_of_project', id: p.id, name: p.name })),
            ...assigned.map((t) => ({ type: 'assignee_of_open_tasks', id: t.id, name: t.title })),
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

    // Tasks (F06).
    const tasked = tasksApi(route, method, url, request);
    if (tasked) return tasked;

    if (path === '/api/audit') {
      return json(route, { items: auditSeed, total: auditSeed.length, page: 1, pageSize: 30 });
    }
    return fail(route, 404, 'NOT_FOUND');
  });
  return {
    signInAs: (next) => {
      me = next;
    },
  };
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

// Tasks (F06)

interface TaskRevisionRecord {
  id: string;
  source: RevisionSource;
  number: number | null;
  note: string;
  contactId: string | null;
  overLimit: boolean;
  decision: RevisionDecision | null;
  decisionNote: string | null;
  extraWork: { id: string; title: string } | null;
  decidedById: string | null;
  decidedAt: string | null;
  authorId: string;
  createdAt: string;
}

interface TaskCommentRecord {
  id: string;
  authorId: string;
  body: string;
  editedAt: string | null;
  archived: boolean;
  createdAt: string;
}

interface TaskRecord {
  id: string;
  title: string;
  brief: string | null;
  type: TaskType;
  department: DepartmentCode;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
  dueTime: string | null;
  clientId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  retainerId: string | null;
  cycleId: string | null;
  cycleLineId: string | null;
  needsClientApproval: boolean;
  revisionLimit: number;
  request: {
    contactId: string | null;
    requestedOn: string;
    scope: RequestScope;
    extraWork: { id: string; title: string } | null;
  } | null;
  createdById: string;
  createdAt: string;
  startedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  archived: boolean;
  dependsOn: string[];
  checklist: {
    id: string;
    text: string;
    doneAt: string | null;
    doneById: string | null;
    archived: boolean;
  }[];
  links: { id: string; url: string; label: string | null; addedById: string; archived: boolean }[];
  revisions: TaskRevisionRecord[];
  comments: TaskCommentRecord[];
}

/** "Now" for the task mocks: the seeded today, morning in Asia/Damascus. */
const TASKS_NOW = new Date(`${PROJECTS_TODAY}T09:00:00+03:00`);

function taskRecord(
  n: number,
  fields: Partial<TaskRecord> & Pick<TaskRecord, 'title'>,
): TaskRecord {
  return {
    id: id(n),
    brief: null,
    type: 'work',
    department: 'design',
    assigneeId: null,
    status: 'new',
    priority: 'normal',
    dueDate: '2026-10-14',
    dueTime: null,
    clientId: null,
    projectId: null,
    milestoneId: null,
    retainerId: null,
    cycleId: null,
    cycleLineId: null,
    needsClientApproval: false,
    revisionLimit: 2,
    request: null,
    createdById: id(3),
    createdAt: '2026-10-05T08:00:00.000Z',
    startedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    archived: false,
    dependsOn: [],
    checklist: [],
    links: [],
    revisions: [],
    comments: [],
    ...fields,
  };
}

const clientRevision = (
  n: number,
  number: number,
  note: string,
  overLimit: boolean,
  createdAt: string,
): TaskRevisionRecord => ({
  id: id(n),
  source: 'client',
  number,
  note,
  contactId: id(701),
  overLimit,
  decision: null,
  decisionNote: null,
  extraWork: null,
  decidedById: null,
  decidedAt: null,
  authorId: id(3),
  createdAt,
});

/** Tasks around the seeded clients, one of each kind My tasks and the task page show. */
export function tasksSeed(): TaskRecord[] {
  const jasmine = id(601);
  return [
    taskRecord(1001, {
      title: 'تصاميم منيو الخريف',
      brief: 'ثلاث صفحات للمنيو الجديد بمقاس A4، بألوان الهوية الجديدة وصور الأطباق الموسمية.',
      assigneeId: id(3),
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-10-09',
      clientId: jasmine,
      projectId: id(801),
      milestoneId: id(813),
      needsClientApproval: true,
      startedAt: '2026-10-06T07:30:00.000Z',
      checklist: [
        {
          id: id(1101),
          text: 'جمع صور الأطباق',
          doneAt: '2026-10-06T09:00:00.000Z',
          doneById: id(3),
          archived: false,
        },
        {
          id: id(1102),
          text: 'مسودة الصفحة الأولى',
          doneAt: '2026-10-07T12:00:00.000Z',
          doneById: id(3),
          archived: false,
        },
        {
          id: id(1103),
          text: 'الصفحتان الثانية والثالثة',
          doneAt: null,
          doneById: null,
          archived: false,
        },
        {
          id: id(1104),
          text: 'تجهيز ملفات الطباعة',
          doneAt: null,
          doneById: null,
          archived: false,
        },
      ],
      links: [
        {
          id: id(1201),
          url: 'https://drive.google.com/drive/folders/autumn-menu',
          label: 'مجلد التصاميم',
          addedById: id(3),
          archived: false,
        },
      ],
    }),
    taskRecord(1002, {
      title: 'جلسة تصوير الأطباق',
      department: 'photography',
      assigneeId: id(4),
      dueDate: PROJECTS_TODAY,
      dueTime: '16:00',
      clientId: jasmine,
      projectId: id(801),
      needsClientApproval: true,
      dependsOn: [id(1001)],
    }),
    taskRecord(1003, {
      title: 'بوستات أسبوع الافتتاح',
      brief: 'ستة بوستات لأسبوع افتتاح الفرع الجديد.',
      assigneeId: id(3),
      status: 'revisions',
      dueDate: '2026-10-14',
      clientId: jasmine,
      retainerId: id(901),
      cycleId: id(921),
      cycleLineId: id(931),
      needsClientApproval: true,
      startedAt: '2026-10-02T08:00:00.000Z',
      checklist: [
        {
          id: id(1105),
          text: 'نصوص البوستات',
          doneAt: '2026-10-03T09:00:00.000Z',
          doneById: id(3),
          archived: false,
        },
        {
          id: id(1106),
          text: 'تصميم البوستات الستة',
          doneAt: null,
          doneById: null,
          archived: false,
        },
      ],
      links: [
        {
          id: id(1202),
          url: 'https://www.figma.com/file/opening-week',
          label: null,
          addedById: id(3),
          archived: false,
        },
      ],
      revisions: [
        {
          ...clientRevision(1301, 0, '', false, '2026-10-04T10:00:00.000Z'),
          source: 'internal',
          number: null,
          note: 'وحّد الخط في البوستات الستة.',
          contactId: null,
        },
        clientRevision(1302, 1, 'تكبير الشعار في البوست الأول.', false, '2026-10-06T11:00:00.000Z'),
        clientRevision(1303, 2, 'تغيير لون الخلفية إلى الأخضر.', false, '2026-10-07T13:00:00.000Z'),
        clientRevision(
          1304,
          3,
          'إضافة صورة الشيف في البوست الأخير.',
          true,
          '2026-10-09T15:00:00.000Z',
        ),
      ],
      comments: [
        {
          id: id(1401),
          authorId: id(1),
          body: `@{${id(3)}} العميل طلب تعديلًا ثالثًا، قرري هل نحسبه عملًا إضافيًا.`,
          editedAt: null,
          archived: false,
          createdAt: '2026-10-09T15:10:00.000Z',
        },
        {
          id: id(1402),
          authorId: id(3),
          body: 'سأراجع العقد وأرد اليوم.',
          editedAt: '2026-10-09T16:05:00.000Z',
          archived: false,
          createdAt: '2026-10-09T16:00:00.000Z',
        },
      ],
    }),
    taskRecord(1004, {
      title: 'تحديث قالب التقارير الشهرية',
      department: 'content_management',
      priority: 'low',
      dueDate: '2026-10-20',
    }),
    taskRecord(1005, {
      title: 'فيديو تعريفي للعيادة',
      priority: 'urgent',
      dueDate: '2026-10-12',
      clientId: id(602),
      needsClientApproval: true,
      createdById: id(1),
    }),
    taskRecord(1006, {
      title: 'مراجعة شعار العيادة',
      assigneeId: id(5),
      status: 'internal_review',
      dueDate: '2026-10-13',
      clientId: id(602),
      needsClientApproval: true,
      createdById: id(1),
      startedAt: '2026-10-03T08:00:00.000Z',
    }),
    taskRecord(1007, {
      title: 'غلاف فيسبوك لشهر أكتوبر',
      assigneeId: id(3),
      status: 'delivered',
      dueDate: '2026-10-05',
      clientId: jasmine,
      retainerId: id(901),
      cycleId: id(921),
      cycleLineId: id(931),
      needsClientApproval: true,
      startedAt: '2026-10-01T08:00:00.000Z',
      deliveredAt: '2026-10-05T12:00:00.000Z',
    }),
  ];
}

interface TaskState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  me: () => MeResponse;
}

const OPEN_TASK: TaskStatus[] = [...OPEN_TASK_STATUSES];

/** The tasks API (F06) over the in-memory records, with its scopes and workflow rules. */
function taskRoutes({ users, clients, projects, retainers, tasks, me }: TaskState) {
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const managed = () =>
    me()
      .departments.filter((d) => d.isManager)
      .map((d) => d.code);
  const user = (userId: string) => users.find((u) => u.id === userId);
  const person = (userId: string) => ({ id: userId, name: user(userId)?.name ?? '' });
  const clientOf = (task: TaskRecord) => clients.find((c) => c.id === task.clientId);
  const projectOf = (task: TaskRecord) => projects.find((p) => p.id === task.projectId);
  const retainerOf = (task: TaskRecord) => retainers.find((r) => r.id === task.retainerId);
  const cycleOf = (task: TaskRecord) => retainerOf(task)?.cycles.find((c) => c.id === task.cycleId);
  const contactOf = (task: TaskRecord, contactId: string | null) => {
    const contact = clientOf(task)?.contacts.find((c) => c.id === contactId);
    return contact ? { id: contact.id, name: contact.name, archived: contact.archived } : null;
  };
  const byId = (taskId: string) => tasks.find((t) => t.id === taskId);
  const blocked = (task: TaskRecord) =>
    isTaskBlocked(
      task.dependsOn.flatMap((dependencyId) => {
        const dependency = byId(dependencyId);
        return dependency ? [{ status: dependency.status, archived: dependency.archived }] : [];
      }),
    );
  const overdue = (task: TaskRecord) => isTaskOverdue(task, TASKS_NOW);
  const clientCount = (task: TaskRecord) =>
    task.revisions.filter((r) => r.source === 'client').length;

  // Mirrors the API's scopes (spec F06, "Scopes on tasks").
  const rights = (task: TaskRecord): TaskRights => {
    const inDepartment = managed().includes(task.department);
    const ownClient = clientOf(task)?.accountManagerId === me().user.id;
    const projectManager = projectOf(task)?.projectManagerId === me().user.id;
    const assign =
      holds('tasks.manage', 'all') ||
      (holds('tasks.manage', 'department') && inDepartment) ||
      (holds('tasks.manage', 'own_clients') && ownClient);
    return {
      work:
        holds('tasks.work', 'all') ||
        (holds('tasks.work', 'department') && inDepartment) ||
        (holds('tasks.work', 'assigned') && task.assigneeId === me().user.id),
      manage: assign || (holds('tasks.manage', 'assigned') && projectManager),
      assign,
      client:
        !!task.clientId &&
        (holds('tasks.manage', 'all') || (holds('tasks.manage', 'own_clients') && ownClient)),
      creator: holds('tasks.request', 'all') && task.createdById === me().user.id,
    };
  };
  const allowed = (task: TaskRecord) =>
    task.archived
      ? []
      : allowedTaskTransitions(
          {
            status: task.status,
            assigneeId: task.assigneeId,
            hasClient: !!task.clientId,
            needsClientApproval: task.needsClientApproval,
            blocked: blocked(task),
          },
          rights(task),
        );
  const permissions = (task: TaskRecord): TaskDetail['permissions'] => {
    const r = rights(task);
    const live = !task.archived;
    const request = r.creator && task.status === 'new' && task.assigneeId === null;
    return {
      canEdit: live && (r.manage || request),
      canAssign: live && r.assign,
      canWork: live && r.work,
      canReview: live && r.manage,
      canRecordClientResponse: live && r.client,
      canDecideRevision: live && r.client,
      canCancel: allowed(task).includes('cancelled'),
      canReopen: live && r.manage,
      canArchive: holds('tasks.manage', 'all'),
    };
  };

  const summary = (task: TaskRecord): Task => {
    const assignee = task.assigneeId ? user(task.assigneeId) : undefined;
    const project = projectOf(task);
    const retainer = retainerOf(task);
    const cycle = cycleOf(task);
    const line = cycle?.lines.find((l) => l.id === task.cycleLineId);
    const milestoneRecord = project?.milestones.find((m) => m.id === task.milestoneId);
    const items = task.checklist.filter((item) => !item.archived);
    return {
      id: task.id,
      title: task.title,
      type: task.type,
      department: task.department,
      assignee: assignee
        ? {
            id: assignee.id,
            name: assignee.name,
            archived: assignee.status === 'archived',
            inDepartment: assignee.departments.some((d) => d.code === task.department),
          }
        : null,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      overdue: overdue(task),
      blocked: blocked(task),
      client: clientOf(task)
        ? { id: task.clientId as string, name: clientOf(task)?.tradeName ?? '' }
        : null,
      project: project ? { id: project.id, name: project.name } : null,
      milestone: milestoneRecord ? { id: milestoneRecord.id, name: milestoneRecord.name } : null,
      retainer: retainer ? { id: retainer.id, name: retainer.name } : null,
      cycle: cycle
        ? { id: cycle.id, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd }
        : null,
      cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
      checklist: { done: items.filter((item) => item.doneAt).length, total: items.length },
      revisions: { clientCount: clientCount(task), limit: task.revisionLimit },
      overLimitPending: task.revisions.some((r) => r.overLimit && r.decision === null),
    };
  };
  const dependencyOf = (task: TaskRecord) => ({
    id: task.id,
    title: task.title,
    department: task.department,
    status: task.status,
    finished: isTaskFinished(task.status),
    archived: task.archived,
  });
  const detail = (task: TaskRecord): TaskDetail => ({
    ...summary(task),
    brief: task.brief,
    needsClientApproval: task.needsClientApproval,
    clientRequest: task.request
      ? {
          contact: contactOf(task, task.request.contactId),
          requestedOn: task.request.requestedOn,
          scope: task.request.scope,
          extraWork: task.request.extraWork
            ? { ...task.request.extraWork, billingStatus: 'unbilled' }
            : null,
        }
      : null,
    dependencies: task.dependsOn.flatMap((dependencyId) => {
      const dependency = byId(dependencyId);
      return dependency ? [dependencyOf(dependency)] : [];
    }),
    dependents: tasks.filter((t) => t.dependsOn.includes(task.id)).map(dependencyOf),
    checklistItems: task.checklist
      .filter((item) => !item.archived)
      .map((item, index) => ({
        id: item.id,
        text: item.text,
        position: index + 1,
        done: !!item.doneAt,
        doneAt: item.doneAt,
        doneBy: item.doneById ? person(item.doneById) : null,
      })),
    links: task.links
      .filter((link) => !link.archived)
      .map((link) => ({
        id: link.id,
        url: link.url,
        label: link.label,
        addedBy: person(link.addedById),
        createdAt: task.createdAt,
      })),
    revisionHistory: task.revisions.map((r) => ({
      id: r.id,
      source: r.source,
      number: r.number,
      note: r.note,
      contact: contactOf(task, r.contactId),
      overLimit: r.overLimit,
      decision: r.decision,
      decisionNote: r.decisionNote,
      extraWork: r.extraWork,
      decidedBy: r.decidedById ? person(r.decidedById) : null,
      decidedAt: r.decidedAt,
      author: person(r.authorId),
      createdAt: r.createdAt,
    })),
    createdBy: person(task.createdById),
    createdAt: task.createdAt,
    updatedAt: task.createdAt,
    startedAt: task.startedAt,
    deliveredAt: task.deliveredAt,
    cancelledAt: task.cancelledAt,
    cancelReason: task.cancelReason,
    archivedAt: task.archived ? '2026-10-08T10:00:00.000Z' : null,
    readOnly: task.archived,
    permissions: permissions(task),
    allowedTransitions: allowed(task),
  });
  const commentOf = (task: TaskRecord, comment: TaskCommentRecord): TaskComment => {
    const author = user(comment.authorId);
    const mine = comment.authorId === me().user.id && !task.archived;
    return {
      id: comment.id,
      author: { ...person(comment.authorId), archived: author?.status === 'archived' },
      body: comment.archived ? null : comment.body,
      mentions: mentionedUserIds(comment.body).map((userId) => ({
        ...person(userId),
        archived: user(userId)?.status === 'archived',
      })),
      editedAt: comment.editedAt,
      removed: comment.archived,
      createdAt: comment.createdAt,
      canEdit: mine && !comment.archived,
      canRemove: (mine || holds('tasks.manage', 'all')) && !comment.archived,
    };
  };
  /** Logs an extra work item on the task's project or retainer (rules 10 and 11). */
  const logExtraWork = (task: TaskRecord, title: string, contactId: string | null) => {
    const owner = projectOf(task) ?? retainerOf(task);
    if (!owner) return null;
    const item: ExtraWorkRecord = {
      id: id(next++),
      title,
      description: null,
      requestedOn: PROJECTS_TODAY,
      contactId,
      estimateMinor: null,
      billingStatus: 'unbilled',
      billingNote: null,
      loggedById: me().user.id,
      createdAt: TASKS_NOW.toISOString(),
      archived: false,
    };
    owner.extraWork.push(item);
    return { id: item.id, title };
  };
  let next = 1500;

  const matches = (task: TaskRecord, q: URLSearchParams) => {
    const statuses = q.getAll('status');
    const flag = (name: string) => q.get(name);
    const meId = me().user.id;
    const assigneeId = q.get('assigneeId') === 'me' ? meId : q.get('assigneeId');
    const departments = q.getAll('department');
    const priorities = q.getAll('priority');
    const r = rights(task);
    return (
      task.archived === (flag('archived') === 'true') &&
      (statuses.length > 0 ? statuses : OPEN_TASK).includes(task.status) &&
      (!q.get('search') || task.title.includes(q.get('search') as string)) &&
      (departments.length === 0 || departments.includes(task.department)) &&
      (!assigneeId || task.assigneeId === assigneeId) &&
      (flag('unassigned') !== 'true' || task.assigneeId === null) &&
      (!q.get('clientId') || task.clientId === q.get('clientId')) &&
      (flag('internal') !== 'true' || task.clientId === null) &&
      (!q.get('projectId') || task.projectId === q.get('projectId')) &&
      (!q.get('retainerId') || task.retainerId === q.get('retainerId')) &&
      (!q.get('type') || task.type === q.get('type')) &&
      (priorities.length === 0 || priorities.includes(task.priority)) &&
      (!flag('overdue') || overdue(task) === (flag('overdue') === 'true')) &&
      (!flag('blocked') || blocked(task) === (flag('blocked') === 'true')) &&
      (flag('overLimit') !== 'true' || summary(task).overLimitPending) &&
      (!q.get('dueFrom') || task.dueDate >= (q.get('dueFrom') as string)) &&
      (!q.get('dueTo') || task.dueDate <= (q.get('dueTo') as string)) &&
      (q.get('createdBy') !== 'me' || task.createdById === meId) &&
      (q.get('reviewer') !== 'me' || (r.manage && task.status === 'internal_review'))
    );
  };
  // Like the database enum: low first.
  const PRIORITY_ORDER: readonly TaskPriority[] = TASK_PRIORITIES;

  // Answers a tasks request, or returns undefined to let the other mocks try.
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const body = <T>() => request.postDataJSON() as T;

    if (path === '/api/me/tasks/summary') {
      const meId = me().user.id;
      const open = tasks.filter((t) => !t.archived && OPEN_TASK.includes(t.status));
      const mine = open.filter((t) => t.assigneeId === meId);
      const weekEnd = weekOf(PROJECTS_TODAY).to;
      const count = (list: TaskRecord[], test: (t: TaskRecord) => boolean) =>
        list.filter(test).length;
      const summaryBody: MyTaskSummary = {
        overdue: count(mine, overdue),
        today: count(mine, (t) => t.dueDate === PROJECTS_TODAY && !overdue(t)),
        thisWeek: count(mine, (t) => t.dueDate > PROJECTS_TODAY && t.dueDate <= weekEnd),
        later: count(mine, (t) => t.dueDate > weekEnd),
        waiting: count(mine, (t) => blocked(t) || t.status === 'awaiting_client'),
        toReview: count(open, (t) => t.status === 'internal_review' && rights(t).manage),
        requestedByMe: count(open, (t) => t.createdById === meId && t.assigneeId !== meId),
        unassignedInMyDepartments:
          managed().length === 0
            ? null
            : count(open, (t) => t.assigneeId === null && managed().includes(t.department)),
      };
      return json(route, summaryBody);
    }
    if (path === '/api/tasks' && method === 'GET') {
      const q = url.searchParams;
      const sort = q.get('sort') ?? 'dueDate';
      const order = q.get('order') === 'desc' ? -1 : 1;
      const items = tasks
        .filter((t) => matches(t, q))
        .sort((a, b) =>
          sort === 'priority'
            ? order * (PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority))
            : order * a.dueDate.localeCompare(b.dueDate),
        )
        .map(summary);
      const pageSize = Number(q.get('pageSize') ?? 50);
      const page = Number(q.get('page') ?? 1);
      return json(route, {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      });
    }
    if (path === '/api/tasks' && method === 'POST') {
      const input = body<CreateTaskInput>();
      const created = taskRecord(next++, {
        title: input.title,
        brief: input.brief ?? null,
        type: input.type ?? 'work',
        department: input.department,
        assigneeId: input.assigneeId ?? null,
        priority: input.priority ?? 'normal',
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        clientId: input.clientId ?? null,
        projectId: input.projectId ?? null,
        milestoneId: input.milestoneId ?? null,
        retainerId: input.retainerCycleId
          ? (retainers.find((r) => r.cycles.some((c) => c.id === input.retainerCycleId))?.id ??
            null)
          : null,
        cycleId: input.retainerCycleId ?? null,
        cycleLineId: input.cycleLineId ?? null,
        needsClientApproval: input.clientId ? (input.needsClientApproval ?? true) : false,
        revisionLimit: input.revisionLimit ?? 2,
        createdById: me().user.id,
        createdAt: TASKS_NOW.toISOString(),
        dependsOn: input.dependsOn ?? [],
      });
      const r = rights(created);
      const self = created.assigneeId === me().user.id;
      if (created.assigneeId && !self && !r.assign) return fail(route, 403, 'FORBIDDEN');
      if (input.type === 'client_request') {
        if (!r.client) return fail(route, 403, 'FORBIDDEN');
        const scope = input.requestScope ?? 'in_scope';
        created.request = {
          contactId: input.requestedByContactId ?? null,
          requestedOn: input.requestedOn ?? PROJECTS_TODAY,
          scope,
          extraWork:
            scope === 'out_of_scope'
              ? logExtraWork(created, created.title, input.requestedByContactId ?? null)
              : null,
        };
      }
      created.checklist = (input.checklist ?? []).map((text) => ({
        id: id(next++),
        text,
        doneAt: null,
        doneById: null,
        archived: false,
      }));
      created.links = (input.links ?? []).map((link) => ({
        id: id(next++),
        url: link.url,
        label: link.label ?? null,
        addedById: me().user.id,
        archived: false,
      }));
      tasks.push(created);
      return json(route, detail(created), 201);
    }

    const match = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!match) return undefined;
    const [, taskId, part, childId, childAction] = match;
    const task = byId(taskId as string);
    if (!task || (task.archived && !holds('tasks.manage', 'all'))) {
      return fail(route, 404, 'NOT_FOUND');
    }
    const can = permissions(task);
    const answer = () => json(route, detail(task));

    if (!part && method === 'GET') return answer();
    if (!part && method === 'PATCH') {
      if (!can.canEdit && !can.canAssign) return fail(route, 403, 'FORBIDDEN');
      const input = body<UpdateTaskInput>();
      if ((input.assigneeId !== undefined || input.department) && !can.canAssign) {
        return fail(route, 403, 'FORBIDDEN');
      }
      const { requestedByContactId, requestedOn, requestScope, retainerCycleId, ...fields } = input;
      Object.assign(task, fields);
      if (retainerCycleId !== undefined) {
        task.cycleId = retainerCycleId;
        task.retainerId =
          retainers.find((r) => r.cycles.some((c) => c.id === retainerCycleId))?.id ?? null;
      }
      if (task.request) {
        if (requestedByContactId !== undefined) task.request.contactId = requestedByContactId;
        if (requestedOn) task.request.requestedOn = requestedOn;
        if (requestScope) task.request.scope = requestScope;
      }
      if (input.department && task.assigneeId) {
        const assignee = user(task.assigneeId);
        if (!assignee?.departments.some((d) => d.code === input.department)) task.assigneeId = null;
      }
      return answer();
    }
    if (part === 'status') {
      const change = body<TaskStatusChange>();
      if (!allowed(task).includes(change.status)) {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      const move = taskMove(task.status, change.status);
      if (move === 'start' && blocked(task) && !change.overrideDependencies) {
        return fail(route, 409, 'TASK_BLOCKED');
      }
      const source = move ? revisionSourceOf(move) : null;
      if (source) {
        const number = source === 'client' ? clientCount(task) + 1 : null;
        task.revisions.push({
          id: id(next++),
          source,
          number,
          note: change.note ?? '',
          contactId: change.contactId ?? null,
          overLimit: number !== null && number > task.revisionLimit,
          decision: null,
          decisionNote: null,
          extraWork: null,
          decidedById: null,
          decidedAt: null,
          authorId: me().user.id,
          createdAt: TASKS_NOW.toISOString(),
        });
      }
      if (move === 'start' && !task.startedAt) task.startedAt = TASKS_NOW.toISOString();
      if (move === 'deliver') task.deliveredAt = TASKS_NOW.toISOString();
      if (move === 'cancel') {
        task.cancelledAt = TASKS_NOW.toISOString();
        task.cancelReason = change.note ?? null;
      }
      if (move === 'reopen' || move === 'reopen_client' || move === 'reopen_internal') {
        task.deliveredAt = null;
        task.cancelledAt = null;
        task.cancelReason = null;
      }
      task.status = change.status;
      return answer();
    }
    if (part === 'dependencies' && method === 'PUT') {
      if (!can.canReview) return fail(route, 403, 'FORBIDDEN');
      task.dependsOn = body<TaskDependenciesInput>().dependsOn;
      return json(route, { items: detail(task).dependencies });
    }
    if (part === 'archive' || part === 'restore') {
      if (!can.canArchive) return fail(route, 403, 'FORBIDDEN');
      task.archived = part === 'archive';
      return answer();
    }
    if (part === 'revisions' && childAction === 'decision') {
      const revision = task.revisions.find((r) => r.id === childId);
      if (!revision) return fail(route, 404, 'NOT_FOUND');
      if (!can.canDecideRevision) return fail(route, 403, 'FORBIDDEN');
      const input = body<RevisionDecisionInput>();
      if (input.decision === 'extra_work') {
        const logged = logExtraWork(
          task,
          `التعديل ${revision.number}: ${task.title}`,
          revision.contactId,
        );
        if (!logged) return fail(route, 409, 'NO_ENGAGEMENT');
        revision.extraWork = logged;
      }
      Object.assign(revision, {
        decision: input.decision,
        decisionNote: input.note ?? null,
        decidedById: me().user.id,
        decidedAt: TASKS_NOW.toISOString(),
      });
      return json(
        route,
        detail(task).revisionHistory.find((r) => r.id === revision.id),
      );
    }
    if (part === 'checklist') {
      if (!can.canWork && !can.canReview) return fail(route, 403, 'FORBIDDEN');
      if (!childId && method === 'POST') {
        const created = {
          id: id(next++),
          text: body<{ text: string }>().text,
          doneAt: null,
          doneById: null,
          archived: false,
        };
        task.checklist.push(created);
        return json(route, detail(task).checklistItems.at(-1), 201);
      }
      if (childId === 'order') {
        const ids = body<{ ids: string[] }>().ids;
        task.checklist.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        return json(route, { items: detail(task).checklistItems });
      }
      const item = task.checklist.find((x) => x.id === childId);
      if (!item) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      const input = body<{ text?: string; done?: boolean }>();
      if (input.text) item.text = input.text;
      if (input.done !== undefined) {
        item.doneAt = input.done ? TASKS_NOW.toISOString() : null;
        item.doneById = input.done ? me().user.id : null;
      }
      return json(
        route,
        detail(task).checklistItems.find((x) => x.id === item.id),
      );
    }
    if (part === 'links') {
      if (!can.canWork && !can.canReview) return fail(route, 403, 'FORBIDDEN');
      if (!childId) {
        const input = body<{ url: string; label?: string | null }>();
        task.links.push({
          id: id(next++),
          url: input.url,
          label: input.label || null,
          addedById: me().user.id,
          archived: false,
        });
        return json(route, detail(task).links.at(-1), 201);
      }
      const link = task.links.find((x) => x.id === childId);
      if (!link) return fail(route, 404, 'NOT_FOUND');
      link.archived = true;
      return route.fulfill({ status: 204 });
    }
    if (part === 'comments') {
      if (!childId && method === 'GET') {
        const items = task.comments.map((comment) => commentOf(task, comment));
        return json(route, { items, total: items.length, page: 1, pageSize: 100 });
      }
      if (!childId) {
        const created: TaskCommentRecord = {
          id: id(next++),
          authorId: me().user.id,
          body: body<{ body: string }>().body,
          editedAt: null,
          archived: false,
          createdAt: TASKS_NOW.toISOString(),
        };
        task.comments.push(created);
        return json(route, commentOf(task, created), 201);
      }
      const comment = task.comments.find((x) => x.id === childId);
      if (!comment) return fail(route, 404, 'NOT_FOUND');
      if (childAction === 'archive') {
        comment.archived = true;
        return route.fulfill({ status: 204 });
      }
      comment.body = body<{ body: string }>().body;
      comment.editedAt = TASKS_NOW.toISOString();
      return json(route, commentOf(task, comment));
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
  autumnMenu: id(1001),
  dishShoot: id(1002),
  openingPosts: id(1003),
};

/** Viewport screenshot kept in the test output and attached to the HTML report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
