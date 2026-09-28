import { z } from 'zod';

/** V1 roles (ADR 0007). A user can hold several roles at once. */
export const ROLES = [
  'general_manager',
  'department_manager',
  'employee',
  'account_manager',
  'finance',
] as const;

export const roleSchema = z.enum(ROLES).meta({ id: 'Role' });

export type Role = z.infer<typeof roleSchema>;
