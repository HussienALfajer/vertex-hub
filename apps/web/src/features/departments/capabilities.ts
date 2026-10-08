import type { DepartmentCode } from '@vertex-hub/contracts';

/** The departments whose positions grant permissions: every key of `DEPARTMENT_CAPABILITIES`. */
const described = [
  'internal_operations',
  'content_management',
  'medical_consultation',
  'photography',
  'general_communication',
  'marketing',
] as const satisfies readonly DepartmentCode[];

/**
 * The translation key explaining what a position in this department grants (ADR 0014), or null
 * for departments without capabilities.
 */
export function capabilityKey(code: DepartmentCode) {
  const match = described.find((department) => department === code);
  return match ? (`departments.capabilities.${match}` as const) : null;
}
