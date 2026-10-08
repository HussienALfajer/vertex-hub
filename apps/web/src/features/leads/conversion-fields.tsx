import { useQuery } from '@tanstack/react-query';
import {
  type ConvertLeadInput,
  convertLeadSchema,
  type LeadConversionPlan,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  cn,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { BadgeCheckIcon, InfoIcon, StethoscopeIcon } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { ClientStatusBadge } from '../clients/client-badges';
import { clientListQuery } from '../clients/clients.queries';
import { ChoiceSelect } from '../quotes/choice-select';

/** The convert form (rule 10), shared by the convert dialog and accept step 0 (rule 11). */
export interface ConversionValues {
  mode: 'new' | 'existing';
  clientId: string;
  tradeName: string;
  sector: string;
  isHealthcare: boolean;
  accountManagerId: string;
  contact: {
    add: boolean;
    name: string;
    jobTitle: string;
    phone: string;
    email: string;
    hasFinalApproval: boolean;
  };
}

/** A field of the form with a problem: `tradeName`, `contact.name`… */
export type ConversionProblems = Partial<Record<string, string | true>>;

function defaultsOf(plan: LeadConversionPlan): ConversionValues {
  return {
    mode: 'new',
    clientId: '',
    tradeName: plan.client.tradeName,
    sector: plan.client.sector ?? '',
    isHealthcare: plan.client.isHealthcare,
    accountManagerId: plan.client.accountManagerId ?? '',
    contact: {
      add: true,
      name: plan.contact.name,
      jobTitle: '',
      phone: plan.contact.phone ?? '',
      email: plan.contact.email ?? '',
      hasFinalApproval: true,
    },
  };
}

export function toConversion(values: ConversionValues): ConvertLeadInput {
  const contact = values.contact.add
    ? {
        add: true as const,
        name: values.contact.name,
        jobTitle: values.contact.jobTitle,
        phone: values.contact.phone,
        email: values.contact.email,
        hasFinalApproval: values.contact.hasFinalApproval,
      }
    : { add: false as const };
  return values.mode === 'new'
    ? {
        mode: 'new',
        client: {
          tradeName: values.tradeName,
          sector: values.sector,
          isHealthcare: values.isHealthcare,
          accountManagerId: values.accountManagerId,
        },
        contact,
      }
    : { mode: 'existing', clientId: values.clientId, contact };
}

/** A refusal from the server is a message, announced when it shows; a failed check is `true`. */
const refusal = (problem: string | true | undefined) =>
  typeof problem === 'string' ? 'alert' : undefined;

/** The fields the contract refuses, keyed as `ConversionFields` shows them. */
export function conversionProblems(values: ConversionValues): ConversionProblems {
  const parsed = convertLeadSchema.safeParse(toConversion(values));
  if (parsed.success) return {};
  const problems: ConversionProblems = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path.filter((part) => part !== 'client').join('.');
    problems[path || 'mode'] = true;
  }
  return problems;
}

/**
 * The form's state from the plan (none for a client quote's accept dialog). A newly picked
 * existing client turns the contact on unless one of its contacts already has the lead's phone or
 * email (rule 10).
 */
export function useConversionValues(
  plan: LeadConversionPlan,
): readonly [ConversionValues, (values: ConversionValues) => void];
export function useConversionValues(
  plan: LeadConversionPlan | null,
): readonly [ConversionValues | null, (values: ConversionValues) => void];
export function useConversionValues(
  plan: LeadConversionPlan | null,
): readonly [ConversionValues | null, (values: ConversionValues) => void] {
  const [values, setValues] = useState<ConversionValues | null>(() =>
    plan ? defaultsOf(plan) : null,
  );
  const linked = useRef<string | null>(null);
  const existing = plan?.existingClient;
  useEffect(() => {
    if (!existing || linked.current === existing.id) return;
    linked.current = existing.id;
    setValues((current) =>
      current?.clientId === existing.id
        ? { ...current, contact: { ...current.contact, add: !existing.hasContact } }
        : current,
    );
  }, [existing]);
  return [values, setValues] as const;
}

/**
 * Spec screen 4's fields: New client / Existing client tabs and the contact block, with what moves
 * to the client. `onClient` asks for the plan of a picked existing client.
 */
export function ConversionFields({
  plan,
  values,
  onChange,
  problems,
  onClient,
}: {
  plan: LeadConversionPlan;
  values: ConversionValues;
  onChange: (values: ConversionValues) => void;
  problems: ConversionProblems;
  onClient: (clientId: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const set = (next: Partial<ConversionValues>) => onChange({ ...values, ...next });
  // "Link instead" leaves with the new-client fields: the focus goes to the client it picked.
  const picker = useRef<HTMLButtonElement>(null);

  return (
    <div className="grid gap-5">
      <Tabs
        value={values.mode}
        onValueChange={(mode: ConversionValues['mode']) => {
          set({ mode });
          onClient(mode === 'existing' && values.clientId ? values.clientId : undefined);
        }}
      >
        <TabsList aria-label={t('leads.convert.mode')}>
          <TabsTrigger value="new">{t('leads.convert.modes.new')}</TabsTrigger>
          <TabsTrigger value="existing">{t('leads.convert.modes.existing')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {values.mode === 'new' ? (
        <NewClientFields
          plan={plan}
          values={values}
          set={set}
          problems={problems}
          onLink={(clientId) => {
            flushSync(() => set({ mode: 'existing', clientId }));
            picker.current?.focus();
            onClient(clientId);
          }}
        />
      ) : (
        <ExistingClientFields
          picker={picker}
          plan={plan}
          values={values}
          problems={problems}
          onPick={(clientId) => {
            set({ clientId });
            onClient(clientId);
          }}
        />
      )}
      <ContactFields values={values} onChange={onChange} problems={problems} />
      <Callout
        icon={<InfoIcon />}
        title={t('leads.convert.moves', {
          notes: formatNumber(plan.noteCount),
          quotes: formatNumber(plan.quoteCount),
        })}
      />
    </div>
  );
}

function NewClientFields({
  plan,
  values,
  set,
  problems,
  onLink,
}: {
  plan: LeadConversionPlan;
  values: ConversionValues;
  set: (next: Partial<ConversionValues>) => void;
  problems: ConversionProblems;
  onLink: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const ids = { name: useId(), sector: useId(), manager: useId(), healthcare: useId() };
  const nameProblem = problems.tradeName;
  // Edge case 6: the client that already holds the name, to link instead.
  const tradeName = values.tradeName.trim();
  const holders = useQuery({
    ...clientListQuery({
      search: tradeName,
      status: ['active', 'paused', 'ended'],
      pageSize: 10,
    }),
    enabled: !!problems.nameTaken && tradeName.length > 0,
  });
  const holder = problems.nameTaken
    ? (holders.data?.items ?? []).find(
        (client) => client.tradeName.toLowerCase() === tradeName.toLowerCase(),
      )
    : undefined;
  return (
    <section className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!nameProblem}>
        <FieldLabel htmlFor={ids.name}>{t('clients.form.tradeName')}</FieldLabel>
        <Input
          id={ids.name}
          autoComplete="off"
          value={values.tradeName}
          onChange={(event) => set({ tradeName: event.target.value })}
        />
        <FieldError match={!!nameProblem} role={refusal(nameProblem)}>
          {typeof nameProblem === 'string' ? nameProblem : t('clients.form.errors.tradeName')}
        </FieldError>
      </Field>
      {holder && (
        <Callout
          tone="warning"
          className="sm:col-span-2"
          title={t('leads.convert.nameTaken', { name: holder.tradeName })}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => onLink(holder.id)}>
              {t('leads.convert.linkInstead')}
            </Button>
          }
        />
      )}
      <Field invalid={!!problems.sector}>
        <FieldLabel htmlFor={ids.sector}>{t('clients.form.sector')}</FieldLabel>
        <Input
          id={ids.sector}
          autoComplete="off"
          value={values.sector}
          onChange={(event) => set({ sector: event.target.value })}
        />
        <FieldError match={!!problems.sector}>{t('clients.form.errors.sector')}</FieldError>
      </Field>
      <Field invalid={!!problems.accountManagerId} className="sm:col-span-2">
        <FieldLabel id={ids.manager} render={<span />}>
          {t('clients.form.accountManager')}
        </FieldLabel>
        <ChoiceSelect
          labelledBy={ids.manager}
          items={plan.accountManagers.map((user) => ({ value: user.id, label: user.name }))}
          value={values.accountManagerId || null}
          placeholder={t('clients.form.accountManagerPlaceholder')}
          onChange={(accountManagerId) => set({ accountManagerId })}
        />
        <FieldDescription>{t('leads.convert.accountManagerHint')}</FieldDescription>
        <FieldError match={!!problems.accountManagerId} role={refusal(problems.accountManagerId)}>
          {typeof problems.accountManagerId === 'string'
            ? problems.accountManagerId
            : t('clients.form.errors.accountManager')}
        </FieldError>
      </Field>
      <SwitchRow
        id={ids.healthcare}
        icon={<StethoscopeIcon className="size-5" />}
        tone="info"
        title={t('clients.form.healthcare')}
        hint={t('clients.form.healthcareHint')}
        checked={values.isHealthcare}
        onChange={(isHealthcare) => set({ isHealthcare })}
      />
    </section>
  );
}

function ExistingClientFields({
  picker,
  plan,
  values,
  problems,
  onPick,
}: {
  picker: RefObject<HTMLButtonElement | null>;
  plan: LeadConversionPlan;
  values: ConversionValues;
  problems: ConversionProblems;
  onPick: (clientId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const clients = useQuery(
    clientListQuery({ status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const suggested = new Set(plan.duplicateClients.map((client) => client.id));
  const items = [
    ...plan.duplicateClients.map((client) => ({
      value: client.id,
      label: t('leads.convert.suggested', { name: client.tradeName }),
    })),
    ...(clients.data?.items ?? [])
      .filter((client) => !suggested.has(client.id))
      .map((client) => ({ value: client.id, label: client.tradeName })),
  ];
  const picked = plan.existingClient?.id === values.clientId ? plan.existingClient : null;

  return (
    <section className="grid gap-4">
      {plan.duplicateClients.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t('leads.convert.suggestions')}</p>
          <ul className="flex flex-wrap gap-2">
            {plan.duplicateClients.map((client) => (
              <li key={client.id}>
                <Button
                  type="button"
                  size="sm"
                  variant={values.clientId === client.id ? 'secondary' : 'outline'}
                  aria-pressed={values.clientId === client.id}
                  onClick={() => onPick(client.id)}
                >
                  {client.tradeName}
                  <ClientStatusBadge status={client.status} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field invalid={!!problems.clientId}>
        <FieldLabel id={id} render={<span />}>
          {t('leads.convert.client')}
        </FieldLabel>
        <ChoiceSelect
          ref={picker}
          labelledBy={id}
          items={items}
          value={values.clientId || null}
          placeholder={t('leads.convert.pickClient')}
          onChange={onPick}
        />
        <FieldError match={!!problems.clientId} role={refusal(problems.clientId)}>
          {typeof problems.clientId === 'string'
            ? problems.clientId
            : t('leads.convert.errors.client')}
        </FieldError>
      </Field>
      {picked && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <ClientStatusBadge status={picked.status} />
          {t('leads.convert.accountManagerIs', { name: picked.accountManager.name })}
          {picked.status === 'ended' && <span>{t('leads.convert.reactivates')}</span>}
        </p>
      )}
    </section>
  );
}

function ContactFields({
  values,
  onChange,
  problems,
}: {
  values: ConversionValues;
  onChange: (values: ConversionValues) => void;
  problems: ConversionProblems;
}) {
  const { t } = useTranslation();
  const ids = { add: useId(), approval: useId() };
  const contact = values.contact;
  const set = (next: Partial<ConversionValues['contact']>) =>
    onChange({ ...values, contact: { ...contact, ...next } });
  const problem = (field: string) => problems[`contact.${field}`];

  return (
    <section className="grid gap-4 rounded-lg border border-border p-4">
      <label htmlFor={ids.add} className="flex cursor-pointer items-center gap-3">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-bold">{t('leads.convert.contact')}</span>
          <span className="text-sm text-muted-foreground">
            {values.mode === 'existing'
              ? t('leads.convert.contactExistingHint')
              : t('leads.convert.contactHint')}
          </span>
        </span>
        <Switch id={ids.add} checked={contact.add} onCheckedChange={(add) => set({ add })} />
      </label>
      {contact.add && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field invalid={!!problem('name')}>
            <FieldLabel>{t('clients.contacts.form.name')}</FieldLabel>
            <Input
              autoComplete="off"
              value={contact.name}
              onChange={(event) => set({ name: event.target.value })}
            />
            <FieldError match={!!problem('name')}>
              {t('clients.contacts.form.errors.name')}
            </FieldError>
          </Field>
          <Field invalid={!!problem('jobTitle')}>
            <FieldLabel>{t('clients.contacts.form.jobTitle')}</FieldLabel>
            <Input
              autoComplete="off"
              value={contact.jobTitle}
              onChange={(event) => set({ jobTitle: event.target.value })}
            />
            <FieldError match={!!problem('jobTitle')}>
              {t('clients.contacts.form.errors.jobTitle')}
            </FieldError>
          </Field>
          <Field invalid={!!problem('phone')}>
            <FieldLabel>{t('clients.contacts.form.phone')}</FieldLabel>
            <Input
              type="tel"
              dir="ltr"
              autoComplete="off"
              value={contact.phone}
              onChange={(event) => set({ phone: event.target.value })}
            />
            <FieldError match={!!problem('phone')}>
              {t('clients.contacts.form.errors.phone')}
            </FieldError>
          </Field>
          <Field invalid={!!problem('email')}>
            <FieldLabel>{t('clients.contacts.form.email')}</FieldLabel>
            <Input
              type="email"
              dir="ltr"
              autoComplete="off"
              value={contact.email}
              onChange={(event) => set({ email: event.target.value })}
            />
            <FieldError match={!!problem('email')}>
              {t('clients.contacts.form.errors.email')}
            </FieldError>
          </Field>
          <SwitchRow
            id={ids.approval}
            icon={<BadgeCheckIcon className="size-5" />}
            tone="gold"
            title={t('clients.contacts.form.finalApproval')}
            hint={t('clients.contacts.form.finalApprovalHint')}
            checked={contact.hasFinalApproval}
            onChange={(hasFinalApproval) => set({ hasFinalApproval })}
          />
        </div>
      )}
    </section>
  );
}

function SwitchRow({
  id,
  icon,
  tone,
  title,
  hint,
  checked,
  onChange,
}: {
  id: string;
  icon: ReactNode;
  tone: 'info' | 'gold';
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 transition-colors duration-150 ease-out hover:bg-muted/50 has-data-checked:border-primary sm:col-span-2"
    >
      <span
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-md',
          tone === 'info'
            ? 'bg-status-info text-status-info-foreground'
            : 'bg-status-gold text-status-gold-foreground',
        )}
      >
        {icon}
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-1" />
    </label>
  );
}

/** The client a conversion creates or links, for summaries. */
export function ConversionSummary({
  plan,
  values,
}: {
  plan: LeadConversionPlan;
  values: ConversionValues;
}) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-2">
      {values.mode === 'new'
        ? t('leads.convert.summaryNew', { name: values.tradeName.trim() })
        : t('leads.convert.summaryExisting', { name: plan.existingClient?.tradeName ?? '' })}
      {values.mode === 'new' && values.isHealthcare && (
        <Badge tone="info">{t('clients.healthcare')}</Badge>
      )}
    </span>
  );
}
