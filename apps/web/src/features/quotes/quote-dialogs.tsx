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
import {
  type BaseSyntheticEvent,
  type ComponentProps,
  type ReactNode,
  useId,
  useState,
} from 'react';
import {
  Controller,
  type FieldErrors,
  type FieldValues,
  get,
  type Path,
  type Resolver,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { ApiError } from '../../lib/api/client';
import { errorMessage, errorRole, SCREEN_ERROR } from '../../lib/errors';
import { formatCalendarDate } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import { ChoiceSelect } from './choice-select';
import { useDecideApproval, useExtendQuote, useRejectQuote, useSendQuote } from './quotes.queries';

const NONE = 'none';

/** The contract, then the range of days the API checks (`INVALID_DATES`), shown on the field. */
function withDateRange<T extends FieldValues, O>(
  schema: Resolver<T, unknown, O>,
  field: Path<T>,
  earliest: string,
  latest: string,
): Resolver<T, unknown, O> {
  return async (values, context, options) => {
    const result = await schema(values, context, options);
    const day: string = get(values, field);
    if (get(result.errors, field) || (day >= earliest && day <= latest)) return result;
    const errors = { ...result.errors, [field]: { type: 'range', message: '' } };
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}

/** Rule 11: the response date from the sent day to today, and a note for "other". */
function rejectResolver(
  sentOn: string,
  today: string,
): Resolver<RejectQuoteInput, unknown, RejectQuote> {
  const dated = withDateRange(
    standardSchemaResolver(rejectQuoteSchema),
    'respondedOn',
    sentOn,
    today,
  );
  return async (values, context, options) => {
    const result = await dated(values, context, options);
    if (values.reason !== 'other' || values.note?.trim() || result.errors.note) return result;
    return { values: {}, errors: { ...result.errors, note: { type: 'required', message: '' } } };
  };
}

/** The API refused the date: the day changed while the dialog was open. */
const refusedDate = (error: unknown) =>
  error instanceof ApiError && error.knownCode === 'INVALID_DATES';

/** A dialog around one small form: its title, fields, error and submit button. */
export function FormDialog({
  open,
  onClose,
  submitting,
  title,
  description,
  action,
  failure,
  onSubmit,
  children,
  finalFocus,
  onClosed,
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
  /** Where the focus goes when it closes, when the button that opened it may be gone. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
  /** Runs once the dialog has faded out: the place to reset its form. */
  onClosed?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      onOpenChangeComplete={(next) => !next && onClosed?.()}
    >
      <DialogContent closeLabel={t('common.close')} finalFocus={finalFocus}>
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

/** What each quote dialog takes from its page. */
interface QuoteDialogProps {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or the page heading. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}

/** Rule 7: the General Manager returns a discount with a note for the requester. */
export function ReturnApprovalDialog({ quote, open, onClose, finalFocus }: QuoteDialogProps) {
  const { t } = useTranslation();
  const decide = useDecideApproval(quote.id);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<{ note: string }>({ defaultValues: { note: '' } });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ note }) => {
    setFailure(null);
    try {
      await decide.mutateAsync({ decision: 'return', note: note.trim() });
      toast.add({ title: t('quotes.approval.returnedToast'), type: 'success' });
      onClose();
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
      }}
      finalFocus={finalFocus}
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
export function ExtendDialog({ quote, open, onClose, finalFocus }: QuoteDialogProps) {
  const { t } = useTranslation();
  const extend = useExtendQuote(quote.id);
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const latest = addDays(today, QUOTE_LIMITS.validityDays);
  const form = useForm<ExtendQuote>({
    resolver: withDateRange(standardSchemaResolver(extendQuoteSchema), 'validUntil', today, latest),
    defaultValues: { validUntil: addDays(today, quote.validityDays) },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ validUntil }) => {
    setFailure(null);
    try {
      await extend.mutateAsync(validUntil);
      toast.add({ title: t('quotes.extend.done'), type: 'success' });
      onClose();
    } catch (error) {
      // The day changed while the dialog was open: the field says so.
      if (refusedDate(error)) {
        form.setError('validUntil', { type: SCREEN_ERROR, message: '' }, { shouldFocus: true });
      } else setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset();
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('quotes.extend.title')}
      description={t('quotes.extend.hint')}
      action={t('quotes.extend.action')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.validUntil}>
        <FieldLabel>{t('quotes.extend.validUntil')}</FieldLabel>
        <Input type="date" dir="ltr" min={today} max={latest} {...form.register('validUntil')} />
        <FieldDescription>{t('quotes.extend.validUntilHint')}</FieldDescription>
        <FieldError match={!!errors.validUntil} role={errorRole(errors.validUntil)}>
          {t('quotes.extend.errors.validUntil')}
        </FieldError>
      </Field>
    </FormDialog>
  );
}

/** Rule 11: the client's no, with a reason; final. */
export function RejectDialog({ quote, open, onClose, finalFocus }: QuoteDialogProps) {
  const { t } = useTranslation();
  const ids = { contact: useId(), reason: useId() };
  const reject = useRejectQuote(quote.id);
  // A lead quote has no client contacts until its lead is converted (F03).
  const client = useQuery({
    ...clientQuery(quote.client?.id ?? ''),
    enabled: open && !!quote.client,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const sentOn = quote.sentAt ? businessDate(new Date(quote.sentAt)) : today;
  const form = useForm<RejectQuoteInput, unknown, RejectQuote>({
    resolver: rejectResolver(sentOn, today),
    defaultValues: { respondedOn: today, contactId: null, reason: 'price', note: '' },
  });
  const { errors } = form.formState;
  const reason = form.watch('reason');

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      await reject.mutateAsync(values);
      toast.add({ title: t('quotes.reject.done'), type: 'success' });
      onClose();
    } catch (error) {
      if (refusedDate(error)) {
        form.setError('respondedOn', { type: SCREEN_ERROR, message: '' }, { shouldFocus: true });
      } else setFailure(errorMessage(t, error));
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
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset();
      }}
      finalFocus={finalFocus}
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
          <Input type="date" dir="ltr" min={sentOn} max={today} {...form.register('respondedOn')} />
          <FieldError match={!!errors.respondedOn} role={errorRole(errors.respondedOn)}>
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

/** Rule 6: sending locks the draft, queues its PDF and dates its validity from today. */
export function SendDialog({ quote, open, onClose, finalFocus }: QuoteDialogProps) {
  const { t } = useTranslation();
  const send = useSendQuote(quote.id);
  const zeroPriced = quote.lines.some((line) => line.unitPriceMinor === 0);
  const validUntil = addDays(businessDate(), quote.validityDays);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      finalFocus={finalFocus}
      title={t('quotes.send.title', { number: quote.displayNumber })}
      body={[
        t('quotes.send.body', { date: formatCalendarDate(validUntil) }),
        ...(zeroPriced ? [t('quotes.send.zeroPrice')] : []),
      ].join(' ')}
      action={t('quotes.send.confirm')}
      pending={send.isPending}
      onConfirm={async () => {
        await send.mutateAsync(zeroPriced);
        toast.add({ title: t('quotes.send.done'), type: 'success' });
      }}
    />
  );
}
