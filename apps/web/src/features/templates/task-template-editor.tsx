import {
  type DepartmentCode,
  departmentBriefFields,
  keepsBriefFields,
  SUBTASK_LIMITS,
  SUBTASK_RUN_MODES,
  type SubtaskRunMode,
  TASK_LIMITS,
  TASK_PRIORITIES,
  TEMPLATE_LIMITS,
  taskBriefDocSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  type RichTextDoc,
  RichTextEditor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ListPlusIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { BriefFieldsEditor } from '../tasks/brief-fields-editor';
import { EstimateInput, ItemsEditor, useDepartments } from '../tasks/task-form';
import { useRichTextLabels } from '../tasks/task-rich-text';
import { moveItem, newKey, type StageValues, type StepValues } from './template-document';
import type { TemplateFormMethods } from './template-editor';

/*
 * F06B rule D3: the editor of a `task` template: the root step (the task) and its sub-steps (the
 * subtasks), how they run, their stages and order. Editing a template never changes tasks
 * already created.
 */

const change = (form: TemplateFormMethods) =>
  ({ shouldDirty: true, shouldValidate: form.formState.isSubmitted }) as const;

export function TaskTemplateSteps({
  form,
  readOnly,
}: {
  form: TemplateFormMethods;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const [runMode, stages = [], steps] = useWatch({
    control: form.control,
    name: ['runMode', 'stages', 'steps'],
  });
  const [editing, setEditing] = useState<StepValues | null>(null);
  const [root, ...subSteps] = steps;
  const mode = runMode ?? 'sequential';
  const errors = form.formState.errors;
  const full = subSteps.length >= TEMPLATE_LIMITS.subSteps;

  const setSteps = (next: StepValues[]) => form.setValue('steps', next, change(form));
  const setStages = (next: StageValues[]) => form.setValue('stages', next, change(form));
  const setMode = (next: SubtaskRunMode) => {
    form.setValue('runMode', next, change(form));
    if (next === 'stages') {
      const first = stages[0] ?? { key: newKey(), name: t('tasks.wizard.subtasks.firstStage') };
      if (stages.length === 0) setStages([first]);
      setSteps(
        steps.map((step, index) =>
          index === 0 ? step : { ...step, stageKey: step.stageKey ?? first.key },
        ),
      );
    } else {
      setStages([]);
      setSteps(steps.map((step) => ({ ...step, stageKey: null })));
    }
  };
  const moveSubStep = (from: number, to: number) => {
    if (!root) return;
    setSteps([root, ...moveItem(subSteps, from, to)]);
  };
  /** The next sub-step up or down in the same stage (any, without stages), or null. */
  const neighbour = (index: number, step: -1 | 1): number | null => {
    const stage = subSteps[index]?.stageKey ?? null;
    for (let i = index + step; i >= 0 && i < subSteps.length; i += step) {
      if (mode !== 'stages' || (subSteps[i]?.stageKey ?? null) === stage) return i;
    }
    return null;
  };
  const removeStage = (index: number) => {
    const removed = stages[index];
    const rest = stages.filter((_, i) => i !== index);
    const fallback = rest[Math.max(0, index - 1)]?.key ?? null;
    setStages(rest);
    setSteps(
      steps.map((step) =>
        step.stageKey === removed?.key ? { ...step, stageKey: fallback } : step,
      ),
    );
  };
  const addSubStep = () => {
    if (!root) return;
    setEditing({
      key: newKey(),
      parentKey: root.key,
      stageKey: mode === 'stages' ? (stages[0]?.key ?? null) : null,
      title: '',
      department: root.department,
      dueDay: root.dueDay ?? 1,
      priority: 'normal',
      needsClientApproval: false,
      revisionLimit: root.revisionLimit,
      checklist: [],
      criteria: [],
      briefDoc: null,
      briefFields: null,
      estimateMinutes: null,
    });
  };
  const stepRow = (step: StepValues, index: number | null) => {
    const failed = errors.steps?.[index === null ? 0 : index + 1];
    const stage = stages.find((item) => item.key === step.stageKey);
    return (
      <li
        key={step.key}
        className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface px-3 py-2"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {step.title}
            {failed && (
              <Badge tone="danger">
                <TriangleAlertIcon aria-hidden="true" />
                {t('templates.task.needsFix')}
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {[
              departmentName(step.department),
              t('templates.dueDay', { day: formatNumber(step.dueDay ?? 1) }),
              step.estimateMinutes
                ? t('tasks.subtasks.hours', { hours: formatNumber(step.estimateMinutes / 60) })
                : null,
              mode === 'stages' && stage ? stage.name : null,
              (step.criteria?.length ?? 0) > 0
                ? t('templates.task.criteriaCount', {
                    n: formatNumber(step.criteria?.length ?? 0),
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {!readOnly && (
          <span className="flex items-center gap-1">
            {index !== null && (
              <>
                <IconButton
                  label={t('templates.task.earlier', { title: step.title })}
                  disabled={neighbour(index, -1) === null}
                  onClick={() => moveSubStep(index, neighbour(index, -1) ?? index)}
                >
                  <ArrowUpIcon />
                </IconButton>
                <IconButton
                  label={t('templates.task.later', { title: step.title })}
                  disabled={neighbour(index, 1) === null}
                  onClick={() => moveSubStep(index, neighbour(index, 1) ?? index)}
                >
                  <ArrowDownIcon />
                </IconButton>
              </>
            )}
            <IconButton
              label={t('templates.task.edit', { title: step.title })}
              onClick={() => setEditing(step)}
            >
              <PencilIcon />
            </IconButton>
            {index !== null && (
              <IconButton
                label={t('templates.task.remove', { title: step.title })}
                onClick={() => setSteps(steps.filter((other) => other.key !== step.key))}
              >
                <Trash2Icon />
              </IconButton>
            )}
          </span>
        )}
      </li>
    );
  };

  if (!root) return null;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t('templates.task.root')}</h3>
        <ul>{stepRow(root, null)}</ul>
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-medium">{t('templates.task.subSteps')}</h3>
          {readOnly ? (
            <Badge tone="outline">{t(`tasks.subtasks.runModes.${mode}`)}</Badge>
          ) : (
            <ToggleGroup
              aria-label={t('tasks.subtasks.runMode')}
              value={[mode]}
              onValueChange={(next: SubtaskRunMode[]) => next[0] && setMode(next[0])}
            >
              {SUBTASK_RUN_MODES.map((item) => (
                <ToggleGroupItem key={item} value={item}>
                  {t(`tasks.subtasks.runModes.${item}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </div>
        {mode === 'stages' ? (
          <div className="flex flex-col gap-3">
            {stages.map((stage, stageIndex) => (
              <div
                key={stage.key}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-end gap-2">
                  {readOnly ? (
                    <p className="font-medium">{stage.name}</p>
                  ) : (
                    <StageName
                      value={stage.name}
                      position={stageIndex + 1}
                      invalid={!!errors.stages?.[stageIndex]?.name}
                      onChange={(name) =>
                        setStages(
                          stages.map((other, i) => (i === stageIndex ? { ...other, name } : other)),
                        )
                      }
                    />
                  )}
                  {!readOnly && (
                    <>
                      <IconButton
                        variant="outline"
                        size="icon"
                        label={t('templates.moveStageUp')}
                        disabled={stageIndex === 0}
                        onClick={() => setStages(moveItem(stages, stageIndex, stageIndex - 1))}
                      >
                        <ArrowUpIcon />
                      </IconButton>
                      <IconButton
                        variant="outline"
                        size="icon"
                        label={t('templates.moveStageDown')}
                        disabled={stageIndex === stages.length - 1}
                        onClick={() => setStages(moveItem(stages, stageIndex, stageIndex + 1))}
                      >
                        <ArrowDownIcon />
                      </IconButton>
                      <IconButton
                        variant="outline"
                        size="icon"
                        label={t('templates.removeStage')}
                        disabled={stages.length === 1}
                        onClick={() => removeStage(stageIndex)}
                      >
                        <Trash2Icon />
                      </IconButton>
                    </>
                  )}
                </div>
                <ol className="flex flex-col gap-2">
                  {subSteps.flatMap((step, index) =>
                    step.stageKey === stage.key ? [stepRow(step, index)] : [],
                  )}
                </ol>
              </div>
            ))}
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={stages.length >= SUBTASK_LIMITS.stages}
                onClick={() =>
                  setStages([
                    ...stages,
                    {
                      key: newKey(),
                      name: t('tasks.wizard.subtasks.stageN', {
                        n: formatNumber(stages.length + 1),
                      }),
                    },
                  ])
                }
              >
                <ListPlusIcon />
                {t('templates.addStage')}
              </Button>
            )}
          </div>
        ) : subSteps.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('templates.task.noSubSteps')}</p>
        ) : (
          <ol className="flex flex-col gap-2">{subSteps.map((step, i) => stepRow(step, i))}</ol>
        )}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={full}
            onClick={addSubStep}
          >
            <PlusIcon />
            {t('templates.task.addSubStep')}
          </Button>
        )}
      </section>
      {editing && (
        <TaskStepDialog
          step={editing}
          isRoot={editing.key === root.key}
          rootDueDay={root.dueDay ?? null}
          stages={mode === 'stages' ? stages : []}
          onClose={() => setEditing(null)}
          onSave={(step) => {
            const exists = steps.some((other) => other.key === step.key);
            setSteps(
              exists
                ? steps.map((other) => (other.key === step.key ? step : other))
                : [...steps, step],
            );
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function StageName({
  value,
  position,
  invalid,
  onChange,
}: {
  value: string;
  position: number;
  invalid: boolean;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field invalid={invalid} className="min-w-48 flex-1">
      <FieldLabel htmlFor={id}>
        {t('tasks.wizard.subtasks.stageNumber', { n: formatNumber(position) })}
      </FieldLabel>
      <Input
        id={id}
        maxLength={80}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError match={invalid}>{t('templates.form.errors.stageName')}</FieldError>
    </Field>
  );
}

/** One step of a task template: the task itself, or one of its subtasks. */
function TaskStepDialog({
  step: initial,
  isRoot,
  rootDueDay,
  stages,
  onClose,
  onSave,
}: {
  step: StepValues;
  isRoot: boolean;
  rootDueDay: number | null;
  stages: StageValues[];
  onClose: () => void;
  onSave: (step: StepValues) => void;
}) {
  const { t } = useTranslation();
  const labels = useRichTextLabels();
  const departments = useDepartments();
  const [step, setStep] = useState(initial);
  const [tried, setTried] = useState(false);
  const ids = {
    title: useId(),
    department: useId(),
    dueDay: useId(),
    priority: useId(),
    estimate: useId(),
    stage: useId(),
    brief: useId(),
    approval: useId(),
    revisions: useId(),
  };
  const set = <K extends keyof StepValues>(key: K, value: StepValues[K]) =>
    setStep((current) => ({ ...current, [key]: value }));
  const maxDay = isRoot
    ? TEMPLATE_LIMITS.projectDueDay
    : (rootDueDay ?? TEMPLATE_LIMITS.projectDueDay);
  const titleInvalid = !step.title.trim();
  const dayInvalid = !step.dueDay || step.dueDay < 1 || step.dueDay > maxDay;
  const revisionLimit = step.revisionLimit ?? TASK_LIMITS.revisionLimit;
  // Rule C7: the fields must fit the department's schema before the template is saved.
  const briefCheck = departmentBriefFields(step.department, step.briefFields);
  const briefProblem = 'problem' in briefCheck ? briefCheck.problem : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // The dialog sits in the template's form: React bubbles the submit through the portal.
            event.stopPropagation();
            setTried(true);
            if (titleInvalid || dayInvalid || briefProblem) return;
            onSave({ ...step, title: step.title.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {isRoot ? t('templates.task.editRoot') : t('templates.task.editSubStep')}
            </DialogTitle>
          </DialogHeader>
          <Field invalid={tried && titleInvalid}>
            <FieldLabel htmlFor={ids.title}>{t('tasks.form.title')}</FieldLabel>
            <Input
              id={ids.title}
              autoFocus
              autoComplete="off"
              maxLength={160}
              value={step.title}
              onChange={(event) => set('title', event.target.value)}
            />
            <FieldError match={tried && titleInvalid}>{t('tasks.form.errors.title')}</FieldError>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel id={ids.department} render={<span />}>
                {t('tasks.form.department')}
              </FieldLabel>
              <Select
                items={departments.map(({ code, name }) => ({ value: code, label: name }))}
                value={step.department}
                onValueChange={(value) => {
                  if (!value) return;
                  const next = value as DepartmentCode;
                  setStep((current) => ({
                    ...current,
                    department: next,
                    briefFields: keepsBriefFields(current.department, next)
                      ? current.briefFields
                      : null,
                  }));
                }}
              >
                <SelectTrigger aria-labelledby={ids.department}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {departments.map(({ code, name }) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field invalid={tried && dayInvalid}>
              <FieldLabel htmlFor={ids.dueDay}>{t('templates.task.dueDay')}</FieldLabel>
              <Input
                id={ids.dueDay}
                type="number"
                dir="ltr"
                min={1}
                max={maxDay}
                value={step.dueDay ?? ''}
                onChange={(event) =>
                  set('dueDay', event.target.value ? Number(event.target.value) : null)
                }
              />
              <FieldDescription>
                {isRoot ? t('templates.task.dueDayHint') : t('templates.task.subDueDayHint')}
              </FieldDescription>
              <FieldError match={tried && dayInvalid}>
                {t('templates.task.errors.dueDay', { max: formatNumber(maxDay) })}
              </FieldError>
            </Field>
            <Field>
              <FieldLabel id={ids.priority} render={<span />}>
                {t('tasks.form.priority')}
              </FieldLabel>
              <Select
                items={TASK_PRIORITIES.map((value) => ({
                  value,
                  label: t(`tasks.priorities.${value}`),
                }))}
                value={step.priority ?? 'normal'}
                onValueChange={(value) => value && set('priority', value)}
              >
                <SelectTrigger aria-labelledby={ids.priority}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`tasks.priorities.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel id={ids.estimate} render={<span />}>
                {t('tasks.subtasks.estimate')}
              </FieldLabel>
              <EstimateInput
                value={step.estimateMinutes}
                onChange={(value) => set('estimateMinutes', value)}
                labelledBy={ids.estimate}
              />
            </Field>
            {!isRoot && stages.length > 0 && (
              <Field>
                <FieldLabel id={ids.stage} render={<span />}>
                  {t('tasks.subtasks.stage')}
                </FieldLabel>
                <Select
                  items={stages.map((stage) => ({ value: stage.key, label: stage.name }))}
                  value={step.stageKey ?? stages[0]?.key ?? null}
                  onValueChange={(value) => value && set('stageKey', value)}
                >
                  <SelectTrigger aria-labelledby={ids.stage}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.key} value={stage.key}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {isRoot && (
              <>
                <Field>
                  <label htmlFor={ids.approval} className="flex items-center gap-3">
                    <Switch
                      id={ids.approval}
                      checked={step.needsClientApproval ?? true}
                      onCheckedChange={(checked) => set('needsClientApproval', checked)}
                    />
                    <span className="text-sm font-medium">
                      {t('templates.task.clientApproval')}
                    </span>
                  </label>
                </Field>
                <Field>
                  <FieldLabel htmlFor={ids.revisions}>{t('tasks.form.revisionLimit')}</FieldLabel>
                  <Input
                    id={ids.revisions}
                    type="number"
                    dir="ltr"
                    min={0}
                    max={TASK_LIMITS.revisionLimit}
                    value={revisionLimit}
                    onChange={(event) =>
                      set(
                        'revisionLimit',
                        Math.min(
                          TASK_LIMITS.revisionLimit,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      )
                    }
                  />
                </Field>
              </>
            )}
          </div>
          <Field>
            <FieldLabel id={ids.brief} render={<span />}>
              {t('tasks.form.brief')}
            </FieldLabel>
            <RichTextEditor
              aria-labelledby={ids.brief}
              defaultValue={step.briefDoc as RichTextDoc | null | undefined}
              labels={labels}
              compact
              onChange={(doc) => {
                const parsed = taskBriefDocSchema.safeParse(doc);
                set('briefDoc', parsed.success ? parsed.data : null);
              }}
            />
          </Field>
          <BriefFieldsEditor
            department={step.department}
            value={step.briefFields}
            onChange={(value) => set('briefFields', value)}
            invalid={tried ? briefProblem : null}
          />
          <ItemsEditor
            label={t('tasks.form.criteria')}
            placeholder={t('tasks.form.criteriaPlaceholder')}
            hint={t('tasks.form.criteriaHint')}
            limit={TASK_LIMITS.criteria}
            value={step.criteria ?? []}
            onChange={(value) => set('criteria', value)}
          />
          <ItemsEditor
            label={t('tasks.form.checklist')}
            placeholder={t('tasks.form.checklistPlaceholder')}
            limit={TEMPLATE_LIMITS.checklist}
            value={step.checklist ?? []}
            onChange={(value) => set('checklist', value)}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit">{t('templates.task.apply')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
