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

/**
 * Roles stored in `user_roles` and set by user managers. `employee` and `department_manager`
 * are derived (ADR 0014) and never assigned by hand.
 */
export const ASSIGNABLE_ROLES = ['general_manager', 'account_manager', 'finance'] as const;

export const assignableRoleSchema = z.enum(ASSIGNABLE_ROLES).meta({ id: 'AssignableRole' });

export type AssignableRole = z.infer<typeof assignableRoleSchema>;
