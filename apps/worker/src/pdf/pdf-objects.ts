import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/** A stored render, as the API's ready jobs take it. */
export interface StoredPdf {
  storageKey: string;
  sizeBytes: number;
  sha256: string;
}

/**
 * Writes a render under `FILES_ROOT` once per storage key: the key holds the payload's hash, so a
 * retry or a second run finds the file and renders nothing new (ADR 0008).
 */
export async function storeOnce(
  root: string,
  storageKey: string,
  render: () => Promise<Buffer>,
): Promise<StoredPdf> {
  const path = resolve(root, storageKey);
  // Refuses anything that would leave the root.
  if (!path.startsWith(resolve(root) + sep)) throw new Error(`Invalid storage key: ${storageKey}`);
  const bytes: Buffer = (await readFile(path).catch(() => null)) ?? (await write(path, render));
  return {
    storageKey,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function write(path: string, render: () => Promise<Buffer>): Promise<Buffer> {
  const bytes = await render();
  await mkdir(dirname(path), { recursive: true });
  // Written aside, then renamed: a reader never sees half a file.
  const partial = `${path}.${process.pid}.part`;
  try {
    await writeFile(partial, bytes);
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
  return bytes;
}
