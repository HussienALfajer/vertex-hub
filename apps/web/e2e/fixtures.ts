import type { Page, Route, TestInfo } from '@playwright/test';
import {
  type AcceptPlan,
  AD_CAMPAIGN_STATUSES,
  type AdCampaignStatus,
  type AdFunding,
  type AdObjective,
  type AdPlatform,
  type AdWallet,
  type AdWalletEntryKind,
  APPROVAL_LIMITS,
  type ApprovalItem,
  type ApprovalItemStatus,
  type ApprovalReady,
  type ApprovalRequest,
  type ApprovalRequestDetail,
  type ApprovalWithdrawnReason,
  type AuditEntry,
  acceptQuoteSchema,
  acceptsUpdates,
  adDepositDisplayNumber,
  addDays,
  addMonths,
  adWalletBalance,
  agingBucket,
  allowedPostTransitions,
  allowedTaskTransitions,
  applyPayment,
  approvalRequestState,
  type BillableItems,
  BOARD_LIMITS,
  BOARD_STATUSES,
  type BrandFileKind,
  type BrandKit,
  budgetUsed,
  businessDate,
  CAMPAIGN_LIMITS,
  type Calendar,
  type Campaign,
  type CampaignDetail,
  type CampaignStatusChange,
  type CampaignUpdateInput,
  type CancelMeeting,
  type CancelShoot,
  type CatalogBilling,
  type CatalogPackage,
  type CatalogService,
  type ClientApprovals,
  type ClientBilling,
  type ClientDetailResponse,
  type ClientEmail,
  type ClientEmailKind,
  type ClientMonthlyReport,
  type ClientResponse,
  type ClientResponseEntry,
  type ClientStatement,
  type ClientStatus,
  type CloseShoot,
  type CompanyDashboard,
  type Contact,
  type ContentCalendar,
  type ConvertLead,
  type CreateApprovalRequest,
  type CreateCampaign,
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type CreateExtraWork,
  type CreateMeeting,
  type CreateMilestone,
  type CreatePost,
  type CreatePostTask,
  type CreateProject,
  type CreateRetainer,
  type CreateRetainerTerm,
  type CreateShoot,
  type CreateTaskInput,
  type CreateTemplate,
  type CrewRole,
  CURRENCIES,
  type Currency,
  type Cycle,
  type CycleDetail,
  type CycleStatus,
  calendarDay,
  canChangeCampaignStatus,
  changeInvoiceDueDateSchema,
  conversionRate,
  convertLeadSchema,
  costPerResult,
  createCatalogPackageSchema,
  createCatalogServiceSchema,
  createInvoiceSchema,
  createLeadNoteSchema,
  createLeadSchema,
  createProjectExpenseSchema,
  createQuoteSchema,
  createTemplateSchema,
  DASHBOARD_LIMITS,
  DEPARTMENT_CODES,
  type DeliverableKind,
  type DepartmentCode,
  type DepartmentDashboard,
  type DepartmentDetailResponse,
  type DepartmentResponse,
  type DuplicatePost,
  daysInStage,
  daysOverdue,
  daysWithoutUpdate,
  defaultInstallmentMilestones,
  type EmailLogItem,
  type EmailRecordType,
  type EmailSummary,
  type ErrorCode,
  type ExtraWork,
  type ExtraWorkBilling,
  type ExtraWorkBillingChange,
  extendQuoteSchema,
  type FileItem,
  type FileOwnerType,
  type FileRole,
  type FileUpload,
  type FileVersion,
  type FinanceDashboard,
  fileTypeOf,
  firstOfMonth,
  followUpDateInRange,
  followUpFilterRange,
  grantedPermissions,
  type HealthResponse,
  type Invoice,
  type InvoiceDetail,
  type InvoiceOrigin,
  type InvoicePage,
  type InvoiceSettings,
  type InvoiceSource,
  type InvoiceStatus,
  type IssuedApprovalRequest,
  installmentsValid,
  intervalsOverlap,
  invoiceDisplayNumber,
  invoiceDraftSchema,
  invoiceStatus,
  invoiceTotal,
  isFutureMonth,
  isInlineMimeType,
  isLineBehind,
  isLowBalance,
  isOpenLeadStage,
  isPostContentEditable,
  isPostOverdue,
  isPreliminaryMonth,
  isProjectClosed,
  issueInvoiceSchema,
  isTaskBlocked,
  isTaskFinished,
  isTaskOpen,
  isTaskOverdue,
  type KeyDate,
  LEAD_LIMITS,
  type LEAD_SORTS,
  LEAD_STAGES,
  type Lead,
  type LeadBoard,
  type LeadConversionPlan,
  type LeadDetail,
  type LeadFollowUpFilter,
  type LeadLossReason,
  type LeadQuotes,
  type LeadSource,
  type LeadStage,
  type LinkableTask,
  lastOfMonth,
  leadDisplayName,
  leadDuplicateQuerySchema,
  leadHasContactMethod,
  leadOwnerChangeSchema,
  leadSourceDetailMissing,
  leadStageChangeSchema,
  loseLeadSchema,
  lossRejectionReason,
  MANUAL_LEAD_STAGES,
  type MedicalReview,
  type Meeting,
  type MeetingDetail,
  type MeResponse,
  type Milestone,
  type MilestoneStatus,
  type MyClientsDashboard,
  type MyContentSummary,
  type MyTaskSummary,
  manualLeadMoveRefusal,
  mentionedUserIds,
  mergeDeliverableLines,
  monthPeriod,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  type Note,
  type NoteChannel,
  type Notification,
  type NotificationSettings,
  type NotificationType,
  needsDiscountApproval,
  OPEN_AD_CAMPAIGN_STATUSES,
  OPEN_INVOICE_STATUSES,
  OPEN_LEAD_STAGES,
  OPEN_TASK_STATUSES,
  type OverdueInvoicesReport,
  onTimeRate,
  type PatchCampaignUpdate,
  type Payment,
  type Permission,
  type PlatformAccount,
  POST_LIMITS,
  POST_STATUSES,
  type Post,
  type PostClientResponse,
  type PostDetail,
  type PostMedia,
  type PostPlatform,
  type PostReview,
  type PostRights,
  type PostStatus,
  type PostStatusChange,
  type PostTask,
  type PostType,
  type PostView,
  type ProductivityMeasures,
  type ProductivityReport,
  type Project,
  type ProjectBilling,
  type ProjectDetail,
  type ProjectExpense,
  type ProjectStatus,
  type ProjectStatusChange,
  type PublicApproval,
  type PublicApprovalItem,
  type PublicApproveAll,
  type PublicResponse,
  type PublishedLink,
  packageIssues,
  periodInOneMonth,
  periodsOverlap,
  planTemplateRun,
  postMove,
  postTaskDueDate,
  postTaskTitle,
  QUOTE_LIMITS,
  type Quote,
  type QuoteDetail,
  type QuoteDraft,
  type QuoteLine,
  type QuoteSettings,
  quoteApprovalActionSchema,
  quoteApprovalDecisionSchema,
  quoteDisplayNumber,
  quoteDraftSchema,
  quoteTotals,
  type RecordWalletEntry,
  type ReopenShoot,
  type RequestScope,
  type Retainer,
  type RetainerBilling,
  type RetainerDeliverables,
  type RetainerDetail,
  type RetainerStatus,
  type RetainerStatusChange,
  type RetainerTemplate,
  type RetainerTerm,
  type RetainerTermSummary,
  type RevenueReport,
  type ReviewStage,
  type RevisionDecision,
  type RevisionDecisionInput,
  type RevisionSource,
  rateIsStale,
  deliveryRate as rateOf,
  receiptDisplayNumber,
  recordPaymentSchema,
  rejectQuoteSchema,
  renewalState,
  reopenLeadSchema,
  repeatedStepFor,
  reportMonths,
  revisionSourceOf,
  type ScheduleConflict,
  type Shoot,
  type ShootDetail,
  type ShootStatus,
  type ShootType,
  type ShotListInput,
  type SourceInvoice,
  sendQuoteSchema,
  serviceIssues,
  setRetainerTemplateSchema,
  shootTaskTitle,
  spendCountsInWallet,
  statementRows,
  TASK_PRIORITIES,
  type Task,
  type TaskBoard,
  type TaskClientResponse,
  type TaskComment,
  type TaskDependenciesInput,
  type TaskDetail,
  type TaskPriority,
  type TaskReview,
  type TaskRights,
  type TaskStatus,
  type TaskStatusChange,
  type TaskType,
  type TaskWorkload,
  TEMPLATE_KIND_BY_BILLING,
  type TemplateDetail,
  type TemplateDocument,
  type TemplateKind,
  type TemplateListItem,
  type TemplateRun,
  type TemplateRunInput,
  type TemplateRunTrigger,
  type TemplateStep,
  type TermEndAction,
  type TermStatus,
  taskMove,
  templateRunInputSchema,
  toUsdMinor,
  type UpdateCampaign,
  type UpdateCycleLine,
  type UpdateExtraWork,
  type UpdateMeeting,
  type UpdateNotificationSettings,
  type UpdatePost,
  type UpdateRetainerTerm,
  type UpdateShoot,
  type UpdateTaskInput,
  type UpdateWalletThreshold,
  type UserResponse,
  updateCatalogPackageSchema,
  updateCatalogServiceSchema,
  updateClientReportSummarySchema,
  updateInvoiceServicesSchema,
  updateInvoiceSettingsSchema,
  updateLeadNoteSchema,
  updateLeadSchema,
  updateProjectExpenseSchema,
  updateQuoteSettingsSchema,
  updateTemplateSchema,
  type VoidWalletEntry,
  voidInvoiceSchema,
  voidPaymentSchema,
  type WalletEntry,
  walletLedger,
  weekOf,
} from '@vertex-hub/contracts';
import { isDeclaredEndpoint, reportApiProblem } from './test';

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
const medical = seeded('medical_consultation');

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

/** Rana: Finance with two-factor sign-in set up; reads every client's money (F12, F13). */
export const financeMe: MeResponse = {
  ...financeWithoutTwoFactor,
  twoFactor: { enabled: true, required: true },
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

/** Basel as a plain department manager of Design, with no other role (F15 home page). */
export const departmentManagerMe: MeResponse = {
  user: { id: id(6), name: 'باسل يوسف', email: 'basel@vertex.example', image: null },
  roles: ['department_manager', 'employee'],
  departments: [{ ...design, isPrimary: true, isManager: true }],
  permissions: grantedPermissions({
    roles: ['department_manager', 'employee'],
    departments: [{ code: 'design', isManager: true }],
  }),
  twoFactor: { enabled: false, required: false },
};

/** Layan as a plain account manager, managing no department (F15 home page). */
export const plainAccountManagerMe: MeResponse = {
  ...accountManagerMe,
  roles: ['account_manager', 'employee'],
  departments: [{ ...design, isPrimary: true, isManager: false }],
  permissions: grantedPermissions({
    roles: ['account_manager', 'employee'],
    departments: [{ code: 'design', isManager: false }],
  }),
};

/** Omar: the Internal Operations manager, who reads leads and quotes them (F03, F04). */
export const operationsManagerMe: MeResponse = {
  user: { id: id(2), name: 'عمر حداد', email: 'omar@vertex.example', image: null },
  roles: ['department_manager', 'employee'],
  departments: [{ ...operations, isPrimary: true, isManager: true }],
  permissions: grantedPermissions({
    roles: ['department_manager', 'employee'],
    departments: [{ code: 'internal_operations', isManager: true }],
  }),
  twoFactor: { enabled: true, required: true },
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

/** Dr. Hiba: a member of Medical Consultation, who reviews healthcare clients' content (F09). */
export const medicalReviewerMe: MeResponse = {
  user: { id: id(8), name: 'د. هبة النجار', email: 'hiba@vertex.example', image: null },
  roles: ['employee'],
  departments: [{ ...medical, isPrimary: true, isManager: false }],
  permissions: grantedPermissions({
    roles: ['employee'],
    departments: [{ code: 'medical_consultation', isManager: false }],
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
    member(8, 'د. هبة النجار', 'hiba@vertex.example', [{ d: medical, primary: true }], {
      title: 'استشارية طبية',
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
  {
    id: id(511),
    occurredAt: '2026-09-25T11:00:00.000Z',
    actorId: id(3),
    actorName: 'ليان الأحمد',
    action: 'file_version.created',
    entityType: 'file_item',
    entityId: id(1301),
    before: null,
    after: {
      ownerType: 'task',
      ownerId: id(1001),
      clientId: id(601),
      role: 'deliverable',
      number: 2,
      kind: 'upload',
      sizeBytes: 2_726_297,
      note: 'ألوان الهوية الجديدة وصورة الطبق الموسمي.',
    },
  },
  {
    id: id(512),
    occurredAt: '2026-09-25T11:10:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'file_item.created',
    entityType: 'file_item',
    entityId: id(1310),
    before: null,
    after: {
      ownerType: 'client',
      ownerId: id(601),
      clientId: id(601),
      role: 'brand',
      name: 'شعار الياسمين',
      brandKind: 'logo',
      number: 1,
      kind: 'upload',
      sizeBytes: 298_000,
    },
  },
  {
    id: id(513),
    occurredAt: '2026-09-24T10:00:00.000Z',
    actorId: id(8),
    actorName: 'د. هبة النجار',
    action: 'task.reviewed',
    entityType: 'task',
    entityId: id(1008),
    before: null,
    after: {
      stage: 'medical',
      outcome: 'passed',
      versions: [{ name: 'منشور التوعية', number: 1 }],
      hasText: true,
    },
  },
  {
    id: id(514),
    occurredAt: '2026-09-24T09:00:00.000Z',
    actorId: null,
    actorName: 'د. رامي حسن',
    action: 'task.client_response_recorded',
    entityType: 'task',
    entityId: id(1008),
    before: null,
    after: {
      decision: 'changes_requested',
      channel: 'link',
      via: 'approval_link',
      note: 'غيّروا صورة الغلاف.',
      versions: [{ name: 'منشور التوعية', number: 1 }],
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
  billingName?: string | null;
  billingAddress?: string | null;
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
  /** Notifications for the signed-in user that arrive over the stream once the page opens. */
  streamed?: Notification[];
  /** Replaces the seeded notifications (`[]` for an empty bell). */
  notifications?: NotificationRecord[];
  /** Adds work with the client and its approval requests (`approvalsSeed`, F09). */
  approvals?: boolean;
  /** Adds the content plan: posts, their linked tasks and files (`contentSeed`, F08). */
  content?: boolean;
  /** Adds October's shoots and meetings with their Photography tasks (`calendarSeed`, F11). */
  calendar?: boolean;
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
/**
 * An error as the API answers it: a coded one (`ErrorCode`), or with `null` a plain 401, 403 or
 * 404, which carries no code.
 */
const fail = (route: Route, status: number, code: ErrorCode | null, details?: unknown) =>
  route.fulfill({
    status,
    json: { statusCode: status, ...(code && { code }), message: code ?? 'Error', details },
  });

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
  const sent = options.approvals ? approvalsSeed() : { tasks: [], files: [], requests: [] };
  const planned = options.content
    ? contentSeed()
    : { posts: [], tasks: [], files: [], requests: [] };
  const booked = options.calendar ? calendarSeed() : { shoots: [], meetings: [], tasks: [] };
  const tasks = [...tasksSeed(), ...sent.tasks, ...planned.tasks, ...booked.tasks];
  const billing = invoicesSeed();
  const calendarApi = calendarRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    shoots: booked.shoots,
    meetings: booked.meetings,
    invoices: billing.invoices,
    me: () => me,
  });
  const outbox = emailsSeed();
  const tasksApi = taskRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    posts: planned.posts,
    files: [...sent.files, ...planned.files],
    requests: [...sent.requests, ...planned.requests],
    outbox,
    me: () => me,
  });
  const reportsApi = reportRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    tasksApi,
    me: () => me,
  });
  const templates = templatesSeed();
  const templatesApi = templateRoutes({ users, clients, retainers, templates, me: () => me });
  const catalog = catalogSeed();
  const catalogApi = catalogRoutes({ catalog, templates, me: () => me });
  const quoting = quotesSeed();
  const leadState = {
    leads: leadsSeed(),
    quotes: quoting.quotes,
    clients,
    users,
    catalog,
    me: () => me,
  };
  const rulesOfLeads = leadRules(leadState);
  const leadsApi = leadRoutes({ ...leadState, rules: rulesOfLeads });
  const quotesApi = quoteRoutes({
    quoting,
    leads: leadState.leads,
    leadRules: rulesOfLeads,
    catalog,
    clients,
    users,
    projects,
    retainers,
    templates,
    me: () => me,
  });
  const invoicesApi = invoiceRoutes({
    billing,
    clients,
    users,
    projects,
    retainers,
    catalog,
    me: () => me,
  });
  const campaignsApi = campaignRoutes({
    records: campaignsSeed(),
    clients,
    users,
    projects,
    retainers,
    tasks,
    me: () => me,
  });
  const emailsApi = emailRoutes({ outbox, clients, users, me: () => me });
  const notificationsApi = notificationRoutes({
    notifications: options.notifications ?? notificationsSeed(),
    streamed: options.streamed ?? [],
    me: () => me,
  });
  const templateRunsApi = templateRunRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    templates,
    me: () => me,
  });
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
    // The mock answers only what the real API declares (openapi.json): drift fails the test.
    if (!isDeclaredEndpoint(method, path)) {
      reportApiProblem(page, `Not in the API: ${method} ${path}`);
    }

    if (path === '/api/health') return json(route, healthy);
    if (path === '/api/me' && method === 'GET') {
      return signedIn ? json(route, me) : fail(route, 401, null);
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
    // F14 email rule 13: the same answer whatever the address.
    if (path === '/api/password-links/request') return route.fulfill({ status: 204 });
    // The client page (F09): the link's token is the access, with no session.
    if (path.startsWith('/api/public/')) {
      const shown = tasksApi(route, method, url, request);
      if (shown) return shown;
    }
    if (!signedIn) return fail(route, 401, null);

    // Users.
    if (path === '/api/users' && method === 'GET') {
      const status = url.searchParams.get('status') ?? 'active';
      const search = url.searchParams.get('search')?.toLowerCase();
      const departmentId = url.searchParams.get('departmentId');
      const role = url.searchParams.get('role');
      // Like the API: status and assigned-role filters are for user managers only.
      const userManager = me.permissions.some((g) => g.permission === 'users.manage');
      if ((status !== 'active' || (role && role !== 'department_manager')) && !userManager) {
        return fail(route, 403, null);
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
      if (!user) return fail(route, 404, null);
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
      if (!department) return fail(route, 404, null);
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

    // Emails (F14 email), ahead of the documents' own routes.
    const emailed = emailsApi(route, method, url);
    if (emailed) return emailed;

    // Dashboards and reports (F15), ahead of the client routes that answer the rest of a client.
    const reported = reportsApi(route, method, url, request);
    if (reported) return reported;

    // A client's approval history (F09) belongs to the approvals mock, with the tasks.
    if (/^\/api\/clients\/[^/]+\/approvals$/.test(path)) {
      const listed = tasksApi(route, method, url, request);
      if (listed) return listed;
    }

    // A client's ad wallet (F12) belongs to the campaigns mock.
    if (/^\/api\/clients\/[^/]+\/ad-wallet/.test(path)) {
      const funded = campaignsApi(route, method, url, request);
      if (funded) return funded;
    }

    // Billing summaries, statements and expenses (F13) belong to the invoices mock.
    if (
      /^\/api\/(clients|projects|retainers)\/[^/]+\/(billing|statement|statement\/pdf|expenses)$/.test(
        path,
      ) ||
      path.startsWith('/api/project-expenses/')
    ) {
      const billed = invoicesApi(route, method, url, request);
      if (billed) return billed;
    }

    // Clients (F02).
    const handled = clientsApi(route, method, url, request);
    if (handled) return handled;

    // Template runs (F07), ahead of the retainer routes that answer the rest of `/api/retainers`.
    const generated = templateRunsApi(route, method, url, request);
    if (generated) return generated;

    // Projects (F05).
    const answered = projectsApi(route, method, url, request);
    if (answered) return answered;
    const retained = retainersApi(route, method, url, request);
    if (retained) return retained;

    // Tasks (F06).
    const tasked = tasksApi(route, method, url, request);
    if (tasked) return tasked;

    // Calendar and shoots (F11).
    const scheduled = calendarApi(route, method, url, request);
    if (scheduled) return scheduled;

    // Work templates (F07).
    const templated = templatesApi(route, method, url, request);
    if (templated) return templated;

    // Service catalog (F04).
    const cataloged = catalogApi(route, method, url, request);
    if (cataloged) return cataloged;

    // Leads (F03), with a lead's quotes.
    const led = leadsApi(route, method, url, request);
    if (led) return led;

    // Quotes (F04).
    const quoted = quotesApi(route, method, url, request);
    if (quoted) return quoted;

    // Invoices (F13).
    const invoiced = invoicesApi(route, method, url, request);
    if (invoiced) return invoiced;

    // Ad campaigns and wallets (F12).
    const campaigned = campaignsApi(route, method, url, request);
    if (campaigned) return campaigned;

    // Notifications (F14).
    const notified = notificationsApi(route, method, url);
    if (notified) return notified;

    if (path === '/api/audit') {
      return json(route, { items: auditSeed, total: auditSeed.length, page: 1, pageSize: 30 });
    }
    reportApiProblem(page, `No mock for ${method} ${path}`);
    return fail(route, 404, null);
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
    billingName: c.billingName ?? null,
    billingAddress: c.billingAddress ?? null,
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
      return fail(route, 404, null);
    }

    if (!part) {
      if (method === 'GET') return json(route, detail(client));
      if (!canManage(client)) return fail(route, 403, null);
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
      if (!canManage(client)) return fail(route, 403, null);
      if (!childId) {
        const created = { id: id(next++), clientId: client.id, archived: false, ...body() };
        list.push(created);
        return json(route, strip(created), 201);
      }
      const item = list.find((x) => x.id === childId);
      if (!item) return fail(route, 404, null);
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
      if (!item) return fail(route, 404, null);
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
  const noTasks = { total: 0, delivered: 0, open: 0, ready: 0 };

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
      if (!clientScope(created)) return fail(route, 403, null);
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
      return fail(route, 404, null);
    }
    const allowed = permissions(project);

    if (!part) {
      if (method === 'GET') return json(route, detail(project));
      if (!allowed.canManage) return fail(route, 403, null);
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
      if (!allowed.canManage) return fail(route, 403, null);
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
      if (!item) return fail(route, 404, null);
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
        return fail(route, 403, null);
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
      if (!item) return fail(route, 404, null);
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
  /** Copied from the standing line (F04). */
  revisionLimit: number | null;
  committed: number;
  /** Frozen when the cycle closes (R8). */
  deliveredAtClose: number | null;
  /** Tasks delivered after the cycle closed (F06; seeded here). */
  afterClose: number;
  /** Approved work not yet counted (spec P2A; seeded here). */
  ready?: number;
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
  revisionLimit: number | null;
  archived: boolean;
}

/** F05B: each cycle of a retainer with a fee holds one monthly charge, keyed off the cycle. */
const retainerChargeId = (cycleId: string) => `c${cycleId.slice(1)}`;

/** A fixed term of a retainer (F05B); its months' charges derive from `schedule`. */
interface TermRecord {
  id: string;
  number: number;
  status: TermStatus;
  startMonth: string;
  months: number;
  endAction: TermEndAction;
  /** One amount per month (minor units of the retainer's currency). */
  schedule: number[];
  renewedFromId: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** The charge of a term's month, at its position (0-based). */
const termChargeId = (termId: string, index: number) =>
  `d${termId.slice(1, -2)}${index.toString().padStart(2, '0')}`;

const termEndMonthOf = (term: TermRecord) => addMonths(term.startMonth, term.months - 1);

/** The term's months as their charges: due from the month's first day (F05B C3). */
function termChargesOf(r: RetainerRecord, today: string) {
  return (r.terms ?? []).flatMap((term) =>
    term.schedule.map((amountMinor, index) => {
      const month = addMonths(term.startMonth, index);
      return {
        id: termChargeId(term.id, index),
        month,
        kind: 'monthly' as const,
        amountMinor,
        // Early end and cancelled terms cancel months not begun (E1, T5).
        status:
          term.status === 'cancelled' && month > firstOfMonth(today)
            ? ('cancelled' as const)
            : ('pending' as const),
        term: { number: term.number, position: index + 1, months: term.months },
        due: month <= firstOfMonth(today),
      };
    }),
  );
}

/** Months a term covers that are not cancelled: open-ended charges skip them (C2). */
function termCovers(r: RetainerRecord, month: string) {
  return (r.terms ?? []).some(
    (term) =>
      term.status !== 'cancelled' && term.startMonth <= month && termEndMonthOf(term) >= month,
  );
}

function termSummaryOf(term: TermRecord): RetainerTermSummary {
  return {
    id: term.id,
    number: term.number,
    status: term.status,
    startMonth: term.startMonth,
    endMonth: termEndMonthOf(term),
    months: term.months,
    endAction: term.endAction,
  };
}

/** A term as `GET /api/retainers/:id/terms` returns it; amounts only with money access (G3). */
function termOf(r: RetainerRecord, term: TermRecord, money: boolean, today: string): RetainerTerm {
  const charges = termChargesOf(r, today).filter((c) => c.term.number === term.number);
  const schedule = charges.map((c) => ({
    month: c.month,
    position: c.term.position,
    chargeId: c.id,
    status: c.status,
    due: c.due,
    ...(money && {
      money: {
        amountMinor: c.amountMinor,
        baseAmountMinor: c.amountMinor,
        totalMinor: c.status === 'cancelled' ? 0 : c.amountMinor,
      },
    }),
  }));
  const from = (r.terms ?? []).find((t) => t.id === term.renewedFromId);
  return {
    ...termSummaryOf(term),
    renewedFrom: from ? { id: from.id, number: from.number } : null,
    cancelledAt: term.cancelledAt,
    cancelReason: term.cancelReason,
    createdAt: term.createdAt,
    ...(money && {
      money: {
        agreedTotalMinor: term.schedule.reduce((sum, amount) => sum + amount, 0),
        currentTotalMinor: schedule.reduce((sum, m) => sum + (m.money?.totalMinor ?? 0), 0),
      },
    }),
    schedule,
  };
}

/** The active term, else the scheduled one (header chip, list). */
const currentTermOf = (r: RetainerRecord) =>
  (r.terms ?? []).find((t) => t.status === 'active') ??
  (r.terms ?? []).find((t) => t.status === 'scheduled');

/** T11: with an active or scheduled term, the day after the last one. */
function syncRenewal(r: RetainerRecord) {
  const open = (r.terms ?? []).filter((t) => t.status === 'active' || t.status === 'scheduled');
  if (open.length === 0) return;
  const last = open.map(termEndMonthOf).sort().at(-1);
  if (last) r.renewalDate = addMonths(last, 1);
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
  /** F05B: fixed terms, oldest first. */
  terms?: TermRecord[];
}

const deliverable = (
  n: number,
  kind: DeliverableKind,
  monthlyQuantity: number,
  label: string | null = null,
): DeliverableRecord => ({
  id: id(n),
  kind,
  label,
  monthlyQuantity,
  revisionLimit: null,
  archived: false,
});

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
  revisionLimit: 'id' in source ? source.revisionLimit : null,
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
  if (octoberDesign) octoberDesign.ready = 2;
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
      renewalDate: '2027-01-01',
      endedOn: null,
      currency: 'SYP',
      monthlyFeeMinor: null,
      archived: false,
      deliverables: [ads, adsReport],
      terms: [
        {
          id: id(1931),
          number: 1,
          status: 'completed',
          startMonth: '2026-07-01',
          months: 3,
          endAction: 'renew',
          schedule: [2_500_000, 2_500_000, 2_500_000],
          renewedFromId: null,
          cancelReason: null,
          cancelledAt: null,
          createdAt: '2026-06-20T09:00:00.000Z',
        },
        {
          id: id(1932),
          number: 2,
          status: 'active',
          startMonth: '2026-10-01',
          months: 3,
          endAction: 'renew',
          schedule: [3_000_000, 3_000_000, 4_000_000],
          renewedFromId: id(1931),
          cancelReason: null,
          cancelledAt: null,
          createdAt: '2026-09-01T00:05:00.000Z',
        },
      ],
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
  const noTasks = { total: 0, delivered: 0, open: 0, ready: 0 };
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
      revisionLimit: line.revisionLimit,
      position: c.lines.indexOf(line) + 1,
      committed: line.committed,
      delivered,
      deliveredAfterClose: c.status === 'closed' ? line.afterClose : 0,
      behind:
        c.status === 'open' &&
        r.status === 'active' &&
        isLineBehind({ committed: line.committed, delivered }, c, today),
      tasks: { ...noTasks, ready: line.ready ?? 0 },
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
      term: (() => {
        const term = currentTermOf(r);
        return term ? termSummaryOf(term) : null;
      })(),
      currentCycle: open ? cycleOf(r, open) : null,
    };
  };
  const detail = (r: RetainerRecord): RetainerDetail => ({
    ...summary(r),
    term: (() => {
      const term = currentTermOf(r);
      if (!term) return null;
      return { ...termSummaryOf(term), money: termOf(r, term, seesMoney(r), today).money };
    })(),
    startDate: r.startDate,
    endedOn: r.endedOn,
    deliverables: live(r).map((d, index) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      monthlyQuantity: d.monthlyQuantity,
      revisionLimit: d.revisionLimit,
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
        terms: input.term
          ? [
              {
                id: id(next++),
                number: 1,
                status:
                  firstOfMonth(input.startDate) <= firstOfMonth(today) ? 'active' : 'scheduled',
                startMonth: firstOfMonth(input.startDate),
                months: input.term.months,
                endAction: input.term.endAction ?? 'renew',
                schedule: input.term.schedule,
                renewedFromId: null,
                cancelReason: null,
                cancelledAt: null,
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      };
      syncRenewal(created);
      if (!clientScope(created)) return fail(route, 403, null);
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
      return fail(route, 404, null);
    }
    const allowed = permissions(retainer);

    if (!part) {
      if (method === 'GET') return json(route, detail(retainer));
      if (!allowed.canManage) return fail(route, 403, null);
      Object.assign(retainer, body<Partial<RetainerRecord>>());
      return json(route, detail(retainer));
    }
    if (part === 'deliverables') {
      if (!allowed.canManage) return fail(route, 403, null);
      const { lines } = body<RetainerDeliverables>();
      const kept = new Set(lines.flatMap((line) => (line.id ? [line.id] : [])));
      for (const d of retainer.deliverables) if (!kept.has(d.id)) d.archived = true;
      const ordered = lines.map((line) => {
        const existing = retainer.deliverables.find((d) => d.id === line.id);
        if (!existing) {
          return {
            ...deliverable(next++, line.kind, line.monthlyQuantity, line.label ?? null),
            revisionLimit: line.revisionLimit ?? null,
          };
        }
        return Object.assign(existing, {
          kind: line.kind,
          label: line.label ?? null,
          monthlyQuantity: line.monthlyQuantity,
          revisionLimit: line.revisionLimit ?? null,
        });
      });
      retainer.deliverables = [...ordered, ...retainer.deliverables.filter((d) => d.archived)];
      return json(route, { items: detail(retainer).deliverables });
    }
    if (part === 'status') {
      const { status } = body<RetainerStatusChange>();
      if (status === 'active' ? !allowed.canManage && !allowed.canReactivate : !allowed.canManage) {
        return fail(route, 403, null);
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
        for (const term of retainer.terms ?? []) {
          if (term.status === 'active' || term.status === 'scheduled') {
            Object.assign(term, { status: 'cancelled', cancelledAt: new Date().toISOString() });
          }
        }
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
    if (part === 'terms') {
      retainer.terms ??= [];
      const terms = retainer.terms;
      const view = (term: TermRecord) => termOf(retainer, term, seesMoney(retainer), today);
      if (!childId && method === 'GET') {
        return json(route, { items: [...terms].reverse().map(view) });
      }
      if (!allowed.canEditMoney) return fail(route, 403, null);
      if (!childId) {
        const input = body<CreateRetainerTerm>();
        const sum = input.schedule.reduce((total, amount) => total + amount, 0);
        if (input.schedule.length !== input.months || sum !== input.agreedTotalMinor) {
          return fail(route, 409, 'SCHEDULE_TOTAL_MISMATCH');
        }
        if (
          terms.some(
            (t) =>
              t.status === 'scheduled' ||
              (t.status !== 'cancelled' && termEndMonthOf(t) >= input.startMonth),
          )
        ) {
          return fail(route, 409, 'TERM_OVERLAP');
        }
        const created: TermRecord = {
          id: id(next++),
          number: terms.length + 1,
          status: input.startMonth <= firstOfMonth(today) ? 'active' : 'scheduled',
          startMonth: input.startMonth,
          months: input.months,
          endAction: input.endAction ?? 'renew',
          schedule: input.schedule,
          renewedFromId: null,
          cancelReason: null,
          cancelledAt: null,
          createdAt: new Date().toISOString(),
        };
        terms.push(created);
        syncRenewal(retainer);
        return json(route, view(created), 201);
      }
      const term = terms.find((t) => t.id === childId);
      if (!term) return fail(route, 404, null);
      if (childPart === 'cancel') {
        if (term.status !== 'scheduled') return fail(route, 409, 'TERM_STARTED');
        Object.assign(term, {
          status: 'cancelled',
          cancelReason: body<{ reason: string }>().reason,
          cancelledAt: new Date().toISOString(),
        });
        syncRenewal(retainer);
        return json(route, view(term));
      }
      const input = body<UpdateRetainerTerm>();
      if (term.status === 'active') {
        if (input.months !== undefined && input.months !== term.months) {
          return fail(route, 409, 'TERM_STARTED');
        }
        if (input.endAction) term.endAction = input.endAction;
        return json(route, view(term));
      }
      Object.assign(term, {
        ...(input.startMonth && { startMonth: input.startMonth }),
        ...(input.months && { months: input.months }),
        ...(input.schedule && { schedule: input.schedule }),
        ...(input.endAction && { endAction: input.endAction }),
      });
      syncRenewal(retainer);
      return json(route, view(term));
    }
    if (part === 'cycles') {
      if (!childId) {
        const items = newest(retainer).map((c) => cycleOf(retainer, c));
        return json(route, { items, total: items.length, page: 1, pageSize: 12 });
      }
      const cycle = retainer.cycles.find((c) => c.id === childId);
      if (!cycle) return fail(route, 404, null);
      if (!childPart) return json(route, cycleDetailOf(retainer, cycle));
      if (!allowed.canManage) return fail(route, 403, null);
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
      if (!line) return fail(route, 404, null);
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
        return fail(route, 403, null);
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
      if (!item) return fail(route, 404, null);
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
  /** Null for a revision the client asked for through an approval link (F09). */
  authorId: string | null;
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
  /** The stage of internal review; null in every other status (F09). */
  reviewStage: ReviewStage | null;
  clientText: string | null;
  /** Passes and returns, oldest first. */
  reviews: TaskReview[];
  clearedReviewId: string | null;
  responses: TaskClientResponse[];
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
  /** The post the task produces media for (F08). */
  postId: string | null;
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
    reviewStage: fields.status === 'internal_review' ? 'internal' : null,
    clientText: null,
    reviews: [],
    clearedReviewId: null,
    responses: [],
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
    postId: null,
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
    // A healthcare client's task past internal review, waiting for the medical review (F09).
    taskRecord(1008, {
      title: 'منشور التوعية بصحة الأسنان',
      brief: 'منشور توعوي عن تنظيف الأسنان اليومي لصفحة العيادة.',
      department: 'content_management',
      assigneeId: id(5),
      status: 'internal_review',
      reviewStage: 'medical',
      dueDate: '2026-10-15',
      clientId: id(602),
      needsClientApproval: true,
      createdById: id(1),
      startedAt: '2026-10-06T08:00:00.000Z',
      clientText:
        'ابتسامتك تبدأ بدقيقتين: نظّف أسنانك مرتين يوميًا.\nاحجز فحصك الدوري في عيادة الشفاء.',
      reviews: [
        {
          id: id(1451),
          stage: 'internal',
          outcome: 'returned',
          note: 'اختصر النص في سطرين.',
          reviewer: { id: id(1), name: 'سارة الخطيب' },
          versions: [],
          clientText: null,
          createdAt: '2026-10-07T10:00:00.000Z',
        },
        {
          id: id(1452),
          stage: 'internal',
          outcome: 'passed',
          note: null,
          reviewer: { id: id(1), name: 'سارة الخطيب' },
          versions: [{ id: id(1381), fileItemId: id(1330), name: 'منشور التوعية', number: 1 }],
          clientText:
            'ابتسامتك تبدأ بدقيقتين: نظّف أسنانك مرتين يوميًا.\nاحجز فحصك الدوري في عيادة الشفاء.',
          createdAt: '2026-10-08T09:00:00.000Z',
        },
      ],
      revisions: [
        {
          ...clientRevision(1305, 0, 'اختصر النص في سطرين.', false, '2026-10-07T10:00:00.000Z'),
          source: 'internal',
          number: null,
          contactId: null,
          authorId: id(1),
        },
      ],
    }),
    // The medical reviewer's own task: another member reviews it (rule 4).
    taskRecord(1009, {
      title: 'مقال عن تبييض الأسنان',
      department: 'medical_consultation',
      assigneeId: id(8),
      status: 'internal_review',
      reviewStage: 'medical',
      dueDate: '2026-10-16',
      clientId: id(602),
      needsClientApproval: true,
      createdById: id(1),
      startedAt: '2026-10-06T08:00:00.000Z',
      clientText: 'التبييض الآمن يبدأ بفحص عند طبيبك.',
      reviews: [
        {
          id: id(1453),
          stage: 'internal',
          outcome: 'passed',
          note: null,
          reviewer: { id: id(1), name: 'سارة الخطيب' },
          versions: [],
          clientText: 'التبييض الآمن يبدأ بفحص عند طبيبك.',
          createdAt: '2026-10-08T12:00:00.000Z',
        },
      ],
    }),
  ];
}

interface ApprovalItemRecord {
  id: string;
  /** A task item (F09), or a post item (F08): one of the two. */
  taskId: string | null;
  postId: string | null;
  /** What the client reads instead of the internal title. */
  title: string;
  /** The snapshot sent: a pass of the task or of the post. */
  reviewId: string;
  status: ApprovalItemStatus;
  withdrawnReason: ApprovalWithdrawnReason | null;
  closedAt: string | null;
  /** The client response of the task or the post that closed the item. */
  responseId: string | null;
}

interface ApprovalRequestRecord {
  id: string;
  /** The API stores only its hash; the mock keeps the token to find the request of a link. */
  token: string;
  clientId: string;
  contactId: string;
  message: string | null;
  issuedAt: string;
  expiresAt: string;
  remindedAt: string | null;
  revokedAt: string | null;
  completedAt: string | null;
  createdById: string;
  createdAt: string;
  items: ApprovalItemRecord[];
}

/** The links of the seeded requests (`MockOptions.approvals`): `/a/<token>`. */
export const OPEN_LINK_TOKEN = 'open-link-token';
export const EXPIRED_LINK_TOKEN = 'expired-link-token';
/** The month link of Jasmine's content plan (`MockOptions.content`, F08). */
export const CONTENT_LINK_TOKEN = 'content-link-token';

/**
 * Jasmine's work with the client (F09), added with `MockOptions.approvals`: an open request with
 * one item waiting, one approved through the link and one answered by hand; an expired request
 * whose task is ready to send again; a task never sent; and a Shifa task that cannot be sent,
 * because the client has no contact with final approval.
 */
export function approvalsSeed(): {
  tasks: TaskRecord[];
  files: FileRecord[];
  requests: ApprovalRequestRecord[];
} {
  const jasmine = id(601);
  const layan = { id: id(3), name: 'ليان الأحمد' };
  const sara = { id: id(1), name: 'سارة الخطيب' };
  const hala = { id: id(611), name: 'هالة الشامي', archived: false };
  const pass = (
    n: number,
    versions: TaskReview['versions'],
    clientText: string | null,
    stage: ReviewStage = 'internal',
  ): TaskReview => ({
    id: id(n),
    stage,
    outcome: 'passed',
    note: null,
    reviewer: stage === 'medical' ? { id: id(8), name: 'د. هبة النجار' } : sara,
    versions,
    clientText,
    createdAt: '2026-10-07T08:00:00.000Z',
  });
  const sentTask = (
    n: number,
    title: string,
    review: TaskReview,
    fields: Partial<TaskRecord> = {},
  ): TaskRecord =>
    taskRecord(n, {
      title,
      assigneeId: id(4),
      status: 'awaiting_client',
      dueDate: '2026-10-16',
      clientId: jasmine,
      needsClientApproval: true,
      startedAt: '2026-10-05T08:00:00.000Z',
      clientText: review.clientText,
      reviews: [review],
      clearedReviewId: review.id,
      ...fields,
    });
  const deliverable = (n: number, taskId: string, name: string, version: FileVersionRecord) => ({
    id: id(n),
    ownerType: 'task' as const,
    ownerId: taskId,
    role: 'deliverable' as const,
    name,
    brandKind: null,
    confidential: false,
    createdById: layan.id,
    createdAt: version.createdAt,
    archivedAt: null,
    versions: [version],
  });
  const png = (name: string) => ({ name, mimeType: 'image/png', sizeBytes: 1_572_864 });
  const at = '2026-10-06T10:00:00.000Z';
  const sentVersion = (versionId: number, fileId: number, name: string) => ({
    id: id(versionId),
    fileItemId: id(fileId),
    name,
    number: 1,
  });
  const item = (
    n: number,
    taskId: number,
    title: string,
    reviewId: number,
    fields: Partial<ApprovalItemRecord> = {},
  ): ApprovalItemRecord => ({
    id: id(n),
    taskId: id(taskId),
    postId: null,
    title,
    reviewId: id(reviewId),
    status: 'pending',
    withdrawnReason: null,
    closedAt: null,
    responseId: null,
    ...fields,
  });
  const answered = '2026-10-09T12:00:00.000Z';
  return {
    tasks: [
      sentTask(
        1010,
        'ريل عرض الخريف',
        pass(
          1461,
          [
            sentVersion(1391, 1340, 'ريل عرض الخريف'),
            sentVersion(1395, 1344, 'تصميم الطباعة'),
            sentVersion(1396, 1345, 'ملفات المصدر'),
          ],
          'خريف بطعم جديد: جرّب أطباق الموسم في مطعم الياسمين.',
        ),
      ),
      sentTask(
        1011,
        'بوست قائمة المشروبات',
        pass(1462, [sentVersion(1392, 1341, 'بوست المشروبات')], 'مشروبات الخريف الدافئة وصلت.'),
        {
          status: 'approved',
          responses: [
            {
              id: id(1471),
              decision: 'approved',
              channel: 'link',
              contact: hala,
              note: 'ممتاز، انشروه الخميس.',
              versions: [sentVersion(1392, 1341, 'بوست المشروبات')],
              recordedBy: null,
              createdAt: answered,
            },
          ],
        },
      ),
      sentTask(
        1012,
        'إعلان عرض الغداء',
        pass(1463, [sentVersion(1393, 1342, 'قائمة عرض الغداء')], null),
        {
          status: 'revisions',
          responses: [
            {
              id: id(1472),
              decision: 'changes_requested',
              channel: 'manual',
              contact: hala,
              note: 'غيّروا سعر العرض إلى 45 ألف ليرة.',
              versions: [sentVersion(1393, 1342, 'قائمة عرض الغداء')],
              recordedBy: layan,
              createdAt: answered,
            },
          ],
          revisions: [clientRevision(1306, 1, 'غيّروا سعر العرض إلى 45 ألف ليرة.', false, answered)],
        },
      ),
      sentTask(1013, 'بنر الموقع', pass(1464, [sentVersion(1394, 1343, 'بنر الموقع')], null), {
        dueDate: '2026-10-12',
      }),
      sentTask(1014, 'ستوري افتتاح الفرع', pass(1465, [], 'نفتتح فرعنا الجديد يوم الجمعة.'), {
        dueDate: '2026-10-18',
      }),
      sentTask(
        1015,
        'منشور نصائح العناية اليومية',
        pass(1466, [], 'ثلاث عادات يومية تحمي أسنانك.', 'medical'),
        { clientId: id(602), department: 'content_management', assigneeId: id(5) },
      ),
    ],
    files: [
      deliverable(
        1340,
        id(1010),
        'ريل عرض الخريف',
        uploadVersion(1391, 1, png('autumn-reel-cover.png'), layan, at),
      ),
      deliverable(
        1341,
        id(1011),
        'بوست المشروبات',
        uploadVersion(1392, 1, png('drinks-post.png'), layan, at, {
          isFinal: true,
          finalSource: 'client',
          finalMarkedAt: answered,
        }),
      ),
      deliverable(
        1342,
        id(1012),
        'قائمة عرض الغداء',
        uploadVersion(
          1393,
          1,
          { name: 'lunch-offer.pdf', mimeType: 'application/pdf', sizeBytes: 524_288 },
          layan,
          at,
        ),
      ),
      deliverable(
        1343,
        id(1013),
        'بنر الموقع',
        uploadVersion(1394, 1, png('site-banner.png'), layan, at),
      ),
      // Rule 22: a TIFF shows its rendered preview; only the archive is offered as a download.
      deliverable(
        1344,
        id(1010),
        'تصميم الطباعة',
        uploadVersion(
          1395,
          1,
          { name: 'print-design.tiff', mimeType: 'image/tiff', sizeBytes: 9_437_184 },
          layan,
          at,
        ),
      ),
      deliverable(
        1345,
        id(1010),
        'ملفات المصدر',
        uploadVersion(
          1396,
          1,
          { name: 'source-files.zip', mimeType: 'application/zip', sizeBytes: 31_457_280 },
          layan,
          at,
        ),
      ),
    ],
    requests: [
      {
        id: id(1481),
        token: OPEN_LINK_TOKEN,
        clientId: jasmine,
        contactId: hala.id,
        message: 'أعمال حملة الخريف جاهزة لمراجعتكم.',
        issuedAt: '2026-10-07T07:00:00.000Z',
        expiresAt: '2026-10-14T07:00:00.000Z',
        remindedAt: '2026-10-09T07:15:00.000Z',
        revokedAt: null,
        completedAt: null,
        createdById: layan.id,
        createdAt: '2026-10-07T07:00:00.000Z',
        items: [
          item(1491, 1010, 'ريل عرض الخريف', 1461),
          item(1492, 1011, 'بوست قائمة المشروبات', 1462, {
            status: 'approved',
            closedAt: answered,
            responseId: id(1471),
          }),
          item(1493, 1012, 'إعلان عرض الغداء', 1463, {
            status: 'changes_requested',
            closedAt: answered,
            responseId: id(1472),
          }),
        ],
      },
      {
        id: id(1482),
        token: EXPIRED_LINK_TOKEN,
        clientId: jasmine,
        contactId: hala.id,
        message: null,
        issuedAt: '2026-09-28T09:00:00.000Z',
        expiresAt: '2026-10-05T09:00:00.000Z',
        remindedAt: '2026-09-30T09:15:00.000Z',
        revokedAt: null,
        completedAt: null,
        createdById: sara.id,
        createdAt: '2026-09-28T09:00:00.000Z',
        items: [item(1494, 1013, 'بنر الموقع', 1464)],
      },
    ],
  };
}

interface TaskState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  posts: PostRecord[];
  /** Files beyond the seeded ones, and the approval requests (`approvalsSeed`). */
  files: FileRecord[];
  requests: ApprovalRequestRecord[];
  /** The email outbox, where an approval link asked to be emailed goes (F14 email rule 19). */
  outbox?: EmailRecord[];
  me: () => MeResponse;
}

const OPEN_TASK: TaskStatus[] = [...OPEN_TASK_STATUSES];

/** The token every mocked task carries: the mock never changes content between load and pass. */
const MOCK_CONTENT_TOKEN = '0000000000000000';

/** The tasks API (F06) over the in-memory records, with its scopes and workflow rules. */
function taskRoutes({
  users,
  clients,
  projects,
  retainers,
  tasks,
  posts,
  files,
  requests,
  outbox = [],
  me,
}: TaskState) {
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
  const reviewStage = (task: TaskRecord) => task.reviewStage;
  const cleared = (task: TaskRecord) =>
    task.reviews.find((review) => review.id === task.clearedReviewId) ?? null;
  /** Rule 8: sent by internal review, and by the medical review for a healthcare client. */
  const readyToSend = (task: TaskRecord) =>
    !task.archived &&
    task.status === 'awaiting_client' &&
    rights(task).client &&
    (!clientOf(task)?.isHealthcare || cleared(task)?.stage === 'medical') &&
    !blockingItem(task);
  /** Rule 2: a pass keeps the latest version of each deliverable and the text for the client. */
  const recordReview = (
    task: TaskRecord,
    stage: ReviewStage,
    outcome: TaskReview['outcome'],
    note: string | null,
    snapshot?: Pick<TaskReview, 'versions' | 'clientText'>,
  ): TaskReview => {
    const passed = outcome === 'passed';
    const review: TaskReview = {
      id: id(next++),
      stage,
      outcome,
      note,
      reviewer: person(me().user.id),
      versions: passed ? (snapshot?.versions ?? taskFiles.snapshot(task.id)) : [],
      clientText: passed ? (snapshot ? snapshot.clientText : task.clientText) : null,
      createdAt: TASKS_NOW.toISOString(),
    };
    task.reviews.push(review);
    return review;
  };
  const allowed = (task: TaskRecord) =>
    task.archived
      ? []
      : allowedTaskTransitions(
          {
            status: task.status,
            reviewStage: reviewStage(task),
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
      canMedicalReview:
        live &&
        task.reviewStage === 'medical' &&
        holds('approvals.review_medical', 'all') &&
        task.assigneeId !== me().user.id,
      canWithdrawFromClient:
        task.status === 'awaiting_client' && allowed(task).includes('internal_review'),
      canEditClientText: live && OPEN_TASK.includes(task.status) && (r.work || r.manage),
      canSendForApproval: readyToSend(task),
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
      reviewStage: reviewStage(task),
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
      postId: task.postId,
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
    clientText: task.clientText,
    contentToken: MOCK_CONTENT_TOKEN,
    clearedReview: cleared(task),
    reviewHistory: task.reviews,
    clientResponses: task.responses,
    pendingApproval: pendingApproval(task),
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
    fileCounts: taskFiles.counts(task.id),
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
      author: r.authorId ? person(r.authorId) : null,
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
  const taskFiles = fileRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    posts,
    files: [...filesSeed(), ...files],
    me,
    rights,
  });
  const contentApi = contentRoutes({
    users,
    clients,
    retainers,
    tasks,
    posts,
    me,
    taskSummary: summary,
    media: taskFiles.media,
    // Called once a request arrives, when the approvals helpers below exist.
    approval: {
      pending: (post) => postPendingApproval(post),
      ready: (post) => postReady(post),
      settle: (post, response) => settlePostItem(post, response),
    },
  });

  // Approval requests (F09): the links sent to clients, and what they answered.
  const stateOf = (request: ApprovalRequestRecord) =>
    approvalRequestState(
      {
        revokedAt: request.revokedAt ? new Date(request.revokedAt) : null,
        completedAt: request.completedAt ? new Date(request.completedAt) : null,
        expiresAt: new Date(request.expiresAt),
      },
      TASKS_NOW,
    );
  const pendingItem = (task: TaskRecord) => {
    for (const request of requests) {
      const item = request.items.find((i) => i.taskId === task.id && i.status === 'pending');
      if (item) return { request, item };
    }
    return undefined;
  };
  /** Rule 8: a pending item in an expired request does not block a new one. */
  const blockingItem = (task: TaskRecord) => {
    const pending = pendingItem(task);
    return pending && stateOf(pending.request) !== 'expired' ? pending : undefined;
  };
  const pendingApproval = (task: TaskRecord): TaskDetail['pendingApproval'] => {
    const pending = pendingItem(task);
    return pending
      ? {
          requestId: pending.request.id,
          state: stateOf(pending.request),
          issuedAt: pending.request.issuedAt,
          expiresAt: pending.request.expiresAt,
        }
      : null;
  };
  // Post items (F08 rules 20–25), as the task items above.
  const postById = (postId: string | null) => posts.find((p) => p.id === postId);
  const pendingPostItem = (post: PostRecord) => {
    for (const request of requests) {
      const item = request.items.find((i) => i.postId === post.id && i.status === 'pending');
      if (item) return { request, item };
    }
    return undefined;
  };
  const postCleared = (post: PostRecord) =>
    post.reviews.find((review) => review.id === post.clearedReviewId) ?? null;
  const postReady = (post: PostRecord) => {
    const pending = pendingPostItem(post);
    return (
      !post.archived &&
      post.status === 'awaiting_client' &&
      clientScope(post.clientId) &&
      (!clients.find((c) => c.id === post.clientId)?.isHealthcare ||
        postCleared(post)?.stage === 'medical') &&
      !(pending && stateOf(pending.request) !== 'expired')
    );
  };
  const postPendingApproval = (post: PostRecord): PostDetail['pendingApproval'] => {
    const pending = pendingPostItem(post);
    return pending
      ? {
          requestId: pending.request.id,
          state: stateOf(pending.request),
          issuedAt: pending.request.issuedAt,
          expiresAt: pending.request.expiresAt,
        }
      : null;
  };
  const settlePostItem = (post: PostRecord, response: PostClientResponse | null) => {
    const pending = pendingPostItem(post);
    if (!pending) return;
    if (response) {
      pending.item.responseId = response.id;
      closeItem(pending.request, pending.item, response.decision);
    } else {
      closeItem(pending.request, pending.item, 'withdrawn', 'post_moved');
    }
  };
  const postReviewOf = (item: ApprovalItemRecord) =>
    postById(item.postId)?.reviews.find((review) => review.id === item.reviewId);
  /** What a post item showed: the post as its snapshot passed it (rule 27). */
  const shownPost = (item: ApprovalItemRecord) => {
    const post = postById(item.postId);
    const snapshot = postReviewOf(item);
    return post && snapshot
      ? {
          type: snapshot.type ?? post.type,
          platforms: snapshot.platforms,
          publishDate: snapshot.publishDate ?? post.publishDate,
          publishTime: snapshot.publishTime,
          caption: snapshot.caption,
          hashtags: snapshot.hashtags,
        }
      : null;
  };
  const closeItem = (
    request: ApprovalRequestRecord,
    item: ApprovalItemRecord,
    status: ApprovalItemStatus,
    withdrawnReason: ApprovalWithdrawnReason | null = null,
  ) => {
    item.status = status;
    item.withdrawnReason = withdrawnReason;
    item.closedAt = TASKS_NOW.toISOString();
    if (!request.revokedAt && request.items.every((i) => i.status !== 'pending')) {
      request.completedAt = TASKS_NOW.toISOString();
    }
  };
  const requestClient = (request: ApprovalRequestRecord) =>
    clients.find((c) => c.id === request.clientId) as ClientRecord;
  const requestContact = (request: ApprovalRequestRecord) =>
    requestClient(request).contacts.find((c) => c.id === request.contactId) as Contact & {
      archived: boolean;
    };
  const clientScope = (clientId: string) =>
    holds('tasks.manage', 'all') ||
    (holds('tasks.manage', 'own_clients') &&
      clients.find((c) => c.id === clientId)?.accountManagerId === me().user.id);
  const reviewOf = (item: ApprovalItemRecord) =>
    item.taskId
      ? byId(item.taskId)?.reviews.find((review) => review.id === item.reviewId)
      : undefined;
  /** The versions an item sent: its task's pass or its post's. */
  const sentOf = (item: ApprovalItemRecord) =>
    (item.postId ? postReviewOf(item) : reviewOf(item))?.versions ?? [];
  const responseOf = (item: ApprovalItemRecord) =>
    (item.taskId ? byId(item.taskId)?.responses : postById(item.postId)?.responses)?.find(
      (response) => response.id === item.responseId,
    );
  const countsOf = (request: ApprovalRequestRecord) => {
    const count = (status: ApprovalItemStatus) =>
      request.items.filter((i) => i.status === status).length;
    return {
      total: request.items.length,
      approved: count('approved'),
      changesRequested: count('changes_requested'),
      pending: count('pending'),
    };
  };
  const requestOf = (request: ApprovalRequestRecord): ApprovalRequest => {
    const contact = requestContact(request);
    return {
      id: request.id,
      client: { id: request.clientId, name: requestClient(request).tradeName },
      contact: { id: contact.id, name: contact.name, archived: contact.archived },
      state: stateOf(request),
      items: countsOf(request),
      issuedAt: request.issuedAt,
      expiresAt: request.expiresAt,
      remindedAt: request.remindedAt,
      createdBy: person(request.createdById),
      createdAt: request.createdAt,
    };
  };
  const requestDetail = (request: ApprovalRequestRecord): ApprovalRequestDetail => {
    const { items: counts, ...summaryFields } = requestOf(request);
    const state = stateOf(request);
    const scoped = clientScope(request.clientId);
    return {
      ...summaryFields,
      counts,
      message: request.message,
      items: request.items.map((item, index): ApprovalItem => {
        const response = responseOf(item);
        const post = postById(item.postId);
        const shown = shownPost(item);
        return {
          id: item.id,
          position: index + 1,
          kind: item.postId ? 'post' : 'task',
          title: item.title,
          task: item.taskId ? { id: item.taskId, title: byId(item.taskId)?.title ?? '' } : null,
          post: post && shown ? { ...shown, id: post.id, title: post.title } : null,
          status: item.status,
          withdrawnReason: item.withdrawnReason,
          closedAt: item.closedAt,
          versions: sentOf(item).flatMap((version) => taskFiles.sent(version.id) ?? []),
          text: reviewOf(item)?.clientText ?? null,
          response: response
            ? {
                decision: response.decision,
                channel: response.channel,
                note: response.note,
                createdAt: response.createdAt,
              }
            : null,
        };
      }),
      contactPhone: requestContact(request).phone,
      contactEmail: requestContact(request).email,
      permissions: {
        canReissue: scoped && (state === 'open' || state === 'expired') && counts.pending > 0,
        canRevoke: scoped && (state === 'open' || state === 'expired'),
      },
    };
  };
  /** A new link: only the request knows its token (rule 9). */
  const issue = (
    request: ApprovalRequestRecord,
    origin: string,
    emailed = false,
  ): IssuedApprovalRequest => {
    request.token = `link-token-${next++}`;
    request.issuedAt = TASKS_NOW.toISOString();
    request.expiresAt = new Date(
      TASKS_NOW.getTime() + APPROVAL_LIMITS.linkDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    request.remindedAt = null;
    const contact = requestContact(request);
    if (!emailed || !contact.email) {
      return { ...requestDetail(request), link: `${origin}/a/${request.token}`, email: null };
    }
    const email: EmailRecord = {
      id: id(9900 + outbox.length),
      kind: 'client_approval_link',
      audience: 'client',
      status: 'queued',
      to: [{ name: contact.name, email: contact.email }],
      cc: [],
      subject: 'أعمال بانتظار اعتمادكم من Vertex Media',
      sender: { id: me().user.id, name: me().user.name },
      createdAt: TASKS_NOW.toISOString(),
      sentAt: null,
      error: null,
      attempts: 0,
      record: { type: 'approval_request', id: request.id },
      clientId: request.clientId,
    };
    outbox.push(email);
    const { audience: _, attempts: __, record: ___, clientId: ____, ...summary } = email;
    return { ...requestDetail(request), link: `${origin}/a/${request.token}`, email: summary };
  };
  const publicItem = (item: ApprovalItemRecord): PublicApprovalItem => {
    const withdrawn = item.status === 'withdrawn';
    const review = withdrawn ? undefined : reviewOf(item);
    const response = responseOf(item);
    return {
      id: item.id,
      kind: item.postId ? 'post' : 'task',
      title: item.title,
      text: review?.clientText ?? null,
      post: item.postId && !withdrawn ? shownPost(item) : null,
      files: withdrawn
        ? []
        : sentOf(item).flatMap((version) => {
            const file = taskFiles.shown(version.id);
            // Rule 27: never the internal titles of a post's files.
            return file ? [item.postId ? { ...file, name: '' } : file] : [];
          }),
      status: item.status,
      note: response?.note ?? null,
      decidedAt: response?.createdAt ?? null,
      recordedByAgency: response?.channel === 'manual',
    };
  };
  /** Rule 20: the request of a link, or why the link does not work. */
  const requestOfLink = (
    token: string,
  ): ApprovalRequestRecord | { status: 404 | 410; code: ErrorCode } => {
    const request = requests.find((r) => r.token === token);
    const contact = request && requestContact(request);
    if (!request || request.revokedAt || contact?.archived || !contact?.hasFinalApproval) {
      return { status: 404, code: 'APPROVAL_LINK_INVALID' };
    }
    if (TASKS_NOW.getTime() >= new Date(request.expiresAt).getTime()) {
      return { status: 410, code: 'APPROVAL_LINK_EXPIRED' };
    }
    return request;
  };
  /** Rules 13 and 14: the response moves the task and closes the item, as the client or by hand. */
  const recordResponse = (
    task: TaskRecord,
    decision: TaskClientResponse['decision'],
    channel: TaskClientResponse['channel'],
    contact: TaskClientResponse['contact'],
    note: string | null,
  ) => {
    const response: TaskClientResponse = {
      id: id(next++),
      decision,
      channel,
      contact,
      note,
      versions: cleared(task)?.versions ?? [],
      recordedBy: channel === 'manual' ? person(me().user.id) : null,
      createdAt: TASKS_NOW.toISOString(),
    };
    task.responses.push(response);
    if (decision === 'approved') taskFiles.markFinal(response.versions.map((v) => v.id));
    return response;
  };

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
      (!q.get('milestoneId') || task.milestoneId === q.get('milestoneId')) &&
      (!q.get('cycleLineId') || task.cycleLineId === q.get('cycleLineId')) &&
      (!q.get('type') || task.type === q.get('type')) &&
      (priorities.length === 0 || priorities.includes(task.priority)) &&
      (!flag('overdue') || overdue(task) === (flag('overdue') === 'true')) &&
      (!flag('blocked') || blocked(task) === (flag('blocked') === 'true')) &&
      (flag('overLimit') !== 'true' || summary(task).overLimitPending) &&
      (!q.get('dueFrom') || task.dueDate >= (q.get('dueFrom') as string)) &&
      (!q.get('dueTo') || task.dueDate <= (q.get('dueTo') as string)) &&
      (q.get('createdBy') !== 'me' || task.createdById === meId) &&
      (q.get('reviewer') !== 'me' || (r.manage && task.status === 'internal_review')) &&
      (!q.get('reviewStage') || task.reviewStage === q.get('reviewStage'))
    );
  };
  // Like the database enum: low first.
  const PRIORITY_ORDER: readonly TaskPriority[] = TASK_PRIORITIES;

  // Answers a tasks request, or returns undefined to let the other mocks try.
  const handle = (
    route: Route,
    method: string,
    url: URL,
    request: Request,
  ): Promise<void> | undefined => {
    const path = url.pathname;
    const body = <T>() => request.postDataJSON() as T;

    // Files (F10).
    const filed = taskFiles.handle(route, method, url, request);
    if (filed) return filed;

    // Content (F08).
    const posted = contentApi(route, method, url, request);
    if (posted) return posted;

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
        medicalReview: holds('approvals.review_medical', 'all')
          ? count(open, (t) => t.reviewStage === 'medical' && t.assigneeId !== meId)
          : null,
        readyToSend:
          holds('tasks.manage', 'all') || holds('tasks.manage', 'own_clients')
            ? count(open, readyToSend)
            : null,
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
      if (created.assigneeId && !self && !r.assign) return fail(route, 403, null);
      if (input.type === 'client_request') {
        if (!r.client) return fail(route, 403, null);
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

    // Tasks ready to send, by client (F09 rule 8).
    if (path === '/api/approvals/ready') {
      const sendable = tasks.filter(readyToSend);
      const month = url.searchParams.get('month');
      const postsReady = posts
        .filter((p) => postReady(p) && (!month || p.publishDate.startsWith(month)))
        .sort(
          (a, b) =>
            a.publishDate.localeCompare(b.publishDate) ||
            (a.publishTime ?? '').localeCompare(b.publishTime ?? ''),
        );
      const ready: ApprovalReady = {
        clients: clients
          .filter(
            (c) =>
              (!url.searchParams.get('clientId') || c.id === url.searchParams.get('clientId')) &&
              (sendable.some((t) => t.clientId === c.id) ||
                postsReady.some((p) => p.clientId === c.id)),
          )
          .sort((a, b) => a.tradeName.localeCompare(b.tradeName, 'ar'))
          .map((c) => ({
            client: { id: c.id, name: c.tradeName },
            isHealthcare: c.isHealthcare,
            contacts: c.contacts
              .filter((contact) => !contact.archived && contact.hasFinalApproval)
              .map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone })),
            tasks: sendable
              .filter((t) => t.clientId === c.id)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .map((t) => ({
                ...summary(t),
                snapshot: {
                  files: cleared(t)?.versions.length ?? 0,
                  hasText: !!cleared(t)?.clientText,
                },
              })),
            posts: postsReady
              .filter((p) => p.clientId === c.id)
              .map((p) => {
                const versions = postCleared(p)?.versions ?? [];
                return {
                  ...contentApi.summary(p),
                  snapshot: {
                    files: versions.length,
                    caption: postCleared(p)?.caption ?? null,
                    thumbnailVersionId:
                      versions.find((v) => taskFiles.sent(v.id)?.previewStatus === 'ready')?.id ??
                      null,
                  },
                };
              }),
          })),
      };
      return json(route, ready);
    }

    // Approval requests (F09).
    const pageOf = <T>(items: T[]) => {
      const pageSize = Number(url.searchParams.get('pageSize') ?? 50);
      const page = Number(url.searchParams.get('page') ?? 1);
      return {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      };
    };
    const newestFirst = [...requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (path === '/api/approvals/requests' && method === 'GET') {
      const q = url.searchParams;
      const states = q.getAll('state').length > 0 ? q.getAll('state') : ['open', 'expired'];
      return json(
        route,
        pageOf(
          newestFirst
            .filter(
              (r) =>
                states.includes(stateOf(r)) &&
                (!q.get('clientId') || r.clientId === q.get('clientId')) &&
                (q.get('createdBy') !== 'me' || r.createdById === me().user.id),
            )
            .map(requestOf),
        ),
      );
    }
    if (path === '/api/approvals/requests' && method === 'POST') {
      const input = body<CreateApprovalRequest>();
      const client = clients.find((c) => c.id === input.clientId);
      if (!client) return fail(route, 404, null);
      if (!clientScope(client.id)) return fail(route, 403, null);
      const contact = client.contacts.find((c) => c.id === input.contactId);
      if (!contact || contact.archived || !contact.hasFinalApproval) {
        return fail(route, 409, 'CONTACT_NOT_APPROVER');
      }
      if (input.items.length > APPROVAL_LIMITS.items) return fail(route, 409, 'LIMIT_REACHED');
      const sending = input.items.flatMap((entry) =>
        'taskId' in entry ? [{ entry, task: byId(entry.taskId) }] : [],
      );
      for (const { entry, task } of sending) {
        if (!task || task.clientId !== client.id || !readyToSend(task)) {
          return fail(route, 409, 'TASK_NOT_READY', { taskId: entry.taskId });
        }
      }
      const sendingPosts = input.items.flatMap((entry) =>
        'postId' in entry ? [{ entry, post: postById(entry.postId) }] : [],
      );
      for (const { entry, post } of sendingPosts) {
        if (!post || post.clientId !== client.id || !postReady(post)) {
          return fail(route, 409, 'POST_NOT_READY', { postId: entry.postId });
        }
      }
      const created: ApprovalRequestRecord = {
        id: id(next++),
        token: '',
        clientId: client.id,
        contactId: contact.id,
        message: input.message ?? null,
        issuedAt: '',
        expiresAt: '',
        remindedAt: null,
        revokedAt: null,
        completedAt: null,
        createdById: me().user.id,
        createdAt: TASKS_NOW.toISOString(),
        items: sending.flatMap(({ entry, task }) => {
          if (!task) return [];
          // Rule 8: sending a task again withdraws its item in the expired request.
          const old = pendingItem(task);
          if (old) closeItem(old.request, old.item, 'withdrawn', 'resent');
          return [
            {
              id: id(next++),
              taskId: task.id,
              postId: null,
              title: entry.title ?? task.title,
              reviewId: task.clearedReviewId ?? '',
              status: 'pending' as const,
              withdrawnReason: null,
              closedAt: null,
              responseId: null,
            },
          ];
        }),
      };
      // F08 rule 27: the posts after the tasks, in publish order.
      for (const { entry, post } of sendingPosts.sort((a, b) =>
        (a.post?.publishDate ?? '').localeCompare(b.post?.publishDate ?? ''),
      )) {
        if (!post) continue;
        const old = pendingPostItem(post);
        if (old) closeItem(old.request, old.item, 'withdrawn', 'resent');
        created.items.push({
          id: id(next++),
          taskId: null,
          postId: post.id,
          title: entry.title ?? post.title,
          reviewId: post.clearedReviewId ?? '',
          status: 'pending',
          withdrawnReason: null,
          closedAt: null,
          responseId: null,
        });
      }
      requests.push(created);
      return json(route, issue(created, url.origin, input.email), 201);
    }
    const requestMatch = path.match(/^\/api\/approvals\/requests\/([^/]+)(?:\/([^/]+))?$/);
    if (requestMatch) {
      const found = requests.find((r) => r.id === requestMatch[1]);
      if (!found) return fail(route, 404, null);
      const action = requestMatch[2];
      if (!action) return json(route, requestDetail(found));
      if (!clientScope(found.clientId)) return fail(route, 403, null);
      const state = stateOf(found);
      if (state === 'revoked' || state === 'completed') return fail(route, 409, 'REQUEST_CLOSED');
      if (action === 'reissue') {
        const { email } = route.request().postDataJSON() as { email?: boolean };
        return json(route, issue(found, url.origin, email));
      }
      if (action === 'revoke') {
        // Rule 12: what still waits is withdrawn, and the tasks are ready again.
        found.revokedAt = TASKS_NOW.toISOString();
        for (const item of found.items) {
          if (item.status === 'pending') closeItem(found, item, 'withdrawn', 'revoked');
        }
        return json(route, requestDetail(found));
      }
    }
    const clientApprovals = path.match(/^\/api\/clients\/([^/]+)\/approvals$/);
    if (clientApprovals) {
      const clientId = clientApprovals[1];
      if (!clients.some((c) => c.id === clientId)) return fail(route, 404, null);
      const history: ClientApprovals = {
        requests: pageOf(newestFirst.filter((r) => r.clientId === clientId).map(requestOf)),
        responses: pageOf(
          tasks
            .filter((t) => t.clientId === clientId)
            .flatMap((t) =>
              t.responses.map(
                (response): ClientResponseEntry => ({
                  ...response,
                  kind: 'task',
                  task: { id: t.id, title: t.title },
                  post: null,
                }),
              ),
            )
            .concat(
              posts
                .filter((p) => p.clientId === clientId)
                .flatMap((p) =>
                  p.responses.map((response) => ({
                    ...response,
                    kind: 'post' as const,
                    task: null,
                    post: { id: p.id, title: p.title },
                  })),
                ),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ),
      };
      return json(route, history);
    }

    // The client page (F09 rules 20–23): the link's token is the access.
    const linkMatch = path.match(/^\/api\/public\/approvals\/([^/]+)(?:\/(.+))?$/);
    if (linkMatch) {
      const linked = requestOfLink(decodeURIComponent(linkMatch[1] ?? ''));
      if ('status' in linked) return fail(route, linked.status, linked.code);
      const rest = linkMatch[2];
      if (!rest) {
        const client = requestClient(linked);
        const shown: PublicApproval = {
          clientName: client.tradeName,
          contactName: requestContact(linked).name,
          accountManagerName: person(client.accountManagerId).name,
          message: linked.message,
          expiresAt: linked.expiresAt,
          items: linked.items.map(publicItem),
        };
        return json(route, shown);
      }
      const versionMatch = rest.match(/^versions\/([^/]+)\/(content|preview|thumbnail)$/);
      if (versionMatch) {
        const versionId = versionMatch[1] ?? '';
        const sent = linked.items.some(
          (item) =>
            item.status !== 'withdrawn' && sentOf(item).some((version) => version.id === versionId),
        );
        return sent
          ? taskFiles.serveVersion(route, versionId, versionMatch[2] ?? '')
          : fail(route, 404, 'APPROVAL_LINK_INVALID');
      }
      const contact = requestContact(linked);
      const respondToPost = (item: ApprovalItemRecord, input: PublicResponse) => {
        const post = postById(item.postId) as PostRecord;
        const response: PostClientResponse = {
          id: id(next++),
          decision: input.decision,
          channel: 'link',
          contact: { id: contact.id, name: contact.name, archived: false },
          note: input.note ?? null,
          versions: postCleared(post)?.versions ?? [],
          recordedBy: null,
          createdAt: TASKS_NOW.toISOString(),
        };
        post.responses.push(response);
        // Rule 22: approved, or back in production with the client's note.
        post.status = input.decision === 'approved' ? 'approved' : 'in_production';
        item.responseId = response.id;
        closeItem(linked, item, input.decision);
      };
      if (rest === 'approve-all' && method === 'POST') {
        // Rule 23: every pending post item, with the same note; tasks never.
        const note = body<PublicApproveAll>().note ?? null;
        const decided = linked.items.filter((i) => i.postId && i.status === 'pending');
        for (const item of decided) respondToPost(item, { decision: 'approved', note });
        return json(route, { items: decided.map(publicItem) });
      }
      const responseMatch = rest.match(/^items\/([^/]+)\/response$/);
      const item = linked.items.find((i) => i.id === responseMatch?.[1]);
      if (!item) return fail(route, 404, null);
      if (item.status === 'withdrawn') return fail(route, 409, 'ITEM_WITHDRAWN');
      if (item.status !== 'pending') return fail(route, 409, 'ITEM_ALREADY_DECIDED');
      const input = body<PublicResponse>();
      if (item.postId) {
        respondToPost(item, input);
        return json(route, publicItem(item));
      }
      const task = item.taskId ? byId(item.taskId) : undefined;
      if (!task) return fail(route, 404, null);
      const response = recordResponse(
        task,
        input.decision,
        'link',
        { id: contact.id, name: contact.name, archived: false },
        input.note ?? null,
      );
      if (input.decision === 'changes_requested') {
        const number = clientCount(task) + 1;
        task.revisions.push({
          id: id(next++),
          source: 'client',
          number,
          note: input.note ?? '',
          contactId: contact.id,
          overLimit: number > task.revisionLimit,
          decision: null,
          decisionNote: null,
          extraWork: null,
          decidedById: null,
          decidedAt: null,
          authorId: null,
          createdAt: TASKS_NOW.toISOString(),
        });
      }
      task.status = input.decision === 'approved' ? 'approved' : 'revisions';
      item.responseId = response.id;
      closeItem(linked, item, input.decision);
      return json(route, publicItem(item));
    }

    // The board's and workload's departments: the filter, else managed, else own (spec F06).
    const viewDepartments = (q: URLSearchParams): DepartmentCode[] => {
      const chosen = q.getAll('department') as DepartmentCode[];
      if (chosen.length > 0) return chosen;
      if (managed().length > 0) return managed();
      return me().departments.map((d) => d.code);
    };
    if (path === '/api/tasks/board') {
      const q = url.searchParams;
      const departments = viewDepartments(q);
      const meId = me().user.id;
      const assigneeId = q.get('assigneeId') === 'me' ? meId : q.get('assigneeId');
      const since = addDays(PROJECTS_TODAY, -BOARD_LIMITS.deliveredDays);
      const shown = tasks.filter(
        (t) =>
          !t.archived &&
          departments.includes(t.department) &&
          (!assigneeId || t.assigneeId === assigneeId) &&
          (!q.get('clientId') || t.clientId === q.get('clientId')),
      );
      const board: TaskBoard = {
        departments,
        columns: BOARD_STATUSES.map((status) => {
          const items = shown
            .filter(
              (t) =>
                t.status === status &&
                (status !== 'delivered' || (t.deliveredAt ?? '').slice(0, 10) >= since),
            )
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
          return {
            status,
            items: items.slice(0, BOARD_LIMITS.cards).map(summary),
            total: items.length,
          };
        }),
      };
      return json(route, board);
    }
    if (path === '/api/tasks/workload') {
      const q = url.searchParams;
      const departments = viewDepartments(q);
      const week = weekOf(q.get('week') ?? PROJECTS_TODAY);
      const open = tasks.filter((t) => !t.archived && OPEN_TASK.includes(t.status));
      const workload: TaskWorkload = {
        week,
        departments,
        people: users
          .filter(
            (u) =>
              u.status !== 'archived' && u.departments.some((d) => departments.includes(d.code)),
          )
          .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
          .map((u) => {
            const theirs = open.filter((t) => t.assigneeId === u.id);
            return {
              user: { id: u.id, name: u.name },
              departments: u.departments
                .map((d) => d.code)
                .filter((code) => departments.includes(code)),
              overdue: theirs.filter(overdue).length,
              dueThisWeek: theirs.filter((t) => t.dueDate >= week.from && t.dueDate <= week.to)
                .length,
              open: theirs.length,
            };
          }),
        unassigned: departments.map((department) => ({
          department,
          count: open.filter((t) => t.assigneeId === null && t.department === department).length,
        })),
      };
      return json(route, workload);
    }

    const match = path.match(/^\/api\/tasks\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (!match) return undefined;
    const [, taskId, part, childId, childAction] = match;
    const task = byId(taskId as string);
    if (!task || (task.archived && !holds('tasks.manage', 'all'))) {
      return fail(route, 404, null);
    }
    const can = permissions(task);
    const answer = () => json(route, detail(task));

    if (!part && method === 'GET') return answer();
    if (!part && method === 'PATCH') {
      if (!can.canEdit && !can.canAssign) return fail(route, 403, null);
      const input = body<UpdateTaskInput>();
      if ((input.assigneeId !== undefined || input.department) && !can.canAssign) {
        return fail(route, 403, null);
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
      // F09: passes keep a snapshot, and a healthcare client's pass leads to the medical stage.
      let toMedical = false;
      if (move === 'send_to_client' || move === 'approve') {
        const pass = recordReview(task, 'internal', 'passed', null);
        toMedical = move === 'send_to_client' && clientOf(task)?.isHealthcare === true;
        if (!toMedical) task.clearedReviewId = pass.id;
      }
      if (move === 'return') {
        recordReview(task, task.reviewStage ?? 'internal', 'returned', change.note ?? '');
      }
      const responder = contactOf(task, change.contactId ?? null);
      const waiting = task.status === 'awaiting_client' ? pendingItem(task) : undefined;
      if ((move === 'client_approved' || move === 'client_changes') && responder) {
        const decision = move === 'client_approved' ? 'approved' : 'changes_requested';
        const response = recordResponse(task, decision, 'manual', responder, change.note ?? null);
        // Rule 16: the response closes the task's pending item.
        if (waiting) {
          waiting.item.responseId = response.id;
          closeItem(waiting.request, waiting.item, decision);
        }
      } else if (waiting) {
        // Rule 17: leaving `awaiting_client` otherwise withdraws it.
        closeItem(waiting.request, waiting.item, 'withdrawn', 'task_moved');
      }
      task.status = toMedical ? 'internal_review' : change.status;
      task.reviewStage =
        task.status === 'internal_review' ? (toMedical ? 'medical' : 'internal') : null;
      return answer();
    }
    if (part === 'medical-review') {
      if (task.reviewStage !== 'medical') return fail(route, 409, 'INVALID_TRANSITION');
      if (!holds('approvals.review_medical', 'all')) return fail(route, 403, null);
      if (task.assigneeId === me().user.id) return fail(route, 403, 'SELF_REVIEW');
      const input = body<MedicalReview>();
      if (input.decision === 'approve') {
        // Rule 2: the medical pass copies the snapshot of the internal pass.
        const internal = [...task.reviews].reverse().find((r) => r.outcome === 'passed');
        const pass = recordReview(task, 'medical', 'passed', input.note ?? null, {
          versions: internal?.versions ?? [],
          clientText: internal?.clientText ?? null,
        });
        task.clearedReviewId = pass.id;
        task.status = 'awaiting_client';
      } else {
        recordReview(task, 'medical', 'returned', input.note ?? '');
        task.revisions.push({
          id: id(next++),
          source: 'medical',
          number: null,
          note: input.note ?? '',
          contactId: null,
          overLimit: false,
          decision: null,
          decisionNote: null,
          extraWork: null,
          decidedById: null,
          decidedAt: null,
          authorId: me().user.id,
          createdAt: TASKS_NOW.toISOString(),
        });
        task.status = 'revisions';
      }
      task.reviewStage = null;
      return answer();
    }
    if (part === 'client-text' && method === 'PUT') {
      if (!can.canEditClientText) return fail(route, 403, null);
      task.clientText = body<{ clientText: string | null }>().clientText?.trim() || null;
      return answer();
    }
    if (part === 'dependencies' && method === 'PUT') {
      if (!can.canReview) return fail(route, 403, null);
      task.dependsOn = body<TaskDependenciesInput>().dependsOn;
      return json(route, { items: detail(task).dependencies });
    }
    if (part === 'archive' || part === 'restore') {
      if (!can.canArchive) return fail(route, 403, null);
      task.archived = part === 'archive';
      return answer();
    }
    if (part === 'revisions' && childAction === 'decision') {
      const revision = task.revisions.find((r) => r.id === childId);
      if (!revision) return fail(route, 404, null);
      if (!can.canDecideRevision) return fail(route, 403, null);
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
      if (!can.canWork && !can.canReview) return fail(route, 403, null);
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
      if (!item) return fail(route, 404, null);
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
      if (!can.canWork && !can.canReview) return fail(route, 403, null);
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
      if (!link) return fail(route, 404, null);
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
      if (!comment) return fail(route, 404, null);
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
  // The dashboard mock (F15) lists tasks as the task list does.
  return Object.assign(handle, { summary, overdue });
}

// Content (F08)

interface PostRecord {
  id: string;
  clientId: string;
  title: string;
  type: PostType;
  platforms: PostPlatform[];
  caption: string | null;
  hashtags: string | null;
  notes: string | null;
  publishDate: string;
  publishTime: string | null;
  status: PostStatus;
  /** The stage of internal review; null in every other status. */
  reviewStage: ReviewStage | null;
  needsClientApproval: boolean;
  responsibleId: string;
  cycleLineId: string | null;
  /** Passes and returns, oldest first. */
  reviews: PostReview[];
  clearedReviewId: string | null;
  responses: PostClientResponse[];
  scheduledAt: string | null;
  publishedAt: string | null;
  publishedById: string | null;
  publishedLinks: PublishedLink[];
  cancelledAt: string | null;
  cancelReason: string | null;
  createdById: string;
  createdAt: string;
  archived: boolean;
}

function postRecord(
  n: number,
  fields: Partial<PostRecord> & Pick<PostRecord, 'title'>,
): PostRecord {
  return {
    id: id(n),
    clientId: id(601),
    type: 'post',
    platforms: ['instagram'],
    caption: null,
    hashtags: null,
    notes: null,
    publishDate: '2026-10-12',
    publishTime: null,
    status: 'idea',
    reviewStage: fields.status === 'internal_review' ? 'internal' : null,
    needsClientApproval: true,
    responsibleId: id(3),
    cycleLineId: null,
    reviews: [],
    clearedReviewId: null,
    responses: [],
    scheduledAt: null,
    publishedAt: null,
    publishedById: null,
    publishedLinks: [],
    cancelledAt: null,
    cancelReason: null,
    createdById: id(3),
    createdAt: '2026-10-05T08:00:00.000Z',
    archived: false,
    ...fields,
  };
}

/**
 * Jasmine's October content plan, one post of each status, with the design tasks that produce
 * their media, and a post of the healthcare client waiting in the medical stage. Two posts wait
 * in the month's approval link, and one more is ready to send.
 */
export function contentSeed(): {
  posts: PostRecord[];
  tasks: TaskRecord[];
  files: FileRecord[];
  requests: ApprovalRequestRecord[];
} {
  const jasmine = id(601);
  const layan = { id: id(3), name: 'ليان الأحمد' };
  const sara = { id: id(1), name: 'سارة الخطيب' };
  const png = (name: string) => ({ name, mimeType: 'image/png', sizeBytes: 2_400_000 });
  const final = {
    isFinal: true,
    finalSource: 'auto' as const,
    finalMarkedAt: '2026-10-08T10:00:00.000Z',
  };
  const deliverableFile = (
    n: number,
    owner: { type: FileOwnerType; id: string },
    name: string,
    version: FileVersionRecord,
  ): FileRecord => ({
    id: id(n),
    ownerType: owner.type,
    ownerId: owner.id,
    role: 'deliverable',
    name,
    brandKind: null,
    confidential: false,
    createdById: layan.id,
    createdAt: version.createdAt,
    archivedAt: null,
    versions: [version],
  });
  const retainerLink = {
    clientId: jasmine,
    retainerId: id(901),
    cycleId: id(921),
    cycleLineId: id(931),
  };
  const pass = (n: number, caption: string, versions: PostReview['versions'] = []): PostReview => ({
    id: id(n),
    stage: 'internal',
    outcome: 'passed',
    note: null,
    reviewer: sara,
    versions,
    caption,
    hashtags: '#مطعم_الياسمين',
    type: 'post',
    platforms: ['instagram'],
    publishDate: '2026-10-12',
    publishTime: null,
    createdAt: '2026-10-08T11:00:00.000Z',
  });
  const autumnCaption = 'أطباق الخريف وصلت: يقطين مشوي، شوربة عدس بالليمون، وكنافة بالقشطة.';
  const sweetsCaption = 'حلويات الجمعة: كنافة نابلسية، مدلوقة، وبلورية بالفستق الحلبي.';
  const postItem = (n: number, postId: number, title: string, reviewId: number) => ({
    id: id(n),
    taskId: null,
    postId: id(postId),
    title,
    reviewId: id(reviewId),
    status: 'pending' as const,
    withdrawnReason: null,
    closedAt: null,
    responseId: null,
  });
  return {
    posts: [
      postRecord(1601, {
        title: 'عرض افتتاح الفرع الثاني',
        platforms: ['instagram', 'facebook'],
        caption: 'نفتح أبواب فرعنا الثاني يوم الجمعة. أول مئة ضيف على حسابنا في الحلويات.',
        hashtags: '#مطعم_الياسمين #افتتاح',
        notes: 'نركّز على صورة الواجهة الجديدة. العرض يسري ثلاثة أيام.',
        publishTime: '18:00',
        status: 'in_production',
      }),
      postRecord(1602, {
        title: 'ريل كواليس المطبخ',
        type: 'reel',
        platforms: ['instagram', 'tiktok'],
        publishDate: '2026-10-14',
        publishTime: '20:00',
      }),
      postRecord(1603, {
        title: 'كاروسيل أطباق الخريف',
        type: 'carousel',
        platforms: ['instagram', 'facebook'],
        caption: autumnCaption,
        hashtags: '#مطعم_الياسمين #خريف',
        publishDate: PROJECTS_TODAY,
        publishTime: '19:00',
        status: 'approved',
        needsClientApproval: false,
        responsibleId: sara.id,
        reviews: [pass(1671, autumnCaption)],
        clearedReviewId: id(1671),
      }),
      postRecord(1604, {
        title: 'ستوري عرض الغداء',
        type: 'story',
        caption: 'غداء العمل بسعر خاص من الأحد إلى الخميس.',
        publishDate: '2026-10-08',
        publishTime: '12:00',
        status: 'scheduled',
        needsClientApproval: false,
        responsibleId: sara.id,
        reviews: [pass(1672, 'غداء العمل بسعر خاص من الأحد إلى الخميس.')],
        clearedReviewId: id(1672),
        scheduledAt: '2026-10-07T09:30:00.000Z',
      }),
      postRecord(1605, {
        title: 'يوم القهوة العالمي',
        caption: 'فنجان قهوتك علينا اليوم.',
        publishDate: '2026-10-01',
        publishTime: '10:00',
        status: 'published',
        reviews: [pass(1673, 'فنجان قهوتك علينا اليوم.')],
        clearedReviewId: id(1673),
        publishedAt: '2026-10-01T07:05:00.000Z',
        publishedById: layan.id,
        publishedLinks: [{ platform: 'instagram', url: 'https://www.instagram.com/p/coffee-day' }],
      }),
      postRecord(1606, {
        title: 'مسابقة المتابعين',
        publishDate: '2026-10-15',
        status: 'cancelled',
        cancelledAt: '2026-10-06T09:00:00.000Z',
        cancelReason: 'أجّل العميل المسابقة إلى الشهر القادم.',
      }),
      postRecord(1607, {
        title: 'قائمة المشروبات الساخنة',
        caption: 'سحلب، شوكولا ساخنة، وزهورات شامية.',
        publishTime: '16:00',
        status: 'internal_review',
      }),
      postRecord(1608, {
        title: 'عرض نهاية الأسبوع',
        platforms: ['instagram', 'facebook', 'x'],
        caption: 'عشاء لشخصين بسعر خاص يومي الجمعة والسبت.',
        publishTime: '13:00',
        status: 'awaiting_client',
        reviews: [pass(1674, 'عشاء لشخصين بسعر خاص يومي الجمعة والسبت.')],
        clearedReviewId: id(1674),
      }),
      postRecord(1609, { title: 'تهنئة بداية الأسبوع', publishTime: '09:00' }),
      postRecord(1610, {
        title: 'شكر لضيوف الافتتاح',
        caption: 'شكرًا لكل من شاركنا الافتتاح.',
        status: 'in_production',
        responsibleId: sara.id,
        reviews: [
          {
            ...pass(1675, ''),
            outcome: 'returned',
            note: 'اذكروا عدد الضيوف وأضيفوا صورة من الافتتاح.',
            reviewer: layan,
            caption: null,
            hashtags: null,
            type: null,
            platforms: [],
            publishDate: null,
          },
        ],
      }),
      postRecord(1611, {
        clientId: id(602),
        title: 'نصائح العناية بالأسنان',
        caption: 'ثلاث عادات يومية تحمي أسنانك.',
        publishDate: '2026-10-13',
        status: 'internal_review',
        reviewStage: 'medical',
        responsibleId: sara.id,
        createdById: sara.id,
        reviews: [pass(1676, 'ثلاث عادات يومية تحمي أسنانك.')],
      }),
      postRecord(1612, { title: 'حملة تشرين الثاني', publishDate: '2026-11-02' }),
      postRecord(1613, {
        title: 'كاروسيل حلويات الجمعة',
        type: 'carousel',
        platforms: ['instagram', 'facebook'],
        caption: sweetsCaption,
        hashtags: '#مطعم_الياسمين #حلويات',
        publishDate: '2026-10-16',
        publishTime: '17:00',
        status: 'awaiting_client',
        reviews: [
          {
            ...pass(1677, sweetsCaption, [
              { id: id(1645), fileItemId: id(1635), name: 'كنافة نابلسية', number: 1 },
              { id: id(1646), fileItemId: id(1636), name: 'بلورية بالفستق', number: 1 },
            ]),
            hashtags: '#مطعم_الياسمين #حلويات',
            type: 'carousel',
            platforms: ['instagram', 'facebook'],
            publishDate: '2026-10-16',
            publishTime: '17:00',
          },
        ],
        clearedReviewId: id(1677),
      }),
      postRecord(1614, {
        title: 'ريل تحضير القهوة',
        type: 'reel',
        platforms: ['instagram', 'tiktok'],
        caption: 'من الحبة إلى الفنجان في ثلاثين ثانية.',
        publishDate: '2026-10-19',
        publishTime: '20:00',
        status: 'awaiting_client',
        reviews: [
          {
            ...pass(1678, 'من الحبة إلى الفنجان في ثلاثين ثانية.'),
            type: 'reel',
            platforms: ['instagram', 'tiktok'],
            publishDate: '2026-10-19',
            publishTime: '20:00',
          },
        ],
        clearedReviewId: id(1678),
      }),
    ],
    tasks: [
      taskRecord(1621, {
        title: 'تصميم عرض الافتتاح',
        assigneeId: layan.id,
        status: 'approved',
        ...retainerLink,
        postId: id(1601),
      }),
      taskRecord(1622, {
        title: 'تصميم قائمة المشروبات',
        assigneeId: layan.id,
        status: 'approved',
        ...retainerLink,
      }),
    ],
    files: [
      deliverableFile(
        1631,
        { type: 'task', id: id(1621) },
        'تصميم عرض الافتتاح',
        uploadVersion(1641, 1, png('opening-offer.png'), layan, '2026-10-08T09:00:00.000Z', final),
      ),
      deliverableFile(
        1632,
        { type: 'task', id: id(1622) },
        'قائمة المشروبات',
        uploadVersion(1642, 1, png('hot-drinks.png'), layan, '2026-10-08T09:30:00.000Z', final),
      ),
      deliverableFile(
        1633,
        { type: 'post', id: id(1603) },
        'يقطين مشوي',
        uploadVersion(1643, 1, png('pumpkin.png'), sara, '2026-10-07T08:00:00.000Z'),
      ),
      deliverableFile(
        1634,
        { type: 'post', id: id(1603) },
        'شوربة العدس',
        uploadVersion(1644, 1, png('lentil-soup.png'), sara, '2026-10-07T08:05:00.000Z'),
      ),
      deliverableFile(
        1635,
        { type: 'post', id: id(1613) },
        'كنافة نابلسية',
        uploadVersion(1645, 1, png('knafeh.png'), sara, '2026-10-08T08:00:00.000Z'),
      ),
      deliverableFile(
        1636,
        { type: 'post', id: id(1613) },
        'بلورية بالفستق',
        uploadVersion(1646, 1, png('balloriyeh.png'), sara, '2026-10-08T08:05:00.000Z'),
      ),
    ],
    requests: [
      {
        id: id(1681),
        token: CONTENT_LINK_TOKEN,
        clientId: jasmine,
        contactId: id(611),
        message: 'خطة محتوى تشرين الأول جاهزة لمراجعتكم.',
        issuedAt: '2026-10-09T07:00:00.000Z',
        expiresAt: '2026-10-16T07:00:00.000Z',
        remindedAt: null,
        revokedAt: null,
        completedAt: null,
        createdById: layan.id,
        createdAt: '2026-10-09T07:00:00.000Z',
        items: [
          postItem(1682, 1608, 'عرض نهاية الأسبوع', 1674),
          postItem(1683, 1613, 'حلويات الجمعة', 1677),
        ],
      },
    ],
  };
}

type PostMediaRecord = Omit<PostMedia, 'task'> & { taskId: string | null };

interface ContentState {
  users: UserResponse[];
  clients: ClientRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  posts: PostRecord[];
  me: () => MeResponse;
  /** A task as the task mocks list it. */
  taskSummary: (task: TaskRecord) => Task;
  /** Rule 5: the post's own files, then the finals of its linked tasks. */
  media: (postId: string, taskIds: string[]) => PostMediaRecord[];
  /** The post's place in approval requests (F08 rules 20–25), kept by the approvals mocks. */
  approval: {
    pending: (post: PostRecord) => PostDetail['pendingApproval'];
    ready: (post: PostRecord) => boolean;
    /** Closes the pending item with the response, or withdraws it without one. */
    settle: (post: PostRecord, response: PostClientResponse | null) => void;
  };
}

/** The content API (F08) over the in-memory posts, with its scopes and workflow rules. */
function contentRoutes({
  users,
  clients,
  retainers,
  tasks,
  posts,
  me,
  taskSummary,
  media,
  approval,
}: ContentState) {
  let next = 1700;
  const now = () => TASKS_NOW.toISOString();
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const archivable = (userId: string) => ({
    ...person(userId),
    archived: users.find((u) => u.id === userId)?.status === 'archived',
  });
  const clientOf = (post: PostRecord) => clients.find((c) => c.id === post.clientId);
  const covers = (permission: string, post: PostRecord) =>
    holds(permission, 'all') ||
    (holds(permission, 'own_clients') && clientOf(post)?.accountManagerId === me().user.id);
  // Mirrors the API's scopes (spec F08, "Scopes on posts").
  const rights = (post: PostRecord): PostRights => ({
    edit: covers('content.manage', post),
    review: covers('content.review', post),
    client: covers('tasks.manage', post),
  });
  const linked = (post: PostRecord) =>
    tasks.filter((t) => t.postId === post.id && !t.archived && t.status !== 'cancelled');
  const mediaOf = (post: PostRecord) =>
    media(
      post.id,
      linked(post).map((t) => t.id),
    );
  const overdue = (post: PostRecord) => isPostOverdue(post, TASKS_NOW);
  const readOnly = (post: PostRecord) => post.archived || !!clientOf(post)?.archived;
  const lineOf = (lineId: string | null) => {
    for (const retainer of retainers) {
      for (const cycle of retainer.cycles) {
        const line = cycle.lines.find((l) => l.id === lineId);
        if (line) return { retainer, cycle, line };
      }
    }
    return undefined;
  };

  const summary = (post: PostRecord): Post => ({
    id: post.id,
    client: { id: post.clientId, name: clientOf(post)?.tradeName ?? '' },
    title: post.title,
    type: post.type,
    platforms: post.platforms,
    publishDate: post.publishDate,
    publishTime: post.publishTime,
    status: post.status,
    reviewStage: post.reviewStage,
    responsible: archivable(post.responsibleId),
    thumbnailVersionId: mediaOf(post).find((m) => m.previewStatus === 'ready')?.id ?? null,
    linkedTaskCount: linked(post).length,
    overdue: overdue(post),
  });
  const allowed = (post: PostRecord) =>
    readOnly(post)
      ? []
      : allowedPostTransitions(
          {
            status: post.status,
            reviewStage: post.reviewStage,
            needsClientApproval: post.needsClientApproval,
            hasWork: linked(post).length > 0 || mediaOf(post).length > 0,
          },
          rights(post),
        );
  const detail = (post: PostRecord): PostDetail => {
    const r = rights(post);
    const live = !readOnly(post);
    const counted = lineOf(post.cycleLineId);
    return {
      ...summary(post),
      client: {
        id: post.clientId,
        name: clientOf(post)?.tradeName ?? '',
        healthcare: clientOf(post)?.isHealthcare ?? false,
      },
      responsible: { ...archivable(post.responsibleId), inScope: true },
      caption: post.caption,
      hashtags: post.hashtags,
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      media: mediaOf(post).map(({ taskId, ...version }) => {
        const task = tasks.find((t) => t.id === taskId);
        return { ...version, task: task ? { id: task.id, title: task.title } : null };
      }),
      linkedTasks: linked(post).map((task): PostTask => {
        const listed = taskSummary(task);
        return {
          id: task.id,
          title: task.title,
          department: task.department,
          assignee: listed.assignee,
          status: task.status,
          cycleLine: listed.cycleLine,
        };
      }),
      cycleLine: counted
        ? {
            id: counted.line.id,
            kind: counted.line.kind,
            label: counted.line.label,
            retainer: { id: counted.retainer.id, name: counted.retainer.name },
          }
        : null,
      contentToken: MOCK_CONTENT_TOKEN,
      clearedReview: post.reviews.find((review) => review.id === post.clearedReviewId) ?? null,
      reviewHistory: post.reviews,
      clientResponses: post.responses,
      pendingApproval: approval.pending(post),
      scheduledAt: post.scheduledAt,
      publishedAt: post.publishedAt,
      publishedBy: post.publishedById ? person(post.publishedById) : null,
      publishedLinks: post.publishedLinks,
      cancelledAt: post.cancelledAt,
      cancelReason: post.cancelReason,
      createdBy: person(post.createdById),
      createdAt: post.createdAt,
      updatedAt: post.createdAt,
      archivedAt: post.archived ? now() : null,
      readOnly: !live,
      permissions: {
        canEdit: live && r.edit,
        canEditContent: live && r.edit && isPostContentEditable(post.status),
        canReview: live && r.review,
        canMedicalReview:
          live &&
          post.reviewStage === 'medical' &&
          holds('approvals.review_medical', 'all') &&
          post.responsibleId !== me().user.id,
        canSendForApproval: live && approval.ready(post),
        canRecordResponse: live && r.client && post.status === 'awaiting_client',
        canArchive: holds('content.review', 'all'),
      },
      allowedTransitions: allowed(post),
    };
  };

  /** Rule 11: a pass keeps the media, caption and hashtags it approved. */
  const recordReview = (
    post: PostRecord,
    stage: ReviewStage,
    outcome: PostReview['outcome'],
    note: string | null,
  ): PostReview => {
    const passed = outcome === 'passed';
    const review: PostReview = {
      id: id(next++),
      stage,
      outcome,
      note,
      reviewer: person(me().user.id),
      versions: passed
        ? mediaOf(post).map((m) => ({
            id: m.id,
            fileItemId: m.fileItemId,
            name: m.name,
            number: m.number,
          }))
        : [],
      caption: passed ? post.caption : null,
      hashtags: passed ? post.hashtags : null,
      type: passed ? post.type : null,
      platforms: passed ? post.platforms : [],
      publishDate: passed ? post.publishDate : null,
      publishTime: passed ? post.publishTime : null,
      createdAt: now(),
    };
    post.reviews.push(review);
    return review;
  };
  /** Rule 8: an unlinked task takes its own client approval back until it is approved. */
  const unlink = (task: TaskRecord) => {
    task.postId = null;
    if (task.status !== 'approved') task.needsClientApproval = true;
  };
  const matches = (post: PostRecord, q: URLSearchParams) => {
    const statuses = q.getAll('status');
    const responsible = q.get('responsible');
    return (
      (!q.get('clientId') || post.clientId === q.get('clientId')) &&
      (statuses.length === 0 || statuses.includes(post.status)) &&
      (!q.get('platform') || post.platforms.includes(q.get('platform') as PostPlatform)) &&
      (!q.get('type') || post.type === q.get('type')) &&
      (!responsible ||
        post.responsibleId === (responsible === 'me' ? me().user.id : responsible)) &&
      (!q.get('reviewStage') || post.reviewStage === q.get('reviewStage'))
    );
  };
  const byPublish = (a: PostRecord, b: PostRecord) =>
    `${a.publishDate}${a.publishTime ?? ''}`.localeCompare(
      `${b.publishDate}${b.publishTime ?? ''}`,
    );
  /** "Returned to me": in production, sent back by its latest review. */
  const returned = (post: PostRecord) =>
    post.status === 'in_production' && post.reviews.at(-1)?.outcome === 'returned';
  const inView: Record<PostView, (post: PostRecord) => boolean> = {
    publish_today: (post) =>
      post.responsibleId === me().user.id &&
      (post.status === 'approved' || post.status === 'scheduled') &&
      post.publishDate === PROJECTS_TODAY,
    overdue: (post) => post.responsibleId === me().user.id && overdue(post),
    returned: (post) => post.responsibleId === me().user.id && returned(post),
    to_review: (post) =>
      post.status === 'internal_review' && post.reviewStage === 'internal' && rights(post).review,
  };
  const live = () => posts.filter((post) => !post.archived && !clientOf(post)?.archived);

  // Answers a content request, or returns undefined to let the other mocks try.
  const handle = (
    route: Route,
    method: string,
    url: URL,
    request: Request,
  ): Promise<void> | undefined => {
    const path = url.pathname;
    const q = url.searchParams;
    const body = <T>() => request.postDataJSON() as T;

    if (path === '/api/me/content/summary') {
      const count = (view: PostView) => live().filter(inView[view]).length;
      const reviewer = holds('content.review', 'all') || holds('content.review', 'own_clients');
      const summaryBody: MyContentSummary = {
        publishToday: count('publish_today'),
        overdue: count('overdue'),
        returned: count('returned'),
        toReview: reviewer ? count('to_review') : null,
      };
      return json(route, summaryBody);
    }
    if (!path.startsWith('/api/content/')) return undefined;

    if (path === '/api/content/calendar') {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      const inRange = live().filter((post) => post.publishDate >= from && post.publishDate <= to);
      // The counts ignore the status filter, so every status keeps its number.
      const unfiltered = new URLSearchParams(q);
      unfiltered.delete('status');
      const calendar: ContentCalendar = {
        from,
        to,
        posts: inRange
          .filter((post) => matches(post, q))
          .sort(byPublish)
          .map(summary),
        counts: Object.fromEntries(
          POST_STATUSES.map((status) => [
            status,
            inRange.filter((post) => post.status === status && matches(post, unfiltered)).length,
          ]),
        ) as ContentCalendar['counts'],
      };
      return json(route, calendar);
    }
    if (path === '/api/content/posts' && method === 'GET') {
      const view = q.get('view') as PostView | null;
      const items = live()
        .filter((post) => matches(post, q) && (!view || inView[view](post)))
        .sort(byPublish)
        .map(summary);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/content/posts' && method === 'POST') {
      const input = body<CreatePost>();
      const client = clients.find((c) => c.id === input.clientId);
      if (!client) return fail(route, 404, null);
      const post = postRecord(next++, {
        clientId: input.clientId,
        title: input.title,
        type: input.type,
        platforms: input.platforms,
        caption: input.caption ?? null,
        hashtags: input.hashtags ?? null,
        notes: input.notes ?? null,
        publishDate: input.publishDate,
        publishTime: input.publishTime ?? null,
        needsClientApproval: input.needsClientApproval,
        responsibleId: input.responsibleId ?? me().user.id,
        cycleLineId: input.cycleLineId,
        createdById: me().user.id,
        createdAt: now(),
      });
      if (!rights(post).edit) return fail(route, 403, null);
      if (client.status === 'ended') return fail(route, 409, 'CLIENT_ENDED');
      if (post.publishDate < PROJECTS_TODAY) return fail(route, 400, 'INVALID_DATES');
      posts.push(post);
      return json(route, detail(post), 201);
    }

    const match = path.match(/^\/api\/content\/posts\/([^/]+)(?:\/(.+))?$/);
    const post = posts.find((p) => p.id === match?.[1]);
    if (!match || !post) return fail(route, 404, null);
    const action = match[2];
    const r = rights(post);

    if (!action && method === 'GET') return json(route, detail(post));
    if (action !== 'restore' && readOnly(post)) return fail(route, 409, 'POST_ARCHIVED');
    if (!action && method === 'PATCH') {
      if (!r.edit) return fail(route, 403, null);
      const input = body<UpdatePost>();
      const content = input.caption !== undefined || input.hashtags !== undefined || input.type;
      if (content && !isPostContentEditable(post.status)) return fail(route, 409, 'POST_LOCKED');
      if (input.cycleLineId && linked(post).some((t) => t.cycleLineId)) {
        return fail(route, 409, 'POST_COUNTED_BY_TASK');
      }
      Object.assign(post, input);
      return json(route, detail(post));
    }
    if (action === 'status') {
      const input = body<PostStatusChange>();
      const move = postMove(post.status, input.to);
      if (!move || !allowed(post).includes(input.to)) {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      const tasksReady = linked(post).every((t) => t.status === 'approved');
      const stage = post.reviewStage;
      const waiting = post.status === 'awaiting_client';
      let response: PostClientResponse | null = null;
      post.reviewStage = null;
      switch (move) {
        case 'submit':
          if (!post.caption && mediaOf(post).length === 0) {
            return fail(route, 409, 'NOTHING_TO_APPROVE');
          }
          if (!tasksReady) return fail(route, 409, 'POST_TASKS_NOT_READY');
          post.reviewStage = 'internal';
          break;
        case 'send_to_client':
        case 'approve': {
          const review = recordReview(post, 'internal', 'passed', null);
          // Rule 13: a healthcare client's post waits for the medical review first.
          if (clientOf(post)?.isHealthcare) {
            post.reviewStage = 'medical';
            return json(route, detail(post));
          }
          post.clearedReviewId = review.id;
          break;
        }
        case 'return':
          recordReview(post, stage ?? 'internal', 'returned', input.note ?? null);
          break;
        case 'withdraw':
          post.reviewStage = 'internal';
          break;
        case 'client_approved':
        case 'client_changes': {
          const contact = clientOf(post)?.contacts.find((c) => c.id === input.contactId);
          if (!contact) return fail(route, 400, 'UNKNOWN_CONTACT');
          response = {
            id: id(next++),
            decision: move === 'client_approved' ? 'approved' : 'changes_requested',
            channel: 'manual',
            contact: { id: contact.id, name: contact.name, archived: contact.archived },
            note: input.note ?? null,
            versions:
              post.reviews.find((review) => review.id === post.clearedReviewId)?.versions ?? [],
            recordedBy: person(me().user.id),
            createdAt: now(),
          };
          post.responses.push(response);
          break;
        }
        case 'schedule':
          if (!post.publishTime) return fail(route, 409, 'PUBLISH_TIME_REQUIRED');
          post.scheduledAt = now();
          break;
        case 'unschedule':
          post.scheduledAt = null;
          break;
        case 'publish':
          if (!tasksReady) return fail(route, 409, 'POST_TASKS_NOT_READY');
          post.publishedAt = input.publishedAt ?? now();
          post.publishedById = me().user.id;
          post.publishedLinks = input.publishedLinks ?? [];
          // Rule 18: publishing delivers the linked tasks.
          for (const task of linked(post)) {
            task.status = 'delivered';
            task.deliveredAt = now();
          }
          break;
        case 'cancel':
          post.cancelledAt = now();
          post.cancelReason = input.reason ?? null;
          // Rule 19: the linked tasks are kept for another post.
          for (const task of linked(post)) unlink(task);
          break;
        case 'reopen':
          post.cancelledAt = null;
          post.cancelReason = null;
          break;
        case 'start':
        case 'reopen_content':
          break;
      }
      post.status = input.to;
      // Rules 24 and 25: leaving the client closes or withdraws the pending item.
      if (waiting) approval.settle(post, response);
      return json(route, detail(post));
    }
    if (action === 'medical-review') {
      const input = body<MedicalReview>();
      if (post.reviewStage !== 'medical') return fail(route, 409, 'INVALID_TRANSITION');
      if (!holds('approvals.review_medical', 'all')) return fail(route, 403, null);
      if (post.responsibleId === me().user.id) return fail(route, 403, 'SELF_REVIEW');
      post.reviewStage = null;
      if (input.decision === 'return') {
        recordReview(post, 'medical', 'returned', input.note ?? null);
        post.status = 'in_production';
        return json(route, detail(post));
      }
      const review = recordReview(post, 'medical', 'passed', input.note ?? null);
      post.clearedReviewId = review.id;
      post.status = post.needsClientApproval ? 'awaiting_client' : 'approved';
      return json(route, detail(post));
    }
    if (action === 'duplicate') {
      if (!r.edit) return fail(route, 403, null);
      const copy = postRecord(next++, {
        clientId: post.clientId,
        title: post.title,
        type: post.type,
        platforms: post.platforms,
        caption: post.caption,
        hashtags: post.hashtags,
        notes: post.notes,
        publishDate: body<DuplicatePost>().publishDate ?? post.publishDate,
        publishTime: post.publishTime,
        needsClientApproval: post.needsClientApproval,
        responsibleId: me().user.id,
        createdById: me().user.id,
        createdAt: now(),
      });
      posts.push(copy);
      return json(route, detail(copy), 201);
    }
    if (action === 'archive' || action === 'restore') {
      if (!holds('content.review', 'all')) return fail(route, 403, null);
      if (action === 'archive' && post.status === 'awaiting_client') approval.settle(post, null);
      post.archived = action === 'archive';
      return action === 'archive' ? route.fulfill({ status: 204 }) : json(route, detail(post));
    }

    // Linked tasks (rules 6–9, 12).
    if (!r.edit) return fail(route, 403, null);
    if (action === 'linkable-tasks') {
      const search = q.get('q');
      const cycle = retainers
        .filter((retainer) => retainer.clientId === post.clientId)
        .flatMap((retainer) => retainer.cycles)
        .find((c) => c.periodStart <= post.publishDate && post.publishDate <= c.periodEnd);
      const items = tasks
        .filter(
          (t) =>
            !t.archived &&
            t.clientId === post.clientId &&
            !t.postId &&
            t.status !== 'delivered' &&
            t.status !== 'cancelled' &&
            t.status !== 'awaiting_client' &&
            t.reviewStage !== 'medical' &&
            (!search || t.title.includes(search)) &&
            (!q.get('department') || t.department === q.get('department')),
        )
        .map((t): LinkableTask => ({ ...taskSummary(t), inPublishCycle: t.cycleId === cycle?.id }))
        .sort((a, b) => Number(b.inPublishCycle) - Number(a.inPublishCycle));
      return json(route, { items: items.slice(0, POST_LIMITS.linkableTasks) });
    }
    if (action === 'tasks' && method === 'POST') {
      if (!isPostContentEditable(post.status)) return fail(route, 409, 'POST_LOCKED');
      const input = body<CreatePostTask>();
      tasks.push(
        taskRecord(next++, {
          title: input.title ?? postTaskTitle(post.type, post.title),
          brief: input.brief ?? post.notes,
          department: input.department,
          dueDate: input.dueDate ?? postTaskDueDate(post.publishDate, PROJECTS_TODAY),
          clientId: post.clientId,
          cycleLineId: input.cycleLineId,
          createdById: me().user.id,
          createdAt: now(),
          postId: post.id,
        }),
      );
      if (post.status === 'idea') post.status = 'in_production';
      return json(route, detail(post), 201);
    }
    const taskMatch = action?.match(/^tasks\/([^/]+)(\/return)?$/);
    const task = tasks.find((t) => t.id === taskMatch?.[1]);
    if (!taskMatch || !task) return fail(route, 404, null);
    if (taskMatch[2]) {
      // Rule 12: only an approved task of a post in production goes back.
      if (post.status !== 'in_production' || task.status !== 'approved') {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      task.status = 'revisions';
      return json(route, detail(post));
    }
    if (!isPostContentEditable(post.status)) return fail(route, 409, 'POST_LOCKED');
    if (method === 'PUT') {
      if (task.postId && task.postId !== post.id) return fail(route, 409, 'TASK_ALREADY_LINKED');
      if (task.clientId !== post.clientId) return fail(route, 409, 'TASK_NOT_LINKABLE');
      if (linked(post).length >= POST_LIMITS.tasks) return fail(route, 409, 'LIMIT_REACHED');
      if (post.cycleLineId && task.cycleLineId) return fail(route, 409, 'POST_COUNTED_BY_TASK');
      task.postId = post.id;
      task.needsClientApproval = false;
      if (post.status === 'idea') post.status = 'in_production';
      return json(route, detail(post));
    }
    if (method === 'DELETE') {
      unlink(task);
      return json(route, detail(post));
    }
    return fail(route, 404, null);
  };
  return Object.assign(handle, { summary });
}

// Work templates (F07).

interface TemplateRecord {
  id: string;
  name: string;
  kind: TemplateKind;
  description: string | null;
  stages: TemplateDetail['stages'];
  steps: TemplateStep[];
  assignees: TemplateDocument['assignees'];
  linkedRetainerIds: string[];
  archived: boolean;
  updatedAt: string;
}

type StepSeed = Partial<TemplateStep> & Pick<TemplateStep, 'title' | 'department'>;

// Files (F10)

type FileVersionRecord = Omit<FileVersion, 'canRemove' | 'type'>;

interface FileRecord {
  id: string;
  ownerType: FileOwnerType;
  ownerId: string;
  role: FileRole;
  name: string;
  brandKind: BrandFileKind | null;
  confidential: boolean;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
  versions: FileVersionRecord[];
}

type Uploader = { id: string; name: string };

const uploadVersion = (
  n: number,
  number: number,
  file: { name: string; mimeType: string; sizeBytes: number },
  uploadedBy: Uploader,
  createdAt: string,
  fields: Partial<FileVersionRecord> = {},
): FileVersionRecord => ({
  id: id(n),
  number,
  kind: 'upload',
  originalName: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  previewStatus: file.mimeType.startsWith('image/') ? 'ready' : 'none',
  width: null,
  height: null,
  url: null,
  linkLabel: null,
  note: null,
  uploadedBy,
  isFinal: false,
  finalSource: null,
  finalMarkedBy: null,
  finalMarkedAt: null,
  createdAt,
  archivedAt: null,
  ...fields,
});

const linkVersion = (
  n: number,
  number: number,
  link: { url: string; label: string | null },
  uploadedBy: Uploader,
  createdAt: string,
  note: string | null = null,
): FileVersionRecord => ({
  ...uploadVersion(n, number, { name: '', mimeType: '', sizeBytes: 0 }, uploadedBy, createdAt),
  kind: 'link',
  originalName: null,
  mimeType: null,
  sizeBytes: null,
  previewStatus: 'none',
  url: link.url,
  linkLabel: link.label,
  note,
});

/**
 * Deliverables and references on the autumn menu task, a delivered task with its final, and
 * Jasmine's brand files and documents (one confidential), with a project and a retainer document.
 */
export function filesSeed(): FileRecord[] {
  const layan = { id: id(3), name: 'ليان الأحمد' };
  const sara = { id: id(1), name: 'سارة الخطيب' };
  const png = (name: string, sizeBytes: number) => ({ name, mimeType: 'image/png', sizeBytes });
  const pdf = (name: string, sizeBytes: number) => ({
    name,
    mimeType: 'application/pdf',
    sizeBytes,
  });
  const file = (
    n: number,
    owner: { type: FileOwnerType; id: string },
    role: FileRole,
    name: string,
    versions: FileVersionRecord[],
    fields: Partial<FileRecord> = {},
  ): FileRecord => ({
    id: id(n),
    ownerType: owner.type,
    ownerId: owner.id,
    role,
    name,
    brandKind: null,
    confidential: false,
    createdById: versions.at(-1)?.uploadedBy.id ?? layan.id,
    createdAt: versions.at(-1)?.createdAt ?? '2026-10-06T08:00:00.000Z',
    archivedAt: null,
    versions,
    ...fields,
  });
  const autumnMenu = { type: 'task', id: id(1001) } as const;
  const octoberCover = { type: 'task', id: id(1007) } as const;
  const jasmine = { type: 'client', id: id(601) } as const;
  return [
    file(1301, autumnMenu, 'deliverable', 'غلاف المنيو', [
      uploadVersion(
        1351,
        2,
        png('menu-cover-v2.png', 2_726_297),
        layan,
        '2026-10-08T11:20:00.000Z',
        {
          note: 'ألوان الهوية الجديدة وصورة الطبق الموسمي.',
        },
      ),
      uploadVersion(1352, 1, png('menu-cover.png', 2_516_582), layan, '2026-10-07T09:10:00.000Z'),
    ]),
    file(1302, autumnMenu, 'deliverable', 'فيديو المنيو', [
      linkVersion(
        1353,
        1,
        {
          url: 'https://drive.google.com/file/d/autumn-menu-video',
          label: 'النسخة الأولى على Drive',
        },
        layan,
        '2026-10-08T13:00:00.000Z',
      ),
    ]),
    file(1303, autumnMenu, 'reference', 'صور الأطباق', [
      uploadVersion(
        1354,
        1,
        { name: 'dishes.jpg', mimeType: 'image/jpeg', sizeBytes: 4_404_019 },
        sara,
        '2026-10-05T10:00:00.000Z',
      ),
    ]),
    file(1304, autumnMenu, 'reference', 'دليل الهوية', [
      uploadVersion(1355, 1, pdf('brand-guide.pdf', 1_153_434), sara, '2026-10-05T10:05:00.000Z'),
    ]),
    file(1305, octoberCover, 'deliverable', 'غلاف أكتوبر', [
      uploadVersion(
        1356,
        2,
        png('october-cover-v2.png', 1_887_437),
        layan,
        '2026-10-03T12:00:00.000Z',
        {
          isFinal: true,
          finalSource: 'auto',
          finalMarkedAt: '2026-10-04T09:00:00.000Z',
        },
      ),
      uploadVersion(
        1357,
        1,
        png('october-cover.png', 1_782_579),
        layan,
        '2026-10-02T12:00:00.000Z',
      ),
    ]),
    file(1306, octoberCover, 'deliverable', 'فيديو أكتوبر', [
      {
        ...linkVersion(
          1358,
          1,
          { url: 'https://drive.google.com/file/d/october-reel', label: 'ريل أكتوبر' },
          layan,
          '2026-10-03T13:00:00.000Z',
        ),
        isFinal: true,
        finalSource: 'auto',
        finalMarkedAt: '2026-10-04T09:00:00.000Z',
      },
    ]),
    // The awareness post: v1 passed internal review, v2 was added after it (F09 edge case 3).
    file(1330, { type: 'task', id: id(1008) }, 'deliverable', 'منشور التوعية', [
      uploadVersion(
        1382,
        2,
        png('dental-post-v2.png', 1_310_720),
        { id: id(5), name: 'نور السيد' },
        '2026-10-09T08:00:00.000Z',
        { note: 'صورة أوضح للفرشاة.' },
      ),
      uploadVersion(
        1381,
        1,
        png('dental-post.png', 1_258_291),
        { id: id(5), name: 'نور السيد' },
        '2026-10-07T12:00:00.000Z',
      ),
    ]),
    file(
      1310,
      jasmine,
      'brand',
      'شعار الياسمين',
      [
        uploadVersion(
          1360,
          2,
          png('jasmine-logo-2026.png', 312_000),
          sara,
          '2026-09-20T09:00:00.000Z',
          { note: 'الشعار بعد تحديث الهوية.' },
        ),
        uploadVersion(1361, 1, png('jasmine-logo.png', 298_000), sara, '2025-03-01T09:00:00.000Z'),
      ],
      { brandKind: 'logo' },
    ),
    file(
      1311,
      jasmine,
      'brand',
      'دليل الهوية 2026',
      [uploadVersion(1362, 1, pdf('brand-book.pdf', 8_600_000), sara, '2026-09-21T09:00:00.000Z')],
      { brandKind: 'guidelines' },
    ),
    file(
      1320,
      jasmine,
      'document',
      'عقد الخدمات 2026',
      [uploadVersion(1370, 1, pdf('contract-2026.pdf', 640_000), sara, '2026-02-25T09:00:00.000Z')],
      { confidential: true },
    ),
    file(1321, jasmine, 'document', 'عرض السعر', [
      uploadVersion(1371, 1, pdf('quote.pdf', 210_000), layan, '2026-02-10T09:00:00.000Z'),
    ]),
    file(1322, { type: 'project', id: id(801) }, 'document', 'محضر انطلاق المشروع', [
      uploadVersion(1372, 1, pdf('kickoff.pdf', 180_000), layan, '2026-09-02T09:00:00.000Z'),
    ]),
    file(1323, { type: 'retainer', id: id(901) }, 'document', 'ملحق العقد الشهري', [
      uploadVersion(1373, 1, pdf('annex.pdf', 150_000), sara, '2026-03-01T09:00:00.000Z'),
    ]),
  ];
}

/** A stand-in image for thumbnails, previews and image content. */
const MOCK_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1f4d3a"/><path d="M0 300 L160 80 L230 180 L280 120 L400 300 Z" fill="#d8c3a0"/><circle cx="320" cy="70" r="30" fill="#f4efe6"/></svg>';

/** A one-page PDF for the preview dialog. */
const MOCK_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 24 Tf 72 760 Td (Brand guide) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n');

/** The files disk in the usage line (rule 19). */
const MOCK_FREE_BYTES = 150 * 1024 ** 3;

type FileSourceBody = { uploadId: string } | { url: string; label?: string | null };

interface FileState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  posts: PostRecord[];
  files: FileRecord[];
  me: () => MeResponse;
  rights: (task: TaskRecord) => TaskRights;
}

/** An owner as the API's registered policy answers it (spec F10, "F10 actions"). */
interface OwnerAccess {
  clientId: string | null;
  label: string;
  /** Task workers and manage scope. */
  addDeliverable: boolean;
  manage: boolean;
  /** Brand files and documents. */
  manageDocuments: boolean;
  confidentialReader: boolean;
  scopeAll: boolean;
  writable: boolean;
  task?: TaskRecord;
  post?: PostRecord;
}

/** The files API (F10), with the owner rights of the task, client, project, retainer and post mocks. */
function fileRoutes({
  users,
  clients,
  projects,
  retainers,
  tasks,
  posts,
  files,
  me,
  rights,
}: FileState) {
  const uploads = new Map<string, { name: string; mimeType: string; sizeBytes: number }>();
  let next = 1400;
  const now = () => TASKS_NOW.toISOString();
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const own = (clientId: string | null) =>
    clients.find((c) => c.id === clientId)?.accountManagerId === me().user.id;
  const covers = (permission: string, clientId: string | null) =>
    holds(permission, 'all') || (holds(permission, 'own_clients') && own(clientId));
  // Rule 15: the client's managers and Finance read its confidential documents.
  const reader = (clientId: string | null) =>
    covers('clients.manage', clientId) || covers('invoices.read', clientId);

  const access = (type: FileOwnerType, ownerId: string): OwnerAccess | undefined => {
    if (type === 'task') {
      const task = tasks.find((t) => t.id === ownerId);
      if (!task) return undefined;
      const r = rights(task);
      return {
        clientId: task.clientId,
        label: task.title,
        addDeliverable: r.work || r.manage,
        manage: r.manage,
        manageDocuments: false,
        confidentialReader: false,
        scopeAll: holds('tasks.manage', 'all'),
        writable: !task.archived && task.status !== 'delivered' && task.status !== 'cancelled',
        task,
      };
    }
    if (type === 'post') {
      // F08: edit scope adds, versions and removes while the post is an idea or in production.
      const post = posts.find((p) => p.id === ownerId);
      if (!post) return undefined;
      const edits = covers('content.manage', post.clientId);
      return {
        clientId: post.clientId,
        label: post.title,
        addDeliverable: edits,
        manage: edits,
        manageDocuments: false,
        confidentialReader: false,
        scopeAll: holds('content.review', 'all'),
        writable: !post.archived && isPostContentEditable(post.status),
        post,
      };
    }
    if (type === 'client') {
      const client = clients.find((c) => c.id === ownerId);
      if (!client) return undefined;
      return {
        clientId: client.id,
        label: client.tradeName,
        addDeliverable: false,
        manage: false,
        manageDocuments: covers('clients.manage', client.id),
        confidentialReader: reader(client.id),
        scopeAll: holds('clients.manage', 'all'),
        writable: !client.archived,
      };
    }
    const project = type === 'project' ? projects.find((p) => p.id === ownerId) : undefined;
    const retainer = type === 'retainer' ? retainers.find((r) => r.id === ownerId) : undefined;
    const owner = project ?? retainer;
    if (!owner) return undefined;
    return {
      clientId: owner.clientId,
      label: owner.name,
      addDeliverable: false,
      manage: false,
      manageDocuments:
        covers('projects.manage', owner.clientId) || project?.projectManagerId === me().user.id,
      confidentialReader: reader(owner.clientId),
      scopeAll: holds('projects.manage', 'all'),
      writable: !owner.archived,
    };
  };
  const accessOf = (record: FileRecord) => access(record.ownerType, record.ownerId) as OwnerAccess;
  /** Confidential documents do not exist for anyone but their client's readers. */
  const visible = (record: FileRecord) =>
    !record.confidential || accessOf(record).confidentialReader;

  // Rules 5–8 and the actions table, as the API's owner policies answer them.
  // Removed versions come only to scope-all holders who asked for them (`includeArchived`).
  const itemOf = (record: FileRecord, withRemoved = false): FileItem => {
    const o = accessOf(record);
    const meId = me().user.id;
    const live = o.writable && !record.archivedAt;
    const deliverable = record.role === 'deliverable';
    // Tasks and posts hold work files; clients, projects and retainers hold documents.
    const onTask = record.ownerType === 'task' || record.ownerType === 'post';
    const changes = onTask ? deliverable && o.addDeliverable : o.manageDocuments;
    return {
      id: record.id,
      ownerType: record.ownerType,
      ownerId: record.ownerId,
      clientId: o.clientId,
      role: record.role,
      name: record.name,
      brandKind: record.brandKind,
      confidential: record.confidential,
      createdBy: person(record.createdById),
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
      archivedAt: record.archivedAt,
      versions: record.versions
        .filter((v) => (withRemoved && o.scopeAll) || !v.archivedAt)
        .map((v) => ({
          ...v,
          type: fileTypeOf(v.kind, v.mimeType),
          canRemove: onTask
            ? deliverable && (o.manage || (o.addDeliverable && v.uploadedBy.id === meId))
            : o.manageDocuments,
        })),
      permissions: {
        canAddVersion: live && changes,
        canRename: live && changes,
        canRemove: onTask
          ? live &&
            (o.manage || (record.createdById === meId && (!deliverable || o.addDeliverable)))
          : live && o.manageDocuments,
        canSetFinal:
          record.ownerType === 'task' &&
          deliverable &&
          !record.archivedAt &&
          !o.task?.archived &&
          o.task?.status !== 'cancelled' &&
          o.manage,
        canSetConfidential:
          live && record.role === 'document' && o.manageDocuments && o.confidentialReader,
        canRestore: o.scopeAll && o.writable,
      },
    };
  };
  const findVersion = (versionId: string) => {
    for (const record of files) {
      const version = record.versions.find((v) => v.id === versionId);
      if (version && visible(record)) return { record, version };
    }
    return undefined;
  };
  const versionFrom = (
    source: FileSourceBody,
    number: number,
    note: string | null,
  ): FileVersionRecord | null => {
    const uploader = person(me().user.id);
    if ('url' in source) {
      return linkVersion(
        next++,
        number,
        { url: source.url, label: source.label ?? null },
        uploader,
        now(),
        note,
      );
    }
    const upload = uploads.get(source.uploadId);
    if (!upload) return null;
    uploads.delete(source.uploadId);
    return { ...uploadVersion(next++, number, upload, uploader, now()), note };
  };
  const page = <T>(items: T[], url: URL) => {
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 50);
    return {
      items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      total: items.length,
      page: pageNumber,
      pageSize,
    };
  };
  const clientFiles = (clientId: string) => files.filter((f) => accessOf(f).clientId === clientId);
  const bytes = (records: FileRecord[]) =>
    records.flatMap((f) => f.versions).reduce((sum, v) => sum + (v.sizeBytes ?? 0), 0);

  /** The bytes of a version: a stand-in image, or the PDF for a PDF's content. */
  const serve = (route: Route, version: FileVersionRecord, part: string) => {
    if (version.kind === 'link') return fail(route, 404, null);
    const pdf = part === 'content' && version.mimeType === 'application/pdf';
    return route.fulfill({
      status: 200,
      contentType: pdf ? 'application/pdf' : 'image/svg+xml',
      body: pdf ? MOCK_PDF : MOCK_IMAGE,
    });
  };
  /** A version whatever the caller may see: approval snapshots are checked by their request. */
  const anyVersion = (versionId: string) => {
    for (const record of files) {
      const version = record.versions.find((v) => v.id === versionId);
      if (version) return { record, version };
    }
    return undefined;
  };

  const handle = (
    route: Route,
    method: string,
    url: URL,
    request: Request,
  ): Promise<void> | undefined => {
    const path = url.pathname;
    if (!path.startsWith('/api/files/')) return undefined;
    const body = <T>() => request.postDataJSON() as T;
    const q = url.searchParams;

    if (path === '/api/files/uploads' && method === 'POST') {
      // Multipart: the file name is in the part's header, as UTF-8 bytes.
      const raw = request.postDataBuffer()?.toString('latin1') ?? '';
      const name = Buffer.from(raw.match(/filename="([^"]*)"/)?.[1] ?? 'file', 'latin1').toString(
        'utf8',
      );
      const extension = name.split('.').pop()?.toLowerCase() ?? '';
      const types: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        pdf: 'application/pdf',
        mp4: 'video/mp4',
      };
      const upload: FileUpload = {
        uploadId: id(next++),
        name,
        sizeBytes: 1_048_576,
        mimeType: types[extension] ?? 'application/octet-stream',
      };
      uploads.set(upload.uploadId, { ...upload });
      return json(route, upload, 201);
    }
    if (path === '/api/files/items' && method === 'GET') {
      const type = q.get('ownerType') as FileOwnerType;
      const ownerId = q.get('ownerId') ?? '';
      const o = access(type, ownerId);
      if (!o) return fail(route, 404, null);
      const withRemoved = q.get('includeArchived') === 'true' && o.scopeAll;
      const items = files
        .filter(
          (f) =>
            f.ownerType === type &&
            f.ownerId === ownerId &&
            (!q.get('role') || f.role === q.get('role')) &&
            (withRemoved || !f.archivedAt) &&
            visible(f),
        )
        .reverse()
        .map((f) => itemOf(f, withRemoved));
      return json(route, {
        items,
        rights: {
          canAddDeliverable: o.writable && o.addDeliverable,
          canAddReference: o.writable && type === 'task',
          canManageDocuments: o.writable && o.manageDocuments,
          canSetConfidential: o.writable && o.manageDocuments && o.confidentialReader,
          canSeeRemoved: o.scopeAll,
        },
      });
    }
    if (path === '/api/files/items' && method === 'POST') {
      const input = body<{
        ownerType: FileOwnerType;
        ownerId: string;
        role: FileRole;
        name?: string;
        brandKind?: BrandFileKind;
        confidential?: boolean;
        note?: string | null;
        source: FileSourceBody;
      }>();
      const o = access(input.ownerType, input.ownerId);
      if (!o) return fail(route, 404, null);
      if (input.role === 'deliverable' && !o.addDeliverable) return fail(route, 403, null);
      if ((input.role === 'brand' || input.role === 'document') && !o.manageDocuments) {
        return fail(route, 403, null);
      }
      if (input.confidential && !o.confidentialReader) {
        return fail(route, 403, 'NOT_CONFIDENTIAL_READER');
      }
      if (!o.writable) {
        return fail(
          route,
          409,
          o.task ? 'TASK_CLOSED' : o.post ? 'POST_LOCKED' : 'CLIENT_ARCHIVED',
        );
      }
      const version = versionFrom(input.source, 1, input.note ?? null);
      if (!version) return fail(route, 400, 'UPLOAD_NOT_FOUND');
      const name =
        input.name ??
        (version.originalName?.replace(/\.[^.]+$/, '') || version.linkLabel || 'File');
      const taken = files.some(
        (f) =>
          f.ownerId === input.ownerId && f.role === input.role && !f.archivedAt && f.name === name,
      );
      if (taken && input.role !== 'reference') return fail(route, 409, 'FILE_NAME_TAKEN');
      const record: FileRecord = {
        id: id(next++),
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        role: input.role,
        name,
        brandKind: input.brandKind ?? null,
        confidential: input.confidential ?? false,
        createdById: me().user.id,
        createdAt: now(),
        archivedAt: null,
        versions: [version],
      };
      files.push(record);
      return json(route, itemOf(record), 201);
    }
    if (path === '/api/files/library' && method === 'GET') {
      const clientId = q.get('clientId');
      const search = q.get('q');
      const entries = files
        .filter((f) => {
          const task = accessOf(f).task;
          return (
            f.role === 'deliverable' &&
            !f.archivedAt &&
            task?.clientId === clientId &&
            !task?.archived &&
            task?.status !== 'cancelled'
          );
        })
        .flatMap((f) =>
          f.versions
            .filter((v) => v.isFinal && !v.archivedAt)
            .map((v) => ({ record: f, version: v, task: accessOf(f).task as TaskRecord })),
        )
        .filter(
          ({ record, version, task }) =>
            (!q.get('type') || fileTypeOf(version.kind, version.mimeType) === q.get('type')) &&
            (!q.get('month') || version.finalMarkedAt?.startsWith(q.get('month') as string)) &&
            (!search || record.name.includes(search) || task.title.includes(search)),
        )
        .sort((a, b) =>
          (b.version.finalMarkedAt ?? '').localeCompare(a.version.finalMarkedAt ?? ''),
        )
        .map(({ record, version, task }) => ({
          itemId: record.id,
          itemName: record.name,
          task: { id: task.id, title: task.title },
          version: {
            ...version,
            type: fileTypeOf(version.kind, version.mimeType),
            canRemove: false,
          },
        }));
      return json(route, page(entries, url));
    }
    if (path === '/api/files/documents' && method === 'GET') {
      const clientId = q.get('clientId');
      const documents = files
        .filter(
          (f) =>
            f.role === 'document' &&
            !f.archivedAt &&
            accessOf(f).clientId === clientId &&
            visible(f),
        )
        .reverse()
        .map((f) => ({
          ...itemOf(f),
          owner: { type: f.ownerType, id: f.ownerId, label: accessOf(f).label },
        }));
      return json(route, page(documents, url));
    }
    if (path === '/api/files/usage' && method === 'GET') {
      if (!holds('clients.manage', 'all')) return fail(route, 403, null);
      const clientId = q.get('clientId');
      return json(route, {
        clientBytes: clientId ? bytes(clientFiles(clientId)) : null,
        totalBytes: bytes(files),
        freeBytes: MOCK_FREE_BYTES,
      });
    }
    const itemMatch = path.match(/^\/api\/files\/items\/([^/]+)(?:\/(.+))?$/);
    if (itemMatch) {
      const record = files.find((f) => f.id === itemMatch[1] && visible(f));
      if (!record) return fail(route, 404, null);
      const action = itemMatch[2];
      if (action === 'versions') {
        const input = body<{ note?: string | null; source: FileSourceBody }>();
        const number = Math.max(...record.versions.map((v) => v.number)) + 1;
        const version = versionFrom(input.source, number, input.note ?? null);
        if (!version) return fail(route, 400, 'UPLOAD_NOT_FOUND');
        record.versions.unshift(version);
        return json(route, itemOf(record));
      }
      if (action === 'archive') {
        record.archivedAt = now();
        return route.fulfill({ status: 204 });
      }
      if (action === 'restore') {
        record.archivedAt = null;
        return json(route, itemOf(record));
      }
      if (!action && method === 'PATCH') {
        const input = body<{ name?: string; confidential?: boolean }>();
        if (input.confidential !== undefined) {
          if (!accessOf(record).confidentialReader) {
            return fail(route, 403, 'NOT_CONFIDENTIAL_READER');
          }
          record.confidential = input.confidential;
        }
        record.name = input.name ?? record.name;
        return json(route, itemOf(record));
      }
    }
    const versionMatch = path.match(/^\/api\/files\/versions\/([^/]+)\/(.+)$/);
    if (versionMatch) {
      const found = findVersion(versionMatch[1] ?? '');
      if (!found) return fail(route, 404, null);
      const { record, version } = found;
      const action = versionMatch[2];
      if (action === 'content' || action === 'thumbnail' || action === 'preview') {
        return serve(route, version, action);
      }
      if (action === 'archive') {
        if (version.isFinal) return fail(route, 409, 'VERSION_FINAL');
        if (record.versions.filter((v) => !v.archivedAt).length === 1) {
          return fail(route, 409, 'LAST_VERSION');
        }
        version.archivedAt = now();
        return json(route, itemOf(record));
      }
      if (action === 'restore') {
        version.archivedAt = null;
        return json(route, itemOf(record));
      }
      if (action === 'final') {
        const task = accessOf(record).task as TaskRecord;
        const { final } = body<{ final: boolean }>();
        if (final && task.status !== 'approved' && task.status !== 'delivered') {
          return fail(route, 409, 'TASK_NOT_APPROVED');
        }
        for (const v of record.versions) {
          if (!v.isFinal && v.id !== version.id) continue;
          const marked = final && v.id === version.id;
          v.isFinal = marked;
          v.finalSource = marked ? 'manual' : null;
          v.finalMarkedBy = marked ? person(me().user.id) : null;
          v.finalMarkedAt = marked ? now() : null;
        }
        return json(route, itemOf(record));
      }
    }
    return undefined;
  };

  const count = (taskId: string, role: FileRole) =>
    files.filter((f) => f.ownerId === taskId && f.role === role && !f.archivedAt).length;
  return {
    handle,
    counts: (taskId: string) => ({
      deliverables: count(taskId, 'deliverable'),
      references: count(taskId, 'reference'),
    }),
    /** The latest version of each deliverable: what a review pass approves (F09 rule 2). */
    snapshot: (taskId: string) =>
      files
        .filter((f) => f.ownerId === taskId && f.role === 'deliverable' && !f.archivedAt)
        .flatMap((f) => {
          const latest = f.versions.find((v) => !v.archivedAt);
          return latest
            ? [{ id: latest.id, fileItemId: f.id, name: f.name, number: latest.number }]
            : [];
        }),
    /** F08 rule 5: the latest version of each file of the post, then its linked tasks' finals. */
    media: (postId: string, taskIds: string[]) => {
      const shape = (f: FileRecord, v: FileVersionRecord, taskId: string | null) => ({
        id: v.id,
        fileItemId: f.id,
        name: f.name,
        number: v.number,
        kind: v.kind,
        type: fileTypeOf(v.kind, v.mimeType),
        previewStatus: v.previewStatus,
        taskId,
      });
      const own = files
        .filter((f) => f.ownerType === 'post' && f.ownerId === postId && !f.archivedAt)
        .flatMap((f) => {
          const latest = f.versions.find((v) => !v.archivedAt);
          return latest ? [shape(f, latest, null)] : [];
        });
      const produced = taskIds.flatMap((taskId) =>
        files
          .filter(
            (f) =>
              f.ownerType === 'task' &&
              f.ownerId === taskId &&
              f.role === 'deliverable' &&
              !f.archivedAt,
          )
          .flatMap((f) => {
            const final = f.versions.find((v) => v.isFinal && !v.archivedAt);
            return final ? [shape(f, final, taskId)] : [];
          }),
      );
      return [...own, ...produced];
    },
    /** A snapshot version as the request page shows it (F09). */
    sent: (versionId: string): ApprovalItem['versions'][number] | undefined => {
      const found = anyVersion(versionId);
      return found && !found.version.archivedAt
        ? {
            id: found.version.id,
            fileItemId: found.record.id,
            name: found.record.name,
            number: found.version.number,
            kind: found.version.kind,
            type: fileTypeOf(found.version.kind, found.version.mimeType),
            previewStatus: found.version.previewStatus,
          }
        : undefined;
    },
    /** A snapshot version as the client page shows it (F09 rule 22). */
    shown: (versionId: string): PublicApprovalItem['files'][number] | undefined => {
      const found = anyVersion(versionId);
      if (!found || found.version.archivedAt) return undefined;
      const { record, version } = found;
      return {
        versionId: version.id,
        kind: version.kind,
        name: record.name,
        type: fileTypeOf(version.kind, version.mimeType),
        sizeBytes: version.sizeBytes,
        display:
          version.kind === 'link'
            ? 'link'
            : isInlineMimeType(version.mimeType)
              ? 'inline'
              : 'download',
        previewAvailable: version.previewStatus === 'ready',
        linkUrl: version.url,
        linkLabel: version.linkLabel,
      };
    },
    /** Rule 13: the versions the client approved become their deliverables' finals. */
    markFinal: (versionIds: string[]) => {
      for (const record of files) {
        if (!record.versions.some((v) => versionIds.includes(v.id))) continue;
        for (const v of record.versions) {
          const marked = versionIds.includes(v.id);
          v.isFinal = marked;
          v.finalSource = marked ? 'client' : null;
          v.finalMarkedBy = null;
          v.finalMarkedAt = marked ? now() : null;
        }
      }
    },
    /** The bytes of a snapshot version for the client page. */
    serveVersion: (route: Route, versionId: string, part: string) => {
      const found = anyVersion(versionId);
      return found ? serve(route, found.version, part) : fail(route, 404, null);
    },
  };
}

/** Steps numbered in order; `after` lists step numbers, as in the spec's seed tables. */
function templateSteps(first: number, steps: (StepSeed & { after?: number[] })[]): TemplateStep[] {
  return steps.map(({ after = [], ...step }, i) => ({
    id: id(first + i),
    stageId: null,
    position: i + 1,
    brief: null,
    dueDay: null,
    priority: 'normal',
    needsClientApproval: true,
    revisionLimit: 2,
    checklist: [],
    repeatKind: null,
    repeatLabel: null,
    spreadFromDay: null,
    ...step,
    dependsOn: after.map((n) => id(first + n - 1)),
  }));
}

export function templatesSeed(): TemplateRecord[] {
  const stage = (n: number, name: string, position: number) => ({ id: id(n), name, position });
  const website = [
    stage(2001, 'الاستكشاف', 1),
    stage(2002, 'التصميم', 2),
    stage(2003, 'التنفيذ', 3),
    stage(2004, 'الاختبار', 4),
    stage(2005, 'التسليم', 5),
  ];
  const [discovery, designStage, build, test, delivery] = website.map((s) => s.id);
  return [
    {
      id: id(2000),
      name: 'موقع إلكتروني',
      kind: 'project',
      description: 'من المتطلبات حتى الإطلاق وتسليم لوحة التحكم.',
      stages: website,
      steps: templateSteps(2010, [
        {
          title: 'المتطلبات وخريطة الموقع',
          department: 'development',
          dueDay: 3,
          stageId: discovery,
          checklist: ['اجتماع المتطلبات', 'خريطة الموقع'],
        },
        {
          title: 'جرد المحتوى',
          department: 'content_management',
          dueDay: 5,
          stageId: discovery,
          needsClientApproval: false,
          after: [1],
        },
        {
          title: 'المخططات الأولية',
          department: 'design',
          dueDay: 8,
          stageId: designStage,
          after: [1],
        },
        {
          title: 'تصميم الواجهات',
          department: 'design',
          dueDay: 14,
          stageId: designStage,
          priority: 'high',
          after: [3],
        },
        {
          title: 'بناء الواجهة الأمامية',
          department: 'development',
          dueDay: 24,
          stageId: build,
          needsClientApproval: false,
          after: [4],
        },
        {
          title: 'الخلفية ولوحة التحكم',
          department: 'development',
          dueDay: 24,
          stageId: build,
          needsClientApproval: false,
          after: [1],
        },
        {
          title: 'إدخال المحتوى',
          department: 'content_management',
          dueDay: 26,
          stageId: build,
          needsClientApproval: false,
          after: [6, 2],
        },
        {
          title: 'الاختبار والإصلاحات',
          department: 'development',
          dueDay: 29,
          stageId: test,
          after: [5, 7],
        },
        {
          title: 'الإطلاق',
          department: 'development',
          dueDay: 31,
          stageId: delivery,
          needsClientApproval: false,
          after: [8],
        },
        {
          title: 'تدريب العميل والتسليم',
          department: 'development',
          dueDay: 32,
          stageId: delivery,
          needsClientApproval: false,
          after: [9],
        },
      ]),
      assignees: [{ department: 'design', userId: id(3) }],
      linkedRetainerIds: [],
      archived: false,
      updatedAt: '2026-10-02T09:30:00.000Z',
    },
    {
      id: id(2100),
      name: 'دورة السوشيال ميديا الشهرية',
      kind: 'retainer_cycle',
      description: 'خطة الشهر، ثم مهمة لكل تصميم وريل، وتقرير آخر الشهر.',
      stages: [],
      steps: templateSteps(2110, [
        { title: 'خطة المحتوى الشهرية والتعليقات', department: 'content_management', dueDay: 3 },
        {
          title: 'تصميم',
          department: 'design',
          repeatKind: 'design',
          spreadFromDay: 4,
          after: [1],
        },
        {
          title: 'ريل',
          department: 'photography',
          repeatKind: 'reel',
          spreadFromDay: 5,
          after: [1],
        },
        {
          title: 'التقرير الشهري',
          department: 'marketing',
          repeatKind: 'monthly_report',
          spreadFromDay: 27,
          needsClientApproval: false,
        },
      ]),
      // Basel is archived: the default stays, with a warning (rule 4).
      assignees: [
        { department: 'design', userId: id(6) },
        { department: 'photography', userId: id(4) },
      ],
      linkedRetainerIds: [id(901)],
      archived: false,
      updatedAt: '2026-10-03T11:00:00.000Z',
    },
    {
      id: id(2200),
      name: 'فيديو ترويجي',
      kind: 'project',
      description: null,
      stages: [stage(2201, 'ما قبل الإنتاج', 1), stage(2202, 'الإنتاج', 2)],
      steps: templateSteps(2210, [
        {
          title: 'الفكرة والسيناريو',
          department: 'content_management',
          dueDay: 2,
          stageId: id(2201),
        },
        {
          title: 'التصوير',
          department: 'photography',
          dueDay: 5,
          stageId: id(2202),
          needsClientApproval: false,
          after: [1],
        },
      ]),
      assignees: [],
      linkedRetainerIds: [],
      archived: false,
      updatedAt: '2026-09-20T08:00:00.000Z',
    },
    {
      id: id(2300),
      name: 'حملة موسمية قديمة',
      kind: 'project',
      description: null,
      stages: [],
      steps: templateSteps(2310, [{ title: 'خطة الحملة', department: 'marketing', dueDay: 2 }]),
      assignees: [],
      linkedRetainerIds: [],
      archived: true,
      updatedAt: '2026-06-01T08:00:00.000Z',
    },
  ];
}

interface TemplateState {
  users: UserResponse[];
  clients: ClientRecord[];
  retainers: RetainerRecord[];
  templates: TemplateRecord[];
  me: () => MeResponse;
}

/** The templates API over the in-memory records, with the F07 rules the screens rely on. */
function templateRoutes({ users, clients, retainers, templates, me }: TemplateState) {
  const manages = () => me().permissions.some((g) => g.permission === 'templates.manage');
  let nextId = 2500;
  let clock = Date.parse('2026-10-10T09:00:00.000Z');
  const isMember = (userId: string, department: DepartmentCode) => {
    const user = users.find((u) => u.id === userId);
    return (
      !!user && user.status !== 'archived' && user.departments.some((d) => d.code === department)
    );
  };

  const detail = (t: TemplateRecord): TemplateDetail => {
    const assignees = t.assignees.map(({ department, userId }) => {
      const user = users.find((u) => u.id === userId);
      return {
        department,
        user: { id: userId, name: user?.name ?? '', archived: user?.status === 'archived' },
        valid: isMember(userId, department),
      };
    });
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      description: t.description,
      stages: t.stages,
      steps: t.steps,
      assignees,
      warnings: assignees
        .filter((a) => !a.valid)
        .map((a) => ({ type: 'invalid_assignee' as const, department: a.department })),
      linkedRetainers: retainers
        .filter((r) => t.linkedRetainerIds.includes(r.id) && !r.archived)
        .map((r) => ({
          id: r.id,
          name: r.name,
          client: {
            id: r.clientId,
            name: clients.find((c) => c.id === r.clientId)?.tradeName ?? '',
          },
        })),
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: t.updatedAt,
      archivedAt: t.archived ? '2026-09-15T08:00:00.000Z' : null,
      permissions: { canEdit: manages() && !t.archived, canArchive: manages() },
    };
  };

  const listItem = (t: TemplateRecord): TemplateListItem => {
    const full = detail(t);
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      description: t.description,
      stepCount: t.steps.length,
      departments: [...new Set(t.steps.map((s) => s.department))],
      warningCount: full.warnings.length,
      linkedRetainerCount: full.linkedRetainers.length,
      updatedAt: t.updatedAt,
      archivedAt: full.archivedAt,
    };
  };

  const nameTaken = (name: string, except?: string) =>
    templates.some(
      (t) => !t.archived && t.id !== except && t.name.toLowerCase() === name.toLowerCase(),
    );

  /** Saves the document: a key equal to a stored id keeps it, any other key gets a new id. */
  const save = (t: TemplateRecord, doc: TemplateDocument) => {
    const known = new Set([...t.stages.map((s) => s.id), ...t.steps.map((s) => s.id)]);
    const ids = new Map<string, string>();
    const idOf = (key: string) => {
      if (!ids.has(key)) ids.set(key, known.has(key) ? key : id(nextId++));
      return ids.get(key) as string;
    };
    t.name = doc.name;
    t.description = doc.description;
    t.stages = doc.stages.map((s, i) => ({ id: idOf(s.key), name: s.name, position: i + 1 }));
    t.steps = doc.steps.map(({ key, stageKey, dependsOn, ...step }, i) => ({
      ...step,
      id: idOf(key),
      stageId: stageKey ? idOf(stageKey) : null,
      position: i + 1,
      dependsOn: dependsOn.map(idOf),
    }));
    t.assignees = doc.assignees;
    clock += 60_000;
    t.updatedAt = new Date(clock).toISOString();
  };

  /** Rule 4: a new or changed default must be a non-archived member of its department. */
  const invalidAssignee = (t: TemplateRecord | null, doc: TemplateDocument) =>
    doc.assignees.find(
      (a) =>
        !t?.assignees.some((b) => b.department === a.department && b.userId === a.userId) &&
        !isMember(a.userId, a.department),
    );

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    if (path === '/api/templates' && method === 'GET') {
      const archived = url.searchParams.get('archived') === 'true';
      if (archived && !manages()) return fail(route, 403, null);
      const kind = url.searchParams.get('kind');
      const search = url.searchParams.get('search')?.toLowerCase();
      const items = templates
        .filter(
          (t) =>
            t.archived === archived &&
            (!kind || t.kind === kind) &&
            (!search || t.name.toLowerCase().includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        .map(listItem);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/templates' && method === 'POST') {
      if (!manages()) return fail(route, 403, null);
      const input: CreateTemplate = createTemplateSchema.parse(request.postDataJSON());
      if (nameTaken(input.name)) return fail(route, 409, 'TEMPLATE_NAME_TAKEN');
      const wrong = invalidAssignee(null, input);
      if (wrong) return fail(route, 400, 'INVALID_ASSIGNEE', { department: wrong.department });
      const created: TemplateRecord = {
        id: id(nextId++),
        name: input.name,
        kind: input.kind,
        description: null,
        stages: [],
        steps: [],
        assignees: [],
        linkedRetainerIds: [],
        archived: false,
        updatedAt: '',
      };
      save(created, input);
      templates.push(created);
      return json(route, detail(created), 201);
    }
    const match = path.match(/^\/api\/templates\/([^/]+)(?:\/(archive|restore))?$/);
    if (!match) return undefined;
    const template = templates.find((t) => t.id === match[1]);
    if (!template || (template.archived && !manages())) return fail(route, 404, null);
    const action = match[2];
    if (!action && method === 'GET') return json(route, detail(template));
    if (!manages()) return fail(route, 403, null);
    if (!action && method === 'PUT') {
      if (template.archived) return fail(route, 409, 'TEMPLATE_ARCHIVED');
      const input = updateTemplateSchema.parse(request.postDataJSON());
      if (nameTaken(input.name, template.id)) return fail(route, 409, 'TEMPLATE_NAME_TAKEN');
      const wrong = invalidAssignee(template, input);
      if (wrong) return fail(route, 400, 'INVALID_ASSIGNEE', { department: wrong.department });
      save(template, input);
      return json(route, detail(template));
    }
    if (action === 'archive' && method === 'POST') {
      if (template.archived) return fail(route, 409, 'TEMPLATE_ARCHIVED');
      template.archived = true;
      return json(route, detail(template));
    }
    if (action === 'restore' && method === 'POST') {
      if (!template.archived) return fail(route, 409, 'TEMPLATE_NOT_ARCHIVED');
      if (nameTaken(template.name, template.id)) return fail(route, 409, 'TEMPLATE_NAME_TAKEN');
      template.archived = false;
      return json(route, detail(template));
    }
    return undefined;
  };
}
interface RunRecord {
  id: string;
  templateId: string;
  trigger: TemplateRunTrigger;
  projectId: string | null;
  retainerId: string | null;
  cycleId: string | null;
  cycleLineId: string | null;
  startDate: string;
  taskIds: string[];
  milestonesCreated: number;
  createdById: string | null;
  createdAt: string;
}

interface TemplateRunState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  templates: TemplateRecord[];
  me: () => MeResponse;
}

type RunError = { error: readonly [number, ErrorCode | null] };

/** Template runs (F07 rules 6–19) over the in-memory records, planned with `planTemplateRun`. */
function templateRunRoutes({
  users,
  clients,
  projects,
  retainers,
  tasks,
  templates,
  me,
}: TemplateRunState) {
  const runs: RunRecord[] = [];
  let nextId = 2700;
  let clock = Date.parse('2026-10-10T09:30:00.000Z');
  const today = PROJECTS_TODAY;
  const later = (a: string, b: string) => (a > b ? a : b);
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const user = (userId: string) => users.find((u) => u.id === userId);
  const person = (userId: string) => ({ id: userId, name: user(userId)?.name ?? '' });
  const clientScope = (clientId: string) =>
    holds('projects.manage', 'all') ||
    (holds('projects.manage', 'own_clients') &&
      clients.find((c) => c.id === clientId)?.accountManagerId === me().user.id);
  const managesProject = (p: ProjectRecord) =>
    clientScope(p.clientId) ||
    (holds('projects.manage', 'assigned') && p.projectManagerId === me().user.id);
  const isMember = (userId: string, department: DepartmentCode) => {
    const u = user(userId);
    return !!u && u.status !== 'archived' && u.departments.some((d) => d.code === department);
  };
  const linkedTo = (retainerId: string) =>
    templates.find((t) => t.linkedRetainerIds.includes(retainerId));
  const cycleOf = (cycleId: string) => {
    for (const retainer of retainers) {
      const cycle = retainer.cycles.find((c) => c.id === cycleId);
      if (cycle) return { retainer, cycle };
    }
    return undefined;
  };
  const lineTasks = (lineId: string) =>
    tasks.filter((t) => t.cycleLineId === lineId && !t.archived && t.status !== 'cancelled').length;
  const fullRun = (cycleId: string) =>
    runs.find((r) => r.cycleId === cycleId && r.trigger !== 'missing_tasks');
  const assigneesOf = (template: TemplateRecord, chosen: TemplateRunInput['assignees']) => {
    const byDepartment = new Map<DepartmentCode, string | null>(
      template.assignees.map((a) => [a.department, a.userId]),
    );
    for (const a of chosen) byDepartment.set(a.department, a.userId);
    return [...byDepartment].map(([department, userId]) => ({
      department,
      user: userId ? person(userId) : null,
    }));
  };

  const present = (run: RunRecord): TemplateRun => {
    const template = templates.find((t) => t.id === run.templateId);
    const project = projects.find((p) => p.id === run.projectId);
    const found = run.cycleId ? cycleOf(run.cycleId) : undefined;
    const line = found?.cycle.lines.find((l) => l.id === run.cycleLineId);
    return {
      id: run.id,
      template: { id: run.templateId, name: template?.name ?? '', archived: !!template?.archived },
      trigger: run.trigger,
      project: project ? { id: project.id, name: project.name } : null,
      cycle: found
        ? {
            id: found.cycle.id,
            month: found.cycle.month,
            retainer: { id: found.retainer.id, name: found.retainer.name },
          }
        : null,
      cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
      startDate: run.startDate,
      taskCount: run.taskIds.length,
      milestonesCreated: run.milestonesCreated,
      createdBy: run.createdById ? person(run.createdById) : null,
      createdAt: run.createdAt,
    };
  };

  interface Planned {
    plan: ReturnType<typeof planTemplateRun>;
    project?: ProjectRecord;
    retainer?: RetainerRecord;
    cycle?: CycleRecord;
  }

  /** Checks the target as the API does (rules 15, 17), then plans with `planTemplateRun`. */
  const plan = (template: TemplateRecord, input: TemplateRunInput): Planned | RunError => {
    if (template.archived) return { error: [409, 'TEMPLATE_ARCHIVED'] };
    const assignees = assigneesOf(template, input.assignees);
    if (input.projectId) {
      const project = projects.find((p) => p.id === input.projectId);
      if (!project) return { error: [404, null] };
      if (!managesProject(project)) return { error: [403, null] };
      if (template.kind !== 'project') return { error: [400, 'TEMPLATE_KIND_MISMATCH'] };
      const startDate = input.startDate ?? later(project.startDate, today);
      if (startDate < today) return { error: [400, 'INVALID_DATES'] };
      const milestones = project.milestones
        .filter((m) => !m.archived)
        .map((m, i) => ({ id: m.id, name: m.name, position: i + 1, status: m.status }));
      const earlierRuns = runs.filter(
        (r) => r.projectId === project.id && r.templateId === template.id,
      ).length;
      const target = {
        type: 'project' as const,
        startDate,
        dueDate: project.dueDate,
        milestones,
        earlierRuns,
      };
      return { project, plan: planTemplateRun({ template, target, assignees, isMember }) };
    }
    const found = input.retainerCycleId ? cycleOf(input.retainerCycleId) : undefined;
    if (!found) return { error: [404, null] };
    const { retainer, cycle } = found;
    if (!clientScope(retainer.clientId)) return { error: [403, null] };
    const linked = linkedTo(retainer.id);
    if (!linked) return { error: [400, 'NO_TEMPLATE'] };
    if (linked.id !== template.id) return { error: [400, 'TEMPLATE_NOT_LINKED'] };
    if (cycle.status !== 'open') return { error: [409, 'CYCLE_CLOSED'] };
    if (fullRun(cycle.id)) return { error: [409, 'ALREADY_GENERATED'] };
    const target = {
      type: 'cycle' as const,
      startDate: later(cycle.periodStart, today),
      periodEnd: cycle.periodEnd,
      lines: cycle.lines,
    };
    return { retainer, cycle, plan: planTemplateRun({ template, target, assignees, isMember }) };
  };

  /** Creates the plan's milestones and tasks (dependencies by key) and records the run. */
  const apply = (
    template: TemplateRecord,
    { plan: planned, project, retainer, cycle }: Planned,
    trigger: TemplateRunTrigger,
    cycleLineId: string | null = null,
  ): TemplateRun => {
    const created = new Map<string, string>();
    for (const m of planned.milestonesToCreate) {
      const milestoneId = id(nextId++);
      project?.milestones.push({
        id: milestoneId,
        name: m.name,
        dueDate: m.dueDate,
        status: 'pending',
        doneAt: null,
        doneById: null,
        installmentMinor: null,
        archived: false,
      });
      created.set(m.name, milestoneId);
    }
    const keys = new Map(planned.tasks.map((task) => [task.key, id(nextId++)]));
    clock += 60_000;
    const createdAt = new Date(clock).toISOString();
    for (const task of planned.tasks) {
      tasks.push(
        taskRecord(0, {
          id: keys.get(task.key) as string,
          title: task.title,
          brief: task.brief,
          department: task.department,
          assigneeId: task.assignee?.id ?? null,
          priority: task.priority,
          dueDate: task.dueDate,
          clientId: project?.clientId ?? retainer?.clientId ?? null,
          projectId: project?.id ?? null,
          milestoneId: task.milestone
            ? (task.milestone.existingId ?? created.get(task.milestone.name) ?? null)
            : null,
          retainerId: retainer?.id ?? null,
          cycleId: cycle?.id ?? null,
          cycleLineId: task.cycleLineId,
          needsClientApproval: task.needsClientApproval,
          revisionLimit: task.revisionLimit,
          createdById: me().user.id,
          createdAt,
          dependsOn: task.dependsOn.map((key) => keys.get(key) as string),
          checklist: task.checklist.map((text) => ({
            id: id(nextId++),
            text,
            doneAt: null,
            doneById: null,
            archived: false,
          })),
        }),
      );
    }
    const run: RunRecord = {
      id: id(nextId++),
      templateId: template.id,
      trigger,
      projectId: project?.id ?? null,
      retainerId: retainer?.id ?? null,
      cycleId: cycle?.id ?? null,
      cycleLineId,
      startDate: planned.startDate,
      taskIds: [...keys.values()],
      milestonesCreated: planned.milestonesToCreate.length,
      createdById: me().user.id,
      createdAt,
    };
    runs.unshift(run);
    return present(run);
  };

  const retainerState = (r: RetainerRecord): RetainerTemplate => {
    const template = linkedTo(r.id);
    const cycle = r.cycles.find((c) => c.status === 'open');
    const run = cycle ? fullRun(cycle.id) : undefined;
    const active = !!template && !template.archived;
    const canManage = !r.archived && clientScope(r.clientId);
    return {
      template: template
        ? { id: template.id, name: template.name, archived: template.archived }
        : null,
      cycle: cycle
        ? {
            id: cycle.id,
            month: cycle.month,
            periodStart: cycle.periodStart,
            periodEnd: cycle.periodEnd,
          }
        : null,
      run: run ? present(run) : null,
      lines: (cycle?.lines ?? []).map((line) => {
        const count = lineTasks(line.id);
        return {
          id: line.id,
          kind: line.kind,
          label: line.label,
          committed: line.committed,
          tasks: count,
          missing: Math.max(0, line.committed - count),
          canGenerate: active && !!repeatedStepFor(template.steps, line),
        };
      }),
      permissions: { canLink: canManage, canGenerate: canManage && active },
    };
  };

  /** Rule 18: instances of the line's repeated step, numbered after its existing tasks. */
  const generateMissing = (retainer: RetainerRecord, cycleId: string, lineId: string) => {
    const cycle = retainer.cycles.find((c) => c.id === cycleId && c.status === 'open');
    if (!cycle) return { error: [409, 'CYCLE_CLOSED'] } as RunError;
    const line = cycle.lines.find((l) => l.id === lineId);
    if (!line) return { error: [404, null] } as RunError;
    const template = linkedTo(retainer.id);
    if (!template) return { error: [400, 'NO_TEMPLATE'] } as RunError;
    if (template.archived) return { error: [409, 'TEMPLATE_ARCHIVED'] } as RunError;
    if (!repeatedStepFor(template.steps, line))
      return { error: [400, 'NO_REPEATED_STEP'] } as RunError;
    const existing = lineTasks(line.id);
    const missing = line.committed - existing;
    if (missing <= 0) return { error: [409, 'NOTHING_MISSING'] } as RunError;
    const target = {
      type: 'missing' as const,
      startDate: today,
      periodEnd: cycle.periodEnd,
      line,
      existing,
      missing,
    };
    const assignees = assigneesOf(template, []);
    const planned = planTemplateRun({ template, target, assignees, isMember });
    return apply(template, { retainer, cycle, plan: planned }, 'missing_tasks', line.id);
  };

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const runMatch = path.match(/^\/api\/templates\/([^/]+)\/(preview|runs)$/);
    if (runMatch && method === 'POST') {
      const template = templates.find((t) => t.id === runMatch[1]);
      if (!template) return fail(route, 404, null);
      const result = plan(template, templateRunInputSchema.parse(request.postDataJSON()));
      if ('error' in result) return fail(route, result.error[0], result.error[1]);
      if (runMatch[2] === 'runs') return json(route, apply(template, result, 'manual'), 201);
      const { tasks: planned, ...rest } = result.plan;
      return json(route, {
        ...rest,
        tasks: planned.map((task) => ({
          key: task.key,
          title: task.title,
          department: task.department,
          assignee: task.assignee,
          assigneeReplaced: task.assigneeReplaced,
          dueDate: task.dueDate,
          milestone: task.milestone,
          cycleLineId: task.cycleLineId,
          dependsOn: task.dependsOn,
        })),
      });
    }
    if (path === '/api/template-runs' && method === 'GET') {
      const projectId = url.searchParams.get('projectId');
      const retainerId = url.searchParams.get('retainerId');
      const taskId = url.searchParams.get('taskId');
      const items = runs
        .filter(
          (r) =>
            (!projectId || r.projectId === projectId) &&
            (!retainerId || r.retainerId === retainerId) &&
            (!taskId || r.taskIds.includes(taskId)),
        )
        .map(present);
      return json(route, { items, total: items.length, page: 1, pageSize: 50 });
    }
    const match = path.match(
      /^\/api\/retainers\/([^/]+)\/(?:template|cycles\/([^/]+)\/lines\/([^/]+)\/missing-tasks)$/,
    );
    if (!match) return undefined;
    const [, retainerId, cycleId, lineId] = match;
    const retainer = retainers.find((r) => r.id === retainerId);
    if (!retainer) return fail(route, 404, null);
    if (!cycleId && method === 'GET') return json(route, retainerState(retainer));
    if (!clientScope(retainer.clientId)) return fail(route, 403, null);
    if (retainer.archived) return fail(route, 409, 'RETAINER_ARCHIVED');
    if (retainer.status === 'ended') return fail(route, 409, 'RETAINER_ENDED');
    if (!cycleId && method === 'PUT') {
      const { templateId } = setRetainerTemplateSchema.parse(request.postDataJSON());
      const next = templates.find((t) => t.id === templateId);
      if (templateId && !next) return fail(route, 404, null);
      if (next?.kind === 'project') return fail(route, 400, 'TEMPLATE_KIND_MISMATCH');
      if (next?.archived) return fail(route, 409, 'TEMPLATE_ARCHIVED');
      for (const t of templates) {
        t.linkedRetainerIds = t.linkedRetainerIds.filter((r) => r !== retainer.id);
      }
      next?.linkedRetainerIds.push(retainer.id);
      return json(route, retainerState(retainer));
    }
    if (cycleId && lineId && method === 'POST') {
      const result = generateMissing(retainer, cycleId, lineId);
      if ('error' in result) return fail(route, result.error[0], result.error[1]);
      return json(route, result, 201);
    }
    return undefined;
  };
}
export type NotificationRecord = Notification & { recipientId: string };

const autumnMenuSnapshot = {
  title: 'تصاميم منيو الخريف',
  department: 'design',
  client: 'مطعم الياسمين',
  project: 'الهوية البصرية الجديدة',
} as const;

/** A notification for a test user, typed by the contract. */
export function notificationFor(
  recipient: MeResponse,
  n: number,
  notification: Omit<Notification, 'id' | 'count' | 'read' | 'createdAt' | 'updatedAt'> &
    Partial<Pick<Notification, 'count' | 'read' | 'updatedAt'>>,
): NotificationRecord {
  const at = notification.updatedAt ?? '2026-09-30T08:00:00.000Z';
  return {
    count: 1,
    read: false,
    ...notification,
    id: id(n),
    createdAt: at,
    updatedAt: at,
    recipientId: recipient.user.id,
  } as NotificationRecord;
}

/** Sara's and Karim's notifications. */
export function notificationsSeed(): NotificationRecord[] {
  const layan = { id: id(3), name: 'ليان الأحمد' };
  return [
    notificationFor(manager, 5001, {
      type: 'task_review_requested',
      actor: layan,
      subject: { type: 'task', id: id(1001) },
      data: { task: autumnMenuSnapshot },
      updatedAt: '2026-09-30T09:40:00.000Z',
    }),
    notificationFor(manager, 5002, {
      type: 'task_commented',
      actor: layan,
      subject: { type: 'task', id: id(1001) },
      data: { task: autumnMenuSnapshot, excerpt: 'أرفقت المسودة الثانية.' },
      count: 2,
      updatedAt: '2026-09-30T09:10:00.000Z',
    }),
    notificationFor(manager, 5003, {
      type: 'task_overdue',
      actor: null,
      subject: { type: 'task', id: id(1003) },
      data: {
        task: {
          title: 'بوستات أسبوع الافتتاح',
          department: 'content_management',
          client: 'مطعم الياسمين',
          project: null,
        },
        dueDate: '2026-09-28',
        dueTime: null,
      },
      updatedAt: '2026-09-30T06:00:00.000Z',
    }),
    notificationFor(manager, 5004, {
      type: 'tasks_generated',
      actor: layan,
      subject: { type: 'template_run', id: id(5100) },
      data: {
        template: 'إطلاق موقع',
        count: 4,
        department: 'design',
        unassigned: true,
        client: 'عيادة الشفاء',
        project: 'موقع العيادة',
        retainer: null,
      },
      read: true,
      updatedAt: '2026-09-29T11:00:00.000Z',
    }),
    notificationFor(manager, 5005, {
      type: 'retainer_renewal_due',
      actor: null,
      subject: { type: 'retainer', id: id(901) },
      data: {
        retainer: 'إدارة السوشيال ميديا',
        client: 'مطعم الياسمين',
        renewalDate: '2026-10-12',
        daysLeft: 12,
      },
      read: true,
      updatedAt: '2026-09-28T06:00:00.000Z',
    }),
    notificationFor(manager, 5007, {
      type: 'retainer_behind',
      actor: null,
      subject: { type: 'retainer', id: id(901) },
      data: {
        retainer: 'إدارة السوشيال ميديا',
        client: 'مطعم الياسمين',
        periodEnd: '2026-09-30',
        daysLeft: 7,
        final: false,
        lines: [
          { kind: 'design', label: null, delivered: 9, committed: 12, ready: 2 },
          { kind: 'reel', label: null, delivered: 3, committed: 4, ready: 0 },
          { kind: 'story', label: null, delivered: 5, committed: 8, ready: 1 },
          { kind: 'monthly_report', label: null, delivered: 0, committed: 1, ready: 0 },
        ],
      },
      read: true,
      updatedAt: '2026-09-24T06:00:00.000Z',
    }),
    notificationFor(manager, 5008, {
      type: 'task_over_limit_pending',
      actor: null,
      subject: { type: 'task', id: id(1001) },
      data: { task: autumnMenuSnapshot, revisionNumber: 3, recordedOn: '2026-09-21' },
      read: true,
      updatedAt: '2026-09-23T06:00:00.000Z',
    }),
    notificationFor(manager, 5006, {
      type: 'client_account_manager_assigned',
      actor: { id: id(2), name: 'عمر حداد' },
      subject: { type: 'client', id: id(602) },
      data: { client: 'عيادة الشفاء' },
      read: true,
      updatedAt: '2026-09-20T10:00:00.000Z',
    }),
    notificationFor(employeeMe, 5010, {
      type: 'task_assigned',
      actor: { id: id(1), name: 'سارة الخطيب' },
      subject: { type: 'task', id: id(1002) },
      data: {
        task: {
          title: 'تصوير أطباق الموسم',
          department: 'photography',
          client: 'مطعم الياسمين',
          project: null,
        },
      },
      updatedAt: '2026-09-30T09:00:00.000Z',
    }),
  ];
}

/** The notifications API (F14) over the in-memory rows: each user reads only their own. */
function notificationRoutes({
  notifications,
  streamed,
  me,
}: {
  notifications: NotificationRecord[];
  streamed: Notification[];
  me: () => MeResponse;
}) {
  const muted = new Map<string, Set<NotificationType>>();
  const emailed = new Map<string, Set<NotificationType>>();
  const digest = new Map<string, boolean>();
  const mine = () => notifications.filter((n) => n.recipientId === me().user.id);
  const unreadCount = () => mine().filter((n) => !n.read).length;
  const strip = ({ recipientId: _, ...rest }: NotificationRecord) => rest as Notification;
  const settings = (): NotificationSettings => {
    const off = muted.get(me().user.id) ?? new Set();
    return {
      types: NOTIFICATION_TYPES.map((type) => ({
        type,
        category: NOTIFICATION_CATALOG[type].category,
        mutable: NOTIFICATION_CATALOG[type].mutable,
        muted: off.has(type),
        // F14 email: the saved choice, else the catalog defaults, kept while the type is muted.
        email: emailed.get(me().user.id)?.has(type) ?? NOTIFICATION_CATALOG[type].emailByDefault,
        emailLocked: off.has(type),
      })),
      digestEnabled: digest.get(me().user.id) ?? true,
    };
  };

  return (route: Route, method: string, url: URL) => {
    const path = url.pathname;
    if (path === '/api/me/notifications' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      const unread = url.searchParams.get('unread') === 'true';
      const category = url.searchParams.get('category');
      const items = mine()
        .filter(
          (n) =>
            (!unread || !n.read) &&
            (!category || NOTIFICATION_CATALOG[n.type].category === category),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json(route, {
        items: items.slice((page - 1) * pageSize, page * pageSize).map(strip),
        total: items.length,
        page,
        pageSize,
      });
    }
    if (path === '/api/me/notifications/unread-count') {
      return json(route, { count: unreadCount() });
    }
    if (path === '/api/me/notifications/stream') {
      // `retry` keeps EventSource from reconnecting during the test once the body ends.
      let body = 'retry: 3600000\n\n';
      for (const notification of streamed.splice(0)) {
        notifications.push({ ...notification, recipientId: me().user.id });
        const event = { notification, unreadCount: unreadCount() };
        body += `event: notification\ndata: ${JSON.stringify(event)}\n\n`;
      }
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    }
    if (path === '/api/me/notifications/read-all' && method === 'POST') {
      const unread = mine().filter((n) => !n.read);
      for (const n of unread) n.read = true;
      return json(route, { updated: unread.length });
    }
    const match = path.match(/^\/api\/me\/notifications\/([^/]+)\/(read|unread)$/);
    if (match && method === 'POST') {
      const item = mine().find((n) => n.id === match[1]);
      if (!item) return fail(route, 404, null);
      item.read = match[2] === 'read';
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/me/notification-settings' && method === 'GET') {
      return json(route, settings());
    }
    if (path === '/api/me/notification-settings' && method === 'PUT') {
      const { mutedTypes, emailTypes, digestEnabled } = route
        .request()
        .postDataJSON() as UpdateNotificationSettings;
      if (mutedTypes.some((type) => !NOTIFICATION_CATALOG[type].mutable)) {
        return fail(route, 400, 'NOT_MUTABLE');
      }
      muted.set(me().user.id, new Set(mutedTypes));
      if (emailTypes) emailed.set(me().user.id, new Set(emailTypes));
      if (digestEnabled !== undefined) digest.set(me().user.id, digestEnabled);
      return json(route, settings());
    }
    return undefined;
  };
}
// Email (F14 email)

/** An email of the mock outbox, with the invoice whose history shows a receipt, and its month. */
export interface EmailRecord extends EmailLogItem {
  invoiceId?: string;
  month?: string;
}

const address = (name: string, email: string, userId?: string) => ({
  name,
  email,
  ...(userId && { userId }),
});

/** The outbox: client emails of the seeded documents, and staff emails of each state. */
export function emailsSeed(): EmailRecord[] {
  const hala = address('هالة الشامي', 'hala@jasmine.example');
  const layan = { id: id(3), name: 'ليان الأحمد' };
  const client = {
    audience: 'client' as const,
    cc: [address(layan.name, 'layan@vertex.example', layan.id)],
    clientId: id(601),
  };
  const staff = { audience: 'staff' as const, cc: [], sender: null, record: null, clientId: null };
  return [
    {
      ...client,
      id: id(9801),
      kind: 'client_invoice_reminder',
      status: 'failed',
      to: [hala],
      subject: 'تذكير: الفاتورة INV-2026-0001 متأخرة السداد',
      sender: { id: id(7), name: 'رنا المصري' },
      createdAt: '2026-10-09T09:30:00.000Z',
      sentAt: null,
      error: '535 5.7.8 Authentication failed',
      attempts: 3,
      record: { type: 'invoice', id: id(9403) },
    },
    {
      ...client,
      id: id(9802),
      kind: 'client_quote',
      status: 'sent',
      to: [hala],
      subject: 'عرض السعر Q-2026-0001: هوية مطعم الياسمين',
      sender: layan,
      createdAt: '2026-10-08T08:00:00.000Z',
      sentAt: '2026-10-08T08:00:20.000Z',
      error: null,
      attempts: 1,
      record: { type: 'quote', id: id(9201) },
    },
    {
      ...staff,
      id: id(9803),
      kind: 'digest',
      status: 'sent',
      to: [address('كريم الزين', 'karim@vertex.example', id(4))],
      subject: 'ملخص يومك: 3 مهام',
      createdAt: '2026-10-08T05:00:00.000Z',
      sentAt: '2026-10-08T05:00:12.000Z',
      error: null,
      attempts: 1,
    },
    {
      ...staff,
      id: id(9804),
      kind: 'account_activation',
      status: 'queued',
      to: [address('نور السيد', 'nour@vertex.example', id(5))],
      subject: 'فعّل حسابك في Vertex Hub',
      createdAt: '2026-10-07T12:00:00.000Z',
      sentAt: null,
      error: null,
      attempts: 0,
    },
  ];
}

/** The record a document's "Send by email" route belongs to, and the kind its body asks for. */
const SENT_FROM = {
  quotes: {
    type: 'quote',
    kind: (body: { kind?: string }) =>
      body.kind === 'reminder' ? 'client_quote_reminder' : 'client_quote',
  },
  invoices: {
    type: 'invoice',
    kind: (body: { kind?: string }) =>
      body.kind === 'overdue_reminder' ? 'client_invoice_reminder' : 'client_invoice',
  },
  payments: { type: 'payment', kind: () => 'client_receipt' },
  'ad-wallet-entries': { type: 'ad_wallet_entry', kind: () => 'client_ad_receipt' },
} as const satisfies Record<
  string,
  {
    type: EmailRecordType;
    kind: (body: { kind?: string }) => ClientEmailKind;
  }
>;

/**
 * The email API over the mock outbox: the log and its test email, and each document's "Send by
 * email" and history. Approval links are queued by the approvals mock.
 */
function emailRoutes({
  outbox,
  clients,
  users,
  me,
}: {
  outbox: EmailRecord[];
  clients: ClientRecord[];
  users: UserResponse[];
  me: () => MeResponse;
}) {
  const summary = (email: EmailRecord): EmailSummary => ({
    id: email.id,
    kind: email.kind,
    status: email.status,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    sender: email.sender,
    createdAt: email.createdAt,
    sentAt: email.sentAt,
    error: email.error,
  });
  // Mock emails share one time: the later one (higher id) first.
  const newest = (a: EmailRecord, b: EmailRecord) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  const history = (match: (email: EmailRecord) => boolean) => ({
    items: outbox.filter(match).sort(newest).map(summary),
  });
  const push = (route: Route, email: Omit<EmailRecord, 'id' | 'status' | 'createdAt'>) => {
    const queued: EmailRecord = {
      ...email,
      id: id(9900 + outbox.length),
      status: 'queued',
      createdAt: TASKS_NOW.toISOString(),
    };
    outbox.push(queued);
    return json(route, summary(queued), 202);
  };
  /** Rules 17–18: the chosen contacts with an email, and the copies. */
  const queue = (
    route: Route,
    clientId: string,
    kind: ClientEmailKind,
    record: EmailRecord['record'],
    input: ClientEmail & { month?: string },
  ) => {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return fail(route, 404, null);
    if (client.archived) return fail(route, 409, 'CLIENT_ARCHIVED');
    const to = input.contactIds.map((contactId) =>
      client.contacts.find((c) => c.id === contactId && !c.archived && c.email),
    );
    if (to.some((contact) => !contact)) return fail(route, 409, 'INVALID_RECIPIENT');
    const copied = new Set([
      ...(input.ccAccountManager ? [client.accountManagerId] : []),
      ...(input.ccMe ? [me().user.id] : []),
    ]);
    return push(route, {
      kind,
      audience: 'client',
      to: to.flatMap((contact) => (contact?.email ? [address(contact.name, contact.email)] : [])),
      cc: users.flatMap((user) =>
        copied.has(user.id) && user.email ? [address(user.name, user.email, user.id)] : [],
      ),
      subject: input.subject,
      sender: { id: me().user.id, name: me().user.name },
      sentAt: null,
      error: null,
      attempts: 0,
      record,
      clientId,
      month: input.month,
    });
  };

  return (route: Route, method: string, url: URL) => {
    const path = url.pathname;
    const input = () =>
      route.request().postDataJSON() as ClientEmail & { kind?: string; month?: string };
    if (path === '/api/emails' && method === 'GET') {
      const status = url.searchParams.getAll('status');
      const kind = url.searchParams.getAll('kind');
      const audience = url.searchParams.get('audience');
      const search = url.searchParams.get('search')?.toLowerCase();
      const items = outbox
        .filter(
          (email) =>
            (status.length === 0 || status.includes(email.status)) &&
            (kind.length === 0 || kind.includes(email.kind)) &&
            (!audience || email.audience === audience) &&
            (!search ||
              email.to.some(
                (to) => to.email.includes(search) || to.name.toLowerCase().includes(search),
              )),
        )
        .sort(newest)
        .map(({ invoiceId: _, month: __, ...item }) => item);
      return json(route, { items, total: items.length, page: 1, pageSize: 30 });
    }
    if (path === '/api/emails/test' && method === 'POST') {
      const { user } = me();
      return push(route, {
        kind: 'test',
        audience: 'staff',
        to: [address(user.name, user.email, user.id)],
        cc: [],
        subject: 'بريد تجريبي من Vertex Hub',
        sender: { id: user.id, name: user.name },
        sentAt: null,
        error: null,
        attempts: 0,
        record: null,
        clientId: null,
      });
    }
    const sent = path.match(
      /^\/api\/(quotes|invoices|payments|ad-wallet-entries)\/([^/]+)\/email$/,
    );
    if (sent?.[1] && sent[2] && method === 'POST') {
      const from = SENT_FROM[sent[1] as keyof typeof SENT_FROM];
      const body = input();
      return queue(route, id(601), from.kind(body), { type: from.type, id: sent[2] }, body);
    }
    const reminder = path.match(/^\/api\/approvals\/requests\/([^/]+)\/email-reminder$/);
    if (reminder?.[1] && method === 'POST') {
      return push(route, {
        kind: 'client_approval_reminder',
        audience: 'client',
        to: [address('هالة الشامي', 'hala@jasmine.example')],
        cc: [],
        subject: 'تذكير: أعمال ما زالت بانتظار اعتمادكم',
        sender: { id: me().user.id, name: me().user.name },
        sentAt: null,
        error: null,
        attempts: 0,
        record: { type: 'approval_request', id: reminder[1] },
        clientId: id(601),
      });
    }
    const documentHistory = path.match(
      /^\/api\/(quotes|invoices|approvals\/requests)\/([^/]+)\/emails$/,
    );
    if (documentHistory?.[2] && method === 'GET') {
      const recordId = documentHistory[2];
      return json(
        route,
        history((email) => email.record?.id === recordId || email.invoiceId === recordId),
      );
    }
    const clientDocument = path.match(
      /^\/api\/clients\/([^/]+)\/(statement|monthly-report|ad-wallet)\/(email|emails)$/,
    );
    if (clientDocument?.[1]) {
      const [, clientId, document, action] = clientDocument;
      const kinds: ClientEmailKind[] =
        document === 'statement'
          ? ['client_statement']
          : document === 'monthly-report'
            ? ['client_report']
            : ['client_ad_receipt', 'client_ad_budget_low'];
      if (action === 'emails' && method === 'GET') {
        const month = url.searchParams.get('month');
        return json(
          route,
          history(
            (email) =>
              email.clientId === clientId &&
              (kinds as string[]).includes(email.kind) &&
              (!month || email.month === month),
          ),
        );
      }
      if (action === 'email' && method === 'POST') {
        const kind = document === 'ad-wallet' ? 'client_ad_budget_low' : kinds[0];
        if (!kind) return undefined;
        return queue(route, clientId, kind, { type: 'client', id: clientId }, input());
      }
    }
    return undefined;
  };
}

// Calendar and shoots (F11)

interface ShootRecord {
  id: string;
  title: string;
  type: ShootType;
  status: ShootStatus;
  clientId: string | null;
  taskId: string;
  startsAt: string;
  endsAt: string;
  location: string;
  mapUrl: string | null;
  brief: string | null;
  crew: { userId: string; role: CrewRole; isLead: boolean }[];
  externalCrew: ShootDetail['externalCrew'];
  shots: {
    id: string;
    text: string;
    note: string | null;
    doneAt: string | null;
    doneById: string | null;
  }[];
  closeNote: string | null;
  rawFilesUrl: string | null;
  editingTaskId: string | null;
  completedAt: string | null;
  completedById: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
}

interface MeetingRecord {
  id: string;
  title: string;
  status: Meeting['status'];
  clientId: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  onlineUrl: string | null;
  agenda: string | null;
  organizerId: string;
  attendeeIds: string[];
  contactIds: string[];
  cancelledAt: string | null;
  cancelReason: string | null;
  createdById: string;
  createdAt: string;
  archivedAt: string | null;
}

/** A Damascus wall time as the API returns it. */
const at = (day: string, time: string) => new Date(`${day}T${time}:00+03:00`).toISOString();

function meetingRecord(
  n: number,
  fields: Partial<MeetingRecord> & Pick<MeetingRecord, 'title' | 'startsAt' | 'endsAt'>,
): MeetingRecord {
  return {
    id: id(n),
    status: 'scheduled',
    clientId: null,
    location: null,
    onlineUrl: null,
    agenda: null,
    organizerId: id(1),
    attendeeIds: [],
    contactIds: [],
    cancelledAt: null,
    cancelReason: null,
    createdById: id(1),
    createdAt: '2026-10-06T08:00:00.000Z',
    archivedAt: null,
    ...fields,
  };
}

function shootRecord(
  n: number,
  fields: Partial<ShootRecord> & Pick<ShootRecord, 'title' | 'taskId' | 'startsAt' | 'endsAt'>,
): ShootRecord {
  return {
    id: id(n),
    type: 'product',
    status: 'scheduled',
    clientId: id(601),
    location: 'مطعم الياسمين، فرع المزة',
    mapUrl: null,
    brief: null,
    crew: [{ userId: id(4), role: 'photographer', isLead: true }],
    externalCrew: [],
    shots: [],
    closeNote: null,
    rawFilesUrl: null,
    editingTaskId: null,
    completedAt: null,
    completedById: null,
    cancelledAt: null,
    cancelReason: null,
    createdById: id(3),
    createdAt: '2026-10-06T08:00:00.000Z',
    archivedAt: null,
    ...fields,
  };
}

/**
 * October's bookings around the seeded today: a shoot whose assistant is double-booked with a
 * meeting, a shoot that started this morning and waits to be closed, a cancelled one, and the
 * Photography tasks they belong to.
 */
export function calendarSeed(): {
  shoots: ShootRecord[];
  meetings: MeetingRecord[];
  tasks: TaskRecord[];
} {
  const jasmine = id(601);
  const shot = (n: number, text: string, done = false, note: string | null = null) => ({
    id: id(n),
    text,
    note,
    doneAt: done ? at(PROJECTS_TODAY, '08:10') : null,
    doneById: done ? id(4) : null,
  });
  const shootTask = (n: number, title: string, fields: Partial<TaskRecord> = {}) =>
    taskRecord(n, {
      title,
      department: 'photography',
      assigneeId: id(4),
      clientId: jasmine,
      projectId: id(801),
      ...fields,
    });
  return {
    tasks: [
      shootTask(1701, 'تصوير: أطباق الخريف', { dueDate: '2026-10-12' }),
      shootTask(1702, 'تصوير: فريق العيادة', {
        dueDate: '2026-10-14',
        clientId: id(602),
        projectId: null,
      }),
      shootTask(1703, 'تصوير: افتتاح فرع المالكي', { dueDate: '2026-10-20' }),
      shootTask(1704, 'تصوير: منتجات ركن القهوة', {
        dueDate: PROJECTS_TODAY,
        status: 'in_progress',
        startedAt: at(PROJECTS_TODAY, '07:30'),
      }),
    ],
    shoots: [
      shootRecord(1751, {
        title: 'أطباق الخريف',
        taskId: id(1701),
        startsAt: at('2026-10-12', '10:00'),
        endsAt: at('2026-10-12', '13:00'),
        mapUrl: 'https://maps.app.goo.gl/jasmine-mazzeh',
        brief:
          'خمسة أطباق موسمية على خلفية خشبية داكنة، مع لقطات قريبة للتفاصيل. الأطباق تُجهَّز تباعًا من المطبخ.',
        crew: [
          { userId: id(4), role: 'photographer', isLead: true },
          { userId: id(3), role: 'director', isLead: false },
        ],
        externalCrew: [{ name: 'مازن العلي', role: 'videographer', phone: '+963955700800' }],
        shots: [
          shot(1771, 'طبق الكبة بالكرز من الأعلى'),
          shot(1772, 'لقطة قريبة لصحن المحمّرة', false, 'مع يد تغمس الخبز'),
          shot(1773, 'طاولة كاملة لأربعة أشخاص'),
          shot(1774, 'الحلويات مع القهوة'),
          shot(1775, 'واجهة الفرع عند الغروب'),
        ],
      }),
      shootRecord(1752, {
        title: 'صور فريق العيادة',
        type: 'people',
        clientId: id(602),
        taskId: id(1702),
        startsAt: at('2026-10-14', '09:00'),
        endsAt: at('2026-10-14', '11:00'),
        location: 'عيادات الشفاء، الطابق الثاني',
        createdById: id(1),
      }),
      shootRecord(1753, {
        title: 'افتتاح فرع المالكي',
        type: 'event',
        status: 'cancelled',
        taskId: id(1703),
        startsAt: at('2026-10-20', '18:00'),
        endsAt: at('2026-10-20', '21:00'),
        location: 'مطعم الياسمين، فرع المالكي',
        cancelledAt: '2026-10-08T10:00:00.000Z',
        cancelReason: 'أجّل العميل الافتتاح إلى الشهر القادم.',
      }),
      shootRecord(1754, {
        title: 'منتجات ركن القهوة',
        taskId: id(1704),
        startsAt: at(PROJECTS_TODAY, '07:30'),
        endsAt: at(PROJECTS_TODAY, '09:30'),
        brief: 'أكياس البن الثلاثة والأكواب الجديدة على خلفية فاتحة.',
        shots: [
          shot(1776, 'أكياس البن الثلاثة معًا', true),
          shot(1777, 'كوب القهوة مع البخار', true),
          shot(1778, 'لقطة قريبة لشعار الكيس'),
        ],
      }),
    ],
    meetings: [
      meetingRecord(1761, {
        title: 'خطة محتوى تشرين الثاني',
        clientId: jasmine,
        startsAt: at('2026-10-12', '12:00'),
        endsAt: at('2026-10-12', '13:00'),
        location: 'مكتب فيرتكس، قاعة الاجتماعات',
        onlineUrl: 'https://meet.google.com/vertex-jasmine',
        agenda:
          'مراجعة أداء منشورات تشرين الأول، ثم اعتماد محاور الشهر القادم وعروض افتتاح فرع المالكي.',
        attendeeIds: [id(3)],
        contactIds: [id(611), id(612)],
      }),
      meetingRecord(1762, {
        title: 'المراجعة الأسبوعية',
        startsAt: at('2026-10-11', '09:00'),
        endsAt: at('2026-10-11', '10:00'),
        onlineUrl: 'https://meet.google.com/vertex-weekly',
        organizerId: id(2),
        attendeeIds: [id(1), id(3)],
        createdById: id(2),
      }),
      // Edge case 9: the client was archived after the meeting was set.
      meetingRecord(1763, {
        title: 'تسليم ملفات الحملة',
        clientId: id(604),
        startsAt: at('2026-10-21', '11:00'),
        endsAt: at('2026-10-21', '11:30'),
        location: 'مكتب فيرتكس',
        organizerId: id(2),
        createdById: id(2),
      }),
    ],
  };
}

interface CalendarState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  shoots: ShootRecord[];
  meetings: MeetingRecord[];
  /** For the `invoice_due` key dates (F13). */
  invoices: InvoiceRecord[];
  me: () => MeResponse;
}

/** The calendar API over the in-memory records, with the F11 rules the screens rely on. */
function calendarRoutes({
  users,
  clients,
  projects,
  retainers,
  tasks,
  shoots,
  meetings,
  invoices,
  me,
}: CalendarState) {
  let next = 1800;
  const now = () => TASKS_NOW.toISOString();
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const archivable = (userId: string) => ({
    ...person(userId),
    archived: users.find((u) => u.id === userId)?.status === 'archived',
  });
  const clientOf = (clientId: string | null) => {
    const client = clients.find((c) => c.id === clientId);
    return client ? { id: client.id, name: client.tradeName, archived: client.archived } : null;
  };
  const inPhotography = (userId: string) =>
    !!users.find((u) => u.id === userId)?.departments.some((d) => d.code === 'photography');
  // Mirrors the API's shoot scope (spec F11, "Scopes").
  const covers = (clientId: string | null) =>
    holds('shoots.manage', 'all') ||
    (holds('shoots.manage', 'own_clients') &&
      clients.find((c) => c.id === clientId)?.accountManagerId === me().user.id);

  /** Rule 5: the scheduled shoots and meetings of the users overlapping the time. */
  const conflictsOf = (
    userIds: string[],
    time: { startsAt: string; endsAt: string },
    exclude?: string,
  ): ScheduleConflict[] =>
    userIds.flatMap((userId) => [
      ...shoots
        .filter(
          (s) =>
            s.id !== exclude &&
            s.status === 'scheduled' &&
            !s.archivedAt &&
            s.crew.some((member) => member.userId === userId) &&
            intervalsOverlap(s, time),
        )
        .map((s) => ({
          user: person(userId),
          kind: 'shoot' as const,
          id: s.id,
          title: s.title,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
        })),
      ...meetings
        .filter(
          (m) =>
            m.id !== exclude &&
            m.status === 'scheduled' &&
            !m.archivedAt &&
            [m.organizerId, ...m.attendeeIds].includes(userId) &&
            intervalsOverlap(m, time),
        )
        .map((m) => ({
          user: person(userId),
          kind: 'meeting' as const,
          id: m.id,
          title: m.title,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
        })),
    ]);
  const crewIds = (shoot: ShootRecord) => shoot.crew.map((member) => member.userId);
  const shootConflicts = (shoot: ShootRecord) =>
    shoot.status === 'scheduled' && !shoot.archivedAt
      ? conflictsOf(crewIds(shoot), shoot, shoot.id)
      : [];

  const meetingConflicts = (meeting: MeetingRecord) =>
    meeting.status === 'scheduled' && !meeting.archivedAt
      ? conflictsOf([meeting.organizerId, ...meeting.attendeeIds], meeting, meeting.id)
      : [];

  const summary = (shoot: ShootRecord): Shoot => ({
    id: shoot.id,
    title: shoot.title,
    type: shoot.type,
    status: shoot.status,
    client: clientOf(shoot.clientId),
    startsAt: shoot.startsAt,
    endsAt: shoot.endsAt,
    location: shoot.location,
    lead: archivable(shoot.crew.find((member) => member.isLead)?.userId ?? ''),
    crewCount: shoot.crew.length + shoot.externalCrew.length,
    conflict: shootConflicts(shoot).length > 0,
    archivedAt: shoot.archivedAt,
  });
  const taskOf = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`No task ${taskId} for the shoot`);
    return task;
  };
  const taskSummary = (task: TaskRecord) => ({
    id: task.id,
    title: task.title,
    department: task.department,
    status: task.status,
  });
  const detail = (shoot: ShootRecord): ShootDetail => {
    const scope = covers(shoot.clientId);
    const live = shoot.status === 'scheduled' && !shoot.archivedAt;
    const lead = shoot.crew.find((member) => member.isLead)?.userId === me().user.id;
    const task = taskOf(shoot.taskId);
    return {
      ...summary(shoot),
      mapUrl: shoot.mapUrl,
      brief: shoot.brief,
      crew: [...shoot.crew]
        .sort((a, b) => Number(b.isLead) - Number(a.isLead))
        .map((member) => ({
          user: archivable(member.userId),
          role: member.role,
          isLead: member.isLead,
        })),
      externalCrew: shoot.externalCrew,
      shots: shoot.shots.map((shot, index) => ({
        id: shot.id,
        position: index + 1,
        text: shot.text,
        note: shot.note,
        doneAt: shot.doneAt,
        doneBy: shot.doneById ? person(shot.doneById) : null,
      })),
      task: {
        ...taskSummary(task),
        dependentCount: tasks.filter(
          (t) => t.dependsOn.includes(task.id) && t.status !== 'cancelled' && !t.archived,
        ).length,
      },
      editingTask: shoot.editingTaskId ? taskSummary(taskOf(shoot.editingTaskId)) : null,
      conflicts: shootConflicts(shoot),
      closeNote: shoot.closeNote,
      rawFilesUrl: shoot.rawFilesUrl,
      completedAt: shoot.completedAt,
      completedBy: shoot.completedById ? person(shoot.completedById) : null,
      cancelledAt: shoot.cancelledAt,
      cancelReason: shoot.cancelReason,
      createdBy: person(shoot.createdById),
      createdAt: shoot.createdAt,
      updatedAt: shoot.createdAt,
      permissions: {
        canEdit: live && scope,
        canTick: live && (scope || crewIds(shoot).includes(me().user.id)),
        canClose: live && (scope || lead) && shoot.startsAt <= now(),
        canCancel: live && scope,
        canReopen: shoot.status === 'cancelled' && !shoot.archivedAt && scope,
        canArchive: holds('shoots.manage', 'all'),
      },
    };
  };
  const meetingSummary = (meeting: MeetingRecord): Meeting => ({
    id: meeting.id,
    title: meeting.title,
    status: meeting.status,
    client: clientOf(meeting.clientId),
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    location: meeting.location,
    onlineUrl: meeting.onlineUrl,
    organizer: archivable(meeting.organizerId),
    attendeeCount: meeting.attendeeIds.length,
    conflict: meetingConflicts(meeting).length > 0,
    archivedAt: meeting.archivedAt,
  });
  // Mirrors the API's meeting scope (spec F11, "Scopes").
  const coversMeeting = (meeting: MeetingRecord) =>
    holds('meetings.manage', 'all') ||
    (holds('meetings.manage', 'own_clients') &&
      clients.find((c) => c.id === meeting.clientId)?.accountManagerId === me().user.id) ||
    (holds('meetings.manage', 'assigned') && meeting.organizerId === me().user.id);
  const meetingDetail = (meeting: MeetingRecord): MeetingDetail => {
    const live = meeting.status === 'scheduled' && !meeting.archivedAt;
    const scope = coversMeeting(meeting);
    return {
      ...meetingSummary(meeting),
      agenda: meeting.agenda,
      attendees: meeting.attendeeIds.map(archivable),
      contacts: meeting.contactIds.flatMap((contactId) => {
        const contact = clients.flatMap((c) => c.contacts).find((c) => c.id === contactId);
        return contact
          ? [
              {
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                archived: contact.archived,
              },
            ]
          : [];
      }),
      conflicts: meetingConflicts(meeting),
      cancelledAt: meeting.cancelledAt,
      cancelReason: meeting.cancelReason,
      createdBy: person(meeting.createdById),
      createdAt: meeting.createdAt,
      updatedAt: meeting.createdAt,
      permissions: {
        canEdit: live && scope,
        canCancel: live && scope,
        canArchive: holds('meetings.manage', 'all'),
      },
    };
  };

  /**
   * Rule 15: due dates of open projects and pending milestones, renewals of running retainers, and
   * (F13) due dates of the open invoices the user may read.
   */
  const keyDates = (from: string, to: string): KeyDate[] => {
    const inRange = (date: string | null): date is string => !!date && date >= from && date <= to;
    const client = (clientId: string) =>
      clientOf(clientId) ?? { id: clientId, name: '', archived: false };
    const open = projects.filter((p) => !p.archived && OPEN_STATUSES.includes(p.status));
    return [
      ...open
        .filter((p) => inRange(p.dueDate))
        .map((p) => ({
          kind: 'project_due' as const,
          date: p.dueDate,
          title: p.name,
          targetId: p.id,
          client: client(p.clientId),
          invoiceStatus: null,
        })),
      ...open.flatMap((p) =>
        p.milestones.flatMap((m) =>
          !m.archived && m.status === 'pending' && inRange(m.dueDate)
            ? [
                {
                  kind: 'milestone_due' as const,
                  date: m.dueDate,
                  title: `${m.name} · ${p.name}`,
                  targetId: p.id,
                  client: client(p.clientId),
                  invoiceStatus: null,
                },
              ]
            : [],
        ),
      ),
      ...retainers.flatMap((r) =>
        !r.archived && (r.status === 'active' || r.status === 'paused') && inRange(r.renewalDate)
          ? [
              {
                kind: 'renewal' as const,
                date: r.renewalDate,
                title: r.name,
                targetId: r.id,
                client: client(r.clientId),
                invoiceStatus: null,
              },
            ]
          : [],
      ),
      ...invoices.flatMap((i) => {
        const readable =
          holds('invoices.read', 'all') ||
          (holds('invoices.read', 'own_clients') &&
            clients.find((c) => c.id === i.clientId)?.accountManagerId === me().user.id);
        const totalMinor = invoiceTotal(i.lines);
        const paidMinor = i.payments.reduce((sum, p) => sum + (p.voided ? 0 : p.appliedMinor), 0);
        const status = invoiceStatus({
          status: i.status,
          totalMinor,
          paidMinor,
          dueOn: i.dueOn,
          today: businessDate(),
        });
        const open = (OPEN_INVOICE_STATUSES as readonly InvoiceStatus[]).includes(status);
        return readable && open && !i.archivedAt && i.year && i.number && inRange(i.dueOn)
          ? [
              {
                kind: 'invoice_due' as const,
                date: i.dueOn,
                title: invoiceDisplayNumber({ year: i.year, number: i.number }),
                targetId: i.id,
                client: client(i.clientId),
                invoiceStatus: status,
              },
            ]
          : [];
      }),
    ].sort((a, b) => a.date.localeCompare(b.date));
  };

  // Answers a calendar request, or returns undefined to let the other mocks try.
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const q = url.searchParams;
    const body = <T>() => request.postDataJSON() as T;

    if (path === '/api/calendar' && method === 'GET') {
      const from = q.get('from') ?? PROJECTS_TODAY;
      const to = q.get('to') ?? PROJECTS_TODAY;
      const kinds = q.getAll('kinds');
      const shows = (kind: string) => kinds.length === 0 || kinds.includes(kind);
      const clientId = q.get('clientId');
      const userId = q.get('userId') === 'me' ? me().user.id : q.get('userId');
      const range = { startsAt: at(from, '00:00'), endsAt: at(addDays(to, 1), '00:00') };
      const calendar: Calendar = {
        from,
        to,
        shoots: shows('shoot')
          ? shoots
              .filter(
                (s) =>
                  !s.archivedAt &&
                  intervalsOverlap(s, range) &&
                  (!clientId || s.clientId === clientId) &&
                  (!userId || crewIds(s).includes(userId)) &&
                  (!q.get('shootType') || s.type === q.get('shootType')),
              )
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map(summary)
          : [],
        meetings: shows('meeting')
          ? meetings
              .filter(
                (m) =>
                  !m.archivedAt &&
                  intervalsOverlap(m, range) &&
                  (!clientId || m.clientId === clientId) &&
                  (!userId || [m.organizerId, ...m.attendeeIds].includes(userId)),
              )
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map(meetingSummary)
          : [],
        keyDates: keyDates(from, to).filter(
          (keyDate) =>
            shows(keyDate.kind) &&
            (!clientId || keyDate.client.id === clientId) &&
            (!userId ||
              clients.find((c) => c.id === keyDate.client.id)?.accountManagerId === userId ||
              projects.find((p) => p.id === keyDate.targetId)?.projectManagerId === userId),
        ),
      };
      return json(route, calendar);
    }
    if (path === '/api/calendar/conflicts' && method === 'GET') {
      const items = conflictsOf(
        q.getAll('userIds'),
        { startsAt: q.get('startsAt') ?? '', endsAt: q.get('endsAt') ?? '' },
        q.get('excludeShootId') ?? q.get('excludeMeetingId') ?? undefined,
      );
      return json(route, { items });
    }

    if (path === '/api/meetings' && method === 'POST') {
      const { acceptConflicts, ...input } = body<CreateMeeting>();
      // Rule 14: the creator organizes it.
      const conflicts = conflictsOf([me().user.id, ...input.attendeeIds], input);
      if (conflicts.length > 0 && !acceptConflicts) {
        return fail(route, 409, 'SCHEDULE_CONFLICT', conflicts);
      }
      const created = meetingRecord(next++, {
        ...input,
        organizerId: me().user.id,
        createdById: me().user.id,
        createdAt: now(),
      });
      meetings.push(created);
      return json(route, meetingDetail(created), 201);
    }
    const meetingMatch = path.match(/^\/api\/meetings\/([^/]+)(?:\/(.+))?$/);
    if (meetingMatch) {
      const meeting = meetings.find((m) => m.id === meetingMatch[1]);
      if (!meeting || (meeting.archivedAt && !holds('meetings.manage', 'all'))) {
        return fail(route, 404, null);
      }
      const action = meetingMatch[2];
      if (!action && method === 'GET') return json(route, meetingDetail(meeting));
      if ((action === 'archive' || action === 'restore') && method === 'POST') {
        if (!holds('meetings.manage', 'all')) return fail(route, 403, null);
        meeting.archivedAt = action === 'archive' ? now() : null;
        return json(route, meetingDetail(meeting));
      }
      // Editing and cancelling need meeting scope on a scheduled meeting.
      if (!coversMeeting(meeting)) return fail(route, 403, null);
      if (meeting.status !== 'scheduled' || meeting.archivedAt) {
        return fail(route, 409, 'MEETING_NOT_SCHEDULED');
      }
      if (!action && method === 'PATCH') {
        const { acceptConflicts, ...input } = body<UpdateMeeting>();
        const changed = { ...meeting, ...input };
        const conflicts = conflictsOf(
          [changed.organizerId, ...changed.attendeeIds],
          changed,
          meeting.id,
        );
        if (conflicts.length > 0 && !acceptConflicts) {
          return fail(route, 409, 'SCHEDULE_CONFLICT', conflicts);
        }
        Object.assign(meeting, input);
        return json(route, meetingDetail(meeting));
      }
      if (action === 'cancel' && method === 'POST') {
        meeting.status = 'cancelled';
        meeting.cancelledAt = now();
        meeting.cancelReason = body<CancelMeeting>().reason;
        return json(route, meetingDetail(meeting));
      }
      return undefined;
    }

    if (path === '/api/shoots' && method === 'GET') {
      const items = shoots
        .filter(
          (s) =>
            !s.archivedAt &&
            (!q.get('taskId') || s.taskId === q.get('taskId')) &&
            (!q.get('clientId') || s.clientId === q.get('clientId')),
        )
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
        .map(summary);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/shoots' && method === 'POST') {
      const input = body<CreateShoot>();
      const booked = input.taskId ? tasks.find((t) => t.id === input.taskId) : undefined;
      const clientId = booked ? booked.clientId : (input.clientId ?? null);
      if (!covers(clientId)) return fail(route, 403, null);
      if (
        booked &&
        shoots.some((s) => s.taskId === booked.id && s.status !== 'cancelled' && !s.archivedAt)
      ) {
        return fail(route, 409, 'TASK_NOT_BOOKABLE');
      }
      const conflicts = conflictsOf(
        input.crew.map((member) => member.userId),
        input,
      );
      if (conflicts.length > 0 && !input.acceptConflicts) {
        return fail(route, 409, 'SCHEDULE_CONFLICT', conflicts);
      }
      const lead = input.crew.find((member) => member.isLead);
      const day = calendarDay(input.startsAt);
      // Rule 3: a new shoot task in Photography, assigned to the lead when they belong to it.
      const task =
        booked ??
        taskRecord(next++, {
          title: shootTaskTitle(input.title),
          department: 'photography',
          assigneeId: lead && inPhotography(lead.userId) ? lead.userId : null,
          clientId,
          projectId: input.newTask?.projectId ?? null,
          milestoneId: input.newTask?.milestoneId ?? null,
          cycleId: input.newTask?.retainerCycleId ?? null,
          cycleLineId: input.newTask?.cycleLineId ?? null,
          createdById: me().user.id,
          createdAt: now(),
        });
      if (!booked) tasks.push(task);
      // Rule 4: the task is due on the shoot's day.
      task.dueDate = day;
      const created = shootRecord(next++, {
        title: input.title,
        type: input.type,
        clientId,
        taskId: task.id,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        location: input.location,
        mapUrl: input.mapUrl,
        brief: input.brief,
        crew: input.crew,
        externalCrew: input.externalCrew,
        shots: input.shots.map((shot) => ({
          id: id(next++),
          text: shot.text,
          note: shot.note,
          doneAt: null,
          doneById: null,
        })),
        createdById: me().user.id,
        createdAt: now(),
      });
      shoots.push(created);
      return json(route, detail(created), 201);
    }

    const match = path.match(/^\/api\/shoots\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const shoot = shoots.find((s) => s.id === match[1]);
    if (!shoot || (shoot.archivedAt && !holds('shoots.manage', 'all'))) {
      return fail(route, 404, null);
    }
    const action = match[2];
    const scope = covers(shoot.clientId);
    const scheduled = shoot.status === 'scheduled' && !shoot.archivedAt;
    if (!action && method === 'GET') return json(route, detail(shoot));

    const tick = action?.match(/^shots\/([^/]+)\/done$/);
    if (tick && method === 'POST') {
      if (!scope && !crewIds(shoot).includes(me().user.id)) return fail(route, 403, null);
      if (!scheduled) return fail(route, 409, 'SHOOT_NOT_SCHEDULED');
      const shot = shoot.shots.find((s) => s.id === tick[1]);
      if (!shot) return fail(route, 404, null);
      const { done } = body<{ done: boolean }>();
      shot.doneAt = done ? now() : null;
      shot.doneById = done ? me().user.id : null;
      const listed = detail(shoot).shots.find((s) => s.id === shot.id);
      return json(route, listed);
    }
    if (action === 'close' && method === 'POST') {
      const lead = shoot.crew.find((member) => member.isLead)?.userId === me().user.id;
      if (!scope && !lead) return fail(route, 403, null);
      if (!scheduled) return fail(route, 409, 'SHOOT_NOT_SCHEDULED');
      if (shoot.startsAt > now()) return fail(route, 409, 'SHOOT_NOT_STARTED');
      const input = body<CloseShoot>();
      const task = taskOf(shoot.taskId);
      // Rule 11: the shoot task is delivered unless it already is.
      if (task.status !== 'delivered') {
        task.status = 'delivered';
        task.deliveredAt = now();
      }
      if (input.editingTask) {
        // Rule 12: the editing task takes the shoot task's client and links, and waits on it.
        const editing = taskRecord(next++, {
          title: input.editingTask.title,
          brief: input.note,
          department: input.editingTask.department,
          assigneeId: input.editingTask.assigneeId,
          dueDate: input.editingTask.dueDate,
          needsClientApproval: input.editingTask.needsClientApproval,
          clientId: task.clientId,
          projectId: task.projectId,
          milestoneId: task.milestoneId,
          retainerId: task.retainerId,
          cycleId: task.cycleId,
          dependsOn: [task.id],
          links: input.rawFilesUrl
            ? [
                {
                  id: id(next++),
                  url: input.rawFilesUrl,
                  label: null,
                  addedById: me().user.id,
                  archived: false,
                },
              ]
            : [],
          createdById: me().user.id,
          createdAt: now(),
        });
        tasks.push(editing);
        shoot.editingTaskId = editing.id;
      }
      shoot.status = 'completed';
      shoot.completedAt = now();
      shoot.completedById = me().user.id;
      shoot.closeNote = input.note;
      shoot.rawFilesUrl = input.rawFilesUrl;
      return json(route, detail(shoot));
    }

    // Everything below needs shoot scope.
    if (!scope) return fail(route, 403, null);
    if (!action && method === 'PATCH') {
      if (!scheduled) return fail(route, 409, 'SHOOT_NOT_SCHEDULED');
      const { acceptConflicts, ...input } = body<UpdateShoot>();
      const time = {
        startsAt: input.startsAt ?? shoot.startsAt,
        endsAt: input.endsAt ?? shoot.endsAt,
      };
      const conflicts = conflictsOf(
        (input.crew ?? shoot.crew).map((member) => member.userId),
        time,
        shoot.id,
      );
      if (conflicts.length > 0 && !acceptConflicts) {
        return fail(route, 409, 'SCHEDULE_CONFLICT', conflicts);
      }
      Object.assign(shoot, input);
      taskOf(shoot.taskId).dueDate = calendarDay(shoot.startsAt);
      return json(route, detail(shoot));
    }
    if (action === 'shots' && method === 'PUT') {
      if (!scheduled) return fail(route, 409, 'SHOOT_NOT_SCHEDULED');
      const { shots } = body<ShotListInput>();
      // Rule 7: kept items keep their ids and ticks.
      shoot.shots = shots.map((shot) => {
        const kept = shoot.shots.find((s) => s.id === shot.id);
        return {
          id: kept?.id ?? id(next++),
          text: shot.text,
          note: shot.note,
          doneAt: kept?.doneAt ?? null,
          doneById: kept?.doneById ?? null,
        };
      });
      return json(route, detail(shoot));
    }
    if (action === 'cancel' && method === 'POST') {
      if (!scheduled) return fail(route, 409, 'SHOOT_NOT_SCHEDULED');
      const input = body<CancelShoot>();
      shoot.status = 'cancelled';
      shoot.cancelledAt = now();
      shoot.cancelReason = input.reason;
      if (input.cancelTask) {
        const task = taskOf(shoot.taskId);
        task.status = 'cancelled';
        task.cancelledAt = now();
        task.cancelReason = input.reason;
      }
      return json(route, detail(shoot));
    }
    if (action === 'reopen' && method === 'POST') {
      if (shoot.status !== 'cancelled') return fail(route, 409, 'SHOOT_NOT_CANCELLED');
      const conflicts = conflictsOf(crewIds(shoot), shoot, shoot.id);
      if (conflicts.length > 0 && !body<ReopenShoot>().acceptConflicts) {
        return fail(route, 409, 'SCHEDULE_CONFLICT', conflicts);
      }
      shoot.status = 'scheduled';
      shoot.cancelledAt = null;
      shoot.cancelReason = null;
      return json(route, detail(shoot));
    }
    if ((action === 'archive' || action === 'restore') && method === 'POST') {
      if (!holds('shoots.manage', 'all')) return fail(route, 403, null);
      shoot.archivedAt = action === 'archive' ? now() : null;
      return json(route, detail(shoot));
    }
    return undefined;
  };
}

/** Ids of the seeded team, for navigating straight to a profile or department. */ // Service catalog (F04)

type ServiceRecord = Omit<CatalogService, 'template'> & { templateId: string | null };

type PackageRecord = Omit<CatalogPackage, 'items' | 'template'> & {
  templateId: string | null;
  items: { serviceId: string; quantity: number }[];
};

interface CatalogRecords {
  services: ServiceRecord[];
  packages: PackageRecord[];
}

const catalogTimes = {
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
};

/** The acceptance catalog: three monthly services, a one-off one, and the Gold social package. */
export function catalogSeed(): CatalogRecords {
  const service = (
    n: number,
    fields: Partial<ServiceRecord> & Pick<ServiceRecord, 'name' | 'department' | 'billing'>,
  ): ServiceRecord => ({
    id: id(n),
    description: null,
    priceUsdMinor: 0,
    priceSypMinor: null,
    revisionRounds: 2,
    deliverableKind: null,
    deliverableLabel: null,
    templateId: null,
    ...catalogTimes,
    archivedAt: null,
    ...fields,
  });
  return {
    services: [
      service(9001, {
        name: 'تصميم سوشال ميديا',
        department: 'design',
        billing: 'monthly',
        priceUsdMinor: 1500,
        priceSypMinor: 200000,
        deliverableKind: 'design',
      }),
      service(9002, {
        name: 'ريل',
        department: 'photography',
        billing: 'monthly',
        priceUsdMinor: 6000,
        deliverableKind: 'reel',
      }),
      service(9003, {
        name: 'إدارة صفحة',
        department: 'content_management',
        billing: 'monthly',
        priceUsdMinor: 10000,
        description: 'نشر وردود ومتابعة يومية على المنصات.',
      }),
      service(9004, {
        name: 'هوية بصرية',
        department: 'design',
        billing: 'one_off',
        priceUsdMinor: 80000,
        revisionRounds: 3,
        templateId: id(2000),
      }),
      service(9005, {
        name: 'تقرير أداء قديم',
        department: 'marketing',
        billing: 'monthly',
        priceUsdMinor: 5000,
        archivedAt: '2026-09-25T08:00:00.000Z',
      }),
    ],
    packages: [
      {
        id: id(9051),
        name: 'باقة السوشال الذهبية',
        description: null,
        billing: 'monthly',
        priceUsdMinor: 45000,
        priceSypMinor: null,
        templateId: id(2100),
        items: [
          { serviceId: id(9001), quantity: 12 },
          { serviceId: id(9002), quantity: 4 },
          { serviceId: id(9003), quantity: 2 },
        ],
        ...catalogTimes,
        archivedAt: null,
      },
    ],
  };
}

interface CatalogState {
  catalog: CatalogRecords;
  templates: TemplateRecord[];
  me: () => MeResponse;
}

type Named = { id: string; name: string; archivedAt: string | null };

/** The fields a partial update names; `undefined` means "unchanged". */
const definedFields = <T extends object>(input: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

/** The catalog API over the in-memory records, with the F04 rules the screens rely on. */
function catalogRoutes({ catalog, templates, me }: CatalogState) {
  const holds = (permission: Permission) =>
    me().permissions.some((g) => g.permission === permission);
  let nextId = 9100;
  const changedAt = '2026-10-10T09:00:00.000Z';

  const templateOf = (templateId: string | null) => {
    const template = templates.find((t) => t.id === templateId);
    return template
      ? { id: template.id, name: template.name, kind: template.kind, archived: template.archived }
      : null;
  };
  const serviceOf = ({ templateId, ...s }: ServiceRecord): CatalogService => ({
    ...s,
    template: templateOf(templateId),
  });
  const packageOf = ({ templateId, items, ...p }: PackageRecord): CatalogPackage => ({
    ...p,
    template: templateOf(templateId),
    items: items.flatMap((item) => {
      const s = catalog.services.find((x) => x.id === item.serviceId);
      if (!s) return [];
      return [
        {
          serviceId: s.id,
          name: s.name,
          department: s.department,
          quantity: item.quantity,
          deliverableKind: s.deliverableKind,
          deliverableLabel: s.deliverableLabel,
          archived: !!s.archivedAt,
        },
      ];
    }),
  });
  const taken = (list: Named[], name: string, except?: string) =>
    list.some(
      (x) => !x.archivedAt && x.id !== except && x.name.toLowerCase() === name.toLowerCase(),
    );
  const invalidTemplate = (templateId: string | null, billing: CatalogBilling) => {
    if (!templateId) return false;
    const template = templates.find((t) => t.id === templateId);
    return !template || template.archived || template.kind !== TEMPLATE_KIND_BY_BILLING[billing];
  };
  const invalidItems = (items: { serviceId: string }[], billing: CatalogBilling) =>
    items
      .map((item) => item.serviceId)
      .filter((serviceId) => {
        const s = catalog.services.find((x) => x.id === serviceId);
        return !s || !!s.archivedAt || s.billing !== billing;
      });
  const listed = <T>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 25 });
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ar');

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    if (!path.startsWith('/api/catalog/')) return undefined;
    if (!holds('catalog.read')) return fail(route, 403, null);
    const manages = holds('catalog.manage');
    const archived = url.searchParams.get('archived') === 'true';
    const billing = url.searchParams.get('billing');
    const search = url.searchParams.get('search')?.toLowerCase();
    const matches = (x: Named & { billing: string }) =>
      !!x.archivedAt === archived &&
      (!billing || x.billing === billing) &&
      (!search || x.name.toLowerCase().includes(search));

    if (path === '/api/catalog/services' && method === 'GET') {
      if (archived && !manages) return fail(route, 403, null);
      const department = url.searchParams.get('department');
      const items = catalog.services
        .filter((s) => matches(s) && (!department || s.department === department))
        .sort(byName)
        .map(serviceOf);
      return json(route, listed(items));
    }
    if (path === '/api/catalog/packages' && method === 'GET') {
      if (archived && !manages) return fail(route, 403, null);
      return json(route, listed(catalog.packages.filter(matches).sort(byName).map(packageOf)));
    }
    if (path === '/api/catalog/services' && method === 'POST') {
      if (!manages) return fail(route, 403, null);
      const input = createCatalogServiceSchema.parse(request.postDataJSON());
      if (taken(catalog.services, input.name)) return fail(route, 409, 'SERVICE_NAME_TAKEN');
      if (invalidTemplate(input.templateId, input.billing)) {
        return fail(route, 400, 'INVALID_TEMPLATE');
      }
      const created: ServiceRecord = {
        id: id(nextId++),
        ...input,
        ...catalogTimes,
        archivedAt: null,
      };
      catalog.services.push(created);
      return json(route, serviceOf(created), 201);
    }
    if (path === '/api/catalog/packages' && method === 'POST') {
      if (!manages) return fail(route, 403, null);
      const input = createCatalogPackageSchema.parse(request.postDataJSON());
      if (taken(catalog.packages, input.name)) return fail(route, 409, 'PACKAGE_NAME_TAKEN');
      const invalid = invalidItems(input.items, input.billing);
      if (invalid.length) return fail(route, 400, 'INVALID_PACKAGE_ITEM', { serviceIds: invalid });
      if (invalidTemplate(input.templateId, input.billing)) {
        return fail(route, 400, 'INVALID_TEMPLATE');
      }
      const created: PackageRecord = {
        id: id(nextId++),
        ...input,
        ...catalogTimes,
        archivedAt: null,
      };
      catalog.packages.push(created);
      return json(route, packageOf(created), 201);
    }

    const serviceMatch = path.match(/^\/api\/catalog\/services\/([^/]+)(?:\/(archive|restore))?$/);
    if (serviceMatch) {
      if (!manages) return fail(route, 403, null);
      const s = catalog.services.find((x) => x.id === serviceMatch[1]);
      if (!s) return fail(route, 404, null);
      const action = serviceMatch[2];
      if (action === 'archive') {
        if (s.archivedAt) return fail(route, 409, 'SERVICE_ARCHIVED');
        const using = catalog.packages.filter(
          (p) => !p.archivedAt && p.items.some((item) => item.serviceId === s.id),
        );
        if (using.length) {
          return fail(route, 409, 'SERVICE_IN_PACKAGE', {
            packages: using.map((p) => ({ id: p.id, name: p.name })),
          });
        }
        s.archivedAt = changedAt;
        return json(route, serviceOf(s));
      }
      if (action === 'restore') {
        if (!s.archivedAt) return fail(route, 409, 'SERVICE_NOT_ARCHIVED');
        if (taken(catalog.services, s.name, s.id)) return fail(route, 409, 'SERVICE_NAME_TAKEN');
        s.archivedAt = null;
        return json(route, serviceOf(s));
      }
      if (method !== 'PATCH') return undefined;
      if (s.archivedAt) return fail(route, 409, 'SERVICE_ARCHIVED');
      const merged = {
        ...s,
        ...definedFields(updateCatalogServiceSchema.parse(request.postDataJSON())),
      };
      if (serviceIssues(merged).length) return fail(route, 400, null);
      if (taken(catalog.services, merged.name, s.id)) return fail(route, 409, 'SERVICE_NAME_TAKEN');
      const inPackage = catalog.packages.some((p) => p.items.some((i) => i.serviceId === s.id));
      if (merged.billing !== s.billing && inPackage) return fail(route, 409, 'SERVICE_IN_USE');
      if (
        merged.templateId !== s.templateId &&
        invalidTemplate(merged.templateId, merged.billing)
      ) {
        return fail(route, 400, 'INVALID_TEMPLATE');
      }
      Object.assign(s, merged, { updatedAt: changedAt });
      return json(route, serviceOf(s));
    }

    const packageMatch = path.match(/^\/api\/catalog\/packages\/([^/]+)(?:\/(archive|restore))?$/);
    if (!packageMatch) return undefined;
    const p = catalog.packages.find((x) => x.id === packageMatch[1]);
    if (!p || (p.archivedAt && !manages)) return fail(route, 404, null);
    const action = packageMatch[2];
    if (!action && method === 'GET') return json(route, packageOf(p));
    if (!manages) return fail(route, 403, null);
    if (action === 'archive') {
      if (p.archivedAt) return fail(route, 409, 'PACKAGE_ARCHIVED');
      p.archivedAt = changedAt;
      return json(route, packageOf(p));
    }
    if (action === 'restore') {
      if (!p.archivedAt) return fail(route, 409, 'PACKAGE_NOT_ARCHIVED');
      if (taken(catalog.packages, p.name, p.id)) return fail(route, 409, 'PACKAGE_NAME_TAKEN');
      p.archivedAt = null;
      return json(route, packageOf(p));
    }
    if (method !== 'PATCH') return undefined;
    if (p.archivedAt) return fail(route, 409, 'PACKAGE_ARCHIVED');
    const input = updateCatalogPackageSchema.parse(request.postDataJSON());
    const merged = { ...p, ...definedFields(input) };
    if (packageIssues(merged).length) return fail(route, 400, null);
    if (taken(catalog.packages, merged.name, p.id)) return fail(route, 409, 'PACKAGE_NAME_TAKEN');
    const invalid = invalidItems(merged.items, merged.billing);
    if ((input.items || merged.billing !== p.billing) && invalid.length) {
      return fail(route, 400, 'INVALID_PACKAGE_ITEM', { serviceIds: invalid });
    }
    Object.assign(p, merged, { updatedAt: changedAt });
    return json(route, packageOf(p));
  };
}

// Quotes (F04)

type QuoteLineRecord = Omit<QuoteLine, 'totalMinor' | 'catalogArchived'>;

interface QuoteRecord
  extends Omit<
    QuoteDetail,
    | 'displayNumber'
    | 'client'
    | 'recipient'
    | 'lead'
    | 'accountManager'
    | 'contact'
    | 'oneOffNetMinor'
    | 'monthlyNetMinor'
    | 'expiresSoon'
    | 'sentBy'
    | 'createdBy'
    | 'lines'
    | 'installments'
    | 'totals'
    | 'discountThresholdPercent'
    | 'needsDiscountApproval'
    | 'versions'
    | 'permissions'
  > {
  /** Null for a lead quote until its lead is converted (F03). */
  clientId: string | null;
  leadId: string | null;
  contactId: string | null;
  sentById: string | null;
  createdById: string;
  lines: QuoteLineRecord[];
  installments: { id: string; name: string; percent: number }[];
}

interface QuoteRecords {
  quotes: QuoteRecord[];
  settings: Omit<QuoteSettings, 'canEdit' | 'canEditThreshold'>;
}

const quoteTimes = {
  createdAt: '2026-09-28T08:00:00.000Z',
  updatedAt: '2026-09-28T08:00:00.000Z',
};

/** Brand identity (one-off) and Gold social (monthly) as quote lines, at catalog prices. */
function seedQuoteLines(first: number): QuoteLineRecord[] {
  return [
    {
      id: id(first),
      section: 'one_off',
      serviceId: id(9004),
      packageId: null,
      name: 'هوية بصرية',
      description: 'شعار ودليل هوية وتطبيقات أساسية.',
      department: 'design',
      quantity: 1,
      unitPriceMinor: 80000,
      listUnitPriceMinor: 80000,
      revisionRounds: 3,
      deliverableKind: null,
      deliverableLabel: null,
      templateId: id(2000),
      items: [],
    },
    {
      id: id(first + 1),
      section: 'monthly',
      serviceId: null,
      packageId: id(9051),
      name: 'باقة السوشال الذهبية',
      description: null,
      department: null,
      quantity: 1,
      unitPriceMinor: 45000,
      listUnitPriceMinor: 45000,
      revisionRounds: null,
      deliverableKind: null,
      deliverableLabel: null,
      templateId: id(2100),
      items: [
        { serviceId: id(9001), name: 'تصميم سوشال ميديا', quantity: 12, revisionRounds: 2 },
        { serviceId: id(9002), name: 'ريل', quantity: 4, revisionRounds: 2 },
        { serviceId: id(9003), name: 'إدارة صفحة', quantity: 2, revisionRounds: 2 },
      ].map((item, index) => ({
        id: id(first + 10 + index),
        ...item,
        department: (['design', 'photography', 'content_management'] as const)[index] ?? 'design',
        deliverableKind: (['design', 'reel', null] as const)[index] ?? null,
        deliverableLabel: null,
        templateId: null,
      })),
    },
  ];
}

/**
 * Four quotes: Jasmine's sent quote, its draft awaiting the General Manager's approval, a Shifa
 * draft whose discount needs approval, and an expired Shifa quote.
 */
export function quotesSeed(): QuoteRecords {
  const quote = (
    n: number,
    fields: Partial<QuoteRecord> & Pick<QuoteRecord, 'number' | 'title' | 'clientId'>,
  ): QuoteRecord => ({
    id: id(n),
    year: 2026,
    version: 1,
    leadId: null,
    contactId: null,
    currency: 'USD',
    status: 'draft',
    discountApproval: 'none',
    discountDecision: null,
    oneOffDiscountMinor: 0,
    monthlyDiscountMinor: 0,
    monthlyTermMonths: 6,
    validityDays: 14,
    validUntil: null,
    clientNotes: null,
    terms: 'تُدفع الدفعة الأولى عند التوقيع.',
    sentAt: null,
    sentById: null,
    response: null,
    createdById: id(3),
    project: null,
    retainer: null,
    pdf: null,
    draftPdf: null,
    lines: seedQuoteLines(n * 100),
    installments: [
      { id: id(n * 100 + 50), name: 'البداية', percent: 50 },
      { id: id(n * 100 + 51), name: 'التسليم', percent: 50 },
    ],
    archivedAt: null,
    ...quoteTimes,
    ...fields,
  });
  const today = businessDate();
  return {
    settings: {
      companyDetails: 'Vertex Media\nدمشق، المزة\n+963 11 000 0000\nhello@vertex.example',
      defaultTerms: 'تُدفع الدفعة الأولى عند التوقيع.',
      defaultValidityDays: 14,
      discountThresholdPercent: 10,
      updatedAt: '2026-09-20T08:00:00.000Z',
      updatedBy: { id: id(1), name: 'سارة الخطيب' },
    },
    quotes: [
      quote(9201, {
        number: 1,
        title: 'هوية وسوشال الياسمين',
        clientId: id(601),
        contactId: id(611),
        status: 'sent',
        sentAt: `${addDays(today, -2)}T09:00:00.000Z`,
        sentById: id(3),
        validUntil: addDays(today, 2),
        pdf: { state: 'ready' },
      }),
      quote(9202, {
        number: 2,
        title: 'حملة رمضان',
        clientId: id(601),
        discountApproval: 'pending',
        oneOffDiscountMinor: 12000,
        lines: seedQuoteLines(920200).slice(0, 1),
        installments: [{ id: id(9202050), name: 'دفعة واحدة', percent: 100 }],
      }),
      quote(9203, {
        number: 3,
        title: 'محتوى عيادة الشفاء',
        clientId: id(602),
        createdById: id(1),
        monthlyDiscountMinor: 9000,
        lines: seedQuoteLines(920300).slice(1),
        installments: [],
      }),
      quote(9204, {
        number: 4,
        title: 'موقع العيادة',
        clientId: id(602),
        createdById: id(1),
        status: 'expired',
        sentAt: '2026-09-01T09:00:00.000Z',
        sentById: id(1),
        validUntil: '2026-09-15',
        pdf: { state: 'ready' },
        lines: seedQuoteLines(920400).slice(0, 1),
      }),
      // F03: a sent quote on the Rashaqa lead, not converted yet.
      quote(9205, {
        number: 5,
        title: 'باقة سوشال صالة رشاقة',
        clientId: null,
        leadId: id(9704),
        createdById: id(1),
        status: 'sent',
        sentAt: `${addDays(today, -1)}T09:00:00.000Z`,
        sentById: id(1),
        validUntil: addDays(today, 13),
        pdf: { state: 'ready' },
        lines: seedQuoteLines(920500).slice(1),
        installments: [],
      }),
    ],
  };
}

interface QuoteState {
  quoting: QuoteRecords;
  catalog: CatalogRecords;
  clients: ClientRecord[];
  users: UserResponse[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  templates: TemplateRecord[];
  leads: LeadRecord[];
  leadRules: LeadRuleSet;
  me: () => MeResponse;
}

/** The quotes API over the in-memory records, with the F04 rules the screens rely on. */
function quoteRoutes({
  quoting,
  catalog,
  clients,
  users,
  projects,
  retainers,
  templates,
  leads,
  leadRules,
  me,
}: QuoteState) {
  const { quotes, settings } = quoting;
  let nextId = 9300;
  let clock = Date.parse('2026-10-02T09:00:00.000Z');
  const now = () => {
    clock += 60_000;
    return new Date(clock).toISOString();
  };
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const holds = (permission: Permission) => scopes(permission).length > 0;
  const coversClient = (permission: Permission, clientId: string) => {
    const granted = scopes(permission);
    const client = clients.find((c) => c.id === clientId);
    return (
      granted.includes('all') ||
      (granted.includes('own_clients') && client?.accountManagerId === me().user.id)
    );
  };
  const leadOf = (q: Pick<QuoteRecord, 'leadId'>) => leads.find((l) => l.id === q.leadId);
  /** A client quote by its client; a lead quote, until converted, by the lead's owner (F03). */
  const covers = (permission: Permission, q: Pick<QuoteRecord, 'clientId' | 'leadId'>) => {
    if (q.clientId) return coversClient(permission, q.clientId);
    const lead = leadOf(q);
    return !!lead && leadRules.covers(permission, lead);
  };
  const person = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return { id: userId, name: user?.name ?? '' };
  };
  const catalogPriceOf = (
    item: { priceUsdMinor: number; priceSypMinor: number | null },
    currency: Currency,
  ) => (currency === 'USD' ? item.priceUsdMinor : item.priceSypMinor);
  const totalsOf = (
    q: Pick<
      QuoteRecord,
      'lines' | 'oneOffDiscountMinor' | 'monthlyDiscountMinor' | 'monthlyTermMonths'
    > & { installments: { percent: number }[] },
  ) =>
    quoteTotals({
      lines: q.lines,
      oneOffDiscountMinor: q.oneOffDiscountMinor,
      monthlyDiscountMinor: q.monthlyDiscountMinor,
      installments: q.installments,
      monthlyTermMonths: q.monthlyTermMonths,
    });
  const latestOf = (q: QuoteRecord) =>
    quotes
      .filter((x) => x.year === q.year && x.number === q.number && !x.archivedAt)
      .reduce((a, b) => (b.version > a.version ? b : a), q);

  const detailOf = (q: QuoteRecord): QuoteDetail => {
    const client = clients.find((c) => c.id === q.clientId);
    const lead = leadOf(q);
    const contact = client?.contacts.find((c) => c.id === q.contactId);
    const totals = totalsOf(q);
    const manages = covers('quotes.manage', q) && !q.archivedAt;
    const draft = q.status === 'draft';
    const needs = needsDiscountApproval(totals, settings.discountThresholdPercent);
    const approver = holds('quotes.approve_discount');
    const latest = latestOf(q).id === q.id;
    const newerDraft = quotes.some(
      (x) =>
        x.number === q.number && x.version > q.version && x.status === 'draft' && !x.archivedAt,
    );
    const daysLeft = q.validUntil
      ? (Date.parse(q.validUntil) - Date.parse(businessDate())) / 86_400_000
      : null;
    return {
      ...q,
      displayNumber: quoteDisplayNumber(q),
      client: client ? { id: client.id, name: client.tradeName } : null,
      recipient: client
        ? { kind: 'client', id: client.id, name: client.tradeName }
        : { kind: 'lead', id: lead?.id ?? '', name: lead ? leadDisplayName(lead) : '' },
      accountManager: person(client?.accountManagerId ?? lead?.ownerId ?? id(1)),
      contact: contact ? { id: contact.id, name: contact.name, archived: contact.archived } : null,
      lead: lead ? { id: lead.id, displayName: leadDisplayName(lead), stage: lead.stage } : null,
      oneOffNetMinor: totals.oneOff.netMinor,
      monthlyNetMinor: totals.monthly.netMinor,
      expiresSoon:
        q.status === 'sent' && daysLeft !== null && daysLeft <= QUOTE_LIMITS.expiresSoonDays,
      sentBy: q.sentById ? person(q.sentById) : null,
      createdBy: person(q.createdById),
      lines: q.lines.map((line, index) => ({
        ...line,
        totalMinor: totals.lineTotalsMinor[index] ?? 0,
        catalogArchived: !!(line.serviceId
          ? catalog.services.find((s) => s.id === line.serviceId)?.archivedAt
          : catalog.packages.find((p) => p.id === line.packageId)?.archivedAt),
      })),
      installments: q.installments.map((installment, index) => ({
        ...installment,
        amountMinor: totals.installmentAmountsMinor[index] ?? 0,
      })),
      totals: {
        oneOff: totals.oneOff,
        monthly: totals.monthly,
        monthlyTermTotalMinor: totals.monthlyTermTotalMinor,
      },
      discountThresholdPercent: settings.discountThresholdPercent,
      needsDiscountApproval: needs,
      versions: quotes
        .filter((x) => x.year === q.year && x.number === q.number && !x.archivedAt)
        .sort((a, b) => a.version - b.version)
        .map((x) => ({ id: x.id, version: x.version, status: x.status })),
      permissions: {
        canEdit: manages && draft && q.discountApproval !== 'pending',
        canRequestApproval:
          manages && draft && needs && ['none', 'returned'].includes(q.discountApproval),
        canWithdrawApproval: manages && draft && q.discountApproval === 'pending',
        canDecideApproval: approver && draft && q.discountApproval === 'pending',
        canSend: manages && draft && q.discountApproval !== 'pending',
        canExtend: manages && q.status === 'expired',
        canReject: manages && ['sent', 'expired'].includes(q.status),
        canCreateVersion:
          manages && latest && !newerDraft && ['sent', 'expired', 'rejected'].includes(q.status),
        canArchive: manages && draft,
        canAccept: manages && covers('projects.manage', q) && q.status === 'sent',
        canRenderPdf: draft ? manages : q.pdf?.state === 'failed',
      },
    };
  };
  /** A2–A6 over the seeded catalog, templates and retainers; enough for the dialog's choices. */
  const acceptPlanOf = (q: QuoteRecord, query: URLSearchParams): AcceptPlan => {
    const detail = detailOf(q);
    const today = businessDate();
    const lead = !q.clientId ? leadOf(q) : undefined;
    const linked = lead ? query.get('clientId') : null;
    const conversion = lead ? leadRules.conversionPlan(lead, linked) : null;
    const client = clients.find((c) => c.id === (q.clientId ?? linked));
    const departmentsOf = (lines: QuoteLineRecord[]) => [
      ...new Set(
        lines
          .flatMap((line) => [line.department, ...line.items.map((item) => item.department)])
          .filter((code): code is DepartmentCode => !!code),
      ),
    ];
    const templateIdsOf = (lines: QuoteLineRecord[]) => [
      ...new Set(
        lines
          .flatMap((line) => [line.templateId, ...line.items.map((item) => item.templateId)])
          .filter((templateId): templateId is string => !!templateId),
      ),
    ];
    const used = templateIdsOf(q.lines).flatMap((templateId) =>
      templates.filter((t) => t.id === templateId),
    );
    const oneOff = q.lines.filter((line) => line.section === 'one_off');
    const monthly = q.lines.filter((line) => line.section === 'monthly');

    let project: AcceptPlan['project'] = null;
    if (oneOff.length > 0) {
      const startDate = query.get('projectStartDate') ?? today;
      const choose = query.get('chooseTemplates') === 'true';
      const chosen = query.getAll('templateIds');
      const offered = templateIdsOf(oneOff).flatMap((templateId) =>
        templates.filter((t) => t.id === templateId && t.kind === 'project' && !t.archived),
      );
      const selected = offered.filter((t) => !choose || chosen.includes(t.id));
      const stages = [
        ...new Set(
          selected.flatMap((t) =>
            [...t.stages].sort((a, b) => a.position - b.position).map((stage) => stage.name),
          ),
        ),
      ];
      const milestones =
        stages.length > 0
          ? stages.map((name, at) => ({ name, dueDate: addDays(startDate, 7 * (at + 1)) }))
          : detail.installments.map((installment) => ({ name: installment.name, dueDate: null }));
      const defaults = defaultInstallmentMilestones(detail.installments.length, milestones.length);
      project = {
        name: q.title,
        // A new client's account manager is chosen at step 0 (F03 rule 11).
        projectManager: client
          ? person(client.accountManagerId)
          : conversion?.client.accountManagerId
            ? person(conversion.client.accountManagerId)
            : null,
        departments: departmentsOf(oneOff),
        startDate,
        dueDate: milestones.at(-1)?.dueDate ?? addDays(startDate, 30),
        templates: offered.map((t) => ({
          id: t.id,
          name: t.name,
          selected: selected.includes(t),
          revisionLimit: Math.max(
            0,
            ...oneOff
              .filter((line) => line.templateId === t.id)
              .map((line) => line.revisionRounds ?? 0),
          ),
        })),
        milestones,
        installments: detail.installments.map((installment, at) => ({
          name: installment.name,
          percent: installment.percent,
          amountMinor: installment.amountMinor,
          milestone: defaults[at] ?? 0,
        })),
      };
    }

    let retainer: AcceptPlan['retainer'] = null;
    if (monthly.length > 0) {
      const startDate = query.get('retainerStartDate') ?? today;
      const template = templateIdsOf(monthly)
        .flatMap((templateId) =>
          templates.filter(
            (t) => t.id === templateId && t.kind === 'retainer_cycle' && !t.archived,
          ),
        )
        .at(0);
      const counted = monthly.flatMap((line) =>
        line.items.length > 0
          ? line.items.flatMap((item) =>
              item.deliverableKind
                ? [
                    {
                      kind: item.deliverableKind,
                      label: item.deliverableLabel,
                      quantity: item.quantity * line.quantity,
                      revisionRounds: item.revisionRounds,
                    },
                  ]
                : [],
            )
          : line.deliverableKind
            ? [
                {
                  kind: line.deliverableKind,
                  label: line.deliverableLabel,
                  quantity: line.quantity,
                  revisionRounds: line.revisionRounds ?? 0,
                },
              ]
            : [],
      );
      retainer = {
        name: q.title,
        departments: departmentsOf(monthly),
        startDate,
        renewalDate: q.monthlyTermMonths ? addMonths(startDate, q.monthlyTermMonths) : null,
        template: template ? { id: template.id, name: template.name } : null,
        currency: q.currency,
        monthlyFeeMinor: detail.totals.monthly.netMinor,
        lines: mergeDeliverableLines(counted),
        renewable: retainers
          .filter(
            (r) =>
              r.clientId === client?.id &&
              !r.archived &&
              r.status !== 'ended' &&
              r.currency === q.currency,
          )
          .map((r) => ({ id: r.id, name: r.name, status: r.status })),
      };
    }

    return {
      sentOn: q.sentAt ? businessDate(new Date(q.sentAt)) : today,
      project,
      retainer,
      archivedTemplates: used.filter((t) => t.archived).map((t) => ({ id: t.id, name: t.name })),
      conversion,
    };
  };
  const listItemOf = (q: QuoteRecord): Quote => {
    const d = detailOf(q);
    return {
      id: d.id,
      displayNumber: d.displayNumber,
      year: d.year,
      number: d.number,
      version: d.version,
      title: d.title,
      client: d.client,
      recipient: d.recipient,
      accountManager: d.accountManager,
      currency: d.currency,
      status: d.status,
      discountApproval: d.discountApproval,
      oneOffNetMinor: d.oneOffNetMinor,
      monthlyNetMinor: d.monthlyNetMinor,
      validUntil: d.validUntil,
      expiresSoon: d.expiresSoon,
      updatedAt: d.updatedAt,
      archivedAt: d.archivedAt,
    };
  };
  const settingsOf = (): QuoteSettings => ({
    ...settings,
    canEdit: holds('catalog.manage'),
    canEditThreshold: holds('quotes.approve_discount'),
  });

  /** A saved draft line: a line already on the draft keeps its copy; a new one copies the catalog. */
  const lineOf = (
    q: QuoteRecord,
    input: QuoteDraft['lines'][number],
    currency: Currency,
  ): QuoteLineRecord => {
    const stored = q.lines.find((line) => line.id === input.id);
    const service = catalog.services.find((s) => s.id === input.serviceId);
    const pkg = catalog.packages.find((p) => p.id === input.packageId);
    const item = service ?? pkg;
    const listPrice =
      stored && currency === q.currency
        ? stored.listUnitPriceMinor
        : item
          ? catalogPriceOf(item, currency)
          : null;
    return {
      id: stored?.id ?? id(nextId++),
      section: input.section,
      serviceId: input.serviceId,
      packageId: input.packageId,
      name: stored?.name ?? item?.name ?? '',
      description: input.description,
      department: service?.department ?? null,
      quantity: input.quantity,
      unitPriceMinor: currency === q.currency ? input.unitPriceMinor : (listPrice ?? 0),
      listUnitPriceMinor: listPrice,
      revisionRounds: input.revisionRounds,
      deliverableKind: service?.deliverableKind ?? null,
      deliverableLabel: service?.deliverableLabel ?? null,
      templateId: stored?.templateId ?? item?.templateId ?? null,
      items: input.items.map((entry, index) => {
        const s = catalog.services.find((x) => x.id === entry.serviceId);
        return {
          id: stored?.items[index]?.id ?? id(nextId++),
          serviceId: entry.serviceId,
          name: s?.name ?? '',
          department: s?.department ?? 'design',
          quantity: entry.quantity,
          revisionRounds: entry.revisionRounds,
          deliverableKind: s?.deliverableKind ?? null,
          deliverableLabel: s?.deliverableLabel ?? null,
          templateId: null,
        };
      }),
    };
  };
  /** What an approval covers (rule 7): currency, discounts, lines, prices and quantities. */
  const pricing = (
    q: Pick<QuoteRecord, 'currency' | 'oneOffDiscountMinor' | 'monthlyDiscountMinor' | 'lines'>,
  ) =>
    JSON.stringify([
      q.currency,
      q.oneOffDiscountMinor,
      q.monthlyDiscountMinor,
      q.lines.map((l) => [l.serviceId, l.packageId, l.quantity, l.unitPriceMinor]),
    ]);

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    if (path === '/api/quote-settings') {
      if (method === 'GET') {
        return holds('quotes.read') ? json(route, settingsOf()) : fail(route, 403, null);
      }
      const input = updateQuoteSettingsSchema.parse(request.postDataJSON());
      const { discountThresholdPercent, ...texts } = input;
      if (discountThresholdPercent !== undefined && !holds('quotes.approve_discount')) {
        return fail(route, 403, null);
      }
      if (Object.keys(texts).length > 0 && !holds('catalog.manage')) return fail(route, 403, null);
      Object.assign(settings, definedFields(input), {
        updatedAt: now(),
        updatedBy: person(me().user.id),
      });
      return json(route, settingsOf());
    }
    if (!path.startsWith('/api/quotes')) return undefined;
    if (!holds('quotes.read')) return fail(route, 403, null);

    if (path === '/api/quotes' && method === 'GET') {
      const statuses = url.searchParams.getAll('status');
      const archived = url.searchParams.get('archived') === 'true';
      const clientId = url.searchParams.get('clientId');
      const leadId = url.searchParams.get('leadId');
      const accountManagerId = url.searchParams.get('accountManagerId');
      const approval = url.searchParams.get('approval');
      const projectId = url.searchParams.get('projectId');
      const retainerId = url.searchParams.get('retainerId');
      const latestOnly = url.searchParams.get('latestOnly') !== 'false';
      const search = url.searchParams.get('search')?.toLowerCase();
      const items = quotes
        .filter(
          (q) =>
            covers('quotes.read', q) &&
            !!q.archivedAt === archived &&
            (archived || !latestOnly || latestOf(q).id === q.id) &&
            (!projectId || q.project?.id === projectId) &&
            (!retainerId || q.retainer?.id === retainerId) &&
            (statuses.length === 0 || statuses.includes(q.status)) &&
            (!clientId || q.clientId === clientId) &&
            (!leadId || q.leadId === leadId) &&
            (!accountManagerId || detailOf(q).accountManager.id === accountManagerId) &&
            (!approval || q.discountApproval === approval),
        )
        .map(listItemOf)
        .filter(
          (q) =>
            !search ||
            q.title.toLowerCase().includes(search) ||
            q.displayNumber.toLowerCase().includes(search) ||
            q.recipient.name.includes(search),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/quotes' && method === 'POST') {
      const input = createQuoteSchema.parse(request.postDataJSON());
      const clientId = input.clientId ?? null;
      const leadId = input.leadId ?? null;
      if (!covers('quotes.manage', { clientId, leadId })) return fail(route, 403, null);
      if (clientId) {
        const client = clients.find((c) => c.id === clientId);
        if (!client || client.archived) return fail(route, 409, 'CLIENT_ARCHIVED');
        if (client.status === 'ended') return fail(route, 409, 'CLIENT_ENDED');
      } else {
        const lead = leadOf({ leadId });
        if (lead?.archivedAt) return fail(route, 409, 'LEAD_ARCHIVED');
        if (!lead || !isOpenLeadStage(lead.stage)) return fail(route, 409, 'LEAD_CLOSED');
      }
      const at = now();
      const created: QuoteRecord = {
        id: id(nextId++),
        year: 2026,
        number: Math.max(...quotes.map((q) => q.number)) + 1,
        version: 1,
        title: input.title,
        clientId,
        leadId,
        contactId: input.contactId,
        currency: input.currency,
        status: 'draft',
        discountApproval: 'none',
        discountDecision: null,
        oneOffDiscountMinor: 0,
        monthlyDiscountMinor: 0,
        monthlyTermMonths: null,
        validityDays: settings.defaultValidityDays,
        validUntil: null,
        clientNotes: null,
        terms: settings.defaultTerms || null,
        sentAt: null,
        sentById: null,
        response: null,
        createdById: me().user.id,
        project: null,
        retainer: null,
        pdf: null,
        draftPdf: null,
        lines: [],
        installments: [],
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
      };
      quotes.push(created);
      return json(route, detailOf(created), 201);
    }

    const match = path.match(/^\/api\/quotes\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const q = quotes.find((x) => x.id === match[1]);
    if (!q || !covers('quotes.read', q)) return fail(route, 404, null);
    const action = match[2];
    if (!action && method === 'GET') {
      // The worker renders between two reads.
      if (q.pdf?.state === 'pending') q.pdf = { state: 'ready' };
      if (q.draftPdf?.state === 'pending') {
        q.draftPdf = { state: 'ready', renderedAt: now(), outdated: false };
      }
      return json(route, detailOf(q));
    }
    if (action === 'pdf' && method === 'POST') {
      if (q.status === 'draft') {
        if (!covers('quotes.manage', q)) return fail(route, 403, null);
        q.draftPdf = { state: 'pending', renderedAt: null, outdated: false };
      } else if (q.pdf?.state === 'failed') {
        q.pdf = { state: 'pending' };
      }
      return json(route, { state: 'pending' });
    }
    if (action === 'approval/decision') {
      if (!holds('quotes.approve_discount')) return fail(route, 403, null);
      if (q.discountApproval !== 'pending') return fail(route, 409, 'INVALID_TRANSITION');
      const input = quoteApprovalDecisionSchema.parse(request.postDataJSON());
      q.discountApproval = input.decision === 'approve' ? 'approved' : 'returned';
      q.discountDecision = { by: person(me().user.id), at: now(), note: input.note };
      q.updatedAt = now();
      return json(route, detailOf(q));
    }
    if (!covers('quotes.manage', q)) return fail(route, 403, null);
    const totals = totalsOf(q);
    const needs = needsDiscountApproval(totals, settings.discountThresholdPercent);

    if (!action && method === 'PUT') {
      if (q.status !== 'draft' || q.archivedAt) return fail(route, 409, 'QUOTE_LOCKED');
      if (q.discountApproval === 'pending') return fail(route, 409, 'APPROVAL_PENDING');
      const input = quoteDraftSchema.parse(request.postDataJSON());
      if (input.updatedAt !== q.updatedAt) return fail(route, 409, 'STALE_QUOTE');
      const lines = input.lines.map((line) => lineOf(q, line, input.currency));
      const next = { ...q, ...input, lines };
      const nextTotals = totalsOf(next);
      if (
        input.oneOffDiscountMinor > nextTotals.oneOff.subtotalMinor ||
        input.monthlyDiscountMinor > nextTotals.monthly.subtotalMinor
      ) {
        return fail(route, 400, 'INVALID_DISCOUNT');
      }
      const hasOneOff = lines.some((line) => line.section === 'one_off');
      if (!installmentsValid(input.installments, hasOneOff, { draft: true })) {
        return fail(route, 400, 'INVALID_INSTALLMENTS');
      }
      Object.assign(q, input, {
        lines,
        installments: input.installments.map((installment, index) => ({
          id: q.installments[index]?.id ?? id(nextId++),
          ...installment,
        })),
        discountApproval:
          q.discountApproval === 'approved' && pricing(q) !== pricing(next)
            ? 'none'
            : q.discountApproval,
        draftPdf: q.draftPdf && { ...q.draftPdf, outdated: true },
        updatedAt: now(),
      });
      return json(route, detailOf(q));
    }
    if (action === 'approval') {
      const { action: step } = quoteApprovalActionSchema.parse(request.postDataJSON());
      if (q.status !== 'draft') return fail(route, 409, 'QUOTE_LOCKED');
      if (step === 'request') {
        if (!needs) return fail(route, 409, 'APPROVAL_NOT_NEEDED');
        if (!['none', 'returned'].includes(q.discountApproval)) {
          return fail(route, 409, 'INVALID_TRANSITION');
        }
        q.discountApproval = 'pending';
      } else {
        if (q.discountApproval !== 'pending') return fail(route, 409, 'INVALID_TRANSITION');
        q.discountApproval = 'none';
      }
      q.updatedAt = now();
      return json(route, detailOf(q));
    }
    if (action === 'send') {
      const { confirmZeroPrice } = sendQuoteSchema.parse(request.postDataJSON());
      if (q.status !== 'draft') return fail(route, 409, 'INVALID_TRANSITION');
      const lead = !q.clientId ? leadOf(q) : undefined;
      if (lead?.archivedAt) return fail(route, 409, 'LEAD_ARCHIVED');
      if (lead && !isOpenLeadStage(lead.stage)) return fail(route, 409, 'LEAD_CLOSED');
      if (q.discountApproval === 'pending') return fail(route, 409, 'APPROVAL_PENDING');
      if (q.lines.length === 0) return fail(route, 409, 'QUOTE_EMPTY');
      const hasOneOff = q.lines.some((line) => line.section === 'one_off');
      if (!installmentsValid(q.installments, hasOneOff, { draft: false })) {
        return fail(route, 409, 'INVALID_INSTALLMENTS');
      }
      if (!confirmZeroPrice && q.lines.some((line) => line.unitPriceMinor === 0)) {
        return fail(route, 409, 'ZERO_PRICE');
      }
      const approver = holds('quotes.approve_discount');
      if (needs && q.discountApproval !== 'approved' && !approver) {
        return fail(route, 409, 'DISCOUNT_APPROVAL_REQUIRED');
      }
      for (const older of quotes) {
        if (
          older.number === q.number &&
          older.id !== q.id &&
          ['sent', 'expired'].includes(older.status)
        ) {
          older.status = 'superseded';
        }
      }
      Object.assign(q, {
        status: 'sent',
        discountApproval:
          needs && approver && q.discountApproval !== 'approved' ? 'approved' : q.discountApproval,
        sentAt: now(),
        sentById: me().user.id,
        validUntil: addDays(businessDate(), q.validityDays),
        pdf: { state: 'pending' },
        draftPdf: null,
        updatedAt: now(),
      });
      if (lead) leadRules.quoteSent(lead.id);
      return json(route, detailOf(q));
    }
    if (action === 'extend') {
      if (q.status !== 'expired') return fail(route, 409, 'INVALID_TRANSITION');
      const { validUntil } = extendQuoteSchema.parse(request.postDataJSON());
      Object.assign(q, { status: 'sent', validUntil, updatedAt: now() });
      return json(route, detailOf(q));
    }
    if (action === 'reject') {
      if (!['sent', 'expired'].includes(q.status)) return fail(route, 409, 'INVALID_TRANSITION');
      const input = rejectQuoteSchema.parse(request.postDataJSON());
      if (input.reason === 'other' && !input.note) return fail(route, 400, 'NOTE_REQUIRED');
      const contact = clients
        .find((c) => c.id === q.clientId)
        ?.contacts.find((c) => c.id === input.contactId);
      Object.assign(q, {
        status: 'rejected',
        response: {
          respondedOn: input.respondedOn,
          contact: contact ? { id: contact.id, name: contact.name } : null,
          note: input.note,
          by: person(me().user.id),
          rejectionReason: input.reason,
        },
        updatedAt: now(),
      });
      return json(route, detailOf(q));
    }
    if (action === 'accept-plan' || action === 'accept') {
      if (q.status === 'expired') return fail(route, 409, 'QUOTE_EXPIRED');
      if (q.status !== 'sent') return fail(route, 409, 'INVALID_TRANSITION');
    }
    if (action === 'accept-plan' && method === 'GET') {
      return json(route, acceptPlanOf(q, url.searchParams));
    }
    if (action === 'accept' && method === 'POST') {
      const input = acceptQuoteSchema.parse(request.postDataJSON());
      const lead = !q.clientId ? leadOf(q) : undefined;
      if (!!lead !== !!input.conversion) return fail(route, 400, null);
      const choices: string[][] = [];
      if (input.project) {
        choices.push(['projectStartDate', input.project.startDate], ['chooseTemplates', 'true']);
        for (const templateId of input.project.templateIds)
          choices.push(['templateIds', templateId]);
      }
      if (input.retainer?.mode === 'new') {
        choices.push(['retainerStartDate', input.retainer.startDate]);
      }
      if (input.conversion?.mode === 'existing')
        choices.push(['clientId', input.conversion.clientId]);
      const plan = acceptPlanOf(q, new URLSearchParams(choices));
      if (input.respondedOn > businessDate() || input.respondedOn < plan.sentOn) {
        return fail(route, 400, 'INVALID_DATES');
      }
      // F03 rule 11: step 0 converts the lead first; the quote is then a client quote.
      if (lead && input.conversion) {
        const converted = leadRules.convert(lead, input.conversion);
        if ('error' in converted) return fail(route, ...converted.error);
      }
      const clientId = q.clientId ?? '';
      let project: QuoteRecord['project'] = null;
      if (input.project && plan.project) {
        const { installments, milestones } = plan.project;
        const chosen = input.project.installmentMilestones;
        const created: ProjectRecord = {
          id: id(nextId++),
          clientId,
          name: input.project.name,
          description: null,
          projectManagerId: input.project.projectManagerId,
          departments: input.project.departments,
          status: 'planned',
          startDate: input.project.startDate,
          dueDate: input.project.dueDate,
          currency: q.currency,
          completedAt: null,
          cancelledAt: null,
          cancelReason: null,
          archived: false,
          milestones: milestones.map((stage, position) => {
            const amount = installments.reduce(
              (sum, installment, at) =>
                chosen[at] === position ? sum + installment.amountMinor : sum,
              0,
            );
            return {
              id: id(nextId++),
              name: stage.name,
              dueDate: stage.dueDate,
              status: 'pending',
              doneAt: null,
              doneById: null,
              installmentMinor: amount > 0 ? amount : null,
              archived: false,
            };
          }),
          extraWork: [],
        };
        projects.push(created);
        project = { id: created.id, name: created.name };
      }
      let retainer: QuoteRecord['retainer'] = null;
      if (input.retainer && plan.retainer) {
        const lines = plan.retainer.lines.map((line) => ({
          id: id(nextId++),
          ...line,
          archived: false,
        }));
        if (input.retainer.mode === 'renew') {
          const { retainerId } = input.retainer;
          const renewed = retainers.find((r) => r.id === retainerId);
          if (!renewed) return fail(route, 404, null);
          if (renewed.currency !== q.currency) return fail(route, 409, 'CURRENCY_MISMATCH');
          renewed.monthlyFeeMinor = plan.retainer.monthlyFeeMinor;
          renewed.deliverables = lines;
          retainer = { id: renewed.id, name: renewed.name };
        } else {
          const created: RetainerRecord = {
            id: id(nextId++),
            clientId,
            name: input.retainer.name,
            departments: input.retainer.departments,
            status: 'active',
            startDate: input.retainer.startDate,
            renewalDate: input.retainer.renewalDate,
            endedOn: null,
            currency: q.currency,
            monthlyFeeMinor: plan.retainer.monthlyFeeMinor,
            archived: false,
            deliverables: lines,
            cycles: [],
            extraWork: [],
          };
          retainers.push(created);
          retainer = { id: created.id, name: created.name };
        }
      }
      const contact = clients
        .find((c) => c.id === q.clientId)
        ?.contacts.find((c) => c.id === input.contactId);
      Object.assign(q, {
        status: 'accepted',
        project,
        retainer,
        response: {
          respondedOn: input.respondedOn,
          contact: contact ? { id: contact.id, name: contact.name } : null,
          note: input.note,
          by: person(me().user.id),
          rejectionReason: null,
        },
        updatedAt: now(),
      });
      // A10: a newer draft of the accepted quote is archived.
      for (const newer of quotes) {
        if (newer.number === q.number && newer.version > q.version && newer.status === 'draft') {
          newer.archivedAt = now();
        }
      }
      return json(route, detailOf(q));
    }
    if (action === 'versions') {
      if (!detailOf(q).permissions.canCreateVersion) return fail(route, 409, 'VERSION_EXISTS');
      const at = now();
      const created: QuoteRecord = {
        ...structuredClone(q),
        id: id(nextId++),
        version: q.version + 1,
        status: 'draft',
        discountApproval: 'none',
        discountDecision: null,
        validUntil: null,
        sentAt: null,
        sentById: null,
        response: null,
        pdf: null,
        draftPdf: null,
        createdById: me().user.id,
        createdAt: at,
        updatedAt: at,
      };
      quotes.push(created);
      return json(route, detailOf(created), 201);
    }
    if (action === 'archive') {
      if (q.status !== 'draft') return fail(route, 409, 'INVALID_TRANSITION');
      q.archivedAt = now();
      return route.fulfill({ status: 204 });
    }
    return undefined;
  };
}

// Leads (F03)

interface LeadNoteRecord {
  id: string;
  occurredAt: string;
  channel: NoteChannel;
  summary: string;
  authorId: string;
  archived: boolean;
}

interface LeadRecord {
  id: string;
  contactName: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  socialHandle: string | null;
  source: LeadSource;
  sourceDetail: string | null;
  request: string | null;
  budgetMinor: number | null;
  budgetCurrency: Currency | null;
  sector: string | null;
  isHealthcare: boolean;
  stage: LeadStage;
  stageChangedAt: string;
  ownerId: string;
  nextFollowUpOn: string | null;
  lostReason: LeadLossReason | null;
  lostNote: string | null;
  closedAt: string | null;
  clientId: string | null;
  convertedById: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  interests: { kind: 'service' | 'package'; id: string }[];
  notes: LeadNoteRecord[];
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * The pipeline: Al-Noor (Layan's, due today), Sindyan (Sara's, overdue), Lamsa (a meeting),
 * Rashaqa (a sent lead quote), Jasmine (won), Abtal (lost) and an archived duplicate.
 */
export function leadsSeed(): LeadRecord[] {
  const today = businessDate();
  const lead = (
    n: number,
    fields: Partial<LeadRecord> & Pick<LeadRecord, 'contactName' | 'source' | 'stage' | 'ownerId'>,
  ): LeadRecord => ({
    id: id(n),
    companyName: null,
    phone: null,
    email: null,
    socialHandle: null,
    sourceDetail: null,
    request: null,
    budgetMinor: null,
    budgetCurrency: null,
    sector: null,
    isHealthcare: false,
    stageChangedAt: daysAgo(3),
    nextFollowUpOn: addDays(today, 3),
    lostReason: null,
    lostNote: null,
    closedAt: null,
    clientId: null,
    convertedById: null,
    createdById: id(1),
    createdAt: daysAgo(12),
    updatedAt: daysAgo(3),
    archivedAt: null,
    interests: [],
    notes: [],
    ...fields,
  });
  return [
    lead(9701, {
      contactName: 'أحمد سليمان',
      companyName: 'عيادة النور لطب الأسنان',
      phone: '+963944111222',
      email: 'ahmad@alnoor.example',
      socialHandle: '@alnoor.dental',
      source: 'instagram',
      request: 'إدارة حسابات التواصل وتصوير شهري للعيادة.',
      budgetMinor: 40000,
      budgetCurrency: 'USD',
      sector: 'رعاية صحية',
      isHealthcare: true,
      stage: 'contacted',
      ownerId: id(3),
      nextFollowUpOn: today,
      interests: [{ kind: 'package', id: id(9051) }],
      notes: [
        {
          id: id(9711),
          occurredAt: daysAgo(2),
          channel: 'whatsapp',
          summary: 'أرسل صور العيادة وطلب عرضاً للباقة الذهبية.',
          authorId: id(3),
          archived: false,
        },
        {
          id: id(9712),
          occurredAt: daysAgo(4),
          channel: 'call',
          summary: 'اتصال أول: يريد البدء الشهر القادم.',
          authorId: id(3),
          archived: false,
        },
      ],
    }),
    lead(9702, {
      contactName: 'رامي العلي',
      companyName: 'مطعم السنديان',
      phone: '+963933777888',
      source: 'whatsapp',
      stage: 'new',
      ownerId: id(1),
      nextFollowUpOn: addDays(today, -3),
      stageChangedAt: daysAgo(6),
    }),
    lead(9703, {
      contactName: 'لمى حسن',
      companyName: 'متجر لمسة',
      email: 'lama@lamsa.example',
      source: 'referral',
      sourceDetail: 'توصية من مطعم الياسمين',
      budgetMinor: 1500000,
      budgetCurrency: 'SYP',
      stage: 'meeting',
      ownerId: id(3),
      interests: [
        { kind: 'service', id: id(9004) },
        { kind: 'service', id: id(9001) },
        { kind: 'package', id: id(9051) },
      ],
    }),
    lead(9704, {
      contactName: 'سامر خليل',
      companyName: 'صالة رشاقة',
      phone: '+963955123456',
      source: 'paid_ad',
      stage: 'quote_sent',
      ownerId: id(1),
      nextFollowUpOn: addDays(today, 5),
      stageChangedAt: daysAgo(1),
    }),
    lead(9705, {
      contactName: 'هالة الشامي',
      companyName: 'مطعم الياسمين',
      phone: '+963944555666',
      source: 'walk_in',
      stage: 'won',
      ownerId: id(3),
      nextFollowUpOn: null,
      clientId: id(601),
      closedAt: daysAgo(10),
      convertedById: id(3),
      stageChangedAt: daysAgo(10),
    }),
    lead(9706, {
      contactName: 'مازن قاسم',
      companyName: 'نادي الأبطال',
      socialHandle: '@abtal.gym',
      source: 'tiktok',
      stage: 'lost',
      ownerId: id(1),
      nextFollowUpOn: null,
      lostReason: 'price',
      lostNote: 'الميزانية أقل من نصف العرض.',
      closedAt: daysAgo(5),
      stageChangedAt: daysAgo(5),
    }),
    lead(9707, {
      contactName: 'رسالة مكررة',
      phone: '+963944111222',
      source: 'instagram',
      stage: 'new',
      ownerId: id(1),
      archivedAt: daysAgo(1),
    }),
  ];
}

interface LeadState {
  leads: LeadRecord[];
  quotes: QuoteRecord[];
  clients: ClientRecord[];
  users: UserResponse[];
  catalog: CatalogRecords;
  me: () => MeResponse;
}

/** The lead rules both mocks share: scopes, the conversion plan and the conversion (rule 10). */
function leadRules({ leads, quotes, clients, users, me }: LeadState) {
  let nextId = 9800;
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  /** `leads.*` covering the lead (scope `assigned`: its owner), or the quote scopes (F03). */
  const covers = (permission: Permission, lead: LeadRecord) => {
    const granted = scopes(permission);
    return (
      granted.includes('all') ||
      ((granted.includes('assigned') || granted.includes('own_clients')) &&
        lead.ownerId === me().user.id)
    );
  };
  const isOpen = (lead: LeadRecord) => isOpenLeadStage(lead.stage) && !lead.archivedAt;
  const sameContact = (
    a: { phone: string | null; email: string | null },
    b: { phone: string | null; email: string | null },
  ) => (!!a.phone && a.phone === b.phone) || (!!a.email && a.email === b.email);
  const duplicateClientOf = (client: ClientRecord) => ({
    id: client.id,
    tradeName: client.tradeName,
    status: client.status,
    accountManager: person(client.accountManagerId),
  });
  const duplicateClients = (
    names: string[],
    match: { phone: string | null; email: string | null },
  ) =>
    clients
      .filter(
        (client) =>
          !client.archived &&
          (names.some((name) => name.toLowerCase() === client.tradeName.toLowerCase()) ||
            client.contacts.some((c) => !c.archived && sameContact(match, c))),
      )
      .map(duplicateClientOf);
  const leadQuotes = (lead: LeadRecord) =>
    quotes.filter((q) => q.leadId === lead.id && !q.archivedAt);

  const conversionPlan = (lead: LeadRecord, clientId: string | null): LeadConversionPlan => {
    const owner = users.find((u) => u.id === lead.ownerId);
    const existing = clientId ? clients.find((c) => c.id === clientId) : undefined;
    return {
      client: {
        tradeName: leadDisplayName(lead),
        sector: lead.sector,
        isHealthcare: lead.isHealthcare,
        accountManagerId: owner?.roles?.includes('account_manager') ? owner.id : null,
      },
      contact: { name: lead.contactName, phone: lead.phone, email: lead.email },
      accountManagers: users
        .filter((u) => u.status === 'active' && u.roles?.includes('account_manager'))
        .map((u) => person(u.id)),
      duplicateClients: duplicateClients(
        [lead.companyName, lead.contactName].filter((name): name is string => !!name),
        lead,
      ),
      noteCount: lead.notes.filter((note) => !note.archived).length,
      quoteCount: leadQuotes(lead).length,
      existingClient: existing
        ? {
            ...duplicateClientOf(existing),
            hasContact: existing.contacts.some((c) => !c.archived && sameContact(lead, c)),
          }
        : null,
    };
  };

  /** Rule 10 in one go; refusals leave everything as it was. */
  const convert = (
    lead: LeadRecord,
    input: ConvertLead,
  ): { client: ClientRecord } | { error: readonly [number, ErrorCode] } => {
    if (lead.archivedAt) return { error: [409, 'LEAD_ARCHIVED'] };
    if (!isOpenLeadStage(lead.stage)) return { error: [409, 'INVALID_TRANSITION'] };
    let client: ClientRecord;
    if (input.mode === 'new') {
      const name = input.client.tradeName.toLowerCase();
      if (clients.some((c) => !c.archived && c.tradeName.toLowerCase() === name)) {
        return { error: [409, 'CLIENT_NAME_TAKEN'] };
      }
      const manager = users.find((u) => u.id === input.client.accountManagerId);
      if (!manager?.roles?.includes('account_manager')) {
        return { error: [400, 'INVALID_ACCOUNT_MANAGER'] };
      }
      client = {
        id: id(nextId++),
        tradeName: input.client.tradeName,
        sector: input.client.sector,
        status: 'active',
        isHealthcare: input.client.isHealthcare,
        accountManagerId: manager.id,
        brandKit: structuredClone(emptyKit),
        archived: false,
        contacts: [],
        platformAccounts: [],
        notes: [],
      };
      clients.push(client);
    } else {
      const found = clients.find((c) => c.id === input.clientId && !c.archived);
      if (!found) return { error: [409, 'CLIENT_ARCHIVED'] };
      client = found;
      if (client.status === 'ended') client.status = 'active';
    }
    const added =
      input.contact.add === true
        ? contact(nextId++, client.id, input.contact.name, {
            jobTitle: input.contact.jobTitle ?? null,
            phone: input.contact.phone ?? null,
            email: input.contact.email ?? null,
            hasFinalApproval: input.contact.hasFinalApproval ?? false,
          })
        : null;
    if (added) client.contacts.push(added);
    for (const note of lead.notes.filter((n) => !n.archived)) {
      client.notes.push({
        id: id(nextId++),
        occurredAt: note.occurredAt,
        channel: note.channel,
        summary: note.summary,
        authorId: note.authorId,
        contactId: added?.id ?? null,
        archived: false,
      });
    }
    for (const q of quotes.filter((x) => x.leadId === lead.id)) {
      q.clientId = client.id;
      q.contactId ??= added?.id ?? null;
    }
    const at = new Date().toISOString();
    Object.assign(lead, {
      stage: 'won',
      stageChangedAt: at,
      clientId: client.id,
      closedAt: at,
      convertedById: me().user.id,
      nextFollowUpOn: null,
      updatedAt: at,
    });
    return { client };
  };

  /** Rule 14: sending a lead's quote moves the open lead to Quote sent. */
  const quoteSent = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (lead && ['new', 'contacted', 'meeting'].includes(lead.stage)) {
      lead.stage = 'quote_sent';
      lead.stageChangedAt = new Date().toISOString();
    }
  };

  return {
    covers,
    isOpen,
    person,
    sameContact,
    duplicateClients,
    conversionPlan,
    convert,
    quoteSent,
  };
}

type LeadRuleSet = ReturnType<typeof leadRules>;

/** The leads API over the in-memory records, with the F03 rules the screens rely on. */
function leadRoutes(state: LeadState & { rules: LeadRuleSet }) {
  const { leads, quotes, users, catalog, me, rules } = state;
  const { covers, isOpen, person } = rules;
  let nextId = 9900;
  const now = () => new Date().toISOString();
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const manageAll = () => scopes('leads.manage').includes('all');
  const owner = (userId: string) => {
    const user = users.find((u) => u.id === userId);
    return { id: userId, name: user?.name ?? '', archived: user?.status === 'archived' };
  };
  const eligibleOwners = () =>
    users.filter(
      (u) =>
        u.status === 'active' &&
        (u.roles?.includes('general_manager') ||
          u.roles?.includes('account_manager') ||
          u.departments.some((d) => d.code === 'general_communication' || d.code === 'marketing')),
    );
  const interestName = (interest: LeadRecord['interests'][number]) =>
    interest.kind === 'service'
      ? catalog.services.find((s) => s.id === interest.id)
      : catalog.packages.find((p) => p.id === interest.id);
  const latestQuotes = (lead: LeadRecord) =>
    quotes.filter(
      (q) =>
        q.leadId === lead.id &&
        !q.archivedAt &&
        !quotes.some((x) => x.number === q.number && x.version > q.version && !x.archivedAt),
    );

  /** A quote's nets, for `quotes.read` covering it (its client's, or the lead's owner). */
  const netsOf = (q: QuoteRecord, lead: LeadRecord) => {
    const granted = scopes('quotes.read');
    const client = q.clientId ? state.clients.find((c) => c.id === q.clientId) : undefined;
    const ownerId = client ? client.accountManagerId : lead.ownerId;
    if (
      !granted.includes('all') &&
      !(granted.includes('own_clients') && ownerId === me().user.id)
    ) {
      return null;
    }
    const totals = quoteTotals({
      lines: q.lines,
      oneOffDiscountMinor: q.oneOffDiscountMinor,
      monthlyDiscountMinor: q.monthlyDiscountMinor,
      installments: q.installments,
      monthlyTermMonths: q.monthlyTermMonths,
    });
    return { oneOff: totals.oneOff.netMinor, monthly: totals.monthly.netMinor };
  };

  const itemOf = (lead: LeadRecord): Lead => {
    const today = businessDate();
    const client = lead.clientId ? state.clients.find((c) => c.id === lead.clientId) : undefined;
    return {
      id: lead.id,
      displayName: leadDisplayName(lead),
      contactName: lead.contactName,
      companyName: lead.companyName,
      source: lead.source,
      stage: lead.stage,
      stageChangedAt: lead.stageChangedAt,
      daysInStage: daysInStage(businessDate(new Date(lead.stageChangedAt)), today),
      owner: owner(lead.ownerId),
      nextFollowUpOn: lead.nextFollowUpOn,
      followUpOverdue: !!lead.nextFollowUpOn && lead.nextFollowUpOn < today,
      followUpDueToday: lead.nextFollowUpOn === today,
      budgetMinor: lead.budgetMinor,
      budgetCurrency: lead.budgetCurrency,
      interests: lead.interests.map((interest) => interestName(interest)?.name ?? ''),
      quoteCount: latestQuotes(lead).length,
      client: client ? { id: client.id, name: client.tradeName } : null,
      closedAt: lead.closedAt,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      archivedAt: lead.archivedAt,
    };
  };

  const detailOf = (lead: LeadRecord): LeadDetail => {
    const manages = covers('leads.manage', lead);
    const open = isOpen(lead);
    const hasSent = quotes.some((q) => q.leadId === lead.id && q.status === 'sent');
    const ownerUser = eligibleOwners().some((u) => u.id === lead.ownerId);
    return {
      ...itemOf(lead),
      phone: lead.phone,
      email: lead.email,
      socialHandle: lead.socialHandle,
      sourceDetail: lead.sourceDetail,
      request: lead.request,
      sector: lead.sector,
      isHealthcare: lead.isHealthcare,
      interests: lead.interests.map((interest) => {
        const item = interestName(interest);
        return { ...interest, name: item?.name ?? '', archived: !!item?.archivedAt };
      }),
      ownerCanManage: ownerUser,
      lostReason: lead.lostReason,
      lostNote: lead.lostNote,
      convertedBy: lead.convertedById ? person(lead.convertedById) : null,
      createdBy: person(lead.createdById),
      notes: lead.notes
        .filter((note) => !note.archived)
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .map((note) => ({
          id: note.id,
          leadId: lead.id,
          occurredAt: note.occurredAt,
          channel: note.channel,
          summary: note.summary,
          author: person(note.authorId),
          canEdit: open && manages && note.authorId === me().user.id,
          canArchive: open && manages && (note.authorId === me().user.id || manageAll()),
        })),
      permissions: {
        canEdit: manages && open,
        moves:
          manages && open
            ? MANUAL_LEAD_STAGES.filter(
                (to) => manualLeadMoveRefusal(lead.stage, to, hasSent) === null,
              )
            : [],
        canChangeOwner: manages && open,
        canLogActivity: manages && open,
        canLose: manages && open,
        canReopen: manages && lead.stage === 'lost' && !lead.archivedAt,
        canConvert: manages && open,
        canArchive: manageAll() && !lead.archivedAt && lead.stage !== 'won',
        canRestore: manageAll() && !!lead.archivedAt,
        canNewQuote: covers('quotes.manage', lead) && open,
      },
    };
  };

  /** The list and board filters shared by both endpoints. */
  const matches = (lead: LeadRecord, query: URLSearchParams) => {
    const search = query.get('search')?.toLowerCase();
    const ownerId = query.get('ownerId');
    const sources = query.getAll('source');
    const followUp = query.get('followUp') as LeadFollowUpFilter | null;
    const range = followUp ? followUpFilterRange(followUp, businessDate()) : null;
    return (
      covers('leads.read', lead) &&
      (!search ||
        [lead.contactName, lead.companyName, lead.phone, lead.email].some((text) =>
          text?.toLowerCase().includes(search),
        )) &&
      (!ownerId || lead.ownerId === ownerId) &&
      (sources.length === 0 || sources.includes(lead.source)) &&
      (!range ||
        (!!lead.nextFollowUpOn &&
          (!range.from || lead.nextFollowUpOn >= range.from) &&
          lead.nextFollowUpOn <= range.to))
    );
  };
  const byFollowUp = (a: Lead, b: Lead) =>
    (a.nextFollowUpOn ?? '9999').localeCompare(b.nextFollowUpOn ?? '9999');

  const ownerFails = (ownerId: string) =>
    !eligibleOwners().some((u) => u.id === ownerId) || (!manageAll() && ownerId !== me().user.id);
  const followUpFails = (date: string) => !followUpDateInRange(date, businessDate());

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    if (path.startsWith('/api/quotes/by-lead/')) {
      const lead = leads.find((l) => l.id === path.split('/').at(-1));
      if (!lead || !covers('leads.read', lead)) return fail(route, 404, null);
      const body: LeadQuotes = {
        items: latestQuotes(lead)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((q) => {
            const nets = netsOf(q, lead);
            return {
              id: q.id,
              displayNumber: quoteDisplayNumber(q),
              version: q.version,
              title: q.title,
              status: q.status,
              currency: q.currency,
              sentAt: q.sentAt,
              validUntil: q.validUntil,
              oneOffNetMinor: nets?.oneOff ?? null,
              monthlyNetMinor: nets?.monthly ?? null,
              versions: quotes
                .filter((x) => x.number === q.number && !x.archivedAt)
                .sort((a, b) => a.version - b.version)
                .map((x) => ({ id: x.id, version: x.version, status: x.status })),
            };
          }),
      };
      return json(route, body);
    }
    if (!path.startsWith('/api/leads')) return undefined;
    if (scopes('leads.read').length === 0) return fail(route, 403, null);

    if (path === '/api/leads' && method === 'GET') {
      const query = url.searchParams;
      const stages = query.getAll('stage');
      const archived = query.get('archived') === 'true';
      if (archived && !manageAll()) return fail(route, 403, null);
      const clientId = query.get('clientId');
      const shown = stages.length > 0 ? stages : [...OPEN_LEAD_STAGES];
      const sort = (query.get('sort') ?? 'nextFollowUpOn') as (typeof LEAD_SORTS)[number];
      const desc = query.get('order') === 'desc';
      const items = leads
        .filter(
          (lead) =>
            matches(lead, query) &&
            !!lead.archivedAt === archived &&
            (archived || clientId || shown.includes(lead.stage)) &&
            (!clientId || lead.clientId === clientId),
        )
        .map(itemOf)
        .sort((a, b) => {
          const order =
            sort === 'nextFollowUpOn' ? byFollowUp(a, b) : a[sort].localeCompare(b[sort]);
          return desc ? -order : order;
        });
      const page = Number(query.get('page') ?? 1);
      const pageSize = Number(query.get('pageSize') ?? 20);
      return json(route, {
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      });
    }
    if (path === '/api/leads/board' && method === 'GET') {
      const since = daysAgo(LEAD_LIMITS.boardClosedDays);
      const board: LeadBoard = {
        columns: LEAD_STAGES.map((stage) => {
          const items = leads
            .filter(
              (lead) =>
                lead.stage === stage &&
                !lead.archivedAt &&
                matches(lead, url.searchParams) &&
                (isOpenLeadStage(stage) || (lead.closedAt ?? '') >= since),
            )
            .map(itemOf)
            .sort(byFollowUp);
          return { stage, count: items.length, truncated: false, items };
        }),
      };
      return json(route, board);
    }
    if (path === '/api/leads/owners') {
      if (scopes('leads.manage').length === 0) return fail(route, 403, null);
      return json(route, {
        items: eligibleOwners().map((u) => ({
          id: u.id,
          name: u.name,
          departments: u.departments.map((d) => d.code),
        })),
      });
    }
    if (path === '/api/leads/interest-options') {
      if (scopes('leads.manage').length === 0) return fail(route, 403, null);
      const named = (items: { id: string; name: string; archivedAt: string | null }[]) =>
        items
          .filter((item) => !item.archivedAt)
          .map(({ id: itemId, name }) => ({ id: itemId, name }));
      return json(route, { services: named(catalog.services), packages: named(catalog.packages) });
    }
    if (path === '/api/leads/duplicates') {
      const query = leadDuplicateQuerySchema.parse(request.postDataJSON());
      return json(route, {
        leads: leads
          .filter(
            (lead) =>
              lead.id !== query.excludeLeadId && isOpen(lead) && rules.sameContact(query, lead),
          )
          .map((lead) => ({
            id: lead.id,
            displayName: leadDisplayName(lead),
            owner: person(lead.ownerId),
            stage: lead.stage,
            readable: covers('leads.read', lead),
          })),
        clients: rules.duplicateClients(query.names, query),
      });
    }
    if (path === '/api/leads' && method === 'POST') {
      if (scopes('leads.manage').length === 0) return fail(route, 403, null);
      const input = createLeadSchema.parse(request.postDataJSON());
      if (!leadHasContactMethod(input)) return fail(route, 400, 'CONTACT_REQUIRED');
      if (leadSourceDetailMissing(input)) return fail(route, 400, 'NOTE_REQUIRED');
      if (ownerFails(input.ownerId)) return fail(route, 400, 'INVALID_LEAD_OWNER');
      if (followUpFails(input.nextFollowUpOn)) return fail(route, 400, 'INVALID_DATES');
      const at = now();
      const created: LeadRecord = {
        ...input,
        id: id(nextId++),
        interests: input.interests.map((interest) =>
          interest.serviceId
            ? { kind: 'service' as const, id: interest.serviceId }
            : { kind: 'package' as const, id: interest.packageId ?? '' },
        ),
        stage: 'new',
        stageChangedAt: at,
        lostReason: null,
        lostNote: null,
        closedAt: null,
        clientId: null,
        convertedById: null,
        createdById: me().user.id,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
        notes: [],
      };
      leads.push(created);
      return json(route, detailOf(created), 201);
    }

    const match = path.match(/^\/api\/leads\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const lead = leads.find((l) => l.id === match[1]);
    if (!lead || !covers('leads.read', lead)) return fail(route, 404, null);
    const action = match[2];
    if (!action && method === 'GET') return json(route, detailOf(lead));
    if (!covers('leads.manage', lead)) return fail(route, 403, null);
    const touch = () => {
      lead.updatedAt = now();
    };

    if (!action && method === 'PATCH') {
      const { updatedAt, interests, ...input } = updateLeadSchema.parse(request.postDataJSON());
      if (lead.archivedAt) return fail(route, 409, 'LEAD_ARCHIVED');
      if (!isOpenLeadStage(lead.stage)) return fail(route, 409, 'LEAD_CLOSED');
      if (updatedAt !== lead.updatedAt) return fail(route, 409, 'STALE_LEAD');
      if (input.nextFollowUpOn && followUpFails(input.nextFollowUpOn)) {
        return fail(route, 400, 'INVALID_DATES');
      }
      Object.assign(lead, definedFields(input));
      if (interests) {
        lead.interests = interests.map((interest) =>
          interest.serviceId
            ? { kind: 'service' as const, id: interest.serviceId }
            : { kind: 'package' as const, id: interest.packageId ?? '' },
        );
      }
      if (!leadHasContactMethod(lead)) return fail(route, 400, 'CONTACT_REQUIRED');
      touch();
      return json(route, detailOf(lead));
    }
    if (action === 'conversion-plan') {
      if (!isOpen(lead)) return fail(route, 409, 'INVALID_TRANSITION');
      const clientId = url.searchParams.get('clientId');
      if (clientId && !state.clients.some((c) => c.id === clientId && !c.archived)) {
        return fail(route, 409, 'CLIENT_ARCHIVED');
      }
      return json(route, rules.conversionPlan(lead, clientId));
    }
    if (action === 'convert') {
      const done = rules.convert(lead, convertLeadSchema.parse(request.postDataJSON()));
      if ('error' in done) return fail(route, ...done.error);
      return json(route, detailOf(lead));
    }
    if (action === 'stage') {
      const input = leadStageChangeSchema.parse(request.postDataJSON());
      if (lead.archivedAt) return fail(route, 409, 'LEAD_ARCHIVED');
      const hasSent = quotes.some((q) => q.leadId === lead.id && q.status === 'sent');
      const refusal = manualLeadMoveRefusal(lead.stage, input.stage, hasSent);
      if (refusal) return fail(route, 409, refusal);
      Object.assign(lead, { stage: input.stage, stageChangedAt: now() });
      if (input.nextFollowUpOn) lead.nextFollowUpOn = input.nextFollowUpOn;
      touch();
      return json(route, detailOf(lead));
    }
    if (action === 'owner') {
      const { ownerId } = leadOwnerChangeSchema.parse(request.postDataJSON());
      if (!isOpen(lead)) return fail(route, 409, 'LEAD_CLOSED');
      if (!eligibleOwners().some((u) => u.id === ownerId)) {
        return fail(route, 400, 'INVALID_LEAD_OWNER');
      }
      lead.ownerId = ownerId;
      touch();
      return json(route, detailOf(lead));
    }
    if (action === 'lose') {
      const input = loseLeadSchema.parse(request.postDataJSON());
      if (!isOpen(lead)) return fail(route, 409, 'INVALID_TRANSITION');
      if (input.reason === 'other' && !input.note) return fail(route, 400, 'NOTE_REQUIRED');
      const rejected = latestQuotes(lead).filter((q) => ['sent', 'expired'].includes(q.status));
      for (const q of rejected) {
        Object.assign(q, {
          status: 'rejected',
          response: {
            respondedOn: businessDate(),
            contact: null,
            note: input.note,
            by: person(me().user.id),
            rejectionReason: lossRejectionReason(input.reason),
          },
          updatedAt: now(),
        });
      }
      Object.assign(lead, {
        stage: 'lost',
        stageChangedAt: now(),
        lostReason: input.reason,
        lostNote: input.note,
        closedAt: now(),
        nextFollowUpOn: null,
      });
      touch();
      return json(route, {
        ...detailOf(lead),
        rejectedQuotes: rejected.map((q) => quoteDisplayNumber(q)),
      });
    }
    if (action === 'reopen') {
      const input = reopenLeadSchema.parse(request.postDataJSON());
      if (lead.stage !== 'lost' || lead.archivedAt) return fail(route, 409, 'INVALID_TRANSITION');
      if (followUpFails(input.nextFollowUpOn)) return fail(route, 400, 'INVALID_DATES');
      const ownerId = input.ownerId ?? lead.ownerId;
      if (!eligibleOwners().some((u) => u.id === ownerId)) {
        return fail(route, 400, 'INVALID_LEAD_OWNER');
      }
      Object.assign(lead, {
        stage: input.stage,
        stageChangedAt: now(),
        nextFollowUpOn: input.nextFollowUpOn,
        ownerId,
        lostReason: null,
        lostNote: null,
        closedAt: null,
      });
      touch();
      return json(route, detailOf(lead));
    }
    if (action === 'archive' || action === 'restore') {
      if (!manageAll()) return fail(route, 403, null);
      if (lead.stage === 'won') return fail(route, 409, 'INVALID_TRANSITION');
      if (action === 'archive' && quotes.some((q) => q.leadId === lead.id && !q.archivedAt)) {
        return fail(route, 409, 'LEAD_HAS_QUOTES');
      }
      lead.archivedAt = action === 'archive' ? now() : null;
      touch();
      return route.fulfill({ status: 204 });
    }
    if (action === 'notes' && method === 'POST') {
      const input = createLeadNoteSchema.parse(request.postDataJSON());
      if (lead.archivedAt) return fail(route, 409, 'LEAD_ARCHIVED');
      if (!isOpenLeadStage(lead.stage)) return fail(route, 409, 'LEAD_CLOSED');
      if (followUpFails(input.nextFollowUpOn)) return fail(route, 400, 'INVALID_DATES');
      const note: LeadNoteRecord = {
        id: id(nextId++),
        occurredAt: input.occurredAt ?? now(),
        channel: input.channel,
        summary: input.summary,
        authorId: me().user.id,
        archived: false,
      };
      lead.notes.push(note);
      lead.nextFollowUpOn = input.nextFollowUpOn;
      touch();
      const created = detailOf(lead).notes.find((n) => n.id === note.id);
      return json(route, created, 201);
    }
    const noteMatch = action?.match(/^notes\/([^/]+)(\/archive)?$/);
    if (noteMatch) {
      const note = lead.notes.find((n) => n.id === noteMatch[1] && !n.archived);
      if (!note) return fail(route, 404, null);
      if (!isOpen(lead)) return fail(route, 409, 'LEAD_CLOSED');
      if (noteMatch[2]) {
        if (note.authorId !== me().user.id && !manageAll()) return fail(route, 403, null);
        note.archived = true;
        return route.fulfill({ status: 204 });
      }
      if (note.authorId !== me().user.id) return fail(route, 403, null);
      Object.assign(note, definedFields(updateLeadNoteSchema.parse(request.postDataJSON())));
      return json(
        route,
        detailOf(lead).notes.find((n) => n.id === note.id),
      );
    }
    return undefined;
  };
}
// Invoices (F13)

interface PaymentRecord extends Omit<Payment, 'receiptNumber' | 'recordedBy' | 'voided'> {
  year: number;
  number: number;
  recordedById: string;
  voided: { at: string; byId: string; reason: string } | null;
}

interface InvoiceRecord {
  id: string;
  clientId: string;
  year: number | null;
  number: number | null;
  origin: InvoiceOrigin;
  currency: Currency;
  /** Stored as issued; `invoiceStatus` recomputes it on read (rule 21). */
  status: InvoiceStatus;
  projectId: string | null;
  retainerId: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  sypPerUsd: string | null;
  paymentTermsDays: number;
  notes: string | null;
  lines: {
    id: string;
    description: string;
    quantity: number;
    unitPriceMinor: number;
    source: InvoiceSource | null;
    /** The catalog service (F15 rules 21 and 22). */
    serviceId?: string | null;
  }[];
  payments: PaymentRecord[];
  pdf: InvoiceDetail['pdf'];
  draftPdf: InvoiceDetail['draftPdf'];
  issuedById: string | null;
  voided: { at: string; byId: string; reason: string } | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface ExpenseRecord extends Omit<ProjectExpense, 'usdMinor' | 'loggedBy'> {
  projectId: string;
  loggedById: string;
  archived: boolean;
}

interface InvoiceRecords {
  invoices: InvoiceRecord[];
  expenses: ExpenseRecord[];
  settings: Omit<InvoiceSettings, 'canEdit' | 'rateStale' | 'rateUpdatedBy' | 'updatedBy'> & {
    rateUpdatedById: string | null;
    updatedById: string | null;
  };
}

/**
 * Five invoices: Jasmine's two drafts (the Design milestone and October's social retainer month),
 * Jasmine's overdue, partly paid Discovery invoice, and Shifa's paid and void SYP invoices; two
 * expenses on Jasmine's identity project, one in SYP.
 */
export function invoicesSeed(): InvoiceRecords {
  const today = businessDate();
  const time = `${addDays(today, -2)}T08:00:00.000Z`;
  const invoice = (
    n: number,
    fields: Partial<InvoiceRecord> & Pick<InvoiceRecord, 'clientId' | 'origin' | 'lines'>,
  ): InvoiceRecord => ({
    id: id(n),
    year: null,
    number: null,
    currency: 'USD',
    status: 'draft',
    projectId: null,
    retainerId: null,
    issuedOn: null,
    dueOn: null,
    sypPerUsd: null,
    paymentTermsDays: 7,
    notes: null,
    payments: [],
    pdf: null,
    draftPdf: null,
    issuedById: null,
    voided: null,
    createdById: null,
    createdAt: time,
    updatedAt: time,
    archivedAt: null,
    ...fields,
  });
  const issued = (issuedOn: string) => ({
    issuedOn,
    dueOn: addDays(issuedOn, 7),
    issuedById: id(1),
    pdf: { state: 'ready' as const },
  });
  const payment = (
    n: number,
    number: number,
    fields: Pick<PaymentRecord, 'paidOn' | 'amountMinor' | 'currency' | 'appliedMinor' | 'method'> &
      Partial<PaymentRecord>,
  ): PaymentRecord => ({
    id: id(n),
    year: 2026,
    number,
    sypPerUsd: '118.5000',
    reference: null,
    note: null,
    proof: null,
    receiptPdf: { state: 'ready' },
    recordedById: id(1),
    createdAt: `${fields.paidOn}T10:00:00.000Z`,
    voided: null,
    ...fields,
  });
  const expense = (
    n: number,
    fields: Pick<ExpenseRecord, 'spentOn' | 'description' | 'amountMinor' | 'currency'>,
  ): ExpenseRecord => ({
    id: id(n),
    projectId: id(801),
    sypPerUsd: '118.5000',
    note: null,
    loggedById: id(1),
    createdAt: `${fields.spentOn}T12:00:00.000Z`,
    updatedAt: `${fields.spentOn}T12:00:00.000Z`,
    archived: false,
    ...fields,
  });
  return {
    expenses: [
      expense(9451, {
        spentOn: addDays(today, -18),
        description: 'طباعة نماذج الهوية',
        amountMinor: 1_185_000,
        currency: 'SYP',
      }),
      expense(9452, {
        spentOn: addDays(today, -10),
        description: 'خطوط مرخّصة للهوية',
        amountMinor: 12_000,
        currency: 'USD',
      }),
    ],
    settings: {
      sypPerUsd: '118.5000',
      paymentTermsDays: 7,
      paymentDetails: 'بنك سورية الدولي الإسلامي — حساب 0000-1111\nشام كاش: 0999 000 000',
      invoiceFooter: 'شكرًا لثقتكم بـ Vertex Media.',
      rateUpdatedAt: time,
      rateUpdatedById: id(1),
      updatedAt: time,
      updatedById: id(1),
    },
    invoices: [
      invoice(9401, {
        clientId: id(601),
        origin: 'milestone_done',
        projectId: id(801),
        lines: [
          {
            id: id(9411),
            description: 'الهوية البصرية الجديدة — التصميم',
            quantity: 1,
            unitPriceMinor: 150_000,
            source: { type: 'milestone', id: id(812) },
          },
        ],
      }),
      invoice(9402, {
        clientId: id(601),
        origin: 'cycle_opened',
        retainerId: id(901),
        lines: [
          {
            id: id(9412),
            description: 'إدارة السوشيال ميديا — أكتوبر 2026',
            quantity: 1,
            unitPriceMinor: 150_000,
            source: { type: 'retainer_charge', id: retainerChargeId(id(921)) },
          },
        ],
      }),
      invoice(9403, {
        clientId: id(601),
        origin: 'quote_accepted',
        projectId: id(801),
        year: 2026,
        number: 1,
        status: 'sent',
        sypPerUsd: '118.5000',
        ...issued(addDays(today, -25)),
        lines: [
          {
            id: id(9413),
            description: 'الهوية البصرية الجديدة — الاستكشاف',
            quantity: 1,
            unitPriceMinor: 60_000,
            source: { type: 'milestone', id: id(811) },
          },
        ],
        payments: [
          payment(9431, 1, {
            paidOn: addDays(today, -20),
            amountMinor: 20_000,
            currency: 'USD',
            appliedMinor: 20_000,
            method: 'bank_transfer',
            reference: 'بنك البركة 77120',
          }),
        ],
      }),
      invoice(9404, {
        clientId: id(602),
        origin: 'manual',
        currency: 'SYP',
        year: 2026,
        number: 2,
        status: 'sent',
        sypPerUsd: '118.5000',
        createdById: id(1),
        ...issued(addDays(today, -40)),
        lines: [
          {
            id: id(9414),
            description: 'تصميم بروشور العيادة',
            quantity: 2,
            unitPriceMinor: 2_500_000,
            source: null,
          },
        ],
        payments: [
          payment(9432, 2, {
            paidOn: addDays(today, -35),
            amountMinor: 5_000_000,
            currency: 'SYP',
            appliedMinor: 5_000_000,
            method: 'cash',
          }),
        ],
      }),
      invoice(9405, {
        clientId: id(602),
        origin: 'manual',
        currency: 'SYP',
        year: 2026,
        number: 3,
        status: 'void',
        sypPerUsd: '118.5000',
        createdById: id(1),
        ...issued(addDays(today, -30)),
        voided: { at: `${addDays(today, -29)}T09:00:00.000Z`, byId: id(1), reason: 'خطأ في السعر' },
        lines: [
          {
            id: id(9415),
            description: 'تصميم بروشور العيادة',
            quantity: 1,
            unitPriceMinor: 3_000_000,
            source: null,
          },
        ],
      }),
    ],
  };
}

interface InvoiceState {
  billing: InvoiceRecords;
  clients: ClientRecord[];
  users: UserResponse[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  catalog: CatalogRecords;
  me: () => MeResponse;
}

/** The invoices API over the in-memory records, with the F13 rules the screens rely on. */
function invoiceRoutes({
  billing,
  clients,
  users,
  projects,
  retainers,
  catalog,
  me,
}: InvoiceState) {
  const { invoices, settings, expenses } = billing;
  let nextId = 9500;
  let clock = Date.parse('2026-10-02T09:00:00.000Z');
  const now = () => {
    clock += 60_000;
    return new Date(clock).toISOString();
  };
  const today = () => businessDate();
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const holds = (permission: Permission) => scopes(permission).length > 0;
  const covers = (permission: Permission, clientId: string) => {
    const granted = scopes(permission);
    const client = clients.find((c) => c.id === clientId);
    return (
      granted.includes('all') ||
      (granted.includes('own_clients') && client?.accountManagerId === me().user.id)
    );
  };
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const named = (record: { id: string; name: string } | undefined) =>
    record ? { id: record.id, name: record.name } : null;
  const live = (i: InvoiceRecord) => !i.archivedAt && i.status !== 'void';
  const chargesOf = (r: RetainerRecord) =>
    [
      ...((r.monthlyFeeMinor ?? 0) > 0
        ? r.cycles
            .filter((c) => !termCovers(r, c.month))
            .map((c) => ({
              id: retainerChargeId(c.id),
              month: c.month,
              kind: 'monthly' as const,
              amountMinor: r.monthlyFeeMinor ?? 0,
              status: 'pending' as const,
              term: null,
              due: true,
            }))
        : []),
      ...termChargesOf(r, PROJECTS_TODAY),
    ].sort((a, b) => b.month.localeCompare(a.month));
  const chargeById = (chargeId: string) => {
    for (const retainer of retainers) {
      const charge = chargesOf(retainer).find((c) => c.id === chargeId);
      if (charge) return { retainer, charge };
    }
    return undefined;
  };
  const heldBy = (sourceId: string) =>
    invoices.find((i) => live(i) && i.lines.some((line) => line.source?.id === sourceId));

  const sourceOf = (source: InvoiceSource) => {
    if (source.type === 'milestone') {
      const project = projects.find((p) => p.milestones.some((m) => m.id === source.id));
      const found = project?.milestones.find((m) => m.id === source.id);
      return { ...source, name: found?.name ?? '', project: named(project), retainer: null };
    }
    if (source.type === 'retainer_charge') {
      const found = chargeById(source.id);
      return {
        ...source,
        name: found?.charge.month ?? '',
        project: null,
        retainer: named(found?.retainer),
      };
    }
    const project = projects.find((p) => p.extraWork.some((w) => w.id === source.id));
    const retainer = retainers.find((r) => r.extraWork.some((w) => w.id === source.id));
    const work = [...(project?.extraWork ?? []), ...(retainer?.extraWork ?? [])].find(
      (w) => w.id === source.id,
    );
    return {
      ...source,
      name: work?.title ?? '',
      project: named(project),
      retainer: named(retainer),
    };
  };
  const extraWorkOf = (i: InvoiceRecord) =>
    i.lines.flatMap((line) =>
      line.source?.type === 'extra_work'
        ? [...projects, ...retainers].flatMap((e) =>
            e.extraWork.filter((w) => w.id === line.source?.id),
          )
        : [],
    );

  const listItemOf = (i: InvoiceRecord): Invoice => {
    const client = clients.find((c) => c.id === i.clientId);
    const totalMinor = invoiceTotal(i.lines);
    const paidMinor = i.payments.reduce((sum, p) => sum + (p.voided ? 0 : p.appliedMinor), 0);
    const status = invoiceStatus({
      status: i.status,
      totalMinor,
      paidMinor,
      dueOn: i.dueOn,
      today: today(),
    });
    const project = projects.find((p) => p.id === i.projectId);
    const retainer = retainers.find((r) => r.id === i.retainerId);
    return {
      id: i.id,
      displayNumber:
        i.year && i.number ? invoiceDisplayNumber({ year: i.year, number: i.number }) : null,
      client: { id: i.clientId, name: client?.tradeName ?? '' },
      accountManager: person(client?.accountManagerId ?? id(1)),
      engagement: project
        ? { type: 'project', id: project.id, name: project.name }
        : retainer
          ? { type: 'retainer', id: retainer.id, name: retainer.name }
          : null,
      origin: i.origin,
      currency: i.currency,
      status,
      issuedOn: i.issuedOn,
      dueOn: i.dueOn,
      totalMinor,
      paidMinor,
      balanceMinor: totalMinor - paidMinor,
      daysOverdue:
        status === 'overdue' && i.dueOn
          ? Math.round((Date.parse(today()) - Date.parse(i.dueOn)) / 86_400_000)
          : null,
      updatedAt: i.updatedAt,
      archivedAt: i.archivedAt,
    };
  };

  const detailOf = (i: InvoiceRecord): InvoiceDetail => {
    const item = listItemOf(i);
    const client = clients.find((c) => c.id === i.clientId);
    const manages = holds('invoices.manage');
    const pays = holds('payments.manage');
    const draft = item.status === 'draft' && !i.archivedAt;
    const open = (OPEN_INVOICE_STATUSES as readonly InvoiceStatus[]).includes(item.status);
    const livePayments = i.payments.some((p) => !p.voided);
    const usd = (minor: number) => (i.sypPerUsd ? toUsdMinor(minor, i.currency, i.sypPerUsd) : 0);
    return {
      ...item,
      billingName: client?.billingName ?? client?.tradeName ?? '',
      billingAddress: client?.billingAddress ?? null,
      year: i.year,
      number: i.number,
      quote: null,
      paymentTermsDays: i.paymentTermsDays,
      sypPerUsd: i.sypPerUsd,
      usd: i.sypPerUsd
        ? {
            totalMinor: usd(item.totalMinor),
            paidMinor: usd(item.paidMinor),
            balanceMinor: usd(item.balanceMinor),
          }
        : null,
      notes: i.notes,
      lines: i.lines.map((line) => ({
        ...line,
        totalMinor: line.quantity * line.unitPriceMinor,
        source: line.source ? sourceOf(line.source) : null,
        service: serviceOf(line.serviceId ?? null),
      })),
      payments: i.payments.map((p) => ({
        id: p.id,
        receiptNumber: receiptDisplayNumber(p),
        paidOn: p.paidOn,
        amountMinor: p.amountMinor,
        currency: p.currency,
        sypPerUsd: p.sypPerUsd,
        appliedMinor: p.appliedMinor,
        method: p.method,
        reference: p.reference,
        note: p.note,
        proof: p.proof,
        receiptPdf: p.receiptPdf,
        recordedBy: person(p.recordedById),
        createdAt: p.createdAt,
        voided: p.voided
          ? { at: p.voided.at, by: person(p.voided.byId), reason: p.voided.reason }
          : null,
      })),
      pdf: i.pdf,
      draftPdf: i.draftPdf,
      issuedBy: i.issuedById ? person(i.issuedById) : null,
      voided: i.voided
        ? { at: i.voided.at, by: person(i.voided.byId), reason: i.voided.reason }
        : null,
      createdBy: i.createdById ? person(i.createdById) : null,
      createdAt: i.createdAt,
      permissions: {
        canEdit: manages && draft,
        canIssue: manages && draft,
        canArchive: manages && draft,
        canChangeDueDate: manages && open,
        canVoid: manages && ['sent', 'overdue'].includes(item.status) && !livePayments,
        canRecordPayment: pays && open,
        canVoidPayments: pays && item.status !== 'draft' && item.status !== 'void',
        canRenderPdf: draft ? manages : i.pdf?.state === 'failed',
        canEditServices: manages && item.status !== 'draft' && item.status !== 'void',
      },
    };
  };
  const serviceOf = (serviceId: string | null) => {
    const service = catalog.services.find((s) => s.id === serviceId);
    return service
      ? { id: service.id, name: service.name, archived: service.archivedAt !== null }
      : null;
  };
  const settingsOf = (): InvoiceSettings => {
    const { rateUpdatedById, updatedById, ...rest } = settings;
    return {
      ...rest,
      rateUpdatedBy: rateUpdatedById ? person(rateUpdatedById) : null,
      updatedBy: updatedById ? person(updatedById) : null,
      rateStale: rateIsStale(settings.rateUpdatedAt ? new Date(settings.rateUpdatedAt) : null),
      canEdit: holds('invoices.manage'),
    };
  };
  const nextNumber = (year: number) =>
    Math.max(0, ...invoices.filter((i) => i.year === year).map((i) => i.number ?? 0)) + 1;
  const nextReceipt = (year: number) =>
    Math.max(
      0,
      ...invoices.flatMap((i) => i.payments.filter((p) => p.year === year).map((p) => p.number)),
    ) + 1;

  const sourceInvoiceOf = (sourceId: string): SourceInvoice | null => {
    const held = heldBy(sourceId);
    if (!held) return null;
    const item = listItemOf(held);
    return { id: item.id, displayNumber: item.displayNumber, status: item.status };
  };
  const newestFirst = (list: Invoice[]) =>
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const issuedLive = (i: Invoice) => i.status !== 'draft' && i.status !== 'void';
  const rateOf = (invoiceId: string) => invoices.find((r) => r.id === invoiceId)?.sypPerUsd ?? '1';

  const clientBillingOf = (clientId: string): ClientBilling => {
    const own = invoices.filter((i) => !i.archivedAt && i.clientId === clientId).map(listItemOf);
    const issued = own.filter(issuedLive);
    const open = (i: Invoice) => (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status);
    const sum = (list: Invoice[], pick: (i: Invoice) => number) =>
      list.reduce((total, i) => total + pick(i), 0);
    return {
      byCurrency: CURRENCIES.filter((c) => issued.some((i) => i.currency === c)).map((currency) => {
        const mine = issued.filter((i) => i.currency === currency);
        return {
          currency,
          invoicedMinor: sum(mine, (i) => i.totalMinor),
          paidMinor: sum(mine, (i) => i.paidMinor),
          outstandingMinor: sum(mine.filter(open), (i) => i.balanceMinor),
          overdueMinor: sum(
            mine.filter((i) => i.status === 'overdue'),
            (i) => i.balanceMinor,
          ),
        };
      }),
      latest: newestFirst(own).slice(0, 5),
    };
  };

  const statementOf = (client: ClientRecord, q: URLSearchParams): ClientStatement => {
    const currency = (q.get('currency') ?? 'USD') as Currency;
    const from = q.get('from') ?? `${today().slice(0, 4)}-01-01`;
    const to = q.get('to') ?? today();
    const live = invoices.filter(
      (i) =>
        !i.archivedAt &&
        i.clientId === client.id &&
        i.currency === currency &&
        issuedLive(listItemOf(i)),
    );
    const number = (i: InvoiceRecord) =>
      invoiceDisplayNumber({ year: i.year ?? 0, number: i.number ?? 0 });
    const rows = statementRows({
      invoices: live.map((i) => ({
        id: i.id,
        displayNumber: number(i),
        issuedOn: i.issuedOn ?? '',
        totalMinor: invoiceTotal(i.lines),
      })),
      payments: live.flatMap((i) =>
        i.payments
          .filter((p) => !p.voided)
          .map((p) => ({
            id: p.id,
            receiptNumber: receiptDisplayNumber(p),
            invoiceId: i.id,
            invoiceNumber: number(i),
            paidOn: p.paidOn,
            appliedMinor: p.appliedMinor,
            amountMinor: p.amountMinor,
            currency: p.currency,
          })),
      ),
      statementCurrency: currency,
      from,
      to,
    });
    return {
      client: { id: client.id, name: client.tradeName },
      billingName: client.billingName ?? client.tradeName,
      billingAddress: client.billingAddress ?? null,
      currency,
      from,
      to,
      ...rows,
      outstandingMinor: rows.closingMinor,
    };
  };

  const expenseUsd = (e: Pick<ExpenseRecord, 'amountMinor' | 'currency' | 'sypPerUsd'>) =>
    toUsdMinor(e.amountMinor, e.currency, e.sypPerUsd);

  const projectBillingOf = (project: ProjectRecord): ProjectBilling => {
    const own = invoices.filter((i) => !i.archivedAt && i.projectId === project.id).map(listItemOf);
    const issued = own.filter(issuedLive);
    const kept = expenses.filter((e) => e.projectId === project.id && !e.archived);
    const invoicedUsdMinor = issued.reduce(
      (sum, i) => sum + toUsdMinor(i.totalMinor, i.currency, rateOf(i.id)),
      0,
    );
    const collectedUsdMinor = invoices
      .filter((r) => issued.some((i) => i.id === r.id))
      .flatMap((r) => r.payments.filter((p) => !p.voided))
      .reduce((sum, p) => sum + toUsdMinor(p.amountMinor, p.currency, p.sypPerUsd), 0);
    const expensesUsdMinor = kept.reduce((sum, e) => sum + expenseUsd(e), 0);
    const milestones = project.milestones.filter((m) => !m.archived);
    return {
      project: {
        id: project.id,
        name: project.name,
        currency: project.currency,
        archived: project.archived,
      },
      milestones: milestones.map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        dueDate: m.dueDate,
        installmentMinor: m.installmentMinor,
        invoice: sourceInvoiceOf(m.id),
      })),
      invoices: newestFirst(own),
      expenses: [...kept]
        .sort((a, b) => b.spentOn.localeCompare(a.spentOn))
        .map(({ projectId: _, loggedById, archived: __, ...e }) => ({
          ...e,
          usdMinor: expenseUsd(e),
          loggedBy: person(loggedById),
        })),
      margin: {
        invoicedUsdMinor,
        collectedUsdMinor,
        expensesUsdMinor,
        marginUsdMinor: invoicedUsdMinor - expensesUsdMinor,
        plannedInstallmentsMinor: milestones.reduce((sum, m) => sum + (m.installmentMinor ?? 0), 0),
      },
      canManageExpenses: covers('expenses.manage', project.clientId) && !project.archived,
    };
  };

  const retainerBillingOf = (retainer: RetainerRecord): RetainerBilling => ({
    retainer: {
      id: retainer.id,
      name: retainer.name,
      currency: retainer.currency,
      monthlyFeeMinor: retainer.monthlyFeeMinor,
      archived: retainer.archived,
    },
    charges: chargesOf(retainer).map((c) => ({ ...c, invoice: sourceInvoiceOf(c.id) })),
    extraWork: retainer.extraWork
      .filter((w) => !w.archived)
      .map((w) => ({
        id: w.id,
        title: w.title,
        billingStatus: w.billingStatus,
        estimateMinor: w.estimateMinor,
        invoice: sourceInvoiceOf(w.id),
      })),
    invoices: newestFirst(
      invoices.filter((i) => !i.archivedAt && i.retainerId === retainer.id).map(listItemOf),
    ),
  });

  /** Client balances and statements, project and retainer billing, and project expenses. */
  const billingRoutes = (
    route: Route,
    method: string,
    url: URL,
    request: Request,
  ): Promise<void> | undefined => {
    const path = url.pathname;
    const owned = path.match(/^\/api\/(clients|projects|retainers)\/([^/]+)\/(.+)$/);
    if (owned?.[1] === 'clients') {
      const client = clients.find((c) => c.id === owned[2]);
      if (!client || !covers('invoices.read', client.id)) return fail(route, 404, null);
      if (owned[3] === 'billing') return json(route, clientBillingOf(client.id));
      if (owned[3] === 'statement') return json(route, statementOf(client, url.searchParams));
      if (owned[3] === 'statement/pdf') {
        // Asked for, then found ready by the page's `HEAD` check.
        if (method === 'POST') return json(route, { state: 'pending' });
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n' });
      }
      return undefined;
    }
    if (owned?.[1] === 'projects') {
      const project = projects.find((p) => p.id === owned[2]);
      if (!project) return fail(route, 404, null);
      if (owned[3] === 'billing') {
        if (!covers('invoices.read', project.clientId)) return fail(route, 403, null);
        return json(route, projectBillingOf(project));
      }
      if (owned[3] === 'expenses' && method === 'POST') {
        if (!covers('expenses.manage', project.clientId)) return fail(route, 403, null);
        if (project.archived) return fail(route, 409, 'PROJECT_ARCHIVED');
        const input = createProjectExpenseSchema.parse(request.postDataJSON());
        const at = now();
        expenses.push({
          id: id(nextId++),
          projectId: project.id,
          spentOn: input.spentOn,
          description: input.description,
          amountMinor: input.amountMinor,
          currency: input.currency ?? project.currency,
          sypPerUsd: input.sypPerUsd ?? settings.sypPerUsd ?? '1',
          note: input.note,
          loggedById: me().user.id,
          createdAt: at,
          updatedAt: at,
          archived: false,
        });
        return json(route, projectBillingOf(project), 201);
      }
      return undefined;
    }
    if (owned?.[1] === 'retainers' && owned[3] === 'billing') {
      const retainer = retainers.find((r) => r.id === owned[2]);
      if (!retainer) return fail(route, 404, null);
      if (!covers('invoices.read', retainer.clientId)) return fail(route, 403, null);
      return json(route, retainerBillingOf(retainer));
    }
    const expenseMatch = path.match(/^\/api\/project-expenses\/([^/]+)(?:\/(archive))?$/);
    if (expenseMatch) {
      const expense = expenses.find((e) => e.id === expenseMatch[1] && !e.archived);
      const project = projects.find((p) => p.id === expense?.projectId);
      if (!expense || !project) return fail(route, 404, null);
      if (!covers('expenses.manage', project.clientId)) return fail(route, 403, null);
      if (expenseMatch[2] === 'archive') {
        expense.archived = true;
      } else {
        const input = updateProjectExpenseSchema.parse(request.postDataJSON());
        Object.assign(expense, definedFields(input), { updatedAt: now() });
      }
      return json(route, projectBillingOf(project));
    }
    return undefined;
  };

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const billed = billingRoutes(route, method, url, request);
    if (billed) return billed;
    if (path === '/api/invoice-settings') {
      if (!holds('invoices.read')) return fail(route, 403, null);
      if (method === 'PATCH') {
        if (!holds('invoices.manage')) return fail(route, 403, null);
        const input = updateInvoiceSettingsSchema.parse(request.postDataJSON());
        const at = now();
        if (input.sypPerUsd !== undefined) {
          settings.sypPerUsd = input.sypPerUsd;
          settings.rateUpdatedAt = at;
          settings.rateUpdatedById = me().user.id;
        }
        Object.assign(settings, definedFields({ ...input, sypPerUsd: undefined }), {
          updatedAt: at,
          updatedById: me().user.id,
        });
      }
      return json(route, settingsOf());
    }
    if (path.startsWith('/api/payments/')) {
      const match = path.match(/^\/api\/payments\/([^/]+)\/(void|receipt)$/);
      const owner = invoices.find((i) => i.payments.some((p) => p.id === match?.[1]));
      const payment = owner?.payments.find((p) => p.id === match?.[1]);
      if (!match || !owner || !payment || !covers('invoices.read', owner.clientId)) {
        return fail(route, 404, null);
      }
      if (match[2] === 'void' && method === 'POST') {
        if (!holds('payments.manage')) return fail(route, 403, null);
        if (payment.voided) return fail(route, 409, 'INVALID_TRANSITION');
        const { reason } = voidPaymentSchema.parse(request.postDataJSON());
        payment.voided = { at: now(), byId: me().user.id, reason };
        owner.updatedAt = now();
        return json(route, detailOf(owner));
      }
      if (match[2] === 'receipt' && method === 'POST') {
        payment.receiptPdf = { state: 'ready' };
        return json(route, { state: 'ready' });
      }
      return undefined;
    }
    if (!path.startsWith('/api/invoices')) return undefined;
    if (!holds('invoices.read')) return fail(route, 403, null);

    if (path === '/api/invoices' && method === 'GET') {
      const q = url.searchParams;
      const statuses = q.getAll('status');
      const wanted: string[] = statuses.length > 0 ? statuses : ['draft', ...OPEN_INVOICE_STATUSES];
      const search = q.get('search')?.toLowerCase();
      const matching = invoices
        .filter((i) => !i.archivedAt && covers('invoices.read', i.clientId))
        .map(listItemOf)
        .filter(
          (i) =>
            (!q.get('clientId') || i.client.id === q.get('clientId')) &&
            (!q.get('currency') || i.currency === q.get('currency')) &&
            (!q.get('accountManagerId') || i.accountManager.id === q.get('accountManagerId')) &&
            (!q.get('dueFrom') || (i.dueOn ?? '') >= (q.get('dueFrom') ?? '')) &&
            (!q.get('dueTo') || (i.dueOn !== null && i.dueOn <= (q.get('dueTo') ?? ''))) &&
            (!search ||
              i.client.name.toLowerCase().includes(search) ||
              (i.displayNumber ?? '').toLowerCase().includes(search)),
        );
      const items = matching
        .filter((i) => wanted.includes(i.status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const open = matching.filter((i) =>
        (OPEN_INVOICE_STATUSES as readonly string[]).includes(i.status),
      );
      const rateOf = (i: Invoice) => invoices.find((r) => r.id === i.id)?.sypPerUsd ?? '1';
      const sum = (list: Invoice[], usd: boolean) =>
        list.reduce(
          (total, i) =>
            total + (usd ? toUsdMinor(i.balanceMinor, i.currency, rateOf(i)) : i.balanceMinor),
          0,
        );
      const totals: InvoicePage['totals'] = {
        byCurrency: CURRENCIES.filter((currency) => open.some((i) => i.currency === currency)).map(
          (currency) => {
            const mine = open.filter((i) => i.currency === currency);
            return {
              currency,
              outstandingMinor: sum(mine, false),
              overdueMinor: sum(
                mine.filter((i) => i.status === 'overdue'),
                false,
              ),
            };
          },
        ),
        usd: {
          outstandingMinor: sum(open, true),
          overdueMinor: sum(
            open.filter((i) => i.status === 'overdue'),
            true,
          ),
        },
      };
      return json(route, { items, total: items.length, page: 1, pageSize: 25, totals });
    }
    if (path === '/api/invoices/billable' && method === 'GET') {
      if (!holds('invoices.manage')) return fail(route, 403, null);
      const clientId = url.searchParams.get('clientId') ?? '';
      const currency = url.searchParams.get('currency');
      const ownProjects = projects.filter(
        (p) => p.clientId === clientId && !p.archived && p.currency === currency,
      );
      const ownRetainers = retainers.filter(
        (r) => r.clientId === clientId && !r.archived && r.currency === currency,
      );
      const items: BillableItems = {
        milestones: ownProjects.flatMap((p) =>
          p.milestones
            .filter((m) => !m.archived && (m.installmentMinor ?? 0) > 0 && !heldBy(m.id))
            .map((m) => ({
              id: m.id,
              project: { id: p.id, name: p.name },
              name: m.name,
              status: m.status,
              installmentMinor: m.installmentMinor ?? 0,
            })),
        ),
        charges: ownRetainers.flatMap((r) =>
          chargesOf(r)
            .filter((c) => !heldBy(c.id))
            .map((c) => ({
              id: c.id,
              retainer: { id: r.id, name: r.name },
              month: c.month,
              kind: c.kind,
              amountMinor: c.amountMinor,
            })),
        ),
        extraWork: [...ownProjects, ...ownRetainers].flatMap((e) =>
          e.extraWork
            .filter((w) => !w.archived && w.billingStatus === 'unbilled' && !heldBy(w.id))
            .map((w) => ({
              id: w.id,
              project: 'milestones' in e ? { id: e.id, name: e.name } : null,
              retainer: 'cycles' in e ? { id: e.id, name: e.name } : null,
              title: w.title,
              estimateMinor: w.estimateMinor,
            })),
        ),
      };
      return json(route, items);
    }
    if (path === '/api/invoices' && method === 'POST') {
      if (!holds('invoices.manage')) return fail(route, 403, null);
      const input = createInvoiceSchema.parse(request.postDataJSON());
      const at = now();
      // Rule 6: each source at its default amount; the sources set the engagement.
      const lines = input.sources.map((source) => {
        const found = sourceOf(source);
        const project = projects.find((p) => p.id === found.project?.id);
        const retainer = retainers.find((r) => r.id === found.retainer?.id);
        const work = [...(project?.extraWork ?? []), ...(retainer?.extraWork ?? [])].find(
          (w) => w.id === source.id,
        );
        const amount =
          source.type === 'milestone'
            ? (project?.milestones.find((m) => m.id === source.id)?.installmentMinor ?? 0)
            : source.type === 'retainer_charge'
              ? (chargeById(source.id)?.charge.amountMinor ?? 0)
              : (work?.estimateMinor ?? 0);
        return {
          id: id(nextId++),
          description: `${found.project?.name ?? found.retainer?.name ?? ''} — ${found.name}`,
          quantity: 1,
          unitPriceMinor: amount,
          source,
        };
      });
      const first = lines[0] ? sourceOf(lines[0].source) : null;
      const created: InvoiceRecord = {
        id: id(nextId++),
        clientId: input.clientId,
        year: null,
        number: null,
        origin: 'manual',
        currency: input.currency,
        status: 'draft',
        projectId: input.projectId ?? first?.project?.id ?? null,
        retainerId: input.retainerId ?? first?.retainer?.id ?? null,
        issuedOn: null,
        dueOn: null,
        sypPerUsd: null,
        paymentTermsDays: settings.paymentTermsDays,
        notes: null,
        lines,
        payments: [],
        pdf: null,
        draftPdf: null,
        issuedById: null,
        voided: null,
        createdById: me().user.id,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      };
      invoices.push(created);
      return json(route, detailOf(created), 201);
    }

    const match = path.match(/^\/api\/invoices\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const i = invoices.find((x) => x.id === match[1]);
    if (!i || !covers('invoices.read', i.clientId)) return fail(route, 404, null);
    const action = match[2];
    if (!action && method === 'GET') return json(route, detailOf(i));
    if (action === 'pdf' && method === 'POST') {
      if (i.status === 'draft') {
        i.draftPdf = { state: 'ready', renderedAt: now(), outdated: false };
      } else {
        i.pdf = { state: 'ready' };
      }
      return json(route, { state: 'ready' });
    }

    if (!holds(action === 'payments' ? 'payments.manage' : 'invoices.manage')) {
      return fail(route, 403, null);
    }
    const status = listItemOf(i).status;
    // F15 rule 22: services change on issued, non-void invoices only; nothing else does.
    if (action === 'services' && method === 'PUT') {
      if (status === 'draft' || status === 'void') return fail(route, 409, 'INVALID_TRANSITION');
      const input = updateInvoiceServicesSchema.parse(request.postDataJSON());
      for (const change of input.lines) {
        const line = i.lines.find((l) => l.id === change.lineId);
        if (!line) return fail(route, 404, null);
        const service = catalog.services.find((s) => s.id === change.serviceId);
        if (
          change.serviceId &&
          line.serviceId !== change.serviceId &&
          service?.archivedAt !== null
        ) {
          return fail(route, 400, 'INVALID_SERVICE');
        }
        line.serviceId = change.serviceId;
      }
      return json(route, detailOf(i));
    }
    if (!action && method === 'PUT') {
      if (status !== 'draft') return fail(route, 409, 'INVOICE_LOCKED');
      const input = invoiceDraftSchema.parse(request.postDataJSON());
      if (input.updatedAt !== i.updatedAt) return fail(route, 409, 'STALE_INVOICE');
      Object.assign(i, {
        projectId: input.projectId,
        retainerId: input.retainerId,
        paymentTermsDays: input.paymentTermsDays,
        notes: input.notes,
        lines: input.lines.map((line) => ({ ...line, id: line.id ?? id(nextId++) })),
        updatedAt: now(),
      });
      if (i.draftPdf) i.draftPdf.outdated = true;
      return json(route, detailOf(i));
    }
    if (action === 'issue' && method === 'POST') {
      if (status !== 'draft' || i.archivedAt) return fail(route, 409, 'INVALID_TRANSITION');
      const input = issueInvoiceSchema.parse(request.postDataJSON());
      if (input.updatedAt !== i.updatedAt) return fail(route, 409, 'STALE_INVOICE');
      if (invoiceTotal(i.lines) === 0) return fail(route, 409, 'INVOICE_EMPTY');
      const rate = input.sypPerUsd ?? settings.sypPerUsd;
      if (!rate) return fail(route, 409, 'RATE_REQUIRED');
      const year = Number(today().slice(0, 4));
      Object.assign(i, {
        year,
        number: nextNumber(year),
        status: 'sent',
        issuedOn: today(),
        dueOn: input.dueOn ?? addDays(today(), i.paymentTermsDays),
        sypPerUsd: rate,
        issuedById: me().user.id,
        pdf: { state: 'ready' },
        draftPdf: null,
        updatedAt: now(),
      });
      for (const work of extraWorkOf(i)) work.billingStatus = 'billed';
      return json(route, detailOf(i));
    }
    if (action === 'due-date' && method === 'POST') {
      if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(status)) {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      const input = changeInvoiceDueDateSchema.parse(request.postDataJSON());
      if (input.dueOn < today()) return fail(route, 400, 'INVALID_DATES');
      Object.assign(i, { dueOn: input.dueOn, updatedAt: now() });
      return json(route, detailOf(i));
    }
    if (action === 'void' && method === 'POST') {
      if (i.payments.some((p) => !p.voided)) return fail(route, 409, 'INVOICE_HAS_PAYMENTS');
      if (status !== 'sent' && status !== 'overdue') return fail(route, 409, 'INVALID_TRANSITION');
      const { reason } = voidInvoiceSchema.parse(request.postDataJSON());
      Object.assign(i, {
        status: 'void',
        voided: { at: now(), byId: me().user.id, reason },
        updatedAt: now(),
      });
      for (const work of extraWorkOf(i)) work.billingStatus = 'unbilled';
      return json(route, detailOf(i));
    }
    if (action === 'archive' && method === 'POST') {
      if (status !== 'draft') return fail(route, 409, 'INVALID_TRANSITION');
      i.archivedAt = now();
      return route.fulfill({ status: 204 });
    }
    if (action === 'payments' && method === 'POST') {
      if (!(OPEN_INVOICE_STATUSES as readonly string[]).includes(status)) {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      const input = recordPaymentSchema.parse(request.postDataJSON());
      if (input.paidOn > today()) return fail(route, 400, 'INVALID_DATES');
      const rate = input.sypPerUsd ?? settings.sypPerUsd;
      if (!rate) return fail(route, 409, 'RATE_REQUIRED');
      const applied = applyPayment(
        listItemOf(i).balanceMinor,
        input.amountMinor,
        input.currency,
        i.currency,
        rate,
      );
      if (applied === null) return fail(route, 409, 'OVERPAYMENT');
      const year = Number(input.paidOn.slice(0, 4));
      i.payments.push({
        id: id(nextId++),
        year,
        number: nextReceipt(year),
        paidOn: input.paidOn,
        amountMinor: input.amountMinor,
        currency: input.currency,
        sypPerUsd: rate,
        appliedMinor: applied,
        method: input.method,
        reference: input.reference,
        note: input.note,
        proof: input.proofUploadId ? { id: id(nextId++), name: 'إثبات الدفع.jpg' } : null,
        receiptPdf: { state: 'ready' },
        recordedById: me().user.id,
        createdAt: now(),
        voided: null,
      });
      i.updatedAt = now();
      return json(route, detailOf(i));
    }
    return undefined;
  };
}
// Ad campaigns and wallets (F12).

interface CampaignUpdateRecord {
  id: string;
  campaignId: string;
  periodStart: string;
  periodEnd: string;
  spendMinor: number;
  reach: number;
  clicks: number;
  results: number;
  note: string;
  enteredById: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

interface CampaignRecord {
  id: string;
  clientId: string;
  name: string;
  platform: AdPlatform;
  objective: AdObjective;
  funding: AdFunding;
  budgetMinor: number;
  startsOn: string;
  endsOn: string | null;
  ownerId: string;
  status: AdCampaignStatus;
  projectId: string | null;
  retainerId: string | null;
  taskId: string | null;
  notes: string;
  cancelReason: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface WalletEntryRecord
  extends Omit<WalletEntry, 'receiptNumber' | 'recordedBy' | 'voided' | 'proof'> {
  clientId: string;
  year: number | null;
  number: number | null;
  recordedById: string;
  voided: { at: string; byId: string; reason: string } | null;
}

interface CampaignRecords {
  campaigns: CampaignRecord[];
  updates: CampaignUpdateRecord[];
  entries: WalletEntryRecord[];
  /** Client id → threshold; absent means the default 100 USD. */
  thresholds: Map<string, number | null>;
}

/** Dates relative to today, so the "no update for N days" and period rules hold on any run. */
export function campaignsSeed(): CampaignRecords {
  const today = businessDate();
  const daysAgo = (days: number) => addDays(today, -days);
  const at = (day: string) => `${day}T09:00:00.000Z`;
  const entry = (
    n: number,
    clientId: string,
    kind: AdWalletEntryKind,
    occurredOn: string,
    amount: { amountMinor: number; currency: Currency; usdMinor: number },
    number: number | null,
  ): WalletEntryRecord => ({
    id: id(n),
    clientId,
    kind,
    occurredOn,
    ...amount,
    sypPerUsd: '118.5000',
    method: 'bank_transfer',
    reference: kind === 'deposit' ? 'بنك البركة 7710' : null,
    note: null,
    receiptPdf: kind === 'deposit' ? { state: 'ready' } : null,
    year: number === null ? null : Number(occurredOn.slice(0, 4)),
    number,
    recordedById: id(1),
    createdAt: at(occurredOn),
    voided: null,
  });
  const update = (
    n: number,
    campaignId: string,
    day: string,
    metrics: Pick<CampaignUpdateRecord, 'spendMinor' | 'reach' | 'clicks' | 'results'>,
  ): CampaignUpdateRecord => ({
    id: id(n),
    campaignId,
    periodStart: day,
    periodEnd: day,
    ...metrics,
    note: '',
    enteredById: id(3),
    createdAt: at(day),
    updatedAt: at(day),
    archived: false,
  });
  const campaign = (
    n: number,
    fields: Pick<
      CampaignRecord,
      | 'clientId'
      | 'name'
      | 'platform'
      | 'objective'
      | 'funding'
      | 'budgetMinor'
      | 'startsOn'
      | 'ownerId'
      | 'status'
    > &
      Partial<CampaignRecord>,
  ): CampaignRecord => ({
    id: id(n),
    endsOn: null,
    projectId: null,
    retainerId: null,
    taskId: null,
    notes: '',
    cancelReason: null,
    createdById: id(3),
    createdAt: at(fields.startsOn),
    updatedAt: at(fields.startsOn),
    archivedAt: null,
    ...fields,
  });
  return {
    campaigns: [
      campaign(9601, {
        clientId: id(601),
        name: 'حملة رسائل الخريف',
        platform: 'meta',
        objective: 'messages',
        funding: 'wallet',
        budgetMinor: 60_000,
        startsOn: daysAgo(20),
        endsOn: addDays(today, 40),
        ownerId: id(3),
        status: 'active',
        retainerId: id(901),
        notes: 'استهداف دمشق، الفئة 25–45.',
      }),
      campaign(9602, {
        clientId: id(601),
        name: 'زيارات قائمة الطعام',
        platform: 'google',
        objective: 'traffic',
        funding: 'client_direct',
        budgetMinor: 30_000,
        startsOn: addDays(today, 5),
        ownerId: id(3),
        status: 'planned',
      }),
      campaign(9603, {
        clientId: id(602),
        name: 'التعريف بالعيادة',
        platform: 'tiktok',
        objective: 'awareness',
        funding: 'wallet',
        budgetMinor: 20_000,
        startsOn: daysAgo(30),
        endsOn: daysAgo(2),
        ownerId: id(1),
        status: 'active',
      }),
    ],
    updates: [
      update(9611, id(9601), daysAgo(9), {
        spendMinor: 20_000,
        reach: 15_000,
        clicks: 900,
        results: 45,
      }),
      update(9612, id(9603), daysAgo(12), {
        spendMinor: 12_000,
        reach: 40_000,
        clicks: 1_200,
        results: 40_000,
      }),
    ],
    entries: [
      entry(
        9621,
        id(601),
        'deposit',
        daysAgo(25),
        { amountMinor: 50_000, currency: 'USD', usdMinor: 50_000 },
        1,
      ),
      entry(
        9622,
        id(601),
        'deposit',
        daysAgo(15),
        { amountMinor: 3_555_000, currency: 'SYP', usdMinor: 30_000 },
        2,
      ),
      entry(
        9623,
        id(602),
        'deposit',
        daysAgo(31),
        { amountMinor: 15_000, currency: 'USD', usdMinor: 15_000 },
        3,
      ),
    ],
    thresholds: new Map(),
  };
}

interface CampaignState {
  records: CampaignRecords;
  clients: ClientRecord[];
  users: UserResponse[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  me: () => MeResponse;
}

/** The campaigns and wallets API over the in-memory records, with the F12 rules the screens use. */
function campaignRoutes({
  records,
  clients,
  users,
  projects,
  retainers,
  tasks,
  me,
}: CampaignState) {
  const { campaigns, updates, entries, thresholds } = records;
  let nextId = 9700;
  let clock = Date.parse('2026-10-02T09:00:00.000Z');
  const now = () => {
    clock += 60_000;
    return new Date(clock).toISOString();
  };
  const today = () => businessDate();
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const covers = (permission: Permission, clientId: string) => {
    const granted = scopes(permission);
    const client = clients.find((c) => c.id === clientId);
    return (
      granted.includes('all') ||
      (granted.includes('own_clients') && client?.accountManagerId === me().user.id)
    );
  };
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const clientName = (clientId: string) => clients.find((c) => c.id === clientId)?.tradeName ?? '';

  const metrics = (
    rows: Pick<CampaignUpdateRecord, 'spendMinor' | 'reach' | 'clicks' | 'results'>[],
  ) => {
    const sum = (key: 'spendMinor' | 'reach' | 'clicks' | 'results') =>
      rows.reduce((total, row) => total + row[key], 0);
    const spendMinor = sum('spendMinor');
    const results = sum('results');
    return {
      spendMinor,
      reach: sum('reach'),
      clicks: sum('clicks'),
      results,
      costPerResultMinor: costPerResult(spendMinor, results),
    };
  };
  const liveUpdates = (campaignId: string) =>
    updates
      .filter((u) => u.campaignId === campaignId && !u.archived)
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));

  const balanceOf = (clientId: string) =>
    adWalletBalance(
      entries
        .filter((e) => e.clientId === clientId)
        .map((e) => ({ kind: e.kind, usdMinor: e.usdMinor, voided: e.voided !== null })),
      updates.flatMap((u) => {
        const c = campaigns.find((x) => x.id === u.campaignId);
        return c?.clientId === clientId
          ? [
              {
                spendMinor: u.spendMinor,
                archived: u.archived,
                funding: c.funding,
                campaignArchived: c.archivedAt !== null,
              },
            ]
          : [];
      }),
    );

  const listItemOf = (c: CampaignRecord): Campaign => {
    const rows = liveUpdates(c.id);
    const totals = metrics(rows);
    const lastUpdateEnd = rows.reduce<string | null>(
      (last, row) => (last === null || row.periodEnd > last ? row.periodEnd : last),
      null,
    );
    const owner = users.find((u) => u.id === c.ownerId);
    return {
      id: c.id,
      name: c.name,
      client: { id: c.clientId, name: clientName(c.clientId) },
      platform: c.platform,
      objective: c.objective,
      funding: c.funding,
      status: c.status,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      owner: { id: c.ownerId, name: owner?.name ?? '', archived: owner?.status === 'archived' },
      budgetMinor: c.budgetMinor,
      spendMinor: totals.spendMinor,
      budgetUsed: budgetUsed(totals.spendMinor, c.budgetMinor),
      results: totals.results,
      costPerResultMinor: totals.costPerResultMinor,
      lastUpdateEnd,
      daysWithoutUpdate: daysWithoutUpdate({
        status: c.status,
        startsOn: c.startsOn,
        lastUpdateEnd,
        today: today(),
      }),
      endPassed: c.status === 'active' && c.endsOn !== null && c.endsOn < today(),
      updatedAt: c.updatedAt,
      archivedAt: c.archivedAt,
    };
  };

  const detailOf = (c: CampaignRecord): CampaignDetail => {
    const rows = liveUpdates(c.id);
    const totals = metrics(rows);
    const manages = covers('campaigns.manage', c.clientId);
    const archived = c.archivedAt !== null;
    const months = [...new Set(rows.map((row) => row.periodStart.slice(0, 7)))].sort();
    const project = projects.find((p) => p.id === c.projectId);
    const retainer = retainers.find((r) => r.id === c.retainerId);
    const task = tasks.find((t) => t.id === c.taskId);
    return {
      ...listItemOf(c),
      engagement: project
        ? { type: 'project', id: project.id, name: project.name, archived: project.archived }
        : retainer
          ? { type: 'retainer', id: retainer.id, name: retainer.name, archived: retainer.archived }
          : null,
      task: task
        ? { id: task.id, name: task.title, archived: task.archived, status: task.status }
        : null,
      notes: c.notes,
      cancelReason: c.cancelReason,
      totals: { ...totals, budgetUsed: budgetUsed(totals.spendMinor, c.budgetMinor) },
      months: months.map((month) => ({
        month,
        ...metrics(rows.filter((row) => row.periodStart.startsWith(month))),
      })),
      updates: rows.map((row) => ({
        id: row.id,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        note: row.note,
        enteredBy: person(row.enteredById),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...metrics([row]),
      })),
      walletBalanceMinor: c.funding === 'wallet' ? balanceOf(c.clientId) : null,
      createdBy: person(c.createdById),
      createdAt: c.createdAt,
      permissions: {
        canEdit: manages && !archived && c.status !== 'cancelled',
        canChangeFunding: manages && !archived && rows.length === 0,
        transitions:
          manages && !archived
            ? AD_CAMPAIGN_STATUSES.filter((to) => canChangeCampaignStatus(c.status, to))
            : [],
        canAddUpdate: manages && !archived && acceptsUpdates(c.status),
        canEditUpdates: manages && !archived,
        canArchive:
          manages &&
          !archived &&
          (c.status === 'planned' || c.status === 'cancelled') &&
          rows.length === 0,
        canRestore: manages && archived,
      },
    };
  };

  const usesWallet = (clientId: string) =>
    entries.some((e) => e.clientId === clientId && e.kind === 'deposit' && e.voided === null);
  const thresholdOf = (clientId: string) =>
    thresholds.has(clientId)
      ? (thresholds.get(clientId) ?? null)
      : CAMPAIGN_LIMITS.lowBalanceThresholdMinor;
  const totalsOf = (clientId: string) => {
    const counted = entries.filter((e) => e.clientId === clientId && e.voided === null);
    const sum = (kind: AdWalletEntryKind) =>
      counted.filter((e) => e.kind === kind).reduce((total, e) => total + e.usdMinor, 0);
    const balanceMinor = balanceOf(clientId);
    const lowBalanceThresholdMinor = thresholdOf(clientId);
    return {
      depositedMinor: sum('deposit'),
      refundedMinor: sum('refund'),
      spentMinor: sum('deposit') - sum('refund') - balanceMinor,
      balanceMinor,
      lowBalanceThresholdMinor,
      low: isLowBalance(balanceMinor, lowBalanceThresholdMinor, usesWallet(clientId)),
    };
  };
  const entryOf = (e: WalletEntryRecord): WalletEntry => ({
    id: e.id,
    kind: e.kind,
    receiptNumber:
      e.year !== null && e.number !== null
        ? adDepositDisplayNumber({ year: e.year, number: e.number })
        : null,
    occurredOn: e.occurredOn,
    amountMinor: e.amountMinor,
    currency: e.currency,
    sypPerUsd: e.sypPerUsd,
    usdMinor: e.usdMinor,
    method: e.method,
    reference: e.reference,
    note: e.note,
    proof: null,
    receiptPdf: e.receiptPdf,
    recordedBy: person(e.recordedById),
    createdAt: e.createdAt,
    voided: e.voided
      ? { at: e.voided.at, by: person(e.voided.byId), reason: e.voided.reason }
      : null,
  });
  const walletOf = (clientId: string): AdWallet => {
    const client = clients.find((c) => c.id === clientId);
    const own = entries.filter((e) => e.clientId === clientId);
    const spend = updates.flatMap((u) => {
      const c = campaigns.find((x) => x.id === u.campaignId);
      return c &&
        c.clientId === clientId &&
        spendCountsInWallet({
          spendMinor: u.spendMinor,
          archived: u.archived,
          funding: c.funding,
          campaignArchived: c.archivedAt !== null,
        })
        ? [{ update: u, campaign: c }]
        : [];
    });
    const ledger = walletLedger([
      ...own.map((e) => ({
        kind: e.kind,
        id: e.id,
        date: e.occurredOn,
        usdMinor: e.usdMinor,
        voided: e.voided !== null,
        entry: {
          receiptNumber: entryOf(e).receiptNumber,
          amountMinor: e.amountMinor,
          currency: e.currency,
        },
        spend: null,
      })),
      ...spend.map(({ update: u, campaign: c }) => ({
        kind: 'spend' as const,
        id: u.id,
        date: u.periodEnd,
        usdMinor: u.spendMinor,
        voided: false,
        entry: null,
        spend: {
          campaign: { id: c.id, name: c.name },
          periodStart: u.periodStart,
          periodEnd: u.periodEnd,
        },
      })),
    ]);
    const canFund = scopes('campaigns.fund').length > 0;
    return {
      ...totalsOf(clientId),
      client: { id: clientId, name: client?.tradeName ?? '', archived: client?.archived ?? false },
      usesWallet: usesWallet(clientId),
      from: null,
      to: null,
      openingMinor: ledger.openingMinor,
      ledger: ledger.rows,
      entries: own.sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1)).map(entryOf),
      permissions: {
        canFund,
        canDeposit: canFund && !client?.archived,
        canEditThreshold: covers('campaigns.manage', clientId),
      },
    };
  };

  const checkLinks = (clientId: string, body: Partial<CreateCampaign>) => {
    if (body.ownerId && users.find((u) => u.id === body.ownerId)?.status !== 'active') {
      return 'INVALID_OWNER' as const;
    }
    if (body.endsOn && body.startsOn && body.endsOn < body.startsOn)
      return 'INVALID_DATES' as const;
    const project = body.projectId && projects.find((p) => p.id === body.projectId);
    const retainer = body.retainerId && retainers.find((r) => r.id === body.retainerId);
    const task = body.taskId && tasks.find((t) => t.id === body.taskId);
    if (
      (body.projectId && (!project || project.clientId !== clientId)) ||
      (body.retainerId && (!retainer || retainer.clientId !== clientId)) ||
      (body.taskId && (!task || task.clientId !== clientId))
    ) {
      return 'INVALID_ENGAGEMENT' as const;
    }
    return null;
  };

  return (route: Route, method: string, url: URL, request: Request) => {
    const path = url.pathname;
    const readable = (clientId: string) => covers('campaigns.read', clientId);

    if (path === '/api/campaigns' && method === 'GET') {
      if (scopes('campaigns.read').length === 0) return fail(route, 403, null);
      const q = url.searchParams;
      const statuses = q.getAll('status');
      const shown = statuses.length > 0 ? statuses : [...OPEN_AD_CAMPAIGN_STATUSES];
      const search = q.get('search')?.toLowerCase();
      const items = campaigns
        .filter(
          (c) =>
            !c.archivedAt &&
            readable(c.clientId) &&
            shown.includes(c.status) &&
            (!q.get('clientId') || c.clientId === q.get('clientId')) &&
            (!q.get('platform') || c.platform === q.get('platform')) &&
            (!q.get('funding') || c.funding === q.get('funding')) &&
            (!q.get('ownerId') || c.ownerId === q.get('ownerId')) &&
            (q.get('mine') !== 'true' || c.ownerId === me().user.id) &&
            (!q.get('accountManagerId') ||
              clients.find((x) => x.id === c.clientId)?.accountManagerId ===
                q.get('accountManagerId')) &&
            (!search ||
              c.name.toLowerCase().includes(search) ||
              clientName(c.clientId).toLowerCase().includes(search)),
        )
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .map(listItemOf);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/campaigns' && method === 'POST') {
      const body = request.postDataJSON() as CreateCampaign;
      if (!covers('campaigns.manage', body.clientId)) return fail(route, 403, null);
      const problem = checkLinks(body.clientId, body);
      if (problem) return fail(route, 400, problem);
      const created: CampaignRecord = {
        ...body,
        id: id(nextId++),
        status: 'planned',
        cancelReason: null,
        createdById: me().user.id,
        createdAt: now(),
        updatedAt: now(),
        archivedAt: null,
      };
      campaigns.push(created);
      return json(route, detailOf(created), 201);
    }

    const campaignMatch = path.match(
      /^\/api\/campaigns\/([^/]+)(?:\/(status|archive|restore|updates))?$/,
    );
    if (campaignMatch) {
      const c = campaigns.find((x) => x.id === campaignMatch[1]);
      if (!c || !readable(c.clientId)) return fail(route, 404, null);
      const action = campaignMatch[2];
      if (!action && method === 'GET') return json(route, detailOf(c));
      if (!covers('campaigns.manage', c.clientId)) return fail(route, 403, null);
      if (!action && method === 'PUT') {
        const body = request.postDataJSON() as UpdateCampaign;
        if (body.updatedAt !== c.updatedAt) return fail(route, 409, 'CONCURRENT_CHANGE');
        if (c.status === 'cancelled') return fail(route, 409, 'INVALID_TRANSITION');
        if (body.funding !== c.funding && liveUpdates(c.id).length > 0) {
          return fail(route, 409, 'FUNDING_LOCKED');
        }
        const problem = checkLinks(c.clientId, body);
        if (problem) return fail(route, 400, problem);
        const { updatedAt: _loaded, ...fields } = body;
        Object.assign(c, fields, { updatedAt: now() });
        return json(route, detailOf(c));
      }
      if (action === 'status') {
        const body = request.postDataJSON() as CampaignStatusChange;
        if (!canChangeCampaignStatus(c.status, body.to)) {
          return fail(route, 409, 'INVALID_TRANSITION');
        }
        if (body.to === 'cancelled' && !body.reason) return fail(route, 400, 'NOTE_REQUIRED');
        c.status = body.to;
        c.cancelReason = body.to === 'cancelled' ? (body.reason ?? null) : null;
        c.updatedAt = now();
        return json(route, detailOf(c));
      }
      if (action === 'archive') {
        if (liveUpdates(c.id).length > 0) return fail(route, 409, 'CAMPAIGN_HAS_UPDATES');
        c.archivedAt = now();
        return json(route, detailOf(c));
      }
      if (action === 'restore') {
        c.archivedAt = null;
        return json(route, detailOf(c));
      }
      if (action === 'updates' && method === 'POST') {
        if (!acceptsUpdates(c.status)) return fail(route, 409, 'INVALID_TRANSITION');
        const body = request.postDataJSON() as CampaignUpdateInput;
        if (!periodInOneMonth(body)) return fail(route, 400, 'PERIOD_CROSSES_MONTH');
        if (liveUpdates(c.id).some((u) => periodsOverlap(u, body))) {
          return fail(route, 409, 'PERIOD_OVERLAP');
        }
        updates.push({
          ...body,
          id: id(nextId++),
          campaignId: c.id,
          enteredById: me().user.id,
          createdAt: now(),
          updatedAt: now(),
          archived: false,
        });
        c.updatedAt = now();
        return json(route, detailOf(c), 201);
      }
    }

    const updateMatch = path.match(/^\/api\/campaign-updates\/([^/]+)(\/archive)?$/);
    if (updateMatch) {
      const u = updates.find((x) => x.id === updateMatch[1] && !x.archived);
      const c = u && campaigns.find((x) => x.id === u.campaignId);
      if (!u || !c || !readable(c.clientId)) return fail(route, 404, null);
      if (!covers('campaigns.manage', c.clientId)) return fail(route, 403, null);
      if (updateMatch[2]) {
        u.archived = true;
      } else {
        const body = request.postDataJSON() as PatchCampaignUpdate;
        const next = { ...u, ...body };
        if (!periodInOneMonth(next)) return fail(route, 400, 'PERIOD_CROSSES_MONTH');
        if (liveUpdates(c.id).some((x) => x.id !== u.id && periodsOverlap(x, next))) {
          return fail(route, 409, 'PERIOD_OVERLAP');
        }
        Object.assign(u, body, { updatedAt: now() });
      }
      c.updatedAt = now();
      return json(route, detailOf(c));
    }

    if (path === '/api/ad-wallets' && method === 'GET') {
      if (scopes('campaigns.read').length === 0) return fail(route, 403, null);
      const q = url.searchParams;
      const search = q.get('search')?.toLowerCase();
      const items = clients
        .filter(
          (client) =>
            readable(client.id) &&
            (usesWallet(client.id) ||
              campaigns.some(
                (c) => c.clientId === client.id && c.funding === 'wallet' && !c.archivedAt,
              )) &&
            (!search || client.tradeName.toLowerCase().includes(search)) &&
            (!q.get('accountManagerId') || client.accountManagerId === q.get('accountManagerId')),
        )
        .map((client) => ({
          ...totalsOf(client.id),
          client: { id: client.id, name: client.tradeName },
          accountManager: person(client.accountManagerId),
          lastDepositOn:
            entries
              .filter((e) => e.clientId === client.id && e.kind === 'deposit' && !e.voided)
              .map((e) => e.occurredOn)
              .sort()
              .at(-1) ?? null,
        }))
        .filter((wallet) => q.get('low') !== 'true' || wallet.low)
        .sort((a, b) => a.balanceMinor - b.balanceMinor);
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }

    const walletMatch = path.match(/^\/api\/clients\/([^/]+)\/ad-wallet(\/entries)?$/);
    if (walletMatch) {
      const clientId = walletMatch[1] ?? '';
      if (!clients.some((c) => c.id === clientId) || !readable(clientId)) {
        return fail(route, 404, null);
      }
      if (!walletMatch[2] && method === 'GET') return json(route, walletOf(clientId));
      if (!walletMatch[2] && method === 'PATCH') {
        if (!covers('campaigns.manage', clientId)) return fail(route, 403, null);
        const body = request.postDataJSON() as UpdateWalletThreshold;
        thresholds.set(clientId, body.lowBalanceThresholdMinor);
        return json(route, walletOf(clientId));
      }
      if (walletMatch[2] && method === 'POST') {
        if (scopes('campaigns.fund').length === 0) return fail(route, 403, null);
        const body = request.postDataJSON() as RecordWalletEntry;
        const rate = body.sypPerUsd ?? '118.5000';
        const usdMinor = toUsdMinor(body.amountMinor, body.currency, rate);
        if (body.kind === 'refund' && usdMinor > balanceOf(clientId)) {
          return fail(route, 409, 'REFUND_EXCEEDS_BALANCE');
        }
        const year = Number(today().slice(0, 4));
        const numbered = entries.filter((e) => e.year === year).length;
        entries.push({
          id: id(nextId++),
          clientId,
          kind: body.kind,
          occurredOn: body.occurredOn,
          amountMinor: body.amountMinor,
          currency: body.currency,
          sypPerUsd: rate,
          usdMinor,
          method: body.method,
          reference: body.reference,
          note: body.note,
          receiptPdf: body.kind === 'deposit' ? { state: 'ready' } : null,
          year: body.kind === 'deposit' ? year : null,
          number: body.kind === 'deposit' ? numbered + 1 : null,
          recordedById: me().user.id,
          createdAt: now(),
          voided: null,
        });
        return json(route, walletOf(clientId), 201);
      }
    }

    const entryMatch = path.match(/^\/api\/ad-wallet-entries\/([^/]+)\/(void|receipt)$/);
    if (entryMatch) {
      const e = entries.find((x) => x.id === entryMatch[1]);
      if (!e || !readable(e.clientId)) return fail(route, 404, null);
      if (entryMatch[2] === 'void') {
        if (scopes('campaigns.fund').length === 0) return fail(route, 403, null);
        if (e.voided) return fail(route, 409, 'INVALID_TRANSITION');
        const { reason } = request.postDataJSON() as VoidWalletEntry;
        e.voided = { at: now(), byId: me().user.id, reason };
        return json(route, walletOf(e.clientId));
      }
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: MOCK_PDF });
      }
      return json(route, { state: 'pending' });
    }
    return undefined;
  };
}

// Dashboards and reports (F15)

interface ReportState {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  tasks: TaskRecord[];
  tasksApi: ReturnType<typeof taskRoutes>;
  me: () => MeResponse;
}

/** Monthly report summaries saved during a test, by `<clientId>:<month>`. */
type SummaryRecords = Map<string, NonNullable<ClientMonthlyReport['summary']>>;

/**
 * The dashboard and report endpoints (spec F15). Task numbers come from the task mock, so they
 * match the task list; money and the monthly report are fixed figures over the seeded clients.
 * Each answers 403 without its permission, as the API does (rule 23).
 */
function reportRoutes({ users, clients, projects, retainers, tasks, tasksApi, me }: ReportState) {
  const summaries: SummaryRecords = new Map();
  let pdfAsked = false;
  const scopes = (permission: string) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const holds = (permission: string) => scopes(permission).length > 0;
  const named = (record: { id: string; name: string }) => ({ id: record.id, name: record.name });
  const clientNamed = (clientId: string) => ({
    id: clientId,
    name: clients.find((c) => c.id === clientId)?.tradeName ?? '',
  });
  const userNamed = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
  });
  const open = () => tasks.filter((t) => !t.archived && isTaskOpen(t.status));
  const week = weekOf(PROJECTS_TODAY);
  const workloadOf = (list: TaskRecord[]) => ({
    open: list.length,
    dueThisWeek: list.filter((t) => t.dueDate >= week.from && t.dueDate <= week.to).length,
    overdue: list.filter(tasksApi.overdue).length,
  });
  /** The departments the caller reads tasks of: all, or the ones they manage. */
  const departmentsInScope = (): DepartmentCode[] =>
    scopes('reports.read').includes('all')
      ? [...DEPARTMENT_CODES]
      : scopes('reports.read').includes('department')
        ? me()
            .departments.filter((d) => d.isManager)
            .map((d) => d.code)
        : [];
  const membersOf = (department: DepartmentCode) =>
    users.filter(
      (u) => u.status !== 'archived' && u.departments.some((d) => d.code === department),
    );
  const myClients = () => clients.filter((c) => !c.archived && c.accountManagerId === me().user.id);
  const readsClient = (clientId: string) =>
    scopes('reports.read').includes('all') ||
    (scopes('reports.read').includes('own_clients') &&
      clients.some((c) => c.id === clientId && c.accountManagerId === me().user.id));

  const company = (): CompanyDashboard => {
    const today = businessDate();
    return {
      months: reportMonths(today),
      activeEngagements: {
        projects: OPEN_STATUSES.map((status) => ({
          status,
          count: projects.filter((p) => !p.archived && p.status === status).length,
        })),
        retainers: retainers.filter((r) => !r.archived && r.status === 'active').length,
      },
      departments: DEPARTMENT_CODES.map((department) => {
        const own = open().filter((t) => t.department === department);
        return {
          department,
          ...workloadOf(own),
          unassigned: own.filter((t) => t.assigneeId === null).length,
        };
      }),
      retainersBehind: [
        {
          client: clientNamed(id(601)),
          retainer: named({ id: id(901), name: 'إدارة السوشيال ميديا' }),
          cycleId: id(921),
          linesBehind: 2,
          completion: 38,
        },
      ],
      approvalsWaiting: {
        count: 2,
        oldest: {
          itemId: id(1491),
          title: 'تصاميم منيو الخريف',
          client: clientNamed(id(601)),
          sentAt: `${addDays(today, -4)}T10:00:00.000Z`,
          expired: false,
        },
      },
      lowWallets: [{ client: clientNamed(id(602)), balanceUsdMinor: 4_500 }],
      leads: {
        thisMonth: { new: 5, won: 2, lost: 1, conversionRate: conversionRate(2, 1) },
        lastMonth: { new: 7, won: 1, lost: 3, conversionRate: conversionRate(1, 3) },
      },
    };
  };

  const finance = (): FinanceDashboard => ({
    months: reportMonths(businessDate()),
    invoicedUsdMinor: { thisMonth: 300_000, lastMonth: 245_000 },
    collectedUsdMinor: { thisMonth: 62_195, lastMonth: 180_000 },
    outstanding: {
      byCurrency: [{ currency: 'USD', amountMinor: 190_000 }],
      usdMinor: 190_000,
    },
    overdue: { count: 1, byCurrency: [{ currency: 'USD', amountMinor: 40_000 }], usdMinor: 40_000 },
  });

  const departmentDashboard = (department: DepartmentCode, inScope: DepartmentCode[]) => {
    const own = open().filter((t) => t.department === department);
    const late = own.filter(tasksApi.overdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const body: DepartmentDashboard = {
      departments: inScope,
      department,
      week,
      byStatus: OPEN_TASK_STATUSES.map((status) => ({
        status,
        count: own.filter((t) => t.status === status).length,
      })),
      overdue: {
        count: late.length,
        oldest: late.slice(0, DASHBOARD_LIMITS.overdueTasks).map(tasksApi.summary),
      },
      unassigned: own.filter((t) => t.assigneeId === null).length,
      people: membersOf(department).map((u) => ({
        user: named(u),
        ...workloadOf(open().filter((t) => t.assigneeId === u.id)),
      })),
    };
    return body;
  };

  const myClientsDashboard = (): MyClientsDashboard => {
    const money = holds('invoices.read');
    const ads = holds('campaigns.read');
    const rows = myClients().map((c) => {
      const active = retainers.filter(
        (r) => !r.archived && r.clientId === c.id && r.status === 'active',
      );
      const behind = active.some((r) => r.id === id(901));
      const jasmine = c.id === id(601);
      const lowWallet = ads ? c.id === id(602) : null;
      const invoices = money
        ? { outstandingUsdMinor: jasmine ? 190_000 : 0, overdue: jasmine ? 1 : 0 }
        : null;
      const approvals = jasmine
        ? {
            pending: 2,
            oldestSentAt: `${addDays(businessDate(), -4)}T10:00:00.000Z`,
            waiting: true,
          }
        : { pending: 0, oldestSentAt: null, waiting: false };
      return {
        client: clientNamed(c.id),
        retainers: active.map((r) => ({
          retainer: named(r),
          completion: r.id === id(901) ? 38 : 75,
          behind: r.id === id(901),
        })),
        openProjects: projects.filter(
          (p) => !p.archived && p.clientId === c.id && OPEN_STATUSES.includes(p.status),
        ).length,
        approvals,
        invoices,
        lowWallet,
        hasProblem: behind || (invoices?.overdue ?? 0) > 0 || !!lowWallet || approvals.waiting,
      };
    });
    rows.sort(
      (a, b) =>
        Number(b.hasProblem) - Number(a.hasProblem) || a.client.name.localeCompare(b.client.name),
    );
    return { clients: rows };
  };

  const measures = (list: TaskRecord[], delivered: number): ProductivityMeasures => ({
    new: list.length + delivered,
    delivered,
    onTimeRate: delivered === 0 ? null : onTimeRate(delivered - 1, delivered),
    averageClientRevisions: delivered === 0 ? null : 1.5,
    averageInternalRevisions: delivered === 0 ? null : 0.5,
    averageCycleDays: delivered === 0 ? null : 4.2,
    openNow: list.length,
    overdueNow: list.filter(tasksApi.overdue).length,
  });

  const productivity = (url: URL): ProductivityReport => {
    const asked = url.searchParams.getAll('department') as DepartmentCode[];
    const inScope = departmentsInScope().filter(
      (code) => asked.length === 0 || asked.includes(code),
    );
    const { thisMonth } = reportMonths(businessDate());
    return {
      period: {
        from: url.searchParams.get('from') ?? thisMonth.from,
        to: url.searchParams.get('to') ?? thisMonth.to,
      },
      departments: inScope.map((department) => {
        const own = open().filter((t) => t.department === department);
        const unassigned = own.filter((t) => t.assigneeId === null);
        const people = membersOf(department).map((u, index) => ({
          user: { ...named(u), archived: false },
          measures: measures(
            own.filter((t) => t.assigneeId === u.id),
            index === 0 ? 3 : 1,
          ),
        }));
        return {
          department,
          name: departmentsSeed.find((d) => d.code === department)?.name ?? department,
          measures: measures(own, people.length + 2),
          unassigned: {
            count: unassigned.length,
            oldestOn: unassigned.length > 0 ? '2026-10-05' : null,
          },
          people,
        };
      }),
    };
  };

  const revenue = (url: URL): RevenueReport => {
    const { thisMonth } = reportMonths(businessDate());
    const today = businessDate();
    return {
      period: {
        from: url.searchParams.get('from') ?? thisMonth.from,
        to: url.searchParams.get('to') ?? thisMonth.to,
      },
      invoicedUsdMinor: 300_000,
      collectedUsdMinor: 62_195,
      byClient: [
        {
          client: clientNamed(id(602)),
          accountManager: userNamed(id(1)),
          invoicedUsdMinor: 0,
          collectedUsdMinor: 42_195,
          outstandingUsdMinor: 0,
        },
        {
          client: clientNamed(id(601)),
          accountManager: userNamed(id(3)),
          invoicedUsdMinor: 300_000,
          collectedUsdMinor: 20_000,
          outstandingUsdMinor: 190_000,
        },
      ],
      byService: [
        {
          kind: 'service',
          id: id(9001),
          name: 'تصميم سوشال ميديا',
          archived: false,
          invoicedUsdMinor: 150_000,
          collectedUsdMinor: 20_000,
        },
        {
          kind: 'package',
          id: id(9051),
          name: 'باقة السوشال الذهبية',
          archived: false,
          invoicedUsdMinor: 90_000,
          collectedUsdMinor: 0,
        },
        {
          kind: 'unclassified',
          id: null,
          name: null,
          archived: false,
          invoicedUsdMinor: 60_000,
          collectedUsdMinor: 42_195,
        },
      ],
      invoices: [
        {
          id: id(9403),
          number: invoiceDisplayNumber({ year: 2026, number: 1 }),
          client: clientNamed(id(601)),
          issuedOn: addDays(today, -25),
          currency: 'USD',
          totalMinor: 60_000,
          sypPerUsd: null,
          totalUsdMinor: 60_000,
          collectedUsdMinor: 20_000,
        },
      ],
    };
  };

  const overdueInvoices = (url: URL): OverdueInvoicesReport => {
    const today = businessDate();
    const dueOn = addDays(today, -18);
    const days = daysOverdue(dueOn, today);
    const rows = [
      {
        id: id(9403),
        number: invoiceDisplayNumber({ year: 2026, number: 1 }),
        client: clientNamed(id(601)),
        accountManager: userNamed(id(3)),
        currency: 'USD' as const,
        totalMinor: 60_000,
        paidMinor: 20_000,
        balanceMinor: 40_000,
        balanceUsdMinor: 40_000,
        dueOn,
        daysOverdue: days,
        bucket: agingBucket(days),
      },
    ].filter(
      (row) =>
        (!url.searchParams.get('accountManagerId') ||
          row.accountManager.id === url.searchParams.get('accountManagerId')) &&
        (!url.searchParams.get('currency') || row.currency === url.searchParams.get('currency')),
    );
    const usd = rows.reduce((sum, row) => sum + row.balanceUsdMinor, 0);
    return {
      today,
      invoices: rows,
      totals: {
        count: rows.length,
        byCurrency: rows.length > 0 ? [{ currency: 'USD', amountMinor: usd }] : [],
        usdMinor: usd,
      },
    };
  };

  /** Jasmine's month: every section; other clients had no activity (edge case 12). */
  const clientReport = (clientId: string, month: string): ClientMonthlyReport => {
    const period = monthPeriod(month);
    const summary = summaries.get(`${clientId}:${month}`) ?? null;
    const base: ClientMonthlyReport = {
      client: clientNamed(clientId),
      month,
      period,
      preliminary: isPreliminaryMonth(month, businessDate()),
      summary: summary?.text ? summary : null,
      retainers: [],
      projects: [],
      deliveredWork: [],
      posts: [],
      shoots: [],
      approvals: { approved: 0, changesRequested: 0, averageResponseHours: null },
      campaigns: null,
      adBudget: null,
      nextMonth: { posts: [], shoots: [] },
      empty: true,
    };
    if (clientId !== id(601)) return base;
    const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
    const ads = holds('campaigns.read');
    return {
      ...base,
      retainers: [
        {
          retainer: named({ id: id(901), name: 'إدارة السوشيال ميديا' }),
          status: base.preliminary ? 'open' : 'closed',
          lines: [
            { kind: 'design', label: null, committed: 12, delivered: 9, percent: 75 },
            { kind: 'reel', label: null, committed: 4, delivered: 4, percent: 100 },
            { kind: 'story', label: null, committed: 8, delivered: 5, percent: 62 },
          ],
          completion: 75,
        },
      ],
      projects: [
        {
          project: named({ id: id(801), name: 'الهوية البصرية الجديدة' }),
          status: 'active',
          deliveredTasks: 4,
          totalTasks: 9,
          milestonesDone: [{ name: 'الاستكشاف', doneOn: day(12) }],
        },
      ],
      deliveredWork: [
        {
          taskId: id(1001),
          title: 'تصاميم منيو الخريف',
          department: 'design',
          departmentName: 'التصميم',
          deliveredOn: day(8),
        },
        {
          taskId: id(1002),
          title: 'تصوير أطباق المنيو',
          department: 'photography',
          departmentName: 'التصوير',
          deliveredOn: day(15),
        },
      ],
      posts: [
        {
          id: id(1601),
          publishedOn: day(3),
          platforms: ['instagram', 'facebook'],
          title: 'منشور افتتاح الفرع الجديد',
          links: [{ platform: 'instagram', url: 'https://instagram.com/p/opening' }],
        },
      ],
      shoots: [{ id: id(1751), date: day(14), title: 'تصوير منيو الخريف', location: 'فرع المزة' }],
      approvals: { approved: 6, changesRequested: 2, averageResponseHours: 30.5 },
      campaigns: ads
        ? {
            rows: [
              {
                id: id(9601),
                platform: 'meta',
                name: 'حملة منيو الخريف',
                objective: 'messages',
                spendMinor: 35_000,
                reach: 48_200,
                clicks: 1_310,
                results: 140,
                costPerResultMinor: 250,
              },
            ],
            totals: {
              spendMinor: 35_000,
              reach: 48_200,
              clicks: 1_310,
              results: 140,
              costPerResultMinor: 250,
            },
          }
        : null,
      adBudget: ads
        ? {
            openingMinor: 20_000,
            depositsMinor: 50_000,
            refundsMinor: 0,
            spendMinor: 35_000,
            closingMinor: 35_000,
          }
        : null,
      nextMonth: {
        posts: [{ date: addDays(period.to, 3), title: 'عرض نهاية الأسبوع' }],
        shoots: [{ date: addDays(period.to, 6), title: 'تصوير مشروبات الشتاء' }],
      },
      empty: false,
    };
  };

  return (route: Route, method: string, url: URL, request: Request) => {
    const path = url.pathname;
    if (path === '/api/dashboard/company') {
      return scopes('reports.read').includes('all')
        ? json(route, company())
        : fail(route, 403, null);
    }
    if (path === '/api/dashboard/finance') {
      return holds('reports.finance') ? json(route, finance()) : fail(route, 403, null);
    }
    if (path === '/api/dashboard/departments') {
      const inScope = departmentsInScope();
      const asked = (url.searchParams.get('department') as DepartmentCode | null) ?? inScope[0];
      if (!asked || !inScope.includes(asked)) return fail(route, 403, null);
      return json(route, departmentDashboard(asked, inScope));
    }
    if (path === '/api/dashboard/clients') {
      return scopes('reports.read').includes('own_clients')
        ? json(route, myClientsDashboard())
        : fail(route, 403, null);
    }
    const workbook = () =>
      route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        body: 'PK',
      });
    const report = path.match(
      /^\/api\/reports\/(productivity|revenue|overdue-invoices)(\/export)?$/,
    );
    if (report) {
      const allowed =
        report[1] === 'productivity' ? departmentsInScope().length > 0 : holds('reports.finance');
      if (!allowed) return fail(route, 403, null);
      if (report[2]) return workbook();
      if (report[1] === 'productivity') return json(route, productivity(url));
      if (report[1] === 'revenue') return json(route, revenue(url));
      return json(route, overdueInvoices(url));
    }
    const monthly = path.match(/^\/api\/clients\/([^/]+)\/monthly-report(?:\/(.+))?$/);
    if (monthly) {
      const [, clientId = '', action] = monthly;
      if (!readsClient(clientId)) return fail(route, 404, null);
      const month =
        action === 'summary'
          ? (request.postDataJSON() as { month: string }).month
          : (url.searchParams.get('month') ?? '');
      if (isFutureMonth(month, businessDate())) return fail(route, 400, 'INVALID_MONTH');
      if (!action) return json(route, clientReport(clientId, month));
      if (action === 'export') return workbook();
      if (action === 'summary' && method === 'PUT') {
        const input = updateClientReportSummarySchema.parse(request.postDataJSON());
        summaries.set(`${clientId}:${month}`, {
          text: input.summary,
          updatedBy: userNamed(me().user.id),
          updatedAt: new Date().toISOString(),
        });
        return json(route, clientReport(clientId, month));
      }
      if (action === 'pdf' && method === 'POST') {
        pdfAsked = true;
        return json(route, { state: 'ready' });
      }
      if (action === 'pdf') {
        if (!pdfAsked) return fail(route, 404, null);
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: MOCK_PDF });
      }
    }
    return undefined;
  };
}
export const seedIds = {
  sara: id(1),
  omar: id(2),
  layan: id(3),
  design: design.id,
  karim: id(4),
  basel: id(6),
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
  clinicLogo: id(1006),
  dentalPost: id(1008),
  whiteningArticle: id(1009),
  // With `MockOptions.approvals`.
  autumnReel: id(1010),
  drinksPost: id(1011),
  siteBanner: id(1013),
  openingStory: id(1014),
  openRequest: id(1481),
  expiredRequest: id(1482),
  octoberCover: id(1007),
  // With `MockOptions.content`.
  openingPost: id(1601),
  kitchenReel: id(1602),
  autumnCarousel: id(1603),
  coffeeDay: id(1605),
  followersContest: id(1606),
  hotDrinksPost: id(1607),
  weekendOffer: id(1608),
  dentalTips: id(1611),
  sweetsCarousel: id(1613),
  coffeeReel: id(1614),
  contentRequest: id(1681),
  openingDesign: id(1621),
  drinksDesign: id(1622),
  // With `MockOptions.calendar`.
  contentMeeting: id(1761),
  weeklyMeeting: id(1762),
  autumnShoot: id(1751),
  clinicShoot: id(1752),
  openingShoot: id(1753),
  coffeeShoot: id(1754),
  websiteTemplate: id(2000),
  monthlyTemplate: id(2100),
  designService: id(9001),
  brandService: id(9004),
  goldPackage: id(9051),
  // Quotes (F04).
  sentQuote: id(9201),
  pendingQuote: id(9202),
  shifaDraft: id(9203),
  expiredQuote: id(9204),
  leadQuote: id(9205),
  // Leads (F03).
  noorLead: id(9701),
  sindyanLead: id(9702),
  lamsaLead: id(9703),
  rashaqaLead: id(9704),
  wonLead: id(9705),
  lostLead: id(9706),
  archivedLead: id(9707),
  nukhba: id(603),
  // Ad campaigns (F12).
  autumnCampaign: id(9601),
  menuCampaign: id(9602),
  clinicCampaign: id(9603),
  // Invoices (F13).
  designDraft: id(9401),
  octoberDraft: id(9402),
  overdueInvoice: id(9403),
  paidInvoice: id(9404),
  voidInvoice: id(9405),
};

/** Viewport screenshot kept in the test output and attached to the HTML report. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}
