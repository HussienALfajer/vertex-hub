import type { DepartmentDetailResponse, Permission } from '@vertex-hub/contracts';
import { Card, CardHeader, CardTitle, EmptyState } from '@vertex-hub/ui';
import { CheckIcon, KeyRoundIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { permissionLabel } from './permission-labels';

/** Rule 27: what members and the manager receive, and the department's system functions. */
export function DepartmentGrants({ department }: { department: DepartmentDetailResponse }) {
  const { t } = useTranslation();
  const { grants, systemFunctions } = department;
  if (grants.member.length === 0 && grants.manager.length === 0 && systemFunctions.length === 0) {
    return <EmptyState icon={<KeyRoundIcon />} title={t('departments.grants.none')} />;
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <PermissionList title={t('departments.grants.member')} permissions={grants.member} />
      <PermissionList title={t('departments.grants.manager')} permissions={grants.manager} />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('departments.grants.functions')}</CardTitle>
        </CardHeader>
        {systemFunctions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('departments.grants.noFunctions')}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {systemFunctions.map((name) => (
              <li key={name} className="flex items-start gap-2">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
                {t(`departments.functions.${name}`)}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PermissionList({ title, permissions }: { title: string; permissions: Permission[] }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      {permissions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('departments.grants.nothing')}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {permissions.map((permission) => (
            <li key={permission} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent-text" />
              {permissionLabel(t, permission)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
