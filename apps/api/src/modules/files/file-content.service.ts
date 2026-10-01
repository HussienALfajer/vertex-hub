import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import {
  FILES_PREVIEW_JOB,
  FILES_PURGE_UPLOADS_JOB,
  fileExtension,
  isInlineMimeType,
} from '@vertex-hub/contracts';
import { type Database, fileItems, fileVersions } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { JobQueue } from '../../core/jobs/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { assertVisible, ownerIdOf, type VersionRow } from './file-access.js';
import { FileOwnerRegistry } from './file-owner-registry.js';
import { FileStorage } from './file-storage.js';
import { FileUploadsService } from './file-uploads.service.js';

/** nginx's internal location that serves `FILES_ROOT` (deploy/nginx). */
const ACCEL_PREFIX = '/_files/';

/**
 * The same files for the holder of an approval link (F09 rule 23): its own internal location,
 * because the location sets the headers of the response, and these never send a referrer.
 */
const PUBLIC_ACCEL_PREFIX = '/_public_files/';

/** Long sides of the rendered previews (rule 18). */
const THUMBNAIL_PX = 400;
const PREVIEW_PX = 1600;

/** Attempts per image before it is marked `failed`. */
const PREVIEW_ATTEMPTS = FILES_PREVIEW_JOB.retryLimit;

/** Previews rendered per job run; the job queues itself again while some are left. */
const PREVIEW_BATCH = 20;

export type PreviewSize = 'thumbnail' | 'preview';

const previewKey = (key: string, size: PreviewSize) =>
  `${key}.${size === 'thumbnail' ? 'thumb' : 'preview'}.webp`;

/**
 * Serving content (spec F10 rules 16–18) and the `files.preview` and `files.purge-uploads` jobs,
 * which `apps/worker` schedules and this process works (ADR 0008).
 */
@Injectable()
export class FileContentService implements OnModuleInit {
  private readonly logger = new Logger(FileContentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly owners: FileOwnerRegistry,
    private readonly storage: FileStorage,
    private readonly uploads: FileUploadsService,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.work(FILES_PREVIEW_JOB.queue, async () => {
      const result = await this.renderPendingPreviews();
      if (result.left) await this.jobs.send(FILES_PREVIEW_JOB.queue);
    });
    this.jobs.work(FILES_PURGE_UPLOADS_JOB.queue, async () => {
      const purged = await this.uploads.purgeUploads();
      this.logger.log(`Purged ${purged} unattached uploads`);
      // A preview queued just before a restart is still `pending`: the daily run picks it up.
      await this.jobs.send(FILES_PREVIEW_JOB.queue);
    });
  }

  /** Rules 16 and 17: the bytes of an upload version the actor may read. */
  async content(
    actor: CurrentUserInfo,
    versionId: string,
    download: boolean,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { version, confidential, downloadName } = await this.readable(actor, versionId);
    if (version.kind !== 'upload' || !version.storageKey || !version.mimeType) {
      throw new NotFoundException();
    }
    const inline = !download && isInlineMimeType(version.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', inline ? version.mimeType : 'application/octet-stream');
    response.setHeader('Content-Disposition', contentDisposition(inline, downloadName));
    response.setHeader('Cache-Control', cacheControl(confidential));
    await this.send(version.storageKey, request, response);
  }

  /** Rule 18: a rendered WebP of an image version, once `ready`. */
  async preview(
    actor: CurrentUserInfo,
    versionId: string,
    size: PreviewSize,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const { version, confidential } = await this.readable(actor, versionId);
    if (version.previewStatus !== 'ready' || !version.storageKey) throw new NotFoundException();
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', cacheControl(confidential));
    await this.send(previewKey(version.storageKey, size), request, response);
  }

  /**
   * F09 rule 22: a version an approval link shows, once the `approvals` module checked the link
   * and that the version is in one of its snapshots. Never cached; a download only for the types
   * a browser cannot show.
   */
  async sent(
    versionId: string,
    part: 'content' | PreviewSize,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const [row] = await this.db
      .select({ version: fileVersions, item: fileItems })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(eq(fileVersions.id, versionId));
    const version = row?.version;
    if (!row || !version?.storageKey || !version.mimeType) throw new NotFoundException();
    if (version.archivedAt || row.item.archivedAt) throw new NotFoundException();
    if (part !== 'content' && version.previewStatus !== 'ready') throw new NotFoundException();
    const inline = part !== 'content' || isInlineMimeType(version.mimeType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Type',
      part !== 'content' ? 'image/webp' : inline ? version.mimeType : 'application/octet-stream',
    );
    response.setHeader(
      'Content-Disposition',
      part !== 'content'
        ? 'inline'
        : contentDisposition(inline, downloadName(null, row.item.name, version)),
    );
    response.setHeader('Cache-Control', 'no-store');
    await this.send(
      part === 'content' ? version.storageKey : previewKey(version.storageKey, part),
      request,
      response,
      PUBLIC_ACCEL_PREFIX,
    );
  }

  /**
   * Rule 18: renders the thumbnail and preview of pending image versions, trying each up to three
   * times before marking it `failed` (the file still downloads).
   */
  async renderPendingPreviews(): Promise<{ ready: number; failed: number; left: boolean }> {
    const pending = await this.db
      .select({ id: fileVersions.id, key: fileVersions.storageKey })
      .from(fileVersions)
      .where(eq(fileVersions.previewStatus, 'pending'))
      .orderBy(fileVersions.id)
      .limit(PREVIEW_BATCH + 1);
    let ready = 0;
    let failed = 0;
    for (const { id, key } of pending.slice(0, PREVIEW_BATCH)) {
      const rendered = key ? await this.render(key) : null;
      await this.db
        .update(fileVersions)
        .set(
          rendered
            ? {
                previewStatus: 'ready',
                width: rendered.width || null,
                height: rendered.height || null,
              }
            : { previewStatus: 'failed' },
        )
        .where(eq(fileVersions.id, id));
      if (rendered) ready += 1;
      else failed += 1;
    }
    return { ready, failed, left: pending.length > PREVIEW_BATCH };
  }

  /** Renders both sizes from one read of the image; returns its dimensions, or null on failure. */
  private async render(key: string): Promise<{ width: number; height: number } | null> {
    for (let attempt = 1; attempt <= PREVIEW_ATTEMPTS; attempt += 1) {
      try {
        const source = await this.readAll(key);
        const { width, height } = await sharp(source, { failOn: 'error' }).metadata();
        for (const [size, px] of [
          ['thumbnail', THUMBNAIL_PX],
          ['preview', PREVIEW_PX],
        ] as const) {
          const target = previewKey(key, size);
          await this.storage.remove(target);
          const output = sharp(source, { failOn: 'error' })
            .rotate()
            .resize(px, px, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 });
          await pipeline(output, await this.storage.writable(target));
        }
        return { width: width ?? 0, height: height ?? 0 };
      } catch (error) {
        this.logger.warn(`Preview of ${key} failed (attempt ${attempt}): ${String(error)}`);
      }
    }
    return null;
  }

  /** The whole object; only previewable images within `FILE_PREVIEW_MAX_BYTES` are read. */
  private async readAll(key: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.storage.read(key)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** A version of an item the actor may see, with its download name (rule 16). */
  private async readable(actor: CurrentUserInfo, versionId: string) {
    const [row] = await this.db
      .select({ version: fileVersions, item: fileItems })
      .from(fileVersions)
      .innerJoin(fileItems, eq(fileItems.id, fileVersions.fileItemId))
      .where(eq(fileVersions.id, versionId));
    if (!row) throw new NotFoundException();
    const owner = await this.owners
      .policy(row.item.ownerType)
      .find(this.db, actor, ownerIdOf(row.item));
    assertVisible(owner, row.item);
    if (row.version.archivedAt && !owner.rights.scopeAll) throw new NotFoundException();
    return {
      version: row.version as VersionRow,
      confidential: row.item.confidential,
      downloadName: downloadName(owner.clientName, row.item.name, row.version),
    };
  }

  /** Through nginx in production (range requests there); streamed here in development. */
  private async send(
    key: string,
    request: IncomingMessage,
    response: ServerResponse,
    accelPrefix: string = ACCEL_PREFIX,
  ): Promise<void> {
    const size = await this.storage.size(key);
    if (size === null) throw new NotFoundException();
    if (this.env.FILES_X_ACCEL) {
      response.setHeader('X-Accel-Redirect', `${accelPrefix}${key}`);
      response.statusCode = 200;
      response.end();
      return;
    }
    response.setHeader('Accept-Ranges', 'bytes');
    const range = parseRange(request.headers.range, size);
    if (range === 'invalid') {
      response.setHeader('Content-Range', `bytes */${size}`);
      response.statusCode = 416;
      response.end();
      return;
    }
    if (range) {
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      response.statusCode = 200;
      response.setHeader('Content-Length', String(size));
    }
    await new Promise<void>((resolvePromise, reject) => {
      const stream = this.storage.read(key, range ?? undefined);
      stream.on('error', reject);
      response.on('close', () => {
        stream.destroy();
        resolvePromise();
      });
      stream.pipe(response);
    });
  }
}

/** Content changes never, so it may be cached; confidential documents never (edge case 8). */
const cacheControl = (confidential: boolean) =>
  confidential ? 'private, no-store' : 'private, max-age=86400';

/** `<client> - <item> - v<n>.<ext>`, without the client for internal tasks (rule 16). */
export function downloadName(
  clientName: string | null,
  itemName: string,
  version: Pick<VersionRow, 'number' | 'originalName'>,
): string {
  const extension = version.originalName ? fileExtension(version.originalName) : null;
  const base = [clientName, itemName, `v${version.number}`].filter(Boolean).join(' - ');
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are unsafe in names
  const safe = base.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
  return extension ? `${safe}.${extension}` : safe;
}

/** RFC 6266 with an ASCII fallback and the UTF-8 name as RFC 5987 `filename*`. */
export function contentDisposition(inline: boolean, name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** One `bytes=` range, as an inclusive range; null for none; `invalid` when unsatisfiable. */
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}
