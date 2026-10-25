import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Logger } from '@nestjs/common';

/** The image types a profile image is stored in (F01C rule 2), by their first bytes. */
function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * F01C rule 14: the client's logo under `FILES_ROOT` as a data URL for the client block. A
 * missing or unreadable file prints the name alone and is logged; it never fails the PDF.
 */
export async function readClientLogo(
  root: string,
  key: string | null,
  logger: Logger,
): Promise<string | null> {
  if (!key) return null;
  const path = resolve(root, key);
  if (!path.startsWith(resolve(root) + sep)) {
    logger.warn(`Client logo outside the files root: ${key}`);
    return null;
  }
  try {
    const bytes = await readFile(path);
    const type = imageType(bytes);
    if (!type) throw new Error('not a PNG, JPEG or WebP image');
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch (error) {
    logger.warn(`Client logo ${key} left out: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
