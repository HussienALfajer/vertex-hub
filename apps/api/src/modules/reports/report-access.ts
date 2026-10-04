import {
  DEPARTMENT_CODES,
  type DepartmentCode,
  type Permission,
  permissionScopes,
} from '@vertex-hub/contracts';
import type { CurrentUserInfo } from '../auth/index.js';
import type { ClientSummary } from '../clients/index.js';

/*
 * Who may read which report (spec F15, "Roles and access", rule 23).
 */

/** The departments the caller manages, in catalog order. */
export const managedDepartments = (actor: CurrentUserInfo): DepartmentCode[] =>
  actor.access.departments.filter((d) => d.isManager).map((d) => d.code);

/**
 * The departments of the caller's `reports.read` scope, in catalog order: every one under `all`,
 * the ones they manage under `department`.
 */
export function reportDepartments(actor: CurrentUserInfo): DepartmentCode[] {
  const scopes = permissionScopes(actor.access, 'reports.read');
  const managed = managedDepartments(actor);
  return DEPARTMENT_CODES.filter(
    (code) => scopes.includes('all') || (scopes.includes('department') && managed.includes(code)),
  );
}

/** `permission` covers the client: scope `all`, or `own_clients` as its account manager. */
export function coversClient(
  actor: CurrentUserInfo,
  permission: Permission,
  client: ClientSummary,
): boolean {
  const scopes = permissionScopes(actor.access, permission);
  if (scopes.includes('all')) return true;
  return scopes.includes('own_clients') && client.accountManagerId === actor.id;
}
