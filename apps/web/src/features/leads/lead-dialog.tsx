import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  type CreateLead,
  type CreateLeadInput,
  CURRENCIES,
  createLeadSchema,
  defaultFollowUpDate,
  followUpDateInRange,
  LEAD_LIMITS,
  LEAD_SOURCES,
  type LeadDetail,
  type LeadDuplicateQuery,
  type LeadSource,
  optionalEmailSchema,
  phoneSchema,
  type UpdateLead,
} from '@vertex-hub/contracts';
import {
  Autocomplete,
  Avatar,
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
  MultiCombobox,
  Switch,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { StethoscopeIcon, UsersRoundIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { can, canAll, useMe } from '../../lib/auth';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { useDebouncedValue } from '../../lib/use-search-text';
import { ClientStatusBadge } from '../clients/client-badges';
import { sectorsQuery } from '../clients/clients.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { LeadStageBadge } from './lead-badges';
import type { LeadDialogProps } from './lead-dialogs';
import {
  interestOptionsQuery,
  leadDuplicatesQuery,
  leadOwnersQuery,
  useCreateLead,
  useUpdateLead,
} from './leads.queries';

type LeadValues = CreateLeadInput;

interface InterestItem {
  key: string;
  name: string;
  kind: 'service' | 'package';
  id: string;
  archived: boolean;
}

const interestKey = (interest: { serviceId?: string; packageId?: string }) =>
  interest.serviceId ? `service:${interest.serviceId}` : `package:${interest.packageId}`;

const blank = (text: string | null | undefined) => !text?.trim();

/**
 * The contract, then the rules the API checks across fields (contact method, the "other" source's
 * detail, the follow-up range, the interest limit), so every problem shows at once and the focus
 * goes to the first. The budget's currency goes with an amount only: without one, both are cleared.
 * An edit checks the date only when it changes: an overdue lead keeps its past date (rule 3).
 */
function leadResolver(
  lead: LeadDetail | undefined,
  today: string,
): Resolver<LeadValues, unknown, CreateLead> {
  const schema = standardSchemaResolver(createLeadSchema);
  return async (values, context, options) => {
    const result = await schema(
      {
        ...values,
        budgetCurrency: values.budgetMinor == null ? null : (values.budgetCurrency ?? 'USD'),
      },
      context,
      options,
    );
    const across: FieldErrors<LeadValues> = {};
    if (blank(values.phone) && blank(values.email) && blank(values.socialHandle)) {
      across.phone = { type: 'contact', message: '' };
    }
    if (values.source === 'other' && blank(values.sourceDetail)) {
      across.sourceDetail = { type: 'required', message: '' };
    }
    const dateChanged = !lead || values.nextFollowUpOn !== lead.nextFollowUpOn;
    if (dateChanged && !followUpDateInRange(values.nextFollowUpOn, today)) {
      across.nextFollowUpOn = { type: 'range', message: '' };
    }
    if ((values.interests?.length ?? 0) > LEAD_LIMITS.interests) {
      across.interests = { type: 'limit', message: '' };
    }
    if (Object.keys(across).length === 0) return result;
    // The contract's own error on a field comes first.
    return { values: {}, errors: { ...across, ...result.errors } };
  };
}

function valuesOf(lead: LeadDetail | undefined, ownerId: string, today: string): LeadValues {
  if (!lead) {
    return {
      contactName: '',
      companyName: '',
      phone: '',
      email: '',
      socialHandle: '',
      source: 'instagram',
      sourceDetail: '',
      request: '',
      budgetMinor: null,
      budgetCurrency: 'USD',
      sector: '',
      isHealthcare: false,
      interests: [],
      ownerId,
      nextFollowUpOn: defaultFollowUpDate(today),
    };
  }
  return {
    contactName: lead.contactName,
    companyName: lead.companyName ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    socialHandle: lead.socialHandle ?? '',
    source: lead.source,
    sourceDetail: lead.sourceDetail ?? '',
    request: lead.request ?? '',
    budgetMinor: lead.budgetMinor,
    budgetCurrency: lead.budgetCurrency ?? 'USD',
    sector: lead.sector ?? '',
    isHealthcare: lead.isHealthcare,
    interests: lead.interests.map((interest) =>
      interest.kind === 'service' ? { serviceId: interest.id } : { packageId: interest.id },
    ),
    ownerId: lead.owner.id,
    nextFollowUpOn: lead.nextFollowUpOn ?? defaultFollowUpDate(today),
  };
}

/** Where a refused save belongs: a field, or the form (null). */
const FIELD_OF_CODE = {
  CONTACT_REQUIRED: 'phone',
  INVALID_LEAD_OWNER: 'ownerId',
  INVALID_DATES: 'nextFollowUpOn',
  NOTE_REQUIRED: 'sourceDetail',
  CATALOG_ITEM_ARCHIVED: 'interests',
  LIMIT_REACHED: 'interests',
} as const;

/**
 * Spec screen 2: creates a lead, or edits an open one (rule 7). A live panel lists open leads and
 * clients that look like the same person (rule 2); it warns and never blocks.
 */
export function LeadDialog({
  open,
  onClose,
  finalFocus,
  lead,
}: LeadDialogProps & {
  /** The lead to edit; a new lead otherwise. */
  lead?: LeadDetail;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{lead ? t('leads.form.editTitle') : t('leads.form.newTitle')}</DialogTitle>
          <DialogDescription>{t('leads.form.hint')}</DialogDescription>
        </DialogHeader>
        {/* Unmounted once the dialog has faded out: each opening starts from the lead as it is. */}
        <LeadForm lead={lead} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function LeadForm({ lead, onClose }: { lead?: LeadDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useMe();
  const today = businessDate();
  const ids = {
    source: useId(),
    sector: useId(),
    interests: useId(),
    owner: useId(),
    healthcare: useId(),
    budget: useId(),
    currency: useId(),
  };
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? '');
  const owners = useQuery({ ...leadOwnersQuery, enabled: !lead });
  const interestOptions = useQuery(interestOptionsQuery);
  const sectors = useQuery({ ...sectorsQuery, enabled: can(me, 'clients.read') });
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<LeadValues, unknown, CreateLead>({
    resolver: leadResolver(lead, today),
    defaultValues: valuesOf(lead, me.user.id, today),
  });
  // Read while rendering: React Hook Form updates only the form state a component reads.
  const { errors, isDirty, dirtyFields } = form.formState;
  const [source, budgetMinor, budgetCurrency] = useWatch({
    control: form.control,
    name: ['source', 'budgetMinor', 'budgetCurrency'],
  });
  // An account manager owns the leads they create (rule 1); scope-all managers pick anyone.
  const pickOwner = canAll(me, 'leads.manage');

  const interestItems: InterestItem[] = [
    ...(interestOptions.data?.services ?? []).map((item) => ({
      key: `service:${item.id}`,
      name: item.name,
      kind: 'service' as const,
      id: item.id,
      archived: false,
    })),
    ...(interestOptions.data?.packages ?? []).map((item) => ({
      key: `package:${item.id}`,
      name: item.name,
      kind: 'package' as const,
      id: item.id,
      archived: false,
    })),
  ];
  // An interest archived since it was added stays on the lead (edge case 10).
  for (const interest of lead?.interests ?? []) {
    const key = `${interest.kind}:${interest.id}`;
    if (!interestItems.some((item) => item.key === key)) {
      interestItems.push({ key, ...interest });
    }
  }
  const byKey = new Map(interestItems.map((item) => [item.key, item]));

  const ownerItems = (owners.data?.items ?? [])
    .filter((owner) => pickOwner || owner.id === me.user.id)
    .map((owner) => ({ value: owner.id, label: owner.name }));
  const sourceItems = LEAD_SOURCES.map((value) => ({
    value,
    label: t(`leads.sources.${value}`),
  }));
  const currencyItems = CURRENCIES.map((currency) => ({
    value: currency,
    label: t(`quotes.currencies.${currency}`),
  }));

  function refused(error: unknown) {
    const code = error instanceof ApiError ? error.knownCode : undefined;
    const field =
      code && code in FIELD_OF_CODE ? FIELD_OF_CODE[code as keyof typeof FIELD_OF_CODE] : null;
    if (field) {
      form.setError(
        field,
        { type: SCREEN_ERROR, message: errorMessage(t, error) },
        { shouldFocus: true },
      );
      return;
    }
    setFailure(errorMessage(t, error));
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // An edit that changes nothing closes without a request or a "saved" toast.
    if (lead && !isDirty) return onClose();
    try {
      if (lead) {
        // Only what changed is sent; the budget's amount and currency travel together.
        const dirty = dirtyFields;
        const budgetDirty = !!(dirty.budgetMinor || dirty.budgetCurrency);
        const changes: UpdateLead = {
          updatedAt: lead.updatedAt,
          ...(dirty.contactName && { contactName: values.contactName }),
          ...(dirty.companyName && { companyName: values.companyName }),
          ...(dirty.phone && { phone: values.phone }),
          ...(dirty.email && { email: values.email }),
          ...(dirty.socialHandle && { socialHandle: values.socialHandle }),
          ...(dirty.source && { source: values.source }),
          ...(dirty.sourceDetail && { sourceDetail: values.sourceDetail }),
          ...(dirty.request && { request: values.request }),
          ...(budgetDirty && {
            budgetMinor: values.budgetMinor,
            budgetCurrency: values.budgetCurrency,
          }),
          ...(dirty.sector && { sector: values.sector }),
          ...(dirty.isHealthcare && { isHealthcare: values.isHealthcare }),
          ...(dirty.interests && { interests: values.interests }),
          ...(dirty.nextFollowUpOn && { nextFollowUpOn: values.nextFollowUpOn }),
        };
        await update.mutateAsync(changes);
        toast.add({ title: t('leads.form.saved'), type: 'success' });
      } else {
        await create.mutateAsync(values);
        toast.add({ title: t('leads.form.created'), type: 'success' });
      }
      onClose();
    } catch (error) {
      refused(error);
    }
  });

  return (
    <form className="grid gap-6" onSubmit={submit} noValidate>
      <section className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.contactName}>
          <FieldLabel>{t('leads.form.contactName')}</FieldLabel>
          <Input autoComplete="off" {...form.register('contactName')} />
          <FieldError match={!!errors.contactName}>{t('leads.form.errors.contactName')}</FieldError>
        </Field>
        <Field invalid={!!errors.companyName}>
          <FieldLabel>{t('leads.form.companyName')}</FieldLabel>
          <Input autoComplete="off" {...form.register('companyName')} />
          <FieldDescription>{t('leads.form.companyNameHint')}</FieldDescription>
          <FieldError match={!!errors.companyName}>{t('leads.form.errors.name')}</FieldError>
        </Field>
        <Field invalid={!!errors.phone}>
          <FieldLabel>{t('leads.form.phone')}</FieldLabel>
          <Input type="tel" dir="ltr" autoComplete="off" {...form.register('phone')} />
          <FieldDescription>{t('clients.contacts.form.phoneHint')}</FieldDescription>
          <FieldError match={!!errors.phone} role={errorRole(errors.phone)}>
            {errors.phone?.type === 'contact'
              ? t('leads.form.errors.contact')
              : fieldError(errors.phone, t('clients.contacts.form.errors.phone'))}
          </FieldError>
        </Field>
        <Field invalid={!!errors.email}>
          <FieldLabel>{t('leads.form.email')}</FieldLabel>
          <Input type="email" dir="ltr" autoComplete="off" {...form.register('email')} />
          <FieldError match={!!errors.email}>{t('clients.contacts.form.errors.email')}</FieldError>
        </Field>
        <Field invalid={!!errors.socialHandle} className="sm:col-span-2">
          <FieldLabel>{t('leads.form.socialHandle')}</FieldLabel>
          <Input
            dir="ltr"
            autoComplete="off"
            placeholder={t('leads.form.socialHandlePlaceholder')}
            {...form.register('socialHandle')}
          />
          <FieldDescription>{t('leads.form.contactHint')}</FieldDescription>
          <FieldError match={!!errors.socialHandle}>{t('leads.form.errors.name')}</FieldError>
        </Field>
      </section>

      <DuplicatePanel form={form} excludeLeadId={lead?.id} />

      <section className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="source"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.source} render={<span />}>
                {t('leads.form.source')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.source}
                items={sourceItems}
                value={field.value}
                onChange={(next) => field.onChange(next as LeadSource)}
              />
            </Field>
          )}
        />
        <Field invalid={!!errors.sourceDetail}>
          <FieldLabel>
            {source === 'other'
              ? t('leads.form.sourceDetailRequired')
              : t('leads.form.sourceDetail')}
          </FieldLabel>
          <Input
            autoComplete="off"
            placeholder={t('leads.form.sourceDetailPlaceholder')}
            {...form.register('sourceDetail')}
          />
          <FieldError match={!!errors.sourceDetail} role={errorRole(errors.sourceDetail)}>
            {errors.sourceDetail?.type === 'required'
              ? t('leads.form.errors.sourceDetailRequired')
              : fieldError(errors.sourceDetail, t('leads.form.errors.name'))}
          </FieldError>
        </Field>
        <Controller
          control={form.control}
          name="interests"
          render={({ field }) => (
            <Field invalid={!!errors.interests} className="sm:col-span-2">
              <FieldLabel htmlFor={ids.interests}>{t('leads.form.interests')}</FieldLabel>
              <MultiCombobox
                id={ids.interests}
                items={interestItems.filter((item) => !item.archived)}
                value={(field.value ?? []).flatMap(
                  (interest) => byKey.get(interestKey(interest)) ?? [],
                )}
                onValueChange={(next) =>
                  field.onChange(
                    next.map((item) =>
                      item.kind === 'service' ? { serviceId: item.id } : { packageId: item.id },
                    ),
                  )
                }
                itemToLabel={(item) =>
                  item.archived ? t('leads.form.archivedInterest', { name: item.name }) : item.name
                }
                itemToKey={(item) => item.key}
                placeholder={t('leads.form.interestsPlaceholder')}
                emptyLabel={t('common.noMatches')}
                removeLabel={(label) => t('common.remove', { label })}
                invalid={!!errors.interests}
              />
              <FieldDescription>
                {t('leads.form.interestsHint', { n: LEAD_LIMITS.interests })}
              </FieldDescription>
              <FieldError match={!!errors.interests} role={errorRole(errors.interests)}>
                {fieldError(
                  errors.interests as Parameters<typeof fieldError>[0],
                  t('leads.form.errors.interests', { n: LEAD_LIMITS.interests }),
                )}
              </FieldError>
            </Field>
          )}
        />
        <Field invalid={!!errors.request} className="sm:col-span-2">
          <FieldLabel>{t('leads.form.request')}</FieldLabel>
          <Textarea
            rows={3}
            placeholder={t('leads.form.requestPlaceholder')}
            {...form.register('request')}
          />
          <FieldError match={!!errors.request}>{t('leads.form.errors.request')}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="budgetMinor"
          render={({ field }) => (
            <Field invalid={!!errors.budgetMinor}>
              <FieldLabel htmlFor={ids.budget}>{t('leads.form.budget')}</FieldLabel>
              <MoneyInput
                id={ids.budget}
                value={field.value}
                onValueChange={(minor) => field.onChange(minor === 0 ? null : minor)}
                currency={budgetCurrency ?? 'USD'}
              />
              <FieldDescription>{t('leads.form.budgetHint')}</FieldDescription>
              <FieldError match={!!errors.budgetMinor}>{t('leads.form.errors.budget')}</FieldError>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="budgetCurrency"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.currency} render={<span />}>
                {t('leads.form.currency')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.currency}
                items={currencyItems}
                value={field.value ?? 'USD'}
                disabled={budgetMinor == null}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
        <Field invalid={!!errors.sector}>
          <FieldLabel htmlFor={ids.sector}>{t('clients.form.sector')}</FieldLabel>
          <Controller
            control={form.control}
            name="sector"
            render={({ field }) => (
              <Autocomplete
                id={ids.sector}
                name={field.name}
                inputRef={field.ref}
                value={field.value ?? ''}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                suggestions={sectors.data?.items ?? []}
                placeholder={t('clients.form.sectorPlaceholder')}
                invalid={!!errors.sector}
              />
            )}
          />
          <FieldError match={!!errors.sector}>{t('clients.form.errors.sector')}</FieldError>
        </Field>
        <Field invalid={!!errors.nextFollowUpOn}>
          <FieldLabel>{t('leads.form.nextFollowUpOn')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            min={today}
            max={addDays(today, LEAD_LIMITS.followUpDays)}
            {...form.register('nextFollowUpOn')}
          />
          <FieldDescription>{t('leads.form.nextFollowUpHint')}</FieldDescription>
          <FieldError match={!!errors.nextFollowUpOn} role={errorRole(errors.nextFollowUpOn)}>
            {fieldError(
              errors.nextFollowUpOn,
              t('leads.form.errors.followUp', { n: LEAD_LIMITS.followUpDays }),
            )}
          </FieldError>
        </Field>
        <Controller
          control={form.control}
          name="isHealthcare"
          render={({ field }) => (
            <label
              htmlFor={ids.healthcare}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 transition-colors duration-150 ease-out hover:bg-muted/50 has-data-checked:border-primary sm:col-span-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-status-info text-status-info-foreground">
                <StethoscopeIcon className="size-5" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">{t('clients.form.healthcare')}</span>
                <span className="text-sm text-muted-foreground">
                  {t('leads.form.healthcareHint')}
                </span>
              </span>
              <Switch
                id={ids.healthcare}
                checked={field.value ?? false}
                onCheckedChange={(checked) => field.onChange(checked)}
                className="mt-1"
              />
            </label>
          )}
        />
        {!lead && (
          <Controller
            control={form.control}
            name="ownerId"
            render={({ field }) => (
              <Field invalid={!!errors.ownerId} className="sm:col-span-2">
                <FieldLabel id={ids.owner} render={<span />}>
                  {t('leads.form.owner')}
                </FieldLabel>
                <ChoiceSelect
                  ref={field.ref}
                  labelledBy={ids.owner}
                  items={ownerItems}
                  value={field.value || null}
                  disabled={!pickOwner}
                  placeholder={t('leads.form.ownerPlaceholder')}
                  onChange={field.onChange}
                />
                <FieldDescription>
                  {pickOwner ? t('leads.form.ownerHint') : t('leads.form.ownerSelfHint')}
                </FieldDescription>
                <FieldError match={!!errors.ownerId} role={errorRole(errors.ownerId)}>
                  {fieldError(errors.ownerId, t('leads.form.errors.owner'))}
                </FieldError>
              </Field>
            )}
          />
        )}
      </section>

      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting
            ? t('common.saving')
            : lead
              ? t('common.save')
              : t('leads.form.create')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The duplicate check's request for what is typed: well-formed values only. */
function duplicateQuery(
  values: {
    phone?: string | null;
    email?: string | null;
    companyName?: string | null;
    contactName?: string;
  },
  excludeLeadId: string | undefined,
): LeadDuplicateQuery | null {
  const phone = phoneSchema.safeParse(values.phone ?? '');
  const email = optionalEmailSchema.safeParse(values.email ?? '');
  const names = [
    ...new Set(
      [values.companyName, values.contactName].flatMap((name) => {
        const trimmed = name?.trim() ?? '';
        return trimmed.length >= 2 ? [trimmed.slice(0, 120)] : [];
      }),
    ),
  ];
  const query: LeadDuplicateQuery = {
    phone: phone.success ? phone.data : null,
    email: email.success ? email.data : null,
    names,
    ...(excludeLeadId && { excludeLeadId }),
  };
  return query.phone || query.email || names.length > 0 ? query : null;
}

/** Rule 2: open leads and clients that look like the same person, as the user types. */
function DuplicatePanel({
  form,
  excludeLeadId,
}: {
  form: ReturnType<typeof useForm<LeadValues, unknown, CreateLead>>;
  excludeLeadId: string | undefined;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const [phone, email, companyName, contactName] = useWatch({
    control: form.control,
    name: ['phone', 'email', 'companyName', 'contactName'],
  });
  // Debounced as text: a new query object on every render would never settle.
  const settled = useDebouncedValue(
    JSON.stringify(duplicateQuery({ phone, email, companyName, contactName }, excludeLeadId)),
    500,
  );
  const query = JSON.parse(settled) as LeadDuplicateQuery | null;
  const duplicates = useQuery({
    ...leadDuplicatesQuery(query ?? { phone: null, email: null, names: [] }),
    enabled: query !== null,
  });
  const data = query ? duplicates.data : undefined;
  if (!data || (data.leads.length === 0 && data.clients.length === 0)) return null;
  const readsClients = can(me, 'clients.read');

  return (
    <section className="flex flex-col gap-3" aria-live="polite">
      <Callout
        tone="warning"
        icon={<UsersRoundIcon />}
        title={t('leads.duplicates.title')}
        description={t('leads.duplicates.hint')}
      />
      <ul
        className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm"
        aria-label={t('leads.duplicates.title')}
      >
        {data.leads.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('leads.duplicates.lead')}</span>
            {match.readable ? (
              <Link
                to="/leads/$leadId"
                params={{ leadId: match.id }}
                target="_blank"
                className="font-medium hover:underline"
              >
                {match.displayName}
              </Link>
            ) : (
              <span className="font-medium">{match.displayName}</span>
            )}
            <LeadStageBadge stage={match.stage} />
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Avatar name={match.owner.name} size="sm" />
              {match.owner.name}
            </span>
          </li>
        ))}
        {data.clients.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('leads.duplicates.client')}</span>
            {readsClients ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: match.id }}
                target="_blank"
                className="font-medium hover:underline"
              >
                {match.tradeName}
              </Link>
            ) : (
              <span className="font-medium">{match.tradeName}</span>
            )}
            <ClientStatusBadge status={match.status} />
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Avatar name={match.accountManager.name} size="sm" />
              {match.accountManager.name}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
