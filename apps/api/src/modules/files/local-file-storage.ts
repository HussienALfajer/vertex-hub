import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, statfs } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { newId } from '@vertex-hub/db';
import { ENV, type Env } from '../../core/config/env.js';
import { FileStorage } from './file-storage.js';

/** Files on the local disk under `FILES_ROOT` (ADR 0019). */
@Injectable()
export class LocalFileStorage extends FileStorage {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    super();
    this.root = resolve(env.FILES_ROOT);
  }

  newKey(now = new Date()): string {
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `objects/${now.getUTCFullYear()}/${month}/${newId()}`;
  }

  async writable(key: string): Promise<Writable> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    return createWriteStream(path, { flags: 'wx' });
  }

  read(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.path(key), range);
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await stat(this.path(key))).size;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async freeBytes(): Promise<number> {
    await mkdir(this.root, { recursive: true });
    const stats = await statfs(this.root);
    return Number(stats.bavail) * Number(stats.bsize);
  }

  /** The absolute path of a key, refusing anything that would leave the root. */
  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid storage key: ${key}`);
    return path;
  }
}
