import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import {
  addDays,
  businessDate,
  type CreateRetainer,
  type CreateRetainerInput,
  createRetainerSchema,
  currentCycleNumber,
  cyclePeriod,
  RETAINER_LIMITS,
  type RetainerDetail,
  type RetainerStatus,
  type UpdateRetainer,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  IconButton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CircleStopIcon,
  EllipsisIcon,
  ListChecksIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
} from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import {
  checkDuplicateLines,
  checkStartDate,
  DeliverablesEditor,
  type DeliverablesFormValues,
  DepartmentsField,
  MoneyFields,
  NameField,
  parseLines,
  retainerFormFailure,
  StartDateField,
} from './retainer-form';
import {
  useChangeRetainerStatus,
  useUpdateDeliverables,
  useUpdateRetainer,
} from './retainers.queries';

/**
 * The retainer page's controls that take the focus when an action removes the one that held it:
 * a status change swaps the header's buttons and notices (archive → restore → actions menu).
 */
export interface RetainerFocus {
  heading: RefObject<HTMLHeadingElement | null>;
  /** "Resume" on a paused retainer. */
  resume: RefObject<HTMLButtonElement | null>;
  menu: RefObject<HTMLButtonElement | null>;
  reactivate: RefObject<HTMLButtonElement | null>;
  restore: RefObject<HTMLButtonElement | null>;
}

type FocusTarget = Exclude<keyof RetainerFocus, 'heading'>;

/** The first of these controls still on the page, else the heading: a dialog's `finalFocus`. */
export function focusTarget(focus: RetainerFocus, ...order: FocusTarget[]) {
  for (const name of order) {
    const element = focus[name].current;
    if (element?.isConnected) return element;
  }
  return focus.heading.current ?? true;
}

/**
 * The header's actions: edit, edit lines, the status change that fits (pause or resume, end, or
 * reactivate), and archive. Only what the caller may do is offered; the API enforces it (R12).
 */
export function RetainerActions({
  retainer,
  focus,
  onArchive,
}: {
  retainer: RetainerDetail;
  focus: RetainerFocus;
  /** The confirmation lives on the page: the menu leaves with the archive. */
  onArchive: () => void;
}) {
  const { t } = useTranslation();
  const { permissions, status } = retainer;
  const change = useChangeRetainerStatus(retainer.id);
  const [dialog, setDialog] = useState<'end' | 'resume' | 'reactivate' | null>(null);

  if (retainer.archivedAt !== null) return null;
  const manage = permissions.canManage;
  const menu = manage || permissions.canArchive;

  async function move(to: RetainerStatus) {
    try {
      await change.mutateAsync({ status: to });
      toast.add({ title: t(`retainers.actions.done.${to}`), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {manage && <EditRetainer retainer={retainer} />}
      {manage && <EditLines retainer={retainer} />}
      {manage && status === 'paused' && (
        <Button
          ref={focus.resume}
          disabled={change.isPending}
          // It leaves with the change: the focus then moves to the actions menu.
          focusableWhenDisabled
          onClick={() => (resumeChoice(retainer) ? setDialog('resume') : move('active'))}
        >
          <PlayIcon />
          {t('retainers.actions.resume')}
        </Button>
      )}
      {permissions.canReactivate && (
        <Button ref={focus.reactivate} onClick={() => setDialog('reactivate')}>
          <RotateCcwIcon />
          {t('retainers.actions.reactivate')}
        </Button>
      )}
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <IconButton
                ref={focus.menu}
                variant="outline"
                size="icon"
                label={t('projects.actions.more')}
              />
            }
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {manage && status === 'active' && (
              <DropdownMenuItem onClick={() => move('paused')}>
                <PauseIcon />
                {t('retainers.actions.pause')}
              </DropdownMenuItem>
            )}
            {manage && (
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('end')}>
                <CircleStopIcon />
                {t('retainers.actions.end')}
              </DropdownMenuItem>
            )}
            {permissions.canArchive && (
              <>
                {manage && <DropdownMenuSeparator />}
                <DropdownMenuItem variant="destructive" onClick={onArchive}>
                  <ArchiveIcon />
                  {t('retainers.actions.archive')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <EndDialog
        retainer={retainer}
        open={dialog === 'end'}
        onClose={() => setDialog(null)}
        // Ended: the reactivate button, or the menu (archive) for those who may not reactivate.
        finalFocus={() => focusTarget(focus, 'reactivate', 'menu')}
      />
      <ResumeDialog
        retainer={retainer}
        mode={dialog === 'reactivate' ? 'reactivate' : 'resume'}
        open={dialog === 'resume' || dialog === 'reactivate'}
        onClose={() => setDialog(null)}
        finalFocus={() =>
          dialog === 'reactivate'
            ? focusTarget(focus, 'reactivate', 'menu')
            : focusTarget(focus, 'resume', 'menu')
        }
      />
    </div>
  );
}

/**
 * F05C P2–P4: whether resuming or reactivating asks when the retainer starts again: a started,
 * open-ended retainer without an open cycle in its current period. With an open cycle it goes on;
 * a term's cycle opens at once (its charge is due anyway, P3).
 */
function resumeChoice(retainer: RetainerDetail): boolean {
  const current = currentCycleNumber(retainer.startDate, businessDate());
  if (current === 0 || retainer.currentCycle) return false;
  const term = retainer.term;
  const covered =
    term?.status === 'active' &&
    term.startCycle <= current &&
    current < term.startCycle + term.cycles;
  return !covered;
}

/**
 * Spec screen 4: resuming or reactivating an open-ended retainer without a cycle in its current
 * period: from the next cycle (the default) or a full cycle now with a full fee (P2). A cycle that
 * closed on ending stays closed (P4): reactivating in it starts from the next cycle. Without the
 * choice, reactivating only confirms.
 */
function ResumeDialog({
  retainer,
  mode,
  open,
  onClose,
  finalFocus,
}: {
  retainer: RetainerDetail;
  mode: 'resume' | 'reactivate';
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const id = useId();
  const change = useChangeRetainerStatus(retainer.id);
  const [choice, setChoice] = useState<'next' | 'now'>('next');
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const current = currentCycleNumber(retainer.startDate, today);
  const asks = resumeChoice(retainer);
  const period = cyclePeriod(retainer.startDate, Math.max(1, current));
  const next = cyclePeriod(retainer.startDate, current + 1).periodStart;
  const closedNow =
    mode === 'reactivate' && retainer.endedOn !== null && retainer.endedOn >= period.periodStart;
  const fee = retainer.money?.monthlyFeeMinor ?? null;
  const currency = retainer.money?.currency ?? 'USD';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    try {
      await change.mutateAsync({
        status: 'active',
        ...(asks && !closedNow && choice === 'now' && { startNow: true }),
      });
      toast.add({
        title: t(
          mode === 'reactivate'
            ? 'retainers.actions.done.reactivated'
            : 'retainers.actions.done.active',
        ),
        type: 'success',
      });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => {
        if (next) return;
        setChoice('next');
        setFailure(null);
      }}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>
              {t(mode === 'reactivate' ? 'retainers.reactivate.title' : 'retainers.resume.title', {
                name: retainer.name,
              })}
            </DialogTitle>
            <DialogDescription>
              {asks
                ? t('retainers.resume.body')
                : mode === 'reactivate'
                  ? t('retainers.reactivate.body')
                  : t('retainers.resume.continues')}
            </DialogDescription>
          </DialogHeader>
          {asks && closedNow && (
            <p className="text-sm">
              {t('retainers.resume.closedThisCycle', { date: formatCalendarDate(next) })}
            </p>
          )}
          {asks && !closedNow && (
            <Field>
              <FieldLabel id={id} render={<span />}>
                {t('retainers.resume.when')}
              </FieldLabel>
              <ToggleGroup
                aria-labelledby={id}
                value={[choice]}
                onValueChange={(value: ('next' | 'now')[]) => {
                  if (value[0]) setChoice(value[0]);
                }}
              >
                <ToggleGroupItem value="next">
                  {t('retainers.resume.next', { date: formatCalendarDate(next) })}
                </ToggleGroupItem>
                <ToggleGroupItem value="now">{t('retainers.resume.now')}</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription>
                {choice === 'next'
                  ? t('retainers.resume.nextHint')
                  : fee !== null && retainer.money
                    ? t('retainers.resume.nowHint', {
                        date: formatCalendarDate(period.periodEnd),
                        fee: formatMoney(fee, currency),
                      })
                    : t('retainers.resume.nowHintNoFee', {
                        date: formatCalendarDate(period.periodEnd),
                      })}
              </FieldDescription>
            </Field>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={change.isPending}>
              {t(
                mode === 'reactivate' ? 'retainers.actions.reactivate' : 'retainers.actions.resume',
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * F05 R5 with F05B E1, E2: ending closes the open cycle; with a term, later unbilled cycles are
 * cancelled and an optional termination fee (money access) drafts an invoice.
 */
function EndDialog({
  retainer,
  open,
  onClose,
  finalFocus,
}: {
  retainer: RetainerDetail;
  open: boolean;
  onClose: () => void;
  finalFocus: () => HTMLElement | true;
}) {
  const { t } = useTranslation();
  const ids = { fee: useId(), reason: useId() };
  const change = useChangeRetainerStatus(retainer.id);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [feeMinor, setFeeMinor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const withFee = !!retainer.term && retainer.permissions.canEditMoney;
  const currency = retainer.money?.currency ?? 'USD';
  // The last day of the retainer's terms: the day before the derived renewal date (T3').
  const current = cyclePeriod(
    retainer.startDate,
    Math.max(1, currentCycleNumber(retainer.startDate, businessDate())),
  );
  const lastDay = retainer.term && retainer.renewalDate ? addDays(retainer.renewalDate, -1) : null;
  const laterCycles = lastDay !== null && lastDay > current.periodEnd;

  // After the exit animation, so the fee and reason do not vanish while the dialog fades.
  function closed() {
    setFeeMinor(null);
    setReason('');
    setMissingReason(false);
    setFailure(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const fee = withFee && feeMinor ? feeMinor : null;
    if (fee && !reason.trim()) {
      setMissingReason(true);
      reasonRef.current?.focus();
      return;
    }
    try {
      await change.mutateAsync({
        status: 'ended',
        ...(fee && { termination: { feeMinor: fee, reason: reason.trim() } }),
      });
      toast.add({ title: t('retainers.actions.done.ended'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && closed()}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('retainers.end.title', { name: retainer.name })}</DialogTitle>
            <DialogDescription>{t('retainers.end.body')}</DialogDescription>
          </DialogHeader>
          {laterCycles && lastDay && (
            <p className="text-sm">
              {t('retainers.end.termCycles', { date: formatCalendarDate(lastDay) })}
            </p>
          )}
          {withFee && (
            <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
              <Field>
                <FieldLabel htmlFor={ids.fee}>
                  {t('retainers.end.fee')}
                  <span className="ms-1 font-normal text-muted-foreground">
                    ({t('common.optional')})
                  </span>
                </FieldLabel>
                <MoneyInput
                  id={ids.fee}
                  currency={currency}
                  value={feeMinor}
                  onValueChange={setFeeMinor}
                />
                <FieldDescription>{t('retainers.end.feeHint')}</FieldDescription>
              </Field>
              {!!feeMinor && (
                <Field invalid={missingReason}>
                  <FieldLabel htmlFor={ids.reason}>{t('retainers.end.feeReason')}</FieldLabel>
                  <Textarea
                    ref={reasonRef}
                    id={ids.reason}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setMissingReason(false);
                    }}
                  />
                  <FieldError match={missingReason}>
                    {t('retainers.end.feeReasonRequired')}
                  </FieldError>
                </Field>
              )}
            </div>
          )}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={change.isPending}>
              {t('retainers.actions.end')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The retainer's basics as one form: name, departments, the start date and, with money access,
 * the currency and monthly fee. The start date is fixed once a cycle or a charge exists (F05C
 * edge case 8); the fee and currency once the retainer has a charge (A9, M2). The renewal date
 * follows the term (T3'). Only changed fields are sent.
 */
function EditRetainer({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const update = useUpdateRetainer(retainer.id);
  const { canEditMoney } = retainer.permissions;
  const editButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A retainer that started has a cycle: it opens on the start date (R2, R3).
  const started = retainer.startDate <= businessDate();
  const fee = retainer.money?.monthlyFeeMinor ?? null;
  // A term's months are charges; a started retainer with a fee charged its first month (C2).
  const charged = retainer.term !== null || (started && fee !== null);
  const form = useForm<CreateRetainerInput, unknown, CreateRetainer>({
    resolver: standardSchemaResolver(createRetainerSchema),
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      clientId: retainer.client.id,
      name: retainer.name,
      departments: retainer.departments,
      startDate: retainer.startDate,
      currency: retainer.money?.currency ?? 'USD',
      monthlyFeeMinor: fee,
      deliverables: [],
    },
  });

  // After the exit animation: the next opening starts from the saved retainer. A plain `reset()`
  // would apply `keepDirtyValues` and keep what was typed.
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!checkStartDate(form, t, values.startDate)) return;
    const dirty = form.formState.dirtyFields;
    const changes: UpdateRetainer = {
      ...(dirty.name && { name: values.name }),
      ...(dirty.departments && { departments: values.departments }),
      ...(!started && !charged && dirty.startDate && { startDate: values.startDate }),
      ...(canEditMoney && !charged && dirty.currency && { currency: values.currency }),
      ...(canEditMoney &&
        !charged &&
        dirty.monthlyFeeMinor && { monthlyFeeMinor: values.monthlyFeeMinor ?? null }),
    };
    // Nothing changed: close without a request or a "saved" toast.
    if (Object.keys(changes).length === 0) return setOpen(false);
    try {
      await update.mutateAsync(changes);
      toast.add({ title: t('projects.edit.saved'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(retainerFormFailure(form, t, error));
    }
  });

  return (
    <>
      <Button ref={editButton} variant="outline" onClick={() => setOpen(true)}>
        <PencilIcon />
        {t('common.edit')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(next) => !next && closed()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl" finalFocus={editButton}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('retainers.edit.title')}</DialogTitle>
            </DialogHeader>
            <NameField form={form} />
            <DepartmentsField form={form} />
            <StartDateField form={form} startLocked={started || charged} />
            {canEditMoney && <MoneyFields form={form} locked={charged} />}
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
    </>
  );
}

/** The retainer's standing lines. Changes apply from the next cycle (R10). */
function EditLines({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const update = useUpdateDeliverables(retainer.id);
  const editButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<DeliverablesFormValues>({
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
    values: {
      deliverables: retainer.deliverables.map(
        ({ id, kind, label, monthlyQuantity, revisionLimit }) => ({
          id,
          kind,
          label,
          monthlyQuantity,
          revisionLimit,
        }),
      ),
    },
  });

  // Read during render: the form tracks `isDirty` only for a component that reads it.
  const { isDirty } = form.formState;

  // After the exit animation: the next opening starts from the saved lines (see EditRetainer).
  function closed() {
    setFailure(null);
    form.reset(undefined, { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return setOpen(false);
    const lines = parseLines(form, values.deliverables, () =>
      setFailure(
        t('retainers.lines.errors.invalid', {
          max: formatNumber(RETAINER_LIMITS.deliverables),
        }),
      ),
    );
    if (!lines || !checkDuplicateLines(form, t, lines)) return;
    try {
      await update.mutateAsync({ lines });
      toast.add({ title: t('retainers.lines.saved'), type: 'success' });
      setOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_DELIVERABLE') {
        checkDuplicateLines(form, t, lines);
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <>
      <Button ref={editButton} variant="outline" onClick={() => setOpen(true)}>
        <ListChecksIcon />
        {t('retainers.actions.editLines')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} onOpenChangeComplete={(next) => !next && closed()}>
        <DialogContent closeLabel={t('common.close')} className="max-w-3xl" finalFocus={editButton}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('retainers.lines.editTitle')}</DialogTitle>
              <DialogDescription>{t('retainers.lines.editHint')}</DialogDescription>
            </DialogHeader>
            <DeliverablesEditor form={form} />
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
    </>
  );
}
