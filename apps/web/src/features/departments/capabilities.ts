import { DEPARTMENT_CAPABILITIES, type DepartmentCode } from '@vertex-hub/contracts';

const described = [
  'internal_operations',
  'medical_consultation',
  'general_communication',
  'marketing',
] as const;

/**
 * The translation key explaining what a position in this department grants (ADR 0014), or null
 * for departments without capabilities.
 */
export function capabilityKey(code: DepartmentCode) {
  const match = described.find((department) => department === code);
  return match && DEPARTMENT_CAPABILITIES[match]
    ? (`departments.capabilities.${match}` as const)
    : null;
}
