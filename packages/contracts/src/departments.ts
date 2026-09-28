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
