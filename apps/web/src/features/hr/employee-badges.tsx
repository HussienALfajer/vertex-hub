import type { EmployeeStatus } from '@vertex-hub/contracts';
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
