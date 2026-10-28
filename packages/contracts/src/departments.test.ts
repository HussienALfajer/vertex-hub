import { describe, expect, it } from 'vitest';
import {
  archiveDepartmentSchema,
  createDepartmentSchema,
  DEPARTMENT_SYSTEM_FUNCTIONS,
  departmentCodeSchema,
  departmentSystemFunctions,
  generatedDepartmentCode,
  isSystemDepartmentCode,
  SYSTEM_DEPARTMENT_CODES,
} from './departments.js';
import { DEPARTMENT_CAPABILITIES } from './permissions.js';

describe('departmentCodeSchema', () => {
  it('accepts the system codes and generated ones', () => {
    for (const code of [...SYSTEM_DEPARTMENT_CODES, 'd_abcd2345']) {
      expect(departmentCodeSchema.safeParse(code).success, code).toBe(true);
    }
  });

  it('refuses codes outside the pattern', () => {
    for (const code of ['', 'a', '_design', '2design', 'Design', 'de-sign', 'x'.repeat(41)]) {
      expect(departmentCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });
});

describe('generatedDepartmentCode', () => {
  it('maps eight bytes to d_ and eight base-32 characters matching the pattern', () => {
    const code = generatedDepartmentCode(new Uint8Array([0, 1, 25, 26, 31, 32, 255, 100]));
    expect(code).toBe('d_abz27a7e');
    expect(departmentCodeSchema.safeParse(code).success).toBe(true);
    expect(isSystemDepartmentCode(code)).toBe(false);
  });

  it('needs exactly eight bytes', () => {
    expect(() => generatedDepartmentCode(new Uint8Array(7))).toThrow();
  });
});

describe('DEPARTMENT_SYSTEM_FUNCTIONS', () => {
  it('names a function for every department that grants capabilities', () => {
    for (const code of Object.keys(DEPARTMENT_CAPABILITIES)) {
      expect(departmentSystemFunctions(code).length, code).toBeGreaterThan(0);
    }
  });

  it('is keyed by system codes only, and added departments have none', () => {
    expect(Object.keys(DEPARTMENT_SYSTEM_FUNCTIONS).every(isSystemDepartmentCode)).toBe(true);
    expect(departmentSystemFunctions('d_abcd2345')).toEqual([]);
    expect(departmentSystemFunctions('design')).toEqual([]);
  });
});

describe('department inputs (F23)', () => {
  it('takes a target for any category and refuses others', () => {
    const id = '0192a5a0-0000-7000-8000-000000000001';
    expect(archiveDepartmentSchema.safeParse({ targets: {} }).success).toBe(true);
    expect(archiveDepartmentSchema.safeParse({ targets: { tasks: id } }).success).toBe(true);
    expect(archiveDepartmentSchema.safeParse({ targets: { clients: id } }).success).toBe(false);
  });

  it('needs a palette color and a curated icon', () => {
    const base = { name: 'Video', color: 'c3', icon: 'film' };
    expect(createDepartmentSchema.safeParse(base).success).toBe(true);
    expect(createDepartmentSchema.safeParse({ ...base, color: 'red' }).success).toBe(false);
    expect(createDepartmentSchema.safeParse({ ...base, icon: 'rocket' }).success).toBe(false);
    expect(
      createDepartmentSchema.safeParse({ ...base, description: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
