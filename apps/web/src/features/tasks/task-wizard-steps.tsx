import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  CREATE_LIMITS,
  type DepartmentCode,
  keepsBriefFields,
  type ReadinessWarning,
  SUBTASK_LIMITS,
  SUBTASK_RUN_MODES,
  type SubtaskRunMode,
  suggestSubtaskDates,
  TASK_LIMITS,
  taskBriefDocSchema,
  taskCommentDocSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldError,
  FieldLabel,
  IconButton,
  Input,
  Progress,
  RadioCard,
  RadioGroup,
  type RichTextDoc,
  RichTextEditor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  EllipsisIcon,
  FileIcon,
  GripVerticalIcon,
  ImageUpIcon,
  ListPlusIcon,
  PaperclipIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import {
  type Dispatch,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import {
  formatCalendarDate,
  formatFileSize,
  formatList,
  formatNumber,
  formatPeriod,
} from '../../lib/format';
import { uploadFile } from '../files/files.queries';
import { namedFiles, pastedFiles } from '../files/held-uploads';
import { holidaysQuery } from '../hr/hr.queries';
import { useDepartmentNames } from '../projects/project-badges';
import { BriefFieldsEditor, briefFieldProblem } from './brief-fields-editor';
import { type Addressee, AddresseeSelect } from './task-comments';
import {
  EstimateInput,
  ItemsEditor,
  type TaskFormMethods,
  useAssigneeOptions,
  useDepartments,
} from './task-form';
import { useMentions, useRichTextLabels } from './task-rich-text';
import {
  type FileTarget,
  moveStage,
  moveSubtask,
  removeQuestion,
  removeStage,
  removeSubtask,
  uploadAge,
  type WizardFile,
  type WizardStep,
  type WizardSubtask,
  type WizardValues,
  withRunMode,
} from './task-wizard-draft';

/*
 * F06B screen 1: the steps of the creation wizard after Basics. Every step is optional; the draft
 * is one form (`createTaskSchema`) plus the held files, checked together on save.
 */

type SetFiles = Dispatch<SetStateAction<WizardFile[]>>;

const change = { shouldDirty: true } as const;

/** Applies a change that touches the subtasks, the stages and the files together. */
function useDraftChange(form: TaskFormMethods, setFiles: SetFiles) {
  return (next: { values: WizardValues; files?: WizardFile[] }) => {
    form.setValue('runMode', next.values.runMode, change);
    form.setValue('stages', next.values.stages ?? [], change);
    form.setValue('subtasks', next.values.subtasks ?? [], change);
    form.setValue('questions', next.values.questions ?? [], change);
    if (next.files) setFiles(next.files);
  };
}

// Uploads

/** Rule C3: files are uploaded as soon as they are dropped, pasted or chosen, then held. */
export function useWizardUploads(setFiles: SetFiles) {
  const { t } = useTranslation();
  const controllers = useRef(new Map<string, AbortController>());
  // Thumbnails of the images picked in this visit; a reload keeps the file, not its picture.
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  const patch = (key: string, change: Partial<WizardFile>) =>
    setFiles((current) =>
      current.map((file) => (file.key === key ? { ...file, ...change } : file)),
    );

  /** Uploads up to `room` of the files for `target`; the rest are refused with a notice. */
  function add(picked: readonly File[], target: FileTarget, pasted: boolean, room: number) {
    if (picked.length === 0) {
      // Edge case 18: a copied file reference the browser cannot read.
      toast.add({ title: t('tasks.attachments.nothingToPaste'), type: 'error' });
      return;
    }
    if (picked.length > room) {
      toast.add({
        title:
          target.kind === 'question'
            ? t('tasks.attachments.limit', { max: TASK_LIMITS.attachments })
            : t('tasks.wizard.files.limit', { max: CREATE_LIMITS.files }),
        type: 'error',
      });
    }
    for (const file of namedFiles(picked.slice(0, Math.max(0, room)), new Date(), pasted)) {
      const key = crypto.randomUUID();
      const controller = new AbortController();
      controllers.current.set(key, controller);
      if (file.type.startsWith('image/')) {
        setPreviews((current) => ({ ...current, [key]: URL.createObjectURL(file) }));
      }
      setFiles((current) => [
        ...current,
        {
          key,
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type,
          uploadId: null,
          progress: 0,
          failed: null,
          uploadedAt: null,
          role: 'reference',
          target,
        },
      ]);
      uploadFile(file, {
        signal: controller.signal,
        onProgress: (progress) => patch(key, { progress }),
      })
        .then((upload) =>
          patch(key, {
            uploadId: upload.uploadId,
            progress: 1,
            uploadedAt: new Date().toISOString(),
          }),
        )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          patch(key, { failed: errorMessage(t, error) });
        })
        .finally(() => controllers.current.delete(key));
    }
  }

  function remove(key: string) {
    controllers.current.get(key)?.abort();
    setFiles((current) => current.filter((file) => file.key !== key));
  }

  return { add, remove, previews };
}

export type WizardUploads = ReturnType<typeof useWizardUploads>;

/** Files of the task and its subtasks, against the creation limit (questions have their own). */
export const taskFiles = (files: WizardFile[]) =>
  files.filter((file) => file.target.kind !== 'question');

// Subtasks

const blankSubtask = (values: WizardValues, stageIndex: number | null): WizardSubtask => ({
  title: '',
  department: values.department ?? 'design',
  assigneeId: null,
  dueDate: values.dueDate ?? '',
  priority: 'normal',
  estimateMinutes: null,
  stageIndex,
  briefDoc: null,
  briefFields: null,
  checklist: [],
  criteria: [],
  files: [],
});

export function SubtasksStep({
  form,
  files,
  setFiles,
  accountManagerId,
}: {
  form: TaskFormMethods;
  files: WizardFile[];
  setFiles: SetFiles;
  accountManagerId: string | null;
}) {
  const { t } = useTranslation();
  const apply = useDraftChange(form, setFiles);
  const [runMode, stages = [], subtasks = [], dueDate] = useWatch({
    control: form.control,
    name: ['runMode', 'stages', 'subtasks', 'dueDate'],
  });
  const mode = runMode ?? 'sequential';
  const holidays = useHolidays(dueDate);
  const full = subtasks.length >= SUBTASK_LIMITS.subtasks;
  // A new row's title takes the focus once it is drawn.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  // Rows are keyed by position: a move or a removal draws them again, so each brief editor
  // (which reads its value when it mounts) shows its own subtask.
  const [round, setRound] = useState(0);
  const reorder = (next: Parameters<typeof apply>[0]) => {
    apply(next);
    setFocusRow(null);
    setRound((current) => current + 1);
  };

  const values = () => form.getValues();
  const add = (stageIndex: number | null) => {
    const current = values();
    const next = [...(current.subtasks ?? []), blankSubtask(current, stageIndex)];
    form.setValue('runMode', current.runMode ?? mode, change);
    form.setValue('subtasks', next, change);
    setFocusRow(next.length - 1);
  };
  const setMode = (next: SubtaskRunMode) =>
    apply({ values: withRunMode(values(), next, t('tasks.wizard.subtasks.firstStage')) });
  const suggest = () => {
    const current = values();
    if (!current.dueDate) return;
    const dates = suggestSubtaskDates({
      mode,
      from: businessDate(),
      parentDueDate: current.dueDate,
      holidays,
      subtasks: (current.subtasks ?? []).map((subtask) => ({
        estimateMinutes: subtask.estimateMinutes ?? null,
        stageIndex: subtask.stageIndex ?? null,
      })),
    });
    form.setValue(
      'subtasks',
      (current.subtasks ?? []).map((subtask, index) => ({
        ...subtask,
        dueDate: dates[index] ?? subtask.dueDate,
      })),
      change,
    );
    toast.add({ title: t('tasks.wizard.subtasks.suggested'), type: 'success' });
  };
  const move = (from: number, to: number, stageIndex?: number | null) => {
    const current = values();
    const moved = moveSubtask(current, files, from, to);
    if (stageIndex !== undefined && moved.values.subtasks) {
      moved.values.subtasks = moved.values.subtasks.map((subtask, index) =>
        index === to ? { ...subtask, stageIndex } : subtask,
      );
    }
    reorder(moved);
  };

  const rows = (indexes: number[]) => (
    <ol className="flex flex-col gap-2">
      {indexes.map((index) => (
        <SubtaskRow
          key={`${round}:${index}`}
          form={form}
          index={index}
          count={subtasks.length}
          stages={stages}
          mode={mode}
          autoFocus={focusRow === index}
          accountManagerId={accountManagerId}
          onMove={move}
          onRemove={() => reorder(removeSubtask(values(), files, index))}
        />
      ))}
    </ol>
  );

  return (
    <div className="flex flex-col gap-5">
      <RunModeCards value={mode} onChange={setMode} />
      {mode === 'stages' ? (
        <div className="flex flex-col gap-4">
          {stages.map((stage, stageIndex) => (
            <StageGroup
              // biome-ignore lint/suspicious/noArrayIndexKey: stages are drafts without ids
              key={stageIndex}
              form={form}
              index={stageIndex}
              count={stages.length}
              name={stage.name}
              empty={!subtasks.some((subtask) => subtask.stageIndex === stageIndex)}
              onMove={(to) => reorder({ values: moveStage(values(), stageIndex, to) })}
              onRemove={() => reorder({ values: removeStage(values(), stageIndex) })}
              onAdd={() => add(stageIndex)}
              addDisabled={full}
            >
              {rows(
                subtasks.flatMap((subtask, index) =>
                  subtask.stageIndex === stageIndex ? [index] : [],
                ),
              )}
            </StageGroup>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={stages.length >= SUBTASK_LIMITS.stages}
            onClick={() =>
              form.setValue(
                'stages',
                [
                  ...stages,
                  {
                    name: t('tasks.wizard.subtasks.stageN', {
                      n: formatNumber(stages.length + 1),
                    }),
                  },
                ],
                change,
              )
            }
          >
            <ListPlusIcon />
            {t('tasks.subtasks.addStage')}
          </Button>
        </div>
      ) : (
        <>
          {subtasks.length > 0 && rows(subtasks.map((_, index) => index))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={full}
            onClick={() => add(null)}
          >
            <PlusIcon />
            {t('tasks.wizard.subtasks.add')}
          </Button>
        </>
      )}
      {full && (
        <p className="text-sm text-muted-foreground">
          {t('tasks.wizard.subtasks.limit', { max: formatNumber(SUBTASK_LIMITS.subtasks) })}
        </p>
      )}
      {subtasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button type="button" variant="outline" disabled={!dueDate} onClick={suggest}>
            <SparklesIcon />
            {t('tasks.wizard.subtasks.suggest')}
          </Button>
          <p className="text-sm text-muted-foreground">
            {dueDate
              ? t('tasks.wizard.subtasks.suggestHint')
              : t('tasks.wizard.subtasks.suggestNeedsDue')}
          </p>
        </div>
      )}
    </div>
  );
}

/** Public holidays of the years from today to the due date (F17 rule 1), for suggested dates. */
function useHolidays(dueDate: string | undefined) {
  const thisYear = Number(businessDate().slice(0, 4));
  const dueYear = dueDate ? Number(dueDate.slice(0, 4)) : thisYear;
  const first = useQuery(holidaysQuery(thisYear));
  const second = useQuery({ ...holidaysQuery(dueYear), enabled: dueYear !== thisYear });
  return [
    ...(first.data?.items ?? []),
    ...(dueYear !== thisYear ? (second.data?.items ?? []) : []),
  ];
}

/** Rule A3: the three run modes, each with a small diagram. */
function RunModeCards({
  value,
  onChange,
}: {
  value: SubtaskRunMode;
  onChange: (mode: SubtaskRunMode) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-sm font-medium">
        {t('tasks.subtasks.runMode')}
      </span>
      <RadioGroup<SubtaskRunMode>
        aria-labelledby={id}
        value={value}
        onValueChange={(next) => onChange(next)}
        className="sm:grid-cols-3"
      >
        {SUBTASK_RUN_MODES.map((mode) => (
          <RadioCard<SubtaskRunMode>
            key={mode}
            value={mode}
            title={
              <span className="flex flex-col gap-2">
                <ModeDiagram mode={mode} />
                {t(`tasks.subtasks.runModes.${mode}`)}
              </span>
            }
            description={t(`tasks.wizard.subtasks.modeHints.${mode}`)}
          />
        ))}
      </RadioGroup>
    </div>
  );
}

/** Boxes in a line, side by side, or in columns: the shape of each mode. */
function ModeDiagram({ mode }: { mode: SubtaskRunMode }) {
  const box = 'h-2.5 rounded-xs bg-muted-foreground/40';
  return (
    <span aria-hidden="true" className="flex h-10 w-24 items-center gap-1">
      {mode === 'sequential' && (
        <span className="flex w-full flex-col gap-1">
          <span className={cn(box, 'w-8')} />
          <span className={cn(box, 'ms-4 w-8')} />
          <span className={cn(box, 'ms-8 w-8')} />
        </span>
      )}
      {mode === 'parallel' &&
        [0, 1, 2].map((lane) => <span key={lane} className={cn(box, 'h-8 flex-1')} />)}
      {mode === 'stages' && (
        <>
          <span className="flex flex-1 flex-col gap-1">
            <span className={box} />
          </span>
          <span className="flex flex-1 flex-col gap-1">
            <span className={box} />
            <span className={box} />
          </span>
          <span className="flex flex-1 flex-col gap-1">
            <span className={box} />
          </span>
        </>
      )}
    </span>
  );
}

function StageGroup({
  form,
  index,
  count,
  name,
  empty,
  onMove,
  onRemove,
  onAdd,
  addDisabled,
  children,
}: {
  form: TaskFormMethods;
  index: number;
  count: number;
  name: string;
  empty: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const error = form.formState.errors.stages?.[index]?.name;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field invalid={!!error} className="min-w-48 flex-1">
          <FieldLabel htmlFor={id}>
            {t('tasks.wizard.subtasks.stageNumber', { n: formatNumber(index + 1) })}
          </FieldLabel>
          <Input
            id={id}
            maxLength={80}
            value={name}
            onChange={(event) => form.setValue(`stages.${index}.name`, event.target.value, change)}
          />
          <FieldError match={!!error}>{t('tasks.subtasks.errors.stageName')}</FieldError>
        </Field>
        <IconButton
          variant="outline"
          size="icon"
          label={t('tasks.wizard.subtasks.stageEarlier', { name })}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowUpIcon />
        </IconButton>
        <IconButton
          variant="outline"
          size="icon"
          label={t('tasks.wizard.subtasks.stageLater', { name })}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1)}
        >
          <ArrowDownIcon />
        </IconButton>
        <IconButton
          variant="outline"
          size="icon"
          label={t('tasks.wizard.subtasks.removeStage', { name })}
          disabled={count === 1}
          onClick={onRemove}
        >
          <Trash2Icon />
        </IconButton>
      </div>
      {empty && (
        <p className="text-sm text-muted-foreground">{t('tasks.wizard.subtasks.emptyStage')}</p>
      )}
      {children}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        disabled={addDisabled}
        onClick={onAdd}
      >
        <PlusIcon />
        {t('tasks.wizard.subtasks.addTo', { name })}
      </Button>
    </section>
  );
}

function SubtaskRow({
  form,
  index,
  count,
  stages,
  mode,
  autoFocus,
  accountManagerId,
  onMove,
  onRemove,
}: {
  form: TaskFormMethods;
  index: number;
  count: number;
  stages: { name: string }[];
  mode: SubtaskRunMode;
  autoFocus: boolean;
  /** The client's account manager: own-clients assign scope (F06B rule A2). */
  accountManagerId: string | null;
  onMove: (from: number, to: number, stageIndex?: number | null) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const labels = useRichTextLabels();
  const departments = useDepartments();
  const subtask = useWatch({ control: form.control, name: `subtasks.${index}` });
  const parentDue = useWatch({ control: form.control, name: 'dueDate' });
  const { options } = useAssigneeOptions(subtask?.department, accountManagerId);
  const errors = form.formState.errors.subtasks?.[index];
  const ids = {
    title: useId(),
    department: useId(),
    assignee: useId(),
    due: useId(),
    estimate: useId(),
    stage: useId(),
    brief: useId(),
  };
  const title = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) title.current?.focus();
  }, [autoFocus]);
  if (!subtask) return null;
  const set = <K extends keyof WizardSubtask>(key: K, value: WizardSubtask[K]) =>
    form.setValue(`subtasks.${index}.${key}` as `subtasks.${number}.title`, value as string, {
      ...change,
      shouldValidate: form.formState.isSubmitted,
    });
  const name = subtask.title || t('tasks.wizard.subtasks.untitled', { n: formatNumber(index + 1) });
  const extras =
    (subtask.criteria?.length ?? 0) + (subtask.briefFields ? 1 : 0) + (subtask.briefDoc ? 1 : 0);

  return (
    <li
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData('text/x-subtask', String(index));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event: DragEvent) => {
        if (event.dataTransfer.types.includes('text/x-subtask')) event.preventDefault();
      }}
      onDrop={(event: DragEvent) => {
        const from = Number(event.dataTransfer.getData('text/x-subtask'));
        if (Number.isNaN(from) || from === index) return;
        event.preventDefault();
        onMove(from, index, mode === 'stages' ? (subtask.stageIndex ?? 0) : undefined);
      }}
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
    >
      <div className="flex items-start gap-2">
        <GripVerticalIcon
          aria-hidden="true"
          className="mt-8 size-4 shrink-0 cursor-grab text-muted-foreground"
        />
        <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field invalid={!!errors?.title} className="sm:col-span-2 lg:col-span-6">
            <FieldLabel htmlFor={ids.title}>{t('tasks.form.title')}</FieldLabel>
            <Input
              ref={title}
              id={ids.title}
              autoComplete="off"
              maxLength={160}
              value={subtask.title}
              onChange={(event) => set('title', event.target.value)}
            />
            <FieldError match={!!errors?.title}>{t('tasks.form.errors.title')}</FieldError>
          </Field>
          <Field className="lg:col-span-2">
            <FieldLabel id={ids.department} render={<span />}>
              {t('tasks.form.department')}
            </FieldLabel>
            <Select
              items={departments.map(({ code, name: label }) => ({ value: code, label }))}
              value={subtask.department}
              onValueChange={(value) => {
                if (!value) return;
                const next = value as DepartmentCode;
                if (!keepsBriefFields(subtask.department, next)) set('briefFields', null);
                set('department', next);
                set('assigneeId', null);
              }}
            >
              <SelectTrigger aria-labelledby={ids.department}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map(({ code, name: label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field invalid={!!errors?.assigneeId} className="lg:col-span-2">
            <FieldLabel id={ids.assignee} render={<span />}>
              {t('tasks.form.assignee')}
            </FieldLabel>
            <Select
              items={[
                { value: '', label: t('tasks.subtasks.queue') },
                ...options.map((option) => ({ value: option.id, label: option.name })),
              ]}
              value={subtask.assigneeId ?? ''}
              onValueChange={(value) => set('assigneeId', value || null)}
            >
              <SelectTrigger aria-labelledby={ids.assignee}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('tasks.subtasks.queue')}</SelectItem>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field invalid={!!errors?.dueDate} className="lg:col-span-2">
            <FieldLabel htmlFor={ids.due}>{t('tasks.form.dueDate')}</FieldLabel>
            <Input
              id={ids.due}
              type="date"
              dir="ltr"
              min={businessDate()}
              max={parentDue || undefined}
              value={subtask.dueDate}
              onChange={(event) => set('dueDate', event.target.value)}
            />
            <FieldError match={!!errors?.dueDate}>{t('tasks.subtasks.errors.dueDate')}</FieldError>
          </Field>
          <Field className="lg:col-span-3">
            <FieldLabel id={ids.estimate} render={<span />}>
              {t('tasks.subtasks.estimate')}
            </FieldLabel>
            <EstimateInput
              value={subtask.estimateMinutes}
              onChange={(value) => set('estimateMinutes', value)}
              labelledBy={ids.estimate}
            />
          </Field>
          {mode === 'stages' && (
            <Field className="lg:col-span-3">
              <FieldLabel id={ids.stage} render={<span />}>
                {t('tasks.subtasks.stage')}
              </FieldLabel>
              <Select
                items={stages.map((stage, stageIndex) => ({
                  value: String(stageIndex),
                  label: stage.name,
                }))}
                value={String(subtask.stageIndex ?? 0)}
                onValueChange={(value) => set('stageIndex', Number(value))}
              >
                <SelectTrigger aria-labelledby={ids.stage}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage, stageIndex) => (
                    <SelectItem
                      // biome-ignore lint/suspicious/noArrayIndexKey: stages are drafts without ids
                      key={stageIndex}
                      value={String(stageIndex)}
                    >
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton className="mt-6" label={t('tasks.subtasks.moveOf', { title: name })} />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={index === 0} onClick={() => onMove(index, index - 1)}>
              <ArrowUpIcon />
              {t('tasks.subtasks.moveUp')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === count - 1}
              onClick={() => onMove(index, index + 1)}
            >
              <ArrowDownIcon />
              {t('tasks.subtasks.moveDown')}
            </DropdownMenuItem>
            {mode === 'stages' &&
              stages.map((stage, stageIndex) =>
                stageIndex === subtask.stageIndex ? null : (
                  <DropdownMenuItem
                    // biome-ignore lint/suspicious/noArrayIndexKey: stages are drafts without ids
                    key={stageIndex}
                    onClick={() => set('stageIndex', stageIndex)}
                  >
                    {t('tasks.wizard.subtasks.toStage', { name: stage.name })}
                  </DropdownMenuItem>
                ),
              )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2Icon />
              {t('tasks.wizard.subtasks.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Collapsible>
        <CollapsibleTrigger className="w-fit text-sm font-medium text-primary">
          {extras > 0
            ? t('tasks.wizard.subtasks.detailsCount', { n: formatNumber(extras) })
            : t('tasks.wizard.subtasks.details')}
        </CollapsibleTrigger>
        <CollapsiblePanel className="flex flex-col gap-4 pt-3">
          <Field>
            <FieldLabel id={ids.brief} render={<span />}>
              {t('tasks.form.brief')}
            </FieldLabel>
            <RichTextEditor
              aria-labelledby={ids.brief}
              defaultValue={subtask.briefDoc as RichTextDoc | null | undefined}
              labels={labels}
              compact
              onChange={(doc) => {
                const parsed = taskBriefDocSchema.safeParse(doc);
                set('briefDoc', parsed.success ? parsed.data : null);
              }}
            />
          </Field>
          <BriefFieldsEditor
            department={subtask.department}
            value={subtask.briefFields}
            onChange={(value) => set('briefFields', value)}
            invalid={briefFieldProblem(errors?.briefFields)}
          />
          <ItemsEditor
            label={t('tasks.form.criteria')}
            placeholder={t('tasks.form.criteriaPlaceholder')}
            hint={t('tasks.form.criteriaHint')}
            limit={TASK_LIMITS.criteria}
            value={subtask.criteria ?? []}
            onChange={(value) => set('criteria', value)}
          />
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

// Files

export function FilesStep({
  form,
  files,
  setFiles,
  uploads,
}: {
  form: TaskFormMethods;
  files: WizardFile[];
  setFiles: SetFiles;
  uploads: WizardUploads;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const subtasks = useWatch({ control: form.control, name: 'subtasks' }) ?? [];
  const held = taskFiles(files);
  const room = CREATE_LIMITS.files - held.length;
  const receive = (picked: File[], pasted: boolean) =>
    uploads.add(picked, { kind: 'task' }, pasted, room);
  // A paste anywhere on the step outside a field lands here.
  const receiveRef = useRef(receive);
  receiveRef.current = receive;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = pastedFiles(event);
      if (pasted === null) return;
      event.preventDefault();
      receiveRef.current(pasted, true);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);
  const patch = (key: string, change: Partial<WizardFile>) =>
    setFiles((current) =>
      current.map((file) => (file.key === key ? { ...file, ...change } : file)),
    );
  const subtaskName = (index: number) =>
    subtasks[index]?.title || t('tasks.wizard.subtasks.untitled', { n: formatNumber(index + 1) });

  return (
    <div className="flex flex-col gap-4">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a shortcut; the button picks files */}
      <div
        onDragOver={(event: DragEvent) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          receive([...event.dataTransfer.files], false);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-8 text-center',
          dragging && 'border-primary bg-muted',
        )}
      >
        <ImageUpIcon aria-hidden="true" className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('tasks.wizard.files.dropHint')}</p>
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            receive([...(event.target.files ?? [])], false);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={room <= 0}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
          {t('tasks.wizard.files.choose')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t('tasks.wizard.files.limitHint', {
            n: formatNumber(held.length),
            max: formatNumber(CREATE_LIMITS.files),
          })}
        </p>
      </div>
      {held.length > 0 && (
        <ul className="flex flex-col gap-2">
          {held.map((file) => (
            <FileRow
              key={file.key}
              file={file}
              preview={uploads.previews[file.key]}
              subtaskNames={subtasks.map((_, index) => subtaskName(index))}
              onChange={(change) => patch(file.key, change)}
              onRemove={() => uploads.remove(file.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The state of a held upload: its progress, its failure, or its age (edge case 17). */
function UploadState({ file }: { file: WizardFile }) {
  const { t } = useTranslation();
  const age = uploadAge(file, new Date());
  if (file.failed) {
    return (
      <span role="alert" className="text-xs text-destructive-text">
        {file.failed}
      </span>
    );
  }
  if (age === 'uploading') {
    return (
      <Progress
        value={file.progress * 100}
        aria-label={t('tasks.attachments.uploading', { name: file.name })}
      />
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {formatFileSize(file.sizeBytes)}
      {age === 'aging' && <Badge tone="warning">{t('tasks.wizard.files.aging')}</Badge>}
      {age === 'expired' && <Badge tone="danger">{t('tasks.wizard.files.expired')}</Badge>}
    </span>
  );
}

function FileRow({
  file,
  preview,
  subtaskNames,
  onChange,
  onRemove,
}: {
  file: WizardFile;
  preview: string | undefined;
  subtaskNames: string[];
  onChange: (change: Partial<WizardFile>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ids = { role: useId(), target: useId() };
  const target = file.target.kind === 'subtask' ? String(file.target.index) : 'task';
  const targets = [
    { value: 'task', label: t('tasks.wizard.files.onTask') },
    ...subtaskNames.map((name, index) => ({ value: String(index), label: name })),
  ];
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center',
        (file.failed || uploadAge(file, new Date()) === 'expired') && 'border-destructive-text',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {preview ? (
          <img src={preview} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-sm bg-muted">
            <FileIcon aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium" dir="auto">
            {file.name}
          </span>
          <UploadState file={file} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span id={ids.role} className="sr-only">
          {t('tasks.wizard.files.role')}
        </span>
        <ToggleGroup
          aria-labelledby={ids.role}
          value={[file.role]}
          onValueChange={(next: WizardFile['role'][]) => next[0] && onChange({ role: next[0] })}
        >
          <ToggleGroupItem value="reference">{t('tasks.wizard.files.reference')}</ToggleGroupItem>
          <ToggleGroupItem value="deliverable">
            {t('tasks.wizard.files.deliverable')}
          </ToggleGroupItem>
        </ToggleGroup>
        <span id={ids.target} className="sr-only">
          {t('tasks.wizard.files.target', { name: file.name })}
        </span>
        <Select
          items={targets}
          value={target}
          onValueChange={(value) =>
            onChange({
              target:
                !value || value === 'task'
                  ? { kind: 'task' }
                  : { kind: 'subtask', index: Number(value) },
            })
          }
        >
          <SelectTrigger aria-labelledby={ids.target} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton label={t('common.remove', { label: file.name })} onClick={onRemove}>
          <XIcon />
        </IconButton>
      </div>
    </li>
  );
}

// Questions

export function QuestionsStep({
  form,
  files,
  setFiles,
  uploads,
}: {
  form: TaskFormMethods;
  files: WizardFile[];
  setFiles: SetFiles;
  uploads: WizardUploads;
}) {
  const { t } = useTranslation();
  const apply = useDraftChange(form, setFiles);
  const questions = useWatch({ control: form.control, name: 'questions' }) ?? [];
  // Cards are keyed by position: a removal draws them again, so each editor shows its question.
  const [round, setRound] = useState(0);
  const full = questions.length >= CREATE_LIMITS.questions;
  return (
    <div className="flex flex-col gap-4">
      {questions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('tasks.wizard.questions.empty')}</p>
      )}
      <ol className="flex flex-col gap-3">
        {questions.map((_, index) => (
          <QuestionCard
            // biome-ignore lint/suspicious/noArrayIndexKey: questions are drafts without ids
            key={`${round}:${index}`}
            form={form}
            index={index}
            files={files.filter(
              (file) => file.target.kind === 'question' && file.target.index === index,
            )}
            uploads={uploads}
            onRemove={() => {
              apply(removeQuestion(form.getValues(), files, index));
              setRound((current) => current + 1);
            }}
          />
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={full}
        onClick={() =>
          form.setValue(
            'questions',
            [
              ...questions,
              { bodyDoc: { type: 'doc', content: [] }, addressedDepartment: undefined },
            ],
            change,
          )
        }
      >
        <CircleHelpIcon />
        {t('tasks.wizard.questions.add')}
      </Button>
      {full && (
        <p className="text-sm text-muted-foreground">
          {t('tasks.wizard.questions.limit', { max: formatNumber(CREATE_LIMITS.questions) })}
        </p>
      )}
    </div>
  );
}

function QuestionCard({
  form,
  index,
  files,
  uploads,
  onRemove,
}: {
  form: TaskFormMethods;
  index: number;
  files: WizardFile[];
  uploads: WizardUploads;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const labels = useRichTextLabels();
  const mentions = useMentions();
  const ids = { addressee: useId(), body: useId() };
  const input = useRef<HTMLInputElement>(null);
  const question = useWatch({ control: form.control, name: `questions.${index}` });
  const errors = form.formState.errors.questions?.[index];
  if (!question) return null;
  const addressee: Addressee | null = question.addressedUserId
    ? `user:${question.addressedUserId}`
    : question.addressedDepartment
      ? `department:${question.addressedDepartment}`
      : null;
  const room = TASK_LIMITS.attachments - files.length;
  const attach = (picked: File[], pasted: boolean) =>
    uploads.add(picked, { kind: 'question', index }, pasted, room);
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex items-end gap-2">
        <Field invalid={!!errors?.addressedUserId} className="flex-1">
          <FieldLabel htmlFor={ids.addressee}>{t('tasks.questions.addressee')}</FieldLabel>
          <AddresseeSelect
            id={ids.addressee}
            value={addressee}
            onChange={(value) => {
              const [type, id] = (value?.split(':') ?? []) as [string?, string?];
              form.setValue(
                `questions.${index}`,
                {
                  ...question,
                  addressedUserId: type === 'user' ? id : undefined,
                  addressedDepartment: type === 'department' ? (id as DepartmentCode) : undefined,
                },
                { ...change, shouldValidate: form.formState.isSubmitted },
              );
            }}
          />
          <FieldError match={!!errors?.addressedUserId}>
            {t('tasks.questions.errors.addressee')}
          </FieldError>
        </Field>
        <IconButton
          variant="outline"
          size="icon"
          label={t('tasks.wizard.questions.remove', { n: formatNumber(index + 1) })}
          onClick={onRemove}
        >
          <Trash2Icon />
        </IconButton>
      </div>
      <Field invalid={!!errors?.bodyDoc}>
        <FieldLabel id={ids.body} render={<span />}>
          {t('tasks.questions.label')}
        </FieldLabel>
        <RichTextEditor
          aria-labelledby={ids.body}
          defaultValue={question.bodyDoc as RichTextDoc | null | undefined}
          labels={labels}
          mentions={mentions}
          compact
          invalid={!!errors?.bodyDoc}
          onChange={(doc) => {
            const parsed = taskCommentDocSchema.safeParse(doc);
            form.setValue(
              `questions.${index}.bodyDoc`,
              parsed.success ? parsed.data : { type: 'doc', content: [] },
              { ...change, shouldValidate: form.formState.isSubmitted },
            );
          }}
          onFiles={(picked, source) => attach(picked, source === 'paste')}
        />
        <FieldError match={!!errors?.bodyDoc}>{t('tasks.comments.errors.body')}</FieldError>
      </Field>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((file) => (
            <li
              key={file.key}
              className={cn(
                'flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm',
                file.failed && 'border-destructive-text',
              )}
            >
              <PaperclipIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate" dir="auto">
                  {file.name}
                </span>
                <UploadState file={file} />
              </span>
              <IconButton
                label={t('common.remove', { label: file.name })}
                onClick={() => uploads.remove(file.key)}
              >
                <XIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            attach([...(event.target.files ?? [])], false);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={room <= 0}
          onClick={() => input.current?.click()}
        >
          <PaperclipIcon />
          {t('tasks.attachments.add')}
        </Button>
      </div>
    </li>
  );
}

// Review

/** Rule C5: one readiness warning in words, with where to fix it. */
export function useWarningText() {
  const { t } = useTranslation();
  return (warning: ReadinessWarning): string => {
    const hours = (minutes: number | undefined) => formatNumber((minutes ?? 0) / 60);
    switch (warning.code) {
      case 'assignee_on_leave':
        return t('tasks.wizard.review.warnings.assignee_on_leave', {
          dates: formatList(
            (warning.leaves ?? []).map((leave) =>
              leave.startsOn === leave.endsOn
                ? formatCalendarDate(leave.startsOn)
                : formatPeriod(leave.startsOn, leave.endsOn),
            ),
          ),
        });
      case 'assignee_overloaded':
        return t('tasks.wizard.review.warnings.assignee_overloaded', {
          hours: hours(warning.estimatedMinutes),
          capacity: hours(warning.capacityMinutes),
        });
      case 'due_on_day_off':
        return t('tasks.wizard.review.warnings.due_on_day_off', {
          date: warning.suggestedDate ? formatCalendarDate(warning.suggestedDate) : '',
        });
      default:
        return t(`tasks.wizard.review.warnings.${warning.code}`);
    }
  };
}

/** The readiness warnings, each naming its task and linking to the step that fixes it. */
export function ReadinessWarnings({
  warnings,
  subtaskTitles,
  onGoTo,
}: {
  warnings: ReadinessWarning[];
  subtaskTitles: string[];
  onGoTo?: (step: WizardStep) => void;
}) {
  const { t } = useTranslation();
  const text = useWarningText();
  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((warning, index) => {
        const step: WizardStep = warning.subtaskIndex === null ? 'basics' : 'subtasks';
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: warnings have no id
            key={index}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm sm:flex-row sm:items-center"
          >
            <TriangleAlertIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-status-warning-foreground"
            />
            <span className="flex flex-1 flex-col">
              <span className="font-medium">
                {warning.subtaskIndex === null
                  ? t('tasks.wizard.review.theTask')
                  : (subtaskTitles[warning.subtaskIndex] ??
                    t('tasks.wizard.subtasks.untitled', {
                      n: formatNumber(warning.subtaskIndex + 1),
                    }))}
              </span>
              <span className="text-muted-foreground">{text(warning)}</span>
            </span>
            {onGoTo && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onGoTo(step)}>
                {t('tasks.wizard.review.goTo', { step: t(`tasks.wizard.steps.${step}`) })}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewStep({
  form,
  files,
  warnings,
  checking,
  onGoTo,
}: {
  form: TaskFormMethods;
  files: WizardFile[];
  warnings: ReadinessWarning[] | undefined;
  checking: boolean;
  onGoTo: (step: WizardStep) => void;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const values = useWatch({ control: form.control });
  const subtasks = values.subtasks ?? [];
  const questions = values.questions ?? [];
  const rows: { step: WizardStep; label: string; value: string }[] = [
    {
      step: 'basics',
      label: t('tasks.wizard.review.task'),
      value: [
        values.title || t('tasks.wizard.review.noTitle'),
        values.department ? departmentName(values.department) : null,
        values.dueDate ? formatCalendarDate(values.dueDate) : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    {
      step: 'subtasks',
      label: t('tasks.wizard.steps.subtasks'),
      value:
        subtasks.length === 0
          ? t('tasks.wizard.review.none')
          : t('tasks.wizard.review.subtasks', {
              n: formatNumber(subtasks.length),
              mode: t(`tasks.subtasks.runModes.${values.runMode ?? 'sequential'}`),
            }),
    },
    {
      step: 'files',
      label: t('tasks.wizard.steps.files'),
      value:
        taskFiles(files).length === 0
          ? t('tasks.wizard.review.none')
          : formatNumber(taskFiles(files).length),
    },
    {
      step: 'questions',
      label: t('tasks.wizard.steps.questions'),
      value:
        questions.length === 0 ? t('tasks.wizard.review.none') : formatNumber(questions.length),
    },
  ];
  return (
    <div className="flex flex-col gap-5">
      <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <div key={row.step} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <dt className="w-28 text-sm text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-sm font-medium">{row.value}</dd>
            <Button type="button" variant="ghost" size="sm" onClick={() => onGoTo(row.step)}>
              {t('tasks.wizard.review.edit')}
            </Button>
          </div>
        ))}
      </dl>
      <section className="flex flex-col gap-3">
        <h3 className="font-bold">{t('tasks.wizard.review.readiness')}</h3>
        {checking && !warnings ? (
          <p className="text-sm text-muted-foreground">{t('tasks.wizard.review.checking')}</p>
        ) : !warnings ? (
          <p className="text-sm text-muted-foreground">{t('tasks.wizard.review.notChecked')}</p>
        ) : warnings.length === 0 ? (
          <Callout icon={<CircleCheckIcon />} title={t('tasks.wizard.review.ready')} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('tasks.wizard.review.warningsHint')}</p>
            <ReadinessWarnings
              warnings={warnings}
              subtaskTitles={subtasks.map((subtask) => subtask.title ?? '')}
              onGoTo={onGoTo}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** A subtask, question or file count beside a step's name in the step bar. */
export function stepCount(step: WizardStep, values: WizardValues, files: WizardFile[]): number {
  if (step === 'subtasks') return values.subtasks?.length ?? 0;
  if (step === 'files') return taskFiles(files).length;
  if (step === 'questions') return values.questions?.length ?? 0;
  return 0;
}
