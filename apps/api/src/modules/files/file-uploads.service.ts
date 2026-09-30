import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { type Readable, Transform, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  FILE_MAX_BYTES,
  FILE_MIN_FREE_BYTES,
  FILE_ORIGINAL_NAME_MAX,
  FILE_UPLOAD_LIFETIME_HOURS,
  type FileUpload,
  fileExtension,
  isBlockedFile,
  isPreviewableMimeType,
} from '@vertex-hub/contracts';
import { type Database, fileUploads } from '@vertex-hub/db';
import busboy from 'busboy';
import { lt } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { FileStorage } from './file-storage.js';

/** Bytes file-type needs to recognize a format. */
const SNIFF_BYTES = 4100;

/** The start of an image kept to read its dimensions; the preview job fills them in otherwise. */
const HEAD_BYTES = 512 * 1024;

/** Multipart framing around the file, allowed on top of the file limit. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** Types by extension, for content file-type does not recognize (text formats, mostly). */
const EXTENSION_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  html: 'text/html',
  htm: 'text/html',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  md: 'text/markdown',
  css: 'text/css',
  js: 'text/javascript',
};

interface Received {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
}

const NO_DIMENSIONS = { width: null, height: null };

/**
 * Step 1 of an upload (spec F10 rule 1): streams one file straight to its object key, hashing it
 * on the way, and records it until it is attached or purged.
 */
@Injectable()
export class FileUploadsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: FileStorage,
  ) {}

  async upload(actor: CurrentUserInfo, request: IncomingMessage): Promise<FileUpload> {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (declared > FILE_MAX_BYTES + MULTIPART_OVERHEAD) throw tooLarge();
    if ((await this.storage.freeBytes()) - declared < FILE_MIN_FREE_BYTES) throw storageFull();

    const key = this.storage.newKey();
    try {
      // Settles only once the object is fully written or its write stream is closed, so the
      // removal below never leaves an open, unlinked file behind.
      const received = await this.receive(request, key);
      if (received.sizeBytes === 0) {
        throw new CodedException(400, 'FILE_EMPTY', 'The file is empty');
      }
      if (isBlockedFile(received.originalName, received.mimeType)) {
        throw new CodedException(400, 'FILE_TYPE_BLOCKED', 'Executables and scripts are refused');
      }
      if ((await this.storage.freeBytes()) < FILE_MIN_FREE_BYTES) throw storageFull();
      const [row] = await this.db
        .insert(fileUploads)
        .values({ userId: actor.id, storageKey: key, ...received })
        .returning({ id: fileUploads.id });
      if (!row) throw new Error('Upload not recorded');
      return {
        uploadId: row.id,
        name: received.originalName,
        sizeBytes: received.sizeBytes,
        mimeType: received.mimeType,
      };
    } catch (error) {
      await this.storage.remove(key);
      throw error;
    }
  }

  /**
   * Deletes uploads left unattached longer than their lifetime, and their content. Returns how
   * many it removed.
   */
  async purgeUploads(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - FILE_UPLOAD_LIFETIME_HOURS * 3600 * 1000);
    const stale = await this.db
      .delete(fileUploads)
      .where(lt(fileUploads.createdAt, before))
      .returning({ key: fileUploads.storageKey });
    for (const { key } of stale) await this.storage.remove(key);
    return stale.length;
  }

  /**
   * Streams the multipart field `file` to `key`; other fields and files are ignored. A broken
   * or aborted body destroys the parser, which fails the file stream and its write.
   */
  private receive(request: IncomingMessage, key: string): Promise<Received> {
    let parser: busboy.Busboy;
    try {
      parser = busboy({
        headers: request.headers,
        defParamCharset: 'utf8',
        limits: { files: 1, fileSize: FILE_MAX_BYTES, fields: 0, parts: 1 },
      });
    } catch {
      return Promise.reject(new BadRequestException('Expected a multipart upload'));
    }
    let stored: Promise<Received> | undefined;
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || stored) {
        stream.resume();
        return;
      }
      stored = this.store(stream, info.filename, key);
      // Awaited below; this keeps a failure before then from being reported as unhandled.
      stored.catch(() => undefined);
    });
    return pipeline(request, parser).then(
      () => stored ?? Promise.reject(new BadRequestException('The field `file` is missing')),
      async (error: unknown) => {
        // The write is closed before the caller removes the object. A storage failure is the
        // store's own error (a 500), not an interrupted upload.
        const storeError = await stored?.then(
          () => null,
          (failure: unknown) => failure,
        );
        if (isFileSystemError(storeError)) throw storeError;
        throw new BadRequestException(`The upload was interrupted: ${String(error)}`);
      },
    );
  }

  private async store(
    stream: Readable & { truncated?: boolean },
    filename: string | undefined,
    key: string,
  ): Promise<Received> {
    const hash = createHash('sha256');
    const head: Buffer[] = [];
    let headBytes = 0;
    let sizeBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        sizeBytes += chunk.length;
        if (headBytes < HEAD_BYTES) {
          head.push(chunk);
          headBytes += chunk.length;
        }
        callback(null, chunk);
      },
    });
    // The file stream is piped at once, so an error it emits while the object opens is handled.
    const reading = pipeline(stream, meter);
    reading.catch(() => undefined);
    let writable: Writable;
    try {
      writable = await this.storage.writable(key);
    } catch (error) {
      // Nothing would read the file stream: fail it, so the parser and the request move on.
      meter.destroy(error as Error);
      throw error;
    }
    const writing = pipeline(meter, writable);
    // Both settle before this returns, so the caller removes the object only once it is closed.
    await Promise.allSettled([reading, writing]);
    await reading;
    await writing;
    if (stream.truncated) throw tooLarge();
    const originalName = cleanName(filename);
    const start = Buffer.concat(head).subarray(0, HEAD_BYTES);
    const mimeType = await detectType(start.subarray(0, SNIFF_BYTES), originalName);
    return {
      originalName,
      mimeType,
      sizeBytes,
      sha256: hash.digest('hex'),
      ...(isPreviewableMimeType(mimeType) ? await dimensions(start) : NO_DIMENSIONS),
    };
  }
}

const tooLarge = () =>
  new CodedException(413, 'FILE_TOO_LARGE', 'Files are limited to 250 MB: add a link instead');

const storageFull = () => new CodedException(507, 'STORAGE_FULL', 'The files disk is nearly full');

/** The uploaded name without folders or control characters, within the stored length. */
function cleanName(filename: string | undefined): string {
  const base = (filename ?? '').split(/[\\/]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean.slice(-FILE_ORIGINAL_NAME_MAX) || 'file';
}

/** A failure of the disk (it names a system call), as opposed to a broken or aborted body. */
const isFileSystemError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'syscall' in error;

/** Dimensions from the start of an image, when its header is there (data table: "when known"). */
async function dimensions(start: Buffer): Promise<{ width: number | null; height: number | null }> {
  try {
    const { width, height } = await sharp(start, { failOn: 'none' }).metadata();
    return { width: width ?? null, height: height ?? null };
  } catch {
    return NO_DIMENSIONS;
  }
}

/** The type from the content's magic bytes, else from the extension. */
async function detectType(head: Buffer, name: string): Promise<string> {
  const detected = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;
  if (detected) return detected.mime;
  const extension = fileExtension(name);
  return (extension && EXTENSION_TYPES[extension]) || 'application/octet-stream';
}
