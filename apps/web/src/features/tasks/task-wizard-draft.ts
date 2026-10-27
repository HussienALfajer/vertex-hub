import {
  type CREATE_FILE_ROLES,
  type CreateTask,
  type CreateTaskInput,
  FILE_UPLOAD_LIFETIME_HOURS,
  type ReadinessWarning,
  richTextPlain,
  type SubtaskRunMode,
  type TaskReadinessInput,
  type TaskTemplateDraft,
} from '@vertex-hub/contracts';

/*
 * F06B rule C1: the creation wizard's draft. It lives in the browser while the wizard is open, so
 * a reload does not lose it, and goes to the server only when it is saved. Pure functions over
 * the draft, kept apart from the screens so they can be tested.
 */

export const WIZARD_STEPS = ['basics', 'subtasks', 'files', 'questions', 'review'] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Request from a department (its manager assigns it) or assign someone now. */
export type WizardMode = 'request' | 'assign';

export type WizardValues = CreateTaskInput;

export type WizardSubtask = NonNullable<WizardValues['subtasks']>[number];

/** Where a held file goes: the task, one of its new subtasks, or one of its questions. */
export type FileTarget =
  | { kind: 'task' }
  | { kind: 'subtask'; index: number }
  | { kind: 'question'; index: number };

/** Rule C3: a file uploaded at once and held until the task is saved. */
export interface WizardFile {
  key: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** Null while it uploads. */
  uploadId: string | null;
  /** 0 to 1 while it uploads. */
  progress: number;
  failed: string | null;
  /** When the upload finished; held uploads are purged after a day (F10). */
  uploadedAt: string | null;
  /** On the task or a subtask: a reference (the default) or the deliverable's first version. */
  role: (typeof CREATE_FILE_ROLES)[number];
  target: FileTarget;
}

export interface WizardDraft {
  version: typeof DRAFT_VERSION;
  /** The presets the wizard was opened with: a draft only comes back with the same ones. */
  context: string;
  step: WizardStep;
  mode: WizardMode;
  values: WizardValues;
  /** Finished uploads only: one still running is lost with the page. */
  files: WizardFile[];
}

const DRAFT_VERSION = 1;

/** The wizard warns once its uploads are this old, before F10 purges them. */
export const UPLOAD_WARNING_HOURS = 20;

const HOUR = 60 * 60 * 1000;

export function draftStorageKey(userId: string): string {
  return `vertex-hub:task-wizard:${userId}`;
}

/** The presets as one string, keys sorted and empty ones left out. */
export function draftContext(presets: Record<string, string | undefined>): string {
  return JSON.stringify(
    Object.entries(presets)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** Saves the draft; a full or blocked storage loses it quietly (the wizard still works). */
export function saveDraft(storage: Storage, userId: string, draft: Omit<WizardDraft, 'version'>) {
  const files = draft.files.filter((file) => file.uploadId !== null && file.failed === null);
  try {
    storage.setItem(
      draftStorageKey(userId),
      JSON.stringify({ ...draft, files, version: DRAFT_VERSION }),
    );
  } catch {
    // Storage full or unavailable.
  }
}

/**
 * The stored draft for these presets, or null: none, another version, other presets, or
 * unreadable.
 */
export function loadDraft(storage: Storage, userId: string, context: string): WizardDraft | null {
  try {
    const raw = storage.getItem(draftStorageKey(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<WizardDraft>;
    if (draft.version !== DRAFT_VERSION || draft.context !== context) return null;
    if (!draft.values || !Array.isArray(draft.files)) return null;
    if (!draft.step || !(WIZARD_STEPS as readonly string[]).includes(draft.step)) return null;
    return draft as WizardDraft;
  } catch {
    return null;
  }
}

export function clearDraft(storage: Storage, userId: string) {
  try {
    storage.removeItem(draftStorageKey(userId));
  } catch {
    // Unavailable storage holds nothing.
  }
}

/**
 * Rule C3 and edge case 17: an upload is `aging` from 20 hours, before F10 purges it, and
 * `expired` after 24 (upload it again).
 */
export function uploadAge(
  file: Pick<WizardFile, 'uploadedAt'>,
  now: Date,
): 'uploading' | 'fresh' | 'aging' | 'expired' {
  if (!file.uploadedAt) return 'uploading';
  const hours = (now.getTime() - new Date(file.uploadedAt).getTime()) / HOUR;
  if (hours >= FILE_UPLOAD_LIFETIME_HOURS) return 'expired';
  return hours >= UPLOAD_WARNING_HOURS ? 'aging' : 'fresh';
}

// Subtasks and stages

/** Moves a subtask; the files that go on subtasks follow theirs. */
export function moveSubtask(
  values: WizardValues,
  files: WizardFile[],
  from: number,
  to: number,
): { values: WizardValues; files: WizardFile[] } {
  const subtasks = [...(values.subtasks ?? [])];
  const [moved] = subtasks.splice(from, 1);
  if (!moved || to < 0 || to > subtasks.length) return { values, files };
  subtasks.splice(to, 0, moved);
  const order = (values.subtasks ?? []).map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return {
    values: { ...values, subtasks },
    files: files.map((file) =>
      file.target.kind === 'subtask'
        ? { ...file, target: { kind: 'subtask', index: order.indexOf(file.target.index) } }
        : file,
    ),
  };
}

/** Removes a subtask; its files go back to the task. */
export function removeSubtask(
  values: WizardValues,
  files: WizardFile[],
  index: number,
): { values: WizardValues; files: WizardFile[] } {
  return {
    values: { ...values, subtasks: (values.subtasks ?? []).filter((_, i) => i !== index) },
    files: files.map((file) => {
      if (file.target.kind !== 'subtask' || file.target.index < index) return file;
      if (file.target.index === index) return { ...file, target: { kind: 'task' } };
      return { ...file, target: { kind: 'subtask', index: file.target.index - 1 } };
    }),
  };
}

/** Removes a question; its attachments go with it. */
export function removeQuestion(
  values: WizardValues,
  files: WizardFile[],
  index: number,
): { values: WizardValues; files: WizardFile[] } {
  return {
    values: { ...values, questions: (values.questions ?? []).filter((_, i) => i !== index) },
    files: files.flatMap((file) => {
      if (file.target.kind !== 'question' || file.target.index < index) return [file];
      if (file.target.index === index) return [];
      return [{ ...file, target: { kind: 'question', index: file.target.index - 1 } }];
    }),
  };
}

/**
 * A new run mode (rule A3): by stages every subtask needs a stage (the first one, `firstStage`
 * named when there is none yet); other modes have no stages.
 */
export function withRunMode(
  values: WizardValues,
  mode: SubtaskRunMode,
  firstStage: string,
): WizardValues {
  if (mode !== 'stages') {
    return {
      ...values,
      runMode: mode,
      stages: [],
      subtasks: (values.subtasks ?? []).map((subtask) => ({ ...subtask, stageIndex: null })),
    };
  }
  const stages = values.stages?.length ? values.stages : [{ name: firstStage }];
  return {
    ...values,
    runMode: mode,
    stages,
    subtasks: (values.subtasks ?? []).map((subtask) => ({
      ...subtask,
      stageIndex: subtask.stageIndex ?? 0,
    })),
  };
}

/** Moves a stage; its subtasks keep it. */
export function moveStage(values: WizardValues, from: number, to: number): WizardValues {
  const stages = [...(values.stages ?? [])];
  const [moved] = stages.splice(from, 1);
  if (!moved || to < 0 || to > stages.length) return values;
  stages.splice(to, 0, moved);
  const order = (values.stages ?? []).map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return {
    ...values,
    stages,
    subtasks: (values.subtasks ?? []).map((subtask) =>
      subtask.stageIndex == null
        ? subtask
        : { ...subtask, stageIndex: order.indexOf(subtask.stageIndex) },
    ),
  };
}

/** Removes a stage; its subtasks join the stage before it (or the next one, for the first). */
export function removeStage(values: WizardValues, index: number): WizardValues {
  const stages = (values.stages ?? []).filter((_, i) => i !== index);
  return {
    ...values,
    stages,
    subtasks: (values.subtasks ?? []).map((subtask) => {
      const stage = subtask.stageIndex;
      if (stage == null || stage < index) return subtask;
      return { ...subtask, stageIndex: Math.max(0, stage - 1) };
    }),
  };
}

// Readiness and saving

const briefWritten = (doc: WizardValues['briefDoc']) =>
  !!doc && richTextPlain(doc as Parameters<typeof richTextPlain>[0]).trim() !== '';

const filled = (fields: WizardValues['briefFields']) =>
  !!fields && Object.values(fields).some((value) => value !== undefined);

/**
 * Rule C5: the draft as the readiness check reads it, with the draft position of each subtask
 * sent (those without a department or a due date yet are left out).
 */
export function readinessInput(
  values: WizardValues,
  files: WizardFile[],
  needsClientApproval: boolean,
): { input: TaskReadinessInput; subtaskIndexes: number[] } | null {
  if (!values.department || !values.dueDate) return null;
  const references = (target: (file: WizardFile) => boolean) =>
    files.some((file) => file.role === 'reference' && target(file));
  const sent = (values.subtasks ?? []).flatMap((subtask, index) =>
    subtask.department && subtask.dueDate ? [{ subtask, index }] : [],
  );
  return {
    subtaskIndexes: sent.map(({ index }) => index),
    input: {
      department: values.department,
      assigneeId: values.assigneeId ?? null,
      dueDate: values.dueDate,
      dueTime: values.dueTime ?? null,
      estimateMinutes: values.estimateMinutes ?? null,
      hasBrief: briefWritten(values.briefDoc),
      hasBriefFields: filled(values.briefFields),
      hasReferences: references((file) => file.target.kind === 'task'),
      hasCriteria: (values.criteria ?? []).length > 0,
      needsClientApproval,
      subtasks: sent.map(({ subtask, index }) => ({
        department: subtask.department,
        assigneeId: subtask.assigneeId ?? null,
        dueDate: subtask.dueDate,
        estimateMinutes: subtask.estimateMinutes ?? null,
        hasBrief: briefWritten(subtask.briefDoc),
        hasBriefFields: filled(subtask.briefFields),
        hasReferences: references(
          (file) => file.target.kind === 'subtask' && file.target.index === index,
        ),
        hasCriteria: (subtask.criteria ?? []).length > 0,
      })),
    },
  };
}

/** The warnings with each `subtaskIndex` turned from the sent list's into the draft's. */
export function warningsOnDraft(
  warnings: readonly ReadinessWarning[],
  subtaskIndexes: readonly number[],
): ReadinessWarning[] {
  return warnings.map((warning) =>
    warning.subtaskIndex === null
      ? warning
      : { ...warning, subtaskIndex: subtaskIndexes[warning.subtaskIndex] ?? warning.subtaskIndex },
  );
}

/** Rule C2: the checked draft with its held files, as one create request. */
export function createPayload(task: CreateTask, files: WizardFile[]): CreateTask {
  const held = files.filter((file) => file.uploadId !== null);
  const on = (target: (file: WizardFile) => boolean) =>
    held
      .filter(target)
      .map((file) => ({ uploadId: file.uploadId as string, role: file.role, name: file.name }));
  return {
    ...task,
    files: on((file) => file.target.kind === 'task'),
    subtasks: task.subtasks.map((subtask, index) => ({
      ...subtask,
      files: on((file) => file.target.kind === 'subtask' && file.target.index === index),
    })),
    questions: task.questions.map((question, index) => ({
      ...question,
      files: held
        .filter((file) => file.target.kind === 'question' && file.target.index === index)
        .map((file) => ({ uploadId: file.uploadId as string })),
    })),
  };
}

/**
 * Rule D2: a task template's draft over the wizard's values. The presets (client, engagement,
 * type) stay; everything the template holds is replaced.
 */
export function valuesFromTemplate(values: WizardValues, draft: TaskTemplateDraft): WizardValues {
  const item = (from: TaskTemplateDraft | TaskTemplateDraft['subtasks'][number]) => ({
    title: from.title,
    briefDoc: from.briefDoc,
    briefFields: from.briefFields,
    department: from.department,
    assigneeId: from.assigneeId,
    dueDate: from.dueDate,
    priority: from.priority,
    estimateMinutes: from.estimateMinutes,
    checklist: from.checklist,
    criteria: from.criteria,
  });
  return {
    ...values,
    ...item(draft),
    brief: undefined,
    needsClientApproval: values.clientId ? draft.needsClientApproval : false,
    revisionLimit: draft.revisionLimit,
    runMode: draft.runMode ?? undefined,
    stages: draft.stages,
    subtasks: draft.subtasks.map((subtask) => ({
      ...item(subtask),
      stageIndex: subtask.stageIndex,
      files: [],
    })),
    templateId: draft.templateId,
  };
}
