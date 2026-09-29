import type { DepartmentCode, MeResponse } from '@vertex-hub/contracts';
import { scopesOf } from '../../lib/auth';

/*
 * What the user may do on a task before it exists (spec F06, "Scopes on tasks"). Existing tasks
 * carry the server's answer in `permissions`. The API enforces all of it; this only hides things.
 */

/** The departments the user manages. */
export function managedDepartments(me: MeResponse): DepartmentCode[] {
  return me.departments.filter((department) => department.isManager).map(({ code }) => code);
}

/** Whether the user belongs to the department (primary or secondary). */
export function memberOf(me: MeResponse, department: DepartmentCode): boolean {
  return me.departments.some(({ code }) => code === department);
}

/**
 * Assign scope for a new task: `tasks.manage` under `all`, `department` (a department the user
 * manages) or `own_clients` (a client the user is account manager of). The project manager's
 * `assigned` scope never assigns people.
 */
export function canAssignIn(
  me: MeResponse,
  department: DepartmentCode,
  clientAccountManagerId: string | null,
): boolean {
  const scopes = scopesOf(me, 'tasks.manage');
  if (scopes.includes('all')) return true;
  if (scopes.includes('department') && managedDepartments(me).includes(department)) return true;
  return scopes.includes('own_clients') && clientAccountManagerId === me.user.id;
}

/** Client scope: `tasks.manage` under `all`, or `own_clients` for the client's account manager. */
export function hasClientScope(me: MeResponse, clientAccountManagerId: string): boolean {
  const scopes = scopesOf(me, 'tasks.manage');
  return (
    scopes.includes('all') ||
    (scopes.includes('own_clients') && clientAccountManagerId === me.user.id)
  );
}

/** Whether the user may log client requests for some client. */
export function logsClientRequests(me: MeResponse): boolean {
  const scopes = scopesOf(me, 'tasks.manage');
  return scopes.includes('all') || scopes.includes('own_clients');
}

/**
 * Whether the user manages other people's work: department managers, account managers, the
 * General Manager and the Operations manager. The board is in their navigation (spec screen 3).
 */
export function managesTeams(me: MeResponse): boolean {
  const scopes = scopesOf(me, 'tasks.manage');
  return scopes.some(
    (scope) => scope === 'all' || scope === 'department' || scope === 'own_clients',
  );
}
