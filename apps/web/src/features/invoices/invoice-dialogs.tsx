import {
  addDays,
  applyPayment,
  businessDate,
  CURRENCIES,
  type Currency,
  convertMinor,
  exchangeRateSchema,
  type InvoiceDetail,
  type InvoiceSettings,
  PAYMENT_METHODS,
  type Payment,
  type PaymentMethod,
  recordPaymentSchema,
  toUsdMinor,
  voidInvoiceSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { TriangleAlertIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { type Proof, ProofField } from '../files/proof-field';
import { ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  useChangeDueDate,
  useIssueInvoice,
  useRecordPayment,
  useVoidInvoice,
  useVoidPayment,
} from './invoices.queries';

export const validRate = (rate: string) => exchangeRateSchema.safeParse(rate).success;

/** The rate's date and author, and the stale warning of rule 10. */
export function RateHint({ settings }: { settings: InvoiceSettings | undefined }) {
  const { t } = useTranslation();
  if (!settings?.rateUpdatedAt) return null;
  return (
    <FieldDescription>
      {t('invoices.rate.current', {
        rate: settings.sypPerUsd ?? '',
        when: formatDateTime(settings.rateUpdatedAt),
      })}
    </FieldDescription>
  );
}

export function StaleRate({ settings }: { settings: InvoiceSettings | undefined }) {
  const { t } = useTranslation();
  if (!settings?.rateStale) return null;
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('invoices.rate.staleTitle')}
      description={t('invoices.rate.staleBody')}
    />
  );
}

interface IssueValues {
  dueOn: string;
  sypPerUsd: string;
}

/**
 * Rule 9: issued today, due by default after the draft's payment terms, at the current rate
 * (editable); rule 10 warns about a stale rate without refusing it.
 */
export function IssueDialog({
  invoice,
  settings,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const issue = useIssueInvoice(invoice.id);
  const today = businessDate();
  const defaults = {
    dueOn: addDays(today, invoice.paymentTermsDays),
    sypPerUsd: settings?.sypPerUsd ?? '',
  };
  const form = useForm<IssueValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const rate = form.watch('sypPerUsd').trim();
  const usd =
    invoice.currency === 'USD'
      ? null
      : validRate(rate)
        ? toUsdMinor(invoice.totalMinor, invoice.currency, rate)
        : null;

  function close() {
    setFailure(null);
    form.reset(defaults);
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const issued = await issue.mutateAsync({
        updatedAt: invoice.updatedAt,
        dueOn: values.dueOn,
        sypPerUsd: values.sypPerUsd.trim(),
      });
      toast.add({
        title: t('invoices.issue.done', { number: issued.displayNumber ?? '' }),
        type: 'success',
      });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={form.formState.isSubmitting}
      title={t('invoices.issue.title')}
      description={t('invoices.issue.hint')}
      action={t('invoices.issue.confirm')}
      failure={failure}
      onSubmit={submit}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('invoices.issue.issuedOn')}</dt>
        <dd>{formatCalendarDate(today)}</dd>
        <dt className="text-muted-foreground">{t('invoices.facts.total')}</dt>
        <dd className="font-bold">
          <Money minor={invoice.totalMinor} currency={invoice.currency} />
        </dd>
        {usd !== null && (
          <>
            <dt className="text-muted-foreground">{t('invoices.issue.usd')}</dt>
            <dd>
              <Money minor={usd} currency="USD" />
            </dd>
          </>
        )}
      </dl>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.dueOn}>
          <FieldLabel>{t('invoices.issue.dueOn')}</FieldLabel>
          <Input
            type="date"
            min={today}
            {...form.register('dueOn', { validate: (day) => !!day && day >= today })}
          />
          <FieldError match={!!errors.dueOn}>{t('invoices.issue.errors.dueOn')}</FieldError>
        </Field>
        <Field invalid={!!errors.sypPerUsd}>
          <FieldLabel>{t('invoices.rate.label')}</FieldLabel>
          <Input
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...form.register('sypPerUsd', { validate: (value) => validRate(value) })}
          />
          <RateHint settings={settings} />
          <FieldError match={!!errors.sypPerUsd}>{t('invoices.rate.invalid')}</FieldError>
        </Field>
      </div>
      <StaleRate settings={settings} />
    </FormDialog>
  );
}

interface PaymentValues {
  paidOn: string;
  amountMinor: number | null;
  currency: Currency;
  sypPerUsd: string;
  method: PaymentMethod | null;
  reference: string;
  note: string;
}

/**
 * Rules 16–20: a payment in either currency at its own rate; the dialog shows what it pays of the
 * invoice and what is left, and refuses more than the balance (no client credit).
 */
export function PaymentDialog({
  invoice,
  settings,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { amount: useId(), currency: useId(), method: useId() };
  const record = useRecordPayment(invoice.id);
  const today = businessDate();
  const defaults: PaymentValues = {
    paidOn: today,
    amountMinor: null,
    currency: invoice.currency,
    sypPerUsd: settings?.sypPerUsd ?? '',
    method: null,
    reference: '',
    note: '',
  };
  const form = useForm<PaymentValues>({ values: defaults });
  const [proof, setProof] = useState<Proof | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const [currency, amount, rawRate] = form.watch(['currency', 'amountMinor', 'sypPerUsd']);
  const rate = rawRate.trim();
  // The rate matters across currencies, and is always asked for in SYP (spec screen 3).
  // Without a current rate the API has none to fall back on (`RATE_REQUIRED`, edge case 8).
  const showRate = currency === 'SYP' || invoice.currency === 'SYP' || !settings?.sypPerUsd;
  const rateReady = !showRate || validRate(rate);
  const crosses = currency !== invoice.currency;
  const applied =
    amount && amount > 0 && (!crosses || validRate(rate))
      ? applyPayment(invoice.balanceMinor, amount, currency, invoice.currency, rate || '1')
      : undefined;

  function close() {
    setFailure(null);
    proof?.controller?.abort();
    setProof(null);
    form.reset(defaults);
    onClose();
  }

  function payTheRest() {
    if (crosses && !validRate(rate)) {
      form.setError('sypPerUsd', { type: 'validate' });
      return;
    }
    const rest = convertMinor(invoice.balanceMinor, invoice.currency, currency, rate || '1');
    form.setValue('amountMinor', rest, { shouldDirty: true, shouldValidate: true });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (applied === null) return;
    if (proof && !proof.uploadId) {
      setFailure(t('invoices.payments.proofWaiting'));
      return;
    }
    const checked = recordPaymentSchema.safeParse({
      paidOn: values.paidOn,
      amountMinor: values.amountMinor ?? 0,
      currency: values.currency,
      sypPerUsd: showRate ? rate : null,
      method: values.method,
      reference: values.reference.trim() || null,
      note: values.note.trim() || null,
      proofUploadId: proof?.uploadId ?? null,
    });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        form.setError(issue.path.join('.') as keyof PaymentValues, { type: 'schema' });
      }
      return;
    }
    try {
      await record.mutateAsync(checked.data);
      toast.add({ title: t('invoices.payments.recorded'), type: 'success' });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const currencyItems = CURRENCIES.map((code) => ({
    value: code,
    label: t(`invoices.currencies.${code}`),
  }));
  const methodItems = PAYMENT_METHODS.map((method) => ({
    value: method,
    label: t(`invoices.methods.${method}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={form.formState.isSubmitting}
      title={t('invoices.payments.title')}
      description={t('invoices.payments.hint', {
        balance: isolateLtr(formatMoney(invoice.balanceMinor, invoice.currency)),
      })}
      action={t('invoices.payments.record')}
      failure={failure}
      onSubmit={submit}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.paidOn}>
          <FieldLabel>{t('invoices.payments.paidOn')}</FieldLabel>
          <Input
            type="date"
            max={today}
            {...form.register('paidOn', { validate: (day) => !!day && day <= today })}
          />
          <FieldError match={!!errors.paidOn}>{t('invoices.payments.errors.paidOn')}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.currency} render={<span />}>
                {t('invoices.payments.currency')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.currency}
                items={currencyItems}
                value={field.value}
                onChange={(next) => {
                  field.onChange(next);
                  form.setValue('amountMinor', null);
                }}
              />
            </Field>
          )}
        />
        {showRate && (
          <Field invalid={!!errors.sypPerUsd} className="sm:col-span-2">
            <FieldLabel>{t('invoices.rate.label')}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              {...form.register('sypPerUsd', { validate: (value) => validRate(value) })}
            />
            <RateHint settings={settings} />
            <FieldError match={!!errors.sypPerUsd}>{t('invoices.rate.invalid')}</FieldError>
          </Field>
        )}
        <Controller
          control={form.control}
          name="amountMinor"
          rules={{ validate: (minor) => !!minor && minor > 0 }}
          render={({ field }) => (
            <Field invalid={!!errors.amountMinor} className="sm:col-span-2">
              <FieldLabel htmlFor={ids.amount}>{t('invoices.payments.amount')}</FieldLabel>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <MoneyInput
                    id={ids.amount}
                    currency={currency}
                    value={field.value}
                    onValueChange={field.onChange}
                  />
                </div>
                <Button type="button" variant="outline" onClick={payTheRest} disabled={!rateReady}>
                  {t('invoices.payments.payTheRest')}
                </Button>
              </div>
              <FieldError match={!!errors.amountMinor}>
                {t('invoices.payments.errors.amount')}
              </FieldError>
            </Field>
          )}
        />
      </div>
      {applied === null ? (
        <Callout
          tone="danger"
          icon={<TriangleAlertIcon />}
          title={t('invoices.payments.overpaymentTitle')}
          description={t('errors.OVERPAYMENT')}
        />
      ) : (
        applied !== undefined && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm">
            {crosses && (
              <>
                <dt className="text-muted-foreground">{t('invoices.payments.applied')}</dt>
                <dd>
                  <Money minor={applied} currency={invoice.currency} />
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('invoices.payments.balanceAfter')}</dt>
            <dd className="font-bold">
              <Money minor={invoice.balanceMinor - applied} currency={invoice.currency} />
            </dd>
          </dl>
        )
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="method"
          rules={{ validate: (method) => method !== null }}
          render={({ field }) => (
            <Field invalid={!!errors.method}>
              <FieldLabel id={ids.method} render={<span />}>
                {t('invoices.payments.method')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.method}
                items={methodItems}
                value={field.value}
                placeholder={t('invoices.payments.pickMethod')}
                onChange={field.onChange}
              />
              <FieldError match={!!errors.method}>
                {t('invoices.payments.errors.method')}
              </FieldError>
            </Field>
          )}
        />
        <Field invalid={!!errors.reference}>
          <FieldLabel>{t('invoices.payments.reference')}</FieldLabel>
          <Input autoComplete="off" {...form.register('reference')} />
          <FieldDescription>{t('invoices.payments.referenceHint')}</FieldDescription>
          <FieldError match={!!errors.reference}>
            {t('invoices.payments.errors.reference')}
          </FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('invoices.payments.note')}</FieldLabel>
        <Textarea rows={2} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('invoices.payments.errors.note')}</FieldError>
      </Field>
      <ProofField
        proof={proof}
        onProof={setProof}
        label={t('invoices.payments.proof')}
        hint={t('invoices.payments.proofHint')}
      />
    </FormDialog>
  );
}

/** A dialog asking for a reason (≤ 500 characters) before an action. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  action,
  label,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  action: string;
  label: string;
  /** Runs the action; `false` keeps the dialog open (a field of the dialog is invalid). */
  onSubmit: (reason: string) => Promise<boolean | undefined>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async ({ reason }) => {
    setFailure(null);
    try {
      if ((await onSubmit(reason.trim())) !== false) close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={form.formState.isSubmitting}
      title={title}
      description={description}
      action={action}
      failure={failure}
      onSubmit={submit}
    >
      {children}
      <Field invalid={!!errors.reason}>
        <FieldLabel>{label}</FieldLabel>
        <Textarea
          rows={3}
          {...form.register('reason', {
            // Every reason of F13 has the same rule (void, payment void, due date).
            validate: (reason) => voidInvoiceSchema.shape.reason.safeParse(reason).success,
          })}
        />
        <FieldError match={!!errors.reason}>{t('invoices.errors.reason')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** Rule 13: a later due date with a reason; the PDF is rendered again. */
export function DueDateDialog({
  invoice,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const change = useChangeDueDate(invoice.id);
  const today = businessDate();
  const [dueOn, setDueOn] = useState(invoice.dueOn ?? today);
  const [invalid, setInvalid] = useState(false);
  return (
    <ReasonDialog
      open={open}
      onClose={() => {
        setDueOn(invoice.dueOn ?? today);
        setInvalid(false);
        onClose();
      }}
      title={t('invoices.dueDate.title')}
      description={t('invoices.dueDate.hint')}
      action={t('invoices.dueDate.confirm')}
      label={t('invoices.dueDate.reason')}
      onSubmit={async (reason) => {
        if (!dueOn || dueOn < today) {
          setInvalid(true);
          return false;
        }
        await change.mutateAsync({ dueOn, reason });
        toast.add({ title: t('invoices.dueDate.done'), type: 'success' });
        return true;
      }}
    >
      <Field invalid={invalid}>
        <FieldLabel>{t('invoices.dueDate.newDate')}</FieldLabel>
        <Input
          type="date"
          min={today}
          value={dueOn}
          onChange={(event) => {
            setDueOn(event.target.value);
            setInvalid(false);
          }}
        />
        <FieldError match={invalid}>{t('invoices.issue.errors.dueOn')}</FieldError>
      </Field>
    </ReasonDialog>
  );
}

/** Rule 14: the number stays used, the sources are released, the PDF stays. */
export function VoidInvoiceDialog({
  invoice,
  open,
  onClose,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const voiding = useVoidInvoice(invoice.id);
  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      title={t('invoices.void.title', { number: invoice.displayNumber ?? '' })}
      description={t('invoices.void.hint')}
      action={t('invoices.void.confirm')}
      label={t('invoices.void.reason')}
      onSubmit={async (reason) => {
        await voiding.mutateAsync({ reason });
        toast.add({ title: t('invoices.void.done'), type: 'success' });
        return true;
      }}
    />
  );
}

/** Rule 22: the receipt number stays used and its document is archived. */
export function VoidPaymentDialog({
  payment,
  onClose,
}: {
  payment: Payment | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const voiding = useVoidPayment();
  return (
    <ReasonDialog
      open={payment !== null}
      onClose={onClose}
      title={t('invoices.voidPayment.title', { number: payment?.receiptNumber ?? '' })}
      description={t('invoices.voidPayment.hint')}
      action={t('invoices.voidPayment.confirm')}
      label={t('invoices.voidPayment.reason')}
      onSubmit={async (reason) => {
        if (!payment) return true;
        await voiding.mutateAsync({ paymentId: payment.id, reason });
        toast.add({ title: t('invoices.voidPayment.done'), type: 'success' });
        return true;
      }}
    />
  );
}
