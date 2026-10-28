import type { DepartmentCode, DepartmentResponse } from '@vertex-hub/contracts';

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
