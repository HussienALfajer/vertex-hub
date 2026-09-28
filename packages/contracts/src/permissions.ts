import { z } from 'zod';
import type { Role } from './roles.js';

/**
 * Every permission the API can require, as `<module>.<action>`. The API enforces them with
 * guards; the web app uses them only to hide what the user cannot do (ADR 0007).
 */
export const PERMISSIONS = [
  'users.read',
  'users.manage',
  'clients.read',
  'clients.manage',
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
  'tasks.work',
  'tasks.manage',
  'templates.read',
  'templates.manage',
  'content.read',
  'content.manage',
  'approvals.review',
  'approvals.review_medical',
  'shoots.read',
  'shoots.manage',
  'campaigns.read',
  'campaigns.manage',
  'invoices.read',
  'invoices.manage',
  'payments.manage',
  'reports.read',
  'audit.read',
] as const;

export const permissionSchema = z.enum(PERMISSIONS).meta({ id: 'Permission' });

export type Permission = z.infer<typeof permissionSchema>;

/**
 * Which records a granted permission covers. Services turn scopes into query filters; the guard
 * only checks that the permission is granted with some scope.
 * - `all`: every record.
 * - `department`: records of the user's department.
 * - `own_clients`: records of clients the user is primary account manager for.
 * - `assigned`: records the user is assigned to or participates in.
 */
export const PERMISSION_SCOPES = ['all', 'department', 'own_clients', 'assigned'] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

type RoleGrants = Partial<Record<Permission, PermissionScope>>;

const everything: RoleGrants = Object.fromEntries(PERMISSIONS.map((p) => [p, 'all']));

/**
 * The single permission map (ADR 0007), derived from v1-scope F01. Provisional until the F01 spec
 * confirms it: grants that depend on open owner decisions stay with the General Manager only
 * (see docs/open-questions.md, Q13).
 */
export const PERMISSION_MAP: Readonly<Record<Role, RoleGrants>> = {
  general_manager: everything,
  department_manager: {
    'users.read': 'department',
    'clients.read': 'department',
    'catalog.read': 'all',
    'projects.read': 'department',
    'projects.manage': 'department',
    'tasks.read': 'department',
    'tasks.work': 'department',
    'tasks.manage': 'department',
    'templates.read': 'all',
    'content.read': 'department',
    'content.manage': 'department',
    'approvals.review': 'department',
    'shoots.read': 'all',
    'shoots.manage': 'department',
    'reports.read': 'department',
  },
  employee: {
    'clients.read': 'assigned',
    'projects.read': 'assigned',
    'tasks.read': 'assigned',
    'tasks.work': 'assigned',
    'content.read': 'assigned',
    'shoots.read': 'all',
  },
  account_manager: {
    'clients.read': 'own_clients',
    'clients.manage': 'own_clients',
    'catalog.read': 'all',
    'quotes.read': 'own_clients',
    'quotes.manage': 'own_clients',
    'projects.read': 'own_clients',
    'tasks.read': 'own_clients',
    'tasks.manage': 'own_clients',
    'content.read': 'own_clients',
    'content.manage': 'own_clients',
    'approvals.review': 'own_clients',
    'shoots.read': 'all',
    'campaigns.read': 'own_clients',
    'campaigns.manage': 'own_clients',
    'invoices.read': 'own_clients',
    'reports.read': 'own_clients',
  },
  finance: {
    'clients.read': 'all',
    'catalog.read': 'all',
    'quotes.read': 'all',
    'projects.read': 'all',
    'invoices.read': 'all',
    'invoices.manage': 'all',
    'payments.manage': 'all',
  },
};

/** The scopes under which the given roles hold a permission; empty when none of them does. */
export function permissionScopes(
  roles: readonly Role[],
  permission: Permission,
): PermissionScope[] {
  const scopes = new Set<PermissionScope>();
  for (const role of roles) {
    const scope = PERMISSION_MAP[role][permission];
    if (scope) scopes.add(scope);
  }
  return PERMISSION_SCOPES.filter((scope) => scopes.has(scope));
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => PERMISSION_MAP[role][permission] !== undefined);
}

/** Every permission the given roles hold, in catalog order. */
export function grantedPermissions(roles: readonly Role[]): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(roles, permission));
}
