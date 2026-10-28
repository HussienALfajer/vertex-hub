import type { DepartmentCode, DepartmentResponse } from '@vertex-hub/contracts';
import type { TFunction } from 'i18next';

/**
 * The departments a picker or filter offers, in their order (F23 rules 4–6): the active ones,
 * then the archived ones among `kept`, so a filter or a record naming one still shows it.
 */
export function pickableDepartments(
  departments: readonly DepartmentResponse[],
  kept: readonly DepartmentCode[] = [],
): DepartmentResponse[] {
  return departments.filter(
    (department) => !department.archivedAt || kept.includes(department.code),
  );
}

/** A department's name, with the archived mark while it is archived (F23 rules 6 and 7). */
export function departmentLabel(
  t: TFunction,
  department: Pick<DepartmentResponse, 'name' | 'archivedAt'>,
): string {
  return department.archivedAt
    ? t('departments.archivedName', { name: department.name })
    : department.name;
}
