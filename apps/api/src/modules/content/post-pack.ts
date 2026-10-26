import type { ServerResponse } from 'node:http';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import {
  captionGroupsOf,
  hasPostPack,
  type PostCaption,
  publishedText,
} from '@vertex-hub/contracts';
import type { Database } from '@vertex-hub/db';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { FileVersions } from '../files/index.js';
import { actorOf, assertPostWritable, postRights, readablePost } from './post-access.js';
import { PostReviews, snapshotCaptions } from './post-reviews.js';

/** Characters a file name inside the archive never holds. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are unsafe in names
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

const safeName = (text: string) => text.replace(UNSAFE, '_').trim() || '_';

/** A caption group's text as published, the YouTube title first. */
const captionText = (caption: PostCaption) =>
  [caption.title, publishedText(caption.caption, caption.hashtags)]
    .filter((part) => !!part)
    .join('\n\n');

/**
 * The publishing pack (spec F08B rule A11): the captions to copy and the media in slide order,
 * from the approved snapshot when there is one, else the current content; only the post's
 * current platforms (edge case 2).
 */
@Injectable()
export class PostPack {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly clients: ClientDirectory,
    private readonly reviews: PostReviews,
    private readonly files: FileVersions,
  ) {}

  async send(actor: CurrentUserInfo, id: string, response: ServerResponse): Promise<void> {
    const pack = await this.db.transaction(async (tx) => {
      const post = await readablePost(tx, this.clients, actor, id);
      if (!postRights(actor, post.client).edit) throw new ForbiddenException();
      assertPostWritable(post);
      if (!hasPostPack(post.status)) {
        throw new CodedException(
          409,
          'INVALID_TRANSITION',
          'The pack is for approved, scheduled and published posts',
        );
      }
      const groups = captionGroupsOf(post.platforms);
      let versions: { id: string; kind: string; url: string | null }[];
      let captions: PostCaption[];
      if (post.clearedReviewId) {
        const pass = await this.reviews.clearedPass(tx, post);
        const sent = await this.files.sent(pass.versionIds);
        versions = pass.versionIds.flatMap((versionId) => {
          const version = sent.get(versionId);
          return version && !version.removed ? [version] : [];
        });
        captions = snapshotCaptions(pass);
      } else {
        const content = await this.reviews.content(tx, post);
        const sent = await this.files.sent(content.versionIds);
        versions = content.versionIds.flatMap((versionId) => sent.get(versionId) ?? []);
        captions = content.captions;
      }
      captions = captions.filter((caption) => groups.includes(caption.group));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'post.pack_downloaded',
        entityType: 'post',
        entityId: id,
        after: {
          media: versions.length,
          groups: captions.map((caption) => caption.group),
          fromReviewId: post.clearedReviewId,
        },
      });
      return { post, versions, captions };
    });

    const base = `${safeName(pack.post.client.name)}-${pack.post.publishDate}`;
    const number = (index: number) => String(index + 1).padStart(2, '0');
    const links = pack.versions.flatMap((version, index) =>
      version.kind === 'link' && version.url ? [`${number(index)} ${version.url}`] : [],
    );
    await this.files.sendArchive(
      `${base}.zip`,
      pack.versions.flatMap((version, index) =>
        version.kind === 'link'
          ? []
          : [{ versionId: version.id, baseName: `${base}-${number(index)}` }],
      ),
      [
        ...pack.captions.map((caption) => ({
          name: `captions-${caption.group}.txt`,
          text: captionText(caption),
        })),
        ...(links.length > 0 ? [{ name: 'links.txt', text: links.join('\n') }] : []),
      ],
      response,
    );
  }
}
