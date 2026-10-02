import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type CreateQuote,
  type CreateQuoteInput,
  CURRENCIES,
  createQuoteSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
} from '@vertex-hub/ui';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { canAll, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { clientListQuery, clientQuery } from '../clients/clients.queries';
import { ChoiceSelect } from './choice-select';
import { useCreateQuote } from './quotes.queries';

const NONE = 'none';

/**
 * Spec screen 3: a new draft for a client (rule 1: active or paused), opened in the builder once
 * created. From a client's Quotes tab the client is fixed.
 */
export function NewQuoteDialog({
  open,
  onClose,
  clientId,
}: {
  open: boolean;
  onClose: () => void;
  /** The client the quote is for, when the dialog opens from its profile. */
  clientId?: string;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const ids = { client: useId(), currency: useId(), contact: useId() };
  const create = useCreateQuote();
  const [failure, setFailure] = useState<string | null>(null);
  const empty: CreateQuoteInput = {
    clientId: clientId ?? '',
    title: '',
    currency: 'USD',
    contactId: null,
  };
  const form = useForm<CreateQuoteInput, unknown, CreateQuote>({
    resolver: standardSchemaResolver(createQuoteSchema),
    defaultValues: empty,
  });
  const { errors } = form.formState;
  const chosenClient = form.watch('clientId');
  // Account managers quote their own clients only; the API refuses the others.
  const clients = useQuery({
    ...clientListQuery({
      status: ['active', 'paused'],
      accountManagerId: canAll(me, 'quotes.manage') ? undefined : me.user.id,
      pageSize: 100,
    }),
    enabled: open && !clientId,
  });
  const client = useQuery({ ...clientQuery(chosenClient), enabled: open && !!chosenClient });

  function close() {
    setFailure(null);
    form.reset(empty);
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const quote = await create.mutateAsync(values);
      close();
      await navigate({ to: '/quotes/$quoteId', params: { quoteId: quote.id } });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const clientItems = (clients.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.tradeName,
  }));
  const currencyItems = CURRENCIES.map((currency) => ({
    value: currency,
    label: t(`quotes.currencies.${currency}`),
  }));
  const contactItems = [
    { value: NONE, label: t('quotes.form.noAddressee') },
    ...(client.data?.contacts ?? []).map((contact) => ({
      value: contact.id,
      label: contact.name,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('quotes.new.title')}</DialogTitle>
            <DialogDescription>{t('quotes.new.hint')}</DialogDescription>
          </DialogHeader>
          {!clientId && (
            <Controller
              control={form.control}
              name="clientId"
              render={({ field }) => (
                <Field invalid={!!errors.clientId}>
                  <FieldLabel id={ids.client} render={<span />}>
                    {t('quotes.form.client')}
                  </FieldLabel>
                  <ChoiceSelect
                    labelledBy={ids.client}
                    items={clientItems}
                    value={field.value || null}
                    placeholder={t('quotes.form.pickClient')}
                    onChange={(next) => {
                      field.onChange(next);
                      form.setValue('contactId', null);
                    }}
                  />
                  <FieldError match={!!errors.clientId}>
                    {t('quotes.form.errors.client')}
                  </FieldError>
                </Field>
              )}
            />
          )}
          <Field invalid={!!errors.title}>
            <FieldLabel>{t('quotes.form.title')}</FieldLabel>
            <Input autoComplete="off" {...form.register('title')} />
            <FieldDescription>{t('quotes.form.titleHint')}</FieldDescription>
            <FieldError match={!!errors.title}>{t('quotes.form.errors.title')}</FieldError>
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="currency"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.currency} render={<span />}>
                    {t('quotes.form.currency')}
                  </FieldLabel>
                  <ChoiceSelect
                    labelledBy={ids.currency}
                    items={currencyItems}
                    value={field.value ?? 'USD'}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="contactId"
              render={({ field }) => (
                <Field>
                  <FieldLabel id={ids.contact} render={<span />}>
                    {t('quotes.form.addressee')}
                  </FieldLabel>
                  <ChoiceSelect
                    labelledBy={ids.contact}
                    items={contactItems}
                    value={field.value ?? NONE}
                    disabled={!chosenClient}
                    onChange={(next) => field.onChange(next === NONE ? null : next)}
                  />
                </Field>
              )}
            />
          </div>
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('common.saving') : t('quotes.new.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
