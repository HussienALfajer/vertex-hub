import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  exchangeRateSchema,
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
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
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
        <SettingsForm key={settings.data.updatedAt} settings={settings.data} />
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

function SettingsForm({ settings }: { settings: InvoiceSettings }) {
  const { t } = useTranslation();
  const update = useUpdateInvoiceSettings();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<SettingsValues>({
    defaultValues: {
      sypPerUsd: settings.sypPerUsd ?? '',
      paymentTermsDays: settings.paymentTermsDays,
      paymentDetails: settings.paymentDetails,
      invoiceFooter: settings.invoiceFooter,
    },
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const readOnly = !settings.canEdit;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const rate = values.sypPerUsd.trim();
    // The rate is sent only when it changed: saving it again would date it today.
    const input: UpdateInvoiceSettings = {
      ...(rate && rate !== settings.sypPerUsd && { sypPerUsd: rate }),
      paymentTermsDays: values.paymentTermsDays,
      paymentDetails: values.paymentDetails,
      invoiceFooter: values.invoiceFooter,
    };
    const checked = updateInvoiceSettingsSchema.safeParse(input);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        form.setError(issue.path.join('.') as keyof SettingsValues, { type: 'schema' });
      }
      return;
    }
    try {
      await update.mutateAsync(checked.data);
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
          description={t('invoices.settings.noRateBody')}
        />
      ) : (
        settings.rateStale && (
          <Callout
            tone="warning"
            icon={<TriangleAlertIcon />}
            title={t('invoices.rate.staleTitle')}
            description={t('invoices.rate.staleBody')}
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
              className="text-end tabular-nums"
              {...form.register('sypPerUsd', {
                validate: (value) =>
                  (!value.trim() && settings.sypPerUsd === null) ||
                  exchangeRateSchema.safeParse(value).success,
              })}
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
          <Textarea rows={5} readOnly={readOnly} {...form.register('paymentDetails')} />
          <FieldDescription>{t('invoices.settings.paymentDetailsHint')}</FieldDescription>
          <FieldError match={!!errors.paymentDetails}>
            {t('invoices.settings.errors.long')}
          </FieldError>
        </Field>
        <Field invalid={!!errors.invoiceFooter}>
          <FieldLabel>{t('invoices.settings.invoiceFooter')}</FieldLabel>
          <Textarea rows={3} readOnly={readOnly} {...form.register('invoiceFooter')} />
          <FieldDescription>{t('invoices.settings.invoiceFooterHint')}</FieldDescription>
          <FieldError match={!!errors.invoiceFooter}>
            {t('invoices.settings.errors.long')}
          </FieldError>
        </Field>
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
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      )}
      <UnsavedChangesGuard dirty={isDirty && !isSubmitting} />
    </form>
  );
}
