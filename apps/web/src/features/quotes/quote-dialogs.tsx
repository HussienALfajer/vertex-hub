import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  businessDate,
  type ExtendQuote,
  extendQuoteSchema,
  QUOTE_LIMITS,
  QUOTE_REJECTION_REASONS,
  type QuoteDetail,
  type RejectQuote,
  type RejectQuoteInput,
  rejectQuoteSchema,
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
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { type BaseSyntheticEvent, type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { errorMessage } from '../../lib/errors';
import { clientQuery } from '../clients/clients.queries';
import { ChoiceSelect } from './choice-select';
import { useDecideApproval, useExtendQuote, useRejectQuote } from './quotes.queries';

const NONE = 'none';

/** A dialog around one small form: its title, fields, error and submit button. */
function FormDialog({
  open,
  onClose,
  submitting,
  title,
  description,
  action,
  failure,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  submitting: boolean;
  title: string;
  description: string;
  action: string;
  failure: string | null;
  onSubmit: (event?: BaseSyntheticEvent) => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <form className="grid gap-5" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {failure && <FormAlert>{failure}</FormAlert>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t('common.cancel')}
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('common.saving') : action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rule 7: the General Manager returns a discount with a note for the requester. */
export function ReturnApprovalDialog({
  quote,
  open,
  onClose,
}: {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const decide = useDecideApproval(quote.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ note: string }>({ defaultValues: { note: '' } });
  const { errors } = form.formState;

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async ({ note }) => {
    setFailure(null);
    try {
      await decide.mutateAsync({ decision: 'return', note });
      toast.add({ title: t('quotes.approval.returnedToast'), type: 'success' });
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
      title={t('quotes.approval.returnTitle')}
      description={t('quotes.approval.returnHint')}
      action={t('quotes.approval.return')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('quotes.approval.note')}</FieldLabel>
        <Textarea
          rows={3}
          {...form.register('note', {
            validate: (note) => !!note.trim() && note.trim().length <= 500,
          })}
        />
        <FieldError match={!!errors.note}>{t('quotes.approval.errors.note')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** Rule 10: an expired quote is sent again until a new last day; prices and PDF stay. */
export function ExtendDialog({
  quote,
  open,
  onClose,
}: {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const extend = useExtendQuote(quote.id);
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const latest = addDays(today, QUOTE_LIMITS.validityDays);
  const form = useForm<ExtendQuote>({
    resolver: standardSchemaResolver(extendQuoteSchema),
    defaultValues: { validUntil: addDays(today, quote.validityDays) },
  });
  const { errors } = form.formState;

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async ({ validUntil }) => {
    setFailure(null);
    try {
      await extend.mutateAsync(validUntil);
      toast.add({ title: t('quotes.extend.done'), type: 'success' });
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
      title={t('quotes.extend.title')}
      description={t('quotes.extend.hint')}
      action={t('quotes.extend.action')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.validUntil}>
        <FieldLabel>{t('quotes.extend.validUntil')}</FieldLabel>
        <Input type="date" min={today} max={latest} {...form.register('validUntil')} />
        <FieldDescription>{t('quotes.extend.validUntilHint')}</FieldDescription>
        <FieldError match={!!errors.validUntil}>{t('quotes.extend.errors.validUntil')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** Rule 11: the client's no, with a reason; final. */
export function RejectDialog({
  quote,
  open,
  onClose,
}: {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), reason: useId() };
  const reject = useRejectQuote(quote.id);
  const client = useQuery({ ...clientQuery(quote.client.id), enabled: open });
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const form = useForm<RejectQuoteInput, unknown, RejectQuote>({
    resolver: standardSchemaResolver(rejectQuoteSchema),
    defaultValues: { respondedOn: today, contactId: null, reason: 'price', note: '' },
  });
  const { errors } = form.formState;
  const reason = form.watch('reason');

  function close() {
    setFailure(null);
    form.reset();
    onClose();
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (values.reason === 'other' && !values.note) {
      form.setError('note', { type: 'required' });
      return;
    }
    try {
      await reject.mutateAsync(values);
      toast.add({ title: t('quotes.reject.done'), type: 'success' });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const contactItems = [
    { value: NONE, label: t('quotes.form.noContact') },
    ...(client.data?.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  const reasonItems = QUOTE_REJECTION_REASONS.map((value) => ({
    value,
    label: t(`quotes.rejectionReasons.${value}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={close}
      submitting={form.formState.isSubmitting}
      title={t('quotes.reject.title', { number: quote.displayNumber })}
      description={t('quotes.reject.hint')}
      action={t('quotes.reject.action')}
      failure={failure}
      onSubmit={submit}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.respondedOn}>
          <FieldLabel>{t('quotes.response.respondedOn')}</FieldLabel>
          <Input
            type="date"
            min={quote.sentAt ? businessDate(new Date(quote.sentAt)) : undefined}
            max={today}
            {...form.register('respondedOn')}
          />
          <FieldError match={!!errors.respondedOn}>
            {t('quotes.response.errors.respondedOn')}
          </FieldError>
        </Field>
        <Controller
          control={form.control}
          name="contactId"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.contact} render={<span />}>
                {t('quotes.response.contact')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.contact}
                items={contactItems}
                value={field.value ?? NONE}
                onChange={(next) => field.onChange(next === NONE ? null : next)}
              />
            </Field>
          )}
        />
      </div>
      <Controller
        control={form.control}
        name="reason"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.reason} render={<span />}>
              {t('quotes.reject.reason')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={ids.reason}
              items={reasonItems}
              value={field.value}
              onChange={field.onChange}
            />
          </Field>
        )}
      />
      <Field invalid={!!errors.note}>
        <FieldLabel>
          {reason === 'other' ? t('quotes.reject.noteRequired') : t('quotes.response.note')}
        </FieldLabel>
        <Textarea rows={3} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('quotes.reject.errors.note')}</FieldError>
      </Field>
    </FormDialog>
  );
}
