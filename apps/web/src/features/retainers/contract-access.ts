import type { MeResponse } from '@vertex-hub/contracts';
import { can, scopesOf } from '../../lib/auth';

/**
 * Whether the user reads the contract settings (F05C Roles): manages retainers (client scope) and
 * has money access. Hides UI only; the API enforces it.
 */
export function canReadContractSettings(me: MeResponse): boolean {
  const manages = scopesOf(me, 'projects.manage').some(
    (scope) => scope === 'all' || scope === 'own_clients',
  );
  return manages && can(me, 'invoices.read');
}
