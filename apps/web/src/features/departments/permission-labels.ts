import type { Permission } from '@vertex-hub/contracts';
import type { TFunction } from 'i18next';

/** A permission as a translated sentence (F23 rule 28). */
export function permissionLabel(t: TFunction, permission: Permission): string {
  return t(`permissions.${permission}` as 'permissions.users.read');
}
