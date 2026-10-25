import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readClientLogo } from '../src/pdf/client-logo.js';
import { LOGO, PNG } from './client-logo-cases.js';

describe('readClientLogo (F01C rule 14)', () => {
  let root: string;
  const logger = new Logger('test');

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'vertex-logo-'));
    await mkdir(join(root, 'objects/2026/10'), { recursive: true });
    await writeFile(join(root, 'objects/2026/10/logo'), PNG);
    await writeFile(join(root, 'objects/2026/10/text'), 'not an image');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads the stored square or rendition as a data URL of its type', async () => {
    expect(await readClientLogo(root, 'objects/2026/10/logo', logger)).toBe(LOGO);
  });

  it('is null without a key', async () => {
    expect(await readClientLogo(root, null, logger)).toBeNull();
  });

  it('leaves out a missing file, another type or a key outside the root, and logs it', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    expect(await readClientLogo(root, 'objects/2026/10/missing', logger)).toBeNull();
    expect(await readClientLogo(root, 'objects/2026/10/text', logger)).toBeNull();
    expect(await readClientLogo(root, '../outside', logger)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
