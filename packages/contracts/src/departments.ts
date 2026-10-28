import { z } from 'zod';
import { personSchema } from './images.js';
import { permissionSchema } from './permissions.js';

/**
 * The ten seeded departments (ADR 0014, ADR 0043). Their codes never change; behavior keyed by
 * department (capabilities, brief kinds, system recipients) is keyed by these. The list of
 * departments itself comes from the database: the General Manager adds and archives them (F23).
 */
export const SYSTEM_DEPARTMENT_CODES = [
  'general_management',
  'internal_operations',
  'public_relations',
  'marketing',
  'design',
  'photography',
  'content_management',
  'development',
  'general_communication',
  'medical_consultation',
] as const;

export type SystemDepartmentCode = (typeof SYSTEM_DEPARTMENT_CODES)[number];

export function isSystemDepartmentCode(code: string): code is SystemDepartmentCode {
  return SYSTEM_DEPARTMENT_CODES.some((system) => system === code);
}

/** A department's stable key: a system code, or `d_` plus eight base-32 characters (ADR 0043). */
export const departmentCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/)
  .meta({ id: 'DepartmentCode' });

export type DepartmentCode = z.infer<typeof departmentCodeSchema>;

const GENERATED_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** A new department's code from eight random bytes (each reduced to one base-32 character). */
export function generatedDepartmentCode(random: Uint8Array): DepartmentCode {
  if (random.length !== 8) throw new Error('A department code takes eight random bytes');
  return `d_${Array.from(random, (byte) => GENERATED_CODE_ALPHABET[byte % 32]).join('')}`;
}

/** The fixed palette of department colors (design tokens `--department-1` … `--department-8`). */
export const DEPARTMENT_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'] as const;

export const departmentColorSchema = z.enum(DEPARTMENT_COLORS).meta({ id: 'DepartmentColor' });

export type DepartmentColor = z.infer<typeof departmentColorSchema>;

/** The curated department icons, as Lucide names. */
export const DEPARTMENT_ICONS = [
  'briefcase',
  'building',
  'settings',
  'megaphone',
  'chart-line',
  'target',
  'palette',
  'pen-tool',
  'camera',
  'film',
  'clapperboard',
  'mic',
  'file-text',
  'newspaper',
  'code',
  'monitor-smartphone',
  'headset',
  'message-circle',
  'stethoscope',
  'users',
  'handshake',
  'globe',
  'lightbulb',
  'calendar',
  'shopping-bag',
  'printer',
  'shield-check',
  'wallet',
  'graduation-cap',
  'sparkles',
] as const;

export const departmentIconSchema = z.enum(DEPARTMENT_ICONS).meta({ id: 'DepartmentIcon' });

export type DepartmentIcon = z.infer<typeof departmentIconSchema>;

/** Every system function a department can perform (F23 rule 30); the screens translate them. */
export const DEPARTMENT_FUNCTIONS = [
  'escalations',
  'user_management',
  'medical_review',
  'lead_ownership',
  'content_review',
  'shoots',
] as const;

export const departmentSystemFunctionSchema = z
  .enum(DEPARTMENT_FUNCTIONS)
  .meta({ id: 'DepartmentSystemFunction' });

export type DepartmentSystemFunction = z.infer<typeof departmentSystemFunctionSchema>;

/** The functions a system department performs (F23 rule 30). */
export const DEPARTMENT_SYSTEM_FUNCTIONS = {
  internal_operations: ['escalations', 'user_management'],
  medical_consultation: ['medical_review'],
  general_communication: ['lead_ownership'],
  marketing: ['lead_ownership'],
  content_management: ['content_review'],
  photography: ['shoots'],
} as const satisfies Partial<Record<SystemDepartmentCode, readonly DepartmentSystemFunction[]>>;

/** The system functions of a department; none for a department added by the General Manager. */
export function departmentSystemFunctions(
  code: DepartmentCode,
): readonly DepartmentSystemFunction[] {
  return Object.entries(DEPARTMENT_SYSTEM_FUNCTIONS).find(([key]) => key === code)?.[1] ?? [];
}

/** A user's place in a department, as shown on their profile and in `/api/me`. */
export const userDepartmentSchema = z
  .object({
    id: z.uuid(),
    code: departmentCodeSchema,
    name: z.string(),
    isPrimary: z.boolean(),
    isManager: z.boolean(),
  })
  .meta({ id: 'UserDepartment' });

export type UserDepartment = z.infer<typeof userDepartmentSchema>;

export const departmentNameSchema = z.string().trim().min(1).max(60);

export const departmentResponseSchema = z
  .object({
    id: z.uuid(),
    code: departmentCodeSchema,
    name: z.string(),
    description: z.string().nullable(),
    color: departmentColorSchema,
    icon: departmentIconSchema,
    /** The place in the order of active departments; archived ones keep their last one. */
    position: z.number().int().min(1),
    archivedAt: z.iso.datetime().nullable(),
    manager: personSchema.nullable(),
    /** Members who are not archived. */
    memberCount: z.number().int().min(0),
  })
  .meta({ id: 'Department' });

export type DepartmentResponse = z.infer<typeof departmentResponseSchema>;

export const departmentListResponseSchema = z
  .object({ items: z.array(departmentResponseSchema) })
  .meta({
    id: 'DepartmentList',
    description: 'Active departments in their order, then archived ones',
  });

export type DepartmentListResponse = z.infer<typeof departmentListResponseSchema>;

export const departmentDetailResponseSchema = departmentResponseSchema
  .extend({
    /** Members who are not archived, primary members first, then by name. */
    members: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        /** The current photo (F01C); null shows the initial. */
        imageId: z.uuid().nullable(),
        title: z.string().nullable(),
        isPrimary: z.boolean(),
        /** For callers with `users.manage` only; only `active` members can be made manager. */
        status: z.enum(['invited', 'active']).optional(),
      }),
    ),
    /** F23 rule 27: what members and the manager receive (system departments only). */
    grants: z.object({ member: z.array(permissionSchema), manager: z.array(permissionSchema) }),
    systemFunctions: z.array(departmentSystemFunctionSchema),
    /** Rule 26: who archived it; null while active. */
    archivedBy: personSchema.nullable(),
  })
  .meta({ id: 'DepartmentDetail' });

export type DepartmentDetailResponse = z.infer<typeof departmentDetailResponseSchema>;


export const departmentDescriptionSchema = z.string().trim().max(500);

/** F23 rule 2: a new department starts with no members and no manager, last in the order. */
export const createDepartmentSchema = z
  .object({
    name: departmentNameSchema,
    /** Plain text; empty clears it. */
    description: departmentDescriptionSchema.nullable().optional(),
    color: departmentColorSchema,
    icon: departmentIconSchema,
  })
  .meta({ id: 'CreateDepartment' });

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema
  .extend({ managerId: z.uuid().nullable() })
  .partial()
  .meta({ id: 'UpdateDepartment' });

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;

/** F23 rule 4: every active department's id, in the new order. */
export const departmentOrderSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(200) })
  .meta({ id: 'DepartmentOrder' });

export type DepartmentOrder = z.infer<typeof departmentOrderSchema>;

/** F23 rule 17: up to 20 users join as secondary members, all or nothing. */
export const addDepartmentMembersSchema = z
  .object({ userIds: z.array(z.uuid()).min(1).max(20) })
  .meta({ id: 'AddDepartmentMembers' });

export type AddDepartmentMembers = z.infer<typeof addDepartmentMembersSchema>;

/** F23 rule 19: the active department the membership moves to. */
export const moveDepartmentMemberSchema = z
  .object({ departmentId: z.uuid() })
  .meta({ id: 'MoveDepartmentMember' });

export type MoveDepartmentMember = z.infer<typeof moveDepartmentMemberSchema>;

/** What an archive moves, by category (F23 rule 8). */
export const DEPARTMENT_TRANSFER_CATEGORIES = [
  'members',
  'tasks',
  'questions',
  'services',
  'templates',
  'engagements',
] as const;

export const departmentTransferCategorySchema = z
  .enum(DEPARTMENT_TRANSFER_CATEGORIES)
  .meta({ id: 'DepartmentTransferCategory' });

export type DepartmentTransferCategory = z.infer<typeof departmentTransferCategorySchema>;

/** One record an archive moves, as the wizard's short list names it. */
export const departmentTransferItemSchema = z
  .object({ id: z.uuid(), name: z.string() })
  .meta({ id: 'DepartmentTransferItem' });

export type DepartmentTransferItem = z.infer<typeof departmentTransferItemSchema>;

export const departmentArchivePreviewSchema = z
  .object({
    /** Every category, empty ones with a count of zero. */
    categories: z.array(
      z.object({
        category: departmentTransferCategorySchema,
        count: z.number().int().min(0),
        /** The first five. */
        items: z.array(departmentTransferItemSchema).max(5),
      }),
    ),
    /** Rule 15: what falls to the General Manager while the department is archived. */
    systemFunctions: z.array(departmentSystemFunctionSchema),
  })
  .meta({ id: 'DepartmentArchivePreview' });

export type DepartmentArchivePreview = z.infer<typeof departmentArchivePreviewSchema>;

/** F23 rule 9: one active target per non-empty category. */
export const archiveDepartmentSchema = z
  .object({ targets: z.partialRecord(departmentTransferCategorySchema, z.uuid()) })
  .meta({ id: 'ArchiveDepartment' });

export type ArchiveDepartment = z.infer<typeof archiveDepartmentSchema>;
