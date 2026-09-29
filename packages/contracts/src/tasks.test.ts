import { describe, expect, it } from 'vitest';
import {
  allowedTaskTransitions,
  BOARD_STATUSES,
  canMakeTaskMove,
  commentExcerpt,
  createsDependencyCycle,
  createTaskChecklistItemSchema,
  createTaskSchema,
  isTaskBlocked,
  isTaskOverdue,
  mentionedUserIds,
  revisionDecisionInputSchema,
  revisionSourceOf,
  TASK_STATUSES,
  type TaskRights,
  type TaskState,
  taskBoardQuerySchema,
  taskCommentInputSchema,
  taskDependenciesInputSchema,
  taskLinkProblem,
  taskListQuerySchema,
  taskMove,
  taskMoveNeedsNote,
  taskStatusChangeSchema,
  taskWorkloadQuerySchema,
  updateTaskChecklistItemSchema,
  updateTaskSchema,
} from './tasks.js';

const ids = {
  client: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd1',
  project: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd2',
  milestone: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd3',
  cycle: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd4',
  line: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd5',
  user: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd6',
  contact: '01a0e97d-0028-7d46-8479-9fa1ea9ffcd7',
};

const task = { title: ' Banner ', department: 'design', dueDate: '2026-10-05' };

describe('createTaskSchema', () => {
  it('fills the defaults for an unassigned internal request', () => {
    expect(createTaskSchema.parse(task)).toEqual({
      ...task,
      title: 'Banner',
      type: 'work',
      assigneeId: null,
      priority: 'normal',
      clientId: null,
      projectId: null,
      milestoneId: null,
      retainerCycleId: null,
      cycleLineId: null,
      needsClientApproval: false,
      revisionLimit: 2,
      dependsOn: [],
      checklist: [],
      links: [],
      requestScope: undefined,
    });
  });

  it('needs client approval by default with a client and never without one (rule 8)', () => {
    expect(createTaskSchema.parse({ ...task, clientId: ids.client }).needsClientApproval).toBe(
      true,
    );
    expect(
      createTaskSchema.parse({ ...task, clientId: ids.client, needsClientApproval: false })
        .needsClientApproval,
    ).toBe(false);
    expect(createTaskSchema.parse({ ...task, needsClientApproval: true }).needsClientApproval).toBe(
      false,
    );
  });

  it('refuses links that do not hang together', () => {
    const bad = [
      { projectId: ids.project },
      { retainerCycleId: ids.cycle },
      { clientId: ids.client, projectId: ids.project, retainerCycleId: ids.cycle },
      { clientId: ids.client, milestoneId: ids.milestone },
      { clientId: ids.client, cycleLineId: ids.line },
    ];
    for (const links of bad) {
      expect(createTaskSchema.safeParse({ ...task, ...links }).success, JSON.stringify(links)).toBe(
        false,
      );
    }
    const good = {
      clientId: ids.client,
      retainerCycleId: ids.cycle,
      cycleLineId: ids.line,
    };
    expect(createTaskSchema.safeParse({ ...task, ...good }).success).toBe(true);
  });

  it('keeps client request fields for client requests with a client (rule 11)', () => {
    const request = { ...task, type: 'client_request', clientId: ids.client };
    expect(createTaskSchema.parse(request).requestScope).toBe('in_scope');
    expect(createTaskSchema.parse({ ...request, requestScope: 'out_of_scope' }).requestScope).toBe(
      'out_of_scope',
    );
    expect(createTaskSchema.safeParse({ ...request, clientId: null }).success).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...task, clientId: ids.client, requestScope: 'in_scope' })
        .success,
    ).toBe(false);
    expect(createTaskSchema.safeParse({ ...task, requestedByContactId: ids.contact }).success).toBe(
      false,
    );
  });

  it('checks limits, lengths, dates and times', () => {
    const fails = [
      { title: '  ' },
      { title: 'x'.repeat(161) },
      { brief: 'x'.repeat(5001) },
      { revisionLimit: 21 },
      { revisionLimit: -1 },
      { dueDate: '05/10/2026' },
      { dueTime: '25:00' },
      { checklist: [' '] },
      { checklist: ['x'.repeat(201)] },
      { links: [{ url: 'ftp://files.example.com' }] },
      { links: [{ url: 'https://drive.example.com', label: 'x'.repeat(121) }] },
      { priority: 'critical' },
      { department: 'nope' },
    ];
    for (const change of fails) {
      expect(
        createTaskSchema.safeParse({ ...task, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
    expect(createTaskSchema.parse({ ...task, revisionLimit: 0 }).revisionLimit).toBe(0);
  });

  it('keeps each dependency once and stores a blank brief or label as null', () => {
    const parsed = createTaskSchema.parse({
      ...task,
      brief: '  ',
      dependsOn: [ids.user, ids.user],
      links: [{ url: 'https://drive.example.com/a', label: ' ' }],
    });
    expect(parsed.brief).toBeNull();
    expect(parsed.dependsOn).toEqual([ids.user]);
    expect(parsed.links).toEqual([{ url: 'https://drive.example.com/a', label: null }]);
  });
});

describe('updateTaskSchema', () => {
  it('accepts any subset and never the type', () => {
    expect(updateTaskSchema.parse({})).toEqual({});
    expect(updateTaskSchema.parse({ priority: 'urgent' })).toEqual({ priority: 'urgent' });
    expect(updateTaskSchema.parse({ type: 'client_request' })).toEqual({});
  });
});

describe('taskLinkProblem', () => {
  it('names the field that breaks the links', () => {
    expect(taskLinkProblem({ projectId: ids.project })).toBe('clientId');
    expect(
      taskLinkProblem({ clientId: ids.client, projectId: ids.project, retainerCycleId: ids.cycle }),
    ).toBe('retainerCycleId');
    expect(taskLinkProblem({ clientId: ids.client, milestoneId: ids.milestone })).toBe(
      'milestoneId',
    );
    expect(taskLinkProblem({ clientId: ids.client, projectId: ids.project })).toBeNull();
    expect(taskLinkProblem({})).toBeNull();
  });
});

describe('taskMove', () => {
  it('names every move of the workflow and nothing else (rule 1)', () => {
    expect(taskMove('new', 'in_progress')).toBe('start');
    expect(taskMove('internal_review', 'revisions')).toBe('return');
    expect(taskMove('approved', 'revisions')).toBe('client_changes');
    expect(taskMove('delivered', 'revisions')).toBe('reopen_client');
    expect(taskMove('delivered', 'in_progress')).toBe('reopen_internal');
    expect(taskMove('cancelled', 'new')).toBe('reopen');
    expect(taskMove('revisions', 'cancelled')).toBe('cancel');
    expect(taskMove('new', 'approved')).toBeNull();
    expect(taskMove('new', 'internal_review')).toBeNull();
    expect(taskMove('delivered', 'cancelled')).toBeNull();
    expect(taskMove('cancelled', 'cancelled')).toBeNull();
    expect(taskMove('in_progress', 'in_progress')).toBeNull();
  });

  it('knows which moves need a note and which record a revision (rule 9)', () => {
    expect(taskMoveNeedsNote('return')).toBe(true);
    expect(taskMoveNeedsNote('cancel')).toBe(true);
    expect(taskMoveNeedsNote('start')).toBe(false);
    expect(revisionSourceOf('return')).toBe('internal');
    expect(revisionSourceOf('client_changes')).toBe('client');
    expect(revisionSourceOf('reopen_client')).toBe('client');
    expect(revisionSourceOf('reopen_internal')).toBeNull();
  });
});

describe('allowedTaskTransitions', () => {
  const none: TaskRights = {
    work: false,
    manage: false,
    assign: false,
    client: false,
    creator: false,
  };
  const assignee: TaskRights = { ...none, work: true };
  const departmentManager: TaskRights = { ...none, work: true, manage: true, assign: true };
  const projectManager: TaskRights = { ...none, manage: true };
  const accountManager: TaskRights = { ...none, manage: true, assign: true, client: true };
  const state = (overrides: Partial<TaskState>): TaskState => ({
    status: 'new',
    assigneeId: ids.user,
    hasClient: true,
    needsClientApproval: true,
    blocked: false,
    ...overrides,
  });

  it('lets the assignee start, submit, resume, resubmit and deliver', () => {
    expect(allowedTaskTransitions(state({}), assignee)).toEqual(['in_progress']);
    expect(allowedTaskTransitions(state({ status: 'in_progress' }), assignee)).toEqual([
      'internal_review',
    ]);
    expect(allowedTaskTransitions(state({ status: 'revisions' }), assignee)).toEqual([
      'in_progress',
      'internal_review',
    ]);
    expect(allowedTaskTransitions(state({ status: 'approved' }), assignee)).toEqual(['delivered']);
    expect(allowedTaskTransitions(state({ status: 'internal_review' }), assignee)).toEqual([]);
    expect(allowedTaskTransitions(state({ status: 'delivered' }), assignee)).toEqual([]);
  });

  it('never starts an unassigned task (rule 2)', () => {
    expect(allowedTaskTransitions(state({ assigneeId: null }), departmentManager)).toEqual([
      'cancelled',
    ]);
  });

  it('lets only assign scope start a blocked task, even without working it (rule 3)', () => {
    expect(allowedTaskTransitions(state({ blocked: true }), accountManager)).toEqual([
      'in_progress',
      'cancelled',
    ]);
    expect(allowedTaskTransitions(state({}), accountManager)).toEqual(['cancelled']);
    expect(allowedTaskTransitions(state({ blocked: true }), assignee)).toEqual([]);
    expect(allowedTaskTransitions(state({ blocked: true }), departmentManager)).toEqual([
      'in_progress',
      'cancelled',
    ]);
  });

  it('sends to the client or approves directly by the approval flag', () => {
    const review = state({ status: 'internal_review' });
    expect(allowedTaskTransitions(review, projectManager)).toEqual([
      'awaiting_client',
      'revisions',
      'cancelled',
    ]);
    expect(
      allowedTaskTransitions({ ...review, needsClientApproval: false }, projectManager),
    ).toEqual(['revisions', 'approved', 'cancelled']);
  });

  it('leaves the client response to client scope', () => {
    const waiting = state({ status: 'awaiting_client' });
    expect(allowedTaskTransitions(waiting, departmentManager)).toEqual(['cancelled']);
    expect(allowedTaskTransitions(waiting, accountManager)).toEqual([
      'revisions',
      'approved',
      'cancelled',
    ]);
    expect(allowedTaskTransitions(state({ status: 'approved' }), accountManager)).toEqual([
      'revisions',
      'delivered',
      'cancelled',
    ]);
    expect(
      allowedTaskTransitions(state({ status: 'approved', hasClient: false }), accountManager),
    ).toEqual(['delivered', 'cancelled']);
  });

  it('reopens delivered tasks by the source: client scope to revisions, manage to work', () => {
    const delivered = state({ status: 'delivered' });
    expect(allowedTaskTransitions(delivered, projectManager)).toEqual(['in_progress']);
    expect(allowedTaskTransitions(delivered, accountManager)).toEqual(['in_progress', 'revisions']);
  });

  it('reopens a cancelled task to work, or to the queue when unassigned', () => {
    expect(allowedTaskTransitions(state({ status: 'cancelled' }), projectManager)).toEqual([
      'in_progress',
    ]);
    expect(
      allowedTaskTransitions(state({ status: 'cancelled', assigneeId: null }), projectManager),
    ).toEqual(['new']);
    expect(allowedTaskTransitions(state({ status: 'cancelled' }), assignee)).toEqual([]);
  });

  it('lets the creator withdraw their own unassigned request only while new (rule 13)', () => {
    const creator = { ...none, creator: true };
    expect(allowedTaskTransitions(state({ assigneeId: null }), creator)).toEqual(['cancelled']);
    expect(allowedTaskTransitions(state({}), creator)).toEqual([]);
    expect(
      canMakeTaskMove(state({ status: 'in_progress', assigneeId: null }), 'cancel', creator),
    ).toBe(false);
  });

  it('gives nothing without rights', () => {
    for (const status of TASK_STATUSES) {
      expect(allowedTaskTransitions(state({ status }), none), status).toEqual([]);
    }
  });
});

describe('isTaskBlocked (rule 3)', () => {
  it('blocks while a live dependency is not approved or delivered', () => {
    expect(isTaskBlocked([])).toBe(false);
    expect(isTaskBlocked([{ status: 'in_progress', archived: false }])).toBe(true);
    expect(isTaskBlocked([{ status: 'awaiting_client', archived: false }])).toBe(true);
    expect(isTaskBlocked([{ status: 'approved', archived: false }])).toBe(false);
    expect(
      isTaskBlocked([
        { status: 'delivered', archived: false },
        { status: 'new', archived: false },
      ]),
    ).toBe(true);
  });

  it('ignores cancelled and archived dependencies', () => {
    expect(isTaskBlocked([{ status: 'cancelled', archived: false }])).toBe(false);
    expect(isTaskBlocked([{ status: 'new', archived: true }])).toBe(false);
  });
});

describe('createsDependencyCycle (rule 4)', () => {
  const edges = new Map([
    ['b', ['c']],
    ['c', ['d']],
  ]);

  it('finds a direct or indirect loop back to the task', () => {
    expect(createsDependencyCycle('a', ['a'], edges)).toBe(true);
    expect(createsDependencyCycle('d', ['b'], edges)).toBe(true);
    expect(createsDependencyCycle('c', ['b'], edges)).toBe(true);
  });

  it('accepts chains and shared dependencies', () => {
    expect(createsDependencyCycle('a', ['b', 'c'], edges)).toBe(false);
    expect(createsDependencyCycle('e', ['d'], edges)).toBe(false);
  });

  it("ignores the task's own current edges", () => {
    expect(createsDependencyCycle('b', ['d'], edges)).toBe(false);
  });
});

describe('isTaskOverdue (rule 12)', () => {
  const due = { status: 'in_progress' as const, dueDate: '2026-10-05', dueTime: null };

  it('is overdue after the end of the due day in Damascus', () => {
    // 23:30 on the 5th in Damascus.
    expect(isTaskOverdue(due, new Date('2026-10-05T20:30:00Z'))).toBe(false);
    // 00:30 on the 6th in Damascus, still the 5th in UTC.
    expect(isTaskOverdue(due, new Date('2026-10-05T21:30:00Z'))).toBe(true);
  });

  it('is overdue after the due time when one is set', () => {
    const timed = { ...due, dueTime: '14:00' };
    expect(isTaskOverdue(timed, new Date('2026-10-05T10:59:00Z'))).toBe(false);
    expect(isTaskOverdue(timed, new Date('2026-10-05T11:01:00Z'))).toBe(true);
  });

  it('is never overdue once delivered or cancelled', () => {
    const late = new Date('2026-11-01T00:00:00Z');
    expect(isTaskOverdue({ ...due, status: 'delivered' }, late)).toBe(false);
    expect(isTaskOverdue({ ...due, status: 'cancelled' }, late)).toBe(false);
    expect(isTaskOverdue({ ...due, status: 'approved' }, late)).toBe(true);
  });
});

describe('taskStatusChangeSchema', () => {
  it('needs a reason to override dependencies', () => {
    expect(
      taskStatusChangeSchema.safeParse({ status: 'in_progress', overrideDependencies: true })
        .success,
    ).toBe(false);
    expect(
      taskStatusChangeSchema.parse({
        status: 'in_progress',
        overrideDependencies: true,
        reason: 'Client deadline',
      }).overrideDependencies,
    ).toBe(true);
  });

  it('keeps cancel reasons to 500 characters and revision notes to 2000', () => {
    expect(
      taskStatusChangeSchema.safeParse({ status: 'cancelled', note: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      taskStatusChangeSchema.safeParse({ status: 'revisions', note: 'x'.repeat(2000) }).success,
    ).toBe(true);
    expect(
      taskStatusChangeSchema.safeParse({ status: 'revisions', note: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });
});

describe('other inputs', () => {
  it('keeps each dependency once', () => {
    expect(taskDependenciesInputSchema.parse({ dependsOn: [ids.user, ids.user] })).toEqual({
      dependsOn: [ids.user],
    });
  });

  it('needs a reason for a free revision (rule 10)', () => {
    expect(revisionDecisionInputSchema.safeParse({ decision: 'free' }).success).toBe(false);
    expect(revisionDecisionInputSchema.safeParse({ decision: 'extra_work' }).success).toBe(true);
    expect(
      revisionDecisionInputSchema.safeParse({ decision: 'free', note: 'Our mistake' }).success,
    ).toBe(true);
  });

  it('lists open tasks by due date by default', () => {
    const query = taskListQuerySchema.parse({});
    expect(query.status).not.toContain('delivered');
    expect(query.status).not.toContain('cancelled');
    expect(query).toMatchObject({ sort: 'dueDate', order: 'asc', archived: false });
    expect(taskListQuerySchema.parse({ assigneeId: 'me' }).assigneeId).toBe('me');
    expect(taskListQuerySchema.safeParse({ assigneeId: 'someone' }).success).toBe(false);
    expect(taskListQuerySchema.parse({ department: 'design' }).department).toEqual(['design']);
  });
});

describe('mentionedUserIds', () => {
  it('lists each mentioned user once, in order, lowercased', () => {
    const body = `@{${ids.user.toUpperCase()}} please check with @{${ids.contact}} and @{${ids.user}}`;
    expect(mentionedUserIds(body)).toEqual([ids.user, ids.contact]);
  });

  it('ignores text that only looks like a mention', () => {
    expect(mentionedUserIds('@{not-a-uuid} @name {x}')).toEqual([]);
  });
});

describe('commentExcerpt', () => {
  const names = new Map([[ids.user, 'Rana']]);
  const nameOf = (id: string) => names.get(id) ?? '';

  it('shows mentions by name and collapses whitespace', () => {
    const body = `@{${ids.user.toUpperCase()}}  please
check`;
    expect(commentExcerpt(body, nameOf)).toBe('@Rana please check');
  });

  it('cuts long comments to 140 characters with an ellipsis', () => {
    const excerpt = commentExcerpt('a'.repeat(200), nameOf);
    expect(excerpt).toHaveLength(140);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('taskCommentInputSchema', () => {
  it('trims the body and keeps line breaks', () => {
    expect(taskCommentInputSchema.parse({ body: '  Line one\nLine two ' })).toEqual({
      body: 'Line one\nLine two',
    });
  });

  it('refuses an empty or too long body', () => {
    expect(taskCommentInputSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(taskCommentInputSchema.safeParse({ body: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('refuses more than 20 mentioned people', () => {
    const mention = (n: number) => `@{01a0e97d-0028-7d46-8479-${String(n).padStart(12, '0')}}`;
    const body = (count: number) => Array.from({ length: count }, (_, n) => mention(n)).join(' ');
    expect(taskCommentInputSchema.safeParse({ body: body(20) }).success).toBe(true);
    expect(taskCommentInputSchema.safeParse({ body: body(21) }).success).toBe(false);
  });
});

describe('checklist inputs', () => {
  it('trims item text and limits it to 200 characters', () => {
    expect(createTaskChecklistItemSchema.parse({ text: ' Crop ' })).toEqual({ text: 'Crop' });
    expect(createTaskChecklistItemSchema.safeParse({ text: 'x'.repeat(201) }).success).toBe(false);
    expect(updateTaskChecklistItemSchema.parse({ done: true })).toEqual({ done: true });
  });
});

describe('views', () => {
  it('shows every status but cancelled on the board', () => {
    expect(BOARD_STATUSES).toEqual(TASK_STATUSES.filter((status) => status !== 'cancelled'));
  });

  it('takes one or several departments', () => {
    expect(taskBoardQuerySchema.parse({ department: 'design' })).toEqual({
      department: ['design'],
    });
    expect(taskWorkloadQuerySchema.parse({ department: ['design', 'content_management'] })).toEqual(
      { department: ['design', 'content_management'] },
    );
    expect(taskWorkloadQuerySchema.safeParse({ week: '2026-13-01' }).success).toBe(false);
  });

  it('filters the list by what the caller may review', () => {
    expect(taskListQuerySchema.parse({ reviewer: 'me' })).toMatchObject({ reviewer: 'me' });
    expect(taskListQuerySchema.safeParse({ reviewer: ids.user }).success).toBe(false);
  });
});
