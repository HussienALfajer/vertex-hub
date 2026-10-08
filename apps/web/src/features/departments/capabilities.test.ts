import { DEPARTMENT_CAPABILITIES, DEPARTMENT_CODES } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import { capabilityKey } from './capabilities';

describe('capabilityKey', () => {
  it('describes exactly the departments whose positions grant permissions', () => {
    for (const code of DEPARTMENT_CODES) {
      expect(capabilityKey(code) !== null, code).toBe(code in DEPARTMENT_CAPABILITIES);
    }
  });
});
