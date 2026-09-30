import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  type CreateTemplate,
  createTemplateSchema,
  type DepartmentCode,
  TEMPLATE_KINDS,
  TEMPLATE_LIMITS,
  type TemplateAssignee,
  type TemplateKind,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarDaysIcon,
  EllipsisIcon,
  GripVerticalIcon,
  LinkIcon,
  ListChecksIcon,
  ListPlusIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserCheckIcon,
} from 'lucide-react';
import { type DragEvent, type LiHTMLAttributes, useId, useState } from 'react';
import { Controller, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api/client';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatList, formatNumber } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { useDepartmentMembers } from '../tasks/task-form';
import { StepDialog } from './step-dialog';
import {
  laterDependencies,
  moveStage,
  newKey,
  orderSteps,
  type StageValues,
  type StepValues,
  stepGroup,
  type TemplateFormValues,
  withoutStage,
  withoutStep,
  withStep,
} from './template-document';

export type TemplateFormMethods = UseFormReturn<TemplateFormValues, unknown, CreateTemplate>;

/** The whole template as one form, checked with the schema the API uses (rules 1–3). */
export function useTemplateForm(values: TemplateFormValues): TemplateFormMethods {
  return useForm<TemplateFormValues, unknown, CreateTemplate>({
    resolver: standardSchemaResolver(createTemplateSchema),
    defaultValues: values,
  });
}

/**
 * Puts a failed save on the field it concerns (the name, a department's default assignee) and
 * returns the form-level message for anything else (null when a field took it).
 */
export function templateFormFailure(
  form: TemplateFormMethods,
  t: TFunction,
  error: unknown,
): string | null {
  if (!(error instanceof ApiError)) return errorMessage(t, error);
  if (error.code === 'TEMPLATE_NAME_TAKEN') {
    form.setError('name', { type: SCREEN_ERROR, message: errorMessage(t, error) });
    return null;
  }
  const department = (error.details as { department?: unknown } | undefined)?.department;
  const index = (form.getValues('assignees') ?? []).findIndex((a) => a.department === department);
  if (error.code === 'INVALID_ASSIGNEE' && index !== -1) {
    form.setError(`assignees.${index}.userId`, {
      type: SCREEN_ERROR,
      message: errorMessage(t, error),
    });
    return null;
  }
  return errorMessage(t, error);
}

const change = (form: TemplateFormMethods) =>
  ({ shouldDirty: true, shouldValidate: form.formState.isSubmitted }) as const;

// Basics

export function BasicsFields({ form, isNew }: { form: TemplateFormMethods; isNew: boolean }) {
  const { t } = useTranslation();
  const ids = { name: useId(), kind: useId(), description: useId() };
  const steps = useWatch({ control: form.control, name: 'steps' });
  const errors = form.formState.errors;
  return (
    <>
      <Field invalid={!!errors.name}>
        <FieldLabel htmlFor={ids.name}>{t('templates.form.name')}</FieldLabel>
        <Input
          id={ids.name}
          autoComplete="off"
          placeholder={t('templates.form.namePlaceholder')}
          {...form.register('name')}
        />
        <FieldError match={!!errors.name}>
          {fieldError(errors.name, t('templates.form.errors.name'))}
        </FieldError>
      </Field>
      {isNew && (
        <Field>
          <FieldLabel id={ids.kind} render={<span />}>
            {t('templates.kind')}
          </FieldLabel>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <ToggleGroup
                aria-labelledby={ids.kind}
                value={[field.value]}
                disabled={steps.length > 0}
                onValueChange={(next: TemplateKind[]) => {
                  if (!next[0]) return;
                  field.onChange(next[0]);
                  form.setValue('stages', [], change(form));
                }}
              >
                {TEMPLATE_KINDS.map((kind) => (
                  <ToggleGroupItem key={kind} value={kind}>
                    {t(`templates.kindNames.${kind}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          />
          <FieldDescription>
            {steps.length > 0 ? t('templates.form.kindLocked') : t('templates.form.kindHint')}
          </FieldDescription>
        </Field>
      )}
      <Field invalid={!!errors.description}>
        <FieldLabel htmlFor={ids.description}>
          {t('templates.form.description')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </FieldLabel>
        <Textarea
          id={ids.description}
          rows={2}
          placeholder={t('templates.form.descriptionPlaceholder')}
          {...form.register('description')}
        />
        <FieldError match={!!errors.description}>
          {t('templates.form.errors.description')}
        </FieldError>
      </Field>
    </>
  );
}

// Steps

interface StepGroup {
  id: string;
  /** Project templates: the stage and its index; null for steps without a stage. */
  stage: { value: StageValues; index: number } | null;
  title: string;
  hint?: string;
  entries: { step: StepValues; index: number }[];
  /** Starting values of a step added to the group. */
  preset: Partial<StepValues>;
  /** Shown even without steps. */
  always: boolean;
}

/**
 * The template's steps as the page lists them: project templates under their stages (steps without
 * a stage last), monthly templates as fixed steps then one task per deliverable. Editors add, edit
 * (dialog), reorder (drag or the menu) and remove steps and stages; readers see the same list.
 */
export function StepsEditor({ form, readOnly }: { form: TemplateFormMethods; readOnly: boolean }) {
  const { t } = useTranslation();
  const [kind, stages = [], steps] = useWatch({
    control: form.control,
    name: ['kind', 'stages', 'steps'],
  });
  const [editing, setEditing] = useState<{ step: Partial<StepValues> & { key: string } } | null>(
    null,
  );
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const errors = form.formState.errors;
  const project = kind === 'project';
  const fullSteps = steps.length >= TEMPLATE_LIMITS.steps;

  function setDocument(next: { stages?: StageValues[]; steps?: StepValues[] }) {
    if (next.stages) form.setValue('stages', next.stages, change(form));
    if (!next.steps) return;
    form.setValue('steps', next.steps, change(form));
    // A department no step uses has no default assignee (rule 1).
    const used = new Set(next.steps.map((step) => step.department));
    const assignees = form.getValues('assignees') ?? [];
    const kept = assignees.filter((assignee) => used.has(assignee.department));
    if (kept.length !== assignees.length) form.setValue('assignees', kept, change(form));
  }

  const entries = steps.map((step, index) => ({ step, index }));
  const groups: StepGroup[] = project
    ? [
        ...stages.map((stage, index) => ({
          id: stage.key,
          stage: { value: stage, index },
          title: stage.name,
          entries: entries.filter(({ step }) => step.stageKey === stage.key),
          preset: { stageKey: stage.key },
          always: true,
        })),
        {
          id: 'none',
          stage: null,
          title: t('templates.noStage'),
          hint: t('templates.noStageHint'),
          entries: entries.filter(
            ({ step }) => !stages.some((stage) => stage.key === step.stageKey),
          ),
          preset: { stageKey: null },
          always: stages.length === 0,
        },
      ]
    : [
        {
          id: 'fixed',
          stage: null,
          title: t('templates.fixedSteps'),
          hint: t('templates.fixedStepsHint'),
          entries: entries.filter(({ step }) => !step.repeatKind),
          preset: { dueDay: 1 },
          always: true,
        },
        {
          id: 'repeated',
          stage: null,
          title: t('templates.repeatedSteps'),
          hint: t('templates.repeatedStepsHint'),
          entries: entries.filter(({ step }) => !!step.repeatKind),
          preset: { repeatKind: 'design', spreadFromDay: 1 },
          always: true,
        },
      ];

  function moveStep(from: number, to: number) {
    const moving = steps[from];
    const other = steps[to];
    if (!moving || !other) return;
    const next = [...steps];
    next[from] = other;
    next[to] = moving;
    setDocument({ steps: next });
  }

  /** Drops a step before or after another; on a project, onto another stage too. */
  function dropOn(targetKey: string) {
    const from = steps.findIndex((step) => step.key === dragged);
    const to = steps.findIndex((step) => step.key === targetKey);
    const moving = steps[from];
    const other = steps[to];
    if (!moving || !other || from === to) return;
    if (!project && stepGroup(kind, stages, moving) !== stepGroup(kind, stages, other)) return;
    const moved = project ? { ...moving, stageKey: other.stageKey ?? null } : moving;
    const rest = steps.filter((step) => step.key !== moving.key);
    const at = rest.findIndex((step) => step.key === targetKey) + (from < to ? 1 : 0);
    setDocument({
      steps: orderSteps(kind, stages, [...rest.slice(0, at), moved, ...rest.slice(at)]),
    });
  }

  const dragProps = (step: StepValues) =>
    readOnly || steps.length < 2
      ? {}
      : {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            setDragged(step.key);
          },
          onDragOver: (event: DragEvent) => {
            if (!dragged) return;
            event.preventDefault();
            setTarget(step.key);
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            if (dragged) dropOn(step.key);
            setDragged(null);
            setTarget(null);
          },
          onDragEnd: () => {
            setDragged(null);
            setTarget(null);
          },
        };

  const titles = new Map(steps.map((step) => [step.key, step.title]));
  const rootError = errors.steps?.root ?? (errors.steps?.message ? errors.steps : undefined);

  return (
    <div className="flex flex-col gap-5">
      {steps.length === 0 && !readOnly && (
        <Callout
          icon={<ListPlusIcon />}
          title={t('templates.noStepsTitle')}
          description={project ? t('templates.noStepsHint') : t('templates.noStepsCycleHint')}
        />
      )}
      {rootError && (
        <p role="alert" className="text-sm text-destructive-text">
          {t('templates.form.errors.steps')}
        </p>
      )}

      {groups
        .filter((group) => group.always || group.entries.length > 0)
        .map((group) => (
          <section
            key={group.id}
            aria-label={group.title || t('templates.stageUnnamed')}
            className="flex flex-col gap-3"
          >
            {group.stage ? (
              <StageHeader
                form={form}
                stage={group.stage.value}
                index={group.stage.index}
                count={stages.length}
                readOnly={readOnly}
                onMove={(to) => setDocument(moveStage(stages, steps, group.stage?.index ?? 0, to))}
                onRemove={() =>
                  setDocument(withoutStage(stages, steps, group.stage?.value.key ?? ''))
                }
              />
            ) : (
              <div className="flex flex-col gap-0.5">
                <h3 className="font-bold">{group.title}</h3>
                {group.hint && <p className="text-sm text-muted-foreground">{group.hint}</p>}
              </div>
            )}
            {group.entries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                {group.stage ? t('templates.emptyStage') : t('templates.emptyGroup')}
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {group.entries.map(({ step, index }, position) => (
                  <StepCard
                    key={step.key}
                    kind={kind}
                    step={step}
                    index={index}
                    titles={titles}
                    later={laterDependencies(steps, index)}
                    problems={Object.keys(errors.steps?.[index] ?? {}).filter(
                      (field) => field !== 'ref' && field !== 'message' && field !== 'type',
                    )}
                    readOnly={readOnly}
                    first={position === 0}
                    last={position === group.entries.length - 1}
                    dragging={dragged === step.key}
                    dropTarget={target === step.key && dragged !== step.key}
                    onEdit={() => setEditing({ step })}
                    onMove={(offset) =>
                      moveStep(index, group.entries[position + offset]?.index ?? index)
                    }
                    onRemove={() => setDocument({ steps: withoutStep(steps, step.key) })}
                    {...dragProps(step)}
                  />
                ))}
              </ol>
            )}
            {!readOnly && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={fullSteps}
                  onClick={() => setEditing({ step: { key: newKey(), ...group.preset } })}
                >
                  <PlusIcon />
                  {group.stage
                    ? t('templates.addStepTo', {
                        stage: group.title || t('templates.stageUnnamed'),
                      })
                    : t('templates.addStep')}
                </Button>
              </div>
            )}
          </section>
        ))}

      {!readOnly && project && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={stages.length >= TEMPLATE_LIMITS.stages}
            onClick={() => setDocument({ stages: [...stages, { key: newKey(), name: '' }] })}
          >
            <PlusIcon />
            {t('templates.addStage')}
          </Button>
          {stages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={fullSteps}
              onClick={() => setEditing({ step: { key: newKey(), stageKey: null } })}
            >
              <PlusIcon />
              {t('templates.addStepWithoutStage')}
            </Button>
          )}
        </div>
      )}
      {fullSteps && !readOnly && (
        <p className="text-sm text-muted-foreground">
          {t('templates.stepsLimit', { max: formatNumber(TEMPLATE_LIMITS.steps) })}
        </p>
      )}

      {editing && (
        <StepDialog
          kind={kind}
          stages={stages}
          steps={steps}
          step={editing.step}
          isNew={!steps.some((step) => step.key === editing.step.key)}
          onClose={() => setEditing(null)}
          onSave={(step) => setDocument({ steps: withStep(kind, stages, steps, step) })}
        />
      )}
    </div>
  );
}

function StageHeader({
  form,
  stage,
  index,
  count,
  readOnly,
  onMove,
  onRemove,
}: {
  form: TemplateFormMethods;
  stage: StageValues;
  index: number;
  count: number;
  readOnly: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const error = form.formState.errors.stages?.[index]?.name;
  if (readOnly) {
    return (
      <h3 className="flex items-center gap-2 font-bold">
        <StageNumber index={index} />
        {stage.name}
      </h3>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <StageNumber index={index} />
        <Controller
          control={form.control}
          name={`stages.${index}.name`}
          render={({ field }) => (
            <Input
              aria-label={t('templates.stageName', { position: index + 1 })}
              aria-invalid={!!error || undefined}
              placeholder={t('templates.stageNamePlaceholder')}
              className="ms-1 me-2 flex-1 font-bold"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              ref={field.ref}
            />
          )}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === 0}
          aria-label={t('templates.moveStageUp')}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={index === count - 1}
          aria-label={t('templates.moveStageDown')}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('templates.removeStage')}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {t('templates.form.errors.stageName')}
        </p>
      )}
    </div>
  );
}

function StageNumber({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-status-brand text-xs font-bold text-status-brand-foreground tabular-nums"
    >
      {formatNumber(index + 1)}
    </span>
  );
}

interface StepCardProps extends LiHTMLAttributes<HTMLLIElement> {
  kind: TemplateKind;
  step: StepValues;
  index: number;
  titles: Map<string, string>;
  /** Dependencies a move put after the step. */
  later: string[];
  /** Fields the schema refused. */
  problems: string[];
  readOnly: boolean;
  first: boolean;
  last: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onEdit: () => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}

const STEP_PROBLEMS = [
  'title',
  'department',
  'dueDay',
  'repeatKind',
  'repeatLabel',
  'spreadFromDay',
  'dependsOn',
  'checklist',
  'brief',
  'stageKey',
] as const;

function StepCard({
  kind,
  step,
  index,
  titles,
  later,
  problems,
  readOnly,
  first,
  last,
  dragging,
  dropTarget,
  onEdit,
  onMove,
  onRemove,
  ...props
}: StepCardProps) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const waitsOn = (step.dependsOn ?? []).map((key) => titles.get(key) ?? '').filter(Boolean);
  const checklist = step.checklist ?? [];
  const known = STEP_PROBLEMS.filter((field) => problems.includes(field));
  const invalid = problems.length > 0 || later.length > 0;
  const reorderable = !!props.draggable;

  return (
    <li
      {...props}
      className={cn(
        'group flex gap-3 rounded-lg border bg-surface p-3 transition-colors duration-150 ease-out',
        invalid ? 'border-destructive' : 'border-border',
        dropTarget && 'border-primary bg-muted/50',
        dragging && 'opacity-50',
        reorderable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted-foreground tabular-nums"
      >
        {formatNumber(index + 1)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-medium">{step.title || t('templates.step.untitled')}</h4>
          {step.repeatKind && (
            <Badge tone="info">
              <RepeatIcon aria-hidden="true" />
              {step.repeatKind === 'other' && step.repeatLabel
                ? t('templates.perUnitLabel', { label: step.repeatLabel })
                : t('templates.perUnit', { kind: t(`retainers.kinds.${step.repeatKind}`) })}
            </Badge>
          )}
          {step.priority && step.priority !== 'normal' && (
            <Badge tone={step.priority === 'urgent' ? 'danger' : 'neutral'}>
              {t(`tasks.priorities.${step.priority}`)}
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{departmentName(step.department)}</span>
          <span className="flex items-center gap-1.5">
            <CalendarDaysIcon aria-hidden="true" className="size-4" />
            {step.repeatKind
              ? t('templates.spreadFrom', { day: formatNumber(step.spreadFromDay ?? 1) })
              : t('templates.dueDay', { day: formatNumber(step.dueDay ?? 1) })}
          </span>
          {(step.needsClientApproval ?? true) && (
            <span className="flex items-center gap-1.5">
              <UserCheckIcon aria-hidden="true" className="size-4" />
              {t('templates.clientApproval', {
                n: formatNumber(step.revisionLimit ?? 2),
              })}
            </span>
          )}
          {checklist.length > 0 && (
            <span className="flex items-center gap-1.5">
              <ListChecksIcon aria-hidden="true" className="size-4" />
              {t('templates.checklistCount', {
                n: formatNumber(checklist.length),
              })}
            </span>
          )}
        </p>
        {waitsOn.length > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <LinkIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('templates.waitsOn', { titles: formatList(waitsOn) })}
          </p>
        )}
        {readOnly && (step.brief || checklist.length > 0) && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {t('templates.stepDetails')}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {step.brief && <p className="whitespace-pre-line">{step.brief}</p>}
              {checklist.length > 0 && (
                <ol className="list-inside list-decimal">
                  {checklist.map((item, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: items are plain strings that may repeat
                    <li key={i}>{item}</li>
                  ))}
                </ol>
              )}
            </div>
          </details>
        )}
        {invalid && (
          <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive-text">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {later.length > 0
              ? t('templates.step.errors.laterDependency')
              : known.length > 0
                ? known.map((field) => t(`templates.step.problems.${field}`)).join(' ')
                : t('templates.step.errors.generic')}
          </p>
        )}
      </div>
      {!readOnly && (
        <div className="flex shrink-0 items-start gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('templates.editStep', { title: step.title })}
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('templates.stepActions', { title: step.title })}
                />
              }
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={first} onClick={() => onMove(-1)}>
                <ArrowUpIcon />
                {t('templates.moveUp')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onClick={() => onMove(1)}>
                <ArrowDownIcon />
                {t('templates.moveDown')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2Icon />
                {t('templates.removeStep')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {reorderable && (
            <GripVerticalIcon
              aria-hidden="true"
              className="mt-1.5 hidden size-4 text-muted-foreground opacity-40 transition-opacity duration-150 group-hover:opacity-100 sm:block"
            />
          )}
        </div>
      )}
    </li>
  );
}

// Default assignees

const UNASSIGNED = 'unassigned';

/**
 * One row per department the steps use: a member as the default assignee, or its queue. A stored
 * default that is no longer a member stays, with a warning, until someone picks another (rule 4).
 */
export function AssigneesEditor({
  form,
  stored,
  readOnly,
}: {
  form: TemplateFormMethods;
  /** The saved defaults, with their validity. */
  stored: TemplateAssignee[];
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [steps, assignees = []] = useWatch({
    control: form.control,
    name: ['steps', 'assignees'],
  });
  const departments = [...new Set(steps.map((step) => step.department))];

  if (departments.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('templates.assigneesEmpty')}</p>;
  }

  function choose(department: DepartmentCode, userId: string | null) {
    const others = assignees.filter((assignee) => assignee.department !== department);
    form.setValue('assignees', userId ? [...others, { department, userId }] : others, change(form));
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {departments.map((department) => {
        const index = assignees.findIndex((assignee) => assignee.department === department);
        return (
          <AssigneeRow
            key={department}
            department={department}
            userId={assignees[index]?.userId ?? null}
            stored={stored.find((assignee) => assignee.department === department)}
            error={
              index === -1 ? undefined : form.formState.errors.assignees?.[index]?.userId?.message
            }
            readOnly={readOnly}
            onChange={(userId) => choose(department, userId)}
          />
        );
      })}
    </ul>
  );
}

function AssigneeRow({
  department,
  userId,
  stored,
  error,
  readOnly,
  onChange,
}: {
  department: DepartmentCode;
  userId: string | null;
  stored: TemplateAssignee | undefined;
  error: string | undefined;
  readOnly: boolean;
  onChange: (userId: string | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const departmentName = useDepartmentNames();
  const members = useDepartmentMembers(department, !readOnly);
  // The stored default, kept while unchanged even when it is no longer valid.
  const kept = stored && stored.user.id === userId ? stored : undefined;
  const options = [
    { value: UNASSIGNED, label: t('templates.departmentQueue'), note: null as string | null },
    ...members.map((member) => ({ value: member.id, label: member.name, note: member.note })),
  ];
  if (kept && !members.some((member) => member.id === kept.user.id)) {
    options.push({
      value: kept.user.id,
      label: kept.user.name,
      note: t('templates.invalidAssigneeNote'),
    });
  }
  const invalid = !!kept && !kept.valid;
  const name = kept?.user.name ?? options.find((option) => option.value === userId)?.label;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <label htmlFor={id} className="font-medium sm:w-48 sm:shrink-0">
        {departmentName(department)}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {readOnly ? (
          <span className="flex items-center gap-2 text-sm">
            {userId && name ? (
              <>
                <Avatar name={name} size="sm" tone={invalid ? 'muted' : 'brand'} />
                {name}
              </>
            ) : (
              <span className="text-muted-foreground">{t('templates.departmentQueue')}</span>
            )}
          </span>
        ) : (
          <Select
            items={options.map(({ value, label }) => ({ value, label }))}
            value={userId ?? UNASSIGNED}
            onValueChange={(value) => onChange(!value || value === UNASSIGNED ? null : value)}
          >
            <SelectTrigger id={id} className="sm:max-w-sm" aria-invalid={!!error || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    {option.value !== UNASSIGNED && <Avatar name={option.label} size="sm" />}
                    {option.label}
                    {option.note && (
                      <span className="text-sm text-muted-foreground">{option.note}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {invalid && (
          <p className="flex items-start gap-1.5 text-sm text-status-warning-foreground">
            <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t('templates.invalidAssignee', { name: kept.user.name })}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
