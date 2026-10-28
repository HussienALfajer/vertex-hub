import { deflateSync } from 'node:zlib';
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
  type Amendment,
  type Announcement,
  type AnnouncementBody,
  type AnnouncementHome,
  type AnnouncementPage,
  type AnnouncementPoll,
  type AnnouncementReceipts,
  type AnnouncementStatus,
  type AnnouncementSummary,
  type AnnouncementTemplate,
  type AnnouncementTemplateList,
  type AnnouncementTotals,
  APPROVAL_LIMITS,
  type ApprovalItem,
  type ApprovalItemStatus,
  type ApprovalReady,
  type ApprovalRequest,
  type ApprovalRequestDetail,
  type ApprovalWithdrawnReason,
  type ArchiveDepartment,
  type AssigneeLeave,
  type AttendanceDay,
  type AttendanceDayList,
  type AttendanceGreeting,
  type AttendanceItem,
  type AttendanceItemDetail,
  type AttendanceItemPage,
  type AttendanceKiosk,
  type AttendanceKioskList,
  type AttendanceKioskPairing,
  type AttendanceMonth,
  type AttendancePasskey,
  type AttendancePasskeyList,
  type AttendancePunch,
  AUDIENCE_PREVIEW_MAX,
  type Audience,
  type AudiencePreview,
  type AuditEntry,
  absentContractBlocks,
  acceptQuoteSchema,
  acceptsUpdates,
  adDepositDisplayNumber,
  addDays,
  adWalletBalance,
  agingBucket,
  allowedPostTransitions,
  allowedTaskTransitions,
  announcementExcerpt,
  applyPayment,
  approvalRequestState,
  attendanceCodeWindow,
  attendanceCodeWindowEnd,
  audienceSchema,
  BALANCE_LEAVE_TYPES,
  type BalanceLeaveType,
  type BillableItems,
  BOARD_LIMITS,
  BOARD_STATUSES,
  type BrandFileKind,
  type BrandKit,
  budgetUsed,
  businessDate,
  businessInstant,
  businessTimeOfDay,
  CAMPAIGN_LIMITS,
  type Calendar,
  type CalendarIssue,
  type CalendarLeave,
  type CalendarOccasion,
  type Campaign,
  type CampaignDetail,
  type CampaignStatusChange,
  type CampaignUpdateInput,
  type CancelMeeting,
  type CancelShoot,
  type CatalogBilling,
  type CatalogPackage,
  type CatalogService,
  type ChannelMode,
  type ClientApprovals,
  type ClientBilling,
  type ClientContentSettings,
  type ClientDetailResponse,
  type ClientEmail,
  type ClientEmailKind,
  type ClientMonthlyReport,
  type ClientPlanning,
  type ClientResponse,
  type ClientResponseEntry,
  type ClientStatement,
  type ClientStatus,
  type CloseShoot,
  CONTRACT_AGENCY_FIELDS,
  CONTRACT_CLIENT_FIELDS,
  CONTRACT_REQUIRED_FIELDS,
  type CompanyDashboard,
  type Contact,
  type ContentCalendar,
  type ContentGrid,
  type ContentIdea,
  type ContentOccasion,
  type ContentPillar,
  type ContentPlanning,
  type ContentSnippet,
  type ContractAnnex,
  type ContractArticle,
  type ContractSettings,
  type ContractSnapshot,
  type ConvertLead,
  type CreateAmendmentInput,
  type CreateApprovalRequest,
  type CreateCampaign,
  type CreateContentIdea,
  type CreateContentOccasion,
  type CreateContentPillar,
  type CreateContentSnippet,
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type CreateDepartment,
  type CreateExtraWork,
  type CreateHrRequest,
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
  type CurrentCycle,
  type Cycle,
  type CycleDetail,
  type CycleReport,
  type CycleStatus,
  calendarDay,
  canChangeCampaignStatus,
  captionGroupsOf,
  changeInvoiceDueDateSchema,
  commitmentsOf,
  computeDay,
  conversionRate,
  convertLeadSchema,
  costPerResult,
  createAnnouncementSchema,
  createAnnouncementTemplateSchema,
  createAttendanceKioskSchema,
  createCatalogPackageSchema,
  createCatalogServiceSchema,
  createHolidaySchema,
  createHrOpinionSchema,
  createHrRequestSchema,
  createInvoiceSchema,
  createLeadNoteSchema,
  createLeadSchema,
  createLeaveAdjustmentSchema,
  createProjectExpenseSchema,
  createQuoteSchema,
  createSalaryChangeSchema,
  createTemplateSchema,
  createWorkScheduleSchema,
  currentCycleNumber,
  currentSalary,
  cycleAt,
  cycleDaysLeft,
  cyclePeriod,
  DASHBOARD_LIMITS,
  DEFAULT_ESTIMATE_MINUTES,
  DEPARTMENT_CAPABILITIES,
  DEPARTMENT_COLORS,
  type DeliverableKind,
  type DepartmentArchivePreview,
  type DepartmentCode,
  type DepartmentDashboard,
  type DepartmentDetailResponse,
  type DepartmentOverview,
  type DepartmentResponse,
  type DepartmentTransferCategory,
  type DeviceMatch,
  type DuplicatePost,
  daysInclusive,
  daysInStage,
  daysOverdue,
  daysWithoutUpdate,
  decideHrRequestSchema,
  decideItemSchema,
  defaultInstallmentMilestones,
  deliveryRate,
  departmentSystemFunctions,
  deviceMatch,
  deviceOf,
  EMPHASIS_MARK,
  type EmailLogItem,
  type EmailRecordType,
  type EmailSummary,
  type EmployeeEmployment,
  type EmployeeFile,
  type EmployeePage,
  type EmployeePay,
  type EmployeePersonal,
  type EmployeeStatus,
  type ErrorCode,
  type ExtraWork,
  type ExtraWorkBilling,
  type ExtraWorkBillingChange,
  employeeStatus,
  endServiceSchema,
  extendQuoteSchema,
  type FieldWork,
  type FileItem,
  type FileItemList,
  type FileOwnerType,
  type FileRole,
  type FileUpload,
  type FileVersion,
  type FinanceDashboard,
  fileDatesValid,
  fileTypeOf,
  fillContractValues,
  followUpDateInRange,
  followUpFilterRange,
  formatContractNumber,
  grantedPermissions,
  type HardwareSignals,
  type HealthResponse,
  type Holiday,
  type HolidayList,
  type HrOpinion,
  type HrRequest,
  type HrRequestDetail,
  type HrRequestPage,
  type HrRequestPreview,
  type HrRequestWarning,
  type HrSettings,
  hasPostPack,
  holidayRangeValid,
  hrSettingsSchema,
  type Invoice,
  type InvoiceDetail,
  type InvoiceOrigin,
  type InvoicePage,
  type InvoiceSettings,
  type InvoiceSource,
  type InvoiceStatus,
  type IpLocation,
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
  itemOutcome,
  justifyItemSchema,
  type KeyDate,
  type KioskCodeEvent,
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
  type LeaveBalance,
  type LedgerRow,
  type LinkableTask,
  leadDisplayName,
  leadDuplicateQuerySchema,
  leadHasContactMethod,
  leadOwnerChangeSchema,
  leadSourceDetailMissing,
  leadStageChangeSchema,
  leaveSplit,
  leaveUnits,
  loseLeadSchema,
  lossRejectionReason,
  MANUAL_LEAD_STAGES,
  type MedicalReview,
  type Meeting,
  type MeetingDetail,
  type MeResponse,
  type Milestone,
  type MilestoneStatus,
  type MonthPending,
  type MonthSheet,
  type MonthSheetRow,
  type MovedPost,
  type MovePost,
  type MyAttendanceToday,
  type MyClientsDashboard,
  type MyContentSummary,
  type MyQuestion,
  type MyTaskSummary,
  manualLeadMoveRefusal,
  mentionedUserIds,
  mergeDeliverableLines,
  lastOfMonth as monthEnd,
  monthEnded,
  monthPeriod,
  monthRange,
  firstOfMonth as monthStart,
  monthTotals,
  moveWorkDays,
  NOTIFICATION_CATALOG,
  NOTIFICATION_TYPES,
  type Note,
  type NoteChannel,
  type Notification,
  type NotificationContent,
  type NotificationPolicy,
  type NotificationPriority,
  type NotificationSettings,
  type NotificationType,
  needsDiscountApproval,
  nextPunchDirection,
  notificationBox,
  notificationInbox,
  notificationPriority,
  nthWorkDay,
  OPEN_AD_CAMPAIGN_STATUSES,
  OPEN_INVOICE_STATUSES,
  OPEN_LEAD_STAGES,
  OPEN_TASK_STATUSES,
  type OverdueInvoicesReport,
  occasionApplies,
  occasionDates,
  occasionYearKey,
  onTimeRate,
  type PasskeyState,
  type PatchCampaignUpdate,
  type Payment,
  type Permission,
  type PlannedPost,
  type PlatformAccount,
  POST_LIMITS,
  POST_STATUSES,
  type PollInput,
  type PollResultsVisibility,
  type PollVote,
  type Post,
  type PostCaption,
  type PostClientResponse,
  type PostDetail,
  type PostMedia,
  type PostMovePreview,
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
  type PunchRefusal,
  type PunchResult,
  type PushDelivery,
  type PushSubscriptionInput,
  packageIssues,
  pairKioskSchema,
  parseAttendanceCode,
  partOfDay,
  payoutSchema,
  periodInOneMonth,
  periodsOverlap,
  permissionMinutes,
  pillarBalance,
  planningIssues,
  planTemplateRun,
  postChecks,
  postMove,
  postTaskDueDate,
  postTaskTitle,
  punchInputSchema,
  punchOptionsInputSchema,
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
  type RemindAnnouncementResult,
  type ReopenShoot,
  type RequestScope,
  type RescheduleTerm,
  type Retainer,
  type RetainerBilling,
  type RetainerContract,
  type RetainerContractDetail,
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
  registerPasskeySchema,
  rejectPunchSchema,
  rejectQuoteSchema,
  renewalState,
  reopenLeadSchema,
  reopenMonthSchema,
  repeatedStepFor,
  repeatHolidaysSchema,
  reportMonths,
  requestsOverlap,
  revisionSourceOf,
  revokePasskeySchema,
  richTextFromPlain,
  richTextPlain,
  type SalaryChange,
  type SalaryChangeList,
  type ScheduleConflict,
  SENT_ANNOUNCEMENT_FIELDS,
  type SendAnnouncement,
  type SharedDeviceUser,
  type Shoot,
  type ShootDetail,
  type ShootStatus,
  type ShootType,
  type ShotListInput,
  type SignedInDevice,
  type SnoozeNotification,
  type SourceInvoice,
  scheduleTimesValid,
  sendQuoteSchema,
  serviceIssues,
  setRetainerTemplateSchema,
  shiftDueDate,
  shiftedHoliday,
  shootTaskTitle,
  snoozeUntil,
  spendCountsInWallet,
  splitEvenly,
  statementRows,
  sumDays,
  TASK_PRIORITIES,
  type Task,
  type TaskBoard,
  type TaskClientResponse,
  type TaskComment,
  type TaskCommentInput,
  type TaskDependenciesInput,
  type TaskDetail,
  type TaskPriority,
  type TaskReview,
  type TaskRights,
  type TaskStatus,
  type TaskStatusChange,
  type TaskTemplateDraft,
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
  type TodayBoard,
  type TodayBoardRow,
  taskMove,
  templateRunInputSchema,
  termEndDate,
  toUsdMinor,
  type UpdateCampaign,
  type UpdateClientContentSettings,
  type UpdateContentIdea,
  type UpdateContentOccasion,
  type UpdateContentPillar,
  type UpdateContentSnippet,
  type UpdateCycleLine,
  type UpdateDepartment,
  type UpdateExtraWork,
  type UpdateFollowing,
  type UpdateMeeting,
  type UpdateNotificationPolicy,
  type UpdateNotificationSettings,
  type UpdatePost,
  type UpdatePostLayout,
  type UpdateRetainerTerm,
  type UpdateShoot,
  type UpdateTaskInput,
  type UpdateWalletThreshold,
  type UserResponse,
  unitDays,
  unknownPlaceholders,
  updateAnnouncementSchema,
  updateAnnouncementTemplateSchema,
  updateCatalogPackageSchema,
  updateCatalogServiceSchema,
  updateClientReportSummarySchema,
  updateContractArticlesSchema,
  updateContractSettingsSchema,
  updateCycleReportSummarySchema,
  updateEmployeeFileSchema,
  updateHolidaySchema,
  updateInvoiceServicesSchema,
  updateInvoiceSettingsSchema,
  updateLeadNoteSchema,
  updateLeadSchema,
  updateProjectExpenseSchema,
  updateQuoteSettingsSchema,
  updateTemplateSchema,
  updateWorkScheduleSchema,
  type VoidWalletEntry,
  voidInvoiceSchema,
  voidPaymentSchema,
  type WalletEntry,
  WEEKDAYS,
  type WebAuthnChallenge,
  type Weekday,
  type WorkSchedule,
  type WorkScheduleList,
  walletLedger,
  weekOf,
} from '@vertex-hub/contracts';
import { formatRetainerCycle } from '@vertex-hub/messages';
import { isDeclaredEndpoint, reportApiProblem } from './test';

/*
 * The E2E suite covers the SPA alone: API responses are mocked here with the shared contract
 * types, and the API is exercised by its own integration tests (apps/api/test).
 */

/** F01C: the stand-in pictures the image route serves, by what the image shows. */
type ImageKind = 'portrait' | 'logo';

const IMAGE_SVG: Record<ImageKind, string> = {
  portrait:
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#c8bd9e"/><circle cx="160" cy="128" r="64" fill="#235b52"/><path d="M48 320 C48 230 104 200 160 200 C216 200 272 230 272 320 Z" fill="#235b52"/></svg>',
  // Transparent around a wide mark, as a logo zoomed out to fit (rule 8).
  logo: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><path d="M40 200 L110 110 L160 170 L200 130 L280 200 Z" fill="#004139"/><circle cx="236" cy="104" r="22" fill="#d8c3a0"/></svg>',
};

/** The greeting's photo (F01C rule 15), as the API sends it inside the greeting. */
export const PORTRAIT_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(IMAGE_SVG.portrait).toString('base64')}`;

export const imageId = (n: number) => `01920000-0000-7000-a000-${n.toString().padStart(12, '0')}`;

/**
 * A portrait photo as the dialog's file input receives it: a PNG drawn row by row, a darker head
 * on a sand background.
 */
export function portraitPng(width = 600, height = 800): Buffer {
  const crc = (bytes: Buffer) => {
    let c = ~0;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const head = (x - width / 2) ** 2 + (y - height * 0.4) ** 2 < (width / 4) ** 2;
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      rows.set(head ? [35, 91, 82] : [200, 189, 158], offset);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const healthy: HealthResponse = {
  status: 'ok',
  checks: { database: 'up' },
  timestamp: '2026-09-28T10:00:00.000Z',
};

const id = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;

const dept = (
  code: DepartmentResponse['code'],
  name: string,
  n: number,
  icon: DepartmentResponse['icon'],
) => ({
  id: id(900 + n),
  code,
  name,
  description: null as string | null,
  // The seed's colors: c1 to c8, then again from c1 (F23).
  color: DEPARTMENT_COLORS[(n - 1) % DEPARTMENT_COLORS.length] as DepartmentResponse['color'],
  icon,
  position: n,
  archivedAt: null as string | null,
});

export const departmentsSeed = [
  dept('general_management', 'الإدارة العامة', 1, 'briefcase'),
  dept('internal_operations', 'العمليات الداخلية', 2, 'settings'),
  dept('public_relations', 'العلاقات العامة', 3, 'handshake'),
  dept('marketing', 'التسويق', 4, 'megaphone'),
  dept('design', 'التصميم', 5, 'palette'),
  dept('photography', 'التصوير', 6, 'camera'),
  dept('content_management', 'إدارة المحتوى', 7, 'file-text'),
  dept('development', 'التطوير', 8, 'code'),
  dept('general_communication', 'التواصل العام', 9, 'headset'),
  dept('medical_consultation', 'الاستشارات الطبية', 10, 'stethoscope'),
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
  user: { id: id(1), name: 'سارة الخطيب', email: 'sara@vertex.example', imageId: null },
  roles: ['general_manager', 'employee', 'account_manager'],
  departments: [{ ...general, isPrimary: true, isManager: false }],
  permissions: grantedPermissions({
    roles: ['general_manager', 'employee', 'account_manager'],
    departments: [{ code: 'general_management', isManager: false }],
  }),
  twoFactor: { enabled: true, required: true },
};

/**
 * The General Manager as if money access were taken away (F05C edge case 12): manages clients
 * but never sees a contact's national ID. No role has this today; it shows the field's rule.
 */
export const managerWithoutMoney: MeResponse = {
  ...manager,
  permissions: manager.permissions.filter((granted) => granted.permission !== 'invoices.read'),
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
  user: { id: id(3), name: 'ليان الأحمد', email: 'layan@vertex.example', imageId: null },
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
  user: { id: id(6), name: 'باسل يوسف', email: 'basel@vertex.example', imageId: null },
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
  user: { id: id(2), name: 'عمر حداد', email: 'omar@vertex.example', imageId: null },
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
  user: { id: id(4), name: 'كريم الزين', email: 'karim@vertex.example', imageId: null },
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
  user: { id: id(8), name: 'د. هبة النجار', email: 'hiba@vertex.example', imageId: null },
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
    imageId: null,
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
    after: { manager: { id: id(3), name: 'ليان الأحمد', imageId: null } },
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
  },
  {
    id: id(505),
    occurredAt: '2026-09-27T12:20:00.000Z',
    actorId: id(1),
    actorName: 'سارة الخطيب',
    action: 'client.account_manager_changed',
    entityType: 'client',
    entityId: id(601),
    before: { accountManager: { id: id(1), name: 'سارة الخطيب', imageId: null } },
    after: { accountManager: { id: id(3), name: 'ليان الأحمد', imageId: null } },
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
    actorImageId: null,
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
  /** F01C: the client's logo. */
  imageId?: string | null;
  contacts: (Contact & { archived: boolean })[];
  platformAccounts: (PlatformAccount & { archived: boolean })[];
  billingName?: string | null;
  billingAddress?: string | null;
  registrationNumber?: string | null;
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
  fatherName: null,
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

/** The instant the F01B device specs and screenshots freeze the browser's clock on. */
export const DEVICES_NOW = '2026-10-19T09:00:00+03:00';

const minutesBefore = (minutes: number) =>
  new Date(new Date(DEVICES_NOW).getTime() - minutes * 60_000).toISOString();

const sessionId = (n: number) => `01920000-0000-7000-9000-${n.toString().padStart(12, '0')}`;

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const OFFICE_IP = '185.12.34.56';
const DAMASCUS: IpLocation = { countryCode: 'SY', city: 'Damascus' };

/** An open session the mocked API holds (F01B); pages of several users may share one list. */
export interface SessionRecord {
  id: string;
  userId: string;
  userAgent: string;
  browserKey: string | null;
  hardwareKey: string | null;
  ip: string | null;
  location: IpLocation;
  lastIp: string | null;
  lastLocation: IpLocation;
  signedInAt: string;
  lastActiveAt: string;
  /** F16 rule A7: the session's push subscription, when push is on for the device. */
  push?: { lastDeliveredAt: string | null };
}

/**
 * Sara on the office PC in Chrome and Edge and on her phone; Karim signed in later in the same
 * Chrome; Layan in Firefox on the same PC (another browser on this device, probably).
 */
export function sessionsSeed(): SessionRecord[] {
  const office = {
    hardwareKey: 'hw-office-pc',
    ip: OFFICE_IP,
    location: DAMASCUS,
    lastIp: OFFICE_IP,
    lastLocation: DAMASCUS,
  };
  return [
    {
      ...office,
      id: sessionId(1),
      userId: manager.user.id,
      userAgent: CHROME_WINDOWS,
      browserKey: 'office-chrome',
      signedInAt: '2026-10-18T06:12:00.000Z',
      lastActiveAt: minutesBefore(1),
    },
    {
      ...office,
      id: sessionId(2),
      userId: manager.user.id,
      userAgent: EDGE_WINDOWS,
      browserKey: 'office-edge',
      signedInAt: '2026-10-17T07:40:00.000Z',
      lastActiveAt: minutesBefore(95),
    },
    {
      id: sessionId(3),
      userId: manager.user.id,
      userAgent: SAFARI_IPHONE,
      browserKey: 'sara-phone',
      hardwareKey: null,
      ip: '5.134.200.17',
      location: { countryCode: 'SY', city: 'Aleppo' },
      lastIp: '2001:db8:85a3::8a2e:370:7334',
      lastLocation: { countryCode: 'TR', city: 'Gaziantep' },
      signedInAt: '2026-10-14T16:05:00.000Z',
      lastActiveAt: minutesBefore(26 * 60),
    },
    {
      ...office,
      id: sessionId(4),
      userId: employeeMe.user.id,
      userAgent: CHROME_WINDOWS,
      browserKey: 'office-chrome',
      signedInAt: '2026-10-19T05:30:00.000Z',
      lastActiveAt: minutesBefore(3),
    },
    {
      ...office,
      id: sessionId(5),
      userId: seedIds.layan,
      userAgent: FIREFOX_WINDOWS,
      browserKey: 'office-firefox',
      signedInAt: '2026-10-18T10:00:00.000Z',
      lastActiveAt: minutesBefore(40),
    },
  ];
}

const MATCH_STRENGTH: Record<DeviceMatch, number> = { same_browser: 2, same_device: 1 };

/** GET /api/me/sessions as the API answers it (rules 6, 14, 15). */
function signedInDevices(
  sessions: SessionRecord[],
  users: UserResponse[],
  userId: string,
  currentId: string,
): SignedInDevice[] {
  const keys = (s: SessionRecord) => ({
    browserKey: s.browserKey,
    hardwareKey: s.hardwareKey,
    ipAddress: s.ip,
    lastIpAddress: s.lastIp,
  });
  return sessions
    .filter((s) => s.userId === userId)
    .map((s) => {
      const shared = new Map<string, SharedDeviceUser>();
      for (const other of sessions) {
        if (other.userId === userId) continue;
        const match = deviceMatch(keys(s), keys(other));
        const user = users.find((u) => u.id === other.userId);
        if (!match || !user) continue;
        const known = shared.get(user.id);
        if (known && MATCH_STRENGTH[known.match] >= MATCH_STRENGTH[match]) continue;
        const primary = user.departments.find((d) => d.isPrimary);
        shared.set(user.id, {
          user: { id: user.id, name: user.name, imageId: null },
          department: primary ? { code: primary.code, name: primary.name } : null,
          match,
          lastActiveAt: other.lastActiveAt,
        });
      }
      return {
        id: s.id,
        current: s.id === currentId,
        device: deviceOf(s.userAgent),
        signIn: { at: s.signedInAt, ip: s.ip, location: s.location },
        lastActive: { at: s.lastActiveAt, ip: s.lastIp, location: s.lastLocation },
        sharedWith: [...shared.values()],
        // F16 rule A12.
        push: s.push
          ? { state: 'on' as const, lastDeliveredAt: s.push.lastDeliveredAt }
          : { state: 'off' as const, lastDeliveredAt: null },
      };
    })
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || b.lastActive.at.localeCompare(a.lastActive.at),
    );
}

interface MockOptions {
  signedIn: boolean;
  /** Open sessions (F01B), shared between the pages of a test; `sessionsSeed()` by default. */
  sessions?: SessionRecord[];
  /** This page's session among `sessions`; the user's first one by default. */
  session?: string;
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
  /** F16 rule A16: the server has VAPID keys; true by default. */
  pushAvailable?: boolean;
  /** Adds the announcements of `announcementsSeed` (F16 part D); none by default. */
  announcements?: boolean;
  /** Also adds Sara's unacknowledged critical announcement, which blocks everyone else. */
  criticalAnnouncement?: boolean;
  /** Adds the public holidays of 2026 (`holidaysSeed`, F17 part B); none by default. */
  holidays?: boolean;
  /** Adds the leave requests of `leaveSeed` (F17 part B); none by default. */
  leave?: boolean;
  /** The entrance screen this browser is (F17 part C); unpaired by default. */
  kiosk?: KioskMock;
  /** F01C: photos for Sara, Omar and Layan and a logo for Al Yasmin; none by default. */
  images?: boolean;
  /**
   * F06B: the seeded tasks as a parent with subtasks and open questions (`subtaskLinksSeed`), so
   * lists, the board and My tasks show their badges; none by default.
   */
  subtasks?: boolean;
  /** F06B rule B7: the questions waiting for the signed-in user's answer; none by default. */
  questions?: MyQuestion[];
}

/** A P-256 public key as `GET /api/me/push/config` sends it (fake: no private key exists). */
export const VAPID_PUBLIC_KEY =
  'BF2zxNv-SsZD27lwglRpNUJNl6Xaa3oaouS6vN-Uz7Iq-ASfBgy1CQSFhfF2Z1pCb3uOdtv_FhBNyXvBj_mR3gg';

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
  /** The hardware the page reported for its session (F01B rule 5). */
  hardwareReports: HardwareSignals[];
  /** The push subscriptions the page stored on its session, and the test pushes (F16). */
  push: { subscriptions: PushSubscriptionInput[]; tests: number; clicks: string[] };
}

/** Mocks the API with an in-memory team. `signedIn` decides whether /api/me finds a session. */
export async function mockApi(page: Page, options: MockOptions): Promise<MockedApi> {
  let signedIn = options.signedIn;
  let me = options.me ?? manager;
  const users = teamSeed();
  const sessions = options.sessions ?? sessionsSeed();
  const hardwareReports: HardwareSignals[] = [];
  const pushAvailable = options.pushAvailable ?? true;
  const push: MockedApi['push'] = { subscriptions: [], tests: 0, clicks: [] };
  /** This page's session, opened for the user when the list has none (or it was signed out). */
  const openSession = (preferred?: string) => {
    const found =
      sessions.find((s) => s.id === preferred) ?? sessions.find((s) => s.userId === me.user.id);
    if (found) return found.id;
    const opened: SessionRecord = {
      id: sessionId(100 + sessions.length),
      userId: me.user.id,
      userAgent: CHROME_WINDOWS,
      browserKey: `browser-${me.user.id}`,
      hardwareKey: null,
      ip: '127.0.0.1',
      location: { local: true },
      lastIp: '127.0.0.1',
      lastLocation: { local: true },
      signedInAt: minutesBefore(10),
      lastActiveAt: minutesBefore(0),
    };
    sessions.push(opened);
    return opened.id;
  };
  let currentSession = openSession(options.session);
  /** Rule 9: a session signed out from another device is refused at its next request. */
  const sessionOpen = () => sessions.some((s) => s.id === currentSession);
  const clients = clientsSeed();
  /** F01C: the current images, by id; removed and replaced ones answer 404 (rule 11). */
  const images = new Map<string, ImageKind>();
  if (options.images) {
    for (const [n, userId] of [id(1), id(2), id(3)].entries()) {
      const user = users.find((u) => u.id === userId);
      if (user) user.imageId = imageId(n + 1);
      images.set(imageId(n + 1), 'portrait');
    }
    const jasmine = clients.find((c) => c.id === id(601));
    if (jasmine) jasmine.imageId = imageId(10);
    images.set(imageId(10), 'logo');
  }
  /** The session user carries their own photo (F01C). */
  const syncMe = () => {
    const self = users.find((u) => u.id === me.user.id);
    if (self) me = { ...me, user: { ...me.user, imageId: self.imageId } };
  };
  syncMe();
  let nextImage = 100;
  const clientsApi = clientRoutes({ users, clients, me: () => me });
  const projects = projectsSeed();
  const projectsApi = projectRoutes({ users, clients, projects, me: () => me });
  const retainers = retainersSeed();
  const contractSettings = contractSettingsSeed();
  const retainersApi = retainerRoutes({
    users,
    clients,
    retainers,
    me: () => me,
    contractSettings,
  });
  const contractSettingsApi = contractSettingsRoutes({
    users,
    me: () => me,
    state: contractSettings,
  });
  const sent = options.approvals ? approvalsSeed() : { tasks: [], files: [], requests: [] };
  const planned = options.content
    ? contentSeed()
    : { posts: [], tasks: [], files: [], requests: [] };
  const booked = options.calendar ? calendarSeed() : { shoots: [], meetings: [], tasks: [] };
  const tasks = [...tasksSeed(), ...sent.tasks, ...planned.tasks, ...booked.tasks];
  const billing = invoicesSeed();
  const holidays = options.holidays ? holidaysSeed() : [];
  const leave: LeaveState = options.leave ? leaveSeed(users) : { requests: [], ledger: [] };
  const calendarApi = calendarRoutes({
    users,
    clients,
    projects,
    retainers,
    tasks,
    shoots: booked.shoots,
    meetings: booked.meetings,
    invoices: billing.invoices,
    holidays,
    leave,
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
    leave,
    links: options.subtasks ? subtaskLinksSeed() : undefined,
    questions: options.questions ?? [],
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
  const staff = employeesSeed(users);
  const hrSettings = { current: HR_SETTINGS };
  const attendanceApi = attendanceRoutes({
    users,
    files: staff.files,
    settings: hrSettings,
    holidays,
    kiosk: options.kiosk ?? { paired: false },
    leave,
    me: () => me,
  });
  const hrApi = hrRoutes({
    users,
    holidays,
    staff,
    settings: hrSettings,
    passkeyOf: attendanceApi.passkeyOf,
    me: () => me,
  });
  const leaveApi = leaveRoutes({ users, holidays, leave, me: () => me });
  const announcementsApi = announcementRoutes({
    users,
    clients,
    projects,
    announcements:
      options.announcements || options.criticalAnnouncement
        ? announcementsSeed({ critical: options.criticalAnnouncement })
        : [],
    templates: announcementTemplatesSeed(),
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

  const departmentsApi = departmentRoutes({
    users,
    tasks,
    tasksApi,
    projects,
    retainers,
    catalog,
    managers,
    me: () => me,
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
      return signedIn && sessionOpen() ? json(route, me) : fail(route, 401, null);
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
      currentSession = openSession();
      return json(route, { redirect: false, token: 'test-token', user: me.user });
    }
    if (path === '/api/auth/two-factor/verify-totp') {
      const { code } = request.postDataJSON() as { code: string };
      if (code === '000000') {
        return json(route, { code: 'INVALID_CODE', message: 'Invalid code' }, 401);
      }
      signedIn = true;
      currentSession = openSession();
      me = { ...me, twoFactor: { ...me.twoFactor, enabled: true } };
      return json(route, { token: 'test-token', user: me.user });
    }
    if (path === '/api/auth/two-factor/verify-backup-code') {
      signedIn = true;
      currentSession = openSession();
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
    if (path === '/api/password-links/check') {
      const { token } = request.postDataJSON() as { token: string };
      return token === VALID_LINK_TOKEN
        ? json(route, {
            kind: 'activation',
            email: manager.user.email,
            expiresAt: '2026-01-04T10:00:00.000Z',
          })
        : fail(route, 400, 'LINK_INVALID');
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
    // The entrance screen (F17 rule C4) holds no user session.
    if (path.startsWith('/api/kiosk/')) {
      const screen = attendanceApi.route(route, method, url, request);
      if (screen) return screen;
    }
    if (!signedIn || !sessionOpen()) return fail(route, 401, null);

    // Signed-in devices (F01B).
    if (path === '/api/me/sessions' && method === 'GET') {
      return json(route, { items: signedInDevices(sessions, users, me.user.id, currentSession) });
    }
    if (path === '/api/me/sessions/current/hardware' && method === 'PUT') {
      hardwareReports.push(request.postDataJSON() as HardwareSignals);
      return route.fulfill({ status: 204 });
    }

    // Push on the signed-in devices (F16 part A).
    const current = sessions.find((s) => s.id === currentSession);
    if (path === '/api/me/push/config' && method === 'GET') {
      return json(route, {
        available: pushAvailable,
        vapidPublicKey: pushAvailable ? VAPID_PUBLIC_KEY : null,
      });
    }
    if (path === '/api/me/push/subscription' && method === 'PUT') {
      if (!pushAvailable || !current) return fail(route, 409, 'PUSH_UNAVAILABLE');
      push.subscriptions.push(request.postDataJSON() as PushSubscriptionInput);
      current.push = { lastDeliveredAt: null };
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/me/push/subscription' && method === 'DELETE') {
      if (current) delete current.push;
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/me/push/test' && method === 'POST') {
      if (!current?.push) return fail(route, 409, 'NO_SUBSCRIPTION');
      push.tests += 1;
      current.push.lastDeliveredAt = new Date().toISOString();
      return route.fulfill({ status: 202 });
    }
    const pushClick = path.match(/^\/api\/me\/push\/deliveries\/([^/]+)\/click$/);
    if (pushClick?.[1] && method === 'POST') {
      push.clicks.push(pushClick[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/me/sessions/sign-out-all' && method === 'POST') {
      const { includeCurrent } = request.postDataJSON() as { includeCurrent: boolean };
      const removed = sessions.filter(
        (s) => s.userId === me.user.id && (includeCurrent || s.id !== currentSession),
      );
      for (const s of removed) sessions.splice(sessions.indexOf(s), 1);
      if (includeCurrent) signedIn = false;
      return json(route, { signedOut: removed.length });
    }
    const signOutMatch = path.match(/^\/api\/me\/sessions\/([^/]+)$/);
    if (signOutMatch && method === 'DELETE') {
      const target = sessions.find((s) => s.id === signOutMatch[1] && s.userId === me.user.id);
      if (!target) return fail(route, 404, null);
      if (target.id === currentSession) return fail(route, 400, 'CURRENT_SESSION');
      sessions.splice(sessions.indexOf(target), 1);
      return route.fulfill({ status: 204 });
    }

    // F01C: images (rule 11) and setting or removing one (rules 1 and 4).
    const imageMatch = path.match(/^\/api\/images\/([^/]+)\/(sm|md)$/);
    if (imageMatch && method === 'GET') {
      const kind = images.get(imageMatch[1] ?? '');
      if (!kind) return fail(route, 404, null);
      return route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        headers: { 'cache-control': 'private, max-age=31536000, immutable' },
        body: IMAGE_SVG[kind],
      });
    }
    const setMatch = path.match(/^\/api\/(users|clients|projects|retainers)\/([^/]+)\/image$/);
    if (setMatch && (method === 'PUT' || method === 'DELETE')) {
      const [, type, recordId] = setMatch;
      const holds = (permission: Permission) =>
        me.permissions.some((g) => g.permission === permission);
      const record =
        type === 'users'
          ? users.find((u) => u.id === recordId)
          : type === 'clients'
            ? clients.find((c) => c.id === recordId)
            : type === 'projects'
              ? projects.find((p) => p.id === recordId)
              : retainers.find((x) => x.id === recordId);
      if (!record) return fail(route, 404, null);
      const allowed =
        type === 'users'
          ? recordId === me.user.id ||
            (holds('users.manage') &&
              (!(record as UserResponse).roles?.includes('general_manager') ||
                me.roles.includes('general_manager')))
          : holds(type === 'clients' ? 'clients.manage' : 'projects.manage');
      if (!allowed) return fail(route, 403, null);
      const archived =
        type === 'users'
          ? (record as UserResponse).status === 'archived'
          : (record as { archived: boolean }).archived;
      if (archived) {
        const codes = {
          users: 'USER_ARCHIVED',
          clients: 'CLIENT_ARCHIVED',
          projects: 'PROJECT_ARCHIVED',
          retainers: 'RETAINER_ARCHIVED',
        } as const;
        return fail(route, 409, codes[type as keyof typeof codes]);
      }
      if (record.imageId) images.delete(record.imageId);
      if (method === 'DELETE') {
        record.imageId = null;
        syncMe();
        return route.fulfill({ status: 204 });
      }
      const created = imageId(nextImage++);
      images.set(created, type === 'users' ? 'portrait' : 'logo');
      record.imageId = created;
      syncMe();
      return json(route, { id: created, status: 'pending' });
    }

    // Users.
    if (path === '/api/users' && method === 'GET') {
      const status = url.searchParams.get('status') ?? 'active';
      const search = url.searchParams.get('search')?.toLowerCase();
      const departmentId = url.searchParams.get('departmentId');
      const role = url.searchParams.get('role');
      const hasImage = url.searchParams.get('hasImage');
      // Like the API: status, assigned-role and photo filters are for user managers only.
      const userManager = me.permissions.some((g) => g.permission === 'users.manage');
      if (
        (status !== 'active' || (role && role !== 'department_manager') || hasImage) &&
        !userManager
      ) {
        return fail(route, 403, null);
      }
      const items = users.filter(
        (u) =>
          u.status === status &&
          (!role || u.roles?.includes(role as NonNullable<UserResponse['roles']>[number])) &&
          (!search || u.name.toLowerCase().includes(search) || u.email?.includes(search)) &&
          (!departmentId || u.departments.some((d) => d.id === departmentId)) &&
          (!hasImage || (hasImage === 'true') === (u.imageId !== null)),
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

    // Departments (F01, F23), with the overview the API's reports module serves.
    const departed = departmentsApi(route, method, url, request);
    if (departed) return departed;

    // HR (F17), with the documents of an employee file and of a request, and the entrance screen.
    const attended = attendanceApi.route(route, method, url, request);
    if (attended) return attended;
    const onLeave = leaveApi(route, method, url, request);
    if (onLeave) return onLeave;
    const staffed = hrApi(route, method, url, request);
    if (staffed) return staffed;

    // Announcements and audiences (F16 part D), with the files of an announcement.
    const announced = announcementsApi(route, method, url);
    if (announced) return announced;

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
    // Contract settings (F05C).
    const contracted = contractSettingsApi(route, method, url, request);
    if (contracted) return contracted;

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
      // A record's history (F23 department history) asks for its own entries.
      const entityType = url.searchParams.get('entityType');
      const entityId = url.searchParams.get('entityId');
      const items = auditSeed.filter(
        (entry) =>
          (!entityType || entry.entityType === entityType) &&
          (!entityId || entry.entityId === entityId),
      );
      return json(route, { items, total: items.length, page: 1, pageSize: 30 });
    }
    reportApiProblem(page, `No mock for ${method} ${path}`);
    return fail(route, 404, null);
  });
  return {
    signInAs: (next) => {
      me = next;
      syncMe();
      currentSession = openSession();
    },
    hardwareReports,
    push,
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
  // F05C: the national ID needs money access covering the client too.
  const canManageNationalId = (c: ClientRecord) =>
    canManage(c) &&
    (holds('invoices.read', 'all') ||
      (holds('invoices.read', 'own_clients') && c.accountManagerId === me().user.id));
  const contactFor = (c: ClientRecord, contact: Contact & { archived: boolean }): Contact => {
    const { archived: _, nationalId, ...rest } = contact;
    return canManageNationalId(c) ? { ...rest, nationalId: nationalId ?? null } : rest;
  };

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
        imageId: manager?.imageId ?? null,
        archived: manager?.status === 'archived',
      },
      hasApprovalContact: c.contacts.some((x) => !x.archived && x.hasFinalApproval),
      imageId: c.imageId ?? null,
    };
  };
  const strip = <T extends { archived: boolean }>({ archived: _, ...rest }: T) => rest;
  const detail = (c: ClientRecord): ClientDetailResponse => ({
    ...summary(c),
    brandKit: c.brandKit,
    contacts: c.contacts.filter((x) => !x.archived).map((x) => contactFor(c, x)),
    platformAccounts: c.platformAccounts.filter((x) => !x.archived).map(strip),
    billingName: c.billingName ?? null,
    billingAddress: c.billingAddress ?? null,
    registrationNumber: c.registrationNumber ?? null,
    archivedAt: c.archived ? '2026-09-20T10:00:00.000Z' : null,
    canManage: canManage(c),
    canManageNationalId: canManageNationalId(c),
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
      author: { id: n.authorId, name: nameOf(n.authorId), imageId: null },
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
      const input = method === 'POST' || method === 'PATCH' ? (body() ?? {}) : {};
      const contacts = part === 'contacts';
      if (contacts && 'nationalId' in input && !canManageNationalId(client)) {
        return fail(route, 403, null);
      }
      const shown = (item: { archived: boolean }) =>
        contacts ? contactFor(client, item as Contact & { archived: boolean }) : strip(item);
      if (!childId) {
        const created = {
          id: id(next++),
          clientId: client.id,
          archived: false,
          ...(contacts && { fatherName: null }),
          ...input,
        };
        list.push(created);
        return json(route, shown(created), 201);
      }
      const item = list.find((x) => x.id === childId);
      if (!item) return fail(route, 404, null);
      if (childAction === 'archive') {
        item.archived = true;
        return route.fulfill({ status: 204 });
      }
      Object.assign(item, input);
      return json(route, shown(item));
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
  /** F01C: the project's own image; without one it shows the client's logo. */
  imageId?: string | null;
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
    doneBy: m.doneById
      ? { id: m.doneById, name: user(m.doneById)?.name ?? '', imageId: null }
      : null,
    tasks: noTasks,
    ...(seesMoney(p) && { money: { installmentMinor: m.installmentMinor } }),
  });
  const summary = (p: ProjectRecord): Project => {
    const manager = user(p.projectManagerId);
    const milestones = live(p);
    return {
      id: p.id,
      name: p.name,
      imageId: p.imageId ?? clientOf(p)?.imageId ?? null,
      client: {
        id: p.clientId,
        name: clientOf(p)?.tradeName ?? '',
        imageId: clientOf(p)?.imageId ?? null,
      },
      projectManager: {
        id: p.projectManagerId,
        name: manager?.name ?? '',
        imageId: manager?.imageId ?? null,
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
    ownImageId: p.imageId ?? null,
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
      loggedBy: { id: item.loggedById, name: user(item.loggedById)?.name ?? '', imageId: null },
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
  /** F05C: the cycle number from the retainer's start date. */
  number: number;
  periodStart: string;
  periodEnd: string;
  status: CycleStatus;
  closedAt: string | null;
  lines: CycleLineRecord[];
  /** F05C B3, B4: recorded by the catch-up of a backdated retainer. */
  backdated?: boolean;
  untracked?: boolean;
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

/** A fixed term of a retainer (F05B, F05C); its cycles' charges derive from `schedule`. */
interface TermRecord {
  id: string;
  number: number;
  status: TermStatus;
  startCycle: number;
  cycles: number;
  endAction: TermEndAction;
  /** One amount per cycle (minor units of the retainer's currency). */
  schedule: number[];
  renewedFromId: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** F05B C6: an addition or a credit an amendment created. */
interface AmendmentChargeRecord {
  id: string;
  cycle: number;
  periodStart: string;
  periodEnd: string;
  kind: 'addition' | 'credit';
  amountMinor: number;
  status: 'pending' | 'settled_outside';
  amendment: { id: string; number: number };
  settleNote: string | null;
}

/** The charge of a term's month, at its position (0-based). */
const termChargeId = (termId: string, index: number) =>
  `d${termId.slice(1, -2)}${index.toString().padStart(2, '0')}`;

const termEndCycleOf = (term: TermRecord) => term.startCycle + term.cycles - 1;

/** The term's cycles as their charges: due from the cycle's first day (F05B C3, F05C). */
function termChargesOf(r: RetainerRecord, today: string) {
  const current = currentCycleNumber(r.startDate, today);
  return (r.terms ?? []).flatMap((term) =>
    term.schedule.map((amountMinor, index) => {
      const cycle = term.startCycle + index;
      return {
        id: termChargeId(term.id, index),
        cycle,
        ...cyclePeriod(r.startDate, cycle),
        kind: 'monthly' as const,
        amountMinor,
        // Early end and cancelled terms cancel cycles not begun (E1, T5).
        status:
          term.status === 'cancelled' && cycle > current
            ? ('cancelled' as const)
            : ('pending' as const),
        term: { number: term.number, position: index + 1, cycles: term.cycles },
        amendment: null,
        settleNote: null,
        due: cycle <= current,
      };
    }),
  );
}

/** Cycles a term covers that are not cancelled: open-ended charges skip them (C2). */
function termCovers(r: RetainerRecord, cycle: number) {
  return (r.terms ?? []).some(
    (term) =>
      term.status !== 'cancelled' && term.startCycle <= cycle && termEndCycleOf(term) >= cycle,
  );
}

function termSummaryOf(r: RetainerRecord, term: TermRecord): RetainerTermSummary {
  return {
    id: term.id,
    number: term.number,
    status: term.status,
    startCycle: term.startCycle,
    cycles: term.cycles,
    startDate: cyclePeriod(r.startDate, term.startCycle).periodStart,
    endDate: termEndDate(r.startDate, term.startCycle, term.cycles),
    endAction: term.endAction,
  };
}

/** A term as `GET /api/retainers/:id/terms` returns it; amounts only with money access (G3). */
function termOf(r: RetainerRecord, term: TermRecord, money: boolean, today: string): RetainerTerm {
  const charges = termChargesOf(r, today).filter((c) => c.term.number === term.number);
  const schedule = charges.map((c) => ({
    cycle: c.cycle,
    periodStart: c.periodStart,
    periodEnd: c.periodEnd,
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
    ...termSummaryOf(r, term),
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
  const last = Math.max(...open.map(termEndCycleOf));
  r.renewalDate = cyclePeriod(r.startDate, last + 1).periodStart;
}

interface RetainerRecord {
  id: string;
  clientId: string;
  name: string;
  departments: DepartmentCode[];
  status: RetainerStatus;
  startDate: string;
  renewalDate: string | null;
  /** F05C P2–P4: resumed "from the next cycle": no cycle opens before this day. */
  cyclesFrom?: string | null;
  endedOn: string | null;
  currency: Currency;
  monthlyFeeMinor: number | null;
  archived: boolean;
  /** F01C: the retainer's own image; without one it shows the client's logo. */
  imageId?: string | null;
  deliverables: DeliverableRecord[];
  cycles: CycleRecord[];
  extraWork: ExtraWorkRecord[];
  /** F05B: fixed terms, oldest first. */
  terms?: TermRecord[];
  /** F05B: amendments, oldest first. */
  amendments?: Amendment[];
  amendmentCharges?: AmendmentChargeRecord[];
  /** F05C: contracts and their annexes, oldest first; discarded drafts are archived. */
  contracts?: ContractRecord[];
}

interface ContractRecord {
  id: string;
  kind: RetainerContract['kind'];
  termId: string | null;
  startCycle: number;
  status: RetainerContract['status'];
  number: string | null;
  contractDate: string;
  signatoryContactId: string | null;
  articles: ContractArticle[];
  /** Frozen at issue (K3). */
  snapshot: ContractSnapshot | null;
  signed: RetainerContract['signed'];
  voided: RetainerContract['voided'];
  issuedAt: string | null;
  issuedBy: { id: string; name: string; imageId: string | null } | null;
  draftPdf: RetainerContractDetail['draftPdf'];
  annexes: ContractAnnex[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
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
    number: 8,
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
          number: 7,
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
          number: 6,
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
          startCycle: 3,
          cycles: 3,
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
          startCycle: 6,
          cycles: 3,
          endAction: 'renew',
          schedule: [3_000_000, 3_000_000, 4_000_000],
          renewedFromId: id(1931),
          cancelReason: null,
          cancelledAt: null,
          createdAt: '2026-09-01T00:05:00.000Z',
        },
      ],
      amendments: [
        {
          id: id(1941),
          retainerId: id(902),
          number: 1,
          kind: 'change',
          scope: 'onward',
          effectiveCycle: 7,
          effectiveDate: '2026-11-01',
          status: 'scheduled',
          reason: 'إضافة تقرير أداء نصف شهري',
          lines: [
            {
              kind: 'monthly_report',
              label: null,
              quantityDelta: 1,
              quantity: null,
              revisionLimit: null,
              position: 1,
            },
          ],
          createdBy: { id: id(3), name: '', imageId: null },
          createdAt: '2026-10-03T09:00:00.000Z',
          decision: null,
          appliedAt: null,
          effects: [
            {
              cycle: 7,
              periodStart: '2026-11-01',
              periodEnd: '2026-11-30',
              effect: 'charge_changed',
              invoice: null,
              money: { beforeMinor: 3_000_000, afterMinor: 3_500_000 },
            },
            {
              cycle: 8,
              periodStart: '2026-12-01',
              periodEnd: '2026-12-31',
              effect: 'charge_changed',
              invoice: null,
              money: { beforeMinor: 4_000_000, afterMinor: 4_500_000 },
            },
          ],
          money: { amountDeltaMinor: 500_000, moneyDeltaMinor: 1_000_000, schedule: null },
        },
        {
          id: id(1942),
          retainerId: id(902),
          number: 2,
          kind: 'change',
          scope: 'cycle',
          effectiveCycle: 6,
          effectiveDate: '2026-10-01',
          status: 'pending_approval',
          reason: 'الحملة متوقفة نصف الشهر',
          lines: [],
          createdBy: { id: id(3), name: '', imageId: null },
          createdAt: '2026-10-08T11:30:00.000Z',
          decision: null,
          appliedAt: null,
          effects: [
            {
              cycle: 6,
              periodStart: '2026-10-01',
              periodEnd: '2026-10-31',
              effect: 'credit',
              invoice: { id: id(1961), displayNumber: 'INV-2026-0031' },
              money: { beforeMinor: 3_000_000, afterMinor: 2_200_000 },
            },
          ],
          money: { amountDeltaMinor: -800_000, moneyDeltaMinor: -800_000, schedule: null },
        },
      ],
      amendmentCharges: [
        {
          id: id(1951),
          cycle: 5,
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          kind: 'credit',
          amountMinor: -300_000,
          status: 'pending',
          amendment: { id: id(1941), number: 1 },
          settleNote: null,
        },
      ],
      cycles: [
        {
          id: id(924),
          number: 5,
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
          number: 4,
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
  /** The contract settings drafts copy their articles from (F05C K2). */
  contractSettings: ContractSettingsState;
}

/** The retainers API (F05) over the in-memory records, with its access, cycle and money rules. */
/** The contract settings of F05C: agency details, numbering and the default articles. */
type ContractSettingsState = ReturnType<typeof contractSettingsSeed>;

function contractSettingsSeed() {
  let next = 9100;
  const settings = {
    legalName: 'شركة فيرتكس ميديا للخدمات الإعلامية',
    tradeName: 'Vertex Media',
    companyType: 'شركة محدودة المسؤولية',
    registrationNumber: '',
    address: 'دمشق، المزة، شارع الجلاء',
    phone: '+963 11 000 0000',
    email: 'hello@vertexmedia.test',
    website: 'vertexmedia.test',
    representativeName: 'محمد الفجر',
    representativeTitle: 'المدير العام',
    slogan: 'نبدأ بفكرة، ونبني كياناً، ونصنع أثراً.',
    numberPrefix: 'VM-CCS',
    updatedAt: '2026-10-01T08:00:00.000Z',
    updatedBy: null as { id: string; name: string; imageId: string | null } | null,
  };
  const articles = [
    {
      id: id(next++),
      title: 'موضوع العقد',
      body: 'تلتزم الوكالة بتقديم الخدمات الإعلامية والتسويقية المتفق عليها مع العميل، وفق عرض السعر ونطاق العمل المعتمدين.',
    },
    {
      id: id(next++),
      title: 'نطاق الخدمات',
      body: 'تشمل الخدمات المتفق عليها ما يلي، بالكميات المحددة لكل دورة.\n{services}',
    },
    {
      id: id(next++),
      title: 'الأتعاب وطريقة الدفع',
      body: 'تُستحق أتعاب كل دورة مقدماً، وتُسدَّد خلال {payment_terms_days} أيام من تاريخ الفاتورة.\n{fees}',
    },
  ];
  return { settings, articles, next: () => id(next++), issued: 0 };
}

function contractSettingsRoutes({
  users,
  me,
  state,
}: {
  users: UserResponse[];
  me: () => MeResponse;
  state: ContractSettingsState;
}) {
  const scopes = (permission: string) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const reads = () =>
    scopes('projects.manage').some((scope) => scope === 'all' || scope === 'own_clients') &&
    scopes('invoices.read').length > 0;
  const edits = () => scopes('catalog.manage').length > 0;
  const { settings } = state;
  const response = (): ContractSettings => ({
    ...settings,
    nextNumber: formatContractNumber(settings.numberPrefix, 2026, state.issued + 1),
    articles: state.articles,
    canEdit: edits(),
  });
  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    if (url.pathname === '/api/contract-settings') {
      if (method === 'GET') return reads() ? json(route, response()) : fail(route, 403, null);
      if (!edits()) return fail(route, 403, null);
      Object.assign(settings, updateContractSettingsSchema.parse(request.postDataJSON()), {
        updatedAt: '2026-10-14T09:00:00.000Z',
        updatedBy: { id: me().user.id, name: users.find((u) => u.id === me().user.id)?.name ?? '' },
      });
      return json(route, response());
    }
    if (url.pathname === '/api/contract-settings/articles' && method === 'PUT') {
      if (!edits()) return fail(route, 403, null);
      const input = updateContractArticlesSchema.parse(request.postDataJSON());
      if (input.articles.some((article) => unknownPlaceholders(article.body).length > 0)) {
        return fail(route, 400, 'UNKNOWN_PLACEHOLDER');
      }
      state.articles.splice(
        0,
        state.articles.length,
        ...input.articles.map((article) => ({ ...article, id: article.id ?? state.next() })),
      );
      return json(route, { articles: state.articles });
    }
    return undefined;
  };
}

function retainerRoutes({ users, clients, retainers, me, contractSettings }: RetainerState) {
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
      number: c.number,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      status: c.status,
      backdated: c.backdated ?? false,
      untracked: c.untracked ?? false,
      closedAt: c.closedAt,
      deliveryRate: c.untracked ? null : rateOf(lines),
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
        author: { id: a.authorId, name: user(a.authorId)?.name ?? '', imageId: null },
        createdAt: a.createdAt,
      })),
    })),
  });
  const newest = (r: RetainerRecord) => [...r.cycles].sort((a, b) => b.number - a.number);
  const current = (r: RetainerRecord) => newest(r).find((c) => c.status === 'open');
  const live = (r: RetainerRecord) => r.deliverables.filter((d) => !d.archived);

  /** F05C Y6: the open cycle with its days left and its place in the term covering it. */
  const currentOf = (r: RetainerRecord, c: CycleRecord): CurrentCycle => {
    const term = (r.terms ?? []).find(
      (t) => t.status !== 'cancelled' && t.startCycle <= c.number && termEndCycleOf(t) >= c.number,
    );
    return {
      ...cycleOf(r, c),
      daysLeft: cycleDaysLeft(c, today),
      termPosition: term ? c.number - term.startCycle + 1 : null,
      termCycles: term ? term.cycles : null,
    };
  };
  /** F05C Y6: when the next cycle opens, as the API answers it. */
  const nextCycleStartOf = (r: RetainerRecord, open: CycleRecord | undefined) => {
    if (r.status === 'ended') return null;
    if (r.startDate > today) return r.startDate;
    if (r.status === 'active' && open) return null;
    if (r.status === 'active' && r.cyclesFrom) return r.cyclesFrom;
    return cyclePeriod(r.startDate, currentCycleNumber(r.startDate, today) + 1).periodStart;
  };

  const summary = (r: RetainerRecord): Retainer => {
    const client = clientOf(r);
    const open = current(r);
    return {
      id: r.id,
      name: r.name,
      imageId: r.imageId ?? client?.imageId ?? null,
      client: { id: r.clientId, name: client?.tradeName ?? '', imageId: client?.imageId ?? null },
      accountManager: {
        id: client?.accountManagerId ?? '',
        name: user(client?.accountManagerId ?? '')?.name ?? '',
        imageId: user(client?.accountManagerId ?? '')?.imageId ?? null,
      },
      departments: r.departments,
      status: r.status,
      renewalDate: r.renewalDate,
      renewal: renewalState(r.renewalDate, r.status, today),
      term: (() => {
        const term = currentTermOf(r);
        return term ? termSummaryOf(r, term) : null;
      })(),
      pendingAmendments: (r.amendments ?? []).filter((a) => a.status === 'pending_approval').length,
      currentCycle: open ? currentOf(r, open) : null,
      nextCycleStart: nextCycleStartOf(r, open),
    };
  };
  const detail = (r: RetainerRecord): RetainerDetail => ({
    ...summary(r),
    term: (() => {
      const term = currentTermOf(r);
      if (!term) return null;
      return { ...termSummaryOf(r, term), money: termOf(r, term, seesMoney(r), today).money };
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
      money: {
        currency: r.currency,
        monthlyFeeMinor: r.monthlyFeeMinor,
        creditPendingMinor: -(r.amendmentCharges ?? [])
          .filter((c) => c.kind === 'credit' && c.status === 'pending')
          .reduce((sum, c) => sum + c.amountMinor, 0),
      },
    }),
    permissions: permissions(r),
    ownImageId: r.imageId ?? null,
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
      loggedBy: { id: item.loggedById, name: user(item.loggedById)?.name ?? '', imageId: null },
      billingStatus: item.billingStatus,
      billingNote: item.billingNote,
      createdAt: item.createdAt,
      ...(seesMoney(r) && { money: { estimateMinor: item.estimateMinor, currency: r.currency } }),
    };
  };
  let next = 1900;

  /**
   * F05C Y2: the current cycle, opened at once with the full quantities, if none exists. Started
   * now (P2, P3), it runs from today to the end of its period.
   */
  const openCurrent = (r: RetainerRecord, startNow = false) => {
    const number = currentCycleNumber(r.startDate, today);
    if (number === 0 || r.cycles.some((c) => c.number === number)) return;
    const period = cyclePeriod(r.startDate, number);
    r.cycles.push({
      id: id(next++),
      number,
      periodStart: startNow && today > period.periodStart ? today : period.periodStart,
      periodEnd: period.periodEnd,
      status: 'open',
      closedAt: null,
      lines: live(r).map((d) => cycleLine(next++, d, d.monthlyQuantity, 0, false)),
    });
    r.cyclesFrom = null;
  };

  // Answers a retainers request, or returns undefined to let the other mocks try.
  // F05C contracts and annexes (K1–K11), with the API's access: money access to read, client
  // scope with money access to change (G3).
  const contractContent = (r: RetainerRecord, c: ContractRecord): ContractSnapshot => {
    const { settings } = contractSettings;
    const client = clientOf(r);
    const contact = client?.contacts.find((x) => x.id === c.signatoryContactId && !x.archived);
    const term = (r.terms ?? []).find((t) => t.id === c.termId);
    const startCycle = term?.startCycle ?? c.startCycle;
    const { legalName, tradeName, companyType, registrationNumber, address, phone, email } =
      settings;
    return {
      displayNumber: c.number,
      contractDate: c.contractDate,
      agency: {
        legalName,
        tradeName,
        companyType,
        registrationNumber,
        address,
        phone,
        email,
        website: settings.website,
        representativeName: settings.representativeName,
        representativeTitle: settings.representativeTitle,
      },
      client: {
        signatoryName: contact?.name ?? '',
        fatherName: contact?.fatherName ?? '',
        tradeName: client?.tradeName ?? '',
        nationalId: contact?.nationalId ?? '',
        registrationNumber: client?.registrationNumber ?? '',
        phone: contact?.phone ?? '',
        email: contact?.email ?? '',
        address: client?.billingAddress ?? '',
        title: contact?.jobTitle ?? '',
      },
      slogan: settings.slogan,
      articles: c.articles.map((article, index) => ({
        number: index + 1,
        title: article.title,
        body: fillContractValues(article.body, {
          agency_name: settings.tradeName,
          client_name: client?.tradeName ?? '',
          retainer_name: r.name,
          payment_terms_days: '15',
        }),
      })),
      services: {
        quote: null,
        deliverables: live(r).map((d) => ({
          kind: d.kind,
          label: d.label,
          quantity: d.monthlyQuantity,
          revisionLimit: d.revisionLimit,
        })),
      },
      term: {
        kind: c.kind,
        retainerName: r.name,
        startDate: cyclePeriod(r.startDate, startCycle).periodStart,
        cycleDay: Number(r.startDate.slice(8)),
        cycles: term?.cycles ?? null,
        endDate: term ? termEndDate(r.startDate, term.startCycle, term.cycles) : null,
        endAction: term?.endAction ?? null,
      },
      fees: {
        currency: r.currency,
        agreedTotalMinor: term ? term.schedule.reduce((sum, amount) => sum + amount, 0) : null,
        schedule: (term?.schedule ?? []).map((amountMinor, index) => ({
          cycle: startCycle + index,
          ...cyclePeriod(r.startDate, startCycle + index),
          amountMinor,
        })),
        feeMinor: term ? null : r.monthlyFeeMinor,
      },
    };
  };
  const contractOf = (r: RetainerRecord, c: ContractRecord): RetainerContract => {
    const term = (r.terms ?? []).find((t) => t.id === c.termId);
    return {
      id: c.id,
      retainerId: r.id,
      kind: c.kind,
      term: term
        ? {
            id: term.id,
            number: term.number,
            startCycle: term.startCycle,
            cycles: term.cycles,
            startDate: cyclePeriod(r.startDate, term.startCycle).periodStart,
            endDate: termEndDate(r.startDate, term.startCycle, term.cycles),
          }
        : null,
      startCycle: c.startCycle,
      status: c.status,
      number: c.number,
      contractDate: c.contractDate,
      pdf: c.status === 'draft' ? null : { state: 'ready' },
      signed: c.signed,
      voided: c.voided,
      issuedAt: c.issuedAt,
      issuedBy: c.issuedBy,
      changedSinceIssue: false,
      annexes: c.annexes,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  };
  const contractDetail = (r: RetainerRecord, c: ContractRecord): RetainerContractDetail => {
    const content = c.snapshot ?? contractContent(r, c);
    const missing = [
      ...CONTRACT_AGENCY_FIELDS.filter((field) => !content.agency[field]).map((field) => ({
        party: 'agency' as const,
        field,
        required: (CONTRACT_REQUIRED_FIELDS.agency as readonly string[]).includes(field),
      })),
      ...CONTRACT_CLIENT_FIELDS.filter((field) => !content.client[field]).map((field) => ({
        party: 'client' as const,
        field,
        required: (CONTRACT_REQUIRED_FIELDS.client as readonly string[]).includes(field),
      })),
    ];
    const contact = clientOf(r)?.contacts.find((x) => x.id === c.signatoryContactId);
    return {
      ...contractOf(r, c),
      signatoryContact: contact ? { id: contact.id, name: contact.name } : null,
      articles: c.articles,
      content,
      missing: c.status === 'draft' ? missing : [],
      absentBlocks: absentContractBlocks(c.articles.map((article) => article.body)),
      draftPdf: c.status === 'draft' ? c.draftPdf : null,
      canManage: !r.archived && clientScope(r) && seesMoney(r),
    };
  };
  const contractRoutes = (
    route: Route,
    method: string,
    request: Request,
    r: RetainerRecord,
    [childId, childPart, annexPart, annexId]: (string | undefined)[],
    part: string,
  ): Promise<void> => {
    if (!seesMoney(r)) return fail(route, 403, null);
    r.contracts ??= [];
    const list = r.contracts;
    const manages = clientScope(r) && !r.archived;
    const body = <T>() => request.postDataJSON() as T;
    const stamp = () => new Date().toISOString();
    if (part === 'amendments') {
      // POST /amendments/:id/annex (K10)
      if (!manages) return fail(route, 403, null);
      const amendment = (r.amendments ?? []).find((a) => a.id === childId);
      if (!amendment) return fail(route, 404, null);
      if (amendment.status !== 'applied' || amendment.kind === 'quote_renewal') {
        return fail(route, 409, 'INVALID_TRANSITION');
      }
      const contract = list.find((c) => c.status === 'issued' || c.status === 'signed');
      if (!contract) return fail(route, 409, 'NO_CONTRACT');
      const annex: ContractAnnex = {
        id: contractSettings.next(),
        contractId: contract.id,
        annexNumber: contract.annexes.length + 1,
        amendment: { id: amendment.id, number: amendment.number },
        status: 'issued',
        annexDate: body<{ annexDate: string }>().annexDate,
        pdf: { state: 'ready' },
        signed: null,
        voided: null,
        issuedBy: { id: me().user.id, name: me().user.name, imageId: null },
        createdAt: stamp(),
      };
      contract.annexes.push(annex);
      return json(route, annex, 201);
    }
    if (!childId) {
      if (method === 'GET') {
        return json(route, {
          items: list
            .filter((c) => !c.archived)
            .reverse()
            .map((c) => contractOf(r, c)),
        });
      }
      if (!manages) return fail(route, 403, null);
      if (r.status === 'ended') return fail(route, 409, 'RETAINER_ENDED');
      const input = body<{ kind: 'term' | 'open_ended'; termId?: string }>();
      const term = (r.terms ?? []).find((t) => t.id === input.termId);
      const exists = list.some(
        (c) =>
          !c.archived &&
          c.status !== 'void' &&
          (input.kind === 'term' ? c.termId === input.termId : c.kind === 'open_ended'),
      );
      if (exists) return fail(route, 409, 'CONTRACT_EXISTS');
      const contact = clientOf(r)?.contacts.find((x) => x.hasFinalApproval && !x.archived);
      const created: ContractRecord = {
        id: contractSettings.next(),
        kind: input.kind,
        termId: term?.id ?? null,
        startCycle: term?.startCycle ?? Math.max(1, currentCycleNumber(r.startDate, today)),
        status: 'draft',
        number: null,
        contractDate: today,
        signatoryContactId: contact?.id ?? null,
        articles: contractSettings.articles.map((article) => ({
          ...article,
          id: contractSettings.next(),
        })),
        snapshot: null,
        signed: null,
        voided: null,
        issuedAt: null,
        issuedBy: null,
        draftPdf: null,
        annexes: [],
        archived: false,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      list.push(created);
      return json(route, contractDetail(r, created), 201);
    }
    const contract = list.find((c) => c.id === childId);
    if (!contract) return fail(route, 404, null);
    if (!childPart && method === 'GET') return json(route, contractDetail(r, contract));
    if (childPart === 'pdf' && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' });
    }
    if (!manages) return fail(route, 403, null);
    contract.updatedAt = stamp();
    if (childPart === 'annexes' && annexId) {
      const annex = contract.annexes.find((a) => a.id === annexPart);
      if (!annex) return fail(route, 404, null);
      if (annexId === 'void') {
        annex.status = 'void';
        annex.voided = { at: stamp(), reason: body<{ reason: string }>().reason };
      } else if (annexId === 'signed') {
        annex.status = 'signed';
        annex.signed = {
          signedOn: body<{ signedOn: string }>().signedOn,
          fileItemId: contractSettings.next(),
        };
      }
      return json(route, annex);
    }
    const draft = contract.status === 'draft';
    if (!childPart) {
      if (!draft) return fail(route, 409, 'INVALID_TRANSITION');
      const input = body<{
        contractDate?: string;
        signatoryContactId?: string | null;
        articles?: { id?: string; title: string; body: string }[];
      }>();
      if (input.articles?.some((article) => unknownPlaceholders(article.body).length > 0)) {
        return fail(route, 400, 'UNKNOWN_PLACEHOLDER');
      }
      if (input.contractDate) contract.contractDate = input.contractDate;
      if (input.signatoryContactId !== undefined) {
        contract.signatoryContactId = input.signatoryContactId;
      }
      if (input.articles) {
        contract.articles = input.articles.map((article) => ({
          ...article,
          id: article.id ?? contractSettings.next(),
        }));
      }
      if (contract.draftPdf) contract.draftPdf.outdated = true;
      return json(route, contractDetail(r, contract));
    }
    if (childPart === 'pdf') {
      if (draft) {
        contract.draftPdf = { state: 'ready', renderedAt: stamp(), outdated: false };
      }
      return json(route, { state: 'ready' });
    }
    if (childPart === 'discard') {
      if (!draft) return fail(route, 409, 'INVALID_TRANSITION');
      contract.archived = true;
      return json(route, contractDetail(r, contract));
    }
    if (childPart === 'issue') {
      if (!draft) return fail(route, 409, 'INVALID_TRANSITION');
      if (contractDetail(r, contract).missing.some((field) => field.required)) {
        return fail(route, 409, 'CONTRACT_INCOMPLETE');
      }
      contractSettings.issued += 1;
      contract.number = formatContractNumber(
        contractSettings.settings.numberPrefix,
        2026,
        contractSettings.issued,
      );
      contract.status = 'issued';
      contract.issuedAt = stamp();
      contract.issuedBy = { id: me().user.id, name: me().user.name, imageId: null };
      contract.snapshot = contractContent(r, contract);
      return json(route, contractDetail(r, contract));
    }
    if (draft) return fail(route, 409, 'INVALID_TRANSITION');
    if (childPart === 'void') {
      contract.status = 'void';
      contract.voided = { at: stamp(), reason: body<{ reason: string }>().reason };
    } else if (childPart === 'signed') {
      contract.status = 'signed';
      contract.signed = {
        signedOn: body<{ signedOn: string }>().signedOn,
        fileItemId: contractSettings.next(),
      };
    }
    return json(route, contractDetail(r, contract));
  };

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
        renewalDate: null,
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
                status: input.startDate <= today ? 'active' : 'scheduled',
                // F05C B5: a backdated retainer's term starts at cycle 1.
                startCycle: input.catchUp?.length
                  ? 1
                  : Math.max(1, currentCycleNumber(input.startDate, today)),
                cycles: input.term.cycles,
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
      // F05C B4: the past cycles, closed as the catch-up recorded them.
      for (const entry of input.catchUp ?? []) {
        created.cycles.push({
          id: id(next++),
          number: entry.cycle,
          ...cyclePeriod(input.startDate, entry.cycle),
          status: 'closed',
          closedAt: new Date().toISOString(),
          backdated: true,
          untracked: entry.delivery === 'untracked',
          lines: live(created).map((d, index) =>
            cycleLine(next++, d, d.monthlyQuantity, entry.delivered?.[index] ?? 0, true),
          ),
        });
      }
      openCurrent(created);
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
      const { status, startNow } = body<RetainerStatusChange>();
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
        // F05C P2–P4, as `resumePlan` in the API.
        const number = currentCycleNumber(retainer.startDate, today);
        const row = retainer.cycles.find((c) => c.number === number);
        const nextStart = cyclePeriod(retainer.startDate, number + 1).periodStart;
        if (number > 0 && row?.status !== 'open') {
          if (row) {
            if (startNow) return fail(route, 409, 'CYCLE_CLOSED');
            retainer.cyclesFrom = nextStart;
          } else if (termCovers(retainer, number) || startNow) {
            openCurrent(retainer, true);
          } else {
            retainer.cyclesFrom = nextStart;
          }
        }
        retainer.endedOn = null;
      }
      if (status === 'ended') retainer.cyclesFrom = null;
      retainer.status = status;
      return json(route, detail(retainer));
    }
    if (part === 'archive' || part === 'restore') {
      retainer.archived = part === 'archive';
      return json(route, detail(retainer));
    }
    if (part === 'contracts' || (part === 'amendments' && childPart === 'annex')) {
      return contractRoutes(
        route,
        method,
        request,
        retainer,
        [childId, childPart, lineId, lineAction],
        part,
      );
    }
    if (part === 'amendments') {
      retainer.amendments ??= [];
      const list = retainer.amendments;
      const view = (a: Amendment): Amendment => {
        const named = {
          ...a,
          createdBy: a.createdBy && { ...a.createdBy, name: user(a.createdBy.id)?.name ?? '' },
        };
        if (seesMoney(retainer)) return named;
        const { money: _money, ...rest } = named;
        return { ...rest, effects: a.effects.map(({ money: _m, ...effect }) => effect) };
      };
      if (!childId && method === 'GET') {
        return json(route, {
          items: [...list].reverse().map(view),
          total: list.length,
          page: 1,
          pageSize: 100,
        });
      }
      if (!childId || childId === 'preview') {
        if (!allowed.canEditMoney) return fail(route, 403, null);
        const input = body<CreateAmendmentInput>();
        const delta = input.amountDeltaMinor ?? 0;
        const lines = input.lines ?? [];
        if (lines.length === 0 && delta === 0) return fail(route, 400, 'EMPTY_AMENDMENT');
        const charges = termChargesOf(retainer, today).filter((c) => c.status === 'pending');
        const cycles =
          input.scope === 'cycle'
            ? [input.effectiveCycle]
            : charges.map((c) => c.cycle).filter((cycle) => cycle >= input.effectiveCycle);
        const effects =
          delta === 0
            ? []
            : cycles.map((cycle) => {
                // An open-ended cycle is charged at the fee (C2).
                const before =
                  charges.find((c) => c.cycle === cycle)?.amountMinor ??
                  retainer.monthlyFeeMinor ??
                  0;
                return {
                  cycle,
                  ...cyclePeriod(retainer.startDate, cycle),
                  effect: 'charge_changed' as const,
                  invoice: null,
                  money: { beforeMinor: before, afterMinor: before + delta },
                };
              });
        const moneyDeltaMinor = delta * Math.max(cycles.length, 1);
        const needsApproval = moneyDeltaMinor < 0 && !holds('retainers.approve_reduction', 'all');
        if (childId === 'preview') {
          return json(route, { cycles: effects, moneyDeltaMinor, needsApproval });
        }
        const effectiveDate = cyclePeriod(retainer.startDate, input.effectiveCycle).periodStart;
        const applied = effectiveDate <= today;
        const created: Amendment = {
          id: id(next++),
          retainerId: retainer.id,
          number: list.length + 1,
          kind: 'change',
          scope: input.scope,
          effectiveCycle: input.effectiveCycle,
          effectiveDate,
          status: needsApproval ? 'pending_approval' : applied ? 'applied' : 'scheduled',
          reason: input.reason,
          lines: lines.map((line, index) => ({
            kind: line.kind,
            label: line.label ?? null,
            quantityDelta: line.quantityDelta,
            quantity: null,
            revisionLimit: null,
            position: index + 1,
          })),
          createdBy: { id: me().user.id, name: '', imageId: null },
          createdAt: new Date().toISOString(),
          decision: null,
          appliedAt: !needsApproval && applied ? new Date().toISOString() : null,
          effects,
          money: { amountDeltaMinor: delta, moneyDeltaMinor, schedule: null },
        };
        list.push(created);
        return json(route, view(created), 201);
      }
      const amendment = list.find((a) => a.id === childId);
      if (!amendment) return fail(route, 404, null);
      if (amendment.status !== 'pending_approval') return fail(route, 409, 'INVALID_TRANSITION');
      if (childPart === 'withdraw') {
        amendment.status = 'withdrawn';
        return json(route, view(amendment));
      }
      if (!holds('retainers.approve_reduction', 'all')) return fail(route, 403, null);
      const { note } = body<{ note?: string }>();
      const approved = childPart === 'approve';
      Object.assign(amendment, {
        status: approved
          ? amendment.effectiveDate <= today
            ? 'applied'
            : 'scheduled'
          : 'rejected',
        decision: {
          approved,
          by: { id: me().user.id, name: me().user.name, imageId: null },
          at: new Date().toISOString(),
          note: note ?? null,
        },
      });
      return json(route, view(amendment));
    }
    if (part === 'terms' && childPart === 'reschedule') {
      const term = (retainer.terms ?? []).find((t) => t.id === childId);
      if (!term) return fail(route, 404, null);
      if (!allowed.canEditMoney) return fail(route, 403, null);
      const input = body<RescheduleTerm>();
      const before = input.schedule.reduce((sum, entry) => {
        const index = entry.cycle - term.startCycle;
        return sum + (term.schedule[index] ?? 0);
      }, 0);
      const after = input.schedule.reduce((sum, entry) => sum + entry.amountMinor, 0);
      if (before !== after) return fail(route, 409, 'SCHEDULE_TOTAL_MISMATCH');
      for (const entry of input.schedule) {
        term.schedule[entry.cycle - term.startCycle] = entry.amountMinor;
      }
      retainer.amendments ??= [];
      const created: Amendment = {
        id: id(next++),
        retainerId: retainer.id,
        number: retainer.amendments.length + 1,
        kind: 'reschedule',
        scope: null,
        effectiveCycle: input.schedule[0]?.cycle ?? currentCycleNumber(retainer.startDate, today),
        effectiveDate: cyclePeriod(
          retainer.startDate,
          input.schedule[0]?.cycle ?? currentCycleNumber(retainer.startDate, today),
        ).periodStart,
        status: 'applied',
        reason: input.reason,
        lines: [],
        createdBy: { id: me().user.id, name: me().user.name, imageId: null },
        createdAt: new Date().toISOString(),
        decision: null,
        appliedAt: new Date().toISOString(),
        effects: [],
        money: { amountDeltaMinor: 0, moneyDeltaMinor: 0, schedule: input.schedule },
      };
      retainer.amendments.push(created);
      return json(route, created);
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
        if (input.schedule.length !== input.cycles || sum !== input.agreedTotalMinor) {
          return fail(route, 409, 'SCHEDULE_TOTAL_MISMATCH');
        }
        if (
          terms.some(
            (t) =>
              t.status === 'scheduled' ||
              (t.status !== 'cancelled' && termEndCycleOf(t) >= input.startCycle),
          )
        ) {
          return fail(route, 409, 'TERM_OVERLAP');
        }
        const created: TermRecord = {
          id: id(next++),
          number: terms.length + 1,
          status:
            input.startCycle <= currentCycleNumber(retainer.startDate, today)
              ? 'active'
              : 'scheduled',
          startCycle: input.startCycle,
          cycles: input.cycles,
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
        if (input.cycles !== undefined && input.cycles !== term.cycles) {
          return fail(route, 409, 'TERM_STARTED');
        }
        if (input.endAction) term.endAction = input.endAction;
        return json(route, view(term));
      }
      Object.assign(term, {
        ...(input.startCycle && { startCycle: input.startCycle }),
        ...(input.cycles && { cycles: input.cycles }),
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
          reviewer: { id: id(1), name: 'سارة الخطيب', imageId: null },
          versions: [],
          clientText: null,
          createdAt: '2026-10-07T10:00:00.000Z',
        },
        {
          id: id(1452),
          stage: 'internal',
          outcome: 'passed',
          note: null,
          reviewer: { id: id(1), name: 'سارة الخطيب', imageId: null },
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
          reviewer: { id: id(1), name: 'سارة الخطيب', imageId: null },
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
  const layan = { id: id(3), name: 'ليان الأحمد', imageId: null };
  const sara = { id: id(1), name: 'سارة الخطيب', imageId: null };
  const hala = { id: id(611), name: 'هالة الشامي', archived: false, imageId: null };
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
    reviewer: stage === 'medical' ? { id: id(8), name: 'د. هبة النجار', imageId: null } : sara,
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
  /** Approved leaves, for `ASSIGNEE_ON_LEAVE` (F17 rule B17). */
  leave?: LeaveState;
  /** F06B: parents, progress and open questions of seeded tasks. */
  links?: SubtaskLinks;
  /** F06B rule B7: the questions waiting for the signed-in user. */
  questions?: MyQuestion[];
  me: () => MeResponse;
}

/** F06B: which seeded tasks are subtasks of which, with the parents' progress and questions. */
export interface SubtaskLinks {
  parents: Record<string, string>;
  progress: Record<string, NonNullable<Task['progress']>>;
  questions: Record<string, Task['openQuestions']>;
}

/** The autumn menu as a parent of the dish shoot, with questions on both (F06B). */
export function subtaskLinksSeed(): SubtaskLinks {
  return {
    parents: { [seedIds.dishShoot]: seedIds.autumnMenu },
    progress: { [seedIds.autumnMenu]: { delivered: 1, total: 3 } },
    questions: {
      [seedIds.autumnMenu]: { total: 3, inSubtasks: 1 },
      [seedIds.dishShoot]: { total: 1, inSubtasks: 0 },
    },
  };
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
  leave = { requests: [], ledger: [] },
  links,
  questions = [],
  me,
}: TaskState) {
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const managed = () =>
    me()
      .departments.filter((d) => d.isManager)
      .map((d) => d.code);
  const user = (userId: string) => users.find((u) => u.id === userId);
  const person = (userId: string) => ({
    id: userId,
    name: user(userId)?.name ?? '',
    imageId: user(userId)?.imageId ?? null,
  });
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
      // The mocks hold no subtasks yet (F06B).
      parentReviewer: false,
      parentManager: false,
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
            subtask: false,
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
      canManageSubtasks:
        live &&
        task.status !== 'delivered' &&
        task.status !== 'cancelled' &&
        (r.manage || task.assigneeId === me().user.id),
      canReopenSubtasks: live && task.status === 'revisions' && (r.work || r.manage),
      canWriteHandover: false,
      canEditCriteria: live && r.manage,
      canTickCriteria: live && (r.work || r.manage),
      canSaveTemplate: live && r.assign,
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
            imageId: assignee.imageId,
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
        ? {
            id: task.clientId as string,
            name: clientOf(task)?.tradeName ?? '',
            imageId: clientOf(task)?.imageId ?? null,
          }
        : null,
      project: project
        ? {
            id: project.id,
            name: project.name,
            imageId: project.imageId ?? clientOf(task)?.imageId ?? null,
          }
        : null,
      milestone: milestoneRecord ? { id: milestoneRecord.id, name: milestoneRecord.name } : null,
      retainer: retainer
        ? {
            id: retainer.id,
            name: retainer.name,
            imageId: retainer.imageId ?? clientOf(task)?.imageId ?? null,
          }
        : null,
      cycle: cycle
        ? { id: cycle.id, periodStart: cycle.periodStart, periodEnd: cycle.periodEnd }
        : null,
      cycleLine: line ? { id: line.id, kind: line.kind, label: line.label } : null,
      checklist: { done: items.filter((item) => item.doneAt).length, total: items.length },
      revisions: { clientCount: clientCount(task), limit: task.revisionLimit },
      overLimitPending: task.revisions.some((r) => r.overLimit && r.decision === null),
      postId: task.postId,
      parent: (() => {
        const parent = links?.parents[task.id] ? byId(links.parents[task.id] as string) : null;
        return parent ? { id: parent.id, title: parent.title } : null;
      })(),
      progress: links?.progress[task.id] ?? null,
      openQuestions: links?.questions[task.id] ?? { total: 0, inSubtasks: 0 },
      estimateMinutes: null,
    };
  };
  const dependencyOf = (task: TaskRecord) => ({
    id: task.id,
    title: task.title,
    department: task.department,
    status: task.status,
    finished: isTaskFinished(task.status),
    archived: task.archived,
    source: 'manual' as const,
  });
  const detail = (task: TaskRecord): TaskDetail => ({
    ...summary(task),
    brief: task.brief,
    briefDoc: task.brief ? richTextFromPlain(task.brief) : null,
    briefFields: null,
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
    criteria: [],
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
    parent: links?.parents[task.id]
      ? (() => {
          const parent = byId(links.parents[task.id] as string) as TaskRecord;
          return { id: parent.id, title: parent.title, status: parent.status };
        })()
      : null,
    runMode: null,
    stages: [],
    subtasks: [],
    handoverNote: null,
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
      author: {
        ...person(comment.authorId),
        archived: author?.status === 'archived',
      },
      kind: 'comment',
      body: comment.archived ? null : comment.body,
      bodyDoc: comment.archived
        ? null
        : (richTextFromPlain(comment.body, { mentions: true }) as TaskComment['bodyDoc']),
      mentions: mentionedUserIds(comment.body).map((userId) => ({
        ...person(userId),
        archived: user(userId)?.status === 'archived',
      })),
      attachments: [],
      questionId: null,
      convertedTask: null,
      editedAt: comment.editedAt,
      removed: comment.archived,
      createdAt: comment.createdAt,
      canEdit: mine && !comment.archived,
      canRemove: (mine || holds('tasks.manage', 'all')) && !comment.archived,
      canConvert: false,
      question: null,
      replies: [],
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
    attach: taskFiles.attach,
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
          captions: snapshot.captions,
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
      client: { id: request.clientId, name: requestClient(request).tradeName, imageId: null },
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
        : sentOf(item).flatMap((version, index) => {
            const file = taskFiles.shown(version.id);
            // F08B rule A8: the slide captions of the snapshot the client is shown.
            const slideCaption =
              posts.find((p) => p.id === item.postId)?.reviews.find((r) => r.id === item.reviewId)
                ?.slideCaptions[index] ?? null;
            // Rule 27: never the internal titles of a post's files.
            return file ? [item.postId ? { ...file, name: '', slideCaption } : file] : [];
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
      (!q.get('reviewStage') || task.reviewStage === q.get('reviewStage')) &&
      (!flag('linkedToPost') || !!task.postId === (flag('linkedToPost') === 'true'))
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
        questionsWaiting: questions.length,
      };
      return json(route, summaryBody);
    }
    if (path === '/api/me/questions') {
      return json(route, {
        items: questions,
        total: questions.length,
        page: 1,
        pageSize: 50,
      });
    }
    // F06B rule C5: no warnings by default; `f06b-fixtures.ts` answers with some.
    if (path === '/api/tasks/readiness' && method === 'POST') {
      return json(route, { warnings: [] });
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
      const onLeave = created.assigneeId
        ? assigneeLeavesOn(leave, created.assigneeId, created.dueDate)
        : [];
      if (onLeave.length > 0 && !input.acceptLeave) {
        return fail(route, 409, 'ASSIGNEE_ON_LEAVE', onLeave);
      }
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
            client: { id: c.id, name: c.tradeName, imageId: null },
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
          clientImage: false,
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
            const dueThisWeek = theirs.filter(
              (t) => t.dueDate >= week.from && t.dueDate <= week.to,
            ).length;
            return {
              user: { id: u.id, name: u.name, imageId: u.imageId },
              departments: u.departments
                .map((d) => d.code)
                .filter((code) => departments.includes(code)),
              overdue: theirs.filter(overdue).length,
              dueThisWeek,
              open: theirs.length,
              // The mocks have no estimates: two hours each. Six days of eight hours, but Layan
              // is mostly on leave (over capacity) and Karim has no schedule (edge case 21).
              estimatedMinutes: dueThisWeek * DEFAULT_ESTIMATE_MINUTES,
              unestimatedCount: dueThisWeek,
              capacityMinutes: u.id === id(4) ? null : u.id === id(3) ? 60 : 2880,
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
      const {
        requestedByContactId,
        requestedOn,
        requestScope,
        retainerCycleId,
        acceptLeave,
        ...fields
      } = input;
      // F17 rule B17: a new assignee or due date on the assignee's approved leave.
      const assigneeId = input.assigneeId !== undefined ? input.assigneeId : task.assigneeId;
      const dueDate = input.dueDate ?? task.dueDate;
      const moved = assigneeId !== task.assigneeId || dueDate !== task.dueDate;
      const onLeave = assigneeId && moved ? assigneeLeavesOn(leave, assigneeId, dueDate) : [];
      if (onLeave.length > 0 && !acceptLeave) {
        return fail(route, 409, 'ASSIGNEE_ON_LEAVE', onLeave);
      }
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
          body: richTextPlain(body<TaskCommentInput>().bodyDoc),
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
      comment.body = richTextPlain(body<TaskCommentInput>().bodyDoc);
      comment.editedAt = TASKS_NOW.toISOString();
      return json(route, commentOf(task, comment));
    }
    return undefined;
  };
  // The dashboard mock (F15) lists tasks as the task list does.
  return Object.assign(handle, { summary, overdue });
}

// Content (F08)

/**
 * F08B: a mock post's caption per group of its platforms. Posts seeded before F08B keep one
 * caption under their first group; posts made in the wizard or edited carry `captions`.
 */
const mockCaptions = (
  post: Pick<PostRecord, 'platforms' | 'caption' | 'hashtags' | 'captions'>,
): PostCaption[] =>
  captionGroupsOf(post.platforms).map((group, index) => {
    const own = post.captions?.find((caption) => caption.group === group);
    if (post.captions) return own ?? { group, caption: null, hashtags: null, title: null };
    return {
      group,
      caption: index === 0 ? post.caption : null,
      hashtags: index === 0 ? post.hashtags : null,
      title: null,
    };
  });

interface PostRecord {
  id: string;
  clientId: string;
  title: string;
  type: PostType;
  platforms: PostPlatform[];
  caption: string | null;
  hashtags: string | null;
  /** F08B: every group's text, kept while a platform is away; unset on posts seeded before. */
  captions?: PostCaption[];
  /** F08B rule A6: the slide order and captions; media it does not list follow. */
  layout?: { fileItemId: string; caption: string | null }[];
  pillarId?: string | null;
  occasionId?: string | null;
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
  const layan = { id: id(3), name: 'ليان الأحمد', imageId: null };
  const sara = { id: id(1), name: 'سارة الخطيب', imageId: null };
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
    captions: [{ group: 'facebook_instagram', caption, hashtags: '#مطعم_الياسمين', title: null }],
    slideCaptions: versions.map(() => null),
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
            captions: [
              {
                group: 'facebook_instagram',
                caption: sweetsCaption,
                hashtags: '#مطعم_الياسمين #حلويات',
                title: null,
              },
            ],
            slideCaptions: ['الكنافة النابلسية بالقشطة', null],
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
  /** Turns held uploads into files of an owner, returning their ids (F08B rule B2). */
  attach: (
    owner: { type: FileOwnerType; id: string },
    held: readonly { uploadId: string; name?: string }[],
  ) => string[];
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
  attach,
  approval,
}: ContentState) {
  let next = 1700;
  const now = () => TASKS_NOW.toISOString();
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
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
  /** Rule 5's media in the layout's order (F08B rule A6), each with its slide caption. */
  const mediaOf = (post: PostRecord) => {
    const all = media(
      post.id,
      linked(post).map((t) => t.id),
    );
    const listed = (post.layout ?? []).flatMap((entry) => {
      const found = all.find((m) => m.fileItemId === entry.fileItemId);
      return found ? [{ ...found, slideCaption: entry.caption }] : [];
    });
    return [...listed, ...all.filter((m) => !listed.some((l) => l.id === m.id))];
  };
  // F08B planning data: the agency's pillars, snippets, an occasion and an idea of Jasmine.
  const pillars: ContentPillar[] = [
    { id: id(1781), name: 'توعية', color: 'chart_1', position: 1, archived: false },
    { id: id(1782), name: 'ترويج', color: 'chart_2', position: 2, archived: false },
    { id: id(1783), name: 'ترفيه', color: 'chart_3', position: 3, archived: false },
    { id: id(1784), name: 'خلف الكواليس', color: 'chart_4', position: 4, archived: false },
  ];
  const jasmineRef = { id: id(601), name: 'مطعم الياسمين', imageId: null };
  const snippets: ContentSnippet[] = [
    {
      id: id(1791),
      client: jasmineRef,
      kind: 'hashtags',
      name: 'وسوم الياسمين',
      body: '#مطعم_الياسمين #دمشق #فطور_شامي',
      canEdit: true,
    },
    {
      id: id(1792),
      client: null,
      kind: 'caption',
      name: 'دعوة للحجز',
      body: 'احجزوا طاولتكم الآن عبر الرابط في الحساب.',
      canEdit: false,
    },
  ];
  const foodDay: ContentOccasion = {
    id: id(1795),
    name: 'يوم الغذاء العالمي',
    category: 'food',
    calendar: 'gregorian',
    month: 10,
    day: 16,
    date: null,
    durationDays: 1,
    leadDays: 7,
    client: null,
    archived: false,
    occurrences: [{ year: 2026, startDate: '2026-10-16', endDate: '2026-10-16', confirmed: false }],
  };
  const ramadan: ContentOccasion = {
    id: id(1796),
    name: 'رمضان',
    category: 'general',
    calendar: 'hijri',
    month: 9,
    day: 1,
    date: null,
    durationDays: 30,
    leadDays: 14,
    client: null,
    archived: false,
    occurrences: [{ year: 2027, startDate: '2027-02-08', endDate: '2027-03-09', confirmed: false }],
  };
  const occasions: ContentOccasion[] = [foodDay, ramadan];
  // PR 4: Jasmine's open cycle commits 8 posts and 2 reels this month (rule C9).
  const jasmineCycle = {
    cycleId: id(1798),
    retainer: { id: id(1799), name: 'باقة الياسمين الشهرية' },
    from: '2026-10-01',
    to: '2026-10-31',
    lines: [
      { kind: 'post', count: 8 },
      { kind: 'reel', count: 2 },
    ],
  };
  const ideas: ContentIdea[] = [
    {
      id: id(1797),
      text: 'فطور الجمعة العائلي بصور من المطبخ',
      client: jasmineRef,
      pillar: pillars[3] ?? null,
      occasion: null,
      status: 'open',
      post: null,
      dropReason: null,
      createdBy: { id: id(1), name: 'سارة الخطيب', imageId: null },
      createdAt: '2026-10-07T09:00:00.000Z',
      permissions: { canEdit: true, canDrop: true, canRestore: false, canUse: true },
    },
  ];
  const defaultSettings = (clientId: string): ClientContentSettings => ({
    clientId,
    saved: clientId === id(601),
    postingTimes:
      clientId === id(601)
        ? [{ platform: 'instagram', weekdays: [0, 1, 2, 3, 4, 6], from: '13:00', to: '15:00' }]
        : [],
    pillarTargets: [],
    maxGapDays: 3,
    occasionCategories: ['general', 'food'],
    excludedOccasionIds: [],
    xLongPosts: false,
    skippedOccasions: [],
    effectivePostingTimes: [],
  });
  // PR 4: client settings saved from the dialog replace the defaults above.
  const savedSettings = new Map<string, ClientContentSettings>();
  const clientSettings = (clientId: string) =>
    savedSettings.get(clientId) ?? defaultSettings(clientId);
  const agencyTimes: ClientContentSettings['postingTimes'] = [
    { platform: 'instagram', weekdays: [0, 1, 2, 3, 4, 6], from: '19:00', to: '22:00' },
    { platform: 'facebook', weekdays: [0, 1, 2, 3, 4, 6], from: '19:00', to: '22:00' },
    { platform: 'x', weekdays: [0, 1, 2, 3, 4], from: '09:00', to: '11:00' },
  ];
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
    client: { id: post.clientId, name: clientOf(post)?.tradeName ?? '', imageId: null },
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
    pillar: pillars.find((pillar) => pillar.id === post.pillarId) ?? null,
    occasionId: post.occasionId ?? null,
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
        imageId: null,
        healthcare: clientOf(post)?.isHealthcare ?? false,
      },
      responsible: { ...archivable(post.responsibleId), inScope: true, imageId: null },
      occasion:
        post.occasionId === foodDay.id
          ? { id: foodDay.id, name: foodDay.name, archived: false }
          : null,
      caption: post.caption,
      hashtags: post.hashtags,
      captions: mockCaptions(post),
      notes: post.notes,
      needsClientApproval: post.needsClientApproval,
      media: mediaOf(post).map(({ taskId, ...version }) => {
        const task = tasks.find((t) => t.id === taskId);
        return { ...version, task: task ? { id: task.id, title: task.title } : null };
      }),
      checks: postChecks(
        { type: post.type, platforms: post.platforms, captions: mockCaptions(post) },
        mediaOf(post),
        { xLongPosts: false },
      ),
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
        canDownloadPack: live && r.edit && hasPostPack(post.status),
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
      captions: passed ? mockCaptions(post) : [],
      slideCaptions: passed ? mediaOf(post).map((m) => m.slideCaption) : [],
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
      (!q.get('pillarId') || post.pillarId === q.get('pillarId')) &&
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
    // F08B: the user's open posts not yet approved, due within two days (two work days here).
    at_risk: (post) =>
      post.responsibleId === me().user.id &&
      ['idea', 'in_production', 'internal_review', 'awaiting_client'].includes(post.status) &&
      post.publishDate >= PROJECTS_TODAY &&
      post.publishDate <= addDays(PROJECTS_TODAY, 2),
  };
  const live = () => posts.filter((post) => !post.archived && !clientOf(post)?.archived);

  // F08B planning (PR 4): the calendar's occasions and marks, the planning check and the grid,
  // computed with the contracts' own rules over the fixture posts.
  const occurrencesOf = (occasion: CreateContentOccasion) =>
    occasionDates(occasion, PROJECTS_TODAY, addDays(PROJECTS_TODAY, 399)).map((occurrence) => ({
      year: occurrence.year,
      startDate: occurrence.start,
      endDate: occurrence.end,
      confirmed: false,
    }));
  const coveredBy = (clientId: string, occasionId: string, year: number) =>
    live().some(
      (post) =>
        post.clientId === clientId &&
        post.status !== 'cancelled' &&
        !!post.occasionId &&
        occasionYearKey(post.occasionId, post.publishDate) === occasionYearKey(occasionId, year),
    );
  const calendarOccasions = (from: string, to: string, clientId: string | null) =>
    occasions
      .filter((occasion) => !occasion.archived)
      .flatMap((occasion) => {
        const settings = clientId ? clientSettings(clientId) : null;
        if (
          clientId &&
          settings &&
          !occasionApplies(
            { id: occasion.id, clientId: occasion.client?.id ?? null, category: occasion.category },
            { id: clientId, ...settings },
          )
        ) {
          return [];
        }
        return occasion.occurrences
          .filter((occurrence) => occurrence.startDate <= to && occurrence.endDate >= from)
          .map(
            (occurrence): CalendarOccasion => ({
              id: occasion.id,
              name: occasion.name,
              category: occasion.category,
              clientId: occasion.client?.id ?? null,
              startDate: occurrence.startDate,
              endDate: occurrence.endDate,
              leadDays: occasion.leadDays,
              confirmed: occurrence.confirmed,
              covered: clientId ? coveredBy(clientId, occasion.id, occurrence.year) : null,
              skipped: settings
                ? settings.skippedOccasions.some(
                    (skip) => skip.occasionId === occasion.id && skip.year === occurrence.year,
                  )
                : null,
            }),
          );
      });
  // Jasmine has an open cycle with posts; other clients join once their settings are saved.
  const planningClients = (clientId: string | null) => {
    const all = [...new Set([id(601), ...savedSettings.keys()])];
    return clientId ? all.filter((candidate) => candidate === clientId) : all;
  };
  const planningOf = (clientId: string, from: string, to: string): ClientPlanning => {
    const settings = clientSettings(clientId);
    const planned: PlannedPost[] = live()
      .filter((post) => post.clientId === clientId && post.status !== 'cancelled')
      .map((post) => ({
        id: post.id,
        type: post.type,
        platforms: post.platforms,
        publishDate: post.publishDate,
        publishTime: post.publishTime,
        pillarId: post.pillarId ?? null,
        occasionId: post.occasionId ?? null,
      }));
    const pillarIds = pillars.filter((pillar) => !pillar.archived).map((pillar) => pillar.id);
    const cycles = clientId === id(601) ? [jasmineCycle] : [];
    const monthPosts = planned.filter(
      (post) => post.publishDate >= monthStart(from) && post.publishDate <= monthEnd(from),
    );
    const client = clients.find((c) => c.id === clientId);
    return {
      client: { id: clientId, name: client?.tradeName ?? '', imageId: null },
      issues: planningIssues({
        from,
        to,
        maxGapDays: settings.maxGapDays,
        posts: planned,
        occasions: calendarOccasions(from, addDays(to, 30), clientId).map((occasion) => ({
          id: occasion.id,
          start: occasion.startDate,
          end: occasion.endDate,
          leadDays: occasion.leadDays,
          skipped: occasion.skipped === true,
        })),
        commitments: cycles,
        pillarTargets: settings.pillarTargets,
        pillarIds,
      }),
      pillarBalance: {
        month: from.slice(0, 7),
        posts: monthPosts.length,
        items: pillarBalance(monthPosts, settings.pillarTargets, pillarIds),
      },
      commitments: cycles
        .filter((cycle) => cycle.from <= to && cycle.to >= from)
        .flatMap((cycle) =>
          commitmentsOf(cycle, planned).map((line) => ({
            cycleId: cycle.cycleId,
            retainer: cycle.retainer,
            from: cycle.from,
            to: cycle.to,
            ...line,
          })),
        ),
    };
  };

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
        atRisk: count('at_risk'),
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
        // F08B overlays: the occasions on the range's days and the planning check's marks.
        occasions: calendarOccasions(from, to, q.get('clientId')),
        issues: planningClients(q.get('clientId')).flatMap((clientId) =>
          planningOf(clientId, from, to).issues.map(
            (issue): CalendarIssue => ({ ...issue, clientId }),
          ),
        ),
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
    // F08B planning data, read by the wizard and the caption editor.
    if (path === '/api/content/pillars' && method === 'GET') return json(route, { items: pillars });
    if (path === '/api/content/settings' && method === 'GET') {
      return json(route, { postingTimes: agencyTimes });
    }
    const settingsMatch = path.match(/^\/api\/content\/clients\/([^/]+)\/settings$/);
    if (settingsMatch && method === 'GET') {
      return json(route, clientSettings(settingsMatch[1] ?? ''));
    }
    if (path === '/api/content/snippets' && method === 'GET') {
      const clientId = q.get('clientId');
      const kind = q.get('kind');
      return json(route, {
        items: snippets.filter(
          (snippet) =>
            (!snippet.client || snippet.client.id === clientId) && (!kind || snippet.kind === kind),
        ),
      });
    }
    if (path === '/api/content/occasions' && method === 'GET') {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      const withArchived = q.get('includeArchived') === 'true';
      const items = occasions
        .filter((occasion) => withArchived || !occasion.archived)
        .map((occasion) => ({
          ...occasion,
          occurrences: occasion.occurrences.filter((o) => o.startDate <= to && o.endDate >= from),
        }))
        .filter((occasion) => occasion.occurrences.length > 0)
        .sort((a, b) =>
          (a.occurrences[0]?.startDate ?? '').localeCompare(b.occurrences[0]?.startDate ?? ''),
        );
      return json(route, { items });
    }
    if (path === '/api/content/ideas' && method === 'GET') {
      const status = q.get('status') ?? 'open';
      const clientId = q.get('clientId');
      const items = ideas.filter(
        (idea) => idea.status === status && (!clientId || idea.client?.id === clientId),
      );
      return json(route, { items, total: items.length, page: 1, pageSize: 25 });
    }
    if (path === '/api/content/planning' && method === 'GET') {
      const from = q.get('from') ?? '';
      const to = q.get('to') ?? '';
      const planning: ContentPlanning = {
        from,
        to,
        clients: planningClients(q.get('clientId')).map((clientId) =>
          planningOf(clientId, from, to),
        ),
      };
      return json(route, planning);
    }
    if (path === '/api/content/grid' && method === 'GET') {
      const clientId = q.get('clientId') ?? '';
      const month = q.get('month') ?? '';
      const client = clients.find((c) => c.id === clientId);
      if (!client) return fail(route, 404, null);
      const start = monthStart(addDays(monthStart(addDays(`${month}-01`, -1)), -1));
      const grid: ContentGrid = {
        client: { id: client.id, name: client.tradeName, imageId: null },
        month,
        tiles: live()
          .filter(
            (post) =>
              post.clientId === clientId &&
              post.status !== 'cancelled' &&
              post.platforms.includes('instagram') &&
              post.type !== 'story' &&
              post.publishDate >= start &&
              post.publishDate <= monthEnd(`${month}-01`),
          )
          .sort((a, b) => byPublish(b, a))
          .map((post) => ({
            postId: post.id,
            title: post.title,
            type: post.type,
            status: post.status,
            publishDate: post.publishDate,
            publishTime: post.publishTime,
            thumbnailVersionId: summary(post).thumbnailVersionId,
          })),
      };
      return json(route, grid);
    }
    // F08B settings: pillars, best times, client settings, occasions, snippets (PR 4).
    if (path === '/api/content/pillars' && method === 'POST') {
      const input = body<CreateContentPillar>();
      const pillar: ContentPillar = {
        id: id(next++),
        ...input,
        position: pillars.filter((item) => !item.archived).length + 1,
        archived: false,
      };
      pillars.push(pillar);
      return json(route, pillar, 201);
    }
    if (path === '/api/content/pillars/order' && method === 'PUT') {
      const { ids } = body<{ ids: string[] }>();
      ids.forEach((pillarId, index) => {
        const pillar = pillars.find((item) => item.id === pillarId);
        if (pillar) pillar.position = index + 1;
      });
      pillars.sort((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position);
      return json(route, { items: pillars });
    }
    const pillarMatch = path.match(/^\/api\/content\/pillars\/([^/]+)(?:\/(archive|restore))?$/);
    if (pillarMatch) {
      const pillar = pillars.find((item) => item.id === pillarMatch[1]);
      if (!pillar) return fail(route, 404, null);
      if (pillarMatch[2]) pillar.archived = pillarMatch[2] === 'archive';
      else Object.assign(pillar, body<UpdateContentPillar>());
      pillars.sort((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position);
      return json(route, pillar);
    }
    if (path === '/api/content/settings' && method === 'PUT') {
      agencyTimes.splice(
        0,
        agencyTimes.length,
        ...body<{ postingTimes: typeof agencyTimes }>().postingTimes,
      );
      return json(route, { postingTimes: agencyTimes });
    }
    if (settingsMatch && method === 'PUT') {
      const clientId = settingsMatch[1] ?? '';
      const input = body<UpdateClientContentSettings>();
      const total = input.pillarTargets.reduce((sum, target) => sum + target.percent, 0);
      if (input.pillarTargets.length > 0 && total !== 100) {
        return fail(route, 400, 'INVALID_TARGETS');
      }
      const saved: ClientContentSettings = {
        ...clientSettings(clientId),
        ...input,
        occasionCategories: [...new Set(['general' as const, ...input.occasionCategories])],
        saved: true,
      };
      savedSettings.set(clientId, saved);
      return json(route, saved);
    }
    const skipMatch = path.match(
      /^\/api\/content\/clients\/([^/]+)\/occasion-skips(?:\/([^/]+)\/(\d+))?$/,
    );
    if (skipMatch) {
      const clientId = skipMatch[1] ?? '';
      const settings = { ...clientSettings(clientId), saved: true };
      settings.skippedOccasions =
        method === 'POST'
          ? [...settings.skippedOccasions, body<{ occasionId: string; year: number }>()]
          : settings.skippedOccasions.filter(
              (skip) => !(skip.occasionId === skipMatch[2] && skip.year === Number(skipMatch[3])),
            );
      savedSettings.set(clientId, settings);
      return json(route, settings);
    }
    if (path === '/api/content/occasions' && method === 'POST') {
      const input = body<CreateContentOccasion>();
      const { clientId, ...fields } = input;
      const client = clients.find((c) => c.id === clientId);
      const occasion: ContentOccasion = {
        id: id(next++),
        ...fields,
        client: client ? { id: client.id, name: client.tradeName, imageId: null } : null,
        archived: false,
        occurrences: occurrencesOf(input),
      };
      occasions.push(occasion);
      return json(route, occasion, 201);
    }
    const occasionMatch = path.match(
      /^\/api\/content\/occasions\/([^/]+)(?:\/(archive|restore)|\/dates\/(\d+))?$/,
    );
    if (occasionMatch && method !== 'GET') {
      const occasion = occasions.find((item) => item.id === occasionMatch[1]);
      if (!occasion) return fail(route, 404, null);
      if (occasionMatch[2]) {
        occasion.archived = occasionMatch[2] === 'archive';
      } else if (occasionMatch[3]) {
        const year = Number(occasionMatch[3]);
        const confirmed = method === 'PUT' ? body<{ startDate: string }>().startDate : null;
        occasion.occurrences = occasion.occurrences.map((occurrence) =>
          occurrence.year !== year
            ? occurrence
            : confirmed
              ? {
                  year,
                  startDate: confirmed,
                  endDate: addDays(confirmed, occasion.durationDays - 1),
                  confirmed: true,
                }
              : (occurrencesOf({ ...occasion, clientId: null })[0] ?? occurrence),
        );
      } else {
        Object.assign(occasion, body<UpdateContentOccasion>());
      }
      return json(route, occasion);
    }
    if (path === '/api/content/snippets' && method === 'POST') {
      const input = body<CreateContentSnippet>();
      const client = clients.find((c) => c.id === input.clientId);
      const snippet: ContentSnippet = {
        id: id(next++),
        client: client ? { id: client.id, name: client.tradeName, imageId: null } : null,
        kind: input.kind,
        name: input.name,
        body: input.body,
        canEdit: true,
      };
      snippets.push(snippet);
      return json(route, snippet, 201);
    }
    const snippetMatch = path.match(/^\/api\/content\/snippets\/([^/]+)(\/archive)?$/);
    if (snippetMatch) {
      const index = snippets.findIndex((item) => item.id === snippetMatch[1]);
      const snippet = snippets[index];
      if (!snippet) return fail(route, 404, null);
      if (snippetMatch[2]) snippets.splice(index, 1);
      else Object.assign(snippet, body<UpdateContentSnippet>());
      return json(route, snippet);
    }
    if (path === '/api/content/ideas' && method === 'POST') {
      const input = body<CreateContentIdea>();
      const client = clients.find((c) => c.id === input.clientId);
      const idea: ContentIdea = {
        id: id(next++),
        text: input.text,
        client: client ? { id: client.id, name: client.tradeName, imageId: null } : null,
        pillar: pillars.find((pillar) => pillar.id === input.pillarId) ?? null,
        occasion: null,
        status: 'open',
        post: null,
        dropReason: null,
        createdBy: { id: me().user.id, name: me().user.name, imageId: null },
        createdAt: `${PROJECTS_TODAY}T09:00:00.000Z`,
        permissions: { canEdit: true, canDrop: true, canRestore: false, canUse: true },
      };
      ideas.unshift(idea);
      return json(route, idea, 201);
    }
    const ideaMatch = path.match(/^\/api\/content\/ideas\/([^/]+)(?:\/(drop|restore))?$/);
    if (ideaMatch) {
      const idea = ideas.find((item) => item.id === ideaMatch[1]);
      if (!idea) return fail(route, 404, null);
      if (ideaMatch[2] === 'drop') {
        Object.assign(idea, {
          status: 'dropped',
          dropReason: body<{ reason?: string }>().reason ?? null,
          permissions: { canEdit: false, canDrop: false, canRestore: true, canUse: false },
        });
      } else if (ideaMatch[2] === 'restore') {
        Object.assign(idea, {
          status: 'open',
          dropReason: null,
          permissions: { canEdit: true, canDrop: true, canRestore: false, canUse: true },
        });
      } else {
        const input = body<UpdateContentIdea>();
        if (input.text) idea.text = input.text;
      }
      return json(route, idea);
    }
    if (path === '/api/content/posts' && method === 'POST') {
      const input = body<CreatePost>();
      const client = clients.find((c) => c.id === input.clientId);
      if (!client) return fail(route, 404, null);
      const [first] = input.captions ?? [];
      const post = postRecord(next++, {
        clientId: input.clientId,
        title: input.title,
        type: input.type,
        platforms: input.platforms,
        caption: first?.caption ?? null,
        hashtags: first?.hashtags ?? null,
        captions: input.captions ?? [],
        notes: input.notes ?? null,
        publishDate: input.publishDate,
        publishTime: input.publishTime ?? null,
        needsClientApproval: input.needsClientApproval,
        responsibleId: input.responsibleId ?? me().user.id,
        cycleLineId: input.cycleLineId,
        pillarId: input.pillarId ?? null,
        occasionId: input.occasionId ?? null,
        createdById: me().user.id,
        createdAt: now(),
      });
      if (!rights(post).edit) return fail(route, 403, null);
      if (client.status === 'ended') return fail(route, 409, 'CLIENT_ENDED');
      if (post.publishDate < PROJECTS_TODAY) return fail(route, 400, 'INVALID_DATES');
      const idea = ideas.find((item) => item.id === input.ideaId);
      if (input.ideaId && idea?.status !== 'open') {
        return fail(route, 409, 'IDEA_USED', { part: 'idea' });
      }
      posts.push(post);
      // Rule B2: the held files are the first slides, in order, with their captions.
      const fileIds = attach({ type: 'post', id: post.id }, input.files ?? []);
      post.layout = fileIds.map((fileItemId, index) => ({
        fileItemId,
        caption: input.files?.[index]?.slideCaption ?? null,
      }));
      for (const taskId of input.linkTaskIds ?? []) {
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          task.postId = post.id;
          task.needsClientApproval = false;
        }
      }
      for (const task of input.tasks ?? []) {
        tasks.push(
          taskRecord(next++, {
            title: task.title,
            department: task.department,
            assigneeId: task.assigneeId ?? null,
            dueDate: task.dueDate,
            clientId: post.clientId,
            createdById: me().user.id,
            createdAt: now(),
            postId: post.id,
          }),
        );
      }
      if (linked(post).length > 0) post.status = 'in_production';
      if (idea) Object.assign(idea, { status: 'used', post: { id: post.id, title: post.title } });
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
      const { captions, ...input } = body<UpdatePost>();
      const content = captions !== undefined || input.type;
      if (content && !isPostContentEditable(post.status)) return fail(route, 409, 'POST_LOCKED');
      if (input.cycleLineId && linked(post).some((t) => t.cycleLineId)) {
        return fail(route, 409, 'POST_COUNTED_BY_TASK');
      }
      Object.assign(post, input);
      if (captions) {
        // F08B rule A1: the groups sent are written, the others kept.
        const others = (post.captions ?? mockCaptions(post)).filter(
          (c) => !captions.some((n) => n.group === c.group),
        );
        post.captions = [...captions, ...others];
        const [first] = mockCaptions(post);
        Object.assign(post, { caption: first?.caption ?? null, hashtags: first?.hashtags ?? null });
      }
      return json(route, detail(post));
    }
    if (action === 'layout' && method === 'PUT') {
      if (!r.edit) return fail(route, 403, null);
      if (!isPostContentEditable(post.status)) return fail(route, 409, 'POST_LOCKED');
      post.layout = body<UpdatePostLayout>().items;
      return json(route, detail(post));
    }
    if (action === 'move-preview' || action === 'move') {
      if (!r.edit) return fail(route, 403, null);
      const publishDate =
        action === 'move' ? body<MovePost>().publishDate : (q.get('publishDate') ?? '');
      if (publishDate < PROJECTS_TODAY) return fail(route, 400, 'INVALID_DATES');
      const workDays = moveWorkDays(post.publishDate, publishDate);
      const open = linked(post).filter(
        (t) => !['approved', 'delivered', 'cancelled'].includes(t.status),
      );
      const shifted = open.map((t) => ({
        task: t,
        ...shiftDueDate(t.dueDate, workDays, PROJECTS_TODAY),
      }));
      if (action === 'move-preview') {
        const preview: PostMovePreview = {
          workDays,
          tasks: shifted.map(({ task, date, clamped }) => ({
            id: task.id,
            title: task.title,
            parentId: null,
            dueDate: task.dueDate,
            newDueDate: date,
            clamped,
          })),
          suggestShift: open.some((t) => t.dueDate > publishDate),
        };
        return json(route, preview);
      }
      const input = body<MovePost>();
      if (post.status === 'published' || post.status === 'cancelled') {
        return fail(route, 409, 'POST_LOCKED');
      }
      post.publishDate = publishDate;
      if (input.shiftTasks) for (const { task, date } of shifted) task.dueDate = date;
      const moved: MovedPost = {
        ...detail(post),
        shiftedTaskIds: input.shiftTasks ? shifted.map(({ task }) => task.id) : [],
      };
      return json(route, moved);
    }
    if (action === 'pack' && method === 'GET') {
      if (!hasPostPack(post.status)) return fail(route, 409, 'INVALID_TRANSITION');
      return route.fulfill({ status: 200, contentType: 'application/zip', body: 'PK' });
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
  /** `task` templates (F06B part D). */
  runMode?: TemplateDetail['runMode'];
  savedFrom?: TemplateDetail['savedFrom'];
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

type Uploader = { id: string; name: string; imageId: string | null };

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
  durationMs: null,
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
  const layan = { id: id(3), name: 'ليان الأحمد', imageId: null };
  const sara = { id: id(1), name: 'سارة الخطيب', imageId: null };
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
        { id: id(5), name: 'نور السيد', imageId: null },
        '2026-10-09T08:00:00.000Z',
        { note: 'صورة أوضح للفرشاة.' },
      ),
      uploadVersion(
        1381,
        1,
        png('dental-post.png', 1_258_291),
        { id: id(5), name: 'نور السيد', imageId: null },
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
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
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
    if (type === 'retainer_contract') {
      // F05C: a contract's PDF and signed copies are read-only through the file endpoints.
      const retainer = retainers.find((r) => r.contracts?.some((c) => c.id === ownerId));
      if (!retainer) return undefined;
      return {
        clientId: retainer.clientId,
        label: retainer.name,
        addDeliverable: false,
        manage: false,
        manageDocuments: false,
        confidentialReader: reader(retainer.clientId),
        scopeAll: false,
        writable: false,
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
    /** F08B rule B2: the wizard's held uploads become the post's files, in order. */
    attach: (
      owner: { type: FileOwnerType; id: string },
      held: readonly { uploadId: string; name?: string }[],
    ): string[] =>
      held.flatMap((item) => {
        const version = versionFrom({ uploadId: item.uploadId }, 1, null);
        if (!version) return [];
        const record: FileRecord = {
          id: id(next++),
          ownerType: owner.type,
          ownerId: owner.id,
          role: 'deliverable',
          name: item.name ?? version.originalName ?? 'File',
          brandKind: null,
          confidential: false,
          createdById: me().user.id,
          createdAt: now(),
          archivedAt: null,
          versions: [version],
        };
        files.push(record);
        return [record.id];
      }),
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
        // F08B: no layout in the mocks yet: rule 5's order, without slide captions.
        slideCaption: null,
        width: v.width,
        height: v.height,
        durationMs: v.durationMs,
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
        slideCaption: null,
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
    parentStepId: null,
    briefDoc: null,
    briefFields: null,
    estimateMinutes: null,
    criteria: [],
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
      // F06B part D: a task template saved from the autumn menu, by stages.
      id: id(2400),
      name: 'حملة سوشيال على مراحل',
      kind: 'task',
      description: 'نصوص، ثم تصميم وريل معًا.',
      runMode: 'stages',
      savedFrom: { id: id(1001), title: 'تصاميم منيو الخريف' },
      stages: [stage(2401, 'النصوص', 1), stage(2402, 'التصميم', 2)],
      steps: templateSteps(2410, [
        {
          title: 'حملة الشتاء',
          department: 'marketing',
          dueDay: 8,
          estimateMinutes: 240,
          criteria: ['الشعار في كل تصميم'],
          briefFields: { goal: 'زيادة الحجوزات في الشتاء' },
        },
        {
          title: 'نصوص الحملة',
          department: 'content_management',
          dueDay: 3,
          stageId: id(2401),
          estimateMinutes: 180,
        },
        {
          title: 'تصاميم الحملة',
          department: 'design',
          dueDay: 6,
          stageId: id(2402),
          estimateMinutes: 360,
          briefFields: { sizes: ['1080 × 1350'] },
        },
        { title: 'ريل الحملة', department: 'photography', dueDay: 7, stageId: id(2402) },
      ]).map((step, index) => (index === 0 ? step : { ...step, parentStepId: id(2410) })),
      assignees: [{ department: 'design', userId: id(3) }],
      linkedRetainerIds: [],
      archived: false,
      updatedAt: '2026-10-08T09:00:00.000Z',
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
        user: {
          id: userId,
          name: user?.name ?? '',
          archived: user?.status === 'archived',
          imageId: null,
        },
        valid: isMember(userId, department),
      };
    });
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      description: t.description,
      runMode: t.runMode ?? null,
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
          imageId: null,
          client: {
            id: r.clientId,
            name: clients.find((c) => c.id === r.clientId)?.tradeName ?? '',
            imageId: null,
          },
        })),
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: t.updatedAt,
      archivedAt: t.archived ? '2026-09-15T08:00:00.000Z' : null,
      savedFrom: t.savedFrom ?? null,
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
    t.runMode = doc.runMode;
    t.stages = doc.stages.map((s, i) => ({ id: idOf(s.key), name: s.name, position: i + 1 }));
    t.steps = doc.steps.map(({ key, stageKey, parentKey, dependsOn, ...step }, i) => ({
      ...step,
      id: idOf(key),
      stageId: stageKey ? idOf(stageKey) : null,
      parentStepId: parentKey ? idOf(parentKey) : null,
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
    // F06B rule D2: a task template as the wizard's draft, in work days from the start date.
    const draft = path.match(/^\/api\/templates\/([^/]+)\/task-draft$/);
    if (draft && method === 'POST') {
      const t = templates.find((item) => item.id === draft[1] && !item.archived);
      if (!t) return fail(route, 404, null);
      if (t.kind !== 'task') return fail(route, 409, 'TEMPLATE_KIND_MISMATCH');
      const start = (request.postDataJSON() as { startDate?: string }).startDate ?? PROJECTS_TODAY;
      const [root, ...subs] = t.steps;
      if (!root) return fail(route, 404, null);
      const assigneeOf = (department: DepartmentCode) => {
        const userId = t.assignees.find((a) => a.department === department)?.userId ?? null;
        return userId && isMember(userId, department) ? userId : null;
      };
      const item = (step: TemplateStep) => ({
        title: step.title,
        brief: step.brief,
        briefDoc: step.briefDoc,
        briefFields: step.briefFields,
        department: step.department,
        assigneeId: assigneeOf(step.department),
        dueDate: nthWorkDay(start, step.dueDay ?? 1),
        priority: step.priority,
        estimateMinutes: step.estimateMinutes,
        checklist: step.checklist,
        criteria: step.criteria,
      });
      const body: TaskTemplateDraft = {
        ...item(root),
        templateId: t.id,
        needsClientApproval: root.needsClientApproval,
        revisionLimit: root.revisionLimit,
        runMode: t.runMode ?? null,
        stages: t.stages.map((stage) => ({ name: stage.name })),
        subtasks: subs.map((step) => ({
          ...item(step),
          stageIndex:
            t.runMode === 'stages'
              ? t.stages.findIndex((stage) => stage.id === step.stageId)
              : null,
        })),
      };
      return json(route, body);
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
  const person = (userId: string) => ({
    id: userId,
    name: user(userId)?.name ?? '',
    imageId: user(userId)?.imageId ?? null,
  });
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
            number: found.cycle.number,
            periodStart: found.cycle.periodStart,
            periodEnd: found.cycle.periodEnd,
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
            number: cycle.number,
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

/** The fields `notificationFor` fills in when a fixture leaves them out. */
type NotificationDefaults =
  | 'id'
  | 'count'
  | 'read'
  | 'createdAt'
  | 'updatedAt'
  | 'priority'
  | 'box'
  | 'inbox'
  | 'resolution'
  | 'snoozedUntil';

/** A notification for a test user, typed by the contract. */
export function notificationFor(
  recipient: MeResponse,
  n: number,
  notification: Omit<Notification, NotificationDefaults> &
    Partial<Pick<Notification, NotificationDefaults>>,
): NotificationRecord {
  const at = notification.updatedAt ?? '2026-09-30T08:00:00.000Z';
  const content = { type: notification.type, data: notification.data } as NotificationContent;
  const box = notification.box ?? notificationBox(content);
  return {
    count: 1,
    read: false,
    // F16 part B: the catalog's priority and box, open and not snoozed.
    priority: notificationPriority(content),
    box,
    inbox: box === 'action' ? 'needs_you' : 'fyi',
    resolution: null,
    snoozedUntil: null,
    ...notification,
    id: id(n),
    createdAt: at,
    updatedAt: at,
    recipientId: recipient.user.id,
  } as NotificationRecord;
}

/** Sara's and Karim's notifications. */
export function notificationsSeed(): NotificationRecord[] {
  const layan = { id: id(3), name: 'ليان الأحمد', imageId: null };
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
      actor: { id: id(2), name: 'عمر حداد', imageId: null },
      subject: { type: 'client', id: id(602) },
      data: { client: 'عيادة الشفاء' },
      read: true,
      updatedAt: '2026-09-20T10:00:00.000Z',
    }),
    // F16 part B: one closed by someone else, one closed by Sara, one snoozed.
    notificationFor(manager, 5011, {
      type: 'task_review_requested',
      actor: layan,
      subject: { type: 'task', id: id(1003) },
      data: {
        task: {
          title: 'بوستات أسبوع الافتتاح',
          department: 'content_management',
          client: 'مطعم الياسمين',
          project: null,
        },
      },
      read: true,
      inbox: 'fyi',
      resolution: {
        outcome: 'done',
        by: { id: id(2), name: 'عمر حداد', imageId: null },
        at: '2026-09-29T15:00:00.000Z',
      },
      updatedAt: '2026-09-29T14:00:00.000Z',
    }),
    notificationFor(manager, 5012, {
      type: 'task_review_requested',
      actor: layan,
      subject: { type: 'task', id: id(1002) },
      data: {
        task: {
          title: 'تصوير أطباق الموسم',
          department: 'photography',
          client: 'مطعم الياسمين',
          project: null,
        },
      },
      read: true,
      inbox: 'done',
      resolution: {
        outcome: 'done',
        by: { id: manager.user.id, name: manager.user.name, imageId: null },
        at: '2026-09-28T12:00:00.000Z',
      },
      updatedAt: '2026-09-28T10:00:00.000Z',
    }),
    notificationFor(manager, 5013, {
      type: 'task_returned',
      actor: layan,
      subject: { type: 'task', id: id(1001) },
      data: { task: autumnMenuSnapshot, source: 'internal' },
      inbox: 'snoozed',
      snoozedUntil: '2026-10-01T06:00:00.000Z',
      updatedAt: '2026-09-30T07:00:00.000Z',
    }),
    notificationFor(employeeMe, 5010, {
      type: 'task_assigned',
      actor: { id: id(1), name: 'سارة الخطيب', imageId: null },
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

/**
 * F16 part C: Sara's rows of the catalog's new types, one per kind of record they open
 * (acceptance step C7), and a meeting about to start with its link.
 */
export function catalogNotificationsSeed(): NotificationRecord[] {
  const omar = { id: id(2), name: 'عمر حداد', imageId: null };
  const client = 'مطعم الياسمين';
  return [
    notificationFor(manager, 5801, {
      type: 'payment_recorded',
      actor: omar,
      subject: { type: 'invoice', id: id(9403) },
      data: {
        invoice: { displayNumber: 'INV-2026-0001', client },
        amountMinor: 50_000,
        currency: 'USD',
      },
    }),
    notificationFor(manager, 5802, {
      type: 'quote_expiring',
      actor: null,
      subject: { type: 'quote', id: id(9201) },
      data: {
        quote: { displayNumber: 'Q-2026-0001', title: 'هوية بصرية', client },
        validUntil: '2026-10-03',
      },
    }),
    notificationFor(manager, 5803, {
      type: 'milestone_completed',
      actor: omar,
      subject: { type: 'project', id: id(801) },
      data: { project: 'الهوية البصرية الجديدة', client, milestone: 'الاستكشاف' },
    }),
    notificationFor(manager, 5804, {
      type: 'post_published',
      actor: omar,
      subject: { type: 'post', id: id(1601) },
      data: {
        post: {
          title: 'منشور افتتاح الفرع الجديد',
          client,
          publishDate: '2026-10-01',
          publishTime: '18:00',
        },
      },
    }),
    notificationFor(manager, 5805, {
      type: 'approval_opened',
      actor: null,
      subject: { type: 'approval_request', id: id(1481) },
      data: { client, contact: 'سامر' },
    }),
    notificationFor(manager, 5806, {
      type: 'contract_signed',
      actor: omar,
      subject: { type: 'retainer', id: id(901) },
      data: { retainer: 'إدارة السوشيال ميديا', client, contract: 'C-2026-0001', annex: null },
    }),
    notificationFor(manager, 5807, {
      type: 'extra_work_created',
      actor: omar,
      subject: { type: 'project', id: id(801) },
      data: { title: 'منشور إضافي', engagement: 'الهوية البصرية الجديدة', client },
    }),
    notificationFor(manager, 5808, {
      type: 'campaign_status_changed',
      actor: omar,
      subject: { type: 'campaign', id: id(9601) },
      data: { campaign: { name: 'حملة منيو الخريف', client }, status: 'paused' },
    }),
    notificationFor(manager, 5809, {
      type: 'department_manager_assigned',
      actor: omar,
      subject: { type: 'department', id: design.id },
      data: { department: 'design' },
    }),
    notificationFor(manager, 5810, {
      type: 'meeting_starting',
      actor: null,
      subject: { type: 'meeting', id: id(1761) },
      data: {
        meeting: {
          title: 'اجتماع خطة المحتوى',
          client,
          startsAt: '2026-09-30T09:15:00.000Z',
          endsAt: '2026-09-30T10:00:00.000Z',
        },
        joinUrl: 'https://meet.example.com/content-plan',
      },
      updatedAt: '2026-09-30T09:00:00.000Z',
    }),
  ];
}

/** F16 rule A15: a delivered and opened push, one to a device that is gone, and a test. */
function pushDeliveriesSeed(notifications: NotificationRecord[]): PushDelivery[] {
  const strip = ({ recipientId: _, ...rest }: NotificationRecord) => rest as Notification;
  const sara = { id: manager.user.id, name: manager.user.name, imageId: null };
  const found = (n: number) => {
    const record = notifications.find((item) => item.id === id(n));
    return record ? strip(record) : null;
  };
  return [
    {
      id: id(9701),
      user: sara,
      device: 'Chrome على Android',
      kind: 'notification',
      notification: found(5001),
      status: 'sent',
      error: null,
      createdAt: '2026-09-30T09:40:00.000Z',
      sentAt: '2026-09-30T09:40:02.000Z',
      clickedAt: '2026-09-30T09:45:00.000Z',
    },
    {
      id: id(9702),
      user: { id: employeeMe.user.id, name: employeeMe.user.name, imageId: null },
      device: 'Safari على iPhone',
      kind: 'notification',
      notification: found(5010),
      status: 'gone',
      error: '410 Gone',
      createdAt: '2026-09-30T09:00:00.000Z',
      sentAt: null,
      clickedAt: null,
    },
    {
      id: id(9703),
      user: sara,
      device: 'Edge على Windows',
      kind: 'test',
      notification: null,
      status: 'sent',
      error: null,
      createdAt: '2026-09-29T08:00:00.000Z',
      sentAt: '2026-09-29T08:00:01.000Z',
      clickedAt: null,
    },
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
  const pushed = new Map<string, Set<NotificationType>>();
  const morning = new Map<string, boolean>();
  // F16 rules B1–B2: management's modes per type; the catalog default when absent.
  const policies = new Map<
    NotificationType,
    Pick<NotificationPolicy, 'push' | 'email' | 'updatedBy' | 'updatedAt'>
  >();
  // F16 rule B12: who follows each task and post, by `<subject>:<id>`.
  const followers = new Map<string, Set<string>>([
    [`task:${id(1001)}`, new Set([id(3), employeeMe.user.id])],
  ]);
  const mine = () => notifications.filter((n) => n.recipientId === me().user.id);
  // F16 rule B6: snoozed rows leave the count.
  const unreadCount = () => mine().filter((n) => !n.read && n.inbox !== 'snoozed').length;
  const policyOf = (type: NotificationType): NotificationPolicy => {
    const { category, priority, push, email } = NOTIFICATION_CATALOG[type];
    const set = policies.get(type);
    return {
      type,
      category,
      priority,
      defaults: { push, email },
      push: set?.push ?? push,
      email: set?.email ?? email,
      updatedBy: set?.updatedBy ?? null,
      updatedAt: set?.updatedAt ?? null,
    };
  };
  // F16 rule B3: required is on, unavailable off, else the user's choice, else the mode.
  const effective = (mode: ChannelMode, chosen: boolean | undefined) =>
    mode === 'required' ? true : mode === 'unavailable' ? false : (chosen ?? mode === 'on');
  const strip = ({ recipientId: _, ...rest }: NotificationRecord) => rest as Notification;
  const settings = (): NotificationSettings => {
    const off = muted.get(me().user.id) ?? new Set();
    return {
      types: NOTIFICATION_TYPES.map((type) => ({
        type,
        category: NOTIFICATION_CATALOG[type].category,
        mutable: NOTIFICATION_CATALOG[type].mutable,
        muted: off.has(type),
        priority: NOTIFICATION_CATALOG[type].priority,
        // F16 rule B3: the policy, then the saved choice, else the mode.
        push: effective(policyOf(type).push, pushed.get(me().user.id)?.has(type)),
        pushMode: policyOf(type).push,
        // F14 email: the saved choice, else the catalog defaults, kept while the type is muted.
        email: effective(policyOf(type).email, emailed.get(me().user.id)?.has(type)),
        emailMode: policyOf(type).email,
        emailLocked: off.has(type),
      })),
      digestEnabled: digest.get(me().user.id) ?? true,
      morningPush: morning.get(me().user.id) ?? true,
    };
  };

  return (route: Route, method: string, url: URL) => {
    const path = url.pathname;
    if (path === '/api/me/notifications' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
      const unread = url.searchParams.get('unread') === 'true';
      const category = url.searchParams.get('category');
      const inbox = url.searchParams.get('inbox');
      const items = mine()
        .filter(
          (n) =>
            (inbox ? n.inbox === inbox : n.inbox !== 'snoozed') &&
            (!unread || !n.read) &&
            (!category || NOTIFICATION_CATALOG[n.type].category === category),
        )
        // F16 rule B6: critical first, then newest.
        .sort(
          (a, b) =>
            Number(b.priority === 'critical') - Number(a.priority === 'critical') ||
            b.updatedAt.localeCompare(a.updatedAt),
        );
      return json(route, {
        items: items.slice((page - 1) * pageSize, page * pageSize).map(strip),
        total: items.length,
        page,
        pageSize,
      });
    }
    if (path === '/api/me/notifications/unread-count') {
      return json(route, {
        count: unreadCount(),
        needsYou: mine().filter((n) => n.inbox === 'needs_you').length,
      });
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
    const snooze = path.match(/^\/api\/me\/notifications\/([^/]+)\/(snooze|unsnooze)$/);
    if (snooze && method === 'POST') {
      const item = mine().find((n) => n.id === snooze[1]);
      if (!item) return fail(route, 404, null);
      if (snooze[2] === 'snooze') {
        if (item.resolution) return fail(route, 409, 'ALREADY_RESOLVED');
        const input = route.request().postDataJSON() as SnoozeNotification;
        item.snoozedUntil = snoozeUntil(input.for, new Date()).toISOString();
        item.inbox = 'snoozed';
      } else {
        // Rule B8: wakes unread, at the top of its list.
        item.snoozedUntil = null;
        item.read = false;
        item.updatedAt = new Date().toISOString();
        item.inbox = notificationInbox({
          recipientId: item.recipientId,
          box: item.box,
          snoozed: false,
          resolution: item.resolution?.outcome ?? null,
          resolvedById: item.resolution?.by?.id ?? null,
        });
      }
      return json(route, strip(item));
    }
    if (path === '/api/me/notification-settings' && method === 'GET') {
      return json(route, settings());
    }
    const policyManager = () =>
      me().permissions.some((granted) => granted.permission === 'notifications.policy');
    if (path === '/api/notification-policies' && method === 'GET') {
      if (!policyManager()) return fail(route, 403, null);
      return json(route, { items: NOTIFICATION_TYPES.map(policyOf) });
    }
    const policy = path.match(/^\/api\/notification-policies\/([^/]+)$/);
    if (policy && method === 'PUT') {
      if (!policyManager()) return fail(route, 403, null);
      const type = policy[1] as NotificationType;
      if (!NOTIFICATION_TYPES.includes(type)) return fail(route, 404, null);
      const input = route.request().postDataJSON() as UpdateNotificationPolicy;
      if ('reset' in input) policies.delete(type);
      else
        policies.set(type, {
          push: input.push,
          email: input.email,
          updatedBy: { id: me().user.id, name: me().user.name, imageId: null },
          updatedAt: new Date().toISOString(),
        });
      return json(route, policyOf(type));
    }
    if (path === '/api/push-deliveries' && method === 'GET') {
      if (!policyManager()) return fail(route, 403, null);
      const userId = url.searchParams.get('userId');
      const statuses = url.searchParams.getAll('status');
      const items = pushDeliveriesSeed(notifications).filter(
        (delivery) =>
          (!userId || delivery.user.id === userId) &&
          (statuses.length === 0 || statuses.includes(delivery.status)),
      );
      return json(route, { items, total: items.length, page: 1, pageSize: 30 });
    }
    const follow = path.match(/^\/api\/(tasks|content\/posts)\/([^/]+)\/following$/);
    if (follow?.[2] && (method === 'GET' || method === 'PUT')) {
      const key = `${follow[1] === 'tasks' ? 'task' : 'post'}:${follow[2]}`;
      const set = followers.get(key) ?? new Set<string>();
      followers.set(key, set);
      if (method === 'PUT') {
        const { following } = route.request().postDataJSON() as UpdateFollowing;
        if (following) set.add(me().user.id);
        else set.delete(me().user.id);
      }
      return json(route, { following: set.has(me().user.id), followers: set.size });
    }
    if (path === '/api/me/notification-settings' && method === 'PUT') {
      const { mutedTypes, emailTypes, pushTypes, digestEnabled, morningPush } = route
        .request()
        .postDataJSON() as UpdateNotificationSettings;
      if (mutedTypes.some((type) => !NOTIFICATION_CATALOG[type].mutable)) {
        return fail(route, 400, 'NOT_MUTABLE');
      }
      muted.set(me().user.id, new Set(mutedTypes));
      if (emailTypes) emailed.set(me().user.id, new Set(emailTypes));
      if (pushTypes) pushed.set(me().user.id, new Set(pushTypes));
      if (digestEnabled !== undefined) digest.set(me().user.id, digestEnabled);
      if (morningPush !== undefined) morning.set(me().user.id, morningPush);
      return json(route, settings());
    }
    return undefined;
  };
}
// Announcements and audiences (F16 part D)

/** The instant the announcement specs and screenshots freeze the browser's clock on. */
export const ANNOUNCEMENTS_NOW = '2026-10-20T09:00:00+03:00';

const announcementsHoursBefore = (hours: number) =>
  new Date(new Date(ANNOUNCEMENTS_NOW).getTime() - hours * 3_600_000).toISOString();

interface AnnouncementRecipientRecord {
  userId: string;
  openedAt: string | null;
  acknowledgedAt: string | null;
  remindersSent: number;
}

interface AnnouncementPollRecord {
  question: string;
  multiple: boolean;
  anonymous: boolean;
  results: PollResultsVisibility;
  closesAt: string | null;
  closedAt: string | null;
  options: { id: string; label: string }[];
  votes: { optionId: string; userId: string }[];
}

export interface AnnouncementRecord {
  id: string;
  authorId: string;
  title: string;
  body: AnnouncementBody;
  linkUrl: string | null;
  linkLabel: string | null;
  priority: NotificationPriority;
  requiresAck: boolean;
  audience: Audience;
  status: AnnouncementStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  pinnedUntil: string | null;
  editedAt: string | null;
  renotifiedAt: string | null;
  unsentAt: string | null;
  withdrawnAt: string | null;
  withdrawnById: string | null;
  archivedAt: string | null;
  remindedAt: string | null;
  createdAt: string;
  recipients: AnnouncementRecipientRecord[];
  poll: AnnouncementPollRecord | null;
}

/** A body of plain paragraphs, one per line. */
export const paragraphs = (...lines: string[]): AnnouncementBody => ({
  type: 'doc',
  content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

const receipt = (
  userId: string,
  opened: number | null,
  acknowledged: number | null = null,
  remindersSent = 0,
): AnnouncementRecipientRecord => ({
  userId,
  openedAt: opened === null ? null : announcementsHoursBefore(opened),
  acknowledgedAt: acknowledged === null ? null : announcementsHoursBefore(acknowledged),
  remindersSent,
});

const announcementBase = (
  n: number,
  fields: Partial<AnnouncementRecord> &
    Pick<AnnouncementRecord, 'authorId' | 'title' | 'body' | 'audience'>,
): AnnouncementRecord => ({
  id: id(3000 + n),
  linkUrl: null,
  linkLabel: null,
  priority: 'normal',
  requiresAck: false,
  status: 'sent',
  scheduledAt: null,
  sentAt: announcementsHoursBefore(24),
  pinnedUntil: null,
  editedAt: null,
  renotifiedAt: null,
  unsentAt: null,
  withdrawnAt: null,
  withdrawnById: null,
  archivedAt: null,
  remindedAt: null,
  createdAt: announcementsHoursBefore(26),
  recipients: [],
  poll: null,
  ...fields,
});

export const announcementIds = {
  ramadan: id(3001),
  design: id(3002),
  draft: id(3003),
  scheduled: id(3004),
  withdrawn: id(3005),
  critical: id(3006),
};

/**
 * Sara's pinned announcement to everyone with an acknowledgement and a named poll; Layan's
 * note to Design; Karim's draft; a scheduled and a withdrawn one. `critical` adds Sara's
 * unacknowledged critical announcement, which opens the blocking dialog for everyone else.
 */
export function announcementsSeed({ critical = false } = {}): AnnouncementRecord[] {
  const records = [
    announcementBase(1, {
      authorId: id(1),
      title: 'مواعيد الدوام في رمضان',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'يبدأ الدوام في رمضان ' },
              { type: 'text', text: 'الساعة العاشرة صباحًا', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' وينتهي في الرابعة.' },
            ],
          },
          { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'ما يتغيّر' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'اجتماع الإثنين في الحادية عشرة.' }],
                  },
                ],
              },
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'جلسات التصوير ' },
                      { type: 'text', text: 'بعد الإفطار', marks: [{ type: EMPHASIS_MARK }] },
                      { type: 'text', text: ' عند الحاجة.' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      linkUrl: 'https://vertex.example/ramadan',
      linkLabel: 'جدول الدوام',
      priority: 'important',
      requiresAck: true,
      audience: { everyone: true },
      pinnedUntil: addDays(ANNOUNCEMENTS_NOW.slice(0, 10), 7),
      recipients: [
        receipt(id(2), 20, 19),
        receipt(id(3), 22, 21),
        receipt(id(4), null, null, 1),
        receipt(id(8), 5),
      ],
      poll: {
        question: 'أي موعد يناسبكم لإفطار الفريق؟',
        multiple: false,
        anonymous: false,
        results: 'everyone_after_voting',
        closesAt: announcementsHoursBefore(-72),
        closedAt: null,
        options: [
          { id: id(3101), label: 'الخميس الأول' },
          { id: id(3102), label: 'الخميس الثاني' },
          { id: id(3103), label: 'آخر أسبوع' },
        ],
        votes: [
          { optionId: id(3101), userId: id(2) },
          { optionId: id(3102), userId: id(3) },
        ],
      },
    }),
    announcementBase(2, {
      authorId: id(3),
      title: 'تسليم هوية مطعم الياسمين',
      body: paragraphs('نسلّم ملفات الهوية يوم الخميس. راجعوا الملاحظات قبل الأربعاء.'),
      audience: { departments: ['design'] },
      sentAt: announcementsHoursBefore(48),
      createdAt: announcementsHoursBefore(48),
      recipients: [receipt(id(1), 40)],
    }),
    announcementBase(3, {
      authorId: id(4),
      title: 'معدات التصوير الجديدة',
      body: paragraphs('وصلت عدسات جديدة. احجزوها من الجدول قبل الجلسة.'),
      audience: { departments: ['photography', 'design'] },
      status: 'draft',
      sentAt: null,
      createdAt: announcementsHoursBefore(3),
    }),
    announcementBase(4, {
      authorId: id(1),
      title: 'اجتماع الشركة الشهري',
      body: paragraphs('اجتماع الشركة يوم الأحد في القاعة الكبيرة.'),
      audience: { everyone: true },
      status: 'scheduled',
      sentAt: null,
      scheduledAt: announcementsHoursBefore(-48),
      createdAt: announcementsHoursBefore(2),
    }),
    announcementBase(5, {
      authorId: id(1),
      title: 'تغيير مكان الاجتماع',
      body: paragraphs('ينتقل الاجتماع إلى الطابق الثاني.'),
      audience: { everyone: true },
      status: 'withdrawn',
      sentAt: announcementsHoursBefore(72),
      withdrawnAt: announcementsHoursBefore(70),
      withdrawnById: id(1),
      archivedAt: announcementsHoursBefore(70),
      createdAt: announcementsHoursBefore(72),
      recipients: [
        receipt(id(2), 71),
        receipt(id(3), null),
        receipt(id(4), null),
        receipt(id(8), null),
      ],
    }),
  ];
  if (critical) {
    records.push(
      announcementBase(6, {
        authorId: id(1),
        title: 'إخلاء المكتب للصيانة غدًا',
        body: paragraphs(
          'يُغلق المكتب غدًا للصيانة الكهربائية. يعمل الجميع من المنزل.',
          'احفظوا ملفاتكم على الخادم قبل المغادرة اليوم.',
        ),
        priority: 'critical',
        requiresAck: true,
        audience: { everyone: true },
        sentAt: announcementsHoursBefore(1),
        createdAt: announcementsHoursBefore(1),
        recipients: [
          receipt(id(2), null),
          receipt(id(3), null),
          receipt(id(4), null),
          receipt(id(8), null),
        ],
      }),
    );
  }
  return records;
}

export function announcementTemplatesSeed(): AnnouncementTemplate[] {
  return [
    {
      id: id(3201),
      name: 'إجازة رسمية',
      title: 'عطلة رسمية',
      body: paragraphs('تُغلق الشركة يوم العطلة الرسمية، ويعود الدوام في اليوم التالي.'),
      priority: 'important',
      requiresAck: false,
      linkUrl: null,
      linkLabel: null,
      shared: true,
      editable: false,
      createdAt: '2026-09-01T08:00:00.000Z',
      updatedAt: '2026-09-01T08:00:00.000Z',
    },
    {
      id: id(3202),
      name: 'تذكير بالتسليم',
      title: 'تذكير: موعد التسليم',
      body: paragraphs('نذكّر بموعد التسليم. أرسلوا الملفات قبل الظهر.'),
      priority: 'normal',
      requiresAck: true,
      linkUrl: null,
      linkLabel: null,
      shared: false,
      editable: true,
      createdAt: '2026-09-10T08:00:00.000Z',
      updatedAt: '2026-09-10T08:00:00.000Z',
    },
  ];
}

/** The audiences and announcements APIs over the in-memory records (rules D1–D12). */
function announcementRoutes({
  users,
  clients,
  projects,
  announcements,
  templates,
  me,
}: {
  users: UserResponse[];
  clients: ClientRecord[];
  projects: ProjectRecord[];
  announcements: AnnouncementRecord[];
  templates: AnnouncementTemplate[];
  me: () => MeResponse;
}) {
  let next = 3500;
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const scopes = () =>
    me().permissions.find((granted) => granted.permission === 'announcements.manage')?.scopes ?? [];
  const managesAll = () => scopes().includes('all');
  const active = users.filter((u) => u.status === 'active');
  const managedDepartments = () =>
    me()
      .departments.filter((d) => d.isManager)
      .map((d) => d.code);

  /** Rule D1, over the seeded team. */
  const resolve = (audience: Audience): UserResponse[] => {
    const ids = new Set<string>();
    if (audience.everyone) for (const u of active) ids.add(u.id);
    for (const code of audience.departments ?? []) {
      for (const u of active) if (u.departments.some((d) => d.code === code)) ids.add(u.id);
    }
    for (const role of audience.roles ?? []) {
      for (const u of active) {
        const holds =
          role === 'employee' ||
          (role === 'department_manager' && u.departments.some((d) => d.isManager)) ||
          (u.roles ?? []).includes(role as never);
        if (holds) ids.add(u.id);
      }
    }
    for (const userId of audience.users ?? []) ids.add(userId);
    for (const projectId of audience.projects ?? []) {
      const project = projects.find((p) => p.id === projectId);
      if (!project) continue;
      ids.add(project.projectManagerId);
      const client = clients.find((c) => c.id === project.clientId);
      if (client) ids.add(client.accountManagerId);
    }
    for (const clientId of audience.clients ?? []) {
      const client = clients.find((c) => c.id === clientId);
      if (client) ids.add(client.accountManagerId);
      for (const p of projects) if (p.clientId === clientId) ids.add(p.projectManagerId);
    }
    for (const userId of audience.exclude ?? []) ids.delete(userId);
    return active.filter((u) => ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  };

  /** Rules D3, D7: critical and pinning need `announcements.manage` over every recipient. */
  const reaches = (recipients: UserResponse[]) =>
    managesAll() ||
    (scopes().includes('department') &&
      recipients.every((u) => u.departments.some((d) => managedDepartments().includes(d.code))));

  const receiptOf = (record: AnnouncementRecord) =>
    record.recipients.find((r) => r.userId === me().user.id) ?? null;
  const isAuthor = (record: AnnouncementRecord) => record.authorId === me().user.id;
  const wasSent = (record: AnnouncementRecord) =>
    record.status === 'sent' || record.status === 'withdrawn';
  const readable = (record: AnnouncementRecord) => {
    if (record.archivedAt && record.status !== 'withdrawn') return false;
    if (isAuthor(record)) return true;
    if (receiptOf(record) && record.status === 'sent') return true;
    return managesAll() && wasSent(record);
  };
  const totals = (record: AnnouncementRecord): AnnouncementTotals => ({
    recipients: record.recipients.length,
    opened: record.recipients.filter((r) => r.openedAt).length,
    acknowledged: record.recipients.filter((r) => r.acknowledgedAt).length,
  });

  const summary = (record: AnnouncementRecord): AnnouncementSummary => {
    const own = receiptOf(record);
    return {
      id: record.id,
      author: person(record.authorId),
      title: record.title,
      excerpt: announcementExcerpt(record.body),
      priority: record.priority,
      requiresAck: record.requiresAck,
      status: record.status,
      scheduledAt: record.scheduledAt,
      sentAt: record.sentAt,
      pinnedUntil: record.pinnedUntil,
      editedAt: record.editedAt,
      unsentAt: record.unsentAt,
      withdrawnAt: record.withdrawnAt,
      receipt: own && { openedAt: own.openedAt, acknowledgedAt: own.acknowledgedAt },
      totals: wasSent(record) && (isAuthor(record) || managesAll()) ? totals(record) : null,
      createdAt: record.createdAt,
    };
  };

  const pollOf = (record: AnnouncementRecord): AnnouncementPoll | null => {
    const poll = record.poll;
    if (!poll) return null;
    const own = receiptOf(record);
    const closed =
      poll.closedAt !== null ||
      (!!poll.closesAt && poll.closesAt <= new Date(ANNOUNCEMENTS_NOW).toISOString());
    const myVote = poll.votes.filter((v) => v.userId === me().user.id).map((v) => v.optionId);
    const owner = isAuthor(record) || managesAll();
    const sees =
      owner || (poll.results === 'everyone_after_voting' && (myVote.length > 0 || closed));
    const names = owner && !poll.anonymous;
    const voters = new Set(poll.votes.map((v) => v.userId)).size;
    return {
      question: poll.question,
      multiple: poll.multiple,
      anonymous: poll.anonymous,
      results: poll.results,
      closesAt: poll.closesAt,
      closedAt: poll.closedAt,
      closed,
      options: poll.options.map((option) => {
        const votes = poll.votes.filter((v) => v.optionId === option.id);
        return {
          id: option.id,
          label: option.label,
          votes: sees ? votes.length : null,
          voters: names ? votes.map((v) => person(v.userId)) : null,
        };
      }),
      voters: sees ? voters : null,
      myVote,
      rights: {
        vote: !!own && record.status === 'sent' && !closed,
        close: isAuthor(record) && record.status === 'sent' && !closed,
      },
    };
  };

  const detail = (record: AnnouncementRecord): Announcement => {
    const own = receiptOf(record);
    const author = isAuthor(record);
    return {
      ...summary(record),
      body: record.body,
      linkUrl: record.linkUrl,
      linkLabel: record.linkLabel,
      audience: author || managesAll() ? record.audience : null,
      renotifiedAt: record.renotifiedAt,
      withdrawnBy: record.withdrawnById ? person(record.withdrawnById) : null,
      poll: pollOf(record),
      rights: {
        edit: author && record.status !== 'withdrawn',
        withdraw: record.status === 'sent' && (author || managesAll()),
        receipts: wasSent(record) && (author || managesAll()),
        acknowledge:
          !!own && record.status === 'sent' && record.requiresAck && own.acknowledgedAt === null,
      },
    };
  };

  const pollRecord = (input: PollInput | null, previous: AnnouncementPollRecord | null) =>
    input && {
      question: input.question,
      multiple: input.multiple,
      anonymous: input.anonymous,
      results: input.results,
      closesAt: input.closesAt,
      closedAt: previous?.closedAt ?? null,
      options: input.options.map((label) => ({
        id: previous?.options.find((o) => o.label === label)?.id ?? id(next++),
        label,
      })),
      votes: [],
    };

  /** Sends now (rule D3); answers why it cannot instead. */
  const deliver = (record: AnnouncementRecord, route: Route) => {
    const recipients = resolve(record.audience).filter((u) => u.id !== record.authorId);
    if (recipients.length === 0) return fail(route, 409, 'EMPTY_AUDIENCE');
    if ((record.priority === 'critical' || record.pinnedUntil) && !reaches(recipients)) {
      return fail(route, 403, 'FORBIDDEN_AUDIENCE');
    }
    record.status = 'sent';
    record.sentAt = new Date().toISOString();
    record.scheduledAt = null;
    record.unsentAt = null;
    record.recipients = recipients.map((u) => ({
      userId: u.id,
      openedAt: null,
      acknowledgedAt: null,
      remindersSent: 0,
    }));
    return undefined;
  };

  const ownTemplates = new Map<string, string>([[id(3202), id(1)]]);
  const templateOf = (template: AnnouncementTemplate): AnnouncementTemplate => ({
    ...template,
    editable: template.shared ? managesAll() : ownTemplates.get(template.id) === me().user.id,
  });
  const visibleTemplates = () =>
    templates.filter((t) => t.shared || ownTemplates.get(t.id) === me().user.id);

  return (route: Route, method: string, url: URL) => {
    const path = url.pathname;
    const body = () => route.request().postDataJSON();

    if (path === '/api/audiences/preview' && method === 'POST') {
      const parsed = audienceSchema.safeParse(body());
      if (!parsed.success) return fail(route, 400, null);
      const resolved = resolve(parsed.data);
      return json(route, {
        count: resolved.length,
        users: resolved.slice(0, AUDIENCE_PREVIEW_MAX).map((u) => ({
          id: u.id,
          name: u.name,
          imageId: null,
          image: null,
          department: u.departments.find((d) => d.isPrimary)?.code ?? null,
        })),
      } satisfies AudiencePreview);
    }

    // Files of an announcement (F10 owner type `announcement`): none seeded.
    if (
      path === '/api/files/items' &&
      method === 'GET' &&
      url.searchParams.get('ownerType') === 'announcement'
    ) {
      const record = announcements.find((a) => a.id === url.searchParams.get('ownerId'));
      if (!record || !readable(record)) return fail(route, 404, null);
      return json(route, {
        items: [],
        rights: {
          canAddDeliverable: false,
          canAddReference: false,
          canManageDocuments: isAuthor(record) && record.status !== 'withdrawn',
          canSetConfidential: false,
          canSeeRemoved: false,
        },
      } satisfies FileItemList);
    }

    if (path === '/api/announcements/home' && method === 'GET') {
      const today = businessDate(new Date(ANNOUNCEMENTS_NOW));
      const mine = announcements.filter((a) => a.status === 'sent' && receiptOf(a));
      return json(route, {
        pinned: mine
          .filter((a) => a.pinnedUntil && a.pinnedUntil >= today)
          .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''))
          .map(summary),
        critical: mine
          .filter((a) => a.priority === 'critical' && !receiptOf(a)?.acknowledgedAt)
          .sort((a, b) => (a.sentAt ?? '').localeCompare(b.sentAt ?? ''))
          .map(detail),
      } satisfies AnnouncementHome);
    }

    if (path === '/api/announcements' && method === 'GET') {
      const view = url.searchParams.get('view') ?? 'received';
      if (view === 'all' && !managesAll()) return fail(route, 403, null);
      const statuses = url.searchParams.getAll('status');
      const search = url.searchParams.get('search');
      const items = announcements
        .filter((a) =>
          view === 'received'
            ? a.status === 'sent' && !!receiptOf(a)
            : view === 'sent'
              ? isAuthor(a) && (!a.archivedAt || a.status === 'withdrawn')
              : wasSent(a),
        )
        .filter((a) => statuses.length === 0 || statuses.includes(a.status))
        .filter((a) => !search || a.title.includes(search))
        .sort((a, b) =>
          (b.sentAt ?? b.scheduledAt ?? b.createdAt).localeCompare(
            a.sentAt ?? a.scheduledAt ?? a.createdAt,
          ),
        )
        .map(summary);
      return json(route, {
        items,
        total: items.length,
        page: 1,
        pageSize: 20,
      } satisfies AnnouncementPage);
    }

    if (path === '/api/announcements' && method === 'POST') {
      const parsed = createAnnouncementSchema.safeParse(body());
      if (!parsed.success) return fail(route, 400, null);
      const input = parsed.data;
      const now = new Date().toISOString();
      const record: AnnouncementRecord = {
        id: id(next++),
        authorId: me().user.id,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl ?? null,
        linkLabel: input.linkLabel ?? null,
        priority: input.priority,
        requiresAck: input.requiresAck,
        audience: input.audience,
        status: input.send === 'schedule' ? 'scheduled' : 'draft',
        scheduledAt: input.send === 'schedule' ? (input.scheduledAt ?? null) : null,
        sentAt: null,
        pinnedUntil: input.pinnedUntil ?? null,
        editedAt: null,
        renotifiedAt: null,
        unsentAt: null,
        withdrawnAt: null,
        withdrawnById: null,
        archivedAt: null,
        remindedAt: null,
        createdAt: now,
        recipients: [],
        poll: pollRecord(input.poll ?? null, null),
      };
      if (input.send === 'now') {
        const refused = deliver(record, route);
        if (refused) return refused;
      }
      announcements.push(record);
      return json(route, detail(record), 201);
    }

    const templatesPath = path.match(/^\/api\/announcement-templates(?:\/([^/]+))?(\/archive)?$/);
    if (templatesPath) {
      const [, templateId, archive] = templatesPath;
      if (!templateId && method === 'GET') {
        const items = visibleTemplates()
          .map(templateOf)
          .sort(
            (a, b) => Number(a.shared) - Number(b.shared) || a.name.localeCompare(b.name, 'ar'),
          );
        return json(route, { items } satisfies AnnouncementTemplateList);
      }
      if (!templateId && method === 'POST') {
        const parsed = createAnnouncementTemplateSchema.safeParse(body());
        if (!parsed.success) return fail(route, 400, null);
        if (parsed.data.shared && !managesAll()) return fail(route, 403, null);
        const now = new Date().toISOString();
        const { shared, ...fields } = parsed.data;
        const template: AnnouncementTemplate = {
          id: id(next++),
          ...fields,
          linkUrl: fields.linkUrl ?? null,
          linkLabel: fields.linkLabel ?? null,
          shared,
          editable: true,
          createdAt: now,
          updatedAt: now,
        };
        templates.push(template);
        if (!shared) ownTemplates.set(template.id, me().user.id);
        return json(route, templateOf(template), 201);
      }
      const template = visibleTemplates().find((t) => t.id === templateId);
      if (!template) return fail(route, 404, null);
      if (!templateOf(template).editable) return fail(route, 403, null);
      if (archive && method === 'POST') {
        templates.splice(templates.indexOf(template), 1);
        return json(route, templateOf(template));
      }
      if (method === 'PATCH') {
        const parsed = updateAnnouncementTemplateSchema.safeParse(body());
        if (!parsed.success) return fail(route, 400, null);
        Object.assign(template, parsed.data, { updatedAt: new Date().toISOString() });
        return json(route, templateOf(template));
      }
    }

    const match = path.match(/^\/api\/announcements\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const [, announcementId, action] = match;
    const record = announcements.find((a) => a.id === announcementId);
    if (!record || !readable(record)) return fail(route, 404, null);
    const own = receiptOf(record);

    if (!action && method === 'GET') {
      // Rule D4: reading opens it.
      if (own && record.status === 'sent' && !own.openedAt) own.openedAt = new Date().toISOString();
      return json(route, detail(record));
    }
    if (!action && method === 'PATCH') {
      if (!isAuthor(record)) return fail(route, 403, null);
      const parsed = updateAnnouncementSchema.safeParse(body());
      if (!parsed.success) return fail(route, 400, null);
      const input = parsed.data;
      if (record.status === 'sent') {
        const locked = Object.keys(input).some(
          (key) => !(SENT_ANNOUNCEMENT_FIELDS as readonly string[]).includes(key),
        );
        if (locked || (input.poll !== undefined && (record.poll?.votes.length ?? 0) > 0)) {
          return fail(route, 409, 'LOCKED_FIELD');
        }
        record.editedAt = new Date().toISOString();
        if (input.notifyAgain) {
          record.renotifiedAt = record.editedAt;
          for (const r of record.recipients) r.acknowledgedAt = null;
        }
      }
      const { poll, notifyAgain: _notifyAgain, ...fields } = input;
      Object.assign(record, fields);
      if (poll !== undefined) record.poll = pollRecord(poll, record.poll);
      return json(route, detail(record));
    }
    if (action === 'send' && method === 'POST') {
      if (!isAuthor(record)) return fail(route, 403, null);
      if (record.status !== 'draft') return fail(route, 409, 'NOT_DRAFT');
      const { scheduledAt } = body() as SendAnnouncement;
      if (scheduledAt) {
        record.status = 'scheduled';
        record.scheduledAt = scheduledAt;
      } else {
        const refused = deliver(record, route);
        if (refused) return refused;
      }
      return json(route, detail(record));
    }
    if (action === 'cancel-schedule' && method === 'POST') {
      if (!isAuthor(record)) return fail(route, 403, null);
      if (record.status !== 'scheduled') return fail(route, 409, 'NOT_SCHEDULED');
      record.status = 'draft';
      record.scheduledAt = null;
      return json(route, detail(record));
    }
    if (action === 'withdraw' && method === 'POST') {
      if (!isAuthor(record) && !managesAll()) return fail(route, 403, null);
      if (record.status === 'withdrawn') return fail(route, 409, 'ALREADY_WITHDRAWN');
      record.status = 'withdrawn';
      record.withdrawnAt = new Date().toISOString();
      record.withdrawnById = me().user.id;
      record.archivedAt = record.withdrawnAt;
      return json(route, detail(record));
    }
    if (action === 'archive' && method === 'POST') {
      if (!isAuthor(record)) return fail(route, 403, null);
      if (record.status !== 'draft') return fail(route, 409, 'NOT_DRAFT');
      record.archivedAt = new Date().toISOString();
      return route.fulfill({ status: 204 });
    }
    if (action === 'acknowledge' && method === 'POST') {
      if (!own || record.status !== 'sent') return fail(route, 404, null);
      if (!record.requiresAck) return fail(route, 409, 'NO_ACK_REQUIRED');
      const now = new Date().toISOString();
      own.acknowledgedAt ??= now;
      own.openedAt ??= now;
      return route.fulfill({ status: 204 });
    }
    if (action === 'remind' && method === 'POST') {
      if (!isAuthor(record)) return fail(route, 403, null);
      if (!record.requiresAck) return fail(route, 409, 'NO_ACK_REQUIRED');
      if (record.remindedAt) return fail(route, 429, null);
      record.remindedAt = new Date().toISOString();
      return json(route, {
        reminded: record.recipients.filter((r) => !r.acknowledgedAt).length,
      } satisfies RemindAnnouncementResult);
    }
    if (action === 'receipts' && method === 'GET') {
      if (!isAuthor(record) && !managesAll()) return fail(route, 403, null);
      const filter = url.searchParams.get('filter') ?? 'all';
      const items = record.recipients
        .filter(
          (r) =>
            filter === 'all' ||
            (filter === 'not_opened' && !r.openedAt) ||
            (filter === 'not_acknowledged' && !r.acknowledgedAt),
        )
        .map((r) => ({
          user: { ...person(r.userId), image: null, archived: false },
          openedAt: r.openedAt,
          acknowledgedAt: r.acknowledgedAt,
          remindersSent: r.remindersSent,
        }));
      return json(route, { totals: totals(record), items } satisfies AnnouncementReceipts);
    }
    if (action === 'poll/vote' && method === 'PUT') {
      const poll = record.poll;
      if (!poll || !own) return fail(route, 404, null);
      if (pollOf(record)?.closed) return fail(route, 409, 'POLL_CLOSED');
      const { optionIds } = body() as PollVote;
      if (!poll.multiple && optionIds.length > 1) return fail(route, 400, 'SINGLE_CHOICE');
      poll.votes = [
        ...poll.votes.filter((v) => v.userId !== me().user.id),
        ...optionIds.map((optionId) => ({ optionId, userId: me().user.id })),
      ];
      return json(route, pollOf(record));
    }
    if (action === 'poll/close' && method === 'POST') {
      const poll = record.poll;
      if (!poll) return fail(route, 404, null);
      if (!isAuthor(record)) return fail(route, 403, null);
      if (pollOf(record)?.closed) return fail(route, 409, 'POLL_CLOSED');
      poll.closedAt = new Date().toISOString();
      return json(route, pollOf(record));
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
  const layan = { id: id(3), name: 'ليان الأحمد', imageId: null };
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
  /** For the `holiday` key dates (F17 rule B16), shared with the HR settings. */
  holidays: Holiday[];
  /** Approved leaves (F17 rule B16), shared with the HR requests. */
  leave: LeaveState;
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
  holidays,
  leave,
  me,
}: CalendarState) {
  let next = 1800;
  const now = () => TASKS_NOW.toISOString();
  const holds = (permission: string, scope: string) =>
    me().permissions.some((g) => g.permission === permission && g.scopes.includes(scope as never));
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const archivable = (userId: string) => ({
    ...person(userId),
    archived: users.find((u) => u.id === userId)?.status === 'archived',
  });
  const clientOf = (clientId: string | null) => {
    const client = clients.find((c) => c.id === clientId);
    return client
      ? { id: client.id, name: client.tradeName, archived: client.archived, imageId: null }
      : null;
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
      clientOf(clientId) ?? { id: clientId, name: '', archived: false, imageId: null };
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
      // Each day of a public holiday, for everyone (F17 rule B16).
      ...holidays
        .filter((h) => !h.archivedAt && h.startsOn <= to && h.endsOn >= from)
        .flatMap((h) => {
          const first = h.startsOn < from ? from : h.startsOn;
          const last = h.endsOn > to ? to : h.endsOn;
          return Array.from({ length: daysInclusive(first, last) }, (_, day) => ({
            kind: 'holiday' as const,
            date: addDays(first, day),
            title: h.name,
            targetId: h.id,
            client: null,
            invoiceStatus: null,
          }));
        }),
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
        // F17 rule B16: the person filter applies; the client and shoot type filters hide them.
        leaves:
          shows('leave') && !clientId && !q.get('shootType')
            ? calendarLeaves(leave, { from, to }, me()).filter(
                (l) => !userId || l.user.id === userId,
              )
            : [],
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
        keyDates: keyDates(from, to).filter((keyDate) => {
          const { client } = keyDate;
          if (!shows(keyDate.kind)) return false;
          // A holiday reaches everyone, whatever the filters (F17 rule B16).
          if (!client) return true;
          return (
            (!clientId || client.id === clientId) &&
            (!userId ||
              clients.find((c) => c.id === client.id)?.accountManagerId === userId ||
              projects.find((p) => p.id === keyDate.targetId)?.projectManagerId === userId)
          );
        }),
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
      updatedBy: { id: id(1), name: 'سارة الخطيب', imageId: null },
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
    return { id: userId, name: user?.name ?? '', imageId: user?.imageId ?? null };
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
      client: client ? { id: client.id, name: client.tradeName, imageId: null } : null,
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
        template: template ? { id: template.id, name: template.name } : null,
        currency: q.currency,
        monthlyFeeMinor: detail.totals.monthly.netMinor,
        lines: mergeDeliverableLines(counted),
        term: q.monthlyTermMonths
          ? {
              cycles: q.monthlyTermMonths,
              agreedTotalMinor: detail.totals.monthly.netMinor * q.monthlyTermMonths,
              schedule: splitEvenly(
                detail.totals.monthly.netMinor * q.monthlyTermMonths,
                q.monthlyTermMonths,
              ),
              endAction: 'renew',
            }
          : null,
        renewable: retainers
          .filter(
            (r) =>
              r.clientId === client?.id &&
              !r.archived &&
              r.status !== 'ended' &&
              r.currency === q.currency,
          )
          .map((r) => {
            // F05B Q2, F05C: after the active term, else the next cycle; never before cycle 1.
            const active = (r.terms ?? []).find((t) => t.status === 'active');
            const renewsFromCycle = active
              ? termEndCycleOf(active) + 1
              : currentCycleNumber(r.startDate, today) + 1;
            return {
              id: r.id,
              name: r.name,
              imageId: null,
              status: r.status,
              startDate: r.startDate,
              renewsFromCycle,
              renewsFrom: cyclePeriod(r.startDate, renewsFromCycle).periodStart,
              afterTerm: !!active,
            };
          }),
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
            renewalDate: null,
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
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
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
    return {
      id: userId,
      name: user?.name ?? '',
      archived: user?.status === 'archived',
      imageId: null,
    };
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
      client: client ? { id: client.id, name: client.tradeName, imageId: null } : null,
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
          imageId: null,
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
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const named = (record: { id: string; name: string } | undefined) =>
    record ? { id: record.id, name: record.name, imageId: null } : null;
  const live = (i: InvoiceRecord) => !i.archivedAt && i.status !== 'void';
  const chargesOf = (r: RetainerRecord) =>
    [
      ...((r.monthlyFeeMinor ?? 0) > 0
        ? r.cycles
            .filter((c) => !termCovers(r, c.number))
            .map((c) => ({
              id: retainerChargeId(c.id),
              cycle: c.number,
              ...cyclePeriod(r.startDate, c.number),
              kind: 'monthly' as const,
              amountMinor: r.monthlyFeeMinor ?? 0,
              status: 'pending' as const,
              term: null,
              amendment: null,
              settleNote: null,
              due: true,
            }))
        : []),
      ...termChargesOf(r, PROJECTS_TODAY),
      ...(r.amendmentCharges ?? []).map((c) => ({ ...c, term: null, due: true })),
    ].sort((a, b) => b.cycle - a.cycle);
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
        name: found ? formatRetainerCycle({ number: found.charge.cycle, ...found.charge }) : '',
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
      client: { id: i.clientId, name: client?.tradeName ?? '', imageId: null },
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
      client: { id: client.id, name: client.tradeName, imageId: null },
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
    canSettleCredits: !retainer.archived && covers('invoices.manage', retainer.clientId),
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
    const settle = owned?.[1] === 'retainers' && owned[3]?.match(/^charges\/([^/]+)\/settle$/);
    if (settle && method === 'POST') {
      const retainer = retainers.find((r) => r.id === owned[2]);
      const charge = retainer?.amendmentCharges?.find((c) => c.id === settle[1]);
      if (!retainer || !charge) return fail(route, 404, null);
      if (!covers('invoices.manage', retainer.clientId)) return fail(route, 403, null);
      if (charge.status !== 'pending') return fail(route, 409, 'INVALID_TRANSITION');
      Object.assign(charge, {
        status: 'settled_outside',
        settleNote: (request.postDataJSON() as { note: string }).note,
      });
      return json(route, { ...charge, term: null, due: true, invoice: null });
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
              project: { id: p.id, name: p.name, imageId: null },
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
              retainer: { id: r.id, name: r.name, imageId: null },
              cycle: c.cycle,
              periodStart: c.periodStart,
              periodEnd: c.periodEnd,
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
              retainer: 'cycles' in e ? { id: e.id, name: e.name, imageId: null } : null,
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
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
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
      client: { id: c.clientId, name: clientName(c.clientId), imageId: null },
      platform: c.platform,
      objective: c.objective,
      funding: c.funding,
      status: c.status,
      startsOn: c.startsOn,
      endsOn: c.endsOn,
      owner: {
        id: c.ownerId,
        name: owner?.name ?? '',
        archived: owner?.status === 'archived',
        imageId: null,
      },
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
      client: {
        id: clientId,
        name: client?.tradeName ?? '',
        archived: client?.archived ?? false,
        imageId: null,
      },
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
          client: { id: client.id, name: client.tradeName, imageId: null },
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

interface DepartmentState {
  users: UserResponse[];
  tasks: TaskRecord[];
  tasksApi: ReturnType<typeof taskRoutes>;
  projects: ProjectRecord[];
  retainers: RetainerRecord[];
  catalog: CatalogRecords;
  /** Department id → its manager's user id. */
  managers: Map<string, string | null>;
  me: () => MeResponse;
}

type DepartmentRecord = Omit<DepartmentResponse, 'manager' | 'memberCount'> & {
  archivedById: string | null;
};

/**
 * The departments of F01 and F23: the list in its order, identity, members, the archive with its
 * transfer, restore, and the overview (served by `reports` in the API).
 */
function departmentRoutes({
  users,
  tasks,
  tasksApi,
  projects,
  retainers,
  catalog,
  managers,
  me,
}: DepartmentState) {
  const records: DepartmentRecord[] = departmentsSeed.map((d) => ({ ...d, archivedById: null }));
  const scopes = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const person = (u: UserResponse) => ({ id: u.id, name: u.name, imageId: u.imageId });
  const ordered = () => [
    ...records.filter((d) => !d.archivedAt).sort((a, b) => a.position - b.position),
    ...records.filter((d) => d.archivedAt),
  ];
  const membersOf = (d: DepartmentRecord) =>
    users.filter((u) => u.status !== 'archived' && u.departments.some((x) => x.id === d.id));
  const syncManagers = () => {
    for (const user of users) {
      user.departments = user.departments.map((x) => ({
        ...x,
        isManager: managers.get(x.id) === user.id,
      }));
    }
  };
  const departmentOf = (d: DepartmentRecord): DepartmentResponse => {
    const { archivedById: _, ...record } = d;
    const head = users.find((u) => u.id === managers.get(d.id));
    return {
      ...record,
      manager: head ? person(head) : null,
      memberCount: membersOf(d).length,
    };
  };
  const grantsOf = (code: DepartmentCode, position: 'member' | 'manager') =>
    Object.keys(
      Object.entries(DEPARTMENT_CAPABILITIES).find(([key]) => key === code)?.[1]?.[position] ?? {},
    ) as Permission[];
  const detailOf = (d: DepartmentRecord): DepartmentDetailResponse => {
    const archiver = users.find((u) => u.id === d.archivedById);
    return {
      ...departmentOf(d),
      members: membersOf(d)
        .map((u) => ({
          id: u.id,
          name: u.name,
          imageId: u.imageId,
          title: u.title,
          isPrimary: u.departments.find((x) => x.id === d.id)?.isPrimary ?? false,
          status: u.status === 'invited' ? ('invited' as const) : ('active' as const),
        }))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)),
      grants: { member: grantsOf(d.code, 'member'), manager: grantsOf(d.code, 'manager') },
      systemFunctions: [...departmentSystemFunctions(d.code)],
      archivedBy: archiver ? person(archiver) : null,
    };
  };
  const openTasks = (d: DepartmentRecord) =>
    tasks.filter((t) => !t.archived && isTaskOpen(t.status) && t.department === d.code);
  const services = (d: DepartmentRecord) =>
    catalog.services.filter((service) => service.department === d.code);
  const engagements = (d: DepartmentRecord) => [
    ...projects.filter(
      (p) => !p.archived && OPEN_STATUSES.includes(p.status) && p.departments.includes(d.code),
    ),
    ...retainers.filter(
      (r) =>
        !r.archived &&
        (r.status === 'active' || r.status === 'paused') &&
        r.departments.includes(d.code),
    ),
  ];
  const preview = (d: DepartmentRecord): DepartmentArchivePreview => {
    const listed = (items: { id: string; name: string }[]) => ({
      count: items.length,
      items: items.slice(0, 5).map(({ id: itemId, name }) => ({ id: itemId, name })),
    });
    const members = membersOf(d);
    return {
      categories: [
        { category: 'members', ...listed(members) },
        { category: 'tasks', ...listed(openTasks(d).map((t) => ({ id: t.id, name: t.title }))) },
        { category: 'questions', count: 0, items: [] },
        { category: 'services', ...listed(services(d)) },
        { category: 'templates', count: 0, items: [] },
        { category: 'engagements', ...listed(engagements(d)) },
      ],
      systemFunctions: [...departmentSystemFunctions(d.code)],
    };
  };
  const lastPosition = () =>
    Math.max(0, ...records.filter((d) => !d.archivedAt).map((d) => d.position));
  const nameTaken = (name: string, except?: string) =>
    records.some((d) => d.id !== except && d.name.toLowerCase() === name.trim().toLowerCase());
  const join = (user: UserResponse, d: DepartmentRecord, primary: boolean) => {
    const others = user.departments
      .filter((x) => x.id !== d.id)
      .map((x) => (primary ? { ...x, isPrimary: false } : x));
    const kept = user.departments.find((x) => x.id === d.id);
    user.departments = [
      ...others,
      {
        id: d.id,
        code: d.code,
        name: d.name,
        isPrimary: primary || (kept?.isPrimary ?? false),
        isManager: managers.get(d.id) === user.id,
      },
    ];
  };

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    if (path === '/api/departments' && method === 'GET') {
      return json(route, { items: ordered().map(departmentOf) });
    }
    if (path === '/api/departments' && method === 'POST') {
      if (!scopes('departments.manage').length) return fail(route, 403, null);
      const body = request.postDataJSON() as CreateDepartment;
      if (nameTaken(body.name)) return fail(route, 409, 'DEPARTMENT_NAME_TAKEN');
      const n = records.length + 1;
      const created: DepartmentRecord = {
        id: id(950 + n),
        code: `d_test${n.toString().padStart(4, 'a')}`,
        name: body.name.trim(),
        description: body.description || null,
        color: body.color,
        icon: body.icon,
        position: lastPosition() + 1,
        archivedAt: null,
        archivedById: null,
      };
      records.push(created);
      managers.set(created.id, null);
      return json(route, detailOf(created), 201);
    }
    if (path === '/api/departments/order' && method === 'PUT') {
      if (!scopes('users.manage').length) return fail(route, 403, null);
      const { ids } = request.postDataJSON() as { ids: string[] };
      const active = records.filter((d) => !d.archivedAt);
      if (ids.length !== active.length || active.some((d) => !ids.includes(d.id))) {
        return fail(route, 409, 'DEPARTMENT_ORDER_MISMATCH');
      }
      for (const [index, departmentId] of ids.entries()) {
        const department = records.find((d) => d.id === departmentId);
        if (department) department.position = index + 1;
      }
      return json(route, { items: ordered().map(departmentOf) });
    }
    const match = path.match(/^\/api\/departments\/([^/]+)(?:\/(.+))?$/);
    if (!match) return undefined;
    const department = records.find((d) => d.id === match[1]);
    if (!department) return fail(route, 404, null);
    const action = match[2];
    if (!action && method === 'GET') return json(route, detailOf(department));

    if (action === 'overview') {
      if (department.archivedAt) return fail(route, 409, 'DEPARTMENT_ARCHIVED');
      const week = weekOf(PROJECTS_TODAY);
      const own = openTasks(department);
      const members = membersOf(department);
      // Rule 25, as reports scope it: everything, or the departments the caller manages.
      const reads =
        scopes('reports.read').includes('all') ||
        (scopes('reports.read').includes('department') &&
          me().departments.some((x) => x.id === department.id && x.isManager));
      const workload = (list: TaskRecord[]) => ({
        open: list.length,
        dueThisWeek: list.filter((t) => t.dueDate >= week.from && t.dueDate <= week.to).length,
        overdue: list.filter(tasksApi.overdue).length,
      });
      const open = tasks.filter((t) => !t.archived && isTaskOpen(t.status));
      const body: DepartmentOverview = {
        week,
        byStatus: OPEN_TASK_STATUSES.map((status) => ({
          status,
          count: own.filter((t) => t.status === status).length,
        })),
        overdue: workload(own).overdue,
        dueThisWeek: workload(own).dueThisWeek,
        unassigned: own.filter((t) => t.assigneeId === null).length,
        services: services(department).filter((service) => !service.archivedAt).length,
        projects: engagements(department).filter((e) => projects.some((p) => p.id === e.id)).length,
        retainers: engagements(department).filter((e) => retainers.some((r) => r.id === e.id))
          .length,
        ...(reads && {
          members: members.map((u) => ({
            user: person(u),
            ...workload(open.filter((t) => t.assigneeId === u.id)),
          })),
          onLeave: members.slice(0, 1).map((u) => ({
            user: person(u),
            startsOn: PROJECTS_TODAY,
            endsOn: addDays(PROJECTS_TODAY, 2),
          })),
        }),
      };
      return json(route, body);
    }

    const manages = scopes('users.manage').length > 0;
    const archives = scopes('departments.manage').length > 0;
    if (!action && method === 'PATCH') {
      if (!manages) return fail(route, 403, null);
      if (department.archivedAt) return fail(route, 409, 'DEPARTMENT_ARCHIVED');
      const body = request.postDataJSON() as UpdateDepartment;
      if (body.name !== undefined && nameTaken(body.name, department.id)) {
        return fail(route, 409, 'DEPARTMENT_NAME_TAKEN');
      }
      if (body.name !== undefined) department.name = body.name.trim();
      if (body.description !== undefined) department.description = body.description || null;
      if (body.color) department.color = body.color;
      if (body.icon) department.icon = body.icon;
      if (body.managerId !== undefined) managers.set(department.id, body.managerId);
      syncManagers();
      return json(route, detailOf(department));
    }
    if (action === 'archive-preview') {
      if (!archives) return fail(route, 403, null);
      if (department.archivedAt) return fail(route, 409, 'DEPARTMENT_ARCHIVED');
      return json(route, preview(department));
    }
    if (action === 'archive') {
      if (!archives) return fail(route, 403, null);
      if (department.archivedAt) return fail(route, 409, 'DEPARTMENT_ARCHIVED');
      const { targets } = request.postDataJSON() as ArchiveDepartment;
      const target = (category: DepartmentTransferCategory) =>
        records.find((d) => d.id === targets[category]);
      for (const { category, count } of preview(department).categories) {
        const chosen = target(category);
        if (count > 0 && !targets[category]) return fail(route, 409, 'TRANSFER_TARGET_REQUIRED');
        if (targets[category] && (!chosen || chosen.archivedAt || chosen.id === department.id)) {
          return fail(route, 409, 'INVALID_TRANSFER_TARGET');
        }
      }
      managers.set(department.id, null);
      const people = target('members');
      for (const user of membersOf(department)) {
        const primary = user.departments.find((x) => x.id === department.id)?.isPrimary ?? false;
        user.departments = user.departments.filter((x) => x.id !== department.id);
        if (primary && people) join(user, people, true);
      }
      const work = target('tasks');
      if (work) for (const task of openTasks(department)) task.department = work.code;
      const performer = target('services');
      if (performer)
        for (const service of services(department)) service.department = performer.code;
      const engagement = target('engagements');
      if (engagement) {
        for (const record of engagements(department)) {
          record.departments = [
            ...new Set(
              record.departments.map((code) => (code === department.code ? engagement.code : code)),
            ),
          ];
        }
      }
      department.archivedAt = '2026-10-10T09:00:00.000Z';
      department.archivedById = me().user.id;
      syncManagers();
      return json(route, detailOf(department));
    }
    if (action === 'restore') {
      if (!archives) return fail(route, 403, null);
      if (!department.archivedAt) return fail(route, 409, 'DEPARTMENT_NOT_ARCHIVED');
      department.position = lastPosition() + 1;
      department.archivedAt = null;
      department.archivedById = null;
      return json(route, detailOf(department));
    }

    // Members (rules 17–21).
    if (!manages) return fail(route, 403, null);
    if (department.archivedAt) return fail(route, 409, 'DEPARTMENT_ARCHIVED');
    if (action === 'members' && method === 'POST') {
      const { userIds } = request.postDataJSON() as { userIds: string[] };
      const joining = users.filter((u) => userIds.includes(u.id));
      if (joining.some((u) => u.status === 'archived')) return fail(route, 409, 'USER_ARCHIVED');
      if (joining.some((u) => u.departments.some((x) => x.id === department.id))) {
        return fail(route, 409, 'ALREADY_MEMBER');
      }
      for (const user of joining) join(user, department, false);
      return json(route, detailOf(department));
    }
    const memberMatch = action?.match(/^members\/([^/]+)(?:\/(primary|move))?$/);
    if (!memberMatch) return undefined;
    const user = membersOf(department).find((u) => u.id === memberMatch[1]);
    if (!user) return fail(route, 404, null);
    const membership = user.departments.find((x) => x.id === department.id);
    const isManager = managers.get(department.id) === user.id;
    if (memberMatch[2] === 'primary') {
      join(user, department, true);
      return json(route, detailOf(department));
    }
    if (isManager) return fail(route, 409, 'MANAGER_MEMBERSHIP_REQUIRED');
    if (memberMatch[2] === 'move') {
      const { departmentId } = request.postDataJSON() as { departmentId: string };
      const next = records.find((d) => d.id === departmentId);
      if (!next || next.archivedAt || next.id === department.id) {
        return fail(route, 409, 'INVALID_TRANSFER_TARGET');
      }
      user.departments = user.departments.filter((x) => x.id !== department.id);
      join(user, next, membership?.isPrimary ?? false);
      return json(route, detailOf(department));
    }
    if (method === 'DELETE') {
      if (membership?.isPrimary) return fail(route, 400, 'PRIMARY_DEPARTMENT_REQUIRED');
      user.departments = user.departments.filter((x) => x.id !== department.id);
      return json(route, detailOf(department));
    }
    return undefined;
  };
}

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
  const named = (record: { id: string; name: string }) => ({
    id: record.id,
    name: record.name,
    imageId: null,
  });
  const clientNamed = (clientId: string) => ({
    id: clientId,
    name: clients.find((c) => c.id === clientId)?.tradeName ?? '',
    imageId: null,
  });
  const userNamed = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
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
      ? departmentsSeed.map((d) => d.code)
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
      departments: departmentsSeed.map(({ code: department }) => {
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
          cycleId:
            retainers
              .find((r) => r.id === id(901))
              ?.cycles.find((c) => c.number === (cycleAt('2026-03-01', `${month}-01`) ?? 1))?.id ??
            id(921),
          backdated: false,
          // From 1 March, each calendar month is one cycle (R4).
          cycle: cycleAt('2026-03-01', `${month}-01`) ?? 1,
          ...cyclePeriod('2026-03-01', cycleAt('2026-03-01', `${month}-01`) ?? 1),
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

  /** F05C screen 9: a cycle of a retainer with the client's activity of the matching month. */
  const cycleSummaries = new Map<string, NonNullable<CycleReport['summary']>>();
  const cycleReport = (
    retainer: (typeof retainers)[number],
    cycle: (typeof retainers)[number]['cycles'][number],
  ): CycleReport => {
    const month = clientReport(retainer.clientId, cycle.periodEnd.slice(0, 7));
    const lines = cycle.lines.map((line) => {
      const delivered = cycle.untracked
        ? null
        : (line.deliveredAtClose ?? line.adjustments.reduce((sum, a) => sum + a.delta, 0));
      return {
        kind: line.kind,
        label: line.label,
        committed: line.committed,
        delivered,
        percent:
          delivered === null ? null : deliveryRate([{ committed: line.committed, delivered }]),
      };
    });
    const next = cyclePeriod(retainer.startDate, cycle.number + 1);
    const summary = cycleSummaries.get(cycle.id) ?? null;
    return {
      client: month.client,
      retainer: named(retainer),
      cycle: { id: cycle.id, number: cycle.number, status: cycle.status },
      period: { from: cycle.periodStart, to: cycle.periodEnd },
      preliminary: cycle.status === 'open',
      summary: summary?.text ? summary : null,
      lines,
      deliveryRate: cycle.untracked
        ? null
        : deliveryRate(lines.map((l) => ({ committed: l.committed, delivered: l.delivered ?? 0 }))),
      deliveredWork: month.deliveredWork,
      posts: month.posts,
      shoots: month.shoots,
      approvals: month.approvals,
      campaigns: month.campaigns,
      adBudget: month.adBudget,
      nextPeriod: { ...month.nextMonth, period: { from: next.periodStart, to: next.periodEnd } },
      empty: month.empty && !summary?.text,
    };
  };
  const cyclePdfs = new Set<string>();

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
    const cycled = path.match(/^\/api\/retainers\/([^/]+)\/cycles\/([^/]+)\/report(?:\/(.+))?$/);
    if (cycled) {
      const [, retainerId, cycleId = '', action] = cycled;
      if (!holds('reports.read')) return fail(route, 403, null);
      const retainer = retainers.find((r) => r.id === retainerId);
      const cycle = retainer?.cycles.find((c) => c.id === cycleId);
      if (!retainer || !cycle || cycle.backdated || !readsClient(retainer.clientId)) {
        return fail(route, 404, null);
      }
      if (!action) return json(route, cycleReport(retainer, cycle));
      if (action === 'export') return workbook();
      if (action === 'summary' && method === 'PUT') {
        const input = updateCycleReportSummarySchema.parse(request.postDataJSON());
        cycleSummaries.set(cycle.id, {
          text: input.summary,
          updatedBy: userNamed(me().user.id),
          updatedAt: new Date().toISOString(),
        });
        cyclePdfs.delete(cycle.id);
        return json(route, cycleReport(retainer, cycle));
      }
      if (action === 'pdf' && method === 'POST') {
        cyclePdfs.add(cycle.id);
        return json(route, { state: 'ready' });
      }
      if (action === 'pdf') {
        if (!cyclePdfs.has(cycle.id)) return fail(route, 404, null);
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: MOCK_PDF });
      }
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
  nour: id(5),
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
  socialTaskTemplate: id(2400),
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

/** An employee file as the HR mock keeps it (F17 part A): every section, cut by rule A2. */
interface EmployeeRecord {
  userId: string;
  personal: EmployeePersonal;
  /** The passkey's state comes from the attendance mocks. */
  employment: Omit<EmployeeEmployment, 'passkey'>;
  payout: Omit<EmployeePay, 'currentSalary'>;
}

const MAIN_SCHEDULE = { id: id(9801), name: 'الدوام الرئيسي' };

/** The seeded schedule (Saturday to Thursday, 09:00 for 8 hours) and a flexible one. */
function schedulesSeed(): Omit<WorkSchedule, 'employees'>[] {
  const day = (
    weekday: WorkSchedule['days'][number]['weekday'],
    latestStartTime: string | null,
  ) => ({
    weekday,
    startTime: '09:00',
    latestStartTime,
    requiredMinutes: 480,
  });
  const created = '2026-10-01T09:00:00.000Z';
  return [
    {
      ...MAIN_SCHEDULE,
      kind: 'fixed',
      isDefault: true,
      days: (['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] as const).map(
        (weekday) => day(weekday, null),
      ),
      createdAt: created,
      updatedAt: created,
      archivedAt: null,
    },
    {
      id: id(9802),
      name: 'دوام مرن',
      kind: 'flexible',
      isDefault: false,
      days: (['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'] as const).map((weekday) =>
        day(weekday, '10:30'),
      ),
      createdAt: created,
      updatedAt: created,
      archivedAt: null,
    },
  ];
}

/** The public holidays of 2026 (F17 rule B3), typed by HR. */
export function holidaysSeed(): Holiday[] {
  const holiday = (n: number, name: string, startsOn: string, endsOn: string, paid = true) => ({
    id: id(n),
    name,
    startsOn,
    endsOn,
    paid,
    createdAt: '2026-01-05T09:00:00.000Z',
    updatedAt: '2026-01-05T09:00:00.000Z',
    archivedAt: null,
  });
  return [
    holiday(9821, 'عيد الفطر', '2026-03-20', '2026-03-22'),
    holiday(9822, 'عيد العمال', '2026-05-01', '2026-05-01'),
    holiday(9823, 'عيد الأضحى', '2026-05-26', '2026-05-29'),
    holiday(9824, 'ذكرى حرب تشرين', '2026-10-06', '2026-10-06'),
    holiday(9825, 'عيد الميلاد', '2026-12-25', '2026-12-25', false),
  ];
}

/** The seeded HR settings: the column defaults (spec, `hr_settings`). */
const HR_SETTINGS: HrSettings = {
  // Attendance counts from October (rule C1), so the month shows real statuses and items.
  attendanceStartsOn: '2026-10-01',
  graceMinutes: 10,
  latenessTiers: [
    { upToMinutes: 30, fraction: 0.25 },
    { upToMinutes: 60, fraction: 0.5 },
    { upToMinutes: null, fraction: 1 },
  ],
  firstLatenessWarning: true,
  overtimeMinMinutes: 30,
  checkInReminderMinutes: 15,
  defaultAnnualLeaveDays: 14,
  carryOverMaxDays: 5,
  sickDaysPerYear: 14,
  sickCertificateAfterDays: 2,
  sickRequestWithinWorkDays: 3,
  emergencyDaysPerYear: 3,
  permissionMaxMinutes: 120,
  permissionsPerMonth: 4,
  annualNoticeWorkDays: 3,
  remoteNoticeWorkDays: 1,
  overtimeMinutesPerLeaveDay: 480,
};

/** The HR tests' clock (F17): the mock's "today" for current salaries and ends of service. */
export const HR_NOW = '2026-10-21T09:00:00+03:00';
const HR_TODAY = businessDate(new Date(HR_NOW));

/** The files of the team: Karim's is complete, the others as a fresh migration leaves them. */
export function employeesSeed(users: UserResponse[]): {
  files: EmployeeRecord[];
  salaries: SalaryChange[];
} {
  const blank = (userId: string): EmployeeRecord => ({
    userId,
    personal: {
      nationalId: null,
      birthDate: null,
      address: null,
      emergencyName: null,
      emergencyPhone: null,
      emergencyRelation: null,
    },
    employment: {
      employmentType: 'full_time',
      startDate: null,
      probationEndDate: null,
      contractEndDate: null,
      schedule: MAIN_SCHEDULE,
      attendanceExempt: false,
      remoteWeekdays: [],
      annualLeaveDays: 14,
      endedOn: null,
      endReason: null,
      endNote: null,
    },
    payout: {
      payoutMethod: null,
      payoutInstitution: null,
      payoutAccount: null,
      payoutHolder: null,
    },
  });
  const files = users.map((u) => blank(u.id));
  const karim = files.find((f) => f.userId === id(4));
  if (karim) {
    karim.personal = {
      nationalId: '01020304050',
      birthDate: '1996-04-12',
      address: 'دمشق، المزة، شارع الجلاء',
      emergencyName: 'منى الزين',
      emergencyPhone: '+963944555666',
      emergencyRelation: 'أخت',
    };
    karim.employment = {
      ...karim.employment,
      startDate: '2025-03-01',
      probationEndDate: '2025-05-31',
      contractEndDate: '2026-12-31',
      remoteWeekdays: ['thursday'],
    };
    karim.payout = {
      payoutMethod: 'bank_transfer',
      payoutInstitution: 'بنك سورية الدولي الإسلامي',
      payoutAccount: 'SY21 0123 4567 8901 2345',
      payoutHolder: 'كريم الزين',
    };
  }
  const layan = files.find((f) => f.userId === id(3));
  if (layan) {
    layan.employment = {
      ...layan.employment,
      employmentType: 'part_time',
      startDate: '2024-09-15',
      endedOn: '2026-11-30',
      endReason: 'resigned',
      endNote: 'انتقال إلى مدينة أخرى',
    };
  }
  const salary = (
    n: number,
    effectiveOn: string,
    amountMinor: number,
    reason: string,
    archived?: string,
  ): SalaryChange => ({
    id: id(n),
    userId: id(4),
    effectiveOn,
    amountMinor,
    currency: 'USD',
    reason,
    createdBy: { id: id(1), name: 'سارة الخطيب', imageId: null },
    createdAt: `${effectiveOn}T09:00:00.000Z`,
    archivedAt: archived ? `${effectiveOn}T10:00:00.000Z` : null,
    archiveReason: archived ?? null,
  });
  return {
    files,
    salaries: [
      salary(9811, '2026-03-01', 75_000, 'زيادة سنوية'),
      salary(9812, '2026-02-01', 70_000, 'زيادة سنوية', 'أُدخل المبلغ خطأً'),
      salary(9813, '2025-03-01', 60_000, 'راتب البداية'),
    ],
  };
}

/**
 * HR (F17): People, the employee file, pay and the end of service (part A); work schedules,
 * public holidays and the HR settings (part B).
 */
function hrRoutes({
  users,
  holidays,
  staff,
  settings: shared,
  passkeyOf,
  me,
}: {
  users: UserResponse[];
  holidays: Holiday[];
  staff: ReturnType<typeof employeesSeed>;
  settings: { current: HrSettings };
  passkeyOf: (userId: string) => PasskeyState;
  me: () => MeResponse;
}) {
  const { files, salaries } = staff;
  const schedules = schedulesSeed();
  let next = 9850;
  const holds = (permission: Permission) =>
    me().permissions.some((granted) => granted.permission === permission);
  const statusOf = (file: EmployeeRecord): EmployeeStatus =>
    employeeStatus({
      archived: users.find((u) => u.id === file.userId)?.status === 'archived',
      endedOn: file.employment.endedOn,
    });
  /** Rule A2: the sections the caller sees, or undefined for a 404. */
  const view = (file: EmployeeRecord): EmployeeFile | undefined => {
    const self = file.userId === me().user.id;
    const showFile = self || holds('employees.read');
    const showPay = self || holds('salaries.read');
    if (!showFile && !showPay) return undefined;
    const user = users.find((u) => u.id === file.userId);
    const changes = salaries.filter((s) => s.userId === file.userId);
    return {
      userId: file.userId,
      name: user?.name ?? '',
      title: user?.title ?? null,
      departments: user?.departments ?? [],
      status: statusOf(file),
      ...(showFile && {
        personal: file.personal,
        employment: { ...file.employment, passkey: passkeyOf(file.userId) },
      }),
      ...(showPay && {
        pay: {
          ...file.payout,
          currentSalary: currentSalary(
            changes.map((s) => ({ ...s, archived: s.archivedAt !== null })),
            HR_TODAY,
          ),
        },
      }),
      imageId: null,
    };
  };

  const scheduleOf = (schedule: Omit<WorkSchedule, 'employees'>): WorkSchedule => ({
    ...schedule,
    employees: files.filter(
      (f) => f.employment.schedule.id === schedule.id && statusOf(f) !== 'ended',
    ).length,
  });
  const nameTaken = (name: string, except?: string) =>
    schedules.some((s) => s.id !== except && s.name.toLowerCase() === name.toLowerCase());
  const overlaps = (range: { startsOn: string; endsOn: string }, except?: string) =>
    holidays.some(
      (h) =>
        h.id !== except &&
        !h.archivedAt &&
        h.startsOn <= range.endsOn &&
        h.endsOn >= range.startsOn,
    );

  /** Part B: schedules (rule B2), holidays (rule B3) and the settings. */
  const rulesRoute = (
    route: Route,
    method: string,
    path: string,
    q: URLSearchParams,
    request: Request,
  ): Promise<void> | undefined => {
    const now = new Date().toISOString();
    if (path === '/api/hr/schedules' && method === 'GET') {
      if (!holds('hr.read')) return fail(route, 403, null);
      const items = schedules
        .filter((s) => !s.archivedAt)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name))
        .map(scheduleOf);
      return json(route, { items } satisfies WorkScheduleList);
    }
    if (path === '/api/hr/holidays' && method === 'GET') {
      const year = q.get('year') ?? '';
      const items = holidays
        .filter(
          (h) => !h.archivedAt && h.startsOn <= `${year}-12-31` && h.endsOn >= `${year}-01-01`,
        )
        .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
      return json(route, { items } satisfies HolidayList);
    }
    if (path === '/api/hr/settings' && method === 'GET') {
      if (!holds('hr.read')) return fail(route, 403, null);
      return json(route, shared.current);
    }
    const isRule =
      path === '/api/hr/settings' ||
      path.startsWith('/api/hr/schedules') ||
      path.startsWith('/api/hr/holidays');
    if (!isRule) return undefined;
    if (!holds('hr.manage')) return fail(route, 403, null);

    if (path === '/api/hr/settings' && method === 'PUT') {
      shared.current = hrSettingsSchema.parse(request.postDataJSON());
      return json(route, shared.current);
    }
    if (path === '/api/hr/schedules' && method === 'POST') {
      const body = createWorkScheduleSchema.parse(request.postDataJSON());
      if (nameTaken(body.name)) return fail(route, 409, 'SCHEDULE_NAME_TAKEN');
      if (!scheduleTimesValid(body.kind, body.days)) return fail(route, 400, 'INVALID_TIMES');
      if (body.isDefault) for (const s of schedules) s.isDefault = false;
      const schedule = {
        id: id(next++),
        ...body,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      schedules.push(schedule);
      return json(route, scheduleOf(schedule), 201);
    }
    const scheduleMatch = path.match(/^\/api\/hr\/schedules\/([^/]+)(\/archive)?$/);
    if (scheduleMatch) {
      const schedule = schedules.find((s) => s.id === scheduleMatch[1] && !s.archivedAt);
      if (!schedule) return fail(route, 404, null);
      if (scheduleMatch[2] && method === 'POST') {
        if (schedule.isDefault) return fail(route, 409, 'DEFAULT_REQUIRED');
        if (scheduleOf(schedule).employees > 0) return fail(route, 409, 'SCHEDULE_IN_USE');
        schedule.archivedAt = now;
        return json(route, scheduleOf(schedule));
      }
      if (method !== 'PATCH') return undefined;
      const body = updateWorkScheduleSchema.parse(request.postDataJSON());
      if (body.name !== undefined && nameTaken(body.name, schedule.id)) {
        return fail(route, 409, 'SCHEDULE_NAME_TAKEN');
      }
      if (schedule.isDefault && body.isDefault === false) {
        return fail(route, 409, 'DEFAULT_REQUIRED');
      }
      const kind = body.kind ?? schedule.kind;
      if (!scheduleTimesValid(kind, body.days ?? schedule.days)) {
        return fail(route, 400, 'INVALID_TIMES');
      }
      if (body.isDefault) for (const s of schedules) s.isDefault = false;
      Object.assign(schedule, { ...body, isDefault: body.isDefault || schedule.isDefault });
      schedule.updatedAt = now;
      for (const f of files) {
        if (f.employment.schedule.id === schedule.id) {
          f.employment.schedule = { id: schedule.id, name: schedule.name };
        }
      }
      return json(route, scheduleOf(schedule));
    }

    if (path === '/api/hr/holidays' && method === 'POST') {
      const body = createHolidaySchema.parse(request.postDataJSON());
      if (!holidayRangeValid(body)) return fail(route, 400, 'INVALID_DATES');
      if (overlaps(body)) return fail(route, 409, 'HOLIDAY_OVERLAP');
      const holiday = { id: id(next++), ...body, createdAt: now, updatedAt: now, archivedAt: null };
      holidays.push(holiday);
      return json(route, holiday, 201);
    }
    if (path === '/api/hr/holidays/repeat' && method === 'POST') {
      const { year } = repeatHolidaysSchema.parse(request.postDataJSON());
      const copies: Holiday[] = [];
      for (const h of holidays.filter(
        (h) => !h.archivedAt && h.startsOn.startsWith(`${year - 1}-`),
      )) {
        const range = shiftedHoliday(h, 1);
        if (overlaps(range)) continue;
        const copy = {
          ...h,
          id: id(next++),
          ...range,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        };
        holidays.push(copy);
        copies.push(copy);
      }
      return json(route, { items: copies } satisfies HolidayList, 201);
    }
    const holidayMatch = path.match(/^\/api\/hr\/holidays\/([^/]+)(\/archive)?$/);
    if (holidayMatch) {
      const holiday = holidays.find((h) => h.id === holidayMatch[1] && !h.archivedAt);
      if (!holiday) return fail(route, 404, null);
      if (holidayMatch[2] && method === 'POST') {
        holiday.archivedAt = now;
        return json(route, holiday);
      }
      if (method !== 'PATCH') return undefined;
      const body = updateHolidaySchema.parse(request.postDataJSON());
      const merged = { ...holiday, ...body };
      if (!holidayRangeValid(merged)) return fail(route, 400, 'INVALID_DATES');
      if (overlaps(merged, holiday.id)) return fail(route, 409, 'HOLIDAY_OVERLAP');
      Object.assign(holiday, body, { updatedAt: now });
      return json(route, holiday);
    }
    return undefined;
  };

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const q = url.searchParams;

    // Documents of an employee file (rule A6): none seeded.
    if (path === '/api/files/items' && method === 'GET' && q.get('ownerType') === 'employee') {
      const file = files.find((f) => f.userId === q.get('ownerId'));
      if (!file || !view(file)) return fail(route, 404, null);
      const live = statusOf(file) !== 'ended';
      return json(route, {
        items: [],
        rights: {
          canAddDeliverable: false,
          canAddReference: false,
          canManageDocuments: live && (holds('employees.manage') || holds('salaries.read')),
          canSetConfidential: live && holds('salaries.read'),
          canSeeRemoved: holds('employees.manage'),
        },
      } satisfies FileItemList);
    }

    if (!path.startsWith('/api/hr/')) return undefined;

    const rules = rulesRoute(route, method, path, q, request);
    if (rules) return rules;

    if (path === '/api/hr/employees' && method === 'GET') {
      if (!holds('employees.read') && !holds('salaries.read')) return fail(route, 403, null);
      const search = q.get('search')?.toLowerCase();
      const status = (q.get('status') as EmployeeStatus | null) ?? 'active';
      const page = Number(q.get('page') ?? 1);
      const pageSize = Number(q.get('pageSize') ?? 25);
      const rows = files
        .map(view)
        .filter((row): row is EmployeeFile => !!row)
        .filter(
          (row) =>
            (status === 'ended' ? row.status === 'ended' : row.status !== 'ended') &&
            (!q.get('departmentId') ||
              row.departments.some((d) => d.id === q.get('departmentId'))) &&
            (!search ||
              row.name.toLowerCase().includes(search) ||
              (users.find((u) => u.id === row.userId)?.email ?? '').includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
        .map(({ personal: _personal, ...row }) => row);
      return json(route, {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      } satisfies EmployeePage);
    }

    const archiveMatch = path.match(/^\/api\/hr\/salaries\/([^/]+)\/archive$/);
    if (archiveMatch && method === 'POST') {
      if (!holds('salaries.manage')) return fail(route, 403, null);
      const change = salaries.find((s) => s.id === archiveMatch[1]);
      if (!change) return fail(route, 404, null);
      const body = request.postDataJSON() as { reason: string };
      change.archivedAt = new Date().toISOString();
      change.archiveReason = body.reason;
      return json(route, change);
    }

    const match = path.match(/^\/api\/hr\/employees\/([^/]+)(\/[a-z]+)?$/);
    if (!match) return undefined;
    const file = files.find((f) => f.userId === match[1]);
    if (!file) return fail(route, 404, null);
    const action = match[2] ?? '';

    if (action === '' && method === 'GET') {
      const shown = view(file);
      return shown ? json(route, shown) : fail(route, 404, null);
    }
    if (action === '/salaries' && method === 'GET') {
      if (file.userId !== me().user.id && !holds('salaries.read')) return fail(route, 404, null);
      const items = salaries
        .filter((s) => s.userId === file.userId)
        .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn));
      return json(route, { items } satisfies SalaryChangeList);
    }

    const permission: Permission =
      action === '/payout'
        ? 'payouts.manage'
        : action === '/salaries'
          ? 'salaries.manage'
          : 'employees.manage';
    if (!holds(permission)) return fail(route, 403, null);
    if (statusOf(file) === 'ended') return fail(route, 409, 'USER_ARCHIVED');

    if (action === '' && method === 'PATCH') {
      const body = updateEmployeeFileSchema.parse(request.postDataJSON());
      const { scheduleId, ...changes } = body;
      if (scheduleId !== undefined && scheduleId !== file.employment.schedule.id) {
        const schedule = schedules.find((s) => s.id === scheduleId);
        if (!schedule) return fail(route, 404, null);
        if (schedule.archivedAt) return fail(route, 409, 'SCHEDULE_ARCHIVED');
        file.employment.schedule = { id: schedule.id, name: schedule.name };
      }
      const personal = Object.fromEntries(
        Object.entries(changes).filter(([key]) => key in file.personal),
      );
      const employment = Object.fromEntries(
        Object.entries(changes).filter(([key]) => key in file.employment),
      );
      const updated = { ...file.employment, ...employment };
      if (!fileDatesValid(updated)) return fail(route, 400, 'INVALID_DATES');
      file.personal = { ...file.personal, ...personal };
      file.employment = updated;
      return json(route, view(file));
    }
    if (action === '/payout' && method === 'PUT') {
      const body = payoutSchema.parse(request.postDataJSON());
      file.payout = {
        payoutMethod: body.method,
        payoutInstitution: body.institution,
        payoutAccount: body.account,
        payoutHolder: body.holder,
      };
      return json(route, view(file));
    }
    if (action === '/end' && method === 'POST') {
      if (file.employment.endedOn) return fail(route, 409, 'ALREADY_ENDED');
      const body = endServiceSchema.parse(request.postDataJSON());
      if (body.endedOn < HR_TODAY) return fail(route, 400, 'INVALID_DATES');
      file.employment = {
        ...file.employment,
        endedOn: body.endedOn,
        endReason: body.reason,
        endNote: body.note ?? null,
      };
      return json(route, view(file));
    }
    if (action === '/end' && method === 'DELETE') {
      file.employment = { ...file.employment, endedOn: null, endReason: null, endNote: null };
      return json(route, view(file));
    }
    if (action === '/salaries' && method === 'POST') {
      const body = createSalaryChangeSchema.parse(request.postDataJSON());
      const taken = salaries.some(
        (s) => s.userId === file.userId && !s.archivedAt && s.effectiveOn === body.effectiveOn,
      );
      if (taken) return fail(route, 409, 'DUPLICATE_EFFECTIVE_DATE');
      const change: SalaryChange = {
        id: id(next++),
        userId: file.userId,
        ...body,
        createdBy: { id: me().user.id, name: me().user.name, imageId: null },
        createdAt: new Date().toISOString(),
        archivedAt: null,
        archiveReason: null,
      };
      salaries.push(change);
      return json(route, change, 201);
    }
    return undefined;
  };
}
// F17 part B: leave balances, requests, decisions and opinions.

/** A request as the mock keeps it: the response shape and its owner's opinions. */
type HrRequestRecord = HrRequest & { opinions: HrOpinion[] };

export interface LeaveState {
  requests: HrRequestRecord[];
  /** Extra ledger rows (adjustments, openings, taken days) on top of each user's base rows. */
  ledger: (LedgerRow & { userId: string })[];
}

/** The main schedule's work days (`schedulesSeed`): Saturday to Thursday. */
const LEAVE_WEEKDAYS: Weekday[] = [
  'saturday',
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
];

/**
 * Basel's sick leave and Layan's and Karim's annual leaves wait for the GM; Karim's annual leave
 * next week is approved (on the calendar, rule B16).
 */
export function leaveSeed(users: UserResponse[]): LeaveState {
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const request = (
    n: number,
    userId: string,
    fields: Partial<HrRequest> &
      Pick<HrRequest, 'leaveType' | 'startsOn' | 'endsOn' | 'days' | 'status'>,
    createdAt: string,
  ): HrRequestRecord => ({
    id: id(n),
    user: person(userId),
    kind: 'leave',
    half: null,
    fromTime: null,
    toTime: null,
    correctionDirection: null,
    paidDays: fields.leaveType === 'unpaid' ? 0 : fields.days,
    unpaidDays: fields.leaveType === 'unpaid' ? fields.days : 0,
    reason: null,
    shortNotice: false,
    certificateRequired: false,
    documents: 0,
    createdBy: person(userId),
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt,
    updatedAt: createdAt,
    opinions: [],
    ...fields,
  });
  const sara = id(1);
  return {
    requests: [
      request(
        9861,
        id(6),
        {
          leaveType: 'sick',
          startsOn: '2026-10-19',
          endsOn: '2026-10-21',
          days: 3,
          status: 'pending',
          reason: 'إنفلونزا',
          certificateRequired: true,
        },
        '2026-10-19T08:00:00.000Z',
      ),
      request(
        9862,
        id(3),
        {
          leaveType: 'annual',
          startsOn: '2026-11-15',
          endsOn: '2026-11-16',
          days: 2,
          status: 'pending',
        },
        '2026-10-20T08:00:00.000Z',
      ),
      request(
        9863,
        id(4),
        {
          leaveType: 'annual',
          startsOn: '2026-10-25',
          endsOn: '2026-10-26',
          days: 2,
          status: 'approved',
          decidedBy: person(sara),
          decidedAt: '2026-10-15T10:00:00.000Z',
        },
        '2026-10-14T08:00:00.000Z',
      ),
      request(
        9864,
        id(4),
        {
          leaveType: 'annual',
          startsOn: '2026-11-08',
          endsOn: '2026-11-09',
          days: 2,
          status: 'pending',
        },
        '2026-10-21T05:00:00.000Z',
      ),
    ],
    // The days of Karim's approved leave, taken from his annual balance.
    ledger: [
      {
        id: id(9865),
        userId: id(4),
        leaveType: 'annual',
        year: 2026,
        days: -2,
        entry: 'taken',
        period: null,
        requestId: id(9863),
        itemId: null,
        note: null,
        createdBy: person(sara),
        createdAt: '2026-10-15T10:00:00.000Z',
      },
    ],
  };
}

/** The approved leaves of the calendar range (rule B16), the type only for `hr.read` or self. */
function calendarLeaves(
  leave: LeaveState,
  range: { from: string; to: string },
  me: MeResponse,
): CalendarLeave[] {
  const readsHr = me.permissions.some((g) => g.permission === 'hr.read');
  return leave.requests
    .filter(
      (r) =>
        r.kind === 'leave' &&
        r.status === 'approved' &&
        r.startsOn <= range.to &&
        r.endsOn >= range.from,
    )
    .map((r) => ({
      requestId: r.id,
      user: r.user,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
      half: r.half,
      leaveType: readsHr || r.user.id === me.user.id ? r.leaveType : null,
    }));
}

/** Rule B17: the assignee's approved leaves covering a due date. */
export function assigneeLeavesOn(leave: LeaveState, userId: string, date: string): AssigneeLeave[] {
  return leave.requests
    .filter(
      (r) =>
        r.user.id === userId &&
        r.kind === 'leave' &&
        r.status === 'approved' &&
        r.startsOn <= date &&
        date <= r.endsOn,
    )
    .map((r) => ({ startsOn: r.startsOn, endsOn: r.endsOn }));
}

function leaveRoutes({
  users,
  holidays,
  leave,
  me,
}: {
  users: UserResponse[];
  holidays: Holiday[];
  leave: LeaveState;
  me: () => MeResponse;
}) {
  let next = 9870;
  const now = () => new Date(HR_NOW).toISOString();
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const scopesOf = (permission: Permission) =>
    me().permissions.find((g) => g.permission === permission)?.scopes ?? [];
  const approver = () => scopesOf('hr.approve').length > 0;
  /** `hr.read` covering the user: everyone, or the members of the departments one manages. */
  const covers = (userId: string) => {
    const scopes = scopesOf('hr.read');
    if (scopes.includes('all')) return true;
    if (!scopes.includes('department')) return false;
    const managed = me()
      .departments.filter((d) => d.isManager)
      .map((d) => d.id);
    return !!users.find((u) => u.id === userId)?.departments.some((d) => managed.includes(d.id));
  };
  const readable = (r: HrRequestRecord) => r.user.id === me().user.id || covers(r.user.id);
  const live = (r: HrRequestRecord) => r.status === 'pending' || r.status === 'approved';
  const plain = ({ opinions: _opinions, ...r }: HrRequestRecord): HrRequest => r;

  /** Accruals and grants of the year, then the rows the requests and adjustments added. */
  const ledgerOf = (userId: string, year: number): LedgerRow[] => {
    const base: LedgerRow[] =
      year === 2026
        ? [
            ...Array.from({ length: 9 }, (_, month) => ({
              id: id(20_000 + Number(userId.slice(-4)) * 20 + month),
              leaveType: 'annual' as const,
              year,
              days: 1,
              entry: 'accrual' as const,
              period: `2026-${String(month + 1).padStart(2, '0')}`,
              requestId: null,
              itemId: null,
              note: null,
              createdBy: null,
              createdAt: `2026-${String(month + 2).padStart(2, '0')}-01T00:10:00.000Z`,
            })),
            ...(['sick', 'emergency'] as const).map((leaveType, index) => ({
              id: id(20_000 + Number(userId.slice(-4)) * 20 + 10 + index),
              leaveType,
              year,
              days: leaveType === 'sick' ? 14 : 3,
              entry: 'grant' as const,
              period: null,
              requestId: null,
              itemId: null,
              note: null,
              createdBy: null,
              createdAt: '2026-01-01T00:10:00.000Z',
            })),
          ]
        : [];
    const extra = leave.ledger
      .filter((row) => row.userId === userId && row.year === year)
      .map(({ userId: _userId, ...row }) => row);
    return [...base, ...extra].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  const pendingDays = (userId: string, type: BalanceLeaveType) =>
    sumDays(
      leave.requests
        .filter(
          (r) =>
            r.user.id === userId &&
            r.status === 'pending' &&
            (r.leaveType === type || (type === 'annual' && r.leaveType === 'emergency')),
        )
        .map((r) => r.paidDays ?? 0),
    );
  const balanceOf = (userId: string, year: number): LeaveBalance => {
    const ledger = ledgerOf(userId, year);
    const sum = (type: BalanceLeaveType, entries: LedgerRow['entry'][]) =>
      sumDays(
        ledger.filter((r) => r.leaveType === type && entries.includes(r.entry)).map((r) => r.days),
      );
    return {
      userId,
      year,
      balances: BALANCE_LEAVE_TYPES.map((leaveType) => {
        const balance = sumDays(ledger.filter((r) => r.leaveType === leaveType).map((r) => r.days));
        const pending = year === 2026 ? pendingDays(userId, leaveType) : 0;
        return {
          leaveType,
          balance,
          pending,
          available: sumDays([balance, -pending]),
          opening: sum(leaveType, ['opening']),
          accrued: sum(leaveType, ['accrual', 'grant']),
          carriedOver: sum(leaveType, ['carry_over']),
          taken: -sum(leaveType, ['taken', 'restored']),
          expired: -sum(leaveType, ['expiry']),
          adjusted: sum(leaveType, ['adjustment']),
        };
      }),
      ledger,
    };
  };
  const available = (userId: string) =>
    Object.fromEntries(
      balanceOf(userId, 2026).balances.map((b) => [b.leaveType, b.available]),
    ) as Record<BalanceLeaveType, number>;

  type Evaluated =
    | { error: [number, ErrorCode | null] }
    | { fields: Omit<HrRequest, 'id' | 'createdAt' | 'updatedAt'>; preview: HrRequestPreview };

  /** Rule C19 as far as the screens need it: a remote day's work days, a correction's moment. */
  const evaluateAttendanceRequest = (
    input: Extract<CreateHrRequest, { kind: 'remote_day' | 'correction' }>,
    userId: string,
  ): Evaluated => {
    const base = {
      user: person(userId),
      leaveType: null,
      half: null,
      reason: input.reason,
      status: approver() ? ('approved' as const) : ('pending' as const),
      documents: 0,
      certificateRequired: false,
      paidDays: null,
      unpaidDays: null,
      createdBy: person(me().user.id),
      decidedBy: approver() ? person(me().user.id) : null,
      decidedAt: approver() ? now() : null,
      decisionNote: null,
    };
    if (input.kind === 'correction') {
      if (`${input.date}T${input.time}` > HR_NOW.slice(0, 16)) return { error: [400, 'NOT_YET'] };
      return {
        fields: {
          ...base,
          kind: 'correction',
          startsOn: input.date,
          endsOn: input.date,
          fromTime: input.time,
          toTime: null,
          correctionDirection: input.direction,
          days: null,
          shortNotice: false,
        },
        preview: { days: null, paidDays: null, unpaidDays: null, shortNotice: false, warnings: [] },
      };
    }
    const units = leaveUnits(
      { startsOn: input.startsOn, endsOn: input.endsOn, half: null },
      LEAVE_WEEKDAYS,
      holidays,
    );
    if (units.length === 0) return { error: [400, 'NOT_A_WORK_DAY'] };
    const days = unitDays(units);
    // `remoteNoticeWorkDays` is 1: a remote day asked for today is short notice.
    const shortNotice = input.startsOn <= HR_TODAY;
    return {
      fields: {
        ...base,
        kind: 'remote_day',
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        fromTime: null,
        toTime: null,
        correctionDirection: null,
        days,
        shortNotice,
      },
      preview: {
        days,
        paidDays: null,
        unpaidDays: null,
        shortNotice,
        warnings: shortNotice ? ['short_notice'] : [],
      },
    };
  };

  /** Rules B8–B13 as far as the screens need them; the API tests cover the rest. */
  const evaluate = (input: CreateHrRequest): Evaluated => {
    const userId = input.userId ?? me().user.id;
    const forOther = userId !== me().user.id;
    if (forOther && !approver()) return { error: [403, null] };
    if (input.kind === 'remote_day' || input.kind === 'correction') {
      return evaluateAttendanceRequest(input, userId);
    }
    const span =
      input.kind === 'leave'
        ? { startsOn: input.startsOn, endsOn: input.endsOn, half: input.half }
        : { startsOn: input.date, endsOn: input.date, half: null };
    const overlap = leave.requests.some(
      (r) =>
        r.user.id === userId &&
        live(r) &&
        requestsOverlap(r, {
          kind: input.kind,
          ...span,
          fromTime: input.kind === 'permission' ? input.fromTime : null,
          toTime: input.kind === 'permission' ? input.toTime : null,
        }),
    );
    if (overlap) return { error: [409, 'REQUEST_OVERLAP'] };
    const late =
      !forOther &&
      span.startsOn < HR_TODAY &&
      (input.kind === 'permission' || input.leaveType === 'annual' || input.leaveType === 'unpaid');
    if (late) return { error: [409, 'TOO_LATE'] };
    const units = leaveUnits(span, LEAVE_WEEKDAYS, holidays);
    if (units.length === 0) return { error: [400, 'NOT_A_WORK_DAY'] };
    const base = {
      user: person(userId),
      kind: input.kind,
      startsOn: span.startsOn,
      endsOn: span.endsOn,
      half: span.half,
      correctionDirection: null,
      reason: input.reason,
      status: approver() ? ('approved' as const) : ('pending' as const),
      documents: 0,
      createdBy: person(me().user.id),
      decidedBy: approver() ? person(me().user.id) : null,
      decidedAt: approver() ? now() : null,
      decisionNote: null,
    };
    if (input.kind === 'permission') {
      if (permissionMinutes(input) > 120) return { error: [409, 'PERMISSION_LIMIT'] };
      const fields = {
        ...base,
        leaveType: null,
        fromTime: input.fromTime,
        toTime: input.toTime,
        days: null,
        paidDays: null,
        unpaidDays: null,
        shortNotice: false,
        certificateRequired: false,
      };
      return {
        fields,
        preview: { days: null, paidDays: null, unpaidDays: null, shortNotice: false, warnings: [] },
      };
    }
    const days = unitDays(units);
    const balance = available(userId);
    if (input.leaveType === 'annual' && days > balance.annual) {
      return { error: [409, 'INSUFFICIENT_BALANCE'] };
    }
    const split = leaveSplit(input.leaveType, days, balance);
    const shortNotice =
      !forOther && input.leaveType === 'annual' && span.startsOn < addDays(HR_TODAY, 3);
    const certificateRequired = input.leaveType === 'sick' && days > 2;
    const warnings: HrRequestWarning[] = [];
    if (shortNotice) warnings.push('short_notice');
    if (split.unpaidDays > 0 && input.leaveType !== 'unpaid') warnings.push('unpaid_days');
    if (certificateRequired) warnings.push('certificate_required');
    return {
      fields: {
        ...base,
        leaveType: input.leaveType,
        fromTime: null,
        toTime: null,
        days,
        ...split,
        shortNotice,
        certificateRequired,
      },
      preview: { days, ...split, shortNotice, warnings },
    };
  };

  /** Approving writes the paid days as `taken` (rule B14); cancelling restores them (B15). */
  const writeTaken = (r: HrRequestRecord, sign: 1 | -1) => {
    if (r.kind !== 'leave' || !r.leaveType || r.leaveType === 'unpaid' || !r.paidDays) return;
    const types: BalanceLeaveType[] =
      r.leaveType === 'emergency' ? ['emergency', 'annual'] : [r.leaveType];
    for (const leaveType of types) {
      leave.ledger.push({
        id: id(next++),
        userId: r.user.id,
        leaveType,
        year: Number(r.startsOn.slice(0, 4)),
        days: -sign * r.paidDays,
        entry: sign === 1 ? 'taken' : 'restored',
        period: null,
        requestId: r.id,
        itemId: null,
        note: null,
        createdBy: person(me().user.id),
        createdAt: now(),
      });
    }
  };

  const detailOf = (r: HrRequestRecord): HrRequestDetail => ({
    ...plain(r),
    opinions: r.opinions,
    overlappingWork:
      approver() && r.kind === 'leave'
        ? r.user.id === id(4)
          ? [
              {
                kind: 'task',
                id: id(9890),
                title: 'تعديل صور قائمة الطعام',
                date: r.startsOn,
                startsAt: null,
              },
            ]
          : []
        : null,
    permissions: {
      canDecide: approver() && r.status === 'pending',
      canCancel:
        live(r) &&
        (approver() ||
          (r.user.id === me().user.id && (r.status === 'pending' || r.startsOn > HR_TODAY))),
      canGiveOpinion: covers(r.user.id) && r.user.id !== me().user.id && r.status === 'pending',
    },
  });

  return (route: Route, method: string, url: URL, request: Request): Promise<void> | undefined => {
    const path = url.pathname;
    const q = url.searchParams;

    // A request's documents (rule B13): none seeded; its employee and approvers add them.
    if (path === '/api/files/items' && method === 'GET' && q.get('ownerType') === 'hr_request') {
      const r = leave.requests.find((x) => x.id === q.get('ownerId'));
      if (!r || !readable(r)) return fail(route, 404, null);
      return json(route, {
        items: [],
        rights: {
          canAddDeliverable: false,
          canAddReference: false,
          canManageDocuments: r.user.id === me().user.id || approver(),
          canSetConfidential: false,
          canSeeRemoved: false,
        },
      } satisfies FileItemList);
    }

    const balance = path.match(/^\/api\/hr\/balances\/([^/]+)(\/adjustments)?$/);
    if (balance) {
      const userId = balance[1] ?? '';
      if (userId !== me().user.id && !covers(userId)) return fail(route, 404, null);
      if (!balance[2] && method === 'GET') {
        return json(route, balanceOf(userId, Number(q.get('year') ?? 2026)));
      }
      if (balance[2] && method === 'POST') {
        if (!approver()) return fail(route, 403, null);
        const body = createLeaveAdjustmentSchema.parse(request.postDataJSON());
        leave.ledger.push({
          id: id(next++),
          userId,
          leaveType: body.leaveType,
          year: body.year,
          days: body.days,
          entry: body.entry,
          period: null,
          requestId: null,
          itemId: null,
          note: body.note,
          createdBy: person(me().user.id),
          createdAt: now(),
        });
        return json(route, balanceOf(userId, body.year), 201);
      }
    }

    if (path === '/api/hr/requests/preview' && method === 'POST') {
      const evaluated = evaluate(createHrRequestSchema.parse(request.postDataJSON()));
      if ('error' in evaluated) return fail(route, ...evaluated.error);
      return json(route, evaluated.preview);
    }
    if (path === '/api/hr/requests' && method === 'POST') {
      const evaluated = evaluate(createHrRequestSchema.parse(request.postDataJSON()));
      if ('error' in evaluated) return fail(route, ...evaluated.error);
      const created: HrRequestRecord = {
        id: id(next++),
        ...evaluated.fields,
        createdAt: now(),
        updatedAt: now(),
        opinions: [],
      };
      leave.requests.push(created);
      if (created.status === 'approved') writeTaken(created, 1);
      return json(route, plain(created), 201);
    }
    if (path === '/api/hr/requests' && method === 'GET') {
      const userId = q.get('userId') === 'me' ? me().user.id : q.get('userId');
      const statuses = q.getAll('status');
      const departmentId = q.get('departmentId');
      const page = Number(q.get('page') ?? 1);
      const pageSize = Number(q.get('pageSize') ?? 25);
      const order = q.get('order') === 'asc' ? 1 : -1;
      const rows = leave.requests
        .filter(
          (r) =>
            (userId ? r.user.id === userId && readable(r) : readable(r)) &&
            (statuses.length === 0 || statuses.includes(r.status)) &&
            (!q.get('kind') || r.kind === q.get('kind')) &&
            (!departmentId ||
              users
                .find((u) => u.id === r.user.id)
                ?.departments.some((d) => d.id === departmentId)),
        )
        .sort((a, b) => order * a.createdAt.localeCompare(b.createdAt))
        .map(plain);
      return json(route, {
        items: rows.slice((page - 1) * pageSize, page * pageSize),
        total: rows.length,
        page,
        pageSize,
      } satisfies HrRequestPage);
    }
    const one = path.match(/^\/api\/hr\/requests\/([^/]+)(\/decision|\/cancel)?$/);
    if (one) {
      const r = leave.requests.find((x) => x.id === one[1]);
      if (!r || !readable(r)) return fail(route, 404, null);
      if (!one[2] && method === 'GET') return json(route, detailOf(r));
      if (one[2] === '/decision' && method === 'POST') {
        if (!approver()) return fail(route, 403, null);
        if (r.status !== 'pending') return fail(route, 409, 'NOT_PENDING');
        const body = decideHrRequestSchema.parse(request.postDataJSON());
        if (
          body.decision === 'approve' &&
          r.certificateRequired &&
          r.documents === 0 &&
          !body.confirmMissingCertificate
        ) {
          return fail(route, 409, 'CERTIFICATE_MISSING');
        }
        const approved = body.decision === 'approve';
        Object.assign(r, {
          status: approved ? 'approved' : 'rejected',
          decidedBy: person(me().user.id),
          decidedAt: now(),
          decisionNote: body.note,
          updatedAt: now(),
        });
        if (approved) writeTaken(r, 1);
        return json(route, plain(r));
      }
      if (one[2] === '/cancel' && method === 'POST') {
        if (!detailOf(r).permissions.canCancel) return fail(route, 409, 'NOT_CANCELLABLE');
        if (r.status === 'approved') writeTaken(r, -1);
        Object.assign(r, {
          status: 'cancelled',
          decidedBy: person(me().user.id),
          decidedAt: now(),
          updatedAt: now(),
        });
        return json(route, plain(r));
      }
    }
    if (path === '/api/hr/opinions' && method === 'POST') {
      const body = createHrOpinionSchema.parse(request.postDataJSON());
      const r = leave.requests.find((x) => x.id === body.requestId);
      if (!r || !covers(r.user.id)) return fail(route, 404, null);
      if (r.status !== 'pending') return fail(route, 409, 'NOT_PENDING');
      const opinion: HrOpinion = {
        id: id(next++),
        requestId: r.id,
        itemId: null,
        author: person(me().user.id),
        body: body.body,
        createdAt: now(),
      };
      r.opinions.push(opinion);
      return json(route, opinion, 201);
    }
    return undefined;
  };
}

/** The entrance screen of the attendance mocks (F17 part C). */
const KIOSK_ID = id(9950);

/** A code's MAC the mock reads as "from outside the office network" (rule C6). */
export const OFF_NETWORK_MAC = 'OffNetworkOffNetworkOf';

/** A code's MAC the mock reads as expired (rule C5). */
export const EXPIRED_MAC = 'ExpiredExpiredExpiredE';

/** An entrance code as the screen shows it, for the HR clock's window. */
export function attendanceCode(mac = 'A'.repeat(22)): string {
  return `${KIOSK_ID}.${attendanceCodeWindow(new Date(HR_NOW))}.${mac}`;
}

/** The entrance screen in the mocks: unpaired until `/api/kiosk/pair`, or paired from the start. */
export interface KioskMock {
  paired: boolean;
  /** Sent once, on the first stream after pairing: the greeting after an office punch. */
  greeting?: AttendanceGreeting;
  /** The stream answers 503: the screen shows "offline". */
  offline?: boolean;
}

/** Today's work a field punch may name (rule C11), for every employee. */
const FIELD_WORK: FieldWork[] = [
  { kind: 'task', id: id(9890), title: 'تصوير منتجات المطعم', startsAt: null },
  {
    kind: 'meeting',
    id: id(9891),
    title: 'اجتماع خطة نوفمبر',
    startsAt: '2026-10-21T10:00:00.000Z',
  },
];

interface PunchRecord extends AttendancePunch {
  userId: string;
}

/**
 * Attendance (F17 part C): passkeys, entrance screens and their stream, punches, the days computed
 * from them with the contracts' `computeDay`, items and their decisions, and the Today board. The
 * clock is \`HR_NOW\`: a punch today lands four hours after the previous one.
 */
function attendanceRoutes({
  users,
  files,
  settings,
  holidays,
  kiosk,
  leave,
  me,
}: {
  users: UserResponse[];
  files: EmployeeRecord[];
  settings: { current: HrSettings };
  holidays: Holiday[];
  kiosk: KioskMock;
  leave: LeaveState;
  me: () => MeResponse;
}) {
  let next = 9960;
  const now = () => new Date(HR_NOW).toISOString();
  const holds = (permission: Permission) =>
    me().permissions.some((granted) => granted.permission === permission);
  const person = (userId: string) => ({
    id: userId,
    name: users.find((u) => u.id === userId)?.name ?? '',
    imageId: users.find((u) => u.id === userId)?.imageId ?? null,
  });
  const fileOf = (userId: string) => files.find((f) => f.userId === userId);

  const passkeys: (AttendancePasskey & { credentialId: string | null })[] = [
    [id(2), 9901],
    [id(5), 9902],
  ].map(([userId, n]) => ({
    id: id(n as number),
    user: person(userId as string),
    deviceLabel: 'Chrome · Android',
    status: 'active',
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-10-01T06:00:00.000Z',
    credentialId: null,
  }));
  const passkeyOf = (userId: string): PasskeyState => ({
    active: passkeys.some((p) => p.user.id === userId && p.status === 'active'),
    pending: passkeys.some((p) => p.user.id === userId && p.status === 'pending'),
  });

  const kiosks: (AttendanceKiosk & { pairingCode: string | null })[] = [
    {
      id: KIOSK_ID,
      name: 'المدخل الرئيسي',
      paired: true,
      pairingExpiresAt: null,
      lastSeenAt: new Date(Date.parse(HR_NOW) - 30_000).toISOString(),
      lastIpAddress: '192.168.1.20',
      createdAt: '2026-10-01T06:00:00.000Z',
      archivedAt: null,
      pairingCode: null,
    },
  ];
  /** The pairing code of the screen `/kiosk` pairs as (rule C4). */
  const SCREEN_PAIRING_CODE = 'K7PX4MQ2';
  let screenGreeting = kiosk.greeting;

  // Punches: a full October for everyone, with Karim late twice, Nour absent once and staying
  // late once, and today's first punches: Omar at the office, Nour in the field.
  const punches: PunchRecord[] = [];
  const at = (date: string, time: string) => businessInstant(date, time).toISOString();
  const addPunch = (
    userId: string,
    direction: 'in' | 'out',
    instant: string,
    extra: Partial<AttendancePunch> = {},
  ) => {
    const punch: PunchRecord = {
      id: id(next++),
      userId,
      direction,
      at: instant,
      method: 'office',
      kioskName: 'المدخل الرئيسي',
      latitude: null,
      longitude: null,
      accuracyM: null,
      fieldNote: null,
      fieldWork: null,
      shoot: null,
      fieldReview: null,
      archivedAt: null,
      ...extra,
    };
    punches.push(punch);
    return punch;
  };
  const kindOf = (date: string): AttendanceDay['kind'] => {
    if (holidays.some((h) => !h.archivedAt && h.startsOn <= date && h.endsOn >= date)) {
      return 'holiday';
    }
    return new Date(`${date}T12:00:00Z`).getUTCDay() === 5 ? 'off' : 'work';
  };
  for (const file of files) {
    if (file.employment.attendanceExempt) continue;
    for (let date = '2026-10-01'; date < HR_TODAY; date = addDays(date, 1)) {
      if (kindOf(date) !== 'work') continue;
      if (file.userId === id(5) && date === '2026-10-15') continue;
      const start =
        file.userId === id(4) && date === '2026-10-14'
          ? '09:25'
          : file.userId === id(4) && date === '2026-10-19'
            ? '09:40'
            : '08:55';
      const end = file.userId === id(5) && date === '2026-10-12' ? '18:25' : '17:05';
      addPunch(file.userId, 'in', at(date, start));
      addPunch(file.userId, 'out', at(date, end));
    }
  }
  addPunch(id(2), 'in', at(HR_TODAY, '08:05'));
  addPunch(id(5), 'in', at(HR_TODAY, '08:50'), {
    method: 'field',
    kioskName: null,
    latitude: 33.5138,
    longitude: 36.2765,
    accuracyM: 15,
    fieldNote: 'تصوير في موقع العميل',
    fieldWork: { kind: 'task', id: id(9890), title: 'تصوير منتجات المطعم' },
    fieldReview: 'accepted',
  });
  const refusals: PunchRefusal[] = [
    {
      user: person(id(8)),
      at: at(HR_TODAY, '08:40'),
      reason: 'OFF_OFFICE_NETWORK',
      ipAddress: '89.39.12.7',
    },
  ];

  const dayOf = (userId: string, date: string): AttendanceDay => {
    const kind = kindOf(date);
    const work = kind === 'work';
    const expectedStart = work ? businessInstant(date, '09:00') : null;
    const expectedEnd = work ? businessInstant(date, '17:00') : null;
    const own = punches
      .filter((p) => p.userId === userId && businessDate(new Date(p.at)) === date)
      .sort((a, b) => a.at.localeCompare(b.at));
    const live = own.filter((p) => !p.archivedAt);
    const startsOn = settings.current.attendanceStartsOn;
    const weekday = WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 1) % 7];
    const result = computeDay({
      kind,
      expectedStart,
      latestStart: null,
      expectedEnd,
      requiredMinutes: work ? 480 : null,
      leave: 'none',
      permissions: [],
      punches: live.map((p) => ({ direction: p.direction, at: new Date(p.at) })),
      graceMinutes: settings.current.graceMinutes,
      overtimeMinMinutes: settings.current.overtimeMinMinutes,
      phase: date < HR_TODAY ? 'after' : date === HR_TODAY ? 'during' : 'before',
      trial: !startsOn || date < startsOn,
    });
    return {
      id: id(30_000 + Number(userId.slice(-4)) * 40 + Number(date.slice(8))),
      userId,
      date,
      kind,
      expectedStart: expectedStart?.toISOString() ?? null,
      latestStart: null,
      expectedEnd: expectedEnd?.toISOString() ?? null,
      requiredMinutes: work ? 480 : null,
      place: work
        ? fileOf(userId)?.employment.remoteWeekdays.includes(weekday as never)
          ? 'remote'
          : 'office'
        : null,
      leave: 'none',
      firstInAt: result.firstInAt?.toISOString() ?? null,
      lastOutAt: result.lastOutAt?.toISOString() ?? null,
      workedMinutes: result.workedMinutes,
      lateMinutes: result.lateMinutes,
      earlyMinutes: result.earlyMinutes,
      overtimeMinutes: result.overtimeMinutes,
      status: result.status,
      punches: own.map(({ userId: _userId, ...p }) => p),
    };
  };
  const exemptionOf = (userId: string): MyAttendanceToday['exemption'] => {
    const file = fileOf(userId);
    if (!file || file.employment.attendanceExempt) return 'exempt';
    if (file.employment.startDate && file.employment.startDate > HR_TODAY) return 'not_started';
    if (file.employment.endedOn && file.employment.endedOn < HR_TODAY) return 'ended';
    return null;
  };

  const item = (
    n: number,
    userId: string,
    date: string,
    kind: AttendanceItem['kind'],
    minutes: number,
    proposedFraction: number,
    justification: string | null = null,
  ): AttendanceItem & { opinions: HrOpinion[] } => ({
    id: id(n),
    user: person(userId),
    dayId: dayOf(userId, date).id,
    date,
    kind,
    minutes,
    proposedFraction,
    justification,
    justifiedAt: justification ? `${date}T12:00:00.000Z` : null,
    status: 'pending',
    decidedFraction: null,
    decidedMinutes: null,
    creditedDays: null,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: `${date}T07:00:00.000Z`,
    updatedAt: `${date}T07:00:00.000Z`,
    opinions: [],
  });
  const items = [
    item(9931, id(4), '2026-10-14', 'lateness', 25, 0),
    item(9932, id(5), '2026-10-12', 'overtime', 85, 0),
    item(9933, id(5), '2026-10-15', 'absence', 0, 1),
    item(9934, id(4), '2026-10-19', 'lateness', 40, 0.5, 'ازدحام على طريق المزة'),
  ];
  const plainItem = ({ opinions: _opinions, ...rest }: (typeof items)[number]): AttendanceItem =>
    rest;
  const readable = (userId: string) => userId === me().user.id || holds('hr.read');

  /** WebAuthn options the browser (Chromium's virtual authenticator in the specs) accepts. */
  const challenge = () => Buffer.from(`challenge-${next++}-${Date.now()}`).toString('base64url');
  const ticketOf = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const fromTicket = <T>(ticket: string) =>
    JSON.parse(Buffer.from(ticket, 'base64url').toString()) as T;

  const route = (
    route: Route,
    method: string,
    url: URL,
    request: Request,
  ): Promise<void> | undefined => {
    const path = url.pathname;
    const q = url.searchParams;
    const userId = me().user.id;
    const rpId = new URL(request.url()).hostname;

    // The entrance screen (rules C4, C5, C20): no session.
    if (path === '/api/kiosk/pair' && method === 'POST') {
      const body = pairKioskSchema.safeParse(request.postDataJSON());
      if (!body.success || body.data.code !== SCREEN_PAIRING_CODE) {
        return fail(route, 400, 'INVALID_PAIRING_CODE');
      }
      kiosk.paired = true;
      return json(route, { id: KIOSK_ID, name: 'المدخل الرئيسي' });
    }
    if (path === '/api/kiosk/stream' && method === 'GET') {
      if (!kiosk.paired) return fail(route, 401, null);
      if (kiosk.offline) return route.fulfill({ status: 503, body: '' });
      const window = attendanceCodeWindow(new Date(HR_NOW));
      const code: KioskCodeEvent = {
        code: attendanceCode(),
        window,
        expiresAt: attendanceCodeWindowEnd(window).toISOString(),
      };
      const events = [
        `event: kiosk\ndata: ${JSON.stringify({ id: KIOSK_ID, name: 'المدخل الرئيسي' })}\n\n`,
        `event: code\ndata: ${JSON.stringify(code)}\n\n`,
        ...(screenGreeting ? [`event: greeting\ndata: ${JSON.stringify(screenGreeting)}\n\n`] : []),
      ];
      screenGreeting = undefined;
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: events.join(''),
      });
    }

    if (!path.startsWith('/api/hr/')) return undefined;

    if (path === '/api/hr/attendance/me/today' && method === 'GET') {
      const exemption = exemptionOf(userId);
      const day = exemption ? null : dayOf(userId, HR_TODAY);
      const last = punches
        .filter((p) => p.userId === userId && !p.archivedAt)
        .sort((a, b) => a.at.localeCompare(b.at))
        .at(-1);
      const startsOn = settings.current.attendanceStartsOn;
      return json(route, {
        date: HR_TODAY,
        exemption,
        trial: !startsOn || HR_TODAY < startsOn,
        passkey: passkeyOf(userId),
        day,
        nextDirection: nextPunchDirection(
          last ? { direction: last.direction, at: new Date(last.at) } : null,
          new Date(HR_NOW),
        ),
        methods: exemption
          ? []
          : ['office', ...(day?.place === 'remote' ? (['remote'] as const) : []), 'field'],
        shoots: [],
        fieldWork: exemption ? [] : FIELD_WORK,
      } satisfies MyAttendanceToday);
    }
    if (path === '/api/hr/attendance/days' && method === 'GET') {
      const target =
        q.get('userId') === 'me' || !q.get('userId') ? userId : (q.get('userId') ?? '');
      if (!readable(target)) return fail(route, 404, null);
      if (exemptionOf(target) === 'exempt')
        return json(route, { items: [] } satisfies AttendanceDayList);
      const month = q.get('month') ?? HR_TODAY.slice(0, 7);
      const days: AttendanceDay[] = [];
      for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) {
        days.push(dayOf(target, date));
      }
      return json(route, { items: days } satisfies AttendanceDayList);
    }

    // Passkeys (rules C3, C9).
    if (path === '/api/hr/passkeys/options' && method === 'POST') {
      if (exemptionOf(userId) === 'exempt') return fail(route, 409, 'EXEMPT');
      if (passkeyOf(userId).pending) return fail(route, 409, 'PENDING_EXISTS');
      const options = {
        challenge: challenge(),
        rp: { name: 'Vertex Hub', id: rpId },
        user: {
          id: Buffer.from(userId).toString('base64url'),
          name: me().user.email,
          displayName: me().user.name,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        timeout: 60_000,
        attestation: 'none',
        excludeCredentials: [],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
      };
      return json(route, {
        ticket: ticketOf({ register: userId }),
        options,
      } satisfies WebAuthnChallenge);
    }
    if (path === '/api/hr/passkeys' && method === 'POST') {
      const body = registerPasskeySchema.parse(request.postDataJSON());
      const replacing = passkeyOf(userId).active;
      const passkey = {
        id: id(next++),
        user: person(userId),
        deviceLabel: 'Chrome · Windows',
        status: replacing ? ('pending' as const) : ('active' as const),
        decidedBy: null,
        decidedAt: null,
        createdAt: now(),
        credentialId: String(body.response.id ?? ''),
      };
      passkeys.push(passkey);
      const { credentialId: _credentialId, ...shown } = passkey;
      return json(route, shown satisfies AttendancePasskey, 201);
    }
    if ((path === '/api/hr/passkeys/me' || path === '/api/hr/passkeys') && method === 'GET') {
      const target = path.endsWith('/me') ? userId : (q.get('userId') ?? '');
      if (target !== userId && !holds('hr.read')) return fail(route, 403, null);
      const items = passkeys
        .filter((p) => p.user.id === target)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ credentialId: _credentialId, ...p }) => p);
      return json(route, { items } satisfies AttendancePasskeyList);
    }
    const revoking = path.match(/^\/api\/hr\/passkeys\/([^/]+)\/revoke$/);
    if (revoking && method === 'POST') {
      if (!holds('hr.approve')) return fail(route, 403, null);
      revokePasskeySchema.parse(request.postDataJSON());
      const passkey = passkeys.find((p) => p.id === revoking[1]);
      if (!passkey) return fail(route, 404, null);
      Object.assign(passkey, { status: 'revoked', decidedBy: person(userId), decidedAt: now() });
      const { credentialId: _credentialId, ...shown } = passkey;
      return json(route, shown satisfies AttendancePasskey);
    }

    // Punches (rules C5–C13).
    if (path === '/api/hr/attendance/punch/options' && method === 'POST') {
      const input = punchOptionsInputSchema.parse(request.postDataJSON());
      if (exemptionOf(userId)) return fail(route, 409, 'EXEMPT');
      const passkey = passkeys.find((p) => p.user.id === userId && p.status === 'active');
      if (!passkey) return fail(route, 409, 'NO_PASSKEY');
      if (input.method === 'office') {
        const code = parseAttendanceCode(input.code ?? '');
        if (!code || code.kioskId !== KIOSK_ID || code.mac === EXPIRED_MAC) {
          return fail(route, 400, 'INVALID_CODE');
        }
        if (code.mac === OFF_NETWORK_MAC) {
          refusals.unshift({
            user: person(userId),
            at: now(),
            reason: 'OFF_OFFICE_NETWORK',
            ipAddress: '89.39.12.7',
          });
          return fail(route, 403, 'OFF_OFFICE_NETWORK');
        }
      } else if (input.latitude === undefined) {
        return fail(route, 400, 'LOCATION_REQUIRED');
      }
      const options = {
        challenge: challenge(),
        rpId,
        timeout: 60_000,
        userVerification: 'required',
        allowCredentials: passkey.credentialId
          ? [{ id: passkey.credentialId, type: 'public-key', transports: ['internal'] }]
          : [],
      };
      return json(route, { ticket: ticketOf(input), options } satisfies WebAuthnChallenge);
    }
    if (path === '/api/hr/attendance/punch' && method === 'POST') {
      const body = punchInputSchema.parse(request.postDataJSON());
      const input = fromTicket<{
        method: AttendancePunch['method'];
        latitude?: number;
        longitude?: number;
        accuracyM?: number;
      }>(body.ticket);
      if (input.method === 'field' && !body.fieldNote) return fail(route, 400, null);
      const today = punches.filter(
        (p) => p.userId === userId && !p.archivedAt && businessDate(new Date(p.at)) === HR_TODAY,
      );
      const last = today.at(-1);
      const direction = last?.direction === 'in' ? 'out' : 'in';
      const instant = new Date(Date.parse(HR_NOW) + today.length * 4 * 3_600_000).toISOString();
      const named = body.fieldWork && FIELD_WORK.find((w) => w.id === body.fieldWork?.id);
      const punch = addPunch(userId, direction, instant, {
        method: input.method,
        kioskName: input.method === 'office' ? 'المدخل الرئيسي' : null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyM: input.accuracyM ?? null,
        fieldNote: input.method === 'field' ? (body.fieldNote ?? null) : null,
        fieldWork: named ? { kind: named.kind, id: named.id, title: named.title } : null,
        fieldReview: input.method === 'field' || input.method === 'shoot' ? 'accepted' : null,
      });
      const day = dayOf(userId, HR_TODAY);
      const firstName = me().user.name.split(' ')[0] ?? '';
      const greeting: AttendanceGreeting =
        direction === 'in'
          ? {
              direction,
              firstName,
              partOfDay: partOfDay(businessTimeOfDay(new Date(instant))),
              tasksDueToday: 2,
              firstEventAt: FIELD_WORK[1]?.startsAt ?? null,
              workedMinutes: null,
              photo: null,
            }
          : {
              direction,
              firstName,
              partOfDay: null,
              tasksDueToday: null,
              firstEventAt: null,
              workedMinutes: day.workedMinutes,
              photo: null,
            };
      const { userId: _userId, ...shown } = punch;
      return json(route, { punch: shown, day, greeting } satisfies PunchResult, 201);
    }
    const rejecting = path.match(/^\/api\/hr\/attendance\/punches\/([^/]+)\/reject$/);
    if (rejecting && method === 'POST') {
      if (!holds('hr.approve')) return fail(route, 403, null);
      rejectPunchSchema.parse(request.postDataJSON());
      const punch = punches.find((p) => p.id === rejecting[1]);
      if (!punch) return fail(route, 404, null);
      if (punch.archivedAt || (punch.method !== 'field' && punch.method !== 'shoot')) {
        return fail(route, 409, 'NOT_FIELD');
      }
      Object.assign(punch, { archivedAt: now(), fieldReview: 'rejected' });
      return json(route, dayOf(punch.userId, businessDate(new Date(punch.at))));
    }
    if (path === '/api/hr/attendance/today' && method === 'GET') {
      if (!holds('hr.read')) return fail(route, 403, null);
      const departmentId = q.get('departmentId');
      const rows: TodayBoardRow[] = files
        .filter((f) => {
          const user = users.find((u) => u.id === f.userId);
          return (
            user?.status !== 'archived' &&
            (!departmentId || user?.departments.some((d) => d.id === departmentId))
          );
        })
        .map((f) => {
          const exemption = exemptionOf(f.userId);
          const day = exemption ? null : dayOf(f.userId, HR_TODAY);
          const live = day?.punches.filter((p) => !p.archivedAt) ?? [];
          const state: TodayBoardRow['state'] = exemption
            ? 'exempt'
            : day?.kind === 'holiday'
              ? 'holiday'
              : day?.firstInAt && !day.lastOutAt
                ? 'in'
                : day?.lastOutAt
                  ? 'out'
                  : day?.kind === 'off'
                    ? 'off'
                    : 'not_in';
          return {
            user: person(f.userId),
            state,
            late: (day?.lateMinutes ?? 0) > 0,
            method: live.at(-1)?.method ?? null,
            noPasskey: !passkeyOf(f.userId).active,
            day,
          };
        })
        .sort((a, b) => a.user.name.localeCompare(b.user.name, 'ar'));
      return json(route, { date: HR_TODAY, rows, refusals } satisfies TodayBoard);
    }

    // Items (rules C17, C18).
    if (path === '/api/hr/items' && method === 'GET') {
      const target = q.get('userId') === 'me' ? userId : q.get('userId');
      if (target ? !readable(target) : !holds('hr.read')) return fail(route, 403, null);
      const statuses = q.getAll('status').flatMap((s) => s.split(','));
      const departmentId = q.get('departmentId');
      const month = q.get('month');
      const rows = items
        .filter(
          (i) =>
            (!target || i.user.id === target) &&
            (target || holds('hr.read')) &&
            (statuses.length === 0 || statuses.includes(i.status)) &&
            (!q.get('kind') || i.kind === q.get('kind')) &&
            (!month || i.date.startsWith(month)) &&
            (!departmentId ||
              users
                .find((u) => u.id === i.user.id)
                ?.departments.some((d) => d.id === departmentId)),
        )
        .sort((a, b) =>
          q.get('order') === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
        );
      const page = Number(q.get('page') ?? 1);
      const pageSize = Number(q.get('pageSize') ?? 25);
      return json(route, {
        items: rows.slice((page - 1) * pageSize, page * pageSize).map(plainItem),
        total: rows.length,
        page,
        pageSize,
      } satisfies AttendanceItemPage);
    }
    const itemMatch = path.match(/^\/api\/hr\/items\/([^/]+)(\/justification|\/decision)?$/);
    if (itemMatch) {
      const found = items.find((i) => i.id === itemMatch[1]);
      if (!found || !readable(found.user.id)) return fail(route, 404, null);
      const own = found.user.id === userId;
      if (!itemMatch[2] && method === 'GET') {
        return json(route, {
          ...plainItem(found),
          day: dayOf(found.user.id, found.date),
          opinions: found.opinions,
          permissions: {
            canDecide: holds('hr.approve') && found.status !== 'void',
            canJustify: own && found.status === 'pending',
            canGiveOpinion: !own && holds('hr.read') && found.status === 'pending',
          },
        } satisfies AttendanceItemDetail);
      }
      if (itemMatch[2] === '/justification' && method === 'POST') {
        if (!own) return fail(route, 404, null);
        if (found.status !== 'pending') return fail(route, 409, 'NOT_PENDING');
        const body = justifyItemSchema.parse(request.postDataJSON());
        Object.assign(found, { justification: body.text, justifiedAt: now(), updatedAt: now() });
        return json(route, plainItem(found));
      }
      if (itemMatch[2] === '/decision' && method === 'POST') {
        if (!holds('hr.approve')) return fail(route, 403, null);
        const body = decideItemSchema.parse(request.postDataJSON());
        const outcome = itemOutcome(found, body);
        if (!outcome) return fail(route, 400, 'INVALID_DECISION');
        Object.assign(found, outcome, {
          creditedDays:
            outcome.status === 'time_off'
              ? Math.floor(((outcome.decidedMinutes ?? 0) / 480) * 2) / 2
              : null,
          decidedBy: person(userId),
          decidedAt: now(),
          decisionNote: body.note,
          updatedAt: now(),
        });
        return json(route, plainItem(found));
      }
      return undefined;
    }
    if (path === '/api/hr/opinions' && method === 'POST') {
      const body = createHrOpinionSchema.parse(request.postDataJSON());
      if (!body.itemId) return undefined;
      const found = items.find((i) => i.id === body.itemId);
      if (!found || !holds('hr.read')) return fail(route, 404, null);
      if (found.status !== 'pending') return fail(route, 409, 'NOT_PENDING');
      const opinion: HrOpinion = {
        id: id(next++),
        requestId: null,
        itemId: found.id,
        author: person(userId),
        body: body.body,
        createdAt: now(),
      };
      found.opinions.push(opinion);
      return json(route, opinion, 201);
    }

    // Entrance screens (rule C4).
    if (path.startsWith('/api/hr/kiosks')) {
      if (!holds('hr.manage')) return fail(route, 403, null);
      const shown = ({ pairingCode: _pairingCode, ...k }: (typeof kiosks)[number]) => k;
      if (path === '/api/hr/kiosks' && method === 'GET') {
        return json(route, { items: kiosks.map(shown) } satisfies AttendanceKioskList);
      }
      const pairing = (k: (typeof kiosks)[number]): AttendanceKioskPairing => ({
        ...shown(k),
        pairingCode: k.pairingCode ?? '',
      });
      if (path === '/api/hr/kiosks' && method === 'POST') {
        const body = createAttendanceKioskSchema.parse(request.postDataJSON());
        const created = {
          id: id(next++),
          name: body.name,
          paired: false,
          pairingExpiresAt: new Date(Date.parse(HR_NOW) + 15 * 60_000).toISOString(),
          lastSeenAt: null,
          lastIpAddress: null,
          createdAt: now(),
          archivedAt: null,
          pairingCode: SCREEN_PAIRING_CODE,
        };
        kiosks.push(created);
        return json(route, pairing(created), 201);
      }
      const kioskMatch = path.match(/^\/api\/hr\/kiosks\/([^/]+)\/(pairing-code|archive)$/);
      const found = kioskMatch && kiosks.find((k) => k.id === kioskMatch[1] && !k.archivedAt);
      if (!kioskMatch || method !== 'POST') return undefined;
      if (!found) return fail(route, 404, null);
      if (kioskMatch[2] === 'archive') {
        Object.assign(found, { archivedAt: now(), paired: false });
        return json(route, shown(found));
      }
      Object.assign(found, {
        paired: false,
        pairingCode: SCREEN_PAIRING_CODE,
        pairingExpiresAt: new Date(Date.parse(HR_NOW) + 15 * 60_000).toISOString(),
      });
      return json(route, pairing(found));
    }

    // Months (rules D1–D4): the sheet, closing with its frozen totals, reopening.
    const monthMatch = path.match(/^\/api\/hr\/months\/(\d{4}-\d{2})(\/close|\/reopen)?$/);
    if (monthMatch) {
      const month = monthMatch[1] ?? '';
      const state = monthOf(month);
      if (!monthMatch[2] && method === 'GET') {
        if (!holds('hr.read') && !holds('salaries.read')) return fail(route, 403, null);
        const { from, to } = monthRange(month);
        return json(route, {
          month: shownMonth(state),
          from,
          to,
          rows: sheetRows(month, q.get('departmentId')).map((row) => ({
            ...row,
            totals: state.frozen.get(row.user.id) ?? row.totals,
          })),
        } satisfies MonthSheet);
      }
      if (!holds('hr.approve')) return fail(route, 403, null);
      if (monthMatch[2] === '/close' && method === 'POST') {
        if (!monthEnded(month, HR_TODAY)) return fail(route, 409, 'MONTH_NOT_ENDED');
        const pending = pendingOf(month);
        if (pending.length > 0) return fail(route, 409, 'MONTH_HAS_PENDING', { pending });
        const rows = sheetRows(month, null);
        state.frozen = new Map(rows.map((row) => [row.user.id, row.totals]));
        Object.assign(state, { status: 'closed', closedBy: person(userId), closedAt: now() });
        return json(route, shownMonth(state));
      }
      if (monthMatch[2] === '/reopen' && method === 'POST') {
        const body = reopenMonthSchema.safeParse(request.postDataJSON());
        if (!body.success) return fail(route, 400, null);
        if (state.status !== 'closed') return fail(route, 409, 'NOT_CLOSED');
        Object.assign(state, {
          status: 'open',
          reopenedBy: person(userId),
          reopenedAt: now(),
          reopenReason: body.data.reason,
        });
        return json(route, shownMonth(state));
      }
    }
    return undefined;
  };

  const months = new Map<
    string,
    AttendanceMonth & { frozen: Map<string, MonthSheetRow['totals']> }
  >();
  const monthOf = (month: string) => {
    const known = months.get(month);
    if (known) return known;
    const created = {
      month,
      status: 'open' as const,
      closedBy: null,
      closedAt: null,
      reopenedBy: null,
      reopenedAt: null,
      reopenReason: null,
      frozen: new Map<string, MonthSheetRow['totals']>(),
    };
    months.set(month, created);
    return created;
  };
  const shownMonth = ({ frozen: _frozen, ...shown }: ReturnType<typeof monthOf>): AttendanceMonth =>
    shown;
  /** Requests touching the month and items of its days, still pending (rule D2). */
  const pendingOf = (month: string, only?: string): MonthPending[] => {
    const { from, to } = monthRange(month);
    return [
      ...leave.requests
        .filter((r) => r.status === 'pending' && r.startsOn <= to && r.endsOn >= from)
        .map((r) => ({ kind: 'request' as const, id: r.id, user: r.user, date: r.startsOn })),
      ...items
        .filter((i) => i.status === 'pending' && i.date.startsWith(month))
        .map((i) => ({ kind: 'item' as const, id: i.id, user: i.user, date: i.date })),
    ].filter((entry) => !only || entry.user.id === only);
  };
  /** The live sheet: every employee with attendance, their days and totals (rules D1, D3). */
  const sheetRows = (month: string, departmentId: string | null): MonthSheetRow[] => {
    const { from, to } = monthRange(month);
    return files
      .filter((f) => {
        const user = users.find((u) => u.id === f.userId);
        return (
          !f.employment.attendanceExempt &&
          user?.status !== 'archived' &&
          (!departmentId || user?.departments.some((d) => d.id === departmentId))
        );
      })
      .map((f) => {
        const days: AttendanceDay[] = [];
        // Days are stored up to today (the daily job creates each one), so later dates stay empty.
        for (let date = from; date <= to && date <= HR_TODAY; date = addDays(date, 1)) {
          days.push(dayOf(f.userId, date));
        }
        const own = items.filter((i) => i.user.id === f.userId && i.date.startsWith(month));
        const pending = pendingOf(month, f.userId);
        return {
          user: person(f.userId),
          days: days.map((day) => ({
            date: day.date,
            kind: day.kind,
            status: day.status,
            place: day.place,
            leave: day.leave,
            workedMinutes: day.workedMinutes,
            lateMinutes: day.lateMinutes,
            earlyMinutes: day.earlyMinutes,
            overtimeMinutes: day.overtimeMinutes,
            field: day.punches.some(
              (p) => !p.archivedAt && (p.method === 'field' || p.method === 'shoot'),
            ),
            pendingItems: own.filter((i) => i.date === day.date && i.status === 'pending').length,
          })),
          totals: monthTotals(
            days.map((day) => ({
              kind: day.kind,
              status: day.status,
              place: day.place,
              leave: day.leave,
              checkedIn: day.firstInAt !== null,
              workedMinutes: day.workedMinutes,
              field: day.punches.some(
                (p) => !p.archivedAt && (p.method === 'field' || p.method === 'shoot'),
              ),
            })),
            [],
            own,
          ),
          pendingRequests: pending.filter((p) => p.kind === 'request').length,
          pendingItems: pending.filter((p) => p.kind === 'item').length,
        };
      })
      .sort((a, b) => a.user.name.localeCompare(b.user.name, 'ar'));
  };

  return { route, passkeyOf };
}
