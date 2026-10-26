import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  businessInstant,
  fileUploadSchema,
  myQuestionPageSchema,
  myTaskSummarySchema,
  type NotificationType,
  type TaskComment,
  taskChecklistItemSchema,
  taskChecklistSchema,
  taskCommentPageSchema,
  taskCommentSchema,
  taskDetailSchema,
  taskPageSchema,
} from '@vertex-hub/contracts';
import {
  auditEntries,
  clients,
  createDatabase,
  fileItems,
  notifications,
  publicHolidays,
  taskComments,
  tasks,
  users,
} from '@vertex-hub/db';
import { testDatabaseUrl } from '@vertex-hub/db/testing';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuestionReminders } from '../src/modules/tasks/question-reminders.js';
import { expectError } from './client-cast.js';
import { api, clientIp, ORIGIN, textDoc } from './helpers.js';
import { startApp } from './start-app.js';
import { seedTaskCast } from './task-cast.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('task questions, rich text and criteria (F06B parts B and C6)', () => {
  const connection = createDatabase(testDatabaseUrl());
  const db = connection.db;
  let app: INestApplication;
  let url: string;
  let client: ReturnType<typeof api>;
  let cast: Awaited<ReturnType<typeof seedTaskCast>>;

  const patch = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PATCH', path, { cookie, body });
  const put = (path: string, cookie: string | undefined, body: unknown) =>
    client.request('PUT', path, { cookie, body });

  const askRaw = (taskId: string, cookie: string | undefined, body: Record<string, unknown>) =>
    client.post(`/api/tasks/${taskId}/questions`, cookie, {
      bodyDoc: textDoc('أي مقاس؟'),
      ...body,
    });

  async function ask(taskId: string, cookie: string, body: Record<string, unknown>) {
    const response = await askRaw(taskId, cookie, body);
    expect(response.status, await response.clone().text()).toBe(201);
    return taskCommentSchema.parse(await response.json());
  }

  async function reply(taskId: string, cookie: string, questionId: string, text = 'المقاس 1080') {
    const response = await client.post(`/api/tasks/${taskId}/comments`, cookie, {
      bodyDoc: textDoc(text),
      questionId,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return taskCommentSchema.parse(await response.json());
  }

  const action = (taskId: string, questionId: string, verb: string, cookie?: string, body = {}) =>
    client.post(`/api/tasks/${taskId}/questions/${questionId}/${verb}`, cookie, body);

  async function thread(taskId: string, cookie: string, query = '') {
    const response = await client.get(`/api/tasks/${taskId}/comments${query}`, cookie);
    expect(response.status).toBe(200);
    return taskCommentPageSchema.parse(await response.json());
  }

  async function mine(cookie: string, query = '') {
    const response = await client.get(`/api/me/questions${query}`, cookie);
    expect(response.status).toBe(200);
    return myQuestionPageSchema.parse(await response.json());
  }

  async function waiting(cookie: string) {
    const response = await client.get('/api/me/tasks/summary', cookie);
    expect(response.status).toBe(200);
    return myTaskSummarySchema.parse(await response.json()).questionsWaiting;
  }

  const rowsOf = (recipientId: string, subjectId: string, type: NotificationType) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.subjectId, subjectId),
          eq(notifications.type, type),
        ),
      )
      .orderBy(asc(notifications.createdAt));

  const auditOf = (entityId: string, action: string) =>
    db
      .select()
      .from(auditEntries)
      .where(and(eq(auditEntries.entityId, entityId), eq(auditEntries.action, action as never)))
      .orderBy(asc(auditEntries.id));

  async function upload(cookie: string, name: string) {
    const form = new FormData();
    form.append('file', new Blob([PDF]), name);
    const response = await fetch(`${url}/api/files/uploads`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-forwarded-for': clientIp(), cookie },
      body: form,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return fileUploadSchema.parse(await response.json());
  }

  /** A Design task assigned to the designer, created by the Design manager. */
  const designTask = (input: Parameters<typeof cast.createTask>[1] = {}) =>
    cast.createTask(cast.designManager.cookie, { assigneeId: cast.designer.id, ...input });

  beforeAll(async () => {
    ({ app, url } = await startApp());
    client = api(url);
    cast = await seedTaskCast(db, client);
  });

  afterAll(async () => {
    await app?.close();
    await cast?.cleanup();
    await connection.close();
  });

  it('refuses every question route without a session or outside a task', async () => {
    const id = randomUUID();
    expect((await askRaw(id, undefined, { addressedDepartment: 'design' })).status).toBe(401);
    for (const verb of ['answered', 'reopen', 'forward']) {
      expect((await action(id, randomUUID(), verb)).status).toBe(401);
    }
    expect((await client.get('/api/me/questions', undefined)).status).toBe(401);
    expect(
      (await askRaw(randomUUID(), cast.employee.cookie, { addressedDepartment: 'design' })).status,
    ).toBe(404);
    const task = await designTask();
    await expectError(
      await action(task.id, randomUUID(), 'answered', cast.designer.cookie),
      404,
      'QUESTION_NOT_FOUND',
    );
  });

  it('asks a person, audited and notified, and counts it as open (rules B1, B7)', async () => {
    const task = await designTask();
    await expectError(
      await askRaw(task.id, cast.writer.cookie, { addressedUserId: cast.writer.id }),
      400,
      'INVALID_ADDRESSEE',
    );
    await expectError(
      await askRaw(task.id, cast.writer.cookie, { addressedUserId: randomUUID() }),
      400,
      'INVALID_ADDRESSEE',
    );
    expect(
      (
        await askRaw(task.id, cast.writer.cookie, {
          addressedUserId: cast.designer.id,
          addressedDepartment: 'design',
        })
      ).status,
    ).toBe(400);

    const question = await ask(task.id, cast.writer.cookie, {
      addressedUserId: cast.designer.id,
      bodyDoc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Which sizes? ', marks: [{ type: 'bold' }] },
              { type: 'mention', attrs: { userId: cast.contentManager.id } },
            ],
          },
        ],
      },
    });
    expect(question).toMatchObject({
      kind: 'question',
      body: `Which sizes? @{${cast.contentManager.id}}`,
      mentions: [{ id: cast.contentManager.id }],
      question: {
        addressee: { id: cast.designer.id, inDepartment: true },
        department: null,
        status: 'open',
        canAnswer: true,
        canReopen: false,
        canForward: false,
      },
      replies: [],
    });
    expect(await auditOf(question.id, 'task_comment.question_asked')).toMatchObject([
      { after: { taskId: task.id, addressedUserId: cast.designer.id } },
    ]);
    expect(await rowsOf(cast.designer.id, task.id, 'task_question_asked')).toMatchObject([
      { box: 'action', data: { questionId: question.id, addressee: cast.designer.name } },
    ]);
    expect(await rowsOf(cast.contentManager.id, task.id, 'task_mentioned')).toHaveLength(1);

    const detail = await cast.detail(task.id, cast.employee.cookie);
    expect(detail.openQuestions).toEqual({ total: 1, inSubtasks: 0 });
    const listed = taskPageSchema.parse(
      await (
        await client.get(`/api/tasks?hasOpenQuestions=true&search=${cast.run}`, cast.gm.cookie)
      ).json(),
    );
    expect(listed.items.map((item) => item.id)).toContain(task.id);
    expect((await mine(cast.designer.cookie)).items.map((item) => item.id)).toContain(question.id);
    expect(
      (await mine(cast.designer.cookie)).items.find((item) => item.id === question.id)?.task,
    ).toMatchObject({ id: task.id, status: 'new' });
    expect(await waiting(cast.designer.cookie)).toBeGreaterThanOrEqual(1);
    expect((await mine(cast.writer.cookie)).items.map((item) => item.id)).not.toContain(
      question.id,
    );
    // Rule B6: an open question blocks nothing.
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
  });

  it('lets the managers forward a department question to a member (rule B5)', async () => {
    const task = await designTask();
    const question = await ask(task.id, cast.writer.cookie, { addressedDepartment: 'design' });
    expect(await rowsOf(cast.designManager.id, task.id, 'task_question_asked')).toHaveLength(1);
    expect((await mine(cast.designManager.cookie)).items.map((item) => item.id)).toContain(
      question.id,
    );
    const asManager = (await thread(task.id, cast.designManager.cookie)).items[0];
    expect(asManager?.question?.canForward).toBe(true);

    expect(
      (
        await action(task.id, question.id, 'forward', cast.designer.cookie, {
          userId: cast.designer.id,
        })
      ).status,
    ).toBe(403);
    await expectError(
      await action(task.id, question.id, 'forward', cast.designManager.cookie, {
        userId: cast.writer.id,
      }),
      400,
      'INVALID_ADDRESSEE',
    );
    const clockOf = async () =>
      (await db.select().from(taskComments).where(eq(taskComments.id, question.id)))[0]
        ?.clockStartedAt;
    const clockBefore = await clockOf();
    const forwarded = taskCommentSchema.parse(
      await (
        await action(task.id, question.id, 'forward', cast.designManager.cookie, {
          userId: cast.designer.id,
        })
      ).json(),
    );
    const clockAfter = await clockOf();
    expect(forwarded.question).toMatchObject({
      addressee: { id: cast.designer.id, inDepartment: true },
      department: 'design',
      status: 'open',
    });
    const [managers] = await rowsOf(cast.designManager.id, task.id, 'task_question_asked');
    expect(managers).toMatchObject({ resolution: 'void' });
    expect(await rowsOf(cast.designer.id, task.id, 'task_question_asked')).toMatchObject([
      { resolvedAt: null, data: { forwarded: true, department: 'design' } },
    ]);
    expect((await mine(cast.designManager.cookie)).items.map((item) => item.id)).not.toContain(
      question.id,
    );
    expect((await mine(cast.designer.cookie)).items.map((item) => item.id)).toContain(question.id);
    expect(await auditOf(question.id, 'task_comment.question_forwarded')).toMatchObject([
      { before: { addressedUserId: null }, after: { addressedUserId: cast.designer.id } },
    ]);
    // The clock does not restart.
    expect(clockAfter).toEqual(clockBefore);
  });

  it('marks questions answered by the rules of B4 and reopens them for the asker', async () => {
    const task = await designTask();
    const question = await ask(task.id, cast.writer.cookie, { addressedUserId: cast.designer.id });
    await expectError(
      await action(task.id, question.id, 'answered', cast.designer.cookie),
      409,
      'QUESTION_NO_REPLY',
    );
    expect((await action(task.id, question.id, 'answered', cast.employee.cookie)).status).toBe(403);

    const answer = await reply(task.id, cast.employee.cookie, question.id);
    expect(answer.questionId).toBe(question.id);
    expect(await rowsOf(cast.writer.id, task.id, 'task_question_answered')).toMatchObject([
      { data: { questionId: question.id, reply: true }, count: 1 },
    ]);
    const listed = (await thread(task.id, cast.writer.cookie)).items;
    expect(listed.map((item) => item.id)).toEqual([question.id]);
    expect(listed[0]?.replies.map((item) => item.id)).toEqual([answer.id]);

    // The author of any reply may mark it answered, once a reply exists.
    const answered = taskCommentSchema.parse(
      await (await action(task.id, question.id, 'answered', cast.employee.cookie)).json(),
    );
    expect(answered.question).toMatchObject({
      status: 'answered',
      answeredBy: { id: cast.employee.id },
      canAnswer: false,
    });
    // Merged per question into the asker's unread row.
    expect(await rowsOf(cast.writer.id, task.id, 'task_question_answered')).toMatchObject([
      { count: 2, data: { reply: false } },
    ]);
    const [asked] = await rowsOf(cast.designer.id, task.id, 'task_question_asked');
    expect(asked).toMatchObject({ resolution: 'done' });
    await expectError(
      await action(task.id, question.id, 'answered', cast.writer.cookie),
      409,
      'INVALID_TRANSITION',
    );

    await expectError(
      await action(task.id, question.id, 'reopen', cast.designer.cookie),
      403,
      'NOT_QUESTION_ASKER',
    );
    const reopened = taskCommentSchema.parse(
      await (await action(task.id, question.id, 'reopen', cast.writer.cookie)).json(),
    );
    expect(reopened.question).toMatchObject({ status: 'open', answeredBy: null });
    await expectError(
      await action(task.id, question.id, 'reopen', cast.writer.cookie),
      409,
      'INVALID_TRANSITION',
    );
    // The asker marks it answered without a reply of their own.
    expect((await action(task.id, question.id, 'answered', cast.writer.cookie)).status).toBe(200);
    expect(await auditOf(question.id, 'task_comment.question_reopened')).toHaveLength(1);
    expect(await auditOf(question.id, 'task_comment.question_answered')).toHaveLength(2);

    const department = await ask(task.id, cast.writer.cookie, { addressedDepartment: 'design' });
    await action(task.id, department.id, 'answered', cast.writer.cookie);
    await expectError(
      await action(task.id, department.id, 'forward', cast.designManager.cookie, {
        userId: cast.designer.id,
      }),
      409,
      'QUESTION_CLOSED',
    );
    const other = await designTask();
    await expectError(
      await client.post(`/api/tasks/${other.id}/comments`, cast.writer.cookie, {
        bodyDoc: textDoc('x'),
        questionId: question.id,
      }),
      404,
      'QUESTION_NOT_FOUND',
    );
    expect((await thread(task.id, cast.writer.cookie, '?kind=question&status=open')).total).toBe(0);
    expect((await thread(task.id, cast.writer.cookie, '?kind=question')).total).toBe(2);
  });

  it('attaches held uploads to a comment and lists them (rule B2)', async () => {
    const task = await designTask();
    const first = await upload(cast.writer.cookie, 'brief.pdf');
    const second = await upload(cast.writer.cookie, 'brief.pdf');
    const response = await client.post(`/api/tasks/${task.id}/comments`, cast.writer.cookie, {
      bodyDoc: textDoc('المرفقات'),
      files: [{ uploadId: first.uploadId }, { uploadId: second.uploadId }],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const comment = taskCommentSchema.parse(await response.json());
    expect(comment.attachments.map((file) => file.name)).toEqual(['brief.pdf', 'brief.pdf']);
    // Another comment may hold a file of the same name; an upload is used once.
    const third = await upload(cast.writer.cookie, 'brief.pdf');
    const question = await ask(task.id, cast.writer.cookie, {
      addressedDepartment: 'design',
      files: [{ uploadId: third.uploadId }],
    });
    expect(question.attachments).toHaveLength(1);
    await expectError(
      await client.post(`/api/tasks/${task.id}/comments`, cast.writer.cookie, {
        bodyDoc: textDoc('again'),
        files: [{ uploadId: first.uploadId }],
      }),
      400,
      'UPLOAD_NOT_FOUND',
    );
    const items = await db
      .select({ role: fileItems.role, commentId: fileItems.taskCommentId })
      .from(fileItems)
      .where(eq(fileItems.taskId, task.id));
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.role === 'attachment' && !!item.commentId)).toBe(true);
    const listed = await client.get(
      `/api/files/items?ownerType=task&ownerId=${task.id}&role=attachment`,
      cast.employee.cookie,
    );
    expect(listed.status).toBe(200);
  });

  it('writes the brief as rich text and keeps its plain extract (rule C1)', async () => {
    const briefDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'الهدف' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'أول' }] }],
            },
          ],
        },
      ],
    };
    const task = await designTask({ briefDoc } as never);
    expect(task.brief).toBe('الهدف\nأول');
    expect(task.briefDoc).toEqual(briefDoc);

    // A bold word changes the document, not the text: still an edit, audited.
    const bold = {
      ...briefDoc,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'الهدف', marks: [{ type: 'bold' }] }],
        },
        briefDoc.content[1],
      ],
    };
    const response = await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
      briefDoc: bold,
    });
    expect(response.status).toBe(200);
    expect(taskDetailSchema.parse(await response.json()).briefDoc).toEqual(bold);
    expect(await auditOf(task.id, 'task.updated')).toHaveLength(1);

    const plain = await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
      brief: 'سطر\nثان',
    });
    expect(taskDetailSchema.parse(await plain.json()).briefDoc).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'سطر' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'ثان' }] },
      ],
    });
    const cleared = await patch(`/api/tasks/${task.id}`, cast.designManager.cookie, {
      briefDoc: null,
    });
    expect(taskDetailSchema.parse(await cleared.json())).toMatchObject({
      brief: null,
      briefDoc: null,
    });
  });

  it('holds review until the acceptance criteria are ticked (rule C6)', async () => {
    const task = await designTask();
    const path = `/api/tasks/${task.id}/criteria`;
    expect(task.permissions).toMatchObject({ canEditCriteria: true, canTickCriteria: true });
    expect((await cast.detail(task.id, cast.designer.cookie)).permissions).toMatchObject({
      canEditCriteria: false,
      canTickCriteria: true,
    });
    expect((await client.post(path, undefined, { text: 'x' })).status).toBe(401);
    expect((await client.post(path, cast.designer.cookie, { text: 'x' })).status).toBe(403);
    const add = async (text: string) =>
      taskChecklistItemSchema.parse(
        await (await client.post(path, cast.designManager.cookie, { text })).json(),
      );
    const first = await add('المقاسات الثلاثة');
    const second = await add('شعار العميل');
    await client.post(`/api/tasks/${task.id}/checklist`, cast.designer.cookie, { text: 'مسودة' });

    const detail = await cast.detail(task.id, cast.designer.cookie);
    expect(detail.criteria.map((item) => item.text)).toEqual(['المقاسات الثلاثة', 'شعار العميل']);
    expect(detail.checklistItems.map((item) => item.text)).toEqual(['مسودة']);
    expect(detail.checklist).toEqual({ done: 0, total: 1 });

    // The assignee ticks but does not rename.
    expect((await patch(`${path}/${first.id}`, cast.designer.cookie, { text: 'x' })).status).toBe(
      403,
    );
    expect((await patch(`${path}/${first.id}`, cast.designer.cookie, { done: true })).status).toBe(
      200,
    );
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'in_progress' });
    const submit = await cast.move(task.id, cast.designer.cookie, { status: 'internal_review' });
    await expectError(submit, 409, 'CRITERIA_OPEN');
    const reordered = taskChecklistSchema.parse(
      await (
        await put(`${path}/order`, cast.designManager.cookie, { ids: [second.id, first.id] })
      ).json(),
    );
    expect(reordered.items.map((item) => item.id)).toEqual([second.id, first.id]);
    await expectError(
      await put(`${path}/order`, cast.designManager.cookie, { ids: [second.id] }),
      409,
      'INVALID_ORDER',
    );
    expect(
      (await client.post(`${path}/${second.id}/archive`, cast.designManager.cookie)).status,
    ).toBe(204);
    await cast.moveOk(task.id, cast.designer.cookie, { status: 'internal_review' });
    const [audit] = await auditOf(first.id, 'task_checklist_item.created');
    expect(audit).toMatchObject({ after: { kind: 'criterion' } });

    const full = await designTask();
    for (let n = 0; n < 15; n += 1) {
      await client.post(`/api/tasks/${full.id}/criteria`, cast.designManager.cookie, {
        text: `معيار ${n}`,
      });
    }
    await expectError(
      await client.post(`/api/tasks/${full.id}/criteria`, cast.designManager.cookie, { text: 'x' }),
      409,
      'LIMIT_REACHED',
    );
  });

  it('reminds after 24 work hours and escalates after 48, once each (rules B8, B9)', async () => {
    const reminders = app.get(QuestionReminders);
    const task = await designTask();
    const question = await ask(task.id, cast.writer.cookie, { addressedUserId: cast.designer.id });
    // Asked on a Thursday at 11:00: Friday does not count.
    const asked = businessInstant('2027-01-07', '11:00');
    await db
      .update(taskComments)
      .set({ clockStartedAt: asked })
      .where(eq(taskComments.id, question.id));

    await reminders.remind(businessInstant('2027-01-09', '10:59'));
    expect(await rowsOf(cast.designer.id, task.id, 'task_question_reminder')).toHaveLength(0);
    await reminders.remind(businessInstant('2027-01-09', '11:00'));
    await reminders.remind(businessInstant('2027-01-09', '11:05'));
    expect(await rowsOf(cast.designer.id, task.id, 'task_question_reminder')).toMatchObject([
      { data: { questionId: question.id }, actorId: null },
    ]);
    // The designer's primary department is Design: its manager hears of the escalation.
    await reminders.remind(businessInstant('2027-01-10', '11:00'));
    await reminders.remind(businessInstant('2027-01-10', '12:00'));
    expect(await rowsOf(cast.designManager.id, task.id, 'task_question_escalated')).toHaveLength(1);

    // Edge case 16: a holiday added later moves the reminder not yet sent.
    const later = await ask(task.id, cast.writer.cookie, { addressedUserId: cast.designer.id });
    await db
      .update(taskComments)
      .set({ clockStartedAt: asked })
      .where(eq(taskComments.id, later.id));
    const [holiday] = await db
      .insert(publicHolidays)
      .values({ name: `عطلة ${cast.run}`, startsOn: '2027-01-09', endsOn: '2027-01-09' })
      .returning();
    try {
      await reminders.remind(businessInstant('2027-01-09', '12:00'));
      const sent = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.type, 'task_question_reminder'),
            eq(notifications.subjectId, task.id),
          ),
        );
      expect(
        sent.filter((row) => (row.data as { questionId: string }).questionId === later.id),
      ).toEqual([]);
    } finally {
      if (holiday) await db.delete(publicHolidays).where(eq(publicHolidays.id, holiday.id));
    }

    // A question still with its department escalates to the General Managers and Operations.
    const department = await ask(task.id, cast.writer.cookie, { addressedDepartment: 'design' });
    await db
      .update(taskComments)
      .set({ clockStartedAt: asked })
      .where(eq(taskComments.id, department.id));
    await reminders.remind(businessInstant('2027-01-10', '11:00'));
    const top = await db
      .select({ recipientId: notifications.recipientId, data: notifications.data })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, 'task_question_escalated'),
          eq(notifications.subjectId, task.id),
          eq(notifications.recipientId, cast.gm.id),
        ),
      );
    expect(
      top.filter((row) => (row.data as { questionId: string }).questionId === department.id),
    ).toHaveLength(1);
  });

  it('stops reminders when the task is delivered and restarts the clock on reopen (rule B10)', async () => {
    const reminders = app.get(QuestionReminders);
    const parent = await cast.createTask(cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: cast.inDays(10),
    });
    const subtask = taskDetailSchema.parse(
      await (
        await client.post(`/api/tasks/${parent.id}/subtasks`, cast.writer.cookie, {
          title: `فرعية ${cast.run}`,
          department: 'design',
          dueDate: cast.inDays(5),
        })
      ).json(),
    );
    await patch(`/api/tasks/${subtask.id}`, cast.designManager.cookie, {
      assigneeId: cast.designer.id,
    });
    const question = await ask(subtask.id, cast.writer.cookie, {
      addressedUserId: cast.designer.id,
    });
    expect((await cast.detail(parent.id, cast.writer.cookie)).openQuestions).toEqual({
      total: 1,
      inSubtasks: 1,
    });
    await cast.moveOk(subtask.id, cast.designer.cookie, { status: 'in_progress' });
    await cast.moveOk(subtask.id, cast.designer.cookie, { status: 'internal_review' });
    await cast.moveOk(subtask.id, cast.writer.cookie, { status: 'delivered' });
    const [asked] = await rowsOf(cast.designer.id, subtask.id, 'task_question_asked');
    expect(asked).toMatchObject({ resolution: 'void' });
    // The question stays open and visible; its reminders stop.
    expect((await thread(subtask.id, cast.writer.cookie)).items[0]?.question?.status).toBe('open');
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db
      .update(taskComments)
      .set({ clockStartedAt: old })
      .where(eq(taskComments.id, question.id));
    await reminders.remind(new Date());
    expect(await rowsOf(cast.designer.id, subtask.id, 'task_question_reminder')).toHaveLength(0);

    const before = Date.now();
    await cast.moveOk(subtask.id, cast.designManager.cookie, {
      status: 'in_progress',
      revisionSource: 'internal',
      note: 'تعديل',
    });
    const [row] = await db.select().from(taskComments).where(eq(taskComments.id, question.id));
    expect(row?.clockStartedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('restarts the clocks of reopened subtasks, and reminds nobody on read-only tasks (rule B10)', async () => {
    const reminders = app.get(QuestionReminders);
    const { id: clientId } = await cast.createClient();
    const parent = await cast.createTask(cast.am.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      clientId,
      dueDate: cast.inDays(10),
    });
    const copy = taskDetailSchema.parse(
      await (
        await client.post(`/api/tasks/${parent.id}/subtasks`, cast.writer.cookie, {
          title: `نص ${cast.run}`,
          department: 'content_management',
          assigneeId: cast.writer.id,
          dueDate: cast.inDays(5),
        })
      ).json(),
    );
    const question = await ask(copy.id, cast.employee.cookie, { addressedUserId: cast.writer.id });
    await cast.moveOk(copy.id, cast.writer.cookie, { status: 'in_progress' });
    await cast.moveOk(copy.id, cast.writer.cookie, { status: 'internal_review' });
    await cast.moveOk(copy.id, cast.contentManager.cookie, { status: 'delivered' });
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'in_progress' });
    await cast.moveOk(parent.id, cast.writer.cookie, { status: 'internal_review' });
    await cast.moveOk(parent.id, cast.contentManager.cookie, { status: 'awaiting_client' });
    await cast.moveOk(parent.id, cast.am.cookie, { status: 'revisions', note: 'أقصر' });
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await db
      .update(taskComments)
      .set({ clockStartedAt: old })
      .where(eq(taskComments.id, question.id));
    const before = Date.now();
    const reopened = await client.post(
      `/api/tasks/${parent.id}/subtasks/reopen`,
      cast.contentManager.cookie,
      { items: [{ id: copy.id, note: 'أقصر' }] },
    );
    expect(reopened.status).toBe(200);
    const [row] = await db.select().from(taskComments).where(eq(taskComments.id, question.id));
    expect(row?.clockStartedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // A task of an archived client is read-only: its questions remind nobody.
    await db
      .update(taskComments)
      .set({ clockStartedAt: old })
      .where(eq(taskComments.id, question.id));
    await db.update(clients).set({ archivedAt: new Date() }).where(eq(clients.id, clientId));
    await reminders.remind(new Date());
    expect(await rowsOf(cast.writer.id, copy.id, 'task_question_reminder')).toHaveLength(0);
  });

  it("lets the former department's managers see and forward an archived addressee's question (edge case 14)", async () => {
    const task = await designTask();
    const leaver = await cast.signedIn({ name: `مغادر ${cast.run}` });
    const question = await ask(task.id, cast.writer.cookie, {
      addressedUserId: leaver.id,
      bodyDoc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'سؤال ' },
              { type: 'mention', attrs: { userId: leaver.id } },
            ],
          },
        ],
      },
    });
    // The addressee gets the question that waits on them, not the earlier-ranked mention.
    expect(await rowsOf(leaver.id, task.id, 'task_question_asked')).toHaveLength(1);
    expect(await rowsOf(leaver.id, task.id, 'task_mentioned')).toHaveLength(0);
    expect((await thread(task.id, cast.designManager.cookie)).items[0]?.question?.canForward).toBe(
      false,
    );

    await db.update(users).set({ archivedAt: new Date() }).where(eq(users.id, leaver.id));
    const asManager = (await thread(task.id, cast.designManager.cookie)).items[0];
    expect(asManager?.question).toMatchObject({
      addressee: { id: leaver.id, archived: true },
      canForward: true,
    });
    expect((await mine(cast.designManager.cookie)).items.map((item) => item.id)).toContain(
      question.id,
    );
    const forwarded = await action(task.id, question.id, 'forward', cast.designManager.cookie, {
      userId: cast.designer.id,
    });
    expect(forwarded.status, await forwarded.clone().text()).toBe(200);
    expect(taskCommentSchema.parse(await forwarded.json()).question).toMatchObject({
      addressee: { id: cast.designer.id },
      department: 'design',
    });
  });

  it('turns a question into a subtask with its files, answered and told (rule B11)', async () => {
    const parent = await cast.createTask(cast.contentManager.cookie, {
      department: 'content_management',
      assigneeId: cast.writer.id,
      dueDate: cast.inDays(10),
    });
    const file = await upload(cast.employee.cookie, 'sizes.pdf');
    const question = await ask(parent.id, cast.employee.cookie, {
      addressedDepartment: 'design',
      files: [{ uploadId: file.uploadId }],
    });
    const asWriter = (await thread(parent.id, cast.writer.cookie)).items[0] as TaskComment;
    expect(asWriter.canConvert).toBe(true);
    expect((await thread(parent.id, cast.employee.cookie)).items[0]?.canConvert).toBe(false);

    const convert = (cookie: string, fromCommentId: string) =>
      client.post(`/api/tasks/${parent.id}/subtasks`, cookie, {
        title: 'مقاسات البوستر',
        department: 'design',
        dueDate: cast.inDays(5),
        briefDoc: question.bodyDoc,
        fromCommentId,
      });
    expect((await convert(cast.employee.cookie, question.id)).status).toBe(403);
    const other = await designTask();
    const foreign = await ask(other.id, cast.writer.cookie, { addressedDepartment: 'design' });
    expect((await convert(cast.writer.cookie, foreign.id)).status).toBe(404);

    const response = await convert(cast.writer.cookie, question.id);
    expect(response.status, await response.clone().text()).toBe(201);
    const subtask = taskDetailSchema.parse(await response.json());
    expect(subtask).toMatchObject({ brief: 'أي مقاس؟', parent: { id: parent.id } });
    expect(subtask.fileCounts.references).toBe(1);

    const listed = (await thread(parent.id, cast.employee.cookie)).items[0];
    expect(listed).toMatchObject({
      convertedTask: { id: subtask.id, title: 'مقاسات البوستر' },
      question: { status: 'answered', answeredBy: { id: cast.writer.id } },
      canConvert: false,
    });
    expect(await rowsOf(cast.employee.id, parent.id, 'task_question_converted')).toHaveLength(1);
    expect(await rowsOf(cast.designManager.id, parent.id, 'task_question_converted')).toHaveLength(
      1,
    );
    expect(await auditOf(question.id, 'task_comment.converted')).toMatchObject([
      { after: { subtaskId: subtask.id, answered: true } },
    ]);
    await expectError(await convert(cast.writer.cookie, question.id), 409, 'INVALID_TRANSITION');

    // On a subtask, a comment becomes a sibling under the same parent.
    const comment = taskCommentSchema.parse(
      await (
        await client.post(`/api/tasks/${subtask.id}/comments`, cast.designer.cookie, {
          bodyDoc: textDoc('نحتاج نسخة مربعة'),
        })
      ).json(),
    );
    expect((await thread(subtask.id, cast.writer.cookie)).items[0]?.canConvert).toBe(true);
    const sibling = await convert(cast.writer.cookie, comment.id);
    expect(sibling.status).toBe(201);
    const children = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.parentId, parent.id));
    expect(children).toHaveLength(2);
    const references = await db
      .select({ id: fileItems.id })
      .from(fileItems)
      .where(and(eq(fileItems.taskId, subtask.id), eq(fileItems.role, 'reference')));
    expect(references).toHaveLength(1);
    await db.delete(notifications).where(inArray(notifications.subjectId, [parent.id, subtask.id]));
  });
});
