import { useQuery } from '@tanstack/react-query';
import type {
  Amendment,
  AmendmentStatus,
  Currency,
  RetainerDetail,
  RetainerTerm,
  SourceInvoice,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { CalendarSyncIcon, CheckIcon, FilePenLineIcon, Undo2Icon, XIcon } from 'lucide-react';
import { type RefObject, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { MoneyInput } from '../../components/money-input';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatMonth, formatNumber, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { AmendmentDialog, EffectText } from './amendment-dialog';
import { lineName } from './retainer-badges';
import {
  retainerAmendmentsQuery,
  useDecideAmendment,
  useRescheduleTerm,
} from './retainers.queries';

const STATUS_TONES: Record<AmendmentStatus, NonNullable<BadgeProps['tone']>> = {
  pending_approval: 'warning',
  scheduled: 'info',
  applied: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  cancelled: 'neutral',
};

/**
 * F05B screen 3, the amendments list: lines, amount, status, creator and decision; the General
 * Manager approves or rejects pending ones, their creator or a manager withdraws them.
 */
export function AmendmentsSection({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const amendments = useQuery(retainerAmendmentsQuery(retainer.id));
  const currency = retainer.money?.currency ?? 'USD';
  const canApprove = can(me, 'retainers.approve_reduction');
  const { canManage, canEditMoney } = retainer.permissions;
  const titleId = useId();

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-bold">
          {t('retainers.amendments.title')}
        </h2>
        {canEditMoney && <AmendmentDialog retainer={retainer} />}
      </div>
      {amendments.isPending ? (
        <Skeleton className="h-24" />
      ) : amendments.isError ? (
        <LoadError
          message={t('retainers.amendments.loadError')}
          onRetry={() => amendments.refetch()}
          error={amendments.error}
        />
      ) : amendments.data.items.length === 0 ? (
        <EmptyState
          icon={<FilePenLineIcon />}
          title={t('retainers.amendments.emptyTitle')}
          description={t('retainers.amendments.emptyBody')}
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {amendments.data.items.map((amendment) => (
            <AmendmentCard
              key={amendment.id}
              retainerId={retainer.id}
              amendment={amendment}
              currency={currency}
              canApprove={canApprove && amendment.status === 'pending_approval'}
              canWithdraw={
                amendment.status === 'pending_approval' &&
                (canManage || amendment.createdBy?.id === me.user.id)
              }
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function AmendmentCard({
  retainerId,
  amendment,
  currency,
  canApprove,
  canWithdraw,
}: {
  retainerId: string;
  amendment: Amendment;
  currency: Currency;
  canApprove: boolean;
  canWithdraw: boolean;
}) {
  const { t } = useTranslation();
  const decide = useDecideAmendment(retainerId);
  const heading = useRef<HTMLHeadingElement>(null);
  // Approving, rejecting or withdrawing takes the card's buttons away: its heading takes the focus.
  useFocusAfterChange(amendment.status, () => heading.current);
  const money = amendment.money;
  // An applied amendment shows what it did; a pending or scheduled one what it would do (the
  // preview); a rejected, withdrawn or cancelled one changed nothing.
  const planned = amendment.status === 'pending_approval' || amendment.status === 'scheduled';
  const effectsShown = planned || amendment.status === 'applied';
  const title =
    amendment.kind === 'reschedule'
      ? t('retainers.amendments.reschedule')
      : amendment.kind === 'quote_renewal'
        ? t('retainers.amendments.quoteRenewal', { month: formatMonth(amendment.effectiveMonth) })
        : t(`retainers.amendments.scopeOf.${amendment.scope ?? 'month'}`, {
            month: formatMonth(amendment.effectiveMonth),
          });

  async function act(action: 'approve' | 'withdraw') {
    try {
      await decide.mutateAsync({ action, amendmentId: amendment.id });
      toast.add({ title: t(`retainers.amendments.done.${action}`), type: 'success' });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="amendment"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 ref={heading} tabIndex={-1} className="font-bold">
              {t('retainers.amendments.name', { number: formatNumber(amendment.number) })}
            </h3>
            <Badge tone={STATUS_TONES[amendment.status]}>
              {t(`retainers.amendments.statuses.${amendment.status}`)}
            </Badge>
            <span className="text-sm text-muted-foreground">{title}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {amendment.createdBy
              ? t('retainers.amendments.by', {
                  name: amendment.createdBy.name,
                  at: formatDateTime(amendment.createdAt),
                })
              : t('retainers.amendments.bySystem', { at: formatDateTime(amendment.createdAt) })}
          </p>
        </div>
        {money && amendment.kind === 'change' && money.amountDeltaMinor !== 0 && (
          <p className="text-base font-bold tabular-nums">
            {t(
              amendment.scope === 'onward'
                ? 'retainers.amendments.amountOnward'
                : 'retainers.amendments.amountMonth',
              {
                amount: isolateLtr(
                  `${money.amountDeltaMinor > 0 ? '+' : '−'}${formatMoney(
                    Math.abs(money.amountDeltaMinor),
                    currency,
                  )}`,
                ),
                month: formatMonth(amendment.effectiveMonth),
              },
            )}
          </p>
        )}
      </div>

      {amendment.lines.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {amendment.lines.map((line) => (
            <li key={line.position}>
              <Badge tone="outline">
                {isolateLtr(
                  `${(line.quantityDelta ?? 0) > 0 ? '+' : ''}${formatNumber(
                    line.quantityDelta ?? line.quantity ?? 0,
                  )}`,
                )}{' '}
                {lineName(t, line)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {money?.schedule && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {money.schedule.map((entry) => (
            <li key={entry.month}>
              <Badge tone="outline">
                {formatMonth(entry.month)}: {isolateLtr(formatMoney(entry.amountMinor, currency))}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">{t('retainers.amendments.reason')}: </span>
        {amendment.reason}
      </p>
      {effectsShown && amendment.effects.length > 0 && (
        <div className="flex flex-col gap-1.5 text-sm">
          {planned && (
            <p className="text-muted-foreground">{t('retainers.amendments.plannedEffects')}</p>
          )}
          <ul className="flex flex-col gap-1.5">
            {amendment.effects.map((effect) => (
              <li key={`${effect.month}-${effect.effect}`}>
                <EffectText effect={effect} currency={currency} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {amendment.decision && (
        <p className="text-sm text-muted-foreground">
          {t(
            amendment.decision.approved
              ? 'retainers.amendments.approvedBy'
              : 'retainers.amendments.rejectedBy',
            { name: amendment.decision.by.name, at: formatDateTime(amendment.decision.at) },
          )}
          {amendment.decision.note && ` — ${amendment.decision.note}`}
        </p>
      )}
      {(canApprove || canWithdraw) && (
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <>
              <Button
                size="sm"
                onClick={() => act('approve')}
                disabled={decide.isPending}
                focusableWhenDisabled
              >
                <CheckIcon />
                {t('retainers.amendments.approve')}
              </Button>
              <RejectDialog retainerId={retainerId} amendment={amendment} fallback={heading} />
            </>
          )}
          {canWithdraw && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => act('withdraw')}
              disabled={decide.isPending}
              focusableWhenDisabled
            >
              <Undo2Icon />
              {t('retainers.amendments.withdraw')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** A4: rejecting needs a note. */
function RejectDialog({
  retainerId,
  amendment,
  fallback,
}: {
  retainerId: string;
  amendment: Amendment;
  /** Where the focus goes once the rejection took the button away: the card's heading. */
  fallback: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const decide = useDecideAmendment(retainerId);
  const openButton = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!note.trim()) {
      setMissing(true);
      noteRef.current?.focus();
      return;
    }
    try {
      await decide.mutateAsync({ action: 'reject', amendmentId: amendment.id, note: note.trim() });
      toast.add({ title: t('retainers.amendments.done.reject'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button
        ref={openButton}
        size="sm"
        variant="outline"
        onClick={() => {
          setNote('');
          setMissing(false);
          setFailure(null);
          setOpen(true);
        }}
      >
        <XIcon />
        {t('retainers.amendments.reject')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent
          closeLabel={t('common.close')}
          finalFocus={() =>
            openButton.current?.isConnected ? openButton.current : (fallback.current ?? true)
          }
        >
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {t('retainers.amendments.rejectTitle', {
                  number: formatNumber(amendment.number),
                })}
              </DialogTitle>
              <DialogDescription>{t('retainers.amendments.rejectBody')}</DialogDescription>
            </DialogHeader>
            <Field invalid={missing}>
              <FieldLabel htmlFor={id}>{t('retainers.amendments.rejectNote')}</FieldLabel>
              <Textarea
                ref={noteRef}
                id={id}
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setMissing(false);
                }}
              />
              <FieldError match={missing}>{t('retainers.amendments.errors.note')}</FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={decide.isPending}>
                {t('retainers.amendments.reject')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A6: new amounts for the term's months that no issued invoice bills, with the same sum; saved
 * at once without approval.
 */
export function RescheduleDialog({
  retainerId,
  term,
  currency,
  invoices,
  fallback,
}: {
  retainerId: string;
  term: RetainerTerm;
  currency: Currency;
  invoices: Map<string, SourceInvoice | null>;
  /** Where the focus goes when the button is gone (fewer than two months left to move). */
  fallback: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const reschedule = useRescheduleTerm(retainerId);
  const openButton = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const months = term.schedule.filter((month) => {
    if (!month.chargeId || month.status !== 'pending' || !month.money) return false;
    const invoice = invoices.get(month.chargeId);
    return !invoice || invoice.status === 'draft';
  });
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<(number | null)[]>([]);
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<{ reason?: true; total?: true }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const before = months.reduce((total, month) => total + (month.money?.amountMinor ?? 0), 0);
  const after = amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const next = {
      ...(!reason.trim() && { reason: true as const }),
      ...(after !== before && { total: true as const }),
    };
    setProblems(next);
    if (next.reason || next.total) {
      // The first month when the amounts do not add up, else the reason.
      const target = next.total ? 'input' : 'textarea';
      formRef.current?.querySelector<HTMLElement>(target)?.focus();
      return;
    }
    try {
      await reschedule.mutateAsync({
        termId: term.id,
        reason: reason.trim(),
        schedule: months.map((month, index) => ({
          month: month.month,
          amountMinor: amounts[index] ?? 0,
        })),
      });
      toast.add({ title: t('retainers.amendments.rescheduled'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  if (months.length < 2) return null;
  return (
    <>
      <Button
        ref={openButton}
        variant="outline"
        size="sm"
        onClick={() => {
          setAmounts(months.map((month) => month.money?.amountMinor ?? 0));
          setReason('');
          setProblems({});
          setFailure(null);
          setOpen(true);
        }}
      >
        <CalendarSyncIcon />
        {t('retainers.amendments.reschedule')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent
          closeLabel={t('common.close')}
          className="max-w-xl"
          finalFocus={() =>
            openButton.current?.isConnected ? openButton.current : (fallback.current ?? true)
          }
        >
          <form ref={formRef} className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {t('retainers.amendments.rescheduleTitle', { number: formatNumber(term.number) })}
              </DialogTitle>
              <DialogDescription>{t('retainers.amendments.rescheduleHint')}</DialogDescription>
            </DialogHeader>
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {months.map((month, index) => (
                <li
                  key={month.month}
                  className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 px-3 py-2"
                >
                  <span className="text-sm font-medium">{formatMonth(month.month)}</span>
                  <MoneyInput
                    aria-label={t('retainers.terms.monthAmount', {
                      month: formatMonth(month.month),
                    })}
                    aria-invalid={!!problems.total || undefined}
                    currency={currency}
                    value={amounts[index] ?? null}
                    onValueChange={(minor) => {
                      setAmounts((current) =>
                        current.map((amount, at) => (at === index ? minor : amount)),
                      );
                      setProblems(({ total: _, ...rest }) => rest);
                    }}
                  />
                </li>
              ))}
            </ol>
            <p className="flex items-center justify-between gap-2 text-sm" aria-live="polite">
              <span className="text-muted-foreground">{t('retainers.terms.remaining')}</span>
              <span
                className={
                  before === after
                    ? 'font-bold tabular-nums'
                    : 'font-bold tabular-nums text-status-warning-foreground'
                }
              >
                {formatMoney(before - after, currency)}
              </span>
            </p>
            {problems.total && <FormAlert>{t('errors.SCHEDULE_TOTAL_MISMATCH')}</FormAlert>}
            <Field invalid={!!problems.reason}>
              <FieldLabel htmlFor={id}>{t('retainers.amendments.reason')}</FieldLabel>
              <Textarea
                id={id}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setProblems((current) => ({ ...current, reason: undefined }));
                }}
              />
              <FieldError match={!!problems.reason}>
                {t('retainers.amendments.errors.reason')}
              </FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={reschedule.isPending}>
                {reschedule.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
