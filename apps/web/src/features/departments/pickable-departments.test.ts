import type { DepartmentResponse } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { pickableDepartments } from './pickable-departments';

const department = (code: string, archivedAt: string | null = null): DepartmentResponse => ({
  id: `01920000-0000-7000-8000-${code.length.toString().padStart(12, '0')}`,
  code,
  name: code,
  description: null,
  color: 'c1',
  icon: 'briefcase',
  position: 1,
  archivedAt,
  manager: null,
  memberCount: 0,
});

describe('pickableDepartments', () => {
  const list = [
    department('design'),
    department('marketing'),
    department('d_abcd2345', '2026-10-28T10:00:00.000Z'),
  ];

  it('offers the active departments in the order the API gives (F23 rules 4 and 5)', () => {
    expect(pickableDepartments(list).map((d) => d.code)).toEqual(['design', 'marketing']);
  });

  it('keeps an archived department a filter or record already names (rule 6)', () => {
    expect(pickableDepartments(list, ['d_abcd2345']).map((d) => d.code)).toEqual([
      'design',
      'marketing',
      'd_abcd2345',
    ]);
  });
});
