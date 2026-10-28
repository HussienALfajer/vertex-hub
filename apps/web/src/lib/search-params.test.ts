import { describe, expect, it } from 'vitest';
import { departmentListParam, departmentParam, textParam } from './search-params';

describe('search params', () => {
  it('reads text trimmed and cut, and drops what is not text', () => {
    expect(textParam('  مطعم  ', 100)).toBe('مطعم');
    expect(textParam('x'.repeat(130), 100)).toHaveLength(100);
    expect(textParam('   ', 100)).toBeUndefined();
    expect(textParam(['a'], 100)).toBeUndefined();
    expect(textParam(undefined, 100)).toBeUndefined();
  });

  it('reads a number the router parsed from a typed link as text', () => {
    expect(textParam(3, 100)).toBe('3');
    expect(textParam(963944123456, 100)).toBe('963944123456');
  });

  it('reads department codes by their pattern, so added and archived departments pass', () => {
    expect(departmentParam('design')).toBe('design');
    expect(departmentParam('d_abcd2345')).toBe('d_abcd2345');
    expect(departmentParam('Design')).toBeUndefined();
    expect(departmentParam(3)).toBeUndefined();
    expect(departmentListParam(['design', 'bad code', 'design', 'd_abcd2345'])).toEqual([
      'design',
      'd_abcd2345',
    ]);
    expect(departmentListParam(['x'])).toBeUndefined();
    expect(departmentListParam('design')).toBeUndefined();
  });
});
