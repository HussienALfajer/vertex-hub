import { useQuery } from '@tanstack/react-query';
import {
  type AdWallet,
  type AdWalletEntryKind,
  businessDate,
  CURRENCIES,
  type Currency,
  PAYMENT_METHODS,
  type PaymentMethod,
  recordWalletEntrySchema,
  toUsdMinor,
  type WalletEntry,
} from '@vertex-hub/contracts';
import {
  Badge,
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
import {
  DownloadIcon,
  LoaderCircleIcon,
  PaperclipIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { latestVersion } from '../files/file-parts';
import { fileContentUrl, fileItemsQuery } from '../files/files.queries';
import { type Proof, ProofField } from '../files/proof-field';
import { RateHint, ReasonDialog, StaleRate, validRate } from '../invoices/invoice-dialogs';
import { invoiceSettingsQuery } from '../invoices/invoices.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  depositReceiptUrl,
  useRecordWalletEntry,
  useRenderDepositReceipt,
  useUpdateWalletThreshold,
  useVoidWalletEntry,
} from './campaigns.queries';

interface EntryValues {
  occurredOn: string;
  amountMinor: number | null;
  currency: Currency;
  sypPerUsd: string;
  method: PaymentMethod | null;
  reference: string;
  note: string;
}

/**
 * Spec screen 5: a deposit or a refund in USD or SYP at its own rate (rule 16), with its USD
 * amount and the balance after it; a refund above the balance is refused here as well.
 */
export function WalletEntryDialog({
  wallet,
  kind,
  onClose,
}: {
  wallet: AdWallet;
  /** The entry to record; null keeps the dialog closed. */
  kind: AdWalletEntryKind | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = { amount: useId(), currency: useId(), method: useId() };
  const record = useRecordWalletEntry(wallet.client.id);
  const open = kind !== null;
  const settings = useQuery({ ...invoiceSettingsQuery, enabled: open && can(me, 'invoices.read') });
  const today = businessDate();
  const defaults: EntryValues = {
    occurredOn: today,
    amountMinor: null,
    currency: 'USD',
    sypPerUsd: settings.data?.sypPerUsd ?? '',
    method: null,
    reference: '',
    note: '',
  };
  const form = useForm<EntryValues>({ values: defaults });
  const [proof, setProof] = useState<Proof | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const [currency, amount, rawRate] = form.watch(['currency', 'amountMinor', 'sypPerUsd']);
  const rate = rawRate.trim();
  // In SYP the rate converts the amount; without a current rate the API has none to fall back on
  // (`RATE_REQUIRED`, edge case 6).
  const showRate = currency === 'SYP' || !settings.data?.sypPerUsd;
  const usd =
    amount && amount > 0 && (currency === 'USD' || validRate(rate))
      ? toUsdMinor(amount, currency, rate || '1')
      : null;
  const refund = kind === 'refund';
  const balanceAfter = usd === null ? null : wallet.balanceMinor + (refund ? -usd : usd);
  const exceeds = refund && usd !== null && usd > wallet.balanceMinor;

  function close() {
    setFailure(null);
    proof?.controller?.abort();
    setProof(null);
    form.reset(defaults);
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (!kind || exceeds) return;
    if (proof && !proof.uploadId) {
      setFailure(t('campaigns.entry.proofWaiting'));
      return;
    }
    const checked = recordWalletEntrySchema.safeParse({
      kind,
      occurredOn: values.occurredOn,
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
        form.setError(issue.path.join('.') as keyof EntryValues, { type: 'schema' });
      }
      return;
    }
    try {
      await record.mutateAsync(checked.data);
      toast.add({
        title: refund ? t('campaigns.entry.refunded') : t('campaigns.entry.deposited'),
        type: 'success',
      });
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
      title={refund ? t('campaigns.entry.refundTitle') : t('campaigns.entry.depositTitle')}
      description={t(refund ? 'campaigns.entry.refundHint' : 'campaigns.entry.depositHint', {
        balance: isolateLtr(formatMoney(wallet.balanceMinor, 'USD')),
      })}
      action={refund ? t('campaigns.entry.refund') : t('campaigns.entry.deposit')}
      failure={failure}
      onSubmit={submit}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.occurredOn}>
          <FieldLabel>{t('campaigns.entry.occurredOn')}</FieldLabel>
          <Input
            type="date"
            max={today}
            {...form.register('occurredOn', { validate: (day) => !!day && day <= today })}
          />
          <FieldError match={!!errors.occurredOn}>
            {t('campaigns.entry.errors.occurredOn')}
          </FieldError>
        </Field>
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.currency} render={<span />}>
                {t('campaigns.entry.currency')}
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
        <Controller
          control={form.control}
          name="amountMinor"
          rules={{ validate: (minor) => !!minor && minor > 0 }}
          render={({ field }) => (
            <Field invalid={!!errors.amountMinor}>
              <FieldLabel htmlFor={ids.amount}>{t('campaigns.entry.amount')}</FieldLabel>
              <MoneyInput
                id={ids.amount}
                currency={currency}
                value={field.value}
                onValueChange={field.onChange}
              />
              <FieldError match={!!errors.amountMinor}>
                {t('campaigns.entry.errors.amount')}
              </FieldError>
            </Field>
          )}
        />
        {showRate && (
          <Field invalid={!!errors.sypPerUsd}>
            <FieldLabel>{t('invoices.rate.label')}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              className="tabular-nums"
              {...form.register('sypPerUsd', { validate: (value) => validRate(value) })}
            />
            <RateHint settings={settings.data} />
            <FieldError match={!!errors.sypPerUsd}>{t('invoices.rate.invalid')}</FieldError>
          </Field>
        )}
      </div>
      {showRate && <StaleRate settings={settings.data} />}
      {usd !== null && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-sm">
          {currency !== 'USD' && (
            <>
              <dt className="text-muted-foreground">{t('campaigns.entry.usd')}</dt>
              <dd>
                <Money minor={usd} currency="USD" />
              </dd>
            </>
          )}
          {balanceAfter !== null && (
            <>
              <dt className="text-muted-foreground">{t('campaigns.entry.balanceAfter')}</dt>
              <dd className="font-bold">
                <Money
                  minor={balanceAfter}
                  currency="USD"
                  className={balanceAfter < 0 ? 'text-destructive-text' : undefined}
                />
              </dd>
            </>
          )}
        </dl>
      )}
      {exceeds && (
        <Callout
          tone="danger"
          icon={<TriangleAlertIcon />}
          title={t('campaigns.entry.exceedsTitle')}
          description={t('errors.REFUND_EXCEEDS_BALANCE')}
        />
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="method"
          rules={{ validate: (method) => method !== null }}
          render={({ field }) => (
            <Field invalid={!!errors.method}>
              <FieldLabel id={ids.method} render={<span />}>
                {t('campaigns.entry.method')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.method}
                items={methodItems}
                value={field.value}
                placeholder={t('campaigns.entry.pickMethod')}
                onChange={field.onChange}
              />
              <FieldError match={!!errors.method}>{t('campaigns.entry.errors.method')}</FieldError>
            </Field>
          )}
        />
        <Field invalid={!!errors.reference}>
          <FieldLabel>{t('campaigns.entry.reference')}</FieldLabel>
          <Input autoComplete="off" {...form.register('reference')} />
          <FieldDescription>{t('invoices.payments.referenceHint')}</FieldDescription>
          <FieldError match={!!errors.reference}>
            {t('invoices.payments.errors.reference')}
          </FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('campaigns.entry.note')}</FieldLabel>
        <Textarea rows={2} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('invoices.payments.errors.note')}</FieldError>
      </Field>
      <ProofField
        proof={proof}
        onProof={setProof}
        label={t('campaigns.entry.proof')}
        hint={t('campaigns.entry.proofHint')}
      />
    </FormDialog>
  );
}

/** The low-balance threshold; empty turns the A11 alert off for the client. */
export function ThresholdDialog({
  wallet,
  open,
  onClose,
}: {
  wallet: AdWallet;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const save = useUpdateWalletThreshold(wallet.client.id);
  const [value, setValue] = useState<number | null>(wallet.lowBalanceThresholdMinor);
  const [failure, setFailure] = useState<string | null>(null);

  function close() {
    setFailure(null);
    setValue(wallet.lowBalanceThresholdMinor);
    onClose();
  }

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={save.isPending}
      title={t('campaigns.threshold.title')}
      description={t('campaigns.threshold.hint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={async (event) => {
        event?.preventDefault();
        setFailure(null);
        try {
          await save.mutateAsync({ lowBalanceThresholdMinor: value });
          toast.add({ title: t('campaigns.threshold.saved'), type: 'success' });
          onClose();
        } catch (error) {
          setFailure(errorMessage(t, error));
        }
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>{t('campaigns.threshold.label')}</FieldLabel>
        <MoneyInput id={id} currency="USD" value={value} onValueChange={setValue} />
        <FieldDescription>{t('campaigns.threshold.offHint')}</FieldDescription>
      </Field>
    </FormDialog>
  );
}

/** Rule 18: a void deposit keeps its receipt number; its receipt is archived. */
export function VoidEntryDialog({
  clientId,
  entry,
  onClose,
}: {
  clientId: string;
  entry: WalletEntry | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const voiding = useVoidWalletEntry(clientId);
  return (
    <ReasonDialog
      open={entry !== null}
      onClose={onClose}
      title={
        entry?.receiptNumber
          ? t('campaigns.void.depositTitle', { number: entry.receiptNumber })
          : t('campaigns.void.refundTitle')
      }
      description={t('campaigns.void.hint')}
      action={t('campaigns.void.confirm')}
      label={t('campaigns.void.reason')}
      onSubmit={async (reason) => {
        if (!entry) return true;
        await voiding.mutateAsync({ entryId: entry.id, reason });
        toast.add({ title: t('campaigns.void.done'), type: 'success' });
        return true;
      }}
    />
  );
}

/**
 * Rule 19: a deposit's receipt, "being prepared" until it exists. "Render again" is offered while
 * it is pending too: with the worker down it stays pending, and nothing re-queues it (edge case 14).
 */
export function DepositReceipt({ clientId, entry }: { clientId: string; entry: WalletEntry }) {
  const { t } = useTranslation();
  const render = useRenderDepositReceipt(clientId);
  if (!entry.receiptPdf || entry.voided) return null;
  if (entry.receiptPdf.state === 'ready') {
    return (
      <Button
        variant="ghost"
        size="sm"
        render={<a href={depositReceiptUrl(entry.id)} target="_blank" rel="noopener" />}
        aria-label={t('campaigns.ledger.receiptOf', { number: entry.receiptNumber })}
      >
        <DownloadIcon />
        {t('campaigns.ledger.receipt')}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {entry.receiptPdf.state === 'pending' ? (
        <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          {t('invoices.pdf.preparingReceipt')}
        </span>
      ) : (
        <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={render.isPending}
        onClick={async () => {
          try {
            await render.mutateAsync(entry.id);
          } catch (error) {
            toast.add({ title: errorMessage(t, error), type: 'error' });
          }
        }}
      >
        <RefreshCwIcon />
        {t('invoices.pdf.renderAgain')}
      </Button>
    </span>
  );
}

/**
 * The entry's proof: a document of the entry, kept out of the client's library (F10 rule 13), so
 * it opens from the entry's own documents.
 */
export function ProofLink({ entry }: { entry: WalletEntry }) {
  const files = useQuery({
    ...fileItemsQuery({ ownerType: 'ad_wallet_entry', ownerId: entry.id, role: 'document' }),
    enabled: entry.proof !== null,
  });
  if (!entry.proof) return null;
  const item = files.data?.items.find((candidate) => candidate.id === entry.proof?.id);
  const version = item && latestVersion(item.versions);
  const label = (
    <>
      <PaperclipIcon aria-hidden="true" className="size-4" />
      <span dir="auto">{entry.proof.name}</span>
    </>
  );
  return version ? (
    <a
      href={fileContentUrl(version.id)}
      target="_blank"
      rel="noopener"
      className="flex items-center gap-1 text-sm hover:underline"
    >
      {label}
    </a>
  ) : (
    <span className="flex items-center gap-1 text-sm text-muted-foreground">{label}</span>
  );
}
