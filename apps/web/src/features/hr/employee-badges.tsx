import type { EmployeeStatus, PasskeyState } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';

const statusTone = { active: 'success', leaving: 'warning', ended: 'neutral' } as const;

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`hr.statuses.${status}`)}
    </Badge>
  );
}

/** Rules C3, C9 and C10: an active passkey, a replacement waiting, or none (no punch). */
export function PasskeyStateBadge({ passkey }: { passkey: PasskeyState }) {
  const { t } = useTranslation();
  if (passkey.pending) {
    return <Badge tone="info">{t('hr.attendance.passkey.pending')}</Badge>;
  }
  return passkey.active ? (
    <Badge tone="success">{t('hr.attendance.passkey.active')}</Badge>
  ) : (
    <Badge tone="warning">{t('hr.attendance.passkey.none')}</Badge>
  );
}
