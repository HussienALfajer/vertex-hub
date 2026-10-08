import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  addMonths,
  businessDate,
  type ClientResponse,
  type CreateRetainer,
  type CreateRetainerInput,
  createRetainerSchema,
  firstOfMonth,
} from '@vertex-hub/contracts';
import {
  AscentLines,
  Avatar,
  Button,
  Callout,
  cn,
  PageHeader,
  Switch,
  toast,
} from '@vertex-hub/ui';
import { ArrowRightIcon, CalendarPlusIcon, CalendarRangeIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { useMe } from '../../lib/auth';
import { SCREEN_ERROR } from '../../lib/errors';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { formatCalendarDate, formatMonth, formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { idParam } from '../../lib/search-params';
import { hasMoneyAccess } from '../projects/project-access';
import { DepartmentChips } from '../projects/project-badges';
import { useProjectClients } from '../projects/project-form';
import { MonthlyTemplateField } from '../templates/template-pickers';
import { useSetRetainerTemplate } from '../templates/templates.queries';
import { DeliverableIcon, lineName, RetainerStatusBadge } from './retainer-badges';
import {
  ClientField,
  checkDuplicateLines,
  checkRenewal,
  DatesFields,
  DeliverablesEditor,
  type DeliverablesFormMethods,
  DepartmentsField,
  MoneyFields,
  NameField,
  type RetainerFormMethods,
  retainerFormFailure,
} from './retainer-form';
import { useCreateRetainer } from './retainers.queries';
import {
  EMPTY_TERM,
  isTermProblems,
  parseTerm,
  type TermDraft,
  TermPlanEditor,
  type TermProblems,
} from './term-fields';

export interface NewRetainerSearch {
  /** Preset from the client profile's Retainers tab. */
  clientId?: string;
}

export function parseNewRetainerSearch(search: Record<string, unknown>): NewRetainerSearch {
  return {
    clientId: idParam(search.clientId),
  };
}

export function NewRetainerPage({ search }: { search: NewRetainerSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateRetainer();
  const link = useSetRetainerTemplate();
  const [templateId, setTemplateId] = useState<string | null>(null);
  // Retainers start for the same clients as projects (rule 1, the same permission).
  const clients = useProjectClients();
  const [failure, setFailure] = useState<string | null>(null);
  // F05B: an optional fixed term, a money field; kept beside the form while it is typed.
  const [term, setTerm] = useState<TermDraft | null>(null);
  const [termProblems, setTermProblems] = useState<TermProblems>({});
  const formRef = useRef<HTMLFormElement>(null);
  const form = useForm<CreateRetainerInput, unknown, CreateRetainer>({
    resolver: standardSchemaResolver(createRetainerSchema),
    // The term's fields live outside the form: the first invalid control is found on the page.
    shouldFocusError: false,
    defaultValues: {
      clientId: search.clientId ?? '',
      name: '',
      departments: [],
      startDate: businessDate(),
      renewalDate: null,
      currency: 'USD',
      monthlyFeeMinor: null,
      deliverables: [],
    },
  });
  // The lines editor also edits an existing retainer's lines; this form holds them the same way.
  const linesForm = form as unknown as DeliverablesFormMethods;
  const clientId = useWatch({ control: form.control, name: 'clientId' });
  useFocusFirstError(form.formState.submitCount, formRef);
  // The first field to fill: the client, or the name when the client profile preset it.
  const presetClient = !!search.clientId;
  useEffect(() => form.setFocus(presetClient ? 'name' : 'clientId'), [form, presetClient]);
  const client = clients.data?.items.find((item) => item.id === clientId);
  // Money fields follow the chosen client's account manager (M1).
  const money = !!client && hasMoneyAccess(me, client.accountManager.id);
  const back = search.clientId
    ? ({
        to: '/clients/$clientId',
        params: { clientId: search.clientId },
        search: { tab: 'retainers' },
      } as const)
    : ({ to: '/retainers' } as const);

  /** The term is checked with the rest of the form, also when other fields are invalid. */
  const checkTerm = () => {
    const parsed = money && term !== null ? parseTerm(term) : null;
    setTermProblems(parsed && isTermProblems(parsed) ? parsed : {});
    return parsed;
  };

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const withTerm = money && term !== null;
    // T2: a term starts in the start date's month, which is this month or later.
    if (withTerm && firstOfMonth(values.startDate) < firstOfMonth(businessDate())) {
      form.setError(
        'startDate',
        { type: SCREEN_ERROR, message: t('retainers.terms.errors.pastStart') },
        { shouldFocus: true },
      );
      return;
    }
    const renewalOk = withTerm || checkRenewal(form, t, values.startDate, values.renewalDate);
    const linesOk = checkDuplicateLines(linesForm, t, values.deliverables);
    const parsedTerm = checkTerm();
    if (!renewalOk || !linesOk || (parsedTerm && isTermProblems(parsedTerm))) return;
    // Without money access the API refuses money fields, so none are sent (M1). A term sets the
    // renewal date (T11).
    const input: CreateRetainer = money
      ? {
          ...values,
          ...(parsedTerm && { term: parsedTerm, renewalDate: undefined }),
        }
      : { ...values, currency: undefined, monthlyFeeMinor: undefined };
    try {
      const retainer = await create.mutateAsync(input);
      toast.add({ title: t('retainers.new.created'), type: 'success' });
      // The link is a second call: when it fails the retainer stays, and its page can link again.
      if (templateId) {
        await link
          .mutateAsync({ retainerId: retainer.id, templateId })
          .catch(() => toast.add({ title: t('templates.retainer.linkFailed'), type: 'error' }));
      }
      await navigate({ to: '/retainers/$retainerId', params: { retainerId: retainer.id } });
    } catch (error) {
      setFailure(retainerFormFailure(form, t, error));
    }
  }, checkTerm);

  return (
    <>
      <PageHeader
        title={t('retainers.new.title')}
        description={t('retainers.new.subtitle')}
        actions={
          <Button variant="ghost" render={<Link {...back} />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {search.clientId ? t('projects.new.backToClient') : t('retainers.new.back')}
          </Button>
        }
      />
      <form
        ref={formRef}
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
        onSubmit={submit}
        noValidate
      >
        <div className="flex min-w-0 flex-col gap-6">
          <FormSection title={t('retainers.form.identity')} hint={t('retainers.form.identityHint')}>
            <ClientField form={form} clients={clients.data?.items ?? []} />
            <NameField form={form} />
            <DepartmentsField form={form} />
          </FormSection>
          <FormSection title={t('retainers.form.term')} hint={t('retainers.form.termHint')}>
            <DatesFields form={form} renewalLocked={money && term !== null} />
            <FirstCycleNote form={form} />
            {money && <MoneyFields form={form} />}
          </FormSection>
          {money && (
            <FixedTermSection form={form} value={term} onChange={setTerm} problems={termProblems} />
          )}
          <FormSection title={t('retainers.lines.title')} hint={t('retainers.form.linesHint')}>
            <DeliverablesEditor form={linesForm} />
            <MonthlyTemplateField value={templateId} onChange={setTemplateId} />
          </FormSection>
          {failure && <FormAlert>{failure}</FormAlert>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" render={<Link {...back} />}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? t('projects.form.creating')
                : t('retainers.form.create')}
            </Button>
          </div>
        </div>
        <Preview form={form} client={client} money={money} term={money ? term : null} />
      </form>
      <UnsavedChangesGuard
        dirty={(form.formState.isDirty || term !== null) && !form.formState.isSubmitting}
      />
    </>
  );
}

/** F05B screen 1: an optional fixed term that starts in the start date's month. */
function FixedTermSection({
  form,
  value,
  onChange,
  problems,
}: {
  form: RetainerFormMethods;
  value: TermDraft | null;
  onChange: (next: TermDraft | null) => void;
  problems: TermProblems;
}) {
  const { t } = useTranslation();
  const id = useId();
  const start = useWatch({ control: form.control, name: 'startDate' });
  const currency = useWatch({ control: form.control, name: 'currency' }) ?? 'USD';
  const startMonth = start ? firstOfMonth(start) : null;
  return (
    <FormSection title={t('retainers.terms.sectionTitle')} hint={t('retainers.terms.sectionHint')}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <label htmlFor={id} className="text-sm font-medium">
            {t('retainers.terms.enable')}
          </label>
          <p id={`${id}-hint`} className="text-sm text-muted-foreground">
            {value && startMonth
              ? t('retainers.terms.startsWith', { month: formatMonth(startMonth) })
              : t('retainers.terms.enableHint')}
          </p>
        </div>
        <Switch
          id={id}
          aria-describedby={`${id}-hint`}
          checked={value !== null}
          onCheckedChange={(checked) => {
            onChange(checked ? EMPTY_TERM : null);
            if (checked) form.setValue('renewalDate', null);
          }}
        />
      </div>
      {value && (
        <TermPlanEditor
          value={value}
          onChange={onChange}
          startMonth={startMonth}
          currency={currency}
          problems={problems}
        />
      )}
    </FormSection>
  );
}

/** R3 and R4: a start date today or earlier opens this month's cycle at once, with full quantities. */
function FirstCycleNote({ form }: { form: RetainerFormMethods }) {
  const { t } = useTranslation();
  const start = useWatch({ control: form.control, name: 'startDate' });
  if (!start) return null;
  const now = start <= businessDate();
  return (
    <Callout
      icon={<CalendarPlusIcon />}
      title={now ? t('retainers.form.cycleNow') : t('retainers.form.cycleLater')}
      description={
        now
          ? t('retainers.form.cycleNowBody')
          : t('retainers.form.cycleLaterBody', { date: formatCalendarDate(start) })
      }
    />
  );
}

/** How the retainer will read once created, updated as the form is filled in. */
function Preview({
  form,
  client,
  money,
  term,
}: {
  form: RetainerFormMethods;
  client: ClientResponse | undefined;
  money: boolean;
  term: TermDraft | null;
}) {
  const { t } = useTranslation();
  const values = useWatch({ control: form.control });
  // Until a name is typed, the preview names the field rather than showing the example as a name.
  const name = values.name?.trim();
  const lines = (values.deliverables ?? []).flatMap((line) =>
    line?.kind ? [{ ...line, kind: line.kind }] : [],
  );

  return (
    <aside
      aria-label={t('retainers.new.preview')}
      className="relative flex flex-col gap-4 overflow-hidden rounded-lg border border-border bg-surface p-5 lg:sticky lg:top-24"
    >
      <AscentLines className="absolute inset-y-0 end-0 h-full w-16 text-border" />
      <p className="relative text-sm font-medium text-muted-foreground">
        {t('retainers.new.preview')}
      </p>
      <div className="relative flex items-center gap-3">
        <Avatar
          name={client?.tradeName ?? t('projects.form.client')}
          shape="square"
          size="lg"
          tone={client ? 'brand' : 'muted'}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn('truncate text-lg font-bold', !name && 'text-muted-foreground')}>
            {name || t('retainers.form.name')}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {client?.tradeName ?? t('projects.form.clientPlaceholder')}
          </p>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-1.5">
        <RetainerStatusBadge status="active" />
      </div>
      {(values.departments?.length ?? 0) > 0 && (
        <div className="relative">
          <DepartmentChips codes={(values.departments ?? []).flatMap((code) => code ?? [])} />
        </div>
      )}
      <dl className="relative flex flex-col gap-3 border-t border-border pt-4 text-sm">
        {values.startDate && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{t('retainers.form.term')}</dt>
            <dd className="flex items-center gap-2">
              <CalendarRangeIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span>
                {values.renewalDate
                  ? t('retainers.startRenewal', {
                      start: formatCalendarDate(values.startDate),
                      renewal: formatCalendarDate(values.renewalDate),
                    })
                  : t('retainers.startsOn', { date: formatCalendarDate(values.startDate) })}
              </span>
            </dd>
          </div>
        )}
        {term && values.startDate && (term.months ?? 0) > 0 && (
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">{t('retainers.terms.sectionTitle')}</dt>
            <dd className="flex flex-col gap-0.5">
              <span>
                {t('retainers.terms.range', {
                  start: formatMonth(firstOfMonth(values.startDate)),
                  end: formatMonth(
                    addMonths(firstOfMonth(values.startDate), (term.months ?? 1) - 1),
                  ),
                })}
              </span>
              <span className="text-muted-foreground">
                {term.agreedTotalMinor !== null &&
                  `${formatMoney(term.agreedTotalMinor, values.currency ?? 'USD')} · `}
                {t(`retainers.terms.endActions.${term.endAction}`)}
              </span>
            </dd>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <dt className="text-xs text-muted-foreground">{t('retainers.new.perMonth')}</dt>
          <dd>
            {lines.length === 0 ? (
              <span className="text-muted-foreground">{t('retainers.noLines')}</span>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {lines.map((line, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview rows follow the editor's order
                    key={index}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <DeliverableIcon kind={line.kind} className="text-muted-foreground" />
                      <span className="truncate">{lineName(t, line)}</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatNumber(Number(line.monthlyQuantity) || 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {money && values.monthlyFeeMinor != null && (
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs text-muted-foreground">{t('retainers.form.monthlyFee')}</dt>
            <dd className="font-bold tabular-nums">
              {formatMoney(values.monthlyFeeMinor, values.currency ?? 'USD')}
            </dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
