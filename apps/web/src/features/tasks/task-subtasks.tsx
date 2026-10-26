import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from '@tanstack/react-router';
import {
  businessDate,
  type CreateSubtask,
  type CreateSubtaskInput,
  createSubtaskSchema,
  type DepartmentCode,
  isTaskFinished,
  isTaskOpen,
  SUBTASK_LIMITS,
  SUBTASK_RUN_MODES,
  type Subtask,
  type SubtaskRunMode,
  type TaskBriefDoc,
  type TaskDetail,
  type TaskStage,
  taskBriefDocSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BanIcon,
  CircleCheckIcon,
  GripVerticalIcon,
  HandshakeIcon,
  HourglassIcon,
  MoveIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { type DragEvent, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
import { useDepartmentNames } from '../projects/project-badges';
import { assigneeLeaves, LeaveWarningDialog } from './leave-warning';
import { BlockedBadge, formatDue, TaskOverdueBadge, TaskStatusBadge } from './task-badges';
import { useAssigneeOptions, useDepartments } from './task-form';
import { TaskSection } from './task-parts';
import { useRichTextLabels } from './task-rich-text';
import {
  useAddStage,
  useAddSubtask,
  useArchiveStage,
  useMoveTask,
  useReopenSubtasks,
  useReorderSubtasks,
  useSetHandoverNote,
  useSetRunMode,
  useUpdateStage,
} from './tasks.queries';

/*
 * F06B part A on the task page: a parent's subtasks by its run mode, with their timeline, the
 * stages and their handover summaries, and the actions of the parent's assignee and managers.
 * The API keeps the run dependencies and enforces every rule; the page only offers the actions
 * `permissions` grants.
 */

/** The parent's subtasks in order, with the stage each one sits in (null outside stages). */
type OrderItem = { id: string; stageId: string | null };

const orderOf = (task: TaskDetail): OrderItem[] =>
  task.subtasks.map((subtask) => ({
    id: subtask.id,
    stageId: task.runMode === 'stages' ? subtask.stageId : null,
  }));

/** `items` with `id` moved before `beforeId` (or last) in `stageId`. */
export function moveInOrder(
  items: readonly OrderItem[],
  id: string,
  stageId: string | null,
  beforeId: string | null,
): OrderItem[] {
  const rest = items.filter((item) => item.id !== id);
  const moved = { id, stageId };
  if (beforeId) {
    const at = rest.findIndex((item) => item.id === beforeId);
    if (at >= 0) return [...rest.slice(0, at), moved, ...rest.slice(at)];
  }
  // Last of its stage: after the stage's last subtask, else at the end.
  const lastOfStage = rest.map((item) => item.stageId).lastIndexOf(stageId);
  return lastOfStage >= 0
    ? [...rest.slice(0, lastOfStage + 1), moved, ...rest.slice(lastOfStage + 1)]
    : [...rest, moved];
}

const isCancelled = (subtask: Subtask) => subtask.status === 'cancelled';

export function SubtasksSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const manage = task.permissions.canManageSubtasks && !task.readOnly;
  const [adding, setAdding] = useState<{ stageId: string | null } | null>(null);
  const [reopening, setReopening] = useState(false);
  const [cancelling, setCancelling] = useState<Subtask | null>(null);
  const shownCancelling = useShownWhileClosing(cancelling);
  const reorder = useReorderSubtasks(task.id);
  const cancel = useMoveTask();
  const [cancelReason, setCancelReason] = useState('');
  const [dragged, setDragged] = useState<string | null>(null);
  const live = task.subtasks.filter((subtask) => !isCancelled(subtask));
  const canReopen =
    task.permissions.canReopenSubtasks &&
    task.status === 'revisions' &&
    task.subtasks.some((subtask) => subtask.status === 'delivered');
  if (task.parent || (task.subtasks.length === 0 && !manage)) return null;

  async function saveOrder(items: OrderItem[]) {
    try {
      await reorder.mutateAsync({ items });
      toast.add({ title: t('tasks.subtasks.reordered'), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  const move = (id: string, stageId: string | null, beforeId: string | null) =>
    saveOrder(moveInOrder(orderOf(task), id, stageId, beforeId));

  const rowProps = (subtask: Subtask, index: number, group: Subtask[]): RowProps => ({
    task,
    subtask,
    manage,
    dragging: dragged === subtask.id,
    onDragStart: () => setDragged(subtask.id),
    onDragEnd: () => setDragged(null),
    onDrop: () => {
      if (dragged && dragged !== subtask.id) void move(dragged, subtask.stageId, subtask.id);
      setDragged(null);
    },
    onMoveUp:
      index > 0 ? () => move(subtask.id, subtask.stageId, group[index - 1]?.id ?? null) : null,
    onMoveDown:
      index < group.length - 1
        ? () => move(subtask.id, subtask.stageId, group[index + 2]?.id ?? null)
        : null,
    onMoveToStage: (stageId) => move(subtask.id, stageId, null),
    onCancel: () => {
      setCancelReason('');
      setCancelling(subtask);
    },
  });

  return (
    <TaskSection
      title={t('tasks.subtasks.title')}
      count={
        task.progress
          ? t('tasks.subtasks.progress', {
              delivered: formatNumber(task.progress.delivered),
              total: formatNumber(task.progress.total),
            })
          : undefined
      }
      action={
        <span className="flex flex-wrap items-center gap-2">
          {canReopen && (
            <Button variant="outline" size="sm" onClick={() => setReopening(true)}>
              <RotateCcwIcon />
              {t('tasks.subtasks.reopen')}
            </Button>
          )}
          {manage && live.length < SUBTASK_LIMITS.subtasks && (
            <Button variant="ghost" size="sm" onClick={() => setAdding({ stageId: null })}>
              <PlusIcon />
              {t('tasks.subtasks.add')}
            </Button>
          )}
        </span>
      }
    >
      {task.subtasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('tasks.subtasks.empty')}</p>
      ) : (
        <>
          <RunModeBar task={task} manage={manage} />
          <Timeline subtasks={live} />
          {task.runMode === 'stages' ? (
            <StageGroups
              task={task}
              manage={manage}
              dragged={dragged}
              onDropInStage={(stageId) => {
                if (dragged) void move(dragged, stageId, null);
                setDragged(null);
              }}
              onAdd={(stageId) => setAdding({ stageId })}
              row={rowProps}
            />
          ) : (
            <ol className="flex flex-col gap-1.5">
              {task.subtasks.map((subtask, index) => (
                <SubtaskRow key={subtask.id} {...rowProps(subtask, index, task.subtasks)} />
              ))}
            </ol>
          )}
        </>
      )}
      {adding && (
        <AddSubtaskDialog parent={task} stageId={adding.stageId} onClose={() => setAdding(null)} />
      )}
      {canReopen && (
        <ReopenSubtasksDialog task={task} open={reopening} onClose={() => setReopening(false)} />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title={t('tasks.subtasks.cancelTitle', { title: shownCancelling?.title ?? '' })}
        body={t('tasks.subtasks.cancelBody')}
        action={t('tasks.moves.cancel')}
        destructive
        pending={cancel.isPending}
        onConfirm={async () => {
          if (!cancelling) return;
          await cancel.mutateAsync({
            id: cancelling.id,
            status: 'cancelled',
            note: cancelReason.trim(),
            overrideDependencies: false,
          });
          toast.add({ title: t('tasks.subtasks.cancelled'), type: 'success' });
        }}
      >
        <CancelReason value={cancelReason} onChange={setCancelReason} />
      </ConfirmDialog>
    </TaskSection>
  );
}

function CancelReason({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t('tasks.move.reason')}</FieldLabel>
      <Textarea
        id={id}
        rows={3}
        maxLength={2000}
        placeholder={t('tasks.move.reasonPlaceholder')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** Rule A4: the run mode, changeable while the parent is open. */
function RunModeBar({ task, manage }: { task: TaskDetail; manage: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const setMode = useSetRunMode(task.id);
  const mode = task.runMode ?? 'sequential';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span id={id} className="text-sm text-muted-foreground">
        {t('tasks.subtasks.runMode')}
      </span>
      {manage ? (
        <ToggleGroup
          aria-labelledby={id}
          value={[mode]}
          disabled={setMode.isPending}
          onValueChange={(next: SubtaskRunMode[]) => {
            const picked = next[0];
            if (!picked || picked === mode) return;
            setMode
              .mutateAsync(picked)
              .then(() => toast.add({ title: t('tasks.subtasks.runModeChanged'), type: 'success' }))
              .catch((error) => toast.add({ title: errorMessage(t, error), type: 'error' }));
          }}
        >
          {SUBTASK_RUN_MODES.map((runMode) => (
            <ToggleGroupItem key={runMode} value={runMode}>
              {t(`tasks.subtasks.runModes.${runMode}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <Badge tone="outline">{t(`tasks.subtasks.runModes.${mode}`)}</Badge>
      )}
    </div>
  );
}

/** Who works now, who waits (and for whom), who is done. */
function Timeline({ subtasks }: { subtasks: Subtask[] }) {
  const { t } = useTranslation();
  const done = subtasks.filter((subtask) => subtask.status === 'delivered');
  const waiting = subtasks.filter(
    (subtask) => !isTaskFinished(subtask.status) && subtask.waitingOn.length > 0,
  );
  const now = subtasks.filter(
    (subtask) => !isTaskFinished(subtask.status) && subtask.waitingOn.length === 0,
  );
  const lanes = [
    { key: 'now', icon: PlayIcon, items: now },
    { key: 'waiting', icon: HourglassIcon, items: waiting },
    { key: 'done', icon: CircleCheckIcon, items: done },
  ] as const;
  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/40 p-3 md:grid-cols-3">
      {lanes.map(({ key, icon: Icon, items }) => (
        <div key={key} className="flex min-w-0 flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <Icon aria-hidden="true" className="size-3.5" />
            {t(`tasks.subtasks.timeline.${key}`)}
            <span className="tabular-nums">{formatNumber(items.length)}</span>
          </h3>
          {items.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('tasks.subtasks.timeline.none')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {items.map((subtask) => (
                <li key={subtask.id} className="flex min-w-0 items-start gap-2 text-sm">
                  <Assignee subtask={subtask} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{subtask.title}</span>
                    {key === 'waiting' && (
                      <span className="truncate text-xs text-muted-foreground">
                        {t('tasks.subtasks.waitsFor', {
                          titles: subtask.waitingOn.map((other) => other.title).join('، '),
                        })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function Assignee({ subtask }: { subtask: Subtask }) {
  const { t } = useTranslation();
  return subtask.assignee ? (
    <Avatar
      name={subtask.assignee.name}
      src={imageSrc(subtask.assignee.imageId, 'sm')}
      size="sm"
      tone={subtask.assignee.archived ? 'muted' : 'brand'}
    />
  ) : (
    <Avatar name={t('tasks.subtasks.queue')} size="sm" tone="muted" />
  );
}

/** Rule A3: stages in order, each with its subtasks; a finished stage's handover follows it. */
function StageGroups({
  task,
  manage,
  dragged,
  onDropInStage,
  onAdd,
  row,
}: {
  task: TaskDetail;
  manage: boolean;
  dragged: string | null;
  onDropInStage: (stageId: string) => void;
  onAdd: (stageId: string) => void;
  row: (subtask: Subtask, index: number, group: Subtask[]) => RowProps;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState<TaskStage | null>(null);
  const [archiving, setArchiving] = useState<TaskStage | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  const shownArchiving = useShownWhileClosing(archiving);
  const archive = useArchiveStage(task.id);
  return (
    <div className="flex flex-col gap-3">
      {task.stages.map((stage) => {
        const group = task.subtasks.filter((subtask) => subtask.stageId === stage.id);
        return (
          <div key={stage.id} className="flex flex-col gap-3">
            <section
              aria-label={stage.name}
              className={cn(
                'flex flex-col gap-2 rounded-md border border-border p-3',
                dragged && 'border-dashed',
              )}
              onDragOver={(event) => dragged && event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onDropInStage(stage.id);
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold">
                  {t('tasks.subtasks.stageHeading', {
                    position: formatNumber(stage.position),
                    name: stage.name,
                  })}
                </h3>
                {stage.finished && (
                  <Badge tone="success">
                    <CircleCheckIcon aria-hidden="true" />
                    {t('tasks.subtasks.stageFinished')}
                  </Badge>
                )}
                {manage && (
                  <span className="ms-auto flex items-center">
                    {task.subtasks.filter((subtask) => !isCancelled(subtask)).length <
                      SUBTASK_LIMITS.subtasks && (
                      <IconButton
                        label={t('tasks.subtasks.addTo', { stage: stage.name })}
                        onClick={() => onAdd(stage.id)}
                      >
                        <PlusIcon />
                      </IconButton>
                    )}
                    <IconButton
                      label={t('tasks.subtasks.renameStage', { stage: stage.name })}
                      onClick={() => setRenaming(stage)}
                    >
                      <PencilIcon />
                    </IconButton>
                    {group.length === 0 && (
                      <IconButton
                        label={t('tasks.subtasks.archiveStage', { stage: stage.name })}
                        onClick={() => setArchiving(stage)}
                      >
                        <ArchiveIcon />
                      </IconButton>
                    )}
                  </span>
                )}
              </div>
              {group.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('tasks.subtasks.stageEmpty')}</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {group.map((subtask, index) => (
                    <SubtaskRow key={subtask.id} {...row(subtask, index, group)} />
                  ))}
                </ol>
              )}
            </section>
            {stage.finished && stage.handover && (
              <HandoverSummary stage={stage} entries={stage.handover} />
            )}
          </div>
        );
      })}
      {manage && task.stages.length < SUBTASK_LIMITS.stages && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setAddingStage(true)}
        >
          <PlusIcon />
          {t('tasks.subtasks.addStage')}
        </Button>
      )}
      {(addingStage || renaming) && (
        <StageNameDialog
          task={task}
          stage={renaming}
          onClose={() => {
            setAddingStage(false);
            setRenaming(null);
          }}
        />
      )}
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={t('tasks.subtasks.archiveStageTitle', { stage: shownArchiving?.name ?? '' })}
        body={t('tasks.subtasks.archiveStageBody')}
        action={t('tasks.subtasks.archiveStageAction')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          if (archiving) await archive.mutateAsync(archiving.id);
        }}
      />
    </div>
  );
}

/** Rule A12: the stage's delivered subtasks, who did each, their notes and finals. */
function HandoverSummary({
  stage,
  entries,
}: {
  stage: TaskStage;
  entries: NonNullable<TaskStage['handover']>;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm">
      <h4 className="flex items-center gap-1.5 font-bold">
        <HandshakeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        {t('tasks.subtasks.handoverOf', { stage: stage.name })}
      </h4>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5">
            <span className="font-medium">
              {entry.title}
              {entry.assignee && (
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {entry.assignee.name}
                </span>
              )}
            </span>
            {entry.note && <p className="whitespace-pre-line">{entry.note}</p>}
            {entry.finals.length > 0 && (
              <span className="text-xs text-muted-foreground" dir="auto">
                {t('tasks.subtasks.finals', {
                  names: entry.finals.map((file) => file.name).join('، '),
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function StageNameDialog({
  task,
  stage,
  onClose,
}: {
  task: TaskDetail;
  stage: TaskStage | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const add = useAddStage(task.id);
  const update = useUpdateStage(task.id);
  const [name, setName] = useState(stage?.name ?? '');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = add.isPending || update.isPending;
  async function save() {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      setInvalid(true);
      return;
    }
    setFailure(null);
    try {
      if (stage) await update.mutateAsync({ stageId: stage.id, name: trimmed });
      else await add.mutateAsync({ name: trimmed });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {stage ? t('tasks.subtasks.renameStageTitle') : t('tasks.subtasks.addStage')}
            </DialogTitle>
          </DialogHeader>
          <Field invalid={invalid}>
            <FieldLabel htmlFor={id}>{t('tasks.subtasks.stageName')}</FieldLabel>
            <Input
              id={id}
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => {
                setInvalid(false);
                setName(event.target.value);
              }}
            />
            <FieldError match={invalid}>{t('tasks.subtasks.errors.stageName')}</FieldError>
          </Field>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  task: TaskDetail;
  subtask: Subtask;
  manage: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onMoveToStage: (stageId: string) => void;
  onCancel: () => void;
}

function SubtaskRow({
  task,
  subtask,
  manage,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onMoveUp,
  onMoveDown,
  onMoveToStage,
  onCancel,
}: RowProps) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const cancelled = isCancelled(subtask);
  const otherStages =
    task.runMode === 'stages' ? task.stages.filter((stage) => stage.id !== subtask.stageId) : [];
  return (
    <li
      draggable={manage}
      data-subtask={subtask.id}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => manage && event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-border bg-surface px-3 py-2 2xl:flex-row 2xl:items-center',
        dragging && 'opacity-50',
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {manage && (
          <GripVerticalIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground"
          />
        )}
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatNumber(subtask.position)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <Link
            to="/tasks/$taskId"
            params={{ taskId: subtask.id }}
            draggable={false}
            className={cn(
              'font-medium hover:underline',
              cancelled && 'text-muted-foreground line-through',
            )}
          >
            {subtask.title}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {[
              departmentName(subtask.department),
              subtask.assignee?.name ?? t('tasks.subtasks.queue'),
            ].join(' · ')}
          </span>
          {subtask.handoverNote && (
            <span className="truncate text-xs text-muted-foreground">
              {t('tasks.subtasks.noteExcerpt', { note: subtask.handoverNote })}
            </span>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge status={subtask.status} stage={subtask.reviewStage} />
        {subtask.blocked && <BlockedBadge />}
        <span className="text-sm tabular-nums">{formatDue(subtask)}</span>
        {subtask.overdue && <TaskOverdueBadge />}
        {manage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<IconButton label={t('tasks.subtasks.moveOf', { title: subtask.title })} />}
            >
              <MoveIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!onMoveUp} onClick={() => onMoveUp?.()}>
                <ArrowUpIcon />
                {t('tasks.subtasks.moveUp')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!onMoveDown} onClick={() => onMoveDown?.()}>
                <ArrowDownIcon />
                {t('tasks.subtasks.moveDown')}
              </DropdownMenuItem>
              {otherStages.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{t('tasks.subtasks.moveToStage')}</DropdownMenuLabel>
                    {otherStages.map((stage) => (
                      <DropdownMenuItem key={stage.id} onClick={() => onMoveToStage(stage.id)}>
                        {stage.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              )}
              {isTaskOpen(subtask.status) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={onCancel}>
                    <BanIcon />
                    {t('tasks.subtasks.cancel')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

/** Rule A10: picks delivered subtasks to reopen, each with what must change. */
function ReopenSubtasksDialog({
  task,
  open,
  onClose,
}: {
  task: TaskDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reopen = useReopenSubtasks(task.id);
  const delivered = task.subtasks.filter((subtask) => subtask.status === 'delivered');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const picked = Object.entries(notes);
  async function save() {
    if (picked.length === 0 || picked.some(([, note]) => note.trim().length === 0)) {
      setInvalid(true);
      return;
    }
    setFailure(null);
    try {
      await reopen.mutateAsync({ items: picked.map(([id, note]) => ({ id, note: note.trim() })) });
      toast.add({ title: t('tasks.subtasks.reopened'), type: 'success' });
      setNotes({});
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('tasks.subtasks.reopenTitle')}</DialogTitle>
          <DialogDescription>{t('tasks.subtasks.reopenBody')}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3">
          {delivered.map((subtask) => {
            const checked = subtask.id in notes;
            const noteId = `reopen-note-${subtask.id}`;
            return (
              <li
                key={subtask.id}
                className="flex flex-col gap-2 rounded-md border border-border p-3"
              >
                <label
                  htmlFor={`reopen-${subtask.id}`}
                  className="flex items-center gap-3 text-sm font-medium"
                >
                  <Checkbox
                    id={`reopen-${subtask.id}`}
                    checked={checked}
                    onCheckedChange={(next) => {
                      setInvalid(false);
                      setNotes((current) => {
                        const { [subtask.id]: _removed, ...rest } = current;
                        return next ? { ...rest, [subtask.id]: '' } : rest;
                      });
                    }}
                  />
                  {subtask.title}
                  <span className="text-xs font-normal text-muted-foreground">
                    {subtask.assignee?.name ?? t('tasks.subtasks.queue')}
                  </span>
                </label>
                {checked && (
                  <Field invalid={invalid && !notes[subtask.id]?.trim()}>
                    <FieldLabel htmlFor={noteId}>{t('tasks.subtasks.reopenNote')}</FieldLabel>
                    <Textarea
                      id={noteId}
                      rows={2}
                      maxLength={2000}
                      value={notes[subtask.id] ?? ''}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [subtask.id]: event.target.value }))
                      }
                    />
                    <FieldError match={invalid && !notes[subtask.id]?.trim()}>
                      {t('tasks.subtasks.errors.reopenNote')}
                    </FieldError>
                  </Field>
                )}
              </li>
            );
          })}
        </ul>
        {invalid && picked.length === 0 && (
          <FormAlert>{t('tasks.subtasks.errors.reopenPick')}</FormAlert>
        )}
        {failure && <FormAlert>{failure}</FormAlert>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            {t('common.cancel')}
          </DialogClose>
          <Button onClick={save} disabled={reopen.isPending}>
            <RotateCcwIcon />
            {t('tasks.subtasks.reopenAction', { n: formatNumber(picked.length) })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What "Turn into subtask" fills in (rule B11). */
export interface SubtaskPrefill {
  title: string;
  briefDoc: TaskBriefDoc | null;
  department: DepartmentCode;
  fromCommentId: string;
}

/** Hours with halves (rule C8), as the estimate field shows them. */
const ESTIMATE_HOURS = Array.from({ length: 16 }, (_, index) => (index + 1) / 2);

/**
 * Rule A2: one subtask added to an open parent, or a question or comment turned into one (rule
 * B11). It takes the parent's client and engagement; its due date is not after the parent's.
 */
export function AddSubtaskDialog({
  parent,
  stageId,
  prefill,
  onClose,
}: {
  parent: Pick<TaskDetail, 'id' | 'dueDate' | 'department' | 'runMode' | 'stages'>;
  stageId: string | null;
  prefill?: SubtaskPrefill;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = useRichTextLabels();
  const departments = useDepartments();
  const add = useAddSubtask(parent.id);
  const briefId = useId();
  const [failure, setFailure] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<ReturnType<typeof assigneeLeaves>>(null);
  const firstStage = parent.stages[0]?.id ?? null;
  const form = useForm<CreateSubtaskInput, unknown, CreateSubtask>({
    resolver: standardSchemaResolver(createSubtaskSchema),
    defaultValues: {
      title: prefill?.title ?? '',
      department: prefill?.department ?? parent.department,
      assigneeId: null,
      priority: 'normal',
      dueDate: parent.dueDate,
      dueTime: null,
      estimateMinutes: null,
      briefDoc: prefill?.briefDoc ?? null,
      stageId: parent.runMode === 'stages' ? (stageId ?? firstStage) : null,
      fromCommentId: prefill?.fromCommentId,
    },
  });
  const department = form.watch('department');
  const { options } = useAssigneeOptions(department, null);
  const errors = form.formState.errors;

  async function send(values: CreateSubtask, acceptLeave = false) {
    setFailure(null);
    try {
      await add.mutateAsync({ ...values, ...(acceptLeave && { acceptLeave: true }) });
      toast.add({
        title: prefill ? t('tasks.subtasks.converted') : t('tasks.subtasks.added'),
        type: 'success',
      });
      setLeaves(null);
      onClose();
    } catch (error) {
      const onLeave = assigneeLeaves(error);
      if (onLeave) {
        setLeaves(onLeave);
        return;
      }
      if (error instanceof Error && 'code' in error && error.code === 'INVALID_DATES') {
        form.setError('dueDate', { type: SCREEN_ERROR, message: errorMessage(t, error) });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  }

  const submit = form.handleSubmit((values) => send(values));

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {prefill ? t('tasks.subtasks.convertTitle') : t('tasks.subtasks.addTitle')}
              </DialogTitle>
              <DialogDescription>{t('tasks.subtasks.addBody')}</DialogDescription>
            </DialogHeader>
            <Field invalid={!!errors.title}>
              <FieldLabel>{t('tasks.form.title')}</FieldLabel>
              <Input autoComplete="off" autoFocus {...form.register('title')} />
              <FieldError match={!!errors.title}>{t('tasks.form.errors.title')}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field invalid={!!errors.department}>
                <FieldLabel>{t('tasks.form.department')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="department"
                  render={({ field }) => (
                    <Select
                      items={departments.map(({ code, name }) => ({ value: code, label: name }))}
                      value={field.value}
                      onValueChange={(value) => {
                        if (!value) return;
                        field.onChange(value);
                        form.setValue('assigneeId', null);
                      }}
                    >
                      <SelectTrigger ref={field.ref}>
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
                  )}
                />
              </Field>
              <Field invalid={!!errors.assigneeId}>
                <FieldLabel>{t('tasks.form.assignee')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="assigneeId"
                  render={({ field }) => (
                    <Select
                      items={[
                        { value: '', label: t('tasks.subtasks.queue') },
                        ...options.map((option) => ({ value: option.id, label: option.name })),
                      ]}
                      value={field.value ?? ''}
                      onValueChange={(value) => field.onChange(value || null)}
                    >
                      <SelectTrigger ref={field.ref}>
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
                  )}
                />
                <FieldDescription>{t('tasks.subtasks.queueHint')}</FieldDescription>
              </Field>
              <Field invalid={!!errors.dueDate}>
                <FieldLabel>{t('tasks.form.dueDate')}</FieldLabel>
                <Input
                  type="date"
                  dir="ltr"
                  min={businessDate()}
                  max={parent.dueDate}
                  {...form.register('dueDate')}
                />
                <FieldError match={!!errors.dueDate} role={errorRole(errors.dueDate)}>
                  {fieldError(errors.dueDate, t('tasks.subtasks.errors.dueDate'))}
                </FieldError>
              </Field>
              <Field>
                <FieldLabel>{t('tasks.subtasks.estimate')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="estimateMinutes"
                  render={({ field }) => (
                    <Select
                      items={[
                        { value: '', label: t('tasks.subtasks.noEstimate') },
                        ...ESTIMATE_HOURS.map((hours) => ({
                          value: String(hours * 60),
                          label: t('tasks.subtasks.hours', { hours: formatNumber(hours) }),
                        })),
                      ]}
                      value={field.value ? String(field.value) : ''}
                      onValueChange={(value) => field.onChange(value ? Number(value) : null)}
                    >
                      <SelectTrigger ref={field.ref}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t('tasks.subtasks.noEstimate')}</SelectItem>
                        {ESTIMATE_HOURS.map((hours) => (
                          <SelectItem key={hours} value={String(hours * 60)}>
                            {t('tasks.subtasks.hours', { hours: formatNumber(hours) })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {parent.runMode === 'stages' && (
                <Field>
                  <FieldLabel>{t('tasks.subtasks.stage')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="stageId"
                    render={({ field }) => (
                      <Select
                        items={parent.stages.map((stage) => ({
                          value: stage.id,
                          label: stage.name,
                        }))}
                        value={field.value ?? null}
                        onValueChange={(value) => field.onChange(value)}
                      >
                        <SelectTrigger ref={field.ref}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {parent.stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              {stage.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              )}
            </div>
            <Field invalid={!!errors.briefDoc}>
              <FieldLabel id={briefId} render={<span />}>
                {t('tasks.form.brief')}
              </FieldLabel>
              <Controller
                control={form.control}
                name="briefDoc"
                render={({ field }) => (
                  <RichTextEditor
                    aria-labelledby={briefId}
                    defaultValue={field.value as RichTextDoc | null | undefined}
                    labels={labels}
                    compact
                    invalid={!!errors.briefDoc}
                    onChange={(doc) => {
                      const parsed = taskBriefDocSchema.safeParse(doc);
                      field.onChange(parsed.success ? parsed.data : null);
                    }}
                  />
                )}
              />
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={form.formState.isSubmitting || add.isPending}>
                <PlusIcon />
                {prefill ? t('tasks.subtasks.convertAction') : t('tasks.subtasks.addAction')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LeaveWarningDialog
        leaves={leaves}
        onClose={() => setLeaves(null)}
        pending={add.isPending}
        onConfirm={() => form.handleSubmit((values) => send(values, true))()}
      />
    </>
  );
}

/** Rule A12: a subtask's note to the next ones, written before it is submitted for review. */
export function HandoverNoteSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSetHandoverNote(task.id);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(task.handoverNote ?? '');
  const [failure, setFailure] = useState<string | null>(null);
  if (!task.parent) return null;
  const editable = task.permissions.canWriteHandover && !task.readOnly;
  if (!editable && !task.handoverNote) return null;
  return (
    <TaskSection
      title={t('tasks.subtasks.handoverNote')}
      action={
        editable &&
        !editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNote(task.handoverNote ?? '');
              setEditing(true);
            }}
          >
            <PencilIcon />
            {task.handoverNote ? t('common.edit') : t('tasks.subtasks.writeNote')}
          </Button>
        )
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            setFailure(null);
            try {
              await save.mutateAsync({ note: note.trim() || null });
              toast.add({ title: t('tasks.subtasks.noteSaved'), type: 'success' });
              setEditing(false);
            } catch (error) {
              setFailure(errorMessage(t, error));
            }
          }}
        >
          <FieldLabel htmlFor={id} className="sr-only">
            {t('tasks.subtasks.handoverNote')}
          </FieldLabel>
          <Textarea
            id={id}
            rows={3}
            maxLength={2000}
            autoFocus
            placeholder={t('tasks.subtasks.notePlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {failure && <FormAlert>{failure}</FormAlert>}
          <span className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
          </span>
        </form>
      ) : task.handoverNote ? (
        <p className="text-sm whitespace-pre-line">{task.handoverNote}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('tasks.subtasks.noteHint')}</p>
      )}
    </TaskSection>
  );
}
