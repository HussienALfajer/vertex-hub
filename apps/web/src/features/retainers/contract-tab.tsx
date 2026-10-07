import { useQuery } from '@tanstack/react-query';
import {
  addMonths,
  businessDate,
  type CalendarDate,
  firstOfMonth,
  type RetainerDetail,
  type RetainerTerm,
  type RetainerTermMonth,
  type SourceInvoice,
  type TermEndAction,
  type TermStatus,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { CalendarRangeIcon, PencilIcon, PlusIcon, RepeatIcon, XIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatMonth, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { retainerBillingQuery } from '../invoices/invoices.queries';
import { SourceInvoiceCell } from '../invoices/source-invoice';
import { Money } from '../quotes/quote-badges';
import {
  retainerTermsQuery,
  useCancelTerm,
  useCreateTerm,
  useUpdateTerm,
} from './retainers.queries';
import {
  draftOf,
  EMPTY_TERM,
  isTermProblems,
  parseTerm,
  type TermDraft,
  TermPlanEditor,
  type TermProblems,
} from './term-fields';

const STATUS_TONES: Record<TermStatus, NonNullable<BadgeProps['tone']>> = {
  active: 'success',
  scheduled: 'info',
  completed: 'neutral',
  cancelled: 'neutral',
};

/**
 * F05B screen 3: the retainer's current and scheduled terms with their schedules, then past
 * terms. Amounts and changes need money access (G3); others see months and end actions.
 */
export function ContractTab({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const { canSeeMoney, canEditMoney } = retainer.permissions;
  const terms = useQuery(retainerTermsQuery(retainer.id));
  const billing = useQuery({ ...retainerBillingQuery(retainer.id), enabled: canSeeMoney });

  if (terms.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (terms.isError) {
    return (
      <LoadError
        message={t('retainers.terms.loadError')}
        onRetry={() => terms.refetch()}
        error={terms.error}
      />
    );
  }

  const items = terms.data.items;
  const open = items
    .filter((term) => term.status === 'active' || term.status === 'scheduled')
    .sort((a, b) => a.number - b.number);
  const past = items.filter((term) => term.status === 'completed' || term.status === 'cancelled');
  const canAdd = canEditMoney && !items.some((term) => term.status === 'scheduled');
  const invoices = new Map(
    (billing.data?.charges ?? []).map((charge) => [charge.id, charge.invoice] as const),
  );
  const currency = retainer.money?.currency ?? 'USD';
  const add = canAdd && <TermDialog retainer={retainer} />;

  return (
    <div className="flex flex-col gap-6">
      {open.length === 0 ? (
        <EmptyState
          icon={<CalendarRangeIcon />}
          title={t('retainers.terms.emptyTitle')}
          description={
            !retainer.money
              ? t('retainers.terms.emptyBodyNoMoney')
              : retainer.money.monthlyFeeMinor === null
                ? t('retainers.terms.emptyBodyNoFee')
                : t('retainers.terms.emptyBody', {
                    fee: formatMoney(retainer.money.monthlyFeeMinor, currency),
                  })
          }
          action={add}
        />
      ) : (
        <>
          {open.map((term) => (
            <TermCard
              key={term.id}
              retainer={retainer}
              term={term}
              invoices={invoices}
              editable={canEditMoney}
            />
          ))}
          {add && <div>{add}</div>}
        </>
      )}
      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">{t('retainers.terms.past')}</h2>
          {past.map((term) => (
            <TermCard
              key={term.id}
              retainer={retainer}
              term={term}
              invoices={invoices}
              editable={false}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function TermCard({
  retainer,
  term,
  invoices,
  editable,
}: {
  retainer: RetainerDetail;
  term: RetainerTerm;
  invoices: Map<string, SourceInvoice | null>;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const currency = retainer.money?.currency ?? 'USD';
  const open = term.status === 'active' || term.status === 'scheduled';
  const money = term.money;
  const amended = money && money.currentTotalMinor !== money.agreedTotalMinor;

  return (
    <section
      aria-label={t('retainers.terms.name', { number: formatNumber(term.number) })}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">
              {t('retainers.terms.name', { number: formatNumber(term.number) })}
            </h2>
            <Badge tone={STATUS_TONES[term.status]}>
              {t(`retainers.terms.statuses.${term.status}`)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('retainers.terms.range', {
              start: formatMonth(term.startMonth),
              end: formatMonth(term.endMonth),
            })}
            {' · '}
            {t('retainers.terms.monthsCount', { count: term.months, n: formatNumber(term.months) })}
          </p>
          {term.renewedFrom && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RepeatIcon aria-hidden="true" className="size-4" />
              {t('retainers.terms.renewedFrom', { number: formatNumber(term.renewedFrom.number) })}
            </p>
          )}
          {term.status === 'cancelled' && (
            <p className="text-sm text-muted-foreground">
              {term.cancelReason
                ? t('retainers.terms.cancelledBecause', { reason: term.cancelReason })
                : t('retainers.terms.cancelledOnEnd')}
            </p>
          )}
        </div>
        {editable && term.status === 'scheduled' && (
          <div className="flex flex-wrap gap-2">
            <TermDialog retainer={retainer} term={term} />
            <CancelTermDialog retainerId={retainer.id} term={term} />
          </div>
        )}
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        {money && (
          <>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">{t('retainers.terms.agreed')}</dt>
              <dd className="text-xl font-bold">
                <Money minor={money.agreedTotalMinor} currency={currency} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">{t('retainers.terms.current')}</dt>
              <dd
                className={
                  amended ? 'text-xl font-bold text-status-gold-foreground' : 'text-xl font-bold'
                }
              >
                <Money minor={money.currentTotalMinor} currency={currency} />
              </dd>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t('retainers.terms.endAction')}</dt>
          <dd>
            {editable && open ? (
              <EndActionSelect retainerId={retainer.id} term={term} />
            ) : (
              <span className="font-medium">
                {t(`retainers.terms.endActions.${term.endAction}`)}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {editable && term.status === 'active' && (
        <p className="text-sm text-muted-foreground">{t('retainers.terms.activeHint')}</p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('retainers.terms.columns.month')}</TableHead>
            {money && (
              <TableHead className="text-end">{t('retainers.terms.columns.base')}</TableHead>
            )}
            {money && (
              <TableHead className="text-end">{t('retainers.terms.columns.total')}</TableHead>
            )}
            <TableHead>{t('retainers.terms.columns.state')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {term.schedule.map((month) => (
            <TableRow key={month.month}>
              <TableCell>
                <span className="flex flex-col">
                  <span className="font-medium">{formatMonth(month.month)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('retainers.terms.position', {
                      position: formatNumber(month.position),
                      months: formatNumber(term.months),
                    })}
                  </span>
                </span>
              </TableCell>
              {month.money && (
                <TableCell className="text-end">
                  <Money minor={month.money.baseAmountMinor} currency={currency} />
                </TableCell>
              )}
              {month.money && (
                <TableCell className="text-end font-medium">
                  <Money minor={month.money.totalMinor} currency={currency} />
                </TableCell>
              )}
              <TableCell>
                <MonthState month={month} invoices={invoices} withMoney={!!money} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** "not due", "due", the invoice that bills the month (money access), or "cancelled". */
function MonthState({
  month,
  invoices,
  withMoney,
}: {
  month: RetainerTermMonth;
  invoices: Map<string, SourceInvoice | null>;
  withMoney: boolean;
}) {
  const { t } = useTranslation();
  const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;
  if (!month.status || month.status === 'cancelled')
    return muted(t('retainers.terms.states.cancelled'));
  if (month.status === 'settled_outside') return muted(t('retainers.terms.states.settled_outside'));
  if (!month.due) return muted(t('retainers.terms.states.notDue'));
  if (withMoney && month.chargeId) {
    return <SourceInvoiceCell invoice={invoices.get(month.chargeId) ?? null} />;
  }
  return <span>{t('retainers.terms.states.due')}</span>;
}

/** T10: an active or scheduled term changes its end action at once. */
function EndActionSelect({ retainerId, term }: { retainerId: string; term: RetainerTerm }) {
  const { t } = useTranslation();
  const update = useUpdateTerm(retainerId);
  const items = (['renew', 'end', 'continue'] as const).map((action) => ({
    value: action,
    label: t(`retainers.terms.endActions.${action}`),
  }));
  return (
    <Select
      items={items}
      value={term.endAction}
      disabled={update.isPending}
      onValueChange={async (next: TermEndAction | null) => {
        if (!next || next === term.endAction) return;
        try {
          await update.mutateAsync({ termId: term.id, endAction: next });
          toast.add({ title: t('retainers.terms.endActionSaved'), type: 'success' });
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    >
      <SelectTrigger className="w-fit min-w-40" aria-label={t('retainers.terms.endAction')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The months a term may start in: this month and the next two years. */
function startMonths(today: CalendarDate): CalendarDate[] {
  const first = firstOfMonth(today);
  return Array.from({ length: 25 }, (_, index) => addMonths(first, index));
}

/** "Add term" (T2–T4), or "Edit" a scheduled term (T5). */
function TermDialog({ retainer, term }: { retainer: RetainerDetail; term?: RetainerTerm }) {
  const { t } = useTranslation();
  const ids = { start: useId() };
  const create = useCreateTerm(retainer.id);
  const update = useUpdateTerm(retainer.id);
  const [open, setOpen] = useState(false);
  const [startMonth, setStartMonth] = useState<CalendarDate | null>(null);
  const [draft, setDraft] = useState<TermDraft>(EMPTY_TERM);
  const [problems, setProblems] = useState<TermProblems & { start?: true }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const months = startMonths(businessDate());
  const items = months.map((month) => ({ value: month, label: formatMonth(month) }));

  function openDialog() {
    setStartMonth(term?.startMonth ?? null);
    setDraft(term ? draftOf(term) : EMPTY_TERM);
    setProblems({});
    setFailure(null);
    setOpen(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const parsed = parseTerm(draft);
    const next = {
      ...(isTermProblems(parsed) ? parsed : {}),
      ...(!startMonth && { start: true as const }),
    };
    setProblems(next);
    if (isTermProblems(parsed) || !startMonth) return;
    setPending(true);
    try {
      if (term) {
        await update.mutateAsync({ termId: term.id, startMonth, ...parsed });
        toast.add({ title: t('retainers.terms.saved'), type: 'success' });
      } else {
        await create.mutateAsync({ startMonth, ...parsed });
        toast.add({ title: t('retainers.terms.created'), type: 'success' });
      }
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {term ? (
        <Button variant="outline" size="sm" onClick={openDialog}>
          <PencilIcon />
          {t('retainers.terms.edit')}
        </Button>
      ) : (
        <Button onClick={openDialog}>
          <PlusIcon />
          {t('retainers.terms.add')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {term
                  ? t('retainers.terms.editTitle', { number: formatNumber(term.number) })
                  : t('retainers.terms.addTitle')}
              </DialogTitle>
              <DialogDescription>
                {term ? t('retainers.terms.editHint') : t('retainers.terms.addHint')}
              </DialogDescription>
            </DialogHeader>
            <Field invalid={!!problems.start}>
              <FieldLabel htmlFor={ids.start}>{t('retainers.terms.startMonth')}</FieldLabel>
              <Select
                items={items}
                value={startMonth}
                onValueChange={(value: CalendarDate | null) => setStartMonth(value)}
              >
                <SelectTrigger id={ids.start}>
                  <SelectValue placeholder={t('retainers.terms.startMonth')} />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError match={!!problems.start}>
                {t('retainers.terms.errors.startMonth')}
              </FieldError>
            </Field>
            <TermPlanEditor
              value={draft}
              onChange={setDraft}
              startMonth={startMonth}
              currency={retainer.money?.currency ?? 'USD'}
              problems={problems}
            />
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending
                  ? t('common.saving')
                  : term
                    ? t('common.save')
                    : t('retainers.terms.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** T5: a scheduled term is cancelled with a reason. */
function CancelTermDialog({ retainerId, term }: { retainerId: string; term: RetainerTerm }) {
  const { t } = useTranslation();
  const id = useId();
  const cancel = useCancelTerm(retainerId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    try {
      await cancel.mutateAsync({ termId: term.id, reason: reason.trim() });
      toast.add({ title: t('retainers.terms.cancelled'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setReason('');
          setMissing(false);
          setFailure(null);
          setOpen(true);
        }}
      >
        <XIcon />
        {t('retainers.terms.cancel')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent closeLabel={t('common.close')}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>
                {t('retainers.terms.cancelTitle', { number: formatNumber(term.number) })}
              </DialogTitle>
              <DialogDescription>{t('retainers.terms.cancelBody')}</DialogDescription>
            </DialogHeader>
            <Field invalid={missing}>
              <FieldLabel htmlFor={id}>{t('retainers.terms.cancelReason')}</FieldLabel>
              <Textarea
                id={id}
                rows={2}
                maxLength={500}
                placeholder={t('retainers.terms.cancelReasonPlaceholder')}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setMissing(false);
                }}
              />
              <FieldError match={missing}>{t('retainers.terms.errors.reason')}</FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={cancel.isPending}>
                {t('retainers.terms.cancel')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
