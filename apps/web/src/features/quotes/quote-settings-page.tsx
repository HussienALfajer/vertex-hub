import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  QUOTE_LIMITS,
  type QuoteSettings,
  type UpdateQuoteSettings,
  updateQuoteSettingsSchema,
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
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { quoteSettingsQuery, useUpdateQuoteSettings } from './quotes.queries';

/** Spec screen 2: what every quote prints and starts with, and the discount threshold. */
export function QuoteSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery(quoteSettingsQuery);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/quotes" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('quotes.back')}
        </Button>
      </div>
      <PageHeader title={t('quotes.settings.title')} description={t('quotes.settings.subtitle')} />
      {settings.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56" />
          <Skeleton className="h-32" />
        </div>
      ) : settings.isError ? (
        <LoadError message={t('quotes.settings.loadError')} onRetry={() => settings.refetch()} />
      ) : (
        <SettingsForm key={settings.data.updatedAt} settings={settings.data} />
      )}
    </>
  );
}

function SettingsForm({ settings }: { settings: QuoteSettings }) {
  const { t } = useTranslation();
  const update = useUpdateQuoteSettings();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<UpdateQuoteSettings>({
    resolver: standardSchemaResolver(updateQuoteSettingsSchema),
    defaultValues: {
      companyDetails: settings.companyDetails,
      defaultTerms: settings.defaultTerms,
      defaultValidityDays: settings.defaultValidityDays,
      discountThresholdPercent: settings.discountThresholdPercent,
    },
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const readOnly = !settings.canEdit && !settings.canEditThreshold;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Only the fields this user may change are sent; the API answers 403 for the others.
    const input: UpdateQuoteSettings = {
      ...(settings.canEdit && {
        companyDetails: values.companyDetails,
        defaultTerms: values.defaultTerms,
        defaultValidityDays: values.defaultValidityDays,
      }),
      ...(settings.canEditThreshold && {
        discountThresholdPercent: values.discountThresholdPercent,
      }),
    };
    try {
      await update.mutateAsync(input);
      toast.add({ title: t('quotes.settings.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      {readOnly && (
        <Callout
          icon={<LockIcon />}
          title={t('quotes.settings.readOnlyTitle')}
          description={t('quotes.settings.readOnlyBody')}
        />
      )}
      <FormSection title={t('quotes.settings.printed')} hint={t('quotes.settings.printedHint')}>
        <Field invalid={!!errors.companyDetails}>
          <FieldLabel>{t('quotes.settings.companyDetails')}</FieldLabel>
          <Textarea rows={5} readOnly={!settings.canEdit} {...form.register('companyDetails')} />
          <FieldDescription>{t('quotes.settings.companyDetailsHint')}</FieldDescription>
          <FieldError match={!!errors.companyDetails}>
            {t('quotes.settings.errors.companyDetails')}
          </FieldError>
        </Field>
        <Field invalid={!!errors.defaultTerms}>
          <FieldLabel>{t('quotes.settings.defaultTerms')}</FieldLabel>
          <Textarea rows={8} readOnly={!settings.canEdit} {...form.register('defaultTerms')} />
          <FieldDescription>{t('quotes.settings.defaultTermsHint')}</FieldDescription>
          <FieldError match={!!errors.defaultTerms}>
            {t('quotes.settings.errors.defaultTerms')}
          </FieldError>
        </Field>
      </FormSection>
      <FormSection title={t('quotes.settings.rules')} hint={t('quotes.settings.rulesHint')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!errors.defaultValidityDays}>
            <FieldLabel>{t('quotes.settings.defaultValidityDays')}</FieldLabel>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={QUOTE_LIMITS.validityDays}
              readOnly={!settings.canEdit}
              className="text-end tabular-nums"
              {...form.register('defaultValidityDays', { valueAsNumber: true })}
            />
            <FieldError match={!!errors.defaultValidityDays}>
              {t('quotes.settings.errors.validityDays')}
            </FieldError>
          </Field>
          <Field invalid={!!errors.discountThresholdPercent}>
            <FieldLabel>{t('quotes.settings.threshold')}</FieldLabel>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              readOnly={!settings.canEditThreshold}
              className="text-end tabular-nums"
              {...form.register('discountThresholdPercent', { valueAsNumber: true })}
            />
            <FieldDescription>
              {settings.canEditThreshold
                ? t('quotes.settings.thresholdHint')
                : t('quotes.settings.thresholdLocked')}
            </FieldDescription>
            <FieldError match={!!errors.discountThresholdPercent}>
              {t('quotes.settings.errors.threshold')}
            </FieldError>
          </Field>
        </div>
      </FormSection>
      {settings.updatedBy && (
        <p className="text-sm text-muted-foreground">
          {t('quotes.settings.updated', {
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
              <p className="me-auto text-sm text-muted-foreground">{t('quotes.builder.unsaved')}</p>
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
