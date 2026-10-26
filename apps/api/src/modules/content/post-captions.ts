import { Inject, Injectable } from '@nestjs/common';
import {
  type CaptionGroup,
  captionGroupsOf,
  type PostCaption,
  type PostCaptionInput,
  type PostPlatform,
} from '@vertex-hub/contracts';
import { contentPosts, type Database, postCaptions, type Transaction } from '@vertex-hub/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';

type Executor = Database | Transaction;

const empty = (group: CaptionGroup): PostCaption => ({
  group,
  caption: null,
  hashtags: null,
  title: null,
});

/** The captions of the groups of `platforms`, in their order; a group without a row is empty. */
export function shownCaptions(
  stored: readonly PostCaption[],
  platforms: readonly PostPlatform[],
): PostCaption[] {
  const byGroup = new Map(stored.map((caption) => [caption.group, caption]));
  return captionGroupsOf(platforms).map((group) => byGroup.get(group) ?? empty(group));
}

/** What an audit entry keeps of captions: lengths per group, never the text (F08B). */
export const captionLengths = (captions: readonly PostCaption[]) =>
  captions.map((caption) => ({
    group: caption.group,
    caption: caption.caption?.length ?? 0,
    hashtags: caption.hashtags?.length ?? 0,
    title: caption.title?.length ?? 0,
  }));

const sameCaption = (a: PostCaption, b: PostCaption) =>
  a.caption === b.caption && a.hashtags === b.hashtags && a.title === b.title;

/**
 * A post's caption per group (spec F08B rule A1, ADR 0042). Rows are never deleted: a group whose
 * platforms leave the post is kept and comes back with them. `content_posts.caption` and
 * `hashtags` follow the first group of the post's platforms.
 */
@Injectable()
export class PostCaptions {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Every stored caption of the posts, by post; a post without rows has none. */
  async of(
    postIds: readonly string[],
    executor: Executor = this.db,
  ): Promise<Map<string, PostCaption[]>> {
    const captions = new Map<string, PostCaption[]>();
    if (postIds.length === 0) return captions;
    const rows = await executor
      .select({
        postId: postCaptions.postId,
        group: postCaptions.group,
        caption: postCaptions.caption,
        hashtags: postCaptions.hashtags,
        title: postCaptions.title,
      })
      .from(postCaptions)
      .where(inArray(postCaptions.postId, [...new Set(postIds)]));
    for (const { postId, ...caption } of rows) {
      captions.set(postId, [...(captions.get(postId) ?? []), caption]);
    }
    return captions;
  }

  /**
   * The given groups' changes against what is stored: `INVALID_CAPTION_GROUP` for a group outside
   * the platforms; null when nothing changes.
   */
  changes(
    stored: readonly PostCaption[],
    platforms: readonly PostPlatform[],
    inputs: readonly PostCaptionInput[],
  ): { before: PostCaption[]; after: PostCaption[] } | null {
    const groups = captionGroupsOf(platforms);
    const invalid = inputs.find((input) => !groups.includes(input.group));
    if (invalid) {
      throw new CodedException(
        400,
        'INVALID_CAPTION_GROUP',
        'A caption names a group outside the post platforms',
        { group: invalid.group },
      );
    }
    const byGroup = new Map(stored.map((caption) => [caption.group, caption]));
    const before: PostCaption[] = [];
    const after: PostCaption[] = [];
    for (const input of inputs) {
      const current = byGroup.get(input.group) ?? empty(input.group);
      if (sameCaption(current, input)) continue;
      before.push(current);
      after.push({ ...input });
    }
    return after.length > 0 ? { before, after } : null;
  }

  /** Writes the captions given, keeping the other groups' rows. */
  async write(tx: Transaction, postId: string, captions: readonly PostCaption[]): Promise<void> {
    if (captions.length === 0) return;
    await tx
      .insert(postCaptions)
      .values(captions.map((caption) => ({ postId, ...caption })))
      .onConflictDoUpdate({
        target: [postCaptions.postId, postCaptions.group],
        set: {
          caption: sql`excluded.caption`,
          hashtags: sql`excluded.hashtags`,
          title: sql`excluded.title`,
          updatedAt: new Date(),
        },
      });
  }

  /** Copies the first group's text into the post's `caption` and `hashtags` (ADR 0042). */
  async sync(tx: Transaction, postId: string, platforms: readonly PostPlatform[]): Promise<void> {
    const [first] = shownCaptions((await this.of([postId], tx)).get(postId) ?? [], platforms);
    await tx
      .update(contentPosts)
      .set({ caption: first?.caption ?? null, hashtags: first?.hashtags ?? null })
      .where(eq(contentPosts.id, postId));
  }
}
