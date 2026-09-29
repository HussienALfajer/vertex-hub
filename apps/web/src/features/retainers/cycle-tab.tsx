import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  type CreateCycleAdjustment,
  type CreateCycleLine,
  type CreateCycleLineInput,
  type CycleDetail,
  type CycleLine,
  createCycleAdjustmentSchema,
  createCycleLineSchema,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  daysInclusive,
  RETAINER_LIMITS,
  type RetainerDetail,
  type UpdateCycleLine,
  updateCycleLineSchema,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
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
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Meter,
  type MeterTone,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  CalendarClockIcon,
  CalendarOffIcon,
  ChevronDownIcon,
  CircleStopIcon,
  EllipsisIcon,
  HistoryIcon,
  ListPlusIcon,
  MinusIcon,
  PauseIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, type UseFormRegisterReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatMonth, formatNumber } from '../../lib/format';
import { BehindBadge, DeliverableIcon, lineName, OverDeliveredBadge } from './retainer-badges';
import {
  retainerCycleQuery,
  useAddCycleLine,
  useAdjustCycleLine,
  useUpdateCycleLine,
} from './retainers.queries';

/**
 * The open cycle: one row per line with its counter, and the month's corrections (R7, R9):
 * committed quantities, lines for this month only and delivered adjustments, each with a reason.
 */
export function ThisMonthTab({ retainer }: { retainer: RetainerDetail }) {
  const current = retainer.currentCycle;
  if (!current) return <NoOpenCycle retainer={retainer} />;
  return <OpenCycle retainer={retainer} cycleId={current.id} />;
}

function OpenCycle({ retainer, cycleId }: { retainer: RetainerDetail; cycleId: string }) {
  const { t } = useTranslation();
  const cycle = useQuery(retainerCycleQuery(retainer.id, cycleId));
  const [adding, setAdding] = useState(false);
  const editable = retainer.permissions.canManage;

  if (cycle.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (cycle.isError) {
    return <LoadError message={t('retainers.cycle.loadError')} onRetry={() => cycle.refetch()} />;
  }
  const full = cycle.data.lines.length >= RETAINER_LIMITS.cycleLines;

  return (
    <>
      <TabHeader
        title={t('retainers.cycle.title', { month: formatMonth(cycle.data.month) })}
        description={t('retainers.cycle.hint')}
        action={
          editable && (
            <Button size="sm" variant="outline" disabled={full} onClick={() => setAdding(true)}>
              <ListPlusIcon />
              {t('retainers.cycle.addLine')}
            </Button>
          )
        }
      />
      <CycleSummary cycle={cycle.data} />
      {cycle.data.lines.length === 0 ? (
        <EmptyState
          icon={<ListPlusIcon />}
          title={t('retainers.cycle.emptyTitle')}
          description={editable ? t('retainers.cycle.emptyHint') : undefined}
        />
      ) : (
        <ul aria-label={t('retainers.cycle.lines')} className="flex flex-col gap-3">
          {cycle.data.lines.map((line) => (
            <CycleLineRow
              key={line.id}
              retainerId={retainer.id}
              cycle={cycle.data}
              line={line}
              editable={editable}
            />
          ))}
        </ul>
      )}
      <AddLineDialog
        retainerId={retainer.id}
        cycle={cycle.data}
        open={adding}
        onClose={() => setAdding(false)}
      />
    </>
  );
}

/** The month at a glance: its period, the days left, and the delivery rate so far (R13). */
function CycleSummary({ cycle }: { cycle: CycleDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  const length = daysInclusive(cycle.periodStart, cycle.periodEnd);
  const left = today > cycle.periodEnd ? 0 : daysInclusive(today, cycle.periodEnd);
  const elapsed = Math.min(1, Math.max(0, (length - left + 1) / length));
  return (
    <div className="grid gap-4 rounded-lg border border-border bg-surface p-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('retainers.cycle.period')}</p>
        <p className="text-xl font-bold">
          {left <= 1
            ? t('retainers.cycle.lastDay')
            : t('retainers.cycle.daysLeft', { count: left, days: formatNumber(left) })}
        </p>
        <Meter
          value={Math.round(elapsed * 100)}
          tone={left <= 7 ? 'warning' : 'brand'}
          aria-label={t('retainers.cycle.timeElapsed')}
        />
        <p className="text-xs text-muted-foreground">
          {t('projects.dateRange', {
            start: formatCalendarDate(cycle.periodStart),
            due: formatCalendarDate(cycle.periodEnd),
          })}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('retainers.columns.deliveryRate')}</p>
        <p className="flex items-center gap-2 text-xl font-bold tabular-nums">
          {cycle.deliveryRate === null
            ? t('common.none')
            : formatNumber(cycle.deliveryRate / 100, { style: 'percent' })}
          {cycle.behind && <BehindBadge />}
        </p>
        {cycle.deliveryRate !== null && (
          <Meter
            value={cycle.deliveryRate}
            tone={cycle.deliveryRate >= 100 ? 'success' : 'brand'}
            aria-label={t('retainers.columns.deliveryRate')}
          />
        )}
        <p className="text-xs text-muted-foreground">{t('retainers.cycle.rateHint')}</p>
      </div>
    </div>
  );
}

/** One line's counter: delivered of committed, with its corrections (R7, R9). */
function CycleLineRow({
  retainerId,
  cycle,
  line,
  editable,
}: {
  retainerId: string;
  cycle: CycleDetail;
  line: CycleDetail['lines'][number];
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<'committed' | 'adjust' | null>(null);
  const [history, setHistory] = useState(false);
  const name = lineName(t, line);
  const over = line.delivered > line.committed;
  const done = line.committed > 0 && line.delivered >= line.committed;
  const tone: MeterTone = line.behind ? 'danger' : done ? 'success' : 'brand';
  const historyId = `adjustments-${line.id}`;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <DeliverableIcon kind={line.kind} className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{name}</h3>
            {line.deliverableId === null && (
              <Badge tone="outline">{t('retainers.cycle.thisMonthOnly')}</Badge>
            )}
            {line.behind && <BehindBadge />}
            {over && <OverDeliveredBadge />}
          </div>
          {line.tasks.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('projects.milestones.tasks', {
                delivered: formatNumber(line.tasks.delivered),
                total: formatNumber(line.tasks.total),
              })}
            </p>
          )}
        </div>
        <p className="text-2xl font-bold tabular-nums" dir="ltr">
          {formatNumber(line.delivered)}
          <span className="text-base font-normal text-muted-foreground">
            /{formatNumber(line.committed)}
          </span>
        </p>
        {editable && (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setDialog('adjust')}>
              {t('retainers.cycle.adjust')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('retainers.cycle.lineActions', { name })}
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDialog('committed')}>
                  <PencilIcon />
                  {t('retainers.cycle.changeCommitted')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {line.committed > 0 ? (
        <Meter
          value={Math.min(line.delivered, line.committed)}
          max={line.committed}
          tone={tone}
          aria-label={t('retainers.cycle.counter', {
            name,
            delivered: formatNumber(line.delivered),
            committed: formatNumber(line.committed),
          })}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t('retainers.cycle.notCommitted')}</p>
      )}
      {line.adjustments.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            aria-expanded={history}
            aria-controls={historyId}
            onClick={() => setHistory((open) => !open)}
          >
            <HistoryIcon />
            {t('retainers.cycle.adjustments', {
              count: line.adjustments.length,
              n: formatNumber(line.adjustments.length),
            })}
            <ChevronDownIcon
              className={history ? 'rotate-180 transition-transform' : 'transition-transform'}
            />
          </Button>
          {history && <AdjustmentsList id={historyId} adjustments={line.adjustments} />}
        </div>
      )}
      <CommittedDialog
        retainerId={retainerId}
        cycleId={cycle.id}
        line={line}
        open={dialog === 'committed'}
        onClose={() => setDialog(null)}
      />
      <AdjustDialog
        retainerId={retainerId}
        cycleId={cycle.id}
        line={line}
        open={dialog === 'adjust'}
        onClose={() => setDialog(null)}
      />
    </li>
  );
}

/** A line's corrections, newest first. They are never edited: a new one corrects an old one. */
export function AdjustmentsList({
  id,
  adjustments,
}: {
  id?: string;
  adjustments: CycleDetail['lines'][number]['adjustments'];
}) {
  const { t } = useTranslation();
  return (
    <ol id={id} className="flex flex-col divide-y divide-border rounded-md bg-muted/40">
      {adjustments.map((adjustment) => (
        <li key={adjustment.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
          <Badge tone={adjustment.delta > 0 ? 'success' : 'warning'} className="tabular-nums">
            <span dir="ltr">
              {adjustment.delta > 0 ? '+' : '−'}
              {formatNumber(Math.abs(adjustment.delta))}
            </span>
          </Badge>
          <p className="min-w-0 flex-1 text-sm whitespace-pre-line">{adjustment.reason}</p>
          <p className="text-xs text-muted-foreground">
            {t('retainers.cycle.adjustedBy', {
              name: adjustment.author.name,
              when: formatDateTime(adjustment.createdAt),
            })}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** R9: this month's committed quantity of a line, with a reason. */
function CommittedDialog({
  retainerId,
  cycleId,
  line,
  open,
  onClose,
}: {
  retainerId: string;
  cycleId: string;
  line: CycleLine;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { quantity: useId(), reason: useId() };
  const update = useUpdateCycleLine(retainerId, cycleId);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<UpdateCycleLine>({
    resolver: standardSchemaResolver(updateCycleLineSchema),
    values: { committedQuantity: line.committed, reason: '' },
  });
  const errors = form.formState.errors;
  const name = lineName(t, line);

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await update.mutateAsync({ lineId: line.id, ...values });
      toast.add({ title: t('retainers.cycle.committedSaved'), type: 'success' });
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
            <DialogTitle>{t('retainers.cycle.committedTitle', { name })}</DialogTitle>
            <DialogDescription>{t('retainers.cycle.committedHint')}</DialogDescription>
          </DialogHeader>
          <Field invalid={!!errors.committedQuantity}>
            <FieldLabel htmlFor={ids.quantity}>{t('retainers.cycle.committed')}</FieldLabel>
            <Input
              id={ids.quantity}
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              className="w-32 text-end tabular-nums"
              {...form.register('committedQuantity', { valueAsNumber: true })}
            />
            <FieldError match={!!errors.committedQuantity}>
              {t('retainers.cycle.errors.committed')}
            </FieldError>
          </Field>
          <ReasonField
            id={ids.reason}
            registration={form.register('reason')}
            invalid={!!errors.reason}
          />
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

/** R7: a correction of the delivered count, added or taken away, with a reason. */
function AdjustDialog({
  retainerId,
  cycleId,
  line,
  open,
  onClose,
}: {
  retainerId: string;
  cycleId: string;
  line: CycleLine;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { direction: useId(), amount: useId(), reason: useId() };
  const adjust = useAdjustCycleLine(retainerId, cycleId);
  const [direction, setDirection] = useState<'add' | 'subtract'>('add');
  const [failure, setFailure] = useState<string | null>(null);
  // `delta` holds the amount; the direction gives its sign when sent.
  const form = useForm<CreateCycleAdjustment>({
    resolver: standardSchemaResolver(createCycleAdjustmentSchema),
    values: { delta: 1, reason: '' },
  });
  const amount = useWatch({ control: form.control, name: 'delta' });
  const errors = form.formState.errors;
  const name = lineName(t, line);
  const sign = direction === 'add' ? 1 : -1;
  const after = line.delivered + sign * (Number.isFinite(amount) ? Math.abs(amount) : 0);

  function close() {
    setFailure(null);
    setDirection('add');
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (after < 0) {
      form.setError('delta', { message: t('errors.NEGATIVE_DELIVERED') });
      return;
    }
    try {
      await adjust.mutateAsync({
        lineId: line.id,
        delta: sign * Math.abs(values.delta),
        reason: values.reason,
      });
      toast.add({ title: t('retainers.cycle.adjusted'), type: 'success' });
      close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NEGATIVE_DELIVERED') {
        form.setError('delta', { message: errorMessage(t, error) });
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('retainers.cycle.adjustTitle', { name })}</DialogTitle>
            <DialogDescription>{t('retainers.cycle.adjustHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-4">
            <Field>
              <FieldLabel id={ids.direction} render={<span />}>
                {t('retainers.cycle.direction')}
              </FieldLabel>
              <ToggleGroup
                aria-labelledby={ids.direction}
                value={[direction]}
                onValueChange={(next: ('add' | 'subtract')[]) => next[0] && setDirection(next[0])}
              >
                <ToggleGroupItem value="add">
                  <PlusIcon />
                  {t('retainers.cycle.add')}
                </ToggleGroupItem>
                <ToggleGroupItem value="subtract">
                  <MinusIcon />
                  {t('retainers.cycle.subtract')}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field invalid={!!errors.delta}>
              <FieldLabel htmlFor={ids.amount}>{t('retainers.cycle.amount')}</FieldLabel>
              <Input
                id={ids.amount}
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                className="w-28 text-end tabular-nums"
                {...form.register('delta', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">{t('retainers.cycle.deliveredAfter')} </span>
            <span className="font-bold tabular-nums" dir="ltr">
              {formatNumber(Math.max(after, 0))}/{formatNumber(line.committed)}
            </span>
          </p>
          {errors.delta && (
            <p role="alert" className="text-sm text-destructive-text">
              {errors.delta.message || t('retainers.cycle.errors.amount')}
            </p>
          )}
          <ReasonField
            id={ids.reason}
            registration={form.register('reason')}
            invalid={!!errors.reason}
          />
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

/** R9: a line for this cycle only, with a reason; the retainer's standing lines stay as they are. */
function AddLineDialog({
  retainerId,
  cycle,
  open,
  onClose,
}: {
  retainerId: string;
  cycle: CycleDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { kind: useId(), label: useId(), quantity: useId(), reason: useId() };
  const add = useAddCycleLine(retainerId, cycle.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateCycleLineInput, unknown, CreateCycleLine>({
    resolver: standardSchemaResolver(createCycleLineSchema),
    defaultValues: { kind: 'design', label: null, committedQuantity: 1, reason: '' },
  });
  const errors = form.formState.errors;
  const kind = useWatch({ control: form.control, name: 'kind' });
  const kinds = DELIVERABLE_KINDS.map((value) => ({
    value,
    label: t(`retainers.kinds.${value}`),
  }));

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await add.mutateAsync(values);
      toast.add({ title: t('retainers.cycle.lineAdded'), type: 'success' });
      close();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_DELIVERABLE') {
        form.setError('label', { message: errorMessage(t, error) });
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {t('retainers.cycle.addLineTitle', { month: formatMonth(cycle.month) })}
            </DialogTitle>
            <DialogDescription>{t('retainers.cycle.addLineHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel id={ids.kind} render={<span />}>
                {t('retainers.lines.kind')}
              </FieldLabel>
              <Controller
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <Select
                    items={kinds}
                    value={field.value}
                    onValueChange={(value) => value && field.onChange(value as DeliverableKind)}
                  >
                    <SelectTrigger aria-labelledby={ids.kind} onBlur={field.onBlur}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {kinds.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          <span className="flex items-center gap-2">
                            <DeliverableIcon kind={item.value} />
                            {item.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field invalid={!!errors.committedQuantity}>
              <FieldLabel htmlFor={ids.quantity}>{t('retainers.cycle.committed')}</FieldLabel>
              <Input
                id={ids.quantity}
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                className="text-end tabular-nums"
                {...form.register('committedQuantity', { valueAsNumber: true })}
              />
              <FieldError match={!!errors.committedQuantity}>
                {t('retainers.cycle.errors.committed')}
              </FieldError>
            </Field>
          </div>
          <Field invalid={!!errors.label}>
            <FieldLabel htmlFor={ids.label}>
              {t('retainers.lines.name')}
              {kind !== 'other' && (
                <span className="ms-1 font-normal text-muted-foreground">
                  ({t('common.optional')})
                </span>
              )}
            </FieldLabel>
            <Input
              id={ids.label}
              autoComplete="off"
              {...form.register('label', {
                setValueAs: (value: string | null) => value?.trim() || null,
              })}
            />
            <FieldError match={!!errors.label}>
              {errors.label?.message || t('retainers.lines.errors.label')}
            </FieldError>
          </Field>
          <ReasonField
            id={ids.reason}
            registration={form.register('reason')}
            invalid={!!errors.reason}
          />
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

/** Every change to a cycle carries why it was made (R9). */
function ReasonField({
  id,
  registration,
  invalid,
}: {
  id: string;
  registration: UseFormRegisterReturn<'reason'>;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{t('retainers.cycle.reason')}</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        placeholder={t('retainers.cycle.reasonPlaceholder')}
        {...registration}
      />
      <FieldDescription>{t('retainers.cycle.reasonHint')}</FieldDescription>
      <FieldError match={invalid}>{t('retainers.cycle.errors.reason')}</FieldError>
    </Field>
  );
}

/** Why there is no open cycle (paused, ended, not started yet, or waiting for the daily run). */
function NoOpenCycle({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const today = businessDate();
  if (retainer.status === 'ended') {
    return (
      <Callout
        icon={<CircleStopIcon />}
        title={t('retainers.cycle.none.endedTitle')}
        description={t('retainers.cycle.none.endedBody')}
      />
    );
  }
  if (retainer.status === 'paused') {
    return (
      <Callout
        tone="warning"
        icon={<PauseIcon />}
        title={t('retainers.cycle.none.pausedTitle')}
        description={t('retainers.cycle.none.pausedBody')}
      />
    );
  }
  if (retainer.startDate > today) {
    return (
      <Callout
        icon={<CalendarClockIcon />}
        title={t('retainers.cycle.none.notStartedTitle', {
          date: formatCalendarDate(retainer.startDate),
        })}
        description={t('retainers.cycle.none.notStartedBody')}
      />
    );
  }
  return (
    <Callout
      icon={retainer.archivedAt ? <CalendarOffIcon /> : <RepeatIcon />}
      title={t('retainers.cycle.none.waitingTitle')}
      description={t('retainers.cycle.none.waitingBody')}
    />
  );
}
