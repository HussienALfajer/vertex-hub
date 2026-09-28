import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readConfig(name: string): { extends?: string; compilerOptions?: Record<string, unknown> } {
  return JSON.parse(readFileSync(new URL(`../tsconfig/${name}`, import.meta.url), 'utf8'));
}

describe('shared tsconfig', () => {
  it('base enables strict mode and unchecked index access', () => {
    const { compilerOptions } = readConfig('base.json');
    expect(compilerOptions?.strict).toBe(true);
    expect(compilerOptions?.noUncheckedIndexedAccess).toBe(true);
  });

  it.each(['node.json', 'react.json'])('%s extends base', (name) => {
    expect(readConfig(name).extends).toBe('./base.json');
  });

  it('nest config emits decorator metadata for dependency injection', () => {
    const config = readConfig('nest.json');
    expect(config.extends).toBe('./node.json');
    expect(config.compilerOptions?.emitDecoratorMetadata).toBe(true);
  });
});
