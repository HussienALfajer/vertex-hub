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
import { type ComponentProps, type ReactNode, useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { formatCalendarDate, formatDateTime, isolateLtr } from '../../lib/format';
import { formatMoney, rateInput, rateText } from '../../lib/money';
import { useShownWhileClosing } from '../../lib/use-shown-while-closing';
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
        rate: rateText(settings.sypPerUsd),
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

type FinalFocus = ComponentProps<typeof FormDialog>['finalFocus'];

/** Refusals of the issue and payment dialogs that are about one of their fields. */
const ISSUE_FIELDS: Partial<Record<string, keyof IssueValues>> = {
  INVALID_DATES: 'dueOn',
  RATE_REQUIRED: 'sypPerUsd',
};

/**
 * Rule 9: issued today, due by default after the draft's payment terms, at the current rate
 * (editable); rule 10 warns about a stale rate without refusing it.
 */
export function IssueDialog({
  invoice,
  settings,
  open,
  onClose,
  finalFocus,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes without issuing (issuing replaces the editor). */
  finalFocus?: FinalFocus;
}) {
  const { t } = useTranslation();
  const issue = useIssueInvoice(invoice.id);
  const today = businessDate();
  const defaults: IssueValues = {
    dueOn: addDays(today, invoice.paymentTermsDays),
    sypPerUsd: rateText(settings?.sypPerUsd ?? null),
  };
  const form = useForm<IssueValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  // Arabic-Indic digits and the Arabic decimal mark are read as typed on an Arabic keyboard.
  const rate = rateInput(form.watch('sypPerUsd'));
  const usd =
    invoice.currency === 'USD'
      ? null
      : validRate(rate)
        ? toUsdMinor(invoice.totalMinor, invoice.currency, rate)
        : null;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const issued = await issue.mutateAsync({
        updatedAt: invoice.updatedAt,
        dueOn: values.dueOn,
        sypPerUsd: rateInput(values.sypPerUsd),
      });
      toast.add({
        title: t('invoices.issue.done', { number: issued.displayNumber ?? '' }),
        type: 'success',
      });
      onClose();
    } catch (error) {
      const field = error instanceof ApiError ? ISSUE_FIELDS[error.code ?? ''] : undefined;
      if (field) {
        form.setError(
          field,
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      // Reset once it has faded out, so nothing typed is kept for the next opening.
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
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
            dir="ltr"
            min={today}
            {...form.register('dueOn', { validate: (day) => !!day && day >= today })}
          />
          <FieldError match={!!errors.dueOn} role={errorRole(errors.dueOn)}>
            {fieldError(errors.dueOn, t('invoices.issue.errors.dueOn'))}
          </FieldError>
        </Field>
        <Field invalid={!!errors.sypPerUsd}>
          <FieldLabel>{t('invoices.rate.label')}</FieldLabel>
          <Input
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...form.register('sypPerUsd', { validate: (value) => validRate(rateInput(value)) })}
          />
          <RateHint settings={settings} />
          <FieldError match={!!errors.sypPerUsd} role={errorRole(errors.sypPerUsd)}>
            {fieldError(errors.sypPerUsd, t('invoices.rate.invalid'))}
          </FieldError>
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

const PAYMENT_FIELDS: Partial<Record<string, keyof PaymentValues>> = {
  INVALID_DATES: 'paidOn',
  OVERPAYMENT: 'amountMinor',
  RATE_REQUIRED: 'sypPerUsd',
};

/**
 * Rules 16–20: a payment in either currency at its own rate; the dialog shows what it pays of the
 * invoice and what is left, and refuses more than the balance (no client credit).
 */
export function PaymentDialog({
  invoice,
  settings,
  open,
  onClose,
  finalFocus,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: a payment that settles the invoice removes its button. */
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const ids = { amount: useId(), currency: useId(), method: useId() };
  const record = useRecordPayment(invoice.id);
  const today = businessDate();
  const defaults: PaymentValues = {
    paidOn: today,
    amountMinor: null,
    currency: invoice.currency,
    sypPerUsd: rateText(settings?.sypPerUsd ?? null),
    method: null,
    reference: '',
    note: '',
  };
  // The first invalid field takes the focus, the selects and the amount included (they register
  // no element).
  const form = useForm<PaymentValues>({ values: defaults, shouldFocusError: false });
  const fields = useRef<HTMLDivElement>(null);
  useFocusFirstError(form.formState.submitCount, fields);
  const [proof, setProof] = useState<Proof | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const [currency, amount, rawRate] = form.watch(['currency', 'amountMinor', 'sypPerUsd']);
  // Arabic-Indic digits and the Arabic decimal mark are read as typed on an Arabic keyboard.
  const rate = rateInput(rawRate);
  // The rate matters across currencies, and is always asked for in SYP (spec screen 3).
  // Without a current rate the API has none to fall back on (`RATE_REQUIRED`, edge case 8).
  const showRate = currency === 'SYP' || invoice.currency === 'SYP' || !settings?.sypPerUsd;
  const rateReady = !showRate || validRate(rate);
  const crosses = currency !== invoice.currency;
  const applied =
    amount && amount > 0 && (!crosses || validRate(rate))
      ? applyPayment(invoice.balanceMinor, amount, currency, invoice.currency, rate || '1')
      : undefined;
  // More than the balance, or so little that it converts to nothing in the invoice's currency.
  const refused = applied === null || applied === 0;

  function payTheRest() {
    if (crosses && !validRate(rate)) {
      form.setError('sypPerUsd', { type: 'validate' }, { shouldFocus: true });
      return;
    }
    const rest = convertMinor(invoice.balanceMinor, invoice.currency, currency, rate || '1');
    form.setValue('amountMinor', rest, { shouldDirty: true, shouldValidate: true });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (refused) return;
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
      onClose();
    } catch (error) {
      const field = error instanceof ApiError ? PAYMENT_FIELDS[error.code ?? ''] : undefined;
      if (field && (field !== 'sypPerUsd' || showRate)) {
        form.setError(field, { type: SCREEN_ERROR, message: errorMessage(t, error) });
      } else {
        setFailure(errorMessage(t, error));
      }
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
      onClose={onClose}
      // Reset once it has faded out, so nothing typed is kept for the next opening.
      onClosed={() => {
        setFailure(null);
        proof?.controller?.abort();
        setProof(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('invoices.payments.title')}
      description={t('invoices.payments.hint', {
        balance: isolateLtr(formatMoney(invoice.balanceMinor, invoice.currency)),
      })}
      action={t('invoices.payments.record')}
      failure={failure}
      onSubmit={submit}
    >
      <div ref={fields} className="contents">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!errors.paidOn}>
            <FieldLabel>{t('invoices.payments.paidOn')}</FieldLabel>
            <Input
              type="date"
              dir="ltr"
              max={today}
              {...form.register('paidOn', { validate: (day) => !!day && day <= today })}
            />
            <FieldError match={!!errors.paidOn} role={errorRole(errors.paidOn)}>
              {fieldError(errors.paidOn, t('invoices.payments.errors.paidOn'))}
            </FieldError>
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
                {...form.register('sypPerUsd', {
                  validate: (value) => validRate(rateInput(value)),
                })}
              />
              <RateHint settings={settings} />
              <FieldError match={!!errors.sypPerUsd} role={errorRole(errors.sypPerUsd)}>
                {fieldError(errors.sypPerUsd, t('invoices.rate.invalid'))}
              </FieldError>
            </Field>
          )}
          <Controller
            control={form.control}
            name="amountMinor"
            rules={{ validate: (minor) => !!minor && minor > 0 }}
            render={({ field }) => (
              <Field invalid={!!errors.amountMinor || refused} className="sm:col-span-2">
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={payTheRest}
                    disabled={!rateReady}
                  >
                    {t('invoices.payments.payTheRest')}
                  </Button>
                </div>
                <FieldError
                  match={!!errors.amountMinor || refused}
                  role={refused ? 'alert' : errorRole(errors.amountMinor)}
                >
                  {applied === null
                    ? t('errors.OVERPAYMENT')
                    : applied === 0
                      ? t('invoices.payments.errors.tooSmall')
                      : fieldError(errors.amountMinor, t('invoices.payments.errors.amount'))}
                </FieldError>
              </Field>
            )}
          />
        </div>
        {applied !== undefined && !refused && (
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
            <Input autoComplete="off" dir="auto" {...form.register('reference')} />
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
      </div>
    </FormDialog>
  );
}
/** A dialog asking for a reason (≤ 500 characters) before an action. */
export function ReasonDialog({
  open,
  onClose,
  onClosed,
  title,
  description,
  action,
  label,
  onSubmit,
  children,
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** Runs once it has faded out, after its own reset: the place to reset the fields it holds. */
  onClosed?: () => void;
  title: string;
  description: string;
  action: string;
  label: string;
  /** Where the focus goes when it closes, when the button that opened it may be gone. */
  finalFocus?: FinalFocus;
  /** Runs the action; `false` keeps the dialog open (a field of the dialog is invalid). */
  onSubmit: (reason: string) => Promise<boolean | undefined>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ reason }) => {
    setFailure(null);
    try {
      if ((await onSubmit(reason.trim())) !== false) onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset();
        onClosed?.();
      }}
      finalFocus={finalFocus}
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

/**
 * Rule 13: a new due date with a reason; the PDF is rendered again. The current date is no change,
 * so it is refused here rather than rendering the PDF again for nothing.
 */
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
  const current = invoice.dueOn ?? today;
  const [dueOn, setDueOn] = useState(current);
  const [invalid, setInvalid] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  function refuse(message: string) {
    setInvalid(message);
    field.current?.focus();
    return false;
  }

  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setDueOn(current);
        setInvalid(null);
      }}
      title={t('invoices.dueDate.title')}
      description={t('invoices.dueDate.hint')}
      action={t('invoices.dueDate.confirm')}
      label={t('invoices.dueDate.reason')}
      onSubmit={async (reason) => {
        if (!dueOn || dueOn < today) return refuse(t('invoices.issue.errors.dueOn'));
        if (dueOn === invoice.dueOn) return refuse(t('invoices.dueDate.errors.same'));
        try {
          await change.mutateAsync({ dueOn, reason });
        } catch (error) {
          if (error instanceof ApiError && error.knownCode === 'INVALID_DATES') {
            return refuse(errorMessage(t, error));
          }
          throw error;
        }
        toast.add({ title: t('invoices.dueDate.done'), type: 'success' });
        return true;
      }}
    >
      <Field invalid={invalid !== null}>
        <FieldLabel>{t('invoices.dueDate.newDate')}</FieldLabel>
        <Input
          ref={field}
          type="date"
          dir="ltr"
          min={today}
          value={dueOn}
          onChange={(event) => {
            setDueOn(event.target.value);
            setInvalid(null);
          }}
        />
        <FieldError match={invalid !== null} role="alert">
          {invalid}
        </FieldError>
      </Field>
    </ReasonDialog>
  );
}

/** Rule 14: the number stays used, the sources are released, the PDF stays. */
export function VoidInvoiceDialog({
  invoice,
  open,
  onClose,
  finalFocus,
}: {
  invoice: InvoiceDetail;
  open: boolean;
  onClose: () => void;
  /** Voiding removes the invoice's actions, the button that opened it included. */
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const voiding = useVoidInvoice(invoice.id);
  return (
    <ReasonDialog
      open={open}
      onClose={onClose}
      finalFocus={finalFocus}
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
  finalFocus,
}: {
  /** The payment to void; none while closed. */
  payment: Payment | null;
  onClose: () => void;
  /** Voiding removes the payment's button. */
  finalFocus: FinalFocus;
}) {
  const { t } = useTranslation();
  const voiding = useVoidPayment();
  // Its title keeps the receipt number while it fades out.
  const shown = useShownWhileClosing(payment);
  return (
    <ReasonDialog
      open={payment !== null}
      onClose={onClose}
      finalFocus={finalFocus}
      title={t('invoices.voidPayment.title', { number: shown?.receiptNumber ?? '' })}
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
