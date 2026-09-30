import type { Readable, Writable } from 'node:stream';

/**
 * Where file content lives (ADR 0009, ADR 0019). One adapter today, the local disk under
 * `FILES_ROOT`; object storage later is another implementation of this class.
 */
export abstract class FileStorage {
  /** A new object key, `objects/<yyyy>/<mm>/<uuid>`; original names never reach the disk. */
  abstract newKey(now?: Date): string;
  /** A stream that writes a new object at `key`, creating its folder; never overwrites. */
  abstract writable(key: string): Promise<Writable>;
  /** Reads `key`, or the inclusive byte range of it. */
  abstract read(key: string, range?: { start: number; end: number }): Readable;
  /** The object's size, or null when it does not exist. */
  abstract size(key: string): Promise<number | null>;
  /** Removes `key`; a missing object is not an error. */
  abstract remove(key: string): Promise<void>;
  /** Bytes still free on the disk that holds the files. */
  abstract freeBytes(): Promise<number>;
}
