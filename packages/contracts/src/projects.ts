import { z } from 'zod';
import { calendarDateSchema } from './dates.js';
import { departmentCodeSchema } from './departments.js';
import {
  pageQuerySchema,
  pageSchema,
  queryBooleanSchema,
  queryListSchema,
  sortOrderSchema,
} from './lists.js';
import { currencySchema, minorAmountSchema } from './money.js';
import { optionalText } from './text.js';

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'completed', 'cancelled'] as const;

export const projectStatusSchema = z.enum(PROJECT_STATUSES).meta({ id: 'ProjectStatus' });

export type ProjectStatus = z.infer<typeof projectStatusSchema>;

/** Statuses of a running project: it can be overdue, and it blocks archiving its manager. */
export const OPEN_PROJECT_STATUSES = [
  'planned',
  'active',
  'on_hold',
] as const satisfies readonly ProjectStatus[];

/**
 * The allowed status changes (spec F05, "Project status"). Reopening (`completed` or `cancelled`
 * to `active`) needs scope all; completing needs every milestone done. Archive is separate.
 */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planned: ['active', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'cancelled'],
  completed: ['active'],
  cancelled: ['active'],
};

export function canChangeProjectStatus(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

/** A completed or cancelled project is read-only until reopened (rule 7). */
export function isProjectClosed(status: ProjectStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export const MILESTONE_STATUSES = ['pending', 'done'] as const;

export const milestoneStatusSchema = z.enum(MILESTONE_STATUSES).meta({ id: 'MilestoneStatus' });

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;

/** Limits of what one project holds (spec F05). */
export const PROJECT_LIMITS = { milestones: 30 } as const;

/** Task counts that F06 reports through the `projects` module's progress source; 0 until then. */
export const taskCountsSchema = z
  .object({
    total: z.number().int().min(0),
    delivered: z.number().int().min(0),
    open: z.number().int().min(0),
  })
  .meta({ id: 'TaskCounts' });

export type TaskCounts = z.infer<typeof taskCountsSchema>;

/** 1–10 department codes, each kept once. */
export const engagementDepartmentsSchema = z
  .array(departmentCodeSchema)
  .transform((codes) => [...new Set(codes)])
  .pipe(z.array(departmentCodeSchema).min(1).max(10));

// Milestones

const milestoneFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  dueDate: calendarDateSchema.nullable(),
  /** Money field: sent only by callers with money access. */
  installmentMinor: minorAmountSchema.nullable(),
});

export const createMilestoneSchema = milestoneFieldsSchema
  .partial({ dueDate: true, installmentMinor: true })
  .meta({ id: 'CreateMilestone' });

export type CreateMilestone = z.infer<typeof createMilestoneSchema>;

export type CreateMilestoneInput = z.input<typeof createMilestoneSchema>;

export const updateMilestoneSchema = milestoneFieldsSchema
  .partial()
  .meta({ id: 'UpdateMilestone' });

export type UpdateMilestone = z.infer<typeof updateMilestoneSchema>;

export const milestoneOrderSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(PROJECT_LIMITS.milestones) })
  .meta({ id: 'MilestoneOrder', description: 'Every non-archived milestone of the project once' });

export type MilestoneOrder = z.infer<typeof milestoneOrderSchema>;

/** The body may be left out. */
export const completeMilestoneSchema = z
  .object({ confirmOpenTasks: z.boolean().default(false) })
  .default({ confirmOpenTasks: false })
  .meta({ id: 'CompleteMilestone' });

export type CompleteMilestone = z.infer<typeof completeMilestoneSchema>;

export const milestoneSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    position: z.number().int().min(1),
    dueDate: calendarDateSchema.nullable(),
    status: milestoneStatusSchema,
    /** Pending with a due date before today (rule 10). */
    overdue: z.boolean(),
    doneAt: z.iso.datetime().nullable(),
    doneBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    tasks: taskCountsSchema,
    /** Present only for callers with money access. */
    money: z.object({ installmentMinor: z.number().int().nullable() }).optional(),
  })
  .meta({ id: 'Milestone' });

export type Milestone = z.infer<typeof milestoneSchema>;

export const milestoneListResponseSchema = z
  .object({ items: z.array(milestoneSchema) })
  .meta({ id: 'MilestoneList', description: 'Non-archived milestones, by position' });

export type MilestoneListResponse = z.infer<typeof milestoneListResponseSchema>;

// Projects

export const projectNameSchema = z.string().trim().min(1).max(120);

const projectFieldsSchema = z.object({
  name: projectNameSchema,
  description: optionalText(2000),
  projectManagerId: z.uuid(),
  departments: engagementDepartmentsSchema,
  startDate: calendarDateSchema,
  dueDate: calendarDateSchema,
  /** Money field: sent only by callers with money access; `USD` when left out. */
  currency: currencySchema,
});

/** `dueDate` ≥ `startDate` is checked by the API (`INVALID_DATES`, rule 5). */
export const createProjectSchema = projectFieldsSchema
  .extend({
    clientId: z.uuid(),
    status: z.enum(['planned', 'active']).default('planned'),
    /** At most `PROJECT_LIMITS.milestones`; the API answers `LIMIT_REACHED`. */
    milestones: z.array(createMilestoneSchema).default([]),
  })
  .partial({ description: true, currency: true })
  .meta({ id: 'CreateProject' });

export type CreateProject = z.infer<typeof createProjectSchema>;

export type CreateProjectInput = z.input<typeof createProjectSchema>;

/** `projectManagerId` needs client scope; `currency` needs money access. */
export const updateProjectSchema = projectFieldsSchema.partial().meta({ id: 'UpdateProject' });

export type UpdateProject = z.infer<typeof updateProjectSchema>;

export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

export const projectStatusChangeSchema = z
  .object({
    status: z.enum(['active', 'on_hold', 'completed', 'cancelled']),
    /** Required when cancelling. */
    reason: optionalText(500).optional(),
    /**
     * Reopening only: hands the project to another manager at the same time, needed when the
     * current one is archived (edge case 8).
     */
    projectManagerId: z.uuid().optional(),
  })
  .refine((change) => change.status !== 'cancelled' || !!change.reason, {
    message: 'Cancelling needs a reason',
    path: ['reason'],
  })
  .refine((change) => change.status === 'active' || change.projectManagerId === undefined, {
    message: 'A new project manager is accepted only when reopening',
    path: ['projectManagerId'],
  })
  .meta({ id: 'ProjectStatusChange' });

export type ProjectStatusChange = z.infer<typeof projectStatusChangeSchema>;

export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    client: z.object({ id: z.uuid(), name: z.string() }),
    projectManager: z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() }),
    departments: z.array(departmentCodeSchema),
    status: projectStatusSchema,
    startDate: calendarDateSchema,
    dueDate: calendarDateSchema,
    /** Open with a due date before today (rule 10). */
    overdue: z.boolean(),
    milestoneProgress: z.object({
      done: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
    /** Delivered tasks ÷ tasks as a whole percentage, null without tasks (rule 9). */
    progress: z.number().int().min(0).max(100).nullable(),
  })
  .meta({ id: 'Project' });

export type Project = z.infer<typeof projectSchema>;

export const projectPermissionsSchema = z
  .object({
    canManage: z.boolean(),
    canChangeManager: z.boolean(),
    canCancel: z.boolean(),
    canReopen: z.boolean(),
    canArchive: z.boolean(),
    canSeeMoney: z.boolean(),
    canEditMoney: z.boolean(),
    /** M3: billing follows the work, so it stays open on completed and cancelled projects. */
    canBill: z.boolean(),
  })
  .meta({ id: 'ProjectPermissions', description: 'What the caller may do, for the UI' });

export type ProjectPermissions = z.infer<typeof projectPermissionsSchema>;

export const projectDetailSchema = projectSchema
  .extend({
    description: z.string().nullable(),
    /** Non-archived milestones, by position. */
    milestones: z.array(milestoneSchema),
    tasks: taskCountsSchema,
    completedAt: z.iso.datetime().nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelReason: z.string().nullable(),
    archivedAt: z.iso.datetime().nullable(),
    /** Present only for callers with money access; the total of the installments. */
    money: z.object({ currency: currencySchema, totalMinor: z.number().int().min(0) }).optional(),
    permissions: projectPermissionsSchema,
  })
  .meta({ id: 'ProjectDetail' });

export type ProjectDetail = z.infer<typeof projectDetailSchema>;

export const PROJECT_SORTS = ['dueDate', 'name', 'createdAt'] as const;

export const projectListQuerySchema = pageQuerySchema.extend({
  /** Matches the project name or the client's trade name. */
  search: z.string().trim().min(1).max(100).optional(),
  status: queryListSchema(projectStatusSchema).default([...OPEN_PROJECT_STATUSES]),
  clientId: z.uuid().optional(),
  projectManagerId: z.uuid().optional(),
  department: departmentCodeSchema.optional(),
  overdue: queryBooleanSchema.optional(),
  /** `true` lists archived projects only; needs `projects.manage` with scope all. */
  archived: queryBooleanSchema.default(false),
  sort: z.enum(PROJECT_SORTS).default('dueDate'),
  order: sortOrderSchema.default('asc'),
});

export type ProjectListQuery = z.infer<typeof projectListQuerySchema>;

export const projectPageSchema = pageSchema(projectSchema).meta({ id: 'ProjectPage' });

export type ProjectPage = z.infer<typeof projectPageSchema>;
