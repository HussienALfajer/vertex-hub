import type { UserDepartment, UserStatus } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { ShieldCheckIcon, ShieldOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const statusTone = { active: 'success', invited: 'info', archived: 'neutral' } as const;

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`users.statuses.${status}`)}
    </Badge>
  );
}

export function TwoFactorIndicator({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const label = enabled ? t('users.twoFactorOn') : t('users.twoFactorOff');
  return enabled ? (
    <ShieldCheckIcon
      role="img"
      aria-label={label}
      className="size-4 text-status-success-foreground"
    />
  ) : (
    <ShieldOffIcon role="img" aria-label={label} className="size-4 text-muted-foreground" />
  );
}

/** The primary department, then secondary ones as outlined chips, with a marker where they manage. */
export function DepartmentChips({ departments }: { departments: UserDepartment[] }) {
  const { t } = useTranslation();
  if (departments.length === 0) return <Badge tone="warning">{t('users.noDepartment')}</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {departments.map((department) => (
        <Badge key={department.id} tone={department.isPrimary ? 'neutral' : 'outline'}>
          {department.isManager && (
            <span aria-hidden="true" className="inline-block h-3 w-0.5 -skew-x-30 bg-accent" />
          )}
          {department.name}
          {department.isManager && (
            <span className="sr-only">{t('users.manages', { department: department.name })}</span>
          )}
          {!department.isPrimary && <span className="sr-only">{t('users.secondary')}</span>}
        </Badge>
      ))}
    </div>
  );
}
