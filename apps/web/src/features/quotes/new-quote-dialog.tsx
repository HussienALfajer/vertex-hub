import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type CreateQuote,
  type CreateQuoteInput,
  CURRENCIES,
  createQuoteSchema,
  OPEN_LEAD_STAGES,
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
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { useId, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { can, canAll, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { clientListQuery, clientQuery } from '../clients/clients.queries';
import { leadListQuery } from '../leads/leads.queries';
import { ChoiceSelect } from './choice-select';
import { useCreateQuote } from './quotes.queries';

const NONE = 'none';

type Recipient = 'client' | 'lead';

/**
 * Spec screen 3: a new draft for a client (rule 1: active or paused) or an open lead (F03 rule
 * 14), opened in the builder once created. From a client's Quotes tab or a lead's page the
 * recipient is fixed.
 */
export function NewQuoteDialog({ open, onClose, clientId, leadId }: NewQuoteProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        {/* Unmounted once the dialog has faded out: each opening starts afresh. */}
        <NewQuoteForm onClose={onClose} clientId={clientId} leadId={leadId} />
      </DialogContent>
    </Dialog>
  );
}

interface NewQuoteProps {
  open: boolean;
  onClose: () => void;
  /** The client the quote is for, when the dialog opens from its profile. */
  clientId?: string;
  /** The lead the quote is for, when the dialog opens from its page (F03 screen 3). */
  leadId?: string;
}

function NewQuoteForm({ onClose, clientId, leadId }: Omit<NewQuoteProps, 'open'>) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const ids = {
    client: useId(),
    lead: useId(),
    recipient: useId(),
    currency: useId(),
    contact: useId(),
  };
  const create = useCreateQuote();
  const [failure, setFailure] = useState<string | null>(null);
  const fixed = !!clientId || !!leadId;
  // Leads are offered to those who can read them (F03 screen 6).
  const offersLeads = !fixed && can(me, 'leads.read');
  const emptyFor = (recipient: Recipient): CreateQuoteInput => ({
    ...(recipient === 'lead' ? { leadId: leadId ?? '' } : { clientId: clientId ?? '' }),
    title: '',
    currency: 'USD',
    contactId: null,
  });
  const [recipient, setRecipient] = useState<Recipient>(leadId ? 'lead' : 'client');
  const form = useForm<CreateQuoteInput, unknown, CreateQuote>({
    resolver: standardSchemaResolver(createQuoteSchema),
    defaultValues: emptyFor(recipient),
    shouldFocusError: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(form.formState.submitCount, formRef);
  const { errors } = form.formState;
  const chosenClient = form.watch('clientId');
  // Account managers quote their own clients only; the API refuses the others.
  const clients = useQuery({
    ...clientListQuery({
      status: ['active', 'paused'],
      accountManagerId: canAll(me, 'quotes.manage') ? undefined : me.user.id,
      pageSize: 100,
    }),
    enabled: !clientId,
  });
  const client = useQuery({ ...clientQuery(chosenClient ?? ''), enabled: !!chosenClient });
  // Account managers quote the leads they own only (F03 "Quote scope on lead quotes").
  const leads = useQuery({
    ...leadListQuery({
      stage: [...OPEN_LEAD_STAGES],
      ownerId: canAll(me, 'quotes.manage') ? undefined : me.user.id,
      pageSize: 100,
    }),
    enabled: offersLeads && recipient === 'lead',
  });

  function pickRecipient(next: Recipient) {
    setRecipient(next);
    form.reset(emptyFor(next));
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      const quote = await create.mutateAsync(values);
      onClose();
      await navigate({ to: '/quotes/$quoteId', params: { quoteId: quote.id } });
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const leadItems = (leads.data?.items ?? []).map((item) => ({
    value: item.id,
    label: item.displayName,
  }));
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
    <form ref={formRef} className="grid gap-5" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t('quotes.new.title')}</DialogTitle>
        <DialogDescription>{t('quotes.new.hint')}</DialogDescription>
      </DialogHeader>
      {offersLeads && (
        <Field>
          <FieldLabel id={ids.recipient} render={<span />}>
            {t('quotes.form.for')}
          </FieldLabel>
          <ToggleGroup
            aria-labelledby={ids.recipient}
            value={[recipient]}
            onValueChange={(next: Recipient[]) => {
              if (next[0]) pickRecipient(next[0]);
            }}
          >
            <ToggleGroupItem value="client">{t('quotes.form.forClient')}</ToggleGroupItem>
            <ToggleGroupItem value="lead">{t('quotes.form.forLead')}</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      )}
      {!fixed && recipient === 'lead' && (
        <Controller
          control={form.control}
          name="leadId"
          render={({ field }) => (
            <Field invalid={!!errors.leadId || !!errors.clientId}>
              <FieldLabel id={ids.lead} render={<span />}>
                {t('quotes.form.lead')}
              </FieldLabel>
              <ChoiceSelect
                ref={field.ref}
                labelledBy={ids.lead}
                items={leadItems}
                value={field.value || null}
                placeholder={t('quotes.form.pickLead')}
                onChange={field.onChange}
              />
              <FieldDescription>{t('quotes.form.leadHint')}</FieldDescription>
              <FieldError match={!!errors.leadId || !!errors.clientId}>
                {t('quotes.form.errors.lead')}
              </FieldError>
            </Field>
          )}
        />
      )}
      {!fixed && recipient === 'client' && (
        <Controller
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <Field invalid={!!errors.clientId}>
              <FieldLabel id={ids.client} render={<span />}>
                {t('quotes.form.client')}
              </FieldLabel>
              <ChoiceSelect
                ref={field.ref}
                labelledBy={ids.client}
                items={clientItems}
                value={field.value || null}
                placeholder={t('quotes.form.pickClient')}
                onChange={(next) => {
                  field.onChange(next);
                  form.setValue('contactId', null);
                }}
              />
              <FieldError match={!!errors.clientId}>{t('quotes.form.errors.client')}</FieldError>
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
        {recipient === 'client' && (
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
        )}
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
  );
}
