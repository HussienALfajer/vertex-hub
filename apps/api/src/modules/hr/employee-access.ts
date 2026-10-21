import { type Permission, permissionScopes } from '@vertex-hub/contracts';
import type { CurrentUserInfo } from '../auth/index.js';

export const holdsAll = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).includes('all');

/** Which sections of a file the actor reads (rule A2). */
export interface FileView {
  /** Personal details, contract, schedule and end of service. */
  file: boolean;
  /** Salary and payout. */
  pay: boolean;
}

/**
 * Rule A2: the employee reads their whole file; `employees.read` holders the file without pay;
 * `salaries.read` holders the Pay section. Null when the actor reads nothing of it (404).
 */
export function fileView(actor: CurrentUserInfo, userId: string): FileView | null {
  if (actor.id === userId) return { file: true, pay: true };
  const view = { file: holdsAll(actor, 'employees.read'), pay: holdsAll(actor, 'salaries.read') };
  return view.file || view.pay ? view : null;
}
