import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { DepartmentResponse } from '@vertex-hub/contracts';
import { AscentBar, Avatar, PageHeader, Skeleton } from '@vertex-hub/ui';
import { UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { capabilityKey } from './capabilities';
import { departmentListQuery } from './departments.queries';

export function DepartmentsPage() {
  const { t } = useTranslation();
  const departments = useQuery(departmentListQuery);
  return (
    <>
      <PageHeader title={t('departments.title')} description={t('departments.subtitle')} />
      {departments.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => `skeleton-${index}`).map((key) => (
            <Skeleton key={key} className="h-40" />
          ))}
        </div>
      ) : departments.isError ? (
        <LoadError message={t('departments.loadError')} onRetry={() => departments.refetch()} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.data.items.map((department) => (
            <li key={department.id}>
              <DepartmentCard department={department} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function DepartmentCard({ department }: { department: DepartmentResponse }) {
  const { t } = useTranslation();
  const capability = capabilityKey(department.code);
  return (
    <Link
      to="/departments/$departmentId"
      params={{ departmentId: department.id }}
      className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors duration-150 ease-out hover:border-primary"
    >
      <div className="flex items-start gap-3">
        <AscentBar className="mt-0.5 h-5 opacity-60 transition-opacity duration-150 group-hover:opacity-100" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-bold wrap-anywhere">{department.name}</h2>
          {capability && <p className="text-xs text-accent-text">{t(capability)}</p>}
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
        {department.manager ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={department.manager.name} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="text-xs text-muted-foreground">{t('departments.manager')}</span>
              <span className="truncate font-medium">{department.manager.name}</span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('departments.noManager')}</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
          <UsersIcon className="size-4" />
          {t('departments.memberCount', {
            count: department.memberCount,
            n: formatNumber(department.memberCount),
          })}
        </span>
      </div>
    </Link>
  );
}
