import type { CreateTask } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  clearDraft,
  createPayload,
  draftContext,
  draftStorageKey,
  loadDraft,
  moveStage,
  moveSubtask,
  readinessInput,
  removeQuestion,
  removeStage,
  removeSubtask,
  saveDraft,
  uploadAge,
  type WizardFile,
  type WizardSubtask,
  type WizardValues,
  withRunMode,
} from './task-wizard-draft';

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
const UPLOAD = '0190f1a0-0000-7000-8000-0000000000aa';

const subtask = (title: string, stageIndex: number | null = null): WizardSubtask => ({
  title,
  department: 'design',
  dueDate: '2026-11-10',
  stageIndex,
});

const values = (extra: Partial<WizardValues> = {}): WizardValues => ({
  title: 'Campaign',
  department: 'marketing',
  dueDate: '2026-11-12',
  ...extra,
});

const file = (key: string, target: WizardFile['target'], extra: Partial<WizardFile> = {}) =>
  ({
    key,
    name: `${key}.png`,
    sizeBytes: 10,
    mimeType: 'image/png',
    uploadId: UPLOAD,
    progress: 1,
    failed: null,
    uploadedAt: '2026-10-26T08:00:00Z',
    role: 'reference',
    target,
    ...extra,
  }) satisfies WizardFile;

describe('the stored draft', () => {
  const context = draftContext({ projectId: 'p1', clientId: 'c1', milestoneId: undefined });
  const draft = {
    context,
    step: 'subtasks' as const,
    mode: 'assign' as const,
    values: values(),
    files: [file('done', { kind: 'task' }), file('running', { kind: 'task' }, { uploadId: null })],
  };

  it('comes back after a reload with its finished uploads only', () => {
    const storage = memoryStorage();
    saveDraft(storage, USER, draft);
    const loaded = loadDraft(storage, USER, context);
    expect(loaded?.step).toBe('subtasks');
    expect(loaded?.values).toEqual(values());
    expect(loaded?.files.map((item) => item.key)).toEqual(['done']);
  });

  it('is kept per user', () => {
    const storage = memoryStorage();
    saveDraft(storage, USER, draft);
    expect(storage.getItem(draftStorageKey(USER))).not.toBeNull();
    expect(loadDraft(storage, '0190f1a0-0000-7000-8000-000000000002', context)).toBeNull();
  });

  it('does not come back with other presets', () => {
    const storage = memoryStorage();
    saveDraft(storage, USER, draft);
    expect(loadDraft(storage, USER, draftContext({ projectId: 'p2' }))).toBeNull();
  });

  it('reads the presets the same way in any order', () => {
    expect(draftContext({ b: '2', a: '1' })).toBe(draftContext({ a: '1', b: '2', c: undefined }));
  });

  it('ignores an unreadable or older draft', () => {
    const storage = memoryStorage();
    storage.setItem(draftStorageKey(USER), '{not json');
    expect(loadDraft(storage, USER, context)).toBeNull();
    storage.setItem(draftStorageKey(USER), JSON.stringify({ ...draft, version: 0 }));
    expect(loadDraft(storage, USER, context)).toBeNull();
  });

  it('is gone once cleared', () => {
    const storage = memoryStorage();
    saveDraft(storage, USER, draft);
    clearDraft(storage, USER);
    expect(loadDraft(storage, USER, context)).toBeNull();
  });

  it('survives a storage that refuses writes', () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => saveDraft(storage, USER, draft)).not.toThrow();
  });
});

describe('uploadAge', () => {
  const uploaded = file('a', { kind: 'task' }, { uploadedAt: '2026-10-26T08:00:00Z' });
  it('is fresh, then aging from 20 hours, then expired at 24', () => {
    expect(uploadAge(uploaded, new Date('2026-10-26T20:00:00Z'))).toBe('fresh');
    expect(uploadAge(uploaded, new Date('2026-10-27T04:00:00Z'))).toBe('aging');
    expect(uploadAge(uploaded, new Date('2026-10-27T08:00:00Z'))).toBe('expired');
  });

  it('is uploading until the upload finished', () => {
    expect(uploadAge({ ...uploaded, uploadedAt: null }, new Date())).toBe('uploading');
  });
});

describe('subtasks and their files', () => {
  const draft = values({ subtasks: [subtask('A'), subtask('B'), subtask('C')] });
  const files = [
    file('onA', { kind: 'subtask', index: 0 }),
    file('onC', { kind: 'subtask', index: 2 }),
    file('onTask', { kind: 'task' }),
  ];

  it('moves the files with their subtask', () => {
    const moved = moveSubtask(draft, files, 2, 0);
    expect(moved.values.subtasks?.map((item) => item.title)).toEqual(['C', 'A', 'B']);
    expect(moved.files.map((item) => item.target)).toEqual([
      { kind: 'subtask', index: 1 },
      { kind: 'subtask', index: 0 },
      { kind: 'task' },
    ]);
  });

  it('ignores a move out of the list', () => {
    expect(moveSubtask(draft, files, 0, 3).values).toBe(draft);
  });

  it('gives a removed subtask files back to the task', () => {
    const removed = removeSubtask(draft, files, 0);
    expect(removed.values.subtasks?.map((item) => item.title)).toEqual(['B', 'C']);
    expect(removed.files.map((item) => item.target)).toEqual([
      { kind: 'task' },
      { kind: 'subtask', index: 1 },
      { kind: 'task' },
    ]);
  });

  it('drops the attachments of a removed question', () => {
    const asked = values({
      questions: [
        { bodyDoc: { type: 'doc', content: [] }, addressedDepartment: 'design' },
        { bodyDoc: { type: 'doc', content: [] }, addressedDepartment: 'content_management' },
      ],
    });
    const removed = removeQuestion(
      asked,
      [file('q0', { kind: 'question', index: 0 }), file('q1', { kind: 'question', index: 1 })],
      0,
    );
    expect(removed.values.questions).toHaveLength(1);
    expect(removed.files.map((item) => [item.key, item.target])).toEqual([
      ['q1', { kind: 'question', index: 0 }],
    ]);
  });
});

describe('run modes and stages', () => {
  it('puts every subtask in the first stage when switching to stages', () => {
    const next = withRunMode(values({ subtasks: [subtask('A'), subtask('B')] }), 'stages', 'One');
    expect(next.stages).toEqual([{ name: 'One' }]);
    expect(next.subtasks?.map((item) => item.stageIndex)).toEqual([0, 0]);
  });

  it('drops the stages for another mode', () => {
    const next = withRunMode(
      values({ runMode: 'stages', stages: [{ name: 'One' }], subtasks: [subtask('A', 0)] }),
      'parallel',
      'One',
    );
    expect(next.stages).toEqual([]);
    expect(next.subtasks?.[0]?.stageIndex).toBeNull();
  });

  const staged = values({
    runMode: 'stages',
    stages: [{ name: 'Copy' }, { name: 'Design' }, { name: 'Review' }],
    subtasks: [subtask('A', 0), subtask('B', 1), subtask('C', 2)],
  });

  it('keeps each subtask in its stage when a stage moves', () => {
    const next = moveStage(staged, 2, 0);
    expect(next.stages?.map((stage) => stage.name)).toEqual(['Review', 'Copy', 'Design']);
    expect(next.subtasks?.map((item) => item.stageIndex)).toEqual([1, 2, 0]);
  });

  it('moves the subtasks of a removed stage to the stage before it', () => {
    const next = removeStage(staged, 1);
    expect(next.stages?.map((stage) => stage.name)).toEqual(['Copy', 'Review']);
    expect(next.subtasks?.map((item) => item.stageIndex)).toEqual([0, 0, 1]);
    expect(removeStage(staged, 0).subtasks?.map((item) => item.stageIndex)).toEqual([0, 0, 1]);
  });
});

describe('readinessInput', () => {
  it('reads the brief, the fields, the references and the criteria of each task', () => {
    const input = readinessInput(
      values({
        briefDoc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch' }] }],
        },
        criteria: ['Logo on every slide'],
        subtasks: [subtask('A'), { ...subtask('B'), briefFields: { sizes: ['1080 × 1350'] } }],
      }),
      [file('ref', { kind: 'subtask', index: 0 })],
      true,
    );
    expect(input).toMatchObject({
      hasBrief: true,
      hasBriefFields: false,
      hasReferences: false,
      hasCriteria: true,
      needsClientApproval: true,
      subtasks: [
        { hasBrief: false, hasReferences: true, hasBriefFields: false },
        { hasBrief: false, hasReferences: false, hasBriefFields: true },
      ],
    });
  });

  it('waits for a department and a due date', () => {
    expect(readinessInput(values({ dueDate: '' }), [], false)).toBeNull();
  });
});

describe('createPayload', () => {
  const task = {
    title: 'Campaign',
    files: [],
    subtasks: [{ title: 'A', files: [] }],
    questions: [{ addressedDepartment: 'design', files: [] }],
  } as unknown as CreateTask;

  it('puts each held file on its task, subtask or question, unfinished uploads left out', () => {
    const payload = createPayload(task, [
      file('ref', { kind: 'task' }),
      file('final', { kind: 'subtask', index: 0 }, { role: 'deliverable' }),
      file('asked', { kind: 'question', index: 0 }),
      file('running', { kind: 'task' }, { uploadId: null }),
    ]);
    expect(payload.files).toEqual([{ uploadId: UPLOAD, role: 'reference', name: 'ref.png' }]);
    expect(payload.subtasks[0]?.files).toEqual([
      { uploadId: UPLOAD, role: 'deliverable', name: 'final.png' },
    ]);
    expect(payload.questions[0]?.files).toEqual([{ uploadId: UPLOAD }]);
  });
});
