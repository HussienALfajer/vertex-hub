import { z } from 'zod';

/**
 * The ten departments (ADR 0014). Codes are stable and never change; the display name and the
 * manager are editable. V1 adds and archives no departments.
 */
export const DEPARTMENT_CODES = [
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

export const departmentCodeSchema = z.enum(DEPARTMENT_CODES).meta({ id: 'DepartmentCode' });

export type DepartmentCode = z.infer<typeof departmentCodeSchema>;

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
    manager: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    /** Members who are not archived. */
    memberCount: z.number().int().min(0),
  })
  .meta({ id: 'Department' });

export type DepartmentResponse = z.infer<typeof departmentResponseSchema>;

export const departmentListResponseSchema = z
  .object({ items: z.array(departmentResponseSchema) })
  .meta({ id: 'DepartmentList', description: 'The ten departments, in seed order' });

export type DepartmentListResponse = z.infer<typeof departmentListResponseSchema>;

export const departmentDetailResponseSchema = departmentResponseSchema
  .extend({
    /** Members who are not archived, primary members first, then by name. */
    members: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        title: z.string().nullable(),
        isPrimary: z.boolean(),
        /** For callers with `users.manage` only; only `active` members can be made manager. */
        status: z.enum(['invited', 'active']).optional(),
      }),
    ),
  })
  .meta({ id: 'DepartmentDetail' });

export type DepartmentDetailResponse = z.infer<typeof departmentDetailResponseSchema>;

export const updateDepartmentSchema = z
  .object({ name: departmentNameSchema, managerId: z.uuid().nullable() })
  .partial()
  .meta({ id: 'UpdateDepartment' });

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;
