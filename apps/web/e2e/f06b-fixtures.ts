import type { Page, Route } from '@playwright/test';
import {
  type DepartmentCode,
  type MyQuestion,
  richTextFromPlain,
  type Subtask,
  type Task,
  type TaskComment,
  type TaskCommentDoc,
  type TaskDetail,
  type TaskReply,
  type TaskStage,
} from '@vertex-hub/contracts';
import { seedIds } from './fixtures';

/*
 * F06B on the task page: the seeded autumn menu as a parent run by stages, with its subtasks, a
 * finished stage's handover, acceptance criteria and a thread of questions. These routes are added
 * after `mockApi`, so they answer before it for the parent's detail and thread; everything else
 * (its files, following, the subtasks' files) stays with the main mock.
 */

const uuid = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;

const sara = { id: seedIds.sara, name: 'سارة الخطيب', imageId: null };
const layan = { id: seedIds.layan, name: 'ليان الأحمد', imageId: null };
const karim = { id: seedIds.karim, name: 'كريم الزين', imageId: null };
const omar = { id: seedIds.omar, name: 'عمر حداد', imageId: null };

export const F06B_PARENT = seedIds.autumnMenu;

/** The subtasks' ids are seeded tasks, so their files and pages answer from the main mock. */
export const F06B_SUBTASKS = {
  copy: seedIds.octoberCover,
  photos: seedIds.dishShoot,
  pages: seedIds.clinicLogo,
  print: seedIds.openingPosts,
};

const STAGES = { copy: uuid(19001), design: uuid(19002), final: uuid(19003) };

const assignee = (person: typeof layan) => ({ ...person, archived: false, inDepartment: true });

function taskBase(fields: Partial<Task> & Pick<Task, 'id' | 'title' | 'department'>): Task {
  return {
    type: 'work',
    assignee: null,
    status: 'new',
    reviewStage: null,
    priority: 'normal',
    dueDate: '2026-10-15',
    dueTime: null,
    overdue: false,
    blocked: false,
    client: { id: seedIds.jasmine, name: 'مطعم الياسمين', imageId: null },
    project: { id: seedIds.identityProject, name: 'الهوية البصرية الجديدة', imageId: null },
    milestone: null,
    retainer: null,
    cycle: null,
    cycleLine: null,
    checklist: { done: 0, total: 0 },
    revisions: { clientCount: 0, limit: 2 },
    overLimitPending: false,
    postId: null,
    parent: null,
    progress: null,
    openQuestions: { total: 0, inSubtasks: 0 },
    estimateMinutes: null,
    ...fields,
  };
}

type Variant = 'working' | 'revisions';

function subtasks(variant: Variant): Subtask[] {
  const delivered = variant === 'revisions';
  const parent = { id: F06B_PARENT, title: 'تصاميم منيو الخريف' };
  const subtask = (fields: Partial<Subtask> & Pick<Subtask, 'id' | 'title' | 'department'>) => ({
    ...taskBase({ ...fields, parent }),
    position: 1,
    stageId: null,
    waitingOn: [],
    handoverNote: null,
    ...fields,
  });
  return [
    subtask({
      id: F06B_SUBTASKS.copy,
      title: 'نصوص المنيو',
      department: 'content_management',
      assignee: assignee(sara),
      status: 'delivered',
      dueDate: '2026-10-08',
      position: 1,
      stageId: STAGES.copy,
      estimateMinutes: 180,
      handoverNote: 'الأسماء معتمدة من المطعم، والأسعار تُضاف لاحقًا.',
    }),
    subtask({
      id: F06B_SUBTASKS.photos,
      title: 'تصوير الأطباق',
      department: 'photography',
      assignee: assignee(karim),
      status: delivered ? 'delivered' : 'in_progress',
      dueDate: '2026-10-12',
      position: 2,
      stageId: STAGES.design,
      openQuestions: { total: delivered ? 0 : 1, inSubtasks: 0 },
    }),
    subtask({
      id: F06B_SUBTASKS.pages,
      title: 'تصميم صفحات المنيو',
      department: 'design',
      assignee: delivered ? assignee(layan) : null,
      status: delivered ? 'delivered' : 'new',
      dueDate: '2026-10-13',
      position: 3,
      stageId: STAGES.design,
      estimateMinutes: 480,
    }),
    subtask({
      id: F06B_SUBTASKS.print,
      title: 'تجهيز ملفات الطباعة',
      department: 'design',
      assignee: assignee(layan),
      status: delivered ? 'delivered' : 'new',
      dueDate: '2026-10-14',
      position: 4,
      stageId: STAGES.final,
      blocked: !delivered,
      waitingOn: delivered
        ? []
        : [
            { id: F06B_SUBTASKS.photos, title: 'تصوير الأطباق' },
            { id: F06B_SUBTASKS.pages, title: 'تصميم صفحات المنيو' },
          ],
    }),
  ];
}

function stages(variant: Variant): TaskStage[] {
  const done = variant === 'revisions';
  const copy: TaskStage['handover'] = [
    {
      id: F06B_SUBTASKS.copy,
      title: 'نصوص المنيو',
      assignee: sara,
      note: 'الأسماء معتمدة من المطعم، والأسعار تُضاف لاحقًا.',
      finals: [{ fileItemId: uuid(1305), name: 'غلاف أكتوبر' }],
    },
  ];
  return [
    { id: STAGES.copy, name: 'النصوص', position: 1, finished: true, handover: copy },
    { id: STAGES.design, name: 'التصميم', position: 2, finished: done, handover: done ? [] : null },
    { id: STAGES.final, name: 'الإخراج', position: 3, finished: done, handover: done ? [] : null },
  ];
}

const briefDoc = {
  type: 'doc' as const,
  content: [
    {
      type: 'paragraph' as const,
      content: [
        { type: 'text' as const, text: 'ثلاث صفحات للمنيو الجديد بمقاس ' },
        { type: 'text' as const, text: 'A4', marks: [{ type: 'bold' as const }] },
        { type: 'text' as const, text: '، بألوان الهوية الجديدة.' },
      ],
    },
    {
      type: 'bulletList' as const,
      content: ['صور الأطباق الموسمية', 'قسم خاص بالمشروبات الساخنة'].map((text) => ({
        type: 'listItem' as const,
        content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] }],
      })),
    },
  ],
};

/** The parent's detail: at work in its second stage, or back from the client in revisions. */
export function parentDetail(variant: Variant): TaskDetail {
  const children = subtasks(variant);
  const live = children.filter((child) => child.status !== 'cancelled');
  const revisions = variant === 'revisions';
  return {
    ...taskBase({
      id: F06B_PARENT,
      title: 'تصاميم منيو الخريف',
      department: 'design',
      assignee: assignee(layan),
      status: revisions ? 'revisions' : 'in_progress',
      priority: 'high',
      dueDate: '2026-10-15',
      checklist: { done: 1, total: 2 },
      revisions: { clientCount: revisions ? 1 : 0, limit: 2 },
      progress: {
        delivered: live.filter((child) => child.status === 'delivered').length,
        total: live.length,
      },
      openQuestions: { total: revisions ? 0 : 2, inSubtasks: revisions ? 0 : 1 },
      estimateMinutes: 240,
    }),
    brief: 'ثلاث صفحات للمنيو الجديد بمقاس A4، بألوان الهوية الجديدة.',
    briefDoc,
    briefFields: {
      sizes: ['A4', '1080 × 1350'],
      colors: ['#1F3A5F', '#E8B04B'],
      references: ['https://www.behance.net/gallery/autumn-menu'],
    },
    needsClientApproval: true,
    clientRequest: null,
    dependencies: [],
    dependents: [],
    checklistItems: [
      {
        id: uuid(19101),
        text: 'جمع صور الأطباق',
        position: 1,
        done: true,
        doneAt: '2026-10-06T09:00:00.000Z',
        doneBy: layan,
      },
      {
        id: uuid(19102),
        text: 'تجهيز ملفات الطباعة',
        position: 2,
        done: false,
        doneAt: null,
        doneBy: null,
      },
    ],
    criteria: [
      {
        id: uuid(19201),
        text: 'كل الأسعار مطابقة لقائمة المطعم',
        position: 1,
        done: true,
        doneAt: '2026-10-09T09:00:00.000Z',
        doneBy: layan,
      },
      {
        id: uuid(19202),
        text: 'ملفات الطباعة بدقة 300 نقطة',
        position: 2,
        done: false,
        doneAt: null,
        doneBy: null,
      },
    ],
    links: [],
    fileCounts: { deliverables: 2, references: 2 },
    revisionHistory: revisions
      ? [
          {
            id: uuid(19301),
            source: 'client',
            number: 1,
            note: 'تكبير صور الأطباق في الصفحة الثانية.',
            contact: null,
            overLimit: false,
            decision: null,
            decisionNote: null,
            extraWork: null,
            decidedBy: null,
            decidedAt: null,
            author: layan,
            createdAt: '2026-10-10T08:00:00.000Z',
          },
        ]
      : [],
    clientText: null,
    contentToken: '0000000000000000',
    clearedReview: null,
    reviewHistory: [],
    clientResponses: [],
    pendingApproval: null,
    runMode: 'stages',
    stages: stages(variant),
    subtasks: children,
    handoverNote: null,
    createdBy: sara,
    createdAt: '2026-10-05T09:00:00.000Z',
    updatedAt: '2026-10-09T09:00:00.000Z',
    startedAt: '2026-10-06T07:30:00.000Z',
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    archivedAt: null,
    readOnly: false,
    permissions: {
      canEdit: true,
      canAssign: true,
      canWork: true,
      canReview: true,
      canRecordClientResponse: true,
      canDecideRevision: true,
      canMedicalReview: false,
      canWithdrawFromClient: false,
      canEditClientText: true,
      canSendForApproval: false,
      canCancel: true,
      canReopen: true,
      canArchive: false,
      canManageSubtasks: true,
      canReopenSubtasks: revisions,
      canWriteHandover: false,
      canEditCriteria: true,
      canTickCriteria: true,
      canSaveTemplate: true,
    },
    allowedTransitions: revisions ? ['in_progress', 'cancelled'] : ['internal_review', 'cancelled'],
  };
}

const doc = (text: string, mentions = false) =>
  richTextFromPlain(text, { mentions }) as TaskCommentDoc;

function message(
  n: number,
  author: typeof layan,
  text: string,
  createdAt: string,
  fields: Partial<TaskReply> = {},
): TaskReply {
  return {
    id: uuid(n),
    kind: 'comment',
    author: { ...author, archived: false },
    body: text,
    bodyDoc: doc(text, true),
    mentions: [],
    attachments: [],
    questionId: null,
    convertedTask: null,
    editedAt: null,
    removed: false,
    createdAt,
    canEdit: author.id === layan.id,
    canRemove: author.id === layan.id,
    canConvert: true,
    ...fields,
  };
}

/** The thread: a department question with a reply and a picture, an answered one, a comment. */
export function parentThread(): TaskComment[] {
  const toDesign: TaskComment = {
    ...message(
      19401,
      sara,
      'ما المقاسات المطلوبة لنسخة إنستغرام من المنيو؟',
      '2026-10-08T09:00:00.000Z',
      {
        kind: 'question',
        attachments: [
          {
            id: uuid(1301),
            name: 'menu-cover-v2.png',
            versionId: uuid(1351),
            mimeType: 'image/png',
            sizeBytes: 2_726_297,
            previewReady: true,
          },
        ],
      },
    ),
    question: {
      addressee: null,
      department: 'design',
      status: 'open',
      answeredBy: null,
      answeredAt: null,
      canAnswer: true,
      canReopen: false,
      canForward: true,
    },
    replies: [
      message(19402, karim, 'سأرسل الصور بمقاس 1080 × 1350.', '2026-10-08T10:30:00.000Z', {
        questionId: uuid(19401),
      }),
    ],
  };
  const toKarim: TaskComment = {
    ...message(19403, layan, 'هل صُوّرت أطباق الحلويات؟', '2026-10-07T12:00:00.000Z', {
      kind: 'question',
    }),
    question: {
      addressee: { ...karim, archived: false, inDepartment: true },
      department: null,
      status: 'answered',
      answeredBy: karim,
      answeredAt: '2026-10-07T13:00:00.000Z',
      canAnswer: false,
      canReopen: true,
      canForward: false,
    },
    replies: [
      message(19404, karim, 'نعم، كلها في المجلد.', '2026-10-07T12:40:00.000Z', {
        questionId: uuid(19403),
      }),
    ],
  };
  const text = `@{${layan.id}} أضفت ملاحظات المطعم على الألوان.`;
  const comment: TaskComment = {
    ...message(19405, omar, text, '2026-10-09T08:00:00.000Z', {
      mentions: [{ ...layan, archived: false }],
      convertedTask: { id: F06B_SUBTASKS.pages, title: 'تصميم صفحات المنيو' },
    }),
    question: null,
    replies: [],
  };
  return [toKarim, toDesign, comment];
}

/** Rule B7: Sara's question to Design waits for Layan, who manages it. */
export function questionsWaiting(): MyQuestion[] {
  const [, toDesign] = parentThread();
  return [
    {
      ...(toDesign as TaskComment),
      task: { id: F06B_PARENT, title: 'تصاميم منيو الخريف', status: 'in_progress' },
    },
  ];
}

export interface F06bApi {
  /** The request bodies the page sent, by `METHOD path`. */
  sent: { method: string; path: string; body: unknown }[];
}

/** Answers the parent's detail and thread; the rest falls back to the main mock. */
export async function mockF06b(page: Page, variant: Variant = 'working'): Promise<F06bApi> {
  const api: F06bApi = { sent: [] };
  let detail = parentDetail(variant);
  let thread = parentThread();
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
  await page.route(
    (url) => url.pathname.startsWith(`/api/tasks/${F06B_PARENT}`),
    async (route, request) => {
      const url = new URL(request.url());
      const rest = url.pathname.slice(`/api/tasks/${F06B_PARENT}`.length);
      const method = request.method();
      const body = request.postData() ? request.postDataJSON() : undefined;
      if (method !== 'GET') api.sent.push({ method, path: rest, body });
      if (rest === '' && method === 'GET') return json(route, detail);
      if (rest === '/comments' && method === 'GET') {
        const open = url.searchParams.get('status') === 'open';
        const items = open ? thread.filter((item) => item.question?.status === 'open') : thread;
        return json(route, { items, total: items.length, page: 1, pageSize: 50 });
      }
      if (rest === '/subtasks/reopen' && method === 'POST') {
        const picked = (body as { items: { id: string }[] }).items.map((item) => item.id);
        detail = {
          ...detail,
          subtasks: detail.subtasks.map((child) =>
            picked.includes(child.id) ? { ...child, status: 'in_progress' } : child,
          ),
          permissions: { ...detail.permissions, canReopenSubtasks: false },
        };
        return json(route, detail);
      }
      if (rest === '/run-mode' && method === 'PUT') {
        const runMode = (body as { runMode: TaskDetail['runMode'] }).runMode;
        detail = {
          ...detail,
          runMode,
          subtasks: detail.subtasks.map((child) => ({
            ...child,
            stageId: runMode === 'stages' ? child.stageId : null,
          })),
        };
        return json(route, { runMode, stages: detail.stages, subtasks: detail.subtasks });
      }
      if (rest === '/questions' && method === 'POST') {
        const input = body as { addressedDepartment?: string };
        const asked: TaskComment = {
          ...message(19499, layan, 'سؤال جديد', '2026-10-10T09:00:00.000Z', { kind: 'question' }),
          question: {
            addressee: null,
            department: (input.addressedDepartment ?? null) as DepartmentCode | null,
            status: 'open',
            answeredBy: null,
            answeredAt: null,
            canAnswer: true,
            canReopen: false,
            canForward: false,
          },
          replies: [],
        };
        thread = [...thread, asked];
        return json(route, asked, 201);
      }
      return route.fallback();
    },
  );
  return api;
}
