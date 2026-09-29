import type { MeResponse } from '@vertex-hub/contracts';
import { scopesOf } from '../../lib/auth';

/**
 * Which clients the user may start projects for: every client (`all`), the clients they are
 * account manager of (`own_clients`), or none. The API enforces it; this only hides the button.
 */
export function projectCreateScope(me: MeResponse): 'all' | 'own_clients' | null {
  const scopes = scopesOf(me, 'projects.manage');
  if (scopes.includes('all')) return 'all';
  if (scopes.includes('own_clients')) return 'own_clients';
  return null;
}

/** Whether the user may start a project for a client with this account manager. */
export function canCreateProjectFor(me: MeResponse, accountManagerId: string): boolean {
  const scope = projectCreateScope(me);
  return scope === 'all' || (scope === 'own_clients' && accountManagerId === me.user.id);
}

/**
 * Money access on a client's work: `invoices.read` covering the client (spec F05). Detail
 * responses carry the server's answer (`canSeeMoney`); this is for screens before a record exists.
 */
export function hasMoneyAccess(me: MeResponse, accountManagerId: string): boolean {
  const scopes = scopesOf(me, 'invoices.read');
  return (
    scopes.includes('all') || (scopes.includes('own_clients') && accountManagerId === me.user.id)
  );
}
