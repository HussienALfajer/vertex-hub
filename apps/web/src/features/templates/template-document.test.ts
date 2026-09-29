import type { TemplateStep } from '@vertex-hub/contracts';
import { describe, expect, it } from 'vitest';
import {
  dependencyOptions,
  laterDependencies,
  moveStage,
  orderSteps,
  type StageValues,
  type StepValues,
  stageMilestones,
  withoutStage,
  withoutStep,
  withStep,
} from './template-document';

const stages: StageValues[] = [
  { key: 'discovery', name: 'Discovery' },
  { key: 'design', name: 'Design' },
];

const step = (key: string, extra: Partial<StepValues> = {}): StepValues => ({
  key,
  title: key,
  department: 'design',
  stageKey: null,
  dependsOn: [],
  ...extra,
});

const keys = (steps: StepValues[]) => steps.map((s) => s.key);

describe('orderSteps', () => {
  it('lists project steps by stage, steps without a stage last, keeping their order', () => {
    const steps = [
      step('loose'),
      step('b', { stageKey: 'design' }),
      step('a', { stageKey: 'discovery' }),
      step('c', { stageKey: 'design' }),
    ];
    expect(keys(orderSteps('project', stages, steps))).toEqual(['a', 'b', 'c', 'loose']);
  });

  it('lists fixed monthly steps before repeated ones', () => {
    const steps = [step('design', { repeatKind: 'design' }), step('plan'), step('report')];
    expect(keys(orderSteps('retainer_cycle', [], steps))).toEqual(['plan', 'report', 'design']);
  });
});

describe('withStep', () => {
  const steps = [
    step('a', { stageKey: 'discovery' }),
    step('b', { stageKey: 'design' }),
    step('c', { stageKey: 'design' }),
  ];

  it('adds a new step last in its group', () => {
    expect(keys(withStep('project', stages, steps, step('n', { stageKey: 'discovery' })))).toEqual([
      'a',
      'n',
      'b',
      'c',
    ]);
  });

  it('keeps an edited step in place, or moves it to the end of its new group', () => {
    expect(keys(withStep('project', stages, steps, step('b', { stageKey: 'design' })))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(keys(withStep('project', stages, steps, step('b', { stageKey: 'discovery' })))).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(keys(withStep('project', stages, steps, step('a', { stageKey: 'design' })))).toEqual([
      'b',
      'c',
      'a',
    ]);
  });
});

describe('dependencyOptions', () => {
  it('offers the steps listed before the step once placed', () => {
    const steps = [step('a', { stageKey: 'discovery' }), step('b', { stageKey: 'design' })];
    expect(
      keys(dependencyOptions('project', stages, steps, step('b', { stageKey: 'design' }))),
    ).toEqual(['a']);
    expect(keys(dependencyOptions('project', stages, steps, step('n')))).toEqual(['a', 'b']);
    expect(
      keys(dependencyOptions('project', stages, steps, step('n', { stageKey: 'discovery' }))),
    ).toEqual(['a']);
  });

  it('never offers a repeated monthly step (rule 2)', () => {
    const steps = [step('plan'), step('design', { repeatKind: 'design' })];
    expect(
      keys(dependencyOptions('retainer_cycle', [], steps, step('reel', { repeatKind: 'reel' }))),
    ).toEqual(['plan']);
  });
});

describe('removing and moving', () => {
  it('removes a step and the dependencies on it', () => {
    const steps = [step('a'), step('b', { dependsOn: ['a'] })];
    expect(withoutStep(steps, 'a')).toEqual([step('b', { dependsOn: [] })]);
  });

  it('keeps the steps of a removed stage, without a stage and listed last', () => {
    const steps = [step('a', { stageKey: 'discovery' }), step('b', { stageKey: 'design' })];
    const result = withoutStage(stages, steps, 'discovery');
    expect(result.stages).toEqual([stages[1]]);
    expect(result.steps.map((s) => [s.key, s.stageKey])).toEqual([
      ['b', 'design'],
      ['a', null],
    ]);
  });

  it('moves a stage with its steps', () => {
    const steps = [step('a', { stageKey: 'discovery' }), step('b', { stageKey: 'design' })];
    const result = moveStage(stages, steps, 1, 0);
    expect(result.stages.map((s) => s.key)).toEqual(['design', 'discovery']);
    expect(keys(result.steps)).toEqual(['b', 'a']);
  });

  it('finds dependencies a move put after the step', () => {
    const steps = [step('b', { dependsOn: ['a'] }), step('a')];
    expect(laterDependencies(steps, 0)).toEqual(['a']);
    expect(laterDependencies(steps, 1)).toEqual([]);
  });
});

describe('stageMilestones', () => {
  const detailStep = (id: string, stageId: string | null, dueDay: number): TemplateStep => ({
    id,
    stageId,
    position: 1,
    title: id,
    brief: null,
    department: 'design',
    dueDay,
    priority: 'normal',
    needsClientApproval: true,
    revisionLimit: 2,
    checklist: [],
    repeatKind: null,
    repeatLabel: null,
    spreadFromDay: null,
    dependsOn: [],
  });

  it('keeps stages with steps, in stage order, due on their latest work day', () => {
    const template = {
      stages: [
        { id: 'b', name: 'Design', position: 2 },
        { id: 'a', name: 'Discovery', position: 1 },
        { id: 'c', name: 'Empty', position: 3 },
      ],
      steps: [
        detailStep('s1', 'a', 3),
        detailStep('s2', 'a', 5),
        detailStep('s3', 'b', 7),
        detailStep('s4', null, 40),
      ],
    };
    // 2026-10-03 is a Saturday: work day 5 is Wednesday 10-07, work day 7 skips Friday 10-09.
    expect(stageMilestones(template, '2026-10-03')).toEqual([
      { name: 'Discovery', dueDate: '2026-10-07', installmentMinor: null },
      { name: 'Design', dueDate: '2026-10-10', installmentMinor: null },
    ]);
  });
});
