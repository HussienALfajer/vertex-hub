import {
  createTemplateSchema,
  DEFAULT_REVISION_LIMIT,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  type DepartmentCode,
  TASK_LIMITS,
  TASK_PRIORITIES,
  type TaskPriority,
  TEMPLATE_LIMITS,
  type TemplateKind,
} from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { PlusIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { useDepartments } from '../tasks/task-form';
import {
  dependencyOptions,
  type StageValues,
  type StepValues,
  withStep,
} from './template-document';

const NO_STAGE = 'none';

/** A stored step, or a new one with the starting values of its group. */
export type NewOrStoredStep = Partial<StepValues> & { key: string };

/** A step as the dialog edits it: every field present, the repeat choice explicit. */
interface StepDraft {
  key: string;
  title: string;
  stageKey: string;
  department: DepartmentCode | '';
  repeated: boolean;
  dueDay: number | null;
  repeatKind: DeliverableKind | '';
  repeatLabel: string;
  spreadFromDay: number | null;
  priority: TaskPriority;
  needsClientApproval: boolean;
  revisionLimit: number;
  dependsOn: string[];
  checklist: string[];
  brief: string;
}

function draftOf(step: NewOrStoredStep): StepDraft {
  return {
    key: step.key,
    title: step.title ?? '',
    stageKey: step.stageKey ?? NO_STAGE,
    department: step.department ?? '',
    repeated: !!step.repeatKind,
    dueDay: step.dueDay ?? null,
    repeatKind: step.repeatKind ?? '',
    repeatLabel: step.repeatLabel ?? '',
    spreadFromDay: step.spreadFromDay ?? null,
    priority: step.priority ?? 'normal',
    needsClientApproval: step.needsClientApproval ?? true,
    revisionLimit: step.revisionLimit ?? DEFAULT_REVISION_LIMIT,
    dependsOn: step.dependsOn ?? [],
    checklist: step.checklist ?? [],
    brief: step.brief ?? '',
  };
}

/** Keeps only the fields of the step's kind, so the saved document never mixes them (rule 1). */
function stepOf(kind: TemplateKind, draft: StepDraft, allowed: Set<string>): StepValues {
  const repeated = kind === 'retainer_cycle' && draft.repeated;
  const number = (value: number | null) => (Number.isFinite(value) ? value : null);
  return {
    key: draft.key,
    title: draft.title,
    stageKey: kind === 'project' && draft.stageKey !== NO_STAGE ? draft.stageKey : null,
    department: draft.department as DepartmentCode,
    dueDay: repeated ? null : number(draft.dueDay),
    repeatKind: repeated && draft.repeatKind ? draft.repeatKind : null,
    repeatLabel: repeated && draft.repeatKind === 'other' ? draft.repeatLabel.trim() || null : null,
    spreadFromDay: repeated ? (number(draft.spreadFromDay) ?? 1) : null,
    priority: draft.priority,
    needsClientApproval: draft.needsClientApproval,
    revisionLimit: draft.revisionLimit,
    dependsOn: draft.dependsOn.filter((key) => allowed.has(key)),
    checklist: draft.checklist,
    brief: draft.brief.trim() || null,
  };
}

/** Where a schema issue of the step shows in the dialog. */
const FIELD_OF_ISSUE: Record<string, keyof StepDraft> = {
  title: 'title',
  department: 'department',
  dueDay: 'dueDay',
  repeatKind: 'repeatKind',
  repeatLabel: 'repeatLabel',
  spreadFromDay: 'spreadFromDay',
  revisionLimit: 'revisionLimit',
  dependsOn: 'dependsOn',
  checklist: 'checklist',
  brief: 'brief',
  stageKey: 'stageKey',
};

/**
 * Adds or edits one step. The step is checked in its place in the whole template with the same
 * schema the API uses, so an error shows here rather than on save.
 */
export function StepDialog({
  kind,
  stages,
  steps,
  step,
  isNew,
  onClose,
  onSave,
}: {
  kind: TemplateKind;
  stages: StageValues[];
  steps: StepValues[];
  /** The step to edit, or the new step's starting values. */
  step: NewOrStoredStep;
  isNew: boolean;
  onClose: () => void;
  onSave: (step: StepValues) => void;
}) {
  const { t } = useTranslation();
  const ids = {
    title: useId(),
    department: useId(),
    stage: useId(),
    kind: useId(),
    dueDay: useId(),
    repeatKind: useId(),
    repeatLabel: useId(),
    spread: useId(),
    priority: useId(),
    approval: useId(),
    limit: useId(),
    dependsOn: useId(),
    brief: useId(),
  };
  const departments = useDepartments();
  const form = useForm<StepDraft>({ defaultValues: draftOf(step) });
  const errors = form.formState.errors;
  const [stageKey, repeated, repeatKind] = useWatch({
    control: form.control,
    name: ['stageKey', 'repeated', 'repeatKind'],
  });
  // Only its group matters to place it: which earlier steps it may wait on.
  const placement: StepValues = {
    ...step,
    title: '',
    department: step.department ?? 'design',
    stageKey: stageKey === NO_STAGE ? null : stageKey,
    repeatKind: repeated ? repeatKind || 'other' : null,
  };
  const options = dependencyOptions(kind, stages, steps, placement);
  const allowed = new Set(options.map((option) => option.key));

  const submit = form.handleSubmit((draft) => {
    form.clearErrors();
    if (!draft.department) {
      form.setError('department', { type: 'required' });
      return;
    }
    if (kind === 'retainer_cycle' && draft.repeated && !draft.repeatKind) {
      form.setError('repeatKind', { type: 'required' });
      return;
    }
    const next = stepOf(kind, draft, allowed);
    const placed = withStep(kind, stages, steps, next);
    const index = placed.findIndex((other) => other.key === next.key);
    const result = createTemplateSchema.safeParse({
      kind,
      name: '-',
      stages,
      steps: placed,
      assignees: [],
    });
    const issues = result.success
      ? []
      : result.error.issues.filter((issue) => issue.path[0] === 'steps' && issue.path[1] === index);
    if (issues.length > 0) {
      for (const issue of issues) {
        const field = FIELD_OF_ISSUE[String(issue.path[2])];
        if (field) form.setError(field, { type: 'schema' });
      }
      return;
    }
    onSave(next);
    onClose();
  });

  const departmentItems = departments.map(({ code, name }) => ({ value: code, label: name }));
  const stageItems = [
    ...stages.map((stage) => ({
      value: stage.key,
      label: stage.name || t('templates.stageUnnamed'),
    })),
    { value: NO_STAGE, label: t('templates.noStage') },
  ];
  const kindItems = DELIVERABLE_KINDS.map((value) => ({
    value,
    label: t(`retainers.kinds.${value}`),
  }));
  const maxDay = kind === 'project' ? TEMPLATE_LIMITS.projectDueDay : TEMPLATE_LIMITS.cycleDueDay;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        closeLabel={t('common.close')}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      >
        <form
          className="grid gap-5"
          // The dialog renders in a portal inside the page form: its submit must not reach that form.
          onSubmit={(event) => {
            event.stopPropagation();
            submit(event);
          }}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>
              {isNew ? t('templates.step.addTitle') : t('templates.step.editTitle')}
            </DialogTitle>
            <DialogDescription>{t('templates.step.hint')}</DialogDescription>
          </DialogHeader>

          <Field invalid={!!errors.title}>
            <FieldLabel htmlFor={ids.title}>{t('templates.step.title')}</FieldLabel>
            <Input
              id={ids.title}
              autoComplete="off"
              placeholder={t('templates.step.titlePlaceholder')}
              {...form.register('title')}
            />
            {kind === 'retainer_cycle' && repeated && (
              <FieldDescription>{t('templates.step.titleRepeatedHint')}</FieldDescription>
            )}
            <FieldError match={!!errors.title}>{t('templates.step.errors.title')}</FieldError>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors.department}>
              <FieldLabel htmlFor={ids.department}>{t('templates.step.department')}</FieldLabel>
              <Controller
                control={form.control}
                name="department"
                render={({ field }) => (
                  <Select
                    items={departmentItems}
                    value={field.value || null}
                    onValueChange={(value) => field.onChange(value ?? '')}
                  >
                    <SelectTrigger id={ids.department} onBlur={field.onBlur} ref={field.ref}>
                      <SelectValue placeholder={t('templates.step.departmentPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {departmentItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldDescription>{t('templates.step.departmentHint')}</FieldDescription>
              <FieldError match={!!errors.department}>
                {t('templates.step.errors.department')}
              </FieldError>
            </Field>
            {kind === 'project' && (
              <Field>
                <FieldLabel htmlFor={ids.stage}>{t('templates.step.stage')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="stageKey"
                  render={({ field }) => (
                    <Select
                      items={stageItems}
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? NO_STAGE)}
                    >
                      <SelectTrigger id={ids.stage} onBlur={field.onBlur} ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stageItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldDescription>{t('templates.step.stageHint')}</FieldDescription>
              </Field>
            )}
          </div>

          {kind === 'retainer_cycle' && (
            <Field>
              <FieldLabel id={ids.kind} render={<span />}>
                {t('templates.step.timing')}
              </FieldLabel>
              <Controller
                control={form.control}
                name="repeated"
                render={({ field }) => (
                  <ToggleGroup
                    aria-labelledby={ids.kind}
                    value={[field.value ? 'repeated' : 'fixed']}
                    onValueChange={(next: string[]) => {
                      if (next[0]) field.onChange(next[0] === 'repeated');
                    }}
                  >
                    <ToggleGroupItem value="fixed">{t('templates.step.fixed')}</ToggleGroupItem>
                    <ToggleGroupItem value="repeated">
                      {t('templates.step.repeated')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              />
              <FieldDescription>
                {repeated ? t('templates.step.repeatedHint') : t('templates.step.fixedHint')}
              </FieldDescription>
            </Field>
          )}

          {kind === 'retainer_cycle' && repeated ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field invalid={!!errors.repeatKind}>
                <FieldLabel htmlFor={ids.repeatKind}>{t('templates.step.repeatKind')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="repeatKind"
                  render={({ field }) => (
                    <Select
                      items={kindItems}
                      value={field.value || null}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <SelectTrigger id={ids.repeatKind} onBlur={field.onBlur} ref={field.ref}>
                        <SelectValue placeholder={t('templates.step.repeatKindPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {kindItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <FieldError match={!!errors.repeatKind}>
                  {t('templates.step.errors.repeatKind')}
                </FieldError>
              </Field>
              <Field invalid={!!errors.spreadFromDay}>
                <FieldLabel htmlFor={ids.spread}>{t('templates.step.spreadFromDay')}</FieldLabel>
                <Input
                  id={ids.spread}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={TEMPLATE_LIMITS.cycleDueDay}
                  placeholder="1"
                  className="w-28"
                  {...form.register('spreadFromDay', { valueAsNumber: true })}
                />
                <FieldDescription>{t('templates.step.spreadFromDayHint')}</FieldDescription>
                <FieldError match={!!errors.spreadFromDay}>
                  {t('templates.step.errors.day', {
                    max: formatNumber(TEMPLATE_LIMITS.cycleDueDay),
                  })}
                </FieldError>
              </Field>
              {repeatKind === 'other' && (
                <Field invalid={!!errors.repeatLabel}>
                  <FieldLabel htmlFor={ids.repeatLabel}>
                    {t('templates.step.repeatLabel')}
                  </FieldLabel>
                  <Input
                    id={ids.repeatLabel}
                    autoComplete="off"
                    {...form.register('repeatLabel')}
                  />
                  <FieldDescription>{t('templates.step.repeatLabelHint')}</FieldDescription>
                  <FieldError match={!!errors.repeatLabel}>
                    {t('templates.step.errors.repeatLabel')}
                  </FieldError>
                </Field>
              )}
            </div>
          ) : (
            <Field invalid={!!errors.dueDay}>
              <FieldLabel htmlFor={ids.dueDay}>{t('templates.step.dueDay')}</FieldLabel>
              <Input
                id={ids.dueDay}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxDay}
                className="w-28"
                {...form.register('dueDay', { valueAsNumber: true })}
              />
              <FieldDescription>
                {kind === 'project'
                  ? t('templates.step.dueDayHint')
                  : t('templates.step.dueDayCycleHint')}
              </FieldDescription>
              <FieldError match={!!errors.dueDay}>
                {t('templates.step.errors.day', { max: formatNumber(maxDay) })}
              </FieldError>
            </Field>
          )}

          <Field>
            <FieldLabel id={ids.priority} render={<span />}>
              {t('templates.step.priority')}
            </FieldLabel>
            <Controller
              control={form.control}
              name="priority"
              render={({ field }) => (
                <ToggleGroup
                  aria-labelledby={ids.priority}
                  value={[field.value]}
                  onValueChange={(next: TaskPriority[]) => {
                    if (next[0]) field.onChange(next[0]);
                  }}
                >
                  {TASK_PRIORITIES.map((priority) => (
                    <ToggleGroupItem key={priority} value={priority}>
                      {t(`tasks.priorities.${priority}`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <label htmlFor={ids.approval} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{t('tasks.form.needsClientApproval')}</span>
                <Controller
                  control={form.control}
                  name="needsClientApproval"
                  render={({ field }) => (
                    <Switch
                      id={ids.approval}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </label>
              <FieldDescription>{t('tasks.form.needsClientApprovalHint')}</FieldDescription>
            </Field>
            <Field invalid={!!errors.revisionLimit}>
              <FieldLabel htmlFor={ids.limit}>{t('tasks.form.revisionLimit')}</FieldLabel>
              <Input
                id={ids.limit}
                type="number"
                inputMode="numeric"
                min={0}
                max={TASK_LIMITS.revisionLimit}
                className="w-28"
                {...form.register('revisionLimit', { valueAsNumber: true })}
              />
              <FieldError match={!!errors.revisionLimit}>
                {t('tasks.form.errors.revisionLimit', {
                  max: formatNumber(TASK_LIMITS.revisionLimit),
                })}
              </FieldError>
            </Field>
          </div>

          <Field invalid={!!errors.dependsOn}>
            <FieldLabel htmlFor={ids.dependsOn}>
              {t('templates.step.dependsOn')}
              <span className="ms-1 font-normal text-muted-foreground">
                ({t('common.optional')})
              </span>
            </FieldLabel>
            <Controller
              control={form.control}
              name="dependsOn"
              render={({ field }) => (
                <MultiCombobox
                  id={ids.dependsOn}
                  items={options}
                  value={field.value.flatMap(
                    (key) => options.find((option) => option.key === key) ?? [],
                  )}
                  onValueChange={(next) =>
                    field.onChange(
                      next.slice(0, TEMPLATE_LIMITS.dependencies).map((option) => option.key),
                    )
                  }
                  itemToLabel={(option) => option.title}
                  itemToKey={(option) => option.key}
                  placeholder={
                    options.length > 0
                      ? t('templates.step.dependsOnPlaceholder')
                      : t('templates.step.noEarlierSteps')
                  }
                  emptyLabel={t('common.noMatches')}
                  removeLabel={(label) => t('common.remove', { label })}
                  invalid={!!errors.dependsOn}
                />
              )}
            />
            <FieldDescription>
              {kind === 'retainer_cycle'
                ? t('templates.step.dependsOnCycleHint')
                : t('templates.step.dependsOnHint')}
            </FieldDescription>
            <FieldError match={!!errors.dependsOn}>
              {t('templates.step.errors.dependsOn')}
            </FieldError>
          </Field>

          <Controller
            control={form.control}
            name="checklist"
            render={({ field }) => (
              <ChecklistEditor
                items={field.value}
                onChange={field.onChange}
                invalid={!!errors.checklist}
              />
            )}
          />

          <Field invalid={!!errors.brief}>
            <FieldLabel htmlFor={ids.brief}>
              {t('templates.step.brief')}
              <span className="ms-1 font-normal text-muted-foreground">
                ({t('common.optional')})
              </span>
            </FieldLabel>
            <Textarea id={ids.brief} rows={3} {...form.register('brief')} />
            <FieldError match={!!errors.brief}>{t('templates.step.errors.brief')}</FieldError>
          </Field>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit">
              {isNew ? t('templates.step.add') : t('templates.step.apply')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The step's checklist: typed one by one, removable, at most `TEMPLATE_LIMITS.checklist`. */
function ChecklistEditor({
  items,
  onChange,
  invalid,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState('');
  const full = items.length >= TEMPLATE_LIMITS.checklist;
  const add = () => {
    const text = draft.trim();
    if (!text || full) return;
    onChange([...items, text.slice(0, 200)]);
    setDraft('');
  };
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>
        {t('tasks.form.checklist')}
        <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
      </FieldLabel>
      {items.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: items are plain strings that may repeat
              key={index}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <span className="text-muted-foreground tabular-nums">{formatNumber(index + 1)}.</span>
              <span className="flex-1">{item}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.remove', { label: item })}
                onClick={() => onChange(items.filter((_, other) => other !== index))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={200}
          disabled={full}
          placeholder={t('tasks.form.checklistPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add} disabled={full || !draft.trim()}>
          <PlusIcon />
          {t('tasks.form.addItem')}
        </Button>
      </div>
    </Field>
  );
}
