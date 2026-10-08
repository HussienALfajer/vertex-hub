import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  INVOICE_LIMITS,
  type InvoiceSettings,
  type UpdateInvoiceSettings,
  updateInvoiceSettingsSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, LockIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { rateInput, rateText } from '../../lib/money';
import { invoiceSettingsQuery, useUpdateInvoiceSettings } from './invoices.queries';

/** Spec screen 4: the current rate, payment terms and what every invoice prints. */
export function InvoiceSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery(invoiceSettingsQuery);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/invoices" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('invoices.back')}
        </Button>
      </div>
      <PageHeader
        title={t('invoices.settings.title')}
        description={t('invoices.settings.subtitle')}
      />
      {settings.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
        </div>
      ) : settings.isError ? (
        <LoadError message={t('invoices.settings.loadError')} onRetry={() => settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} />
      )}
    </>
  );
}

interface SettingsValues {
  sypPerUsd: string;
  paymentTermsDays: number;
  paymentDetails: string;
  invoiceFooter: string;
}

const fieldsOf = (settings: InvoiceSettings): SettingsValues => ({
  sypPerUsd: rateText(settings.sypPerUsd),
  paymentTermsDays: settings.paymentTermsDays,
  paymentDetails: settings.paymentDetails,
  invoiceFooter: settings.invoiceFooter,
});

/** The saved rate, which the resolver compares the typed one with. */
type RateContext = { storedRate: string | null };

/**
 * The rate is sent only when it changed: saving it again would date it today. Blank is allowed
 * only while no rate is set; once set, a rate is replaced, never removed.
 */
const settingsResolver = standardSchemaResolver(updateInvoiceSettingsSchema);

const resolver: Resolver<SettingsValues, RateContext, UpdateInvoiceSettings> = (
  values,
  context,
  options,
) => {
  const rate = rateInput(values.sypPerUsd);
  return settingsResolver(
    { ...values, sypPerUsd: rate === rateText(context?.storedRate ?? null) ? undefined : rate },
    context,
    // The same fields: only the values differ, the rate being left out when it did not change.
    options as Parameters<typeof settingsResolver>[2],
  ) as ReturnType<Resolver<SettingsValues, RateContext, UpdateInvoiceSettings>>;
};

function SettingsForm({ settings }: { settings: InvoiceSettings }) {
  const { t } = useTranslation();
  const update = useUpdateInvoiceSettings();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<SettingsValues, RateContext, UpdateInvoiceSettings>({
    resolver,
    context: { storedRate: settings.sypPerUsd },
    // A refetch (another manager saved) keeps what this user already changed.
    resetOptions: { keepDirtyValues: true },
    values: fieldsOf(settings),
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const readOnly = !settings.canEdit;

  const submit = form.handleSubmit(async (input) => {
    setFailure(null);
    try {
      // The saved values, trimmed by the API, become the form's clean state; the focus stays put.
      // `reset` would otherwise apply `keepDirtyValues` too and keep the text as typed.
      form.reset(fieldsOf(await update.mutateAsync(input)), { keepDirtyValues: false });
      toast.add({ title: t('invoices.settings.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      {readOnly && (
        <Callout
          icon={<LockIcon />}
          title={t('invoices.settings.readOnlyTitle')}
          description={t('invoices.settings.readOnlyBody')}
        />
      )}
      {settings.sypPerUsd === null ? (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('invoices.settings.noRateTitle')}
          description={t('invoices.settings.noRateHere')}
        />
      ) : (
        settings.rateStale && (
          <Callout
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={t('invoices.rate.staleTitle')}
            description={t('invoices.settings.staleBody')}
          />
        )
      )}
      <FormSection title={t('invoices.settings.rate')} hint={t('invoices.settings.rateHint')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!errors.sypPerUsd}>
            <FieldLabel>{t('invoices.settings.sypPerUsd')}</FieldLabel>
            <Input
              dir="ltr"
              inputMode="decimal"
              autoComplete="off"
              readOnly={readOnly}
              className="tabular-nums"
              {...form.register('sypPerUsd')}
            />
            <FieldDescription>
              {settings.rateUpdatedAt
                ? settings.rateUpdatedBy
                  ? t('invoices.rate.updatedBy', {
                      when: formatDateTime(settings.rateUpdatedAt),
                      name: settings.rateUpdatedBy.name,
                    })
                  : t('invoices.rate.updated', { when: formatDateTime(settings.rateUpdatedAt) })
                : t('invoices.settings.sypPerUsdHint')}
            </FieldDescription>
            <FieldError match={!!errors.sypPerUsd}>{t('invoices.rate.invalid')}</FieldError>
          </Field>
          <Field invalid={!!errors.paymentTermsDays}>
            <FieldLabel>{t('invoices.settings.paymentTermsDays')}</FieldLabel>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={INVOICE_LIMITS.paymentTermsDays}
              readOnly={readOnly}
              className="text-end tabular-nums"
              {...form.register('paymentTermsDays', { valueAsNumber: true })}
            />
            <FieldDescription>{t('invoices.settings.paymentTermsHint')}</FieldDescription>
            <FieldError match={!!errors.paymentTermsDays}>
              {t('invoices.settings.errors.paymentTerms')}
            </FieldError>
          </Field>
        </div>
      </FormSection>
      <FormSection title={t('invoices.settings.printed')} hint={t('invoices.settings.printedHint')}>
        <Field invalid={!!errors.paymentDetails}>
          <FieldLabel>{t('invoices.settings.paymentDetails')}</FieldLabel>
          {/* Each line takes its own direction: an IBAN or a phone `+963 …` would otherwise
              read backwards. */}
          <Textarea
            rows={5}
            readOnly={readOnly}
            className="[unicode-bidi:plaintext]"
            {...form.register('paymentDetails')}
          />
          <FieldDescription>{t('invoices.settings.paymentDetailsHint')}</FieldDescription>
          <FieldError match={!!errors.paymentDetails}>
            {t('invoices.settings.errors.long')}
          </FieldError>
        </Field>
        <Field invalid={!!errors.invoiceFooter}>
          <FieldLabel>{t('invoices.settings.invoiceFooter')}</FieldLabel>
          <Textarea
            rows={3}
            readOnly={readOnly}
            className="[unicode-bidi:plaintext]"
            {...form.register('invoiceFooter')}
          />
          <FieldDescription>{t('invoices.settings.invoiceFooterHint')}</FieldDescription>
          <FieldError match={!!errors.invoiceFooter}>
            {t('invoices.settings.errors.long')}
          </FieldError>
        </Field>
        <p className="text-sm text-muted-foreground">
          {t('invoices.settings.companyDetails')}{' '}
          <Link to="/catalog/settings" className="font-medium text-primary hover:underline">
            {t('quotes.settings.link')}
          </Link>
          .
        </p>
      </FormSection>
      {settings.updatedBy && (
        <p className="text-sm text-muted-foreground">
          {t('invoices.settings.updated', {
            name: settings.updatedBy.name,
            when: formatDateTime(settings.updatedAt),
          })}
        </p>
      )}
      {!readOnly && (
        <>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 md:-mx-8 md:px-8">
            {isDirty && (
              <p className="me-auto text-sm text-muted-foreground">{t('invoices.unsaved')}</p>
            )}
            {/* Focusable while disabled, so saving does not drop the focus. */}
            <Button type="submit" disabled={!isDirty || isSubmitting} focusableWhenDisabled>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      )}
      <UnsavedChangesGuard dirty={isDirty && !isSubmitting} />
    </form>
  );
}
