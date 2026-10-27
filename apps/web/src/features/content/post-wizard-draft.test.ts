import type { CreatePost, CreateTask } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import type { WizardFile } from '../tasks/task-wizard-draft';
import {
  appendHashtags,
  captionsOf,
  checkedMedia,
  clearPostDraft,
  createPostPayload,
  insertAt,
  loadPostDraft,
  moveItem,
  type PostWizardFile,
  type PostWizardTask,
  type PostWizardValues,
  postDraftStorageKey,
  savePostDraft,
  stepOfPart,
  withCaption,
} from './post-wizard-draft';

/** A `Storage` held in memory, as the browser's local storage behaves. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value),
  };
}

const USER = '0190f1a0-0000-7000-8000-000000000001';
const CLIENT = '0190f1a0-0000-7000-8000-000000000601';
const UPLOAD = '0190f1a0-0000-7000-8000-0000000000aa';

const medium = (key: string, extra: Partial<PostWizardFile> = {}): PostWizardFile => ({
  key,
  name: `${key}.png`,
  sizeBytes: 10,
  mimeType: 'image/png',
  uploadId: UPLOAD,
  progress: 1,
  failed: null,
  uploadedAt: '2026-10-26T08:00:00Z',
  slideCaption: '',
  width: 1080,
  height: 1350,
  durationMs: null,
  ...extra,
});

const task = (title: string): CreateTask =>
  ({
    title,
    department: 'design',
    assigneeId: '0190f1a0-0000-7000-8000-000000000005',
    dueDate: '2026-11-10',
    subtasks: [],
    questions: [],
    files: [],
  }) as unknown as CreateTask;

describe('the stored draft', () => {
  const draft = {
    context: '[["clientId","c1"]]',
    step: 'media' as const,
    values: {
      clientId: CLIENT,
      title: 'عرض',
      type: 'post',
      platforms: [],
      publishDate: '2026-11-12',
    } as PostWizardValues,
    files: [medium('done'), medium('running', { uploadId: null })],
    tasks: [] as PostWizardTask[],
  };

  it('comes back for the same presets, without uploads still running', () => {
    const storage = memoryStorage();
    savePostDraft(storage, USER, draft);
    const loaded = loadPostDraft(storage, USER, draft.context);
    expect(loaded?.step).toBe('media');
    expect(loaded?.files.map((file) => file.key)).toEqual(['done']);
  });

  it('stays away for other presets and after Start over', () => {
    const storage = memoryStorage();
    savePostDraft(storage, USER, draft);
    expect(loadPostDraft(storage, USER, '[]')).toBeNull();
    clearPostDraft(storage, USER);
    expect(loadPostDraft(storage, USER, draft.context)).toBeNull();
  });

  it('ignores an unreadable or older draft', () => {
    const storage = memoryStorage();
    storage.setItem(postDraftStorageKey(USER), '{not json');
    expect(loadPostDraft(storage, USER, draft.context)).toBeNull();
    storage.setItem(postDraftStorageKey(USER), JSON.stringify({ ...draft, version: 0 }));
    expect(loadPostDraft(storage, USER, draft.context)).toBeNull();
  });
});

describe('captions per group', () => {
  it('has one caption per group of the platforms, Facebook with Instagram', () => {
    const captions = captionsOf(['facebook', 'x', 'instagram', 'youtube'], []);
    expect(captions.map((caption) => caption.group)).toEqual([
      'facebook_instagram',
      'x',
      'youtube',
    ]);
  });

  it('keeps a group text while its platform is away', () => {
    const typed = withCaption([], 'x', { caption: 'قصير' });
    expect(captionsOf(['instagram'], typed)).toHaveLength(1);
    expect(captionsOf(['instagram', 'x'], typed)[1]?.caption).toBe('قصير');
  });

  it('gives a title to YouTube only', () => {
    const typed = withCaption(withCaption([], 'x', { title: 'لا' }), 'youtube', { title: 'نعم' });
    const [x, youtube] = captionsOf(['x', 'youtube'], typed);
    expect(x?.title).toBeNull();
    expect(youtube?.title).toBe('نعم');
  });

  it('appends a hashtag set on its own line and inserts a snippet at the cursor', () => {
    expect(appendHashtags('#قهوة', ' #صباح ')).toBe('#قهوة\n#صباح');
    expect(appendHashtags(null, '#صباح')).toBe('#صباح');
    expect(insertAt('أهلا بكم', 'وسهلا ', 5)).toEqual({ text: 'أهلا وسهلا بكم', cursor: 11 });
    expect(insertAt('أهلا بكم', 'يا ', 5, 8)).toEqual({ text: 'أهلا يا ', cursor: 8 });
  });
});

describe('media', () => {
  it('reads the slides as the checks do', () => {
    expect(
      checkedMedia([medium('a'), medium('v', { mimeType: 'video/mp4', durationMs: 9000 })]),
    ).toEqual([
      { type: 'image', width: 1080, height: 1350, durationMs: null },
      { type: 'video', width: 1080, height: 1350, durationMs: 9000 },
    ]);
  });

  it('moves a slide and keeps a move out of range', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b'], 1, 5)).toEqual(['a', 'b']);
  });
});

describe('the create request', () => {
  const post = {
    clientId: CLIENT,
    title: 'عرض الخريف',
    type: 'carousel',
    platforms: ['instagram', 'x'],
    publishDate: '2026-11-12',
    captions: [
      { group: 'linkedin', caption: 'ذهب', hashtags: null, title: null },
      { group: 'x', caption: 'قصير', hashtags: null, title: null },
    ],
    files: [],
    tasks: [],
    linkTaskIds: [],
  } as unknown as CreatePost;

  it('sends the captions of the post groups and the held files as slides in order', () => {
    const payload = createPostPayload(
      post,
      [medium('a', { slideCaption: '  الأولى ' }), medium('b'), medium('c', { failed: 'x' })],
      [],
    );
    expect(payload.captions.map((caption) => caption.group)).toEqual(['facebook_instagram', 'x']);
    expect(payload.files).toEqual([
      { uploadId: UPLOAD, name: 'a.png', slideCaption: 'الأولى' },
      { uploadId: UPLOAD, name: 'b.png', slideCaption: null },
    ]);
  });

  it('sends a requested task to the queue, on the post client, with its files', () => {
    const file = {
      key: 'f',
      name: 'brief.pdf',
      sizeBytes: 1,
      mimeType: 'application/pdf',
      uploadId: UPLOAD,
      progress: 1,
      failed: null,
      uploadedAt: null,
      role: 'reference',
      target: { kind: 'task' },
    } satisfies WizardFile;
    const payload = createPostPayload(
      post,
      [],
      [{ key: 't', task: task('تصميم'), mode: 'request', files: [file] }],
    );
    expect(payload.tasks[0]?.assigneeId).toBeNull();
    expect(payload.tasks[0]?.clientId).toBe(CLIENT);
    expect(payload.tasks[0]?.files).toEqual([
      { uploadId: UPLOAD, role: 'reference', name: 'brief.pdf' },
    ]);
  });

  it('opens the step of the part a refusal names', () => {
    expect(stepOfPart('files')).toBe('media');
    expect(stepOfPart('links')).toBe('tasks');
    expect(stepOfPart(undefined)).toBeNull();
  });
});
