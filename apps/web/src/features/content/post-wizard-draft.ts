import {
  type CaptionGroup,
  type CheckedMedium,
  type CreatePost,
  type CreatePostInput,
  type CreateTask,
  captionGroupsOf,
  type FileType,
  type PostCaptionInput,
  type PostPlatform,
} from '@vertex-hub/contracts';
import { createPayload, type WizardFile } from '../tasks/task-wizard-draft';

/*
 * F08B rule B1: the new post wizard's draft. Like the task wizard's (F06B rule C1) it lives in
 * the browser until it is saved, per user and per preset (client, date, idea), and goes to the
 * server in one request. Pure functions over the draft, kept apart from the screens.
 */

export const POST_WIZARD_STEPS = ['basics', 'captions', 'media', 'tasks', 'review'] as const;

export type PostWizardStep = (typeof POST_WIZARD_STEPS)[number];

export type PostWizardValues = CreatePostInput;

/** A medium held for the post (F10 rule 1): a slide, in the order of the list. */
export interface PostWizardFile {
  key: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** Null while it uploads. */
  uploadId: string | null;
  /** 0 to 1 while it uploads. */
  progress: number;
  failed: string | null;
  uploadedAt: string | null;
  slideCaption: string;
  /** What the browser read of an image or a video (rule A4); null when it could not. */
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** A new task of the post, as its dialog checked it, with its own held files (F06B). */
export interface PostWizardTask {
  key: string;
  task: CreateTask;
  /** Assign now, or request from the department's queue (F06 rule A2). */
  mode: 'assign' | 'request';
  files: WizardFile[];
}

export interface PostWizardDraft {
  version: typeof DRAFT_VERSION;
  /** The presets the wizard was opened with: a draft only comes back with the same ones. */
  context: string;
  step: PostWizardStep;
  values: PostWizardValues;
  /** Finished uploads only: one still running is lost with the page. */
  files: PostWizardFile[];
  tasks: PostWizardTask[];
}

const DRAFT_VERSION = 1;

export function postDraftStorageKey(userId: string): string {
  return `vertex-hub:post-wizard:${userId}`;
}

const held = <T extends { uploadId: string | null; failed: string | null }>(files: T[]) =>
  files.filter((file) => file.uploadId !== null && file.failed === null);

/** Saves the draft; a full or blocked storage loses it quietly (the wizard still works). */
export function savePostDraft(
  storage: Storage,
  userId: string,
  draft: Omit<PostWizardDraft, 'version'>,
) {
  try {
    storage.setItem(
      postDraftStorageKey(userId),
      JSON.stringify({
        ...draft,
        files: held(draft.files),
        tasks: draft.tasks.map((task) => ({ ...task, files: held(task.files) })),
        version: DRAFT_VERSION,
      }),
    );
  } catch {
    // Storage full or unavailable.
  }
}

/** The stored draft for these presets, or null: none, another version, other presets, unreadable. */
export function loadPostDraft(
  storage: Storage,
  userId: string,
  context: string,
): PostWizardDraft | null {
  try {
    const raw = storage.getItem(postDraftStorageKey(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<PostWizardDraft>;
    if (draft.version !== DRAFT_VERSION || draft.context !== context) return null;
    if (!draft.values || !Array.isArray(draft.files) || !Array.isArray(draft.tasks)) return null;
    if (!draft.step || !(POST_WIZARD_STEPS as readonly string[]).includes(draft.step)) return null;
    return draft as PostWizardDraft;
  } catch {
    return null;
  }
}

export function clearPostDraft(storage: Storage, userId: string) {
  try {
    storage.removeItem(postDraftStorageKey(userId));
  } catch {
    // Unavailable storage holds nothing.
  }
}

// Captions

/**
 * Rule A1: one caption per group of the platforms, in their order. A group's text is kept while
 * its platforms are away, so it comes back with them; a new group starts empty.
 */
export function captionsOf(
  platforms: readonly PostPlatform[],
  captions: readonly Partial<PostCaptionInput>[] | undefined,
): PostCaptionInput[] {
  return captionGroupsOf(platforms).map((group) => {
    const found = captions?.find((caption) => caption.group === group);
    return {
      group,
      caption: found?.caption ?? null,
      hashtags: found?.hashtags ?? null,
      title: group === 'youtube' ? (found?.title ?? null) : null,
    };
  });
}

/** The captions with one group's text changed, the other groups as they were. */
export function withCaption(
  captions: readonly Partial<PostCaptionInput>[] | undefined,
  group: CaptionGroup,
  change: Partial<Omit<PostCaptionInput, 'group'>>,
): Partial<PostCaptionInput>[] {
  const list = [...(captions ?? [])];
  const index = list.findIndex((caption) => caption.group === group);
  if (index === -1) list.push({ group, caption: null, hashtags: null, title: null, ...change });
  else list[index] = { ...list[index], ...change };
  return list;
}

/** Rule A10: a hashtag set goes after the hashtags already there, on a line of its own. */
export function appendHashtags(current: string | null | undefined, set: string): string {
  const base = (current ?? '').trimEnd();
  return base ? `${base}\n${set.trim()}` : set.trim();
}

/** Rule A10: a caption snippet goes in at the cursor, replacing a selection. */
export function insertAt(
  text: string | null | undefined,
  snippet: string,
  start: number,
  end: number = start,
): { text: string; cursor: number } {
  const value = text ?? '';
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return { text: value.slice(0, from) + snippet + value.slice(to), cursor: from + snippet.length };
}

// Media

export const fileTypeOf = (mimeType: string): FileType =>
  mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'other';

/** The held files as the checks read them (rule A4): measured in the browser, in slide order. */
export function checkedMedia(files: readonly PostWizardFile[]): CheckedMedium[] {
  return files.map((file) => ({
    type: fileTypeOf(file.mimeType),
    width: file.width,
    height: file.height,
    durationMs: file.durationMs,
  }));
}

/** Moves a slide; the others keep their order. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= items.length || !items[from]) return [...items];
  const list = [...items];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved as T);
  return list;
}

/** Uploads still running, failed, or purged keep the post from being saved (F06B rule C3). */
export const notHeld = (file: { uploadId: string | null; failed: string | null }) =>
  file.uploadId === null || file.failed !== null;

// Saving

/**
 * Rule B2: the checked draft as one create request. The captions are those of the post's groups,
 * the held files are the first slides in order, and each new task carries its own held files.
 */
export function createPostPayload(
  post: CreatePost,
  files: readonly PostWizardFile[],
  tasks: readonly PostWizardTask[],
): CreatePost {
  return {
    ...post,
    captions: captionsOf(post.platforms, post.captions),
    files: held([...files]).map((file) => ({
      uploadId: file.uploadId as string,
      name: file.name,
      slideCaption: file.slideCaption.trim() || null,
    })),
    tasks: tasks.map(({ task, mode, files: taskFiles }) =>
      createPayload(
        {
          ...task,
          assigneeId: mode === 'assign' ? task.assigneeId : null,
          clientId: post.clientId,
        },
        taskFiles,
      ),
    ),
  };
}

/** Rule B2: the step a refusal naming a part opens. */
export function stepOfPart(part: string | undefined): PostWizardStep | null {
  if (part === 'captions') return 'captions';
  if (part === 'files') return 'media';
  if (part === 'tasks' || part === 'links') return 'tasks';
  return null;
}
