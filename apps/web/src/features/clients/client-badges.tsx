import type { ClientStatus, PlatformAccess } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { ShieldAlertIcon, StethoscopeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const statusTone = { active: 'success', paused: 'warning', ended: 'neutral' } as const;

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`clients.statuses.${status}`)}
    </Badge>
  );
}

export function HealthcareBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="info">
      <StethoscopeIcon aria-hidden="true" />
      {t('clients.healthcare')}
    </Badge>
  );
}

/** Rule 9: no contact may give final approval, so approval links cannot be sent yet. */
export function NoApprovalContactBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <ShieldAlertIcon aria-hidden="true" />
      {t('clients.noApprovalContact')}
    </Badge>
  );
}

const accessTone = { granted: 'success', pending: 'warning', none: 'neutral' } as const;

export function PlatformAccessBadge({ access }: { access: PlatformAccess }) {
  const { t } = useTranslation();
  return (
    <Badge tone={accessTone[access]}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`clients.platforms.access.${access}`)}
    </Badge>
  );
}
