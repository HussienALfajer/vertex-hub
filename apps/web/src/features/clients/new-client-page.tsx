import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  type CreateClient,
  type CreateClientInput,
  createClientSchema,
} from '@vertex-hub/contracts';
import { AscentLines, Avatar, Button, PageHeader, toast } from '@vertex-hub/ui';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { ClientStatusBadge, HealthcareBadge } from './client-badges';
import {
  AccountManagerField,
  type ClientFormMethods,
  clientFormFailure,
  emptyClient,
  HealthcareField,
  SectorField,
  StatusField,
  TradeNameField,
} from './client-form';
import {
  accountManagersQuery,
  invitedAccountManagersQuery,
  useCreateClient,
} from './clients.queries';

export function NewClientPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateClient();
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CreateClientInput, unknown, CreateClient>({
    resolver: standardSchemaResolver(createClientSchema),
    defaultValues: emptyClient,
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const client = await create.mutateAsync(values);
      toast.add({ title: t('clients.new.created'), type: 'success' });
      await navigate({ to: '/clients/$clientId', params: { clientId: client.id } });
    } catch (error) {
      setFailure(clientFormFailure(form, t, error));
    }
  });

  return (
    <>
      <PageHeader
        title={t('clients.new.title')}
        description={t('clients.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link to="/clients" />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('clients.new.back')}
          </Button>
        }
      />
      <form
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
        onSubmit={submit}
        noValidate
      >
        <div className="flex min-w-0 flex-col gap-6">
          <FormSection title={t('clients.form.identity')} hint={t('clients.form.identityHint')}>
            <TradeNameField form={form} />
            <SectorField form={form} />
          </FormSection>
          <FormSection
            title={t('clients.form.responsibility')}
            hint={t('clients.form.responsibilityHint')}
          >
            <AccountManagerField form={form} />
            <StatusField form={form} />
            <HealthcareField form={form} />
          </FormSection>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" render={<Link to="/clients" />}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('clients.form.creating') : t('clients.form.create')}
            </Button>
          </div>
        </div>
        <Preview form={form} />
      </form>
    </>
  );
}

/** How the profile header will read, updated as the form is filled in. */
function Preview({ form }: { form: ClientFormMethods }) {
  const { t } = useTranslation();
  const values = useWatch({ control: form.control });
  const active = useQuery(accountManagersQuery);
  const invited = useQuery(invitedAccountManagersQuery);
  const manager = [...(active.data?.items ?? []), ...(invited.data?.items ?? [])].find(
    (user) => user.id === values.accountManagerId,
  );
  const name = values.tradeName?.trim() || t('clients.form.tradeNamePlaceholder');

  return (
    <aside
      aria-label={t('clients.new.preview')}
      className="relative flex flex-col gap-4 overflow-hidden rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-24"
    >
      <AscentLines className="absolute inset-y-0 end-0 h-full w-16 text-border" />
      <p className="relative text-sm font-medium text-muted-foreground">
        {t('clients.new.preview')}
      </p>
      <div className="relative flex items-center gap-3">
        <Avatar name={name} shape="square" size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="truncate text-lg font-bold">{name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {values.sector?.trim() || t('clients.profile.noSector')}
          </p>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        <ClientStatusBadge status={values.status ?? 'active'} />
        {values.isHealthcare && <HealthcareBadge />}
      </div>
      <div className="relative flex items-center gap-2 border-t border-border pt-4 text-sm">
        {manager ? (
          <>
            <Avatar name={manager.name} size="sm" />
            <span className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                {t('clients.profile.accountManager')}
              </span>
              <span className="font-medium">{manager.name}</span>
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {t('clients.form.accountManagerPlaceholder')}
          </span>
        )}
      </div>
    </aside>
  );
}
