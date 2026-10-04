import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  type CreateLeadNote,
  type CreateLeadNoteInput,
  convertLeadSchema,
  createLeadNoteSchema,
  defaultFollowUpDate,
  followUpDateInRange,
  LEAD_LIMITS,
  LEAD_LOSS_REASONS,
  type LeadConversionPlan,
  type LeadDetail,
  type LeadLossReason,
  type LeadNote,
  type LoseLead,
  type LoseLeadInput,
  loseLeadSchema,
  NOTE_CHANNELS,
  type NoteChannel,
  REOPEN_LEAD_STAGES,
} from '@vertex-hub/contracts';
import {
  Button,
  Callout,
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
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { TriangleAlertIcon } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatList, fromBusinessDateTimeInput, toBusinessDateTimeInput } from '../../lib/format';
import { channelIcon } from '../clients/communication-tab';
import { ChoiceSelect } from '../quotes/choice-select';
import { leadQuotesQuery } from '../quotes/quotes.queries';
import {
  ConversionFields,
  type ConversionProblems,
  conversionProblems,
  toConversion,
  useConversionValues,
} from './conversion-fields';
import {
  conversionPlanQuery,
  leadOwnersQuery,
  useAddLeadNote,
  useChangeLeadOwner,
  useConvertLead,
  useLoseLead,
  useReopenLead,
  useUpdateLead,
  useUpdateLeadNote,
} from './leads.queries';

/** What a lead's dialogs need to know about it; board cards carry these too. */
export interface LeadRef {
  id: string;
  displayName: string;
}

/** A refused conversion's field, or null for a form-level message (rule 10, edge case 6). */
export function conversionRefusal(t: TFunction, error: unknown): ConversionProblems | null {
  const code = error instanceof ApiError ? error.knownCode : undefined;
  const field =
    code === 'CLIENT_NAME_TAKEN'
      ? 'tradeName'
      : code === 'INVALID_ACCOUNT_MANAGER'
        ? 'accountManagerId'
        : code === 'CLIENT_ARCHIVED'
          ? 'clientId'
          : null;
  if (!field) return null;
  // Edge case 6: the dialog then offers to link the client that holds the name.
  return {
    [field]: errorMessage(t, error),
    ...(code === 'CLIENT_NAME_TAKEN' && { nameTaken: true }),
  };
}

function DialogShell({
  open,
  onClose,
  title,
  description,
  wide,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className={wide ? 'max-w-2xl' : 'max-w-xl'}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Mounted while open: each opening starts afresh. */}
        {open && children}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ pending, action }: { pending: boolean; action: string }) {
  const { t } = useTranslation();
  return (
    <DialogFooter>
      <DialogClose render={<Button variant="outline" type="button" />}>
        {t('common.cancel')}
      </DialogClose>
      <Button type="submit" disabled={pending}>
        {pending ? t('common.saving') : action}
      </Button>
    </DialogFooter>
  );
}

function FollowUpField({
  id,
  value,
  onChange,
  invalid,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  error?: string;
}) {
  const { t } = useTranslation();
  const today = businessDate();
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{t('leads.form.nextFollowUpOn')}</FieldLabel>
      <Input
        id={id}
        type="date"
        min={today}
        max={addDays(today, LEAD_LIMITS.followUpDays)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError match={invalid}>
        {error ?? t('leads.form.errors.followUp', { n: LEAD_LIMITS.followUpDays })}
      </FieldError>
    </Field>
  );
}

// Convert (screen 4)

export function ConvertDialog({
  lead,
  open,
  onClose,
}: {
  lead: LeadRef;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      wide
      title={t('leads.convert.title', { name: lead.displayName })}
      description={t('leads.convert.hint')}
    >
      <ConvertFlow lead={lead} onClose={onClose} />
    </DialogShell>
  );
}

function ConvertFlow({ lead, onClose }: { lead: LeadRef; onClose: () => void }) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState<string | undefined>();
  const plan = useQuery(conversionPlanQuery(lead.id, clientId));
  if (plan.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (plan.isError) {
    return (
      <LoadError
        message={
          plan.error instanceof ApiError && plan.error.knownCode
            ? errorMessage(t, plan.error)
            : t('leads.convert.loadError')
        }
        onRetry={() => plan.refetch()}
      />
    );
  }
  return (
    <ConvertForm
      lead={lead}
      plan={plan.data}
      planning={plan.isFetching}
      onClient={setClientId}
      onClose={onClose}
    />
  );
}

function ConvertForm({
  lead,
  plan,
  planning,
  onClient,
  onClose,
}: {
  lead: LeadRef;
  plan: LeadConversionPlan;
  planning: boolean;
  onClient: (clientId: string | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const convert = useConvertLead(lead.id);
  const [values, setValues] = useConversionValues(plan);
  const [problems, setProblems] = useState<ConversionProblems>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    const found = conversionProblems(values);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    try {
      const converted = await convert.mutateAsync(convertLeadSchema.parse(toConversion(values)));
      toast.add({ title: t('leads.convert.done'), type: 'success' });
      onClose();
      if (converted.client) {
        await navigate({ to: '/clients/$clientId', params: { clientId: converted.client.id } });
      }
    } catch (error) {
      const field = conversionRefusal(t, error);
      if (field) setProblems(field);
      else setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <ConversionFields
        plan={plan}
        values={values}
        onChange={(next) => {
          setValues(next);
          setProblems({});
        }}
        problems={problems}
        onClient={onClient}
      />
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={convert.isPending || planning}>
          {convert.isPending ? t('leads.convert.converting') : t('leads.convert.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Lose and reopen (screen 5)

export function LoseDialog({
  lead,
  open,
  onClose,
}: {
  lead: LeadRef;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('leads.lose.title', { name: lead.displayName })}
      description={t('leads.lose.hint')}
    >
      <LoseForm lead={lead} onClose={onClose} />
    </DialogShell>
  );
}

function LoseForm({ lead, onClose }: { lead: LeadRef; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const lose = useLoseLead(lead.id);
  const quotes = useQuery(leadQuotesQuery(lead.id));
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<LoseLeadInput, unknown, LoseLead>({
    resolver: standardSchemaResolver(loseLeadSchema),
    defaultValues: { reason: 'price', note: '' },
  });
  const { errors } = form.formState;
  const reason = form.watch('reason');
  // Rule 8: sent and expired quotes are recorded as rejected with the loss.
  const rejected = (quotes.data?.items ?? []).filter(
    (quote) => quote.status === 'sent' || quote.status === 'expired',
  );
  const reasonItems = LEAD_LOSS_REASONS.map((value) => ({
    value,
    label: t(`leads.lossReasons.${value}`),
  }));

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    if (values.reason === 'other' && !values.note) {
      form.setError('note', { type: SCREEN_ERROR, message: t('leads.lose.errors.noteRequired') });
      return;
    }
    try {
      const result = await lose.mutateAsync(values);
      toast.add({
        title:
          result.rejectedQuotes.length > 0
            ? t('leads.lose.doneWithQuotes', { quotes: formatList(result.rejectedQuotes) })
            : t('leads.lose.done'),
        type: 'success',
      });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <Controller
        control={form.control}
        name="reason"
        render={({ field }) => (
          <Field>
            <FieldLabel id={id} render={<span />}>
              {t('leads.lose.reason')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={id}
              items={reasonItems}
              value={field.value}
              onChange={(next) => field.onChange(next as LeadLossReason)}
            />
          </Field>
        )}
      />
      <Field invalid={!!errors.note}>
        <FieldLabel>
          {reason === 'other' ? t('leads.lose.noteRequired') : t('leads.lose.note')}
        </FieldLabel>
        <Textarea rows={3} {...form.register('note')} />
        <FieldError match={!!errors.note}>
          {fieldError(errors.note, t('leads.lose.errors.note'))}
        </FieldError>
      </Field>
      {rejected.length > 0 && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('leads.lose.quotesTitle', { n: rejected.length })}
          description={formatList(rejected.map((quote) => quote.displayNumber))}
        />
      )}
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t('common.saving') : t('leads.lose.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ReopenDialog({
  lead,
  open,
  onClose,
}: {
  lead: LeadDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('leads.reopen.title', { name: lead.displayName })}
      description={t('leads.reopen.hint')}
    >
      <ReopenForm lead={lead} onClose={onClose} />
    </DialogShell>
  );
}

function ReopenForm({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const ids = { stage: useId(), date: useId(), owner: useId() };
  const reopen = useReopenLead(lead.id);
  const owners = useQuery(leadOwnersQuery);
  // The owner stays when still eligible; otherwise someone else takes the lead (rule 9).
  const eligible = owners.data?.items.some((owner) => owner.id === lead.owner.id);
  const [stage, setStage] = useState<(typeof REOPEN_LEAD_STAGES)[number]>('contacted');
  const [date, setDate] = useState(defaultFollowUpDate(businessDate()));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [problem, setProblem] = useState<'date' | 'owner' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const chosenOwner = ownerId ?? (eligible ? lead.owner.id : null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!followUpDateInRange(date, businessDate())) return setProblem('date');
    if (!chosenOwner) return setProblem('owner');
    setProblem(null);
    try {
      await reopen.mutateAsync({
        stage,
        nextFollowUpOn: date,
        ...(chosenOwner !== lead.owner.id && { ownerId: chosenOwner }),
      });
      toast.add({ title: t('leads.reopen.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <Field>
        <FieldLabel id={ids.stage} render={<span />}>
          {t('leads.reopen.stage')}
        </FieldLabel>
        <ToggleGroup
          aria-labelledby={ids.stage}
          value={[stage]}
          onValueChange={(next: (typeof REOPEN_LEAD_STAGES)[number][]) => {
            if (next[0]) setStage(next[0]);
          }}
        >
          {REOPEN_LEAD_STAGES.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(`leads.stages.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <FollowUpField id={ids.date} value={date} onChange={setDate} invalid={problem === 'date'} />
      <Field invalid={problem === 'owner'}>
        <FieldLabel id={ids.owner} render={<span />}>
          {t('leads.form.owner')}
        </FieldLabel>
        <ChoiceSelect
          labelledBy={ids.owner}
          items={(owners.data?.items ?? []).map((owner) => ({
            value: owner.id,
            label: owner.name,
          }))}
          value={chosenOwner}
          placeholder={t('leads.form.ownerPlaceholder')}
          onChange={setOwnerId}
        />
        {owners.isSuccess && !eligible && (
          <FieldDescription>
            {t('leads.reopen.ownerGone', { name: lead.owner.name })}
          </FieldDescription>
        )}
        <FieldError match={problem === 'owner'}>{t('leads.form.errors.owner')}</FieldError>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Footer pending={reopen.isPending} action={t('leads.reopen.submit')} />
    </form>
  );
}

// Owner and follow-up date

export function OwnerDialog({
  lead,
  open,
  onClose,
}: {
  lead: LeadDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('leads.owner.title', { name: lead.displayName })}
      description={t('leads.owner.hint')}
    >
      <OwnerForm lead={lead} onClose={onClose} />
    </DialogShell>
  );
}

function OwnerForm({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const change = useChangeLeadOwner(lead.id);
  const owners = useQuery(leadOwnersQuery);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!ownerId || ownerId === lead.owner.id) return onClose();
    try {
      await change.mutateAsync(ownerId);
      toast.add({ title: t('leads.owner.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <Field>
        <FieldLabel id={id} render={<span />}>
          {t('leads.form.owner')}
        </FieldLabel>
        <ChoiceSelect
          labelledBy={id}
          items={(owners.data?.items ?? []).map((owner) => ({
            value: owner.id,
            label: owner.name,
          }))}
          value={ownerId ?? lead.owner.id}
          onChange={setOwnerId}
        />
        <FieldDescription>{t('leads.owner.handOverHint')}</FieldDescription>
      </Field>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Footer pending={change.isPending} action={t('leads.owner.submit')} />
    </form>
  );
}

export function FollowUpDialog({
  lead,
  open,
  onClose,
}: {
  lead: LeadDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('leads.followUp.setTitle')}
      description={t('leads.followUp.setHint')}
    >
      <FollowUpForm lead={lead} onClose={onClose} />
    </DialogShell>
  );
}

function FollowUpForm({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const update = useUpdateLead(lead.id);
  const [date, setDate] = useState(lead.nextFollowUpOn ?? defaultFollowUpDate(businessDate()));
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!followUpDateInRange(date, businessDate())) return setInvalid(true);
    setInvalid(false);
    try {
      await update.mutateAsync({ updatedAt: lead.updatedAt, nextFollowUpOn: date });
      toast.add({ title: t('leads.followUp.done'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <FollowUpField id={id} value={date} onChange={setDate} invalid={invalid} />
      {failure && <FormAlert>{failure}</FormAlert>}
      <Footer pending={update.isPending} action={t('common.save')} />
    </form>
  );
}

// Activity (screen 3)

/**
 * Logs an activity on an open lead, with the required new follow-up date (rule 4), or edits one
 * (no date then).
 */
export function NoteDialog({
  lead,
  note,
  open,
  onClose,
}: {
  lead: LeadDetail;
  /** The note to edit; a new activity otherwise. */
  note?: LeadNote;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      wide
      title={note ? t('leads.activity.editTitle') : t('leads.activity.logTitle')}
      description={note ? undefined : t('leads.activity.logHint')}
    >
      <NoteForm lead={lead} note={note} onClose={onClose} />
    </DialogShell>
  );
}

function NoteForm({
  lead,
  note,
  onClose,
}: {
  lead: LeadDetail;
  note?: LeadNote;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ids = { channel: useId(), time: useId(), date: useId() };
  const add = useAddLeadNote(lead.id);
  const update = useUpdateLeadNote(lead.id);
  const [failure, setFailure] = useState<string | null>(null);
  const today = businessDate();
  const form = useForm<CreateLeadNoteInput, unknown, CreateLeadNote>({
    resolver: standardSchemaResolver(createLeadNoteSchema),
    defaultValues: note
      ? {
          summary: note.summary,
          channel: note.channel,
          occurredAt: note.occurredAt,
          // Edits leave the date alone; the schema still wants a valid one.
          nextFollowUpOn: lead.nextFollowUpOn ?? defaultFollowUpDate(today),
        }
      : {
          summary: '',
          channel: 'call',
          occurredAt: new Date().toISOString(),
          nextFollowUpOn: defaultFollowUpDate(today),
        },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    try {
      if (note) {
        await update.mutateAsync({
          noteId: note.id,
          summary: values.summary,
          channel: values.channel,
          occurredAt: values.occurredAt,
        });
        toast.add({ title: t('leads.activity.saved'), type: 'success' });
      } else {
        if (!followUpDateInRange(values.nextFollowUpOn, today)) {
          form.setError('nextFollowUpOn', { type: 'range' });
          return;
        }
        // An untouched time means "now": the API stamps the activity when it is logged.
        await add.mutateAsync({
          ...values,
          occurredAt: form.formState.dirtyFields.occurredAt ? values.occurredAt : undefined,
        });
        toast.add({ title: t('leads.activity.logged'), type: 'success' });
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DATES') {
        form.setError('nextFollowUpOn', { type: SCREEN_ERROR, message: errorMessage(t, error) });
        return;
      }
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={submit} noValidate>
      <Field>
        <FieldLabel id={ids.channel} render={<span />}>
          {t('clients.notes.channel')}
        </FieldLabel>
        <Controller
          control={form.control}
          name="channel"
          render={({ field }) => (
            <ToggleGroup
              aria-labelledby={ids.channel}
              className="flex-wrap"
              value={[field.value]}
              onValueChange={(next: NoteChannel[]) => {
                if (next[0]) field.onChange(next[0]);
              }}
            >
              {NOTE_CHANNELS.map((channel) => {
                const Icon = channelIcon[channel];
                return (
                  <ToggleGroupItem key={channel} value={channel}>
                    <Icon aria-hidden="true" />
                    {t(`clients.notes.channels.${channel}`)}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}
        />
      </Field>
      <Field invalid={!!errors.summary}>
        <FieldLabel>{t('clients.notes.summary')}</FieldLabel>
        <Textarea
          className="min-h-24"
          placeholder={t('leads.activity.summaryPlaceholder')}
          {...form.register('summary')}
        />
        <FieldError match={!!errors.summary}>{t('clients.notes.errors.summary')}</FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.occurredAt}>
          <FieldLabel htmlFor={ids.time}>{t('clients.notes.occurredAt')}</FieldLabel>
          <Controller
            control={form.control}
            name="occurredAt"
            render={({ field }) => (
              <Input
                id={ids.time}
                type="datetime-local"
                dir="ltr"
                className="text-end tabular-nums"
                max={toBusinessDateTimeInput(new Date())}
                value={field.value ? toBusinessDateTimeInput(field.value) : ''}
                onChange={(event) =>
                  field.onChange(
                    event.target.value ? fromBusinessDateTimeInput(event.target.value) : '',
                  )
                }
                onBlur={field.onBlur}
              />
            )}
          />
          <FieldError match={!!errors.occurredAt}>
            {t('clients.notes.errors.occurredAt')}
          </FieldError>
        </Field>
        {!note && (
          <Controller
            control={form.control}
            name="nextFollowUpOn"
            render={({ field }) => (
              <FollowUpField
                id={ids.date}
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors.nextFollowUpOn}
                error={
                  errors.nextFollowUpOn?.type === SCREEN_ERROR
                    ? errors.nextFollowUpOn.message
                    : undefined
                }
              />
            )}
          />
        )}
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      <Footer
        pending={form.formState.isSubmitting}
        action={note ? t('common.save') : t('leads.activity.log')}
      />
    </form>
  );
}
