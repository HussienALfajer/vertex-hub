import { describe, expect, it } from 'vitest';
import { textParam } from './search-params';

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
});
