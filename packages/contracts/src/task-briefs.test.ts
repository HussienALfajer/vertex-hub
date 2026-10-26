import { describe, expect, it } from 'vitest';
import { departmentBriefFields, keepsBriefFields, taskBriefFieldsSchema } from './task-briefs.js';

describe('departmentBriefFields (F06B rule C7)', () => {
  it('keeps the fields of the department and stores null when none is filled', () => {
    expect(
      departmentBriefFields('design', { sizes: ['1080 × 1350'], colors: ['#ff0000'] }),
    ).toEqual({ value: { sizes: ['1080 × 1350'], colors: ['#ff0000'] } });
    expect(departmentBriefFields('design', { sizes: [] })).toEqual({ value: null });
  });

  it('names the first field that is not of the department, or of none', () => {
    expect(departmentBriefFields('design', { goal: 'Reach' })).toEqual({ problem: 'goal' });
    expect(departmentBriefFields('general_management', { goal: 'Reach' })).toEqual({
      problem: 'goal',
    });
  });

  it('holds photography lengths to 40 characters and content lengths to 100', () => {
    const length = 'x'.repeat(60);
    expect(departmentBriefFields('photography', { length })).toEqual({ problem: 'length' });
    expect(departmentBriefFields('content_management', { length })).toEqual({ value: { length } });
  });

  it('validates each value: hex colours, links, platforms and money', () => {
    expect(taskBriefFieldsSchema.parse({ colors: ['#aabbcc'] }).colors).toEqual(['#aabbcc']);
    expect(taskBriefFieldsSchema.safeParse({ colors: ['red'] }).success).toBe(false);
    expect(taskBriefFieldsSchema.safeParse({ link: 'ftp://x.test' }).success).toBe(false);
    expect(taskBriefFieldsSchema.safeParse({ platforms: ['instagram', 'instagram'] }).success).toBe(
      false,
    );
    expect(
      taskBriefFieldsSchema.safeParse({ budget: { amountMinor: 1.5, currency: 'USD' } }).success,
    ).toBe(false);
    expect(taskBriefFieldsSchema.safeParse({ sizes: Array(11).fill('1:1') }).success).toBe(false);
    expect(taskBriefFieldsSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe('keepsBriefFields', () => {
  it('keeps the fields for the same kind only', () => {
    expect(keepsBriefFields('design', 'design')).toBe(true);
    expect(keepsBriefFields('design', 'marketing')).toBe(false);
    expect(keepsBriefFields('general_management', 'general_management')).toBe(false);
  });
});
