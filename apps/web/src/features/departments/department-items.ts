import { useQuery } from '@tanstack/react-query';
import type { DepartmentCode } from '@vertex-hub/contracts';
import { useTranslation } from 'react-i18next';
import { departmentListQuery } from './departments.queries';
import { pickableDepartments } from './pickable-departments';

/** `pickableDepartments` as select items, an archived one named with its mark. */
export function useDepartmentItems(
  kept: readonly DepartmentCode[] = [],
): { value: DepartmentCode; label: string }[] {
  const { t } = useTranslation();
  const departments = useQuery(departmentListQuery);
  return pickableDepartments(departments.data?.items ?? [], kept).map(
    ({ code, name, archivedAt }) => ({
      value: code,
      label: archivedAt ? t('departments.archivedName', { name }) : name,
    }),
  );
}
