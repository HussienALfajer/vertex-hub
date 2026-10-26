import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_LAYOUT_LIMIT } from '@vertex-hub/contracts';
import {
  contentPosts,
  type Database,
  type MediaLayoutEntry,
  type Transaction,
} from '@vertex-hub/db';
import { inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { FileVersions, type SentVersion } from '../files/index.js';
import { type LinkedTask, PostTasks } from '../tasks/index.js';

type Executor = Database | Transaction;

/** A media version of a post, with the linked task it comes from (null: the post's own file). */
export interface MediaVersion extends SentVersion {
  task: { id: string; title: string } | null;
  /** F08B rule A6. */
  slideCaption: string | null;
}

/** What produces a post: its linked tasks and its media. */
export interface PostWork {
  /** By link time. */
  tasks: LinkedTask[];
  /** In slide order (F08B rule A6). */
  media: MediaVersion[];
  /** The stored layout, entries of media that are gone included. */
  layout: MediaLayoutEntry[];
}

/**
 * F08B rule A6: the media in slide order: the layout's first 40 entries whose medium is still
 * there, then the others in F08 rule 5's order.
 */
export function inLayout<T extends { fileItemId: string }>(
  media: readonly T[],
  layout: readonly MediaLayoutEntry[],
): (T & { slideCaption: string | null })[] {
  const left = [...media];
  const listed: (T & { slideCaption: string | null })[] = [];
  for (const entry of layout.slice(0, MEDIA_LAYOUT_LIMIT)) {
    const index = left.findIndex((medium) => medium.fileItemId === entry.fileItemId);
    if (index < 0) continue;
    const [medium] = left.splice(index, 1) as [T];
    listed.push({ ...medium, slideCaption: entry.caption });
  }
  return [...listed, ...left.map((medium) => ({ ...medium, slideCaption: null }))];
}

/**
 * The media of posts (spec F08 rule 5): the latest version of each of the post's own files, then
 * the final version of each deliverable of its linked tasks, tasks by link time; reordered by the
 * post's media layout (F08B rule A6).
 */
@Injectable()
export class PostMedia {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly files: FileVersions,
    private readonly tasks: PostTasks,
  ) {}

  /** The work of each post; every given post has an entry. */
  async of(postIds: readonly string[], executor?: Executor): Promise<Map<string, PostWork>> {
    const [own, linked, layouts] = await Promise.all([
      this.files.postMedia(postIds, executor),
      this.tasks.linked(postIds, executor),
      postIds.length === 0
        ? []
        : (executor ?? this.db)
            .select({ id: contentPosts.id, layout: contentPosts.mediaLayout })
            .from(contentPosts)
            .where(inArray(contentPosts.id, [...postIds])),
    ]);
    const layoutOf = new Map(layouts.map((row) => [row.id, row.layout]));
    const finals = await this.files.finalVersions(
      [...linked.values()].flatMap((tasks) => tasks.map((task) => task.id)),
      executor,
    );
    return new Map(
      postIds.map((postId) => {
        const tasks = linked.get(postId) ?? [];
        const layout = layoutOf.get(postId) ?? [];
        const media = [
          ...(own.get(postId) ?? []).map((version) => ({ ...version, task: null })),
          ...tasks.flatMap((task) =>
            (finals.get(task.id) ?? []).map((version) => ({
              ...version,
              task: { id: task.id, title: task.title },
            })),
          ),
        ];
        return [postId, { tasks, layout, media: inLayout(media, layout) }];
      }),
    );
  }
}
