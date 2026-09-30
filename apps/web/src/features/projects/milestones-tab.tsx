import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link } from '@tanstack/react-router';
import {
  BOARD_STATUSES,
  type CreateMilestone,
  type CreateMilestoneInput,
  type Currency,
  createMilestoneSchema,
  type Milestone,
  PROJECT_LIMITS,
  type ProjectDetail,
  type UpdateMilestone,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CalendarX2Icon,
  CheckIcon,
  CircleCheckBigIcon,
  EllipsisIcon,
  GripVerticalIcon,
  ListChecksIcon,
  MilestoneIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  WalletIcon,
} from 'lucide-react';
import { type DragEvent, type LiHTMLAttributes, type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { TabHeader } from '../../components/tab-header';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { OverdueBadge } from './project-badges';
import {
  useArchiveMilestone,
  useCompleteMilestone,
  useCreateMilestone,
  useReopenMilestone,
  useReorderMilestones,
  useUpdateMilestone,
} from './projects.queries';

/**
 * The project's plan as a path of steps: done ones checked, the current one (the first pending)
 * marked in sand, overdue ones in red. Editors add, edit, reorder (drag or the menu), complete,
 * reopen and remove pending milestones (rules 7–8).
 */
export function MilestonesTab({
  project,
  editable,
}: {
  project: ProjectDetail;
  /** Manage permission on an open, non-archived project (rule 7). */
  editable: boolean;
}) {
  const { t } = useTranslation();
  const reorder = useReorderMilestones(project.id);
  const [adding, setAdding] = useState(false);
  // While a new order is being saved, the list shows it already.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const currency = project.money?.currency ?? null;

  const milestones = pendingOrder
    ? pendingOrder.flatMap(
        (id) => project.milestones.find((milestone) => milestone.id === id) ?? [],
      )
    : project.milestones;
  const currentId = milestones.find((milestone) => milestone.status === 'pending')?.id;
  const full = milestones.length >= PROJECT_LIMITS.milestones;
  const reorderable = editable && milestones.length > 1 && !reorder.isPending;

  function moveTo(id: string, index: number) {
    const ids = milestones.map((milestone) => milestone.id).filter((other) => other !== id);
    ids.splice(index, 0, id);
    if (ids.every((other, position) => other === milestones[position]?.id)) return;
    setPendingOrder(ids);
    reorder.mutate(ids, {
      onError: (error) => notifyError(errorMessage(t, error)),
      onSettled: () => setPendingOrder(null),
    });
  }

  const dragProps = (milestone: Milestone, index: number) =>
    reorderable
      ? {
          draggable: true,
          onDragStart: (event: DragEvent) => {
            event.dataTransfer.effectAllowed = 'move';
            setDragged(milestone.id);
          },
          onDragOver: (event: DragEvent) => {
            if (!dragged) return;
            event.preventDefault();
            setTarget(milestone.id);
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            if (dragged) moveTo(dragged, index);
            setDragged(null);
            setTarget(null);
          },
          onDragEnd: () => {
            setDragged(null);
            setTarget(null);
          },
        }
      : {};

  return (
    <>
      <TabHeader
        title={t('projects.milestones.title')}
        description={
          reorderable ? t('projects.milestones.hintReorder') : t('projects.milestones.hint')
        }
        action={
          editable && (
            <Button size="sm" disabled={full} onClick={() => setAdding(true)}>
              <PlusIcon />
              {t('projects.milestones.add')}
            </Button>
          )
        }
      />

      {project.money && <MoneySummary project={project} currency={project.money.currency} />}

      {milestones.length === 0 ? (
        <EmptyState
          icon={<MilestoneIcon />}
          title={t('projects.milestones.emptyTitle')}
          description={editable ? t('projects.milestones.emptyHint') : undefined}
          action={
            editable && (
              <Button onClick={() => setAdding(true)}>
                <PlusIcon />
                {t('projects.milestones.add')}
              </Button>
            )
          }
        />
      ) : (
        <ol aria-label={t('projects.milestones.title')} className="flex flex-col">
          {milestones.map((milestone, index) => (
            <MilestoneStep
              key={milestone.id}
              project={project}
              milestone={milestone}
              index={index}
              count={milestones.length}
              current={milestone.id === currentId}
              editable={editable}
              reorderable={reorderable}
              dragging={dragged === milestone.id}
              dropTarget={target === milestone.id && dragged !== milestone.id}
              currency={currency}
              onMove={(to) => moveTo(milestone.id, to)}
              {...dragProps(milestone, index)}
            />
          ))}
        </ol>
      )}
      {full && editable && (
        <p className="text-sm text-muted-foreground">
          {t('projects.form.milestonesLimit', { max: formatNumber(PROJECT_LIMITS.milestones) })}
        </p>
      )}

      <MilestoneDialog project={project} open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function notifyError(title: string) {
  toast.add({ title, type: 'error' });
}

/**
 * What the plan is worth, what finished milestones have earned, and the milestones still without
 * an installment on an active project (M4). Money access only.
 */
function MoneySummary({ project, currency }: { project: ProjectDetail; currency: Currency }) {
  const { t } = useTranslation();
  const amount = (milestone: Milestone) => milestone.money?.installmentMinor ?? 0;
  const earned = project.milestones
    .filter((milestone) => milestone.status === 'done')
    .reduce((sum, milestone) => sum + amount(milestone), 0);
  const missing = project.milestones.filter(
    (milestone) => milestone.money && milestone.money.installmentMinor === null,
  ).length;
  const total = project.money?.totalMinor ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <SummaryFigure
          label={t('projects.milestones.total')}
          value={formatMoney(total, currency)}
          icon={<WalletIcon />}
        />
        <SummaryFigure
          label={t('projects.milestones.earned')}
          value={formatMoney(earned, currency)}
          hint={
            total > 0
              ? t('projects.milestones.earnedShare', {
                  share: formatNumber(earned / total, { style: 'percent' }),
                })
              : undefined
          }
          icon={<CircleCheckBigIcon />}
        />
      </dl>
      {project.status === 'active' && missing > 0 && (
        <Callout
          tone="warning"
          icon={<WalletIcon />}
          title={t('projects.milestones.installmentsMissing')}
          description={t('projects.milestones.installmentsMissingBody', {
            count: missing,
            n: formatNumber(missing),
          })}
        />
      )}
    </div>
  );
}

function SummaryFigure({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="text-sm text-muted-foreground">{label}</dt>
        <dd className="text-xl font-bold tabular-nums">{value}</dd>
        {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
      </div>
    </div>
  );
}

interface MilestoneStepProps extends LiHTMLAttributes<HTMLLIElement> {
  project: ProjectDetail;
  milestone: Milestone;
  index: number;
  count: number;
  current: boolean;
  editable: boolean;
  reorderable: boolean;
  dragging: boolean;
  dropTarget: boolean;
  currency: Currency | null;
  onMove: (index: number) => void;
}

function MilestoneStep({
  project,
  milestone,
  index,
  count,
  current,
  editable,
  reorderable,
  dragging,
  dropTarget,
  currency,
  onMove,
  ...props
}: MilestoneStepProps) {
  const { t } = useTranslation();
  const done = milestone.status === 'done';
  const late = !!milestone.dueDate && milestone.dueDate > project.dueDate;
  const installment = milestone.money?.installmentMinor ?? null;
  const [dialog, setDialog] = useState<'edit' | 'remove' | 'complete' | null>(null);
  const [openTasks, setOpenTasks] = useState(0);
  const complete = useCompleteMilestone(project.id);
  const reopen = useReopenMilestone(project.id);
  const busy = complete.isPending || reopen.isPending;

  async function markDone(confirmOpenTasks: boolean) {
    await complete.mutateAsync({ milestoneId: milestone.id, confirmOpenTasks });
    toast.add({ title: t('projects.milestones.completed'), type: 'success' });
  }

  async function onComplete() {
    // Rule 8: ask first when the milestone still has open tasks (F06).
    if (milestone.tasks.open > 0) {
      setOpenTasks(milestone.tasks.open);
      setDialog('complete');
      return;
    }
    try {
      await markDone(false);
    } catch (error) {
      const refused = openTasksOf(error);
      if (refused) {
        setOpenTasks(refused);
        setDialog('complete');
      } else {
        notifyError(errorMessage(t, error));
      }
    }
  }

  async function onReopen() {
    try {
      await reopen.mutateAsync(milestone.id);
      toast.add({ title: t('projects.milestones.reopened'), type: 'success' });
    } catch (error) {
      notifyError(errorMessage(t, error));
    }
  }

  return (
    <li
      {...props}
      data-status={milestone.status}
      className={cn(
        'group relative flex gap-4 pb-3 last:pb-0',
        dragging && 'opacity-50',
        reorderable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {index < count - 1 && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute start-5 top-11 bottom-0 w-0.5 -translate-x-1/2 rtl:translate-x-1/2',
            done ? 'bg-status-success-foreground' : 'bg-border',
          )}
        />
      )}
      <StepNode index={index} done={done} current={current} overdue={milestone.overdue} />
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-surface p-4 transition-colors duration-150 ease-out sm:flex-row sm:items-center',
          current ? 'border-accent' : 'border-border',
          dropTarget && 'border-primary bg-muted/50',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={cn(
                'font-medium',
                done && 'text-muted-foreground line-through decoration-1',
              )}
            >
              {milestone.name}
            </h3>
            {current && <Badge tone="gold">{t('projects.milestones.current')}</Badge>}
            {milestone.overdue && <OverdueBadge />}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CalendarIcon aria-hidden="true" className="size-4" />
              {milestone.dueDate
                ? formatCalendarDate(milestone.dueDate)
                : t('projects.milestones.noDueDate')}
            </span>
            {late && !done && (
              <span className="flex items-center gap-1.5 text-status-warning-foreground">
                <CalendarX2Icon aria-hidden="true" className="size-4" />
                {t('projects.milestones.afterProjectDue')}
              </span>
            )}
            {done && milestone.doneAt && (
              <span className="flex items-center gap-1.5">
                <CheckIcon aria-hidden="true" className="size-4 text-status-success-foreground" />
                {milestone.doneBy
                  ? t('projects.milestones.doneBy', {
                      name: milestone.doneBy.name,
                      when: formatDateTime(milestone.doneAt),
                    })
                  : formatDateTime(milestone.doneAt)}
              </span>
            )}
            {milestone.tasks.total > 0 && (
              <Link
                to="/tasks/list"
                search={{
                  projectId: milestone.projectId,
                  milestoneId: milestone.id,
                  status: [...BOARD_STATUSES],
                }}
                className="flex items-center gap-1.5 hover:text-foreground hover:underline"
              >
                <ListChecksIcon aria-hidden="true" className="size-4" />
                {t('projects.milestones.tasks', {
                  delivered: formatNumber(milestone.tasks.delivered),
                  total: formatNumber(milestone.tasks.total),
                })}
              </Link>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:justify-end">
          {currency && (
            <span className="flex flex-col items-end">
              <span className="text-xs text-muted-foreground">
                {t('projects.form.installment')}
              </span>
              <span
                className={cn(
                  'font-medium tabular-nums',
                  installment === null && 'text-muted-foreground',
                )}
              >
                {installment === null ? t('common.none') : formatMoney(installment, currency)}
              </span>
            </span>
          )}
          {editable && !done && (
            <Button variant="outline" size="sm" disabled={busy} onClick={onComplete}>
              <CheckIcon />
              {t('projects.milestones.complete')}
            </Button>
          )}
          {editable && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('projects.milestones.actions', { name: milestone.name })}
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog('edit')}>
                  <PencilIcon />
                  {t('common.edit')}
                </DropdownMenuItem>
                {done && (
                  <DropdownMenuItem disabled={busy} onClick={onReopen}>
                    <RotateCcwIcon />
                    {t('projects.milestones.reopen')}
                  </DropdownMenuItem>
                )}
                {count > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={index === 0} onClick={() => onMove(index - 1)}>
                      <ArrowUpIcon />
                      {t('projects.milestones.moveUp')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={index === count - 1}
                      onClick={() => onMove(index + 1)}
                    >
                      <ArrowDownIcon />
                      {t('projects.milestones.moveDown')}
                    </DropdownMenuItem>
                  </>
                )}
                {!done && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDialog('remove')}>
                      <Trash2Icon />
                      {t('projects.milestones.remove')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {reorderable && (
            <GripVerticalIcon
              aria-hidden="true"
              className="hidden size-4 text-muted-foreground opacity-40 transition-opacity duration-150 group-hover:opacity-100 sm:block"
            />
          )}
        </div>
      </div>

      <MilestoneDialog
        project={project}
        milestone={milestone}
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
      />
      <RemoveDialog
        project={project}
        milestone={milestone}
        open={dialog === 'remove'}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        title={t('projects.milestones.openTasksTitle', { name: milestone.name })}
        body={t('projects.milestones.openTasksBody', {
          count: openTasks,
          n: formatNumber(openTasks),
        })}
        action={t('projects.milestones.completeAnyway')}
        pending={complete.isPending}
        onConfirm={() => markDone(true)}
      />
    </li>
  );
}

/** The open task count of a `MILESTONE_HAS_OPEN_TASKS` refusal, or null for any other error. */
function openTasksOf(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.code !== 'MILESTONE_HAS_OPEN_TASKS') return null;
  const details = error.details as { openTasks?: unknown } | undefined;
  return typeof details?.openTasks === 'number' ? details.openTasks : null;
}

/** The step's marker on the path: its number, a check once done, sand while current. */
function StepNode({
  index,
  done,
  current,
  overdue,
}: {
  index: number;
  done: boolean;
  current: boolean;
  overdue: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative z-10 mt-3 flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums',
        done
          ? 'border-status-success-foreground bg-status-success-foreground text-surface'
          : overdue
            ? 'border-destructive bg-status-danger text-status-danger-foreground'
            : current
              ? 'border-accent bg-surface text-foreground'
              : 'border-border bg-surface text-muted-foreground',
      )}
    >
      {done ? <CheckIcon className="size-5" /> : formatNumber(index + 1)}
    </span>
  );
}

/** Only a pending milestone can be removed (rule 8); it is archived, not deleted. */
function RemoveDialog({
  project,
  milestone,
  open,
  onClose,
}: {
  project: ProjectDetail;
  milestone: Milestone;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const archive = useArchiveMilestone(project.id);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={t('projects.milestones.removeTitle', { name: milestone.name })}
      body={t('projects.milestones.removeBody')}
      action={t('projects.milestones.remove')}
      destructive
      pending={archive.isPending}
      onConfirm={async () => {
        await archive.mutateAsync(milestone.id);
        toast.add({ title: t('projects.milestones.removed'), type: 'success' });
      }}
    />
  );
}

/**
 * Adds a milestone at the end, or edits one. The installment is shown and sent only with money
 * access, so a save without it keeps the stored amount (edge case 11).
 */
function MilestoneDialog({
  project,
  milestone,
  open,
  onClose,
}: {
  project: ProjectDetail;
  milestone?: Milestone;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { name: useId(), due: useId(), installment: useId() };
  const create = useCreateMilestone(project.id);
  const update = useUpdateMilestone(project.id);
  const money = project.permissions.canEditMoney ? (project.money?.currency ?? null) : null;
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateMilestoneInput, unknown, CreateMilestone>({
    resolver: standardSchemaResolver(createMilestoneSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      name: milestone?.name ?? '',
      dueDate: milestone?.dueDate ?? null,
      installmentMinor: milestone?.money?.installmentMinor ?? null,
    },
  });
  const nameError = form.formState.errors.name;

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const dirty = form.formState.dirtyFields;
    try {
      if (milestone) {
        const changes: UpdateMilestone = {
          ...(dirty.name && { name: values.name }),
          ...(dirty.dueDate && { dueDate: values.dueDate ?? null }),
          ...(money &&
            dirty.installmentMinor && { installmentMinor: values.installmentMinor ?? null }),
        };
        if (Object.keys(changes).length > 0) {
          await update.mutateAsync({ milestoneId: milestone.id, ...changes });
        }
        toast.add({ title: t('projects.milestones.saved'), type: 'success' });
      } else {
        await create.mutateAsync(money ? values : { ...values, installmentMinor: undefined });
        toast.add({ title: t('projects.milestones.added'), type: 'success' });
      }
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {milestone ? t('projects.milestones.editTitle') : t('projects.milestones.addTitle')}
            </DialogTitle>
            {!milestone && (
              <DialogDescription>{t('projects.milestones.addHint')}</DialogDescription>
            )}
          </DialogHeader>
          <Field invalid={!!nameError}>
            <FieldLabel htmlFor={ids.name}>{t('projects.milestones.name')}</FieldLabel>
            <Input
              id={ids.name}
              autoComplete="off"
              placeholder={t('projects.form.milestoneNamePlaceholder')}
              {...form.register('name')}
            />
            <FieldError match={!!nameError}>{t('projects.form.errors.milestoneName')}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.due}>
              {t('projects.milestones.dueDate')}
              <span className="ms-1 font-normal text-muted-foreground">
                ({t('common.optional')})
              </span>
            </FieldLabel>
            <Input
              id={ids.due}
              type="date"
              {...form.register('dueDate', { setValueAs: (value: string | null) => value || null })}
            />
          </Field>
          {money && (
            <Field>
              <FieldLabel htmlFor={ids.installment}>
                {t('projects.form.installment')}
                <span className="ms-1 font-normal text-muted-foreground">
                  ({t('common.optional')})
                </span>
              </FieldLabel>
              <Controller
                control={form.control}
                name="installmentMinor"
                render={({ field }) => (
                  <MoneyInput
                    id={ids.installment}
                    currency={money}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              />
            </Field>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
