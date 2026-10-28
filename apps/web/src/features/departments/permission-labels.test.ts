import { PERMISSIONS } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import ar from '../../i18n/locales/ar.json';

describe('permission labels', () => {
  it('give every permission an Arabic label (F23 rule 28)', () => {
    const labels: Record<string, Record<string, string>> = ar.permissions;
    for (const permission of PERMISSIONS) {
      const [module, action] = permission.split('.') as [string, string];
      expect(labels[module]?.[action], permission).toBeTruthy();
    }
    const labelled = Object.entries(labels).flatMap(([module, actions]) =>
      Object.keys(actions).map((action) => `${module}.${action}`),
    );
    expect(labelled.toSorted()).toEqual([...PERMISSIONS].toSorted());
  });
});
