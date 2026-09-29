import {
  type CalendarDate,
  type CreateMilestoneInput,
  type CreateTemplateInput,
  nthWorkDay,
  type TemplateDetail,
  type TemplateKind,
} from '@vertex-hub/contracts';

/*
 * The template being edited, as one document (spec F07, screen 2): the order of `steps` is their
 * position, so steps stay grouped the way the page lists them. Project templates list steps by
 * stage, steps without a stage last; monthly templates list fixed steps, then repeated ones. Since
 * dependencies point to earlier steps only (rule 2), keeping that order keeps the list and the
 * saved positions the same.
 */

export type TemplateFormValues = CreateTemplateInput;

export type StageValues = NonNullable<TemplateFormValues['stages']>[number];

export type StepValues = TemplateFormValues['steps'][number];

/** A key for a new stage or step; the API keeps rows whose key is an existing id. */
export function newKey(): string {
  return `new-${crypto.randomUUID()}`;
}

/** The group a step is listed in: its stage's index (no stage last), or fixed (0) / repeated (1). */
export function stepGroup(kind: TemplateKind, stages: StageValues[], step: StepValues): number {
  if (kind === 'retainer_cycle') return step.repeatKind ? 1 : 0;
  const index = stages.findIndex((stage) => stage.key === step.stageKey);
  return index === -1 ? stages.length : index;
}

/** The steps in list order: by group, keeping their order within a group. */
export function orderSteps(
  kind: TemplateKind,
  stages: StageValues[],
  steps: StepValues[],
): StepValues[] {
  return steps
    .map((step, index) => ({ step, index, group: stepGroup(kind, stages, step) }))
    .sort((a, b) => a.group - b.group || a.index - b.index)
    .map(({ step }) => step);
}

/** Moves an item to another index. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Removes a step and every dependency on it. */
export function withoutStep(steps: StepValues[], key: string): StepValues[] {
  return steps
    .filter((step) => step.key !== key)
    .map((step) => ({
      ...step,
      dependsOn: (step.dependsOn ?? []).filter((other) => other !== key),
    }));
}

/** Removes a stage; its steps stay, without a stage. */
export function withoutStage(
  stages: StageValues[],
  steps: StepValues[],
  key: string,
): { stages: StageValues[]; steps: StepValues[] } {
  const rest = stages.filter((stage) => stage.key !== key);
  const moved = steps.map((step) => (step.stageKey === key ? { ...step, stageKey: null } : step));
  return { stages: rest, steps: orderSteps('project', rest, moved) };
}

/** Moves a stage; its steps move with it. */
export function moveStage(
  stages: StageValues[],
  steps: StepValues[],
  from: number,
  to: number,
): { stages: StageValues[]; steps: StepValues[] } {
  const next = moveItem(stages, from, to);
  return { stages: next, steps: orderSteps('project', next, steps) };
}

/**
 * Puts a new or edited step into the document at its place in the list: an edited step keeps its
 * place in its group (or joins the end of a new group), a new one goes last in its group.
 */
export function withStep(
  kind: TemplateKind,
  stages: StageValues[],
  steps: StepValues[],
  step: StepValues,
): StepValues[] {
  const index = steps.findIndex((other) => other.key === step.key);
  if (index === -1) return orderSteps(kind, stages, [...steps, step]);
  const before = stepGroup(kind, stages, steps[index] as StepValues);
  const after = stepGroup(kind, stages, step);
  const next =
    before === after
      ? steps.map((other) => (other.key === step.key ? step : other))
      : [...steps.filter((other) => other.key !== step.key), step];
  return orderSteps(kind, stages, next);
}

/**
 * The steps a step may wait on once placed (rule 2): those listed before it, never a repeated step
 * of a monthly template.
 */
export function dependencyOptions(
  kind: TemplateKind,
  stages: StageValues[],
  steps: StepValues[],
  step: StepValues,
): StepValues[] {
  const placed = withStep(kind, stages, steps, step);
  const index = placed.findIndex((other) => other.key === step.key);
  return placed.slice(0, index).filter((other) => !(kind === 'retainer_cycle' && other.repeatKind));
}

/** Dependencies of a step that no longer come before it (after a move), by key. */
export function laterDependencies(steps: StepValues[], index: number): string[] {
  const earlier = new Set(steps.slice(0, index).map((step) => step.key));
  return (steps[index]?.dependsOn ?? []).filter((key) => !earlier.has(key));
}

/** A stored template as the form edits it: every key is the row's id. */
export function templateFormValues(template: TemplateDetail): TemplateFormValues {
  return {
    kind: template.kind,
    name: template.name,
    description: template.description ?? '',
    stages: template.stages.map((stage) => ({ key: stage.id, name: stage.name })),
    steps: template.steps.map((step) => ({
      key: step.id,
      stageKey: step.stageId,
      title: step.title,
      brief: step.brief,
      department: step.department,
      dueDay: step.dueDay,
      priority: step.priority,
      needsClientApproval: step.needsClientApproval,
      revisionLimit: step.revisionLimit,
      checklist: step.checklist,
      repeatKind: step.repeatKind,
      repeatLabel: step.repeatLabel,
      spreadFromDay: step.spreadFromDay,
      dependsOn: step.dependsOn,
    })),
    assignees: template.assignees.map(({ department, user }) => ({ department, userId: user.id })),
  };
}

/**
 * The new project form's milestones for a project template (spec screen 4): each stage used by a
 * step, in stage order, due on the latest due date of its steps counted from `start` (rule 7).
 */
export function stageMilestones(
  template: Pick<TemplateDetail, 'stages' | 'steps'>,
  start: CalendarDate,
): CreateMilestoneInput[] {
  return [...template.stages]
    .sort((a, b) => a.position - b.position)
    .flatMap((stage) => {
      const dates = template.steps
        .filter((step) => step.stageId === stage.id)
        .map((step) => nthWorkDay(start, step.dueDay ?? 1))
        .sort();
      const due = dates.at(-1);
      return due ? [{ name: stage.name, dueDate: due, installmentMinor: null }] : [];
    });
}
