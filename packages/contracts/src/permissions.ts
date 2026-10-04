import { z } from 'zod';
import type { DepartmentCode } from './departments.js';
import { type AssignableRole, ROLES, type Role } from './roles.js';

/**
 * Every permission the API can require, as `<module>.<action>`. The API enforces them with
 * guards; the web app uses them only to hide what the user cannot do (ADR 0007).
 */
export const PERMISSIONS = [
  'users.read',
  'users.manage',
  'clients.read',
  'clients.manage',
  'clients.log',
  'leads.read',
  'leads.manage',
  'catalog.read',
  'catalog.manage',
  'quotes.read',
  'quotes.manage',
  'quotes.approve_discount',
  'projects.read',
  'projects.manage',
  'tasks.read',
  'tasks.request',
  'tasks.work',
  'tasks.manage',
  'templates.read',
  'templates.manage',
  'content.read',
  'content.manage',
  'content.review',
  'approvals.review_medical',
  'calendar.read',
  'shoots.manage',
  'meetings.manage',
  'campaigns.read',
  'campaigns.manage',
  'campaigns.fund',
  'invoices.read',
  'invoices.manage',
  'payments.manage',
  'expenses.manage',
  'reports.read',
  'reports.finance',
  'audit.read',
] as const;

export const permissionSchema = z.enum(PERMISSIONS).meta({ id: 'Permission' });

export type Permission = z.infer<typeof permissionSchema>;

/**
 * Which records a granted permission covers. Services turn scopes into query filters; the guard
 * only checks that the permission is granted with some scope.
 * - `all`: every record.
 * - `department`: records of the departments the user manages.
 * - `own_clients`: records of clients the user is primary account manager for.
 * - `assigned`: records the user is assigned to or participates in (for projects: the projects the
 *   user is project manager of; for `tasks.work`: the tasks the user is assignee of; for
 *   `tasks.manage`: the tasks of the projects the user is project manager of; for
 *   `meetings.manage`: the meetings the user organizes).
 */
export const PERMISSION_SCOPES = ['all', 'department', 'own_clients', 'assigned'] as const;

export const permissionScopeSchema = z.enum(PERMISSION_SCOPES).meta({ id: 'PermissionScope' });

export type PermissionScope = z.infer<typeof permissionScopeSchema>;

export type Grants = Partial<Record<Permission, PermissionScope>>;

const everything: Grants = Object.fromEntries(PERMISSIONS.map((p) => [p, 'all']));

/** Grants by role (ADR 0007, ADR 0014; final V1 map in docs/specs/F01-users-roles.md). */
export const PERMISSION_MAP: Readonly<Record<Role, Grants>> = {
  general_manager: everything,
  department_manager: {
    'catalog.read': 'all',
    'tasks.work': 'department',
    'tasks.manage': 'department',
    'reports.read': 'department',
  },
  employee: {
    'users.read': 'all',
    'clients.read': 'all',
    'clients.log': 'all',
    'projects.read': 'all',
    'projects.manage': 'assigned',
    'tasks.read': 'all',
    'tasks.request': 'all',
    'tasks.work': 'assigned',
    'tasks.manage': 'assigned',
    'templates.read': 'all',
    'content.read': 'all',
    'calendar.read': 'all',
    'meetings.manage': 'assigned',
  },
  account_manager: {
    'clients.manage': 'own_clients',
    'leads.read': 'assigned',
    'leads.manage': 'assigned',
    'catalog.read': 'all',
    'quotes.read': 'own_clients',
    'quotes.manage': 'own_clients',
    'projects.manage': 'own_clients',
    'tasks.manage': 'own_clients',
    'content.manage': 'own_clients',
    'content.review': 'own_clients',
    'shoots.manage': 'own_clients',
    'meetings.manage': 'own_clients',
    'campaigns.read': 'own_clients',
    'campaigns.manage': 'own_clients',
    'invoices.read': 'own_clients',
    'expenses.manage': 'own_clients',
    'reports.read': 'own_clients',
  },
  finance: {
    'catalog.read': 'all',
    'quotes.read': 'all',
    'campaigns.read': 'all',
    'campaigns.fund': 'all',
    'invoices.read': 'all',
    'invoices.manage': 'all',
    'payments.manage': 'all',
    'expenses.manage': 'all',
    'reports.finance': 'all',
  },
};

/**
 * Grants by position in a department (ADR 0014). A manager is also a member; primary and
 * secondary memberships count the same.
 */
export const DEPARTMENT_CAPABILITIES: Readonly<
  Partial<Record<DepartmentCode, { member?: Grants; manager?: Grants }>>
> = {
  internal_operations: {
    manager: {
      'users.manage': 'all',
      'clients.manage': 'all',
      'catalog.read': 'all',
      'catalog.manage': 'all',
      'quotes.read': 'all',
      'quotes.manage': 'all',
      'audit.read': 'all',
      'templates.read': 'all',
      'templates.manage': 'all',
      'projects.manage': 'all',
      'tasks.manage': 'all',
      'content.manage': 'all',
      'content.review': 'all',
      'shoots.manage': 'all',
      'meetings.manage': 'all',
      'campaigns.read': 'all',
      'campaigns.manage': 'all',
      'campaigns.fund': 'all',
      'invoices.read': 'all',
      'invoices.manage': 'all',
      'payments.manage': 'all',
      'expenses.manage': 'all',
      'reports.read': 'all',
    },
  },
  content_management: {
    member: { 'content.manage': 'all' },
    manager: { 'content.review': 'all' },
  },
  medical_consultation: { member: { 'approvals.review_medical': 'all' } },
  photography: { member: { 'shoots.manage': 'all' } },
  general_communication: { member: { 'leads.read': 'all', 'leads.manage': 'all' } },
  marketing: {
    member: {
      'leads.read': 'all',
      'leads.manage': 'all',
      'campaigns.read': 'all',
      'campaigns.manage': 'all',
    },
  },
};

export type DepartmentPosition = { code: DepartmentCode; isManager: boolean };

/** What a user's permissions are computed from: effective roles and department positions. */
export type UserAccess = {
  roles: readonly Role[];
  departments: readonly DepartmentPosition[];
};

/**
 * Assigned roles plus the derived ones: `employee` for every non-archived user and
 * `department_manager` while the user manages a department. Callers pass archived users no roles.
 */
export function effectiveRoles(
  assigned: readonly AssignableRole[],
  departments: readonly DepartmentPosition[],
): Role[] {
  const roles = new Set<Role>([...assigned, 'employee']);
  if (departments.some((d) => d.isManager)) roles.add('department_manager');
  return ROLES.filter((role) => roles.has(role));
}

function grantsOf(access: UserAccess): Grants[] {
  const grants = access.roles.map((role) => PERMISSION_MAP[role]);
  for (const { code, isManager } of access.departments) {
    const capabilities = DEPARTMENT_CAPABILITIES[code];
    if (capabilities?.member) grants.push(capabilities.member);
    if (isManager && capabilities?.manager) grants.push(capabilities.manager);
  }
  return grants;
}

/** Every scope under which the user holds a permission; empty when they do not hold it. */
export function permissionScopes(access: UserAccess, permission: Permission): PermissionScope[] {
  const scopes = new Set(grantsOf(access).map((grants) => grants[permission]));
  return PERMISSION_SCOPES.filter((scope) => scopes.has(scope));
}

export function hasPermission(access: UserAccess, permission: Permission): boolean {
  return permissionScopes(access, permission).length > 0;
}

export const grantedPermissionSchema = z
  .object({ permission: permissionSchema, scopes: z.array(permissionScopeSchema) })
  .meta({ id: 'GrantedPermission' });

export type GrantedPermission = z.infer<typeof grantedPermissionSchema>;

/** Every permission the user holds with its scopes, in catalog order. */
export function grantedPermissions(access: UserAccess): GrantedPermission[] {
  return PERMISSIONS.map((permission) => ({
    permission,
    scopes: permissionScopes(access, permission),
  })).filter((granted) => granted.scopes.length > 0);
}

/** Two-factor sign-in is required for General Managers, Finance and the Operations manager. */
export function twoFactorRequired(access: UserAccess): boolean {
  return (
    access.roles.includes('general_manager') ||
    access.roles.includes('finance') ||
    access.departments.some((d) => d.code === 'internal_operations' && d.isManager)
  );
}
