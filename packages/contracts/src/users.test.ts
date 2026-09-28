import { describe, expect, it } from 'vitest';
import {
  createUserSchema,
  phoneSchema,
  skillsSchema,
  updateUserSchema,
  userListQuerySchema,
} from './users.js';

const design = '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7';
const marketing = '01a0e97d-0027-7a51-8d1e-2bd9badfa0c8';

describe('phoneSchema', () => {
  it('normalizes to + and digits', () => {
    expect(phoneSchema.parse('+963 (944) 123-456')).toBe('+963944123456');
    expect(phoneSchema.parse('00963.944.123.456')).toBe('+963944123456');
  });

  it('stores blank as null', () => {
    expect(phoneSchema.parse('  ')).toBeNull();
    expect(phoneSchema.parse(null)).toBeNull();
  });

  it('rejects numbers without a country code or with the wrong length', () => {
    for (const phone of ['0944123456', '+1234567', '+1234567890123456', '+96394412345x']) {
      expect(phoneSchema.safeParse(phone).success, phone).toBe(false);
    }
  });
});

describe('skillsSchema', () => {
  it('trims and keeps one spelling per skill regardless of case', () => {
    expect(skillsSchema.parse(['Photoshop', ' photoshop ', 'مونتاج', 'PHOTOSHOP'])).toEqual([
      'Photoshop',
      'مونتاج',
    ]);
  });

  it('limits length and count', () => {
    expect(skillsSchema.safeParse(['']).success).toBe(false);
    expect(skillsSchema.safeParse(['x'.repeat(41)]).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => `skill ${i}`);
    expect(skillsSchema.safeParse(many).success).toBe(false);
    expect(skillsSchema.safeParse([...many.slice(0, 20), 'SKILL 0']).success).toBe(true);
  });
});

describe('createUserSchema', () => {
  const valid = { name: ' سارة ', email: 'Sara@Vertex.Example', primaryDepartmentId: design };

  it('trims the name and lower-cases the email', () => {
    expect(createUserSchema.parse(valid)).toMatchObject({
      name: 'سارة',
      email: 'sara@vertex.example',
    });
  });

  it('accepts assigned roles only', () => {
    expect(createUserSchema.safeParse({ ...valid, roles: ['finance'] }).success).toBe(true);
    for (const role of ['employee', 'department_manager']) {
      expect(createUserSchema.safeParse({ ...valid, roles: [role] }).success, role).toBe(false);
    }
  });

  it('refuses the primary department as a secondary one', () => {
    expect(
      createUserSchema.safeParse({ ...valid, secondaryDepartmentIds: [marketing] }).success,
    ).toBe(true);
    expect(createUserSchema.safeParse({ ...valid, secondaryDepartmentIds: [design] }).success).toBe(
      false,
    );
    expect(
      updateUserSchema.safeParse({ primaryDepartmentId: design, secondaryDepartmentIds: [design] })
        .success,
    ).toBe(false);
  });

  it('limits name and title length and stores a blank title as null', () => {
    expect(createUserSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, name: 'x'.repeat(101) }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...valid, title: 'x'.repeat(81) }).success).toBe(false);
    expect(createUserSchema.parse({ ...valid, title: '  ' }).title).toBeNull();
  });
});

describe('userListQuerySchema', () => {
  it('lists active users by default', () => {
    expect(userListQuerySchema.parse({})).toMatchObject({
      status: 'active',
      page: 1,
      pageSize: 50,
    });
  });
});
