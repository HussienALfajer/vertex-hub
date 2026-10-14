import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ContractSettings,
  type UpdateContractSettings,
  type UpdateContractSettingsInput,
  unknownPlaceholders,
  updateContractArticlesSchema,
  updateContractSettingsSchema,
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
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { type ArticlesFormValues, ContractArticlesEditor } from './contract-articles-editor';
import {
  contractSettingsQuery,
  useUpdateContractArticles,
  useUpdateContractSettings,
} from './retainers.queries';

/** Spec F05C screen 7: the agency's contract details, numbering, slogan and default articles. */
export function ContractSettingsPage() {
  const { t } = useTranslation();
  const settings = useQuery(contractSettingsQuery);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/retainers" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('retainers.contractSettings.back')}
        </Button>
      </div>
      <PageHeader
        title={t('retainers.contractSettings.title')}
        description={t('retainers.contractSettings.subtitle')}
      />
      {settings.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      ) : settings.isError ? (
        <LoadError
          message={t('retainers.contractSettings.loadError')}
          onRetry={() => settings.refetch()}
        />
      ) : (
        <SettingsForms settings={settings.data} />
      )}
    </>
  );
}

function SettingsForms({ settings }: { settings: ContractSettings }) {
  const { t } = useTranslation();
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [articlesDirty, setArticlesDirty] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      {!settings.canEdit && (
        <Callout
          icon={<LockIcon />}
          title={t('retainers.contractSettings.readOnlyTitle')}
          description={t('retainers.contractSettings.readOnlyBody')}
        />
      )}
      <DetailsForm settings={settings} onDirtyChange={setDetailsDirty} />
      <ArticlesForm settings={settings} onDirtyChange={setArticlesDirty} />
      {settings.updatedBy && (
        <p className="text-sm text-muted-foreground">
          {t('retainers.contractSettings.updated', {
            name: settings.updatedBy.name,
            when: formatDateTime(settings.updatedAt),
          })}
        </p>
      )}
      <UnsavedChangesGuard dirty={detailsDirty || articlesDirty} />
    </div>
  );
}

const DETAIL_FIELDS = [
  'legalName',
  'tradeName',
  'companyType',
  'registrationNumber',
  'address',
  'phone',
  'email',
  'website',
  'representativeName',
  'representativeTitle',
  'slogan',
  'numberPrefix',
] as const satisfies readonly (keyof UpdateContractSettings)[];

/** Values written left to right (ADR: fields for LTR values). */
const LTR_FIELDS = new Set<string>(['phone', 'email', 'website', 'numberPrefix']);

const detailsOf = (settings: ContractSettings): UpdateContractSettingsInput =>
  Object.fromEntries(DETAIL_FIELDS.map((field) => [field, settings[field]]));

function DetailsForm({
  settings,
  onDirtyChange,
}: {
  settings: ContractSettings;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateContractSettings();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<UpdateContractSettingsInput, unknown, UpdateContractSettings>({
    resolver: standardSchemaResolver(updateContractSettingsSchema),
    // A refetch (another manager saved) keeps what this user already changed.
    resetOptions: { keepDirtyValues: true },
    values: detailsOf(settings),
  });
  const { errors, isDirty, isSubmitting } = form.formState;
  const readOnly = !settings.canEdit;
  const prefix = useWatch({ control: form.control, name: 'numberPrefix' }) ?? '';
  // The next number with the prefix as typed: the year and sequence come from the API.
  const nextNumber = settings.nextNumber.replace(
    settings.numberPrefix,
    prefix.trim().toUpperCase() || settings.numberPrefix,
  );
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      form.reset(detailsOf(await update.mutateAsync(values)), { keepDirtyValues: false });
      toast.add({ title: t('retainers.contractSettings.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const field = (name: (typeof DETAIL_FIELDS)[number], hint?: string) => (
    <Field invalid={!!errors[name]}>
      <FieldLabel>{t(`retainers.contractSettings.fields.${name}`)}</FieldLabel>
      <Input
        autoComplete="off"
        readOnly={readOnly}
        {...(LTR_FIELDS.has(name) && { dir: 'ltr' })}
        {...form.register(name)}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError match={!!errors[name]}>
        {t(`retainers.contractSettings.errors.${name}`)}
      </FieldError>
    </Field>
  );

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <FormSection
        title={t('retainers.contractSettings.agency')}
        hint={t('retainers.contractSettings.agencyHint')}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {field('legalName', t('retainers.contractSettings.requiredHint'))}
          {field('tradeName', t('retainers.contractSettings.requiredHint'))}
          {field('companyType')}
          {field('registrationNumber')}
          {field('representativeName', t('retainers.contractSettings.requiredHint'))}
          {field('representativeTitle')}
        </div>
      </FormSection>
      <FormSection
        title={t('retainers.contractSettings.contact')}
        hint={t('retainers.contractSettings.contactHint')}
      >
        {field('address')}
        <div className="grid gap-5 sm:grid-cols-3">
          {field('phone')}
          {field('email')}
          {field('website')}
        </div>
      </FormSection>
      <FormSection
        title={t('retainers.contractSettings.numbering')}
        hint={t('retainers.contractSettings.numberingHint')}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {field(
            'numberPrefix',
            t('retainers.contractSettings.nextNumber', { number: nextNumber }),
          )}
          {field('slogan')}
        </div>
      </FormSection>
      {!readOnly && (
        <SaveBar
          dirty={isDirty}
          submitting={isSubmitting}
          failure={failure}
          label={t('retainers.contractSettings.saveDetails')}
        />
      )}
    </form>
  );
}

const articlesOf = (settings: ContractSettings): ArticlesFormValues => ({
  articles: settings.articles.map(({ id, title, body }) => ({ id, title, body })),
});

function ArticlesForm({
  settings,
  onDirtyChange,
}: {
  settings: ContractSettings;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateContractArticles();
  const [failure, setFailure] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<ReadonlySet<number>>(new Set());
  const form: UseFormReturn<ArticlesFormValues> = useForm<ArticlesFormValues>({
    resolver: standardSchemaResolver(updateContractArticlesSchema),
    resetOptions: { keepDirtyValues: true },
    values: articlesOf(settings),
  });
  const { isDirty, isSubmitting } = form.formState;
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // The API refuses unknown placeholders too; flagging them here names the articles.
    const flagged = new Set(
      values.articles.flatMap((article, index) =>
        unknownPlaceholders(article.body).length > 0 ? [index] : [],
      ),
    );
    setUnknown(flagged);
    if (flagged.size > 0) return;
    try {
      await update.mutateAsync(values);
      form.reset(values, { keepDirtyValues: false });
      toast.add({ title: t('retainers.contractSettings.articles.saved'), type: 'success' });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <FormSection
        title={t('retainers.contractSettings.articles.title')}
        hint={t('retainers.contractSettings.articles.hint')}
      >
        <ContractArticlesEditor form={form} readOnly={!settings.canEdit} unknown={unknown} />
      </FormSection>
      {settings.canEdit && (
        <SaveBar
          dirty={isDirty}
          submitting={isSubmitting}
          failure={failure}
          label={t('retainers.contractSettings.articles.save')}
        />
      )}
    </form>
  );
}

function SaveBar({
  dirty,
  submitting,
  failure,
  label,
}: {
  dirty: boolean;
  submitting: boolean;
  failure: string | null;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      {failure && <FormAlert>{failure}</FormAlert>}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {dirty && (
          <p className="me-auto text-sm text-muted-foreground">{t('quotes.builder.unsaved')}</p>
        )}
        {/* Focusable while disabled, so saving does not drop the focus. */}
        <Button type="submit" disabled={!dirty || submitting} focusableWhenDisabled>
          {submitting ? t('common.saving') : label}
        </Button>
      </div>
    </>
  );
}
