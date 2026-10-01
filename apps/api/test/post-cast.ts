import { randomUUID } from 'node:crypto';
import {
  type CreatePostInput,
  type FileItem,
  fileItemSchema,
  type NotificationType,
  type PostDetail,
  type PostStatus,
  type PostStatusChangeInput,
  postDetailSchema,
} from '@vertex-hub/contracts';
import { auditEntries, type Database, notifications } from '@vertex-hub/db';
import { and, asc, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import type { api } from './helpers.js';
import { seedTaskCast } from './task-cast.js';

/*
 * The people the F08 tests act as, on top of the F06 cast (a writer and the Content manager are
 * there already): a medical reviewer, and post factories. Department managers are global rows:
 * test files run one at a time.
 */

type Api = ReturnType<typeof api>;

export async function seedPostCast(db: Database, client: Api) {
  const cast = await seedTaskCast(db, client);
  const medicalReviewer = await cast.signedIn({
    name: `مراجع طبي ${cast.run}`,
    departments: [{ code: 'medical_consultation' }],
  });

  /** Creates a post as `cookie`; an Instagram post with a caption, due in 5 days, unless told. */
  async function createPost(
    cookie: string,
    input: Partial<CreatePostInput> & { clientId: string },
  ) {
    const response = await client.post('/api/content/posts', cookie, {
      title: `منشور ${cast.run}`,
      type: 'post',
      platforms: ['instagram'],
      publishDate: cast.inDays(5),
      caption: `نص المنشور ${cast.run}`,
      ...input,
    });
    if (response.status !== 201) {
      throw new Error(`Post creation failed: ${response.status} ${await response.text()}`);
    }
    return postDetailSchema.parse(await response.json());
  }

  const move = (id: string, cookie: string | undefined, change: PostStatusChangeInput) =>
    client.post(`/api/content/posts/${id}/status`, cookie, change);

  async function detail(id: string, cookie: string): Promise<PostDetail> {
    const response = await client.get(`/api/content/posts/${id}`, cookie);
    expect(response.status).toBe(200);
    return postDetailSchema.parse(await response.json());
  }

  /**
   * Moves the post as its page would and expects success: an internal pass carries the content
   * token the reviewer was shown, and a client response names a contact of the client.
   */
  async function moveOk(id: string, cookie: string, input: PostStatusChangeInput) {
    const current = await detail(id, cast.gm.cookie);
    let change = input;
    if (
      current.status === 'internal_review' &&
      ['awaiting_client', 'approved'].includes(input.to)
    ) {
      change = { contentToken: current.contentToken, ...input };
    } else if (
      current.status === 'awaiting_client' &&
      ['approved', 'in_production'].includes(input.to)
    ) {
      change = { contactId: await cast.contactOf(current.client.id), ...input };
    }
    const response = await move(id, cookie, change);
    if (response.status !== 200) {
      throw new Error(`Move to ${change.to} failed: ${response.status} ${await response.text()}`);
    }
    return postDetailSchema.parse(await response.json());
  }

  /**
   * A post of the writer moved to `status` by the people allowed to. For a healthcare client the
   * medical reviewer approves on the way.
   */
  async function postAt(
    status: PostStatus,
    input: Partial<CreatePostInput> & { clientId: string },
  ): Promise<PostDetail> {
    let current = await createPost(cast.writer.cookie, { publishTime: '10:30', ...input });
    const cleared = current.needsClientApproval ? 'awaiting_client' : 'approved';
    const path: [PostStatus, string][] = [
      ['in_production', cast.writer.cookie],
      ['internal_review', cast.writer.cookie],
      [cleared, cast.contentManager.cookie],
      ...(current.needsClientApproval
        ? ([['approved', cast.am.cookie]] as [PostStatus, string][])
        : []),
      ['scheduled', cast.writer.cookie],
      ['published', cast.writer.cookie],
    ];
    for (const [to, cookie] of path) {
      if (current.status === status) break;
      current = await moveOk(current.id, cookie, { to });
      if (current.reviewStage === 'medical' && status !== 'internal_review') {
        const response = await client.post(
          `/api/content/posts/${current.id}/medical-review`,
          medicalReviewer.cookie,
          { decision: 'approve' },
        );
        expect(response.status, await response.clone().text()).toBe(200);
        current = postDetailSchema.parse(await response.json());
      }
    }
    expect(current.status).toBe(status);
    return current;
  }

  /** A link file on the post, added as `cookie` (the writer unless told). */
  async function addFile(postId: string, name: string, cookie = cast.writer.cookie) {
    return client.post('/api/files/items', cookie, {
      ownerType: 'post',
      ownerId: postId,
      role: 'deliverable',
      name,
      source: { url: `https://drive.example.com/${randomUUID()}` },
    });
  }

  async function addFileOk(postId: string, name: string): Promise<FileItem> {
    const response = await addFile(postId, name);
    expect(response.status, await response.clone().text()).toBe(201);
    return fileItemSchema.parse(await response.json());
  }

  const auditOf = (entityId: string) =>
    db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.entityId, entityId))
      .orderBy(auditEntries.id);

  const typesOf = async (recipientId: string, subjectId: string): Promise<NotificationType[]> =>
    (
      await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(
          and(eq(notifications.recipientId, recipientId), eq(notifications.subjectId, subjectId)),
        )
        .orderBy(asc(notifications.createdAt))
    ).map((row) => row.type);

  return {
    ...cast,
    medicalReviewer,
    createPost,
    move,
    moveOk,
    detail,
    postAt,
    addFile,
    addFileOk,
    auditOf,
    typesOf,
  };
}
