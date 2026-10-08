import type { DepartmentCode } from '@vertex-hub/contracts';

/**
 * The departments an edit sends, or undefined when they are the stored ones in another order: the
 * order carries no meaning, so a reordered list is no change (no write, no audit entry).
 */
export function changedDepartments(
  stored: readonly DepartmentCode[],
  sent: DepartmentCode[] | undefined,
): DepartmentCode[] | undefined {
  if (!sent) return undefined;
  // The contract keeps each code once, so the same length and members mean the same set.
  const same = sent.length === stored.length && sent.every((code) => stored.includes(code));
  return same ? undefined : sent;
}
