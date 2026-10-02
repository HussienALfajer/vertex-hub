import { describe, expect, it } from 'vitest';
import { workDaysBetween } from './dates.js';
import type { DeliverableKind } from './retainers.js';
import {
  type CreateTemplateInput,
  createTemplateSchema,
  cycleLastWorkDay,
  type PlanCycleLine,
  planTemplateRun,
  type TemplateStep,
  templateIssues,
  templateListQuerySchema,
  templateRunInputSchema,
  updateTemplateSchema,
} from './templates.js';

const projectTemplate: CreateTemplateInput = {
  name: ' Website ',
  kind: 'project',
  stages: [
    { key: 's1', name: 'Discovery' },
    { key: 's2', name: 'Design' },
  ],
  steps: [
    { key: 'a', stageKey: 's1', title: 'Requirements', department: 'development', dueDay: 3 },
    {
      key: 'b',
      stageKey: 's2',
      title: 'Wireframes',
      department: 'design',
      dueDay: 8,
      dependsOn: ['a', 'a'],
    },
    { key: 'c', title: 'Kick-off', department: 'marketing', dueDay: 1 },
  ],
  assignees: [{ department: 'design', userId: '0190a3c2-0000-7000-8000-000000000001' }],
};

const monthlyTemplate: CreateTemplateInput = {
  name: 'Monthly social media',
  kind: 'retainer_cycle',
  steps: [
    { key: 'plan', title: 'Content plan', department: 'content_management', dueDay: 3 },
    {
      key: 'design',
      title: 'Design',
      department: 'design',
      repeatKind: 'design',
      spreadFromDay: 4,
      dependsOn: ['plan'],
    },
    {
      key: 'other',
      title: 'Blog',
      department: 'content_management',
      repeatKind: 'other',
      repeatLabel: 'Blog',
    },
  ],
};

const paths = (input: CreateTemplateInput) => {
  const result = createTemplateSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('template input (F07 rules 1–3)', () => {
  it('accepts a project template and fills the task defaults', () => {
    const template = createTemplateSchema.parse(projectTemplate);
    expect(template.name).toBe('Website');
    expect(template.steps[1]).toMatchObject({
      priority: 'normal',
      needsClientApproval: true,
      revisionLimit: 2,
      checklist: [],
      brief: null,
      repeatKind: null,
      dependsOn: ['a'],
    });
    expect(template.steps[2]?.stageKey).toBeNull();
  });

  it('accepts a monthly template with fixed and repeated steps', () => {
    expect(paths(monthlyTemplate)).toEqual([]);
  });

  it('needs at least one step', () => {
    expect(paths({ ...projectTemplate, steps: [], assignees: [] })).toEqual(['steps']);
  });

  it('keeps stages, due days past 27 and stage links to project templates', () => {
    expect(
      paths({
        ...monthlyTemplate,
        stages: [{ key: 's1', name: 'Month' }],
        steps: [{ key: 'a', stageKey: 's1', title: 'Plan', department: 'design', dueDay: 28 }],
      }),
    ).toEqual(['stages.0', 'steps.0.stageKey', 'steps.0.dueDay']);
  });

  it('keeps repeated steps to monthly templates', () => {
    expect(
      paths({
        ...projectTemplate,
        steps: [
          {
            key: 'a',
            title: 'Design',
            department: 'design',
            dueDay: 2,
            repeatKind: 'design',
            spreadFromDay: 2,
          },
        ],
        assignees: [],
      }),
    ).toEqual(['steps.0.repeatKind', 'steps.0.spreadFromDay']);
  });

  it('needs a due day on fixed steps and none on repeated steps', () => {
    expect(
      paths({
        ...monthlyTemplate,
        steps: [
          { key: 'a', title: 'Plan', department: 'design' },
          { key: 'b', title: 'Design', department: 'design', repeatKind: 'design', dueDay: 3 },
        ],
      }),
    ).toEqual(['steps.0.dueDay', 'steps.1.dueDay']);
  });

  it('needs a label with the kind "other" only, and one repeated step per line kind', () => {
    expect(
      paths({
        ...monthlyTemplate,
        steps: [
          { key: 'a', title: 'Other', department: 'design', repeatKind: 'other' },
          {
            key: 'b',
            title: 'Design',
            department: 'design',
            repeatKind: 'design',
            repeatLabel: 'X',
          },
          { key: 'c', title: 'Design again', department: 'design', repeatKind: 'design' },
          {
            key: 'd',
            title: 'Blog',
            department: 'design',
            repeatKind: 'other',
            repeatLabel: 'Blog',
          },
          {
            key: 'e',
            title: 'Blog',
            department: 'design',
            repeatKind: 'other',
            repeatLabel: 'blog',
          },
        ],
      }),
    ).toEqual([
      'steps.0.repeatLabel',
      'steps.1.repeatLabel',
      'steps.2.repeatKind',
      'steps.4.repeatKind',
    ]);
  });

  it('lets steps depend on earlier steps only', () => {
    expect(
      paths({
        ...projectTemplate,
        steps: [
          { key: 'a', title: 'A', department: 'design', dueDay: 1, dependsOn: ['b'] },
          { key: 'b', title: 'B', department: 'design', dueDay: 2, dependsOn: ['b', 'x'] },
        ],
        assignees: [],
      }),
    ).toEqual(['steps.0.dependsOn.0', 'steps.1.dependsOn.0', 'steps.1.dependsOn.1']);
  });

  it('refuses any monthly step waiting on a repeated step', () => {
    expect(
      paths({
        ...monthlyTemplate,
        steps: [
          { key: 'design', title: 'Design', department: 'design', repeatKind: 'design' },
          {
            key: 'report',
            title: 'Report',
            department: 'marketing',
            dueDay: 27,
            dependsOn: ['design'],
          },
          {
            key: 'story',
            title: 'Story',
            department: 'design',
            repeatKind: 'story',
            dependsOn: ['report', 'design'],
          },
        ],
      }),
    ).toEqual(['steps.1.dependsOn.0', 'steps.2.dependsOn.1']);
  });

  it('caps dependencies at 10 per step', () => {
    const dependsOn = Array.from({ length: 11 }, (_, i) => `k${i}`);
    const issues = paths({
      ...projectTemplate,
      steps: [{ key: 'a', title: 'A', department: 'design', dueDay: 1, dependsOn }],
    });
    expect(issues[0]).toBe('steps.0.dependsOn');
  });

  it('refuses duplicate keys and stage names', () => {
    expect(
      paths({
        ...projectTemplate,
        stages: [
          { key: 's1', name: 'Design' },
          { key: 's1', name: 'design ' },
        ],
        steps: [
          { key: 'a', title: 'A', department: 'design', dueDay: 1 },
          { key: 'a', title: 'B', department: 'design', dueDay: 2 },
        ],
        assignees: [],
      }),
    ).toEqual(['stages.1.key', 'stages.1.name', 'steps.1.key']);
  });

  it('takes default assignees only for departments the steps use, once each', () => {
    const userId = '0190a3c2-0000-7000-8000-000000000001';
    expect(
      paths({
        ...projectTemplate,
        assignees: [
          { department: 'design', userId },
          { department: 'design', userId },
          { department: 'photography', userId },
        ],
      }),
    ).toEqual(['assignees.1.department', 'assignees.2.department']);
  });

  it('checks a replaced template against the stored kind', () => {
    const doc = updateTemplateSchema.parse({ ...monthlyTemplate, kind: undefined });
    expect(templateIssues('retainer_cycle', doc)).toEqual([]);
    expect(templateIssues('project', doc).map((issue) => issue.path.join('.'))).toEqual([
      'steps.1.repeatKind',
      'steps.1.spreadFromDay',
      'steps.1.dueDay',
      'steps.2.repeatKind',
      'steps.2.dueDay',
    ]);
  });
});

describe('template list query', () => {
  it('lists non-archived templates by name by default', () => {
    expect(templateListQuerySchema.parse({})).toMatchObject({
      archived: false,
      sort: 'name',
      order: 'asc',
    });
    expect(templateListQuerySchema.parse({ kind: 'project', archived: 'true' })).toMatchObject({
      kind: 'project',
      archived: true,
    });
  });
});
// October 2026: Fridays are the 2nd, 9th, 16th, 23rd and 30th; the 31st is a Saturday.

const uuid = (n: number) => `0190a3c2-0000-7000-8000-${String(n).padStart(12, '0')}`;

const step = (fields: Partial<TemplateStep> & Pick<TemplateStep, 'id' | 'title'>) =>
  ({
    stageId: null,
    position: 1,
    brief: null,
    department: 'design',
    dueDay: null,
    priority: 'normal',
    needsClientApproval: true,
    revisionLimit: 2,
    checklist: [],
    repeatKind: null,
    repeatLabel: null,
    spreadFromDay: null,
    dependsOn: [],
    ...fields,
  }) satisfies TemplateStep;

const designer = { id: uuid(101), name: 'Designer' };
const marketer = { id: uuid(102), name: 'Marketer' };
const members = new Set([`${designer.id}:design`]);
const isMember = (userId: string, department: string) => members.has(`${userId}:${department}`);

describe('planTemplateRun: project runs (rules 7, 10, 13)', () => {
  const stages = [
    { id: uuid(1), name: 'Discovery', position: 1 },
    { id: uuid(2), name: 'Design', position: 2 },
    { id: uuid(3), name: 'Unused', position: 3 },
  ];
  const steps = [
    step({ id: uuid(11), title: 'Brief', stageId: uuid(1), dueDay: 1, department: 'marketing' }),
    step({ id: uuid(12), title: 'Moodboard', stageId: uuid(2), dueDay: 2, dependsOn: [uuid(11)] }),
    step({ id: uuid(13), title: 'Kick-off', dueDay: 3, department: 'marketing' }),
    step({ id: uuid(14), title: 'Logo', stageId: uuid(2), dueDay: 7, dependsOn: [uuid(12)] }),
  ];
  const plan = planTemplateRun({
    template: { stages, steps },
    target: {
      type: 'project',
      startDate: '2026-10-01',
      dueDate: '2026-10-05',
      milestones: [
        { id: uuid(21), name: 'Design', position: 1, status: 'done' },
        { id: uuid(22), name: ' discovery ', position: 2, status: 'pending' },
        { id: uuid(23), name: 'Discovery', position: 3, status: 'pending' },
      ],
      earlierRuns: 2,
    },
    assignees: [
      { department: 'design', user: designer },
      { department: 'marketing', user: marketer },
    ],
    isMember,
  });

  it('counts due days in work days, skipping Fridays', () => {
    expect(plan.tasks.map((task) => task.dueDate)).toEqual([
      '2026-10-01',
      '2026-10-03',
      '2026-10-04',
      '2026-10-08',
    ]);
    expect(plan.startDate).toBe('2026-10-01');
    expect(plan.taskCount).toBe(4);
  });

  it('maps stages to the first pending milestone of the same name, else a new one', () => {
    expect(plan.tasks.map((task) => task.milestone)).toEqual([
      { existingId: uuid(22), name: 'Discovery' },
      { existingId: null, name: 'Design' },
      null,
      { existingId: null, name: 'Design' },
    ]);
    // A done milestone is not reused; stages without steps are ignored.
    expect(plan.milestonesToCreate).toEqual([{ name: 'Design', dueDate: '2026-10-08' }]);
  });

  it('keeps dependencies by step and copies the step fields', () => {
    expect(plan.tasks[3]).toMatchObject({
      key: uuid(14),
      stepId: uuid(14),
      instance: null,
      title: 'Logo',
      dependsOn: [uuid(12)],
      priority: 'normal',
      needsClientApproval: true,
      revisionLimit: 2,
      cycleLineId: null,
    });
  });

  it('replaces every revision limit with the run override (F04 A4)', () => {
    const overridden = planTemplateRun({
      template: { stages, steps },
      target: {
        type: 'project',
        startDate: '2026-10-01',
        dueDate: '2026-12-31',
        milestones: [],
        earlierRuns: 0,
      },
      assignees: [],
      isMember,
      revisionLimit: 0,
    });
    expect(overridden.tasks.map((task) => task.revisionLimit)).toEqual([0, 0, 0, 0]);
  });

  it('replaces an assignee who left the department with the queue, and warns', () => {
    expect(plan.tasks.map((task) => [task.assignee?.id ?? null, task.assigneeReplaced])).toEqual([
      [null, true],
      [designer.id, false],
      [null, true],
      [designer.id, false],
    ]);
    expect(plan.warnings).toEqual([
      { type: 'due_after_project', department: null, count: 1 },
      { type: 'applied_before', department: null, count: 2 },
      { type: 'assignee_replaced', department: 'marketing', count: 2 },
    ]);
  });
});

describe('planTemplateRun: cycle runs (rules 8, 9, 12, 14)', () => {
  const plan = step({ id: uuid(31), title: 'Content plan', dueDay: 3 });
  const late = step({ id: uuid(32), title: 'Report', dueDay: 27 });
  const design = step({
    id: uuid(33),
    title: 'Design',
    repeatKind: 'design',
    spreadFromDay: 4,
    dependsOn: [uuid(31)],
  });
  const blog = step({ id: uuid(34), title: 'Blog', repeatKind: 'other', repeatLabel: 'Blog' });
  const reel = step({ id: uuid(35), title: 'Reel', repeatKind: 'reel', spreadFromDay: 1 });
  const line = (
    n: number,
    committed: number,
    kind: DeliverableKind = 'design',
    label: string | null = null,
    revisionLimit: number | null = null,
  ) => ({
    id: uuid(n),
    kind,
    label,
    committed,
    revisionLimit,
  });
  const run = (lines: PlanCycleLine[], startDate = '2026-10-01', periodEnd = '2026-10-31') =>
    planTemplateRun({
      template: { stages: [], steps: [plan, late, design, blog, reel] },
      target: { type: 'cycle', startDate, periodEnd, lines },
      assignees: [{ department: 'design', user: designer }],
      isMember,
    });
  const designDates = (committed: number) =>
    run([line(41, committed)])
      .tasks.filter((task) => task.cycleLineId)
      .map((task) => task.dueDate);
  /** Work days from day 4 (the 5th) to the last work day (the 31st): 23 days. */
  const spread = workDaysBetween('2026-10-05', '2026-10-31');

  it('dates fixed steps by work day, clamped to the last work day', () => {
    const tasks = run([]).tasks;
    expect(tasks.map((task) => [task.title, task.dueDate])).toEqual([
      ['Content plan', '2026-10-04'],
      ['Report', '2026-10-31'],
    ]);
  });

  it('spreads repeated instances evenly, the last on the last work day', () => {
    expect(spread).toHaveLength(23);
    expect(designDates(23)).toEqual(spread);
    const five = designDates(5);
    expect(five).toEqual([spread[4], spread[9], spread[13], spread[18], spread[22]]);
    expect(designDates(1)).toEqual(['2026-10-31']);
    const many = designDates(46);
    expect(many).toHaveLength(46);
    expect(new Set(many).size).toBe(23);
    expect(many.at(-1)).toBe('2026-10-31');
  });

  it('puts every instance on the last work day when the spread range is empty', () => {
    const tasks = run([line(41, 3)], '2026-10-29').tasks.filter((task) => task.cycleLineId);
    expect(tasks.map((task) => task.dueDate)).toEqual(['2026-10-31', '2026-10-31', '2026-10-31']);
  });

  it('numbers instances, links them to the line and to the fixed tasks they wait on', () => {
    const tasks = run([line(41, 2), line(42, 1, 'other', 'blog')]).tasks;
    expect(
      tasks.map((task) => [task.key, task.title, task.cycleLineId, task.instance, task.dependsOn]),
    ).toEqual([
      [uuid(31), 'Content plan', null, null, []],
      [uuid(32), 'Report', null, null, []],
      [`${uuid(33)}:1`, 'Design 1', uuid(41), 1, [uuid(31)]],
      [`${uuid(33)}:2`, 'Design 2', uuid(41), 2, [uuid(31)]],
      [`${uuid(34)}:1`, 'Blog 1', uuid(42), 1, []],
    ]);
  });

  it('keeps only dependencies on tasks of the run', () => {
    const waiting = step({ ...reel, dependsOn: [uuid(31), uuid(33)] });
    const tasks = planTemplateRun({
      template: { stages: [], steps: [plan, design, waiting] },
      target: {
        type: 'cycle',
        startDate: '2026-10-01',
        periodEnd: '2026-10-31',
        lines: [line(41, 1), line(42, 1, 'reel')],
      },
      assignees: [],
      isMember,
    }).tasks;
    expect(tasks.find((task) => task.title === 'Reel 1')?.dependsOn).toEqual([uuid(31)]);
  });

  it('skips lines without a repeated step, steps without a line and committed 0', () => {
    const tasks = run([line(41, 0), line(42, 3, 'story'), line(43, 2, 'other', 'Vlog')]).tasks;
    expect(tasks.map((task) => task.title)).toEqual(['Content plan', 'Report']);
  });

  it('stops at 300 tasks and warns with the instances left out', () => {
    const capped = run([line(41, 250), line(42, 60, 'reel')]);
    expect(capped.taskCount).toBe(300);
    expect(capped.tasks.filter((task) => task.cycleLineId === uuid(42))).toHaveLength(48);
    expect(capped.warnings).toContainEqual({ type: 'over_cap', department: null, count: 12 });
  });

  it("gives a line's instances its revision limit when set (F04)", () => {
    const tasks = run([line(41, 1, 'design', null, 5), line(42, 1, 'reel')]).tasks;
    expect(tasks.map((task) => [task.title, task.revisionLimit])).toEqual([
      ['Content plan', 2],
      ['Report', 2],
      ['Design 1', 5],
      ['Reel 1', 2],
    ]);
  });

  it('ends a period that ends on a Friday on the Thursday before', () => {
    expect(cycleLastWorkDay('2026-10-01', '2026-10-30')).toBe('2026-10-29');
    expect(cycleLastWorkDay('2026-10-30', '2026-10-30')).toBe('2026-10-30');
    expect(run([], '2026-10-01', '2026-10-30').tasks[1]?.dueDate).toBe('2026-10-29');
  });
});

describe('planTemplateRun: missing tasks (rule 18)', () => {
  const design = step({
    id: uuid(51),
    title: 'Design',
    repeatKind: 'design',
    spreadFromDay: 4,
    dependsOn: [uuid(50)],
  });
  const missing = (count: number) =>
    planTemplateRun({
      template: { stages: [], steps: [step({ id: uuid(50), title: 'Plan', dueDay: 1 }), design] },
      target: {
        type: 'missing',
        startDate: '2026-10-20',
        periodEnd: '2026-10-31',
        line: { id: uuid(61), kind: 'design', label: null, committed: 14, revisionLimit: null },
        existing: 12,
        missing: count,
      },
      assignees: [],
      isMember,
    });

  it('numbers after the existing tasks, spreads from the start, adds no dependencies', () => {
    expect(
      missing(2).tasks.map((task) => [task.title, task.dueDate, task.dependsOn, task.assignee]),
    ).toEqual([
      ['Design 13', '2026-10-25', [], null],
      ['Design 14', '2026-10-31', [], null],
    ]);
  });

  it('caps a large gap at 300 tasks', () => {
    const plan = missing(320);
    expect(plan.taskCount).toBe(300);
    expect(plan.warnings).toEqual([{ type: 'over_cap', department: null, count: 20 }]);
  });
});

describe('template run input', () => {
  it('needs exactly one target, a start date for projects only and one entry per department', () => {
    expect(templateRunInputSchema.safeParse({ projectId: uuid(1) }).success).toBe(true);
    expect(templateRunInputSchema.safeParse({}).success).toBe(false);
    expect(
      templateRunInputSchema.safeParse({ projectId: uuid(1), retainerCycleId: uuid(2) }).success,
    ).toBe(false);
    expect(
      templateRunInputSchema.safeParse({ retainerCycleId: uuid(2), startDate: '2026-10-01' })
        .success,
    ).toBe(false);
    expect(templateRunInputSchema.safeParse({ projectId: uuid(1), revisionLimit: 3 }).success).toBe(
      true,
    );
    expect(
      templateRunInputSchema.safeParse({ retainerCycleId: uuid(2), revisionLimit: 3 }).success,
    ).toBe(false);
    expect(
      templateRunInputSchema.safeParse({
        projectId: uuid(1),
        assignees: [
          { department: 'design', userId: null },
          { department: 'design', userId: uuid(3) },
        ],
      }).success,
    ).toBe(false);
  });
});
