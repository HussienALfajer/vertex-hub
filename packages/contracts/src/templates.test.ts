import { describe, expect, it } from 'vitest';
import {
  type CreateTemplateInput,
  createTemplateSchema,
  templateIssues,
  templateListQuerySchema,
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

  it('refuses a fixed monthly step waiting on a repeated step', () => {
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
            dependsOn: ['report'],
          },
        ],
      }),
    ).toEqual(['steps.1.dependsOn.0']);
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
