import { Injectable } from '@nestjs/common';
import type { Database, Transaction } from '@vertex-hub/db';
import { FileVersions, type SentVersion } from '../files/index.js';
import { type LinkedTask, PostTasks } from '../tasks/index.js';

type Executor = Database | Transaction;

/** A media version of a post, with the linked task it comes from (null: the post's own file). */
export interface MediaVersion extends SentVersion {
  task: { id: string; title: string } | null;
}

/** What produces a post: its linked tasks and its media. */
export interface PostWork {
  /** By link time. */
  tasks: LinkedTask[];
  /** Rule 5, in display order. */
  media: MediaVersion[];
}

/**
 * The media of posts (spec F08 rule 5): the latest version of each of the post's own files, then
 * the final version of each deliverable of its linked tasks, tasks by link time.
 */
@Injectable()
export class PostMedia {
  constructor(
    private readonly files: FileVersions,
    private readonly tasks: PostTasks,
  ) {}

  /** The work of each post; every given post has an entry. */
  async of(postIds: readonly string[], executor?: Executor): Promise<Map<string, PostWork>> {
    const [own, linked] = await Promise.all([
      this.files.postMedia(postIds, executor),
      this.tasks.linked(postIds, executor),
    ]);
    const finals = await this.files.finalVersions(
      [...linked.values()].flatMap((tasks) => tasks.map((task) => task.id)),
      executor,
    );
    return new Map(
      postIds.map((postId) => {
        const tasks = linked.get(postId) ?? [];
        return [
          postId,
          {
            tasks,
            media: [
              ...(own.get(postId) ?? []).map((version) => ({ ...version, task: null })),
              ...tasks.flatMap((task) =>
                (finals.get(task.id) ?? []).map((version) => ({
                  ...version,
                  task: { id: task.id, title: task.title },
                })),
              ),
            ],
          },
        ];
      }),
    );
  }
}
