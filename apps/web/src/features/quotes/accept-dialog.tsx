import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type AcceptPlan,
  type AcceptQuoteInput,
  acceptQuoteSchema,
  businessDate,
  type Currency,
  type DepartmentCode,
  type QuoteDetail,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  cn,
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
  Skeleton,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { TriangleAlertIcon } from 'lucide-react';
import {
  type ComponentProps,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Controller, type FieldPath, type UseFormReturn, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { ApiError } from '../../lib/api/client';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { focusFirstInvalid } from '../../lib/focus-first-invalid';
import { formatCalendarDate, formatNumber } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import { departmentListQuery } from '../departments/departments.queries';
import { type Proof, ProofField } from '../files/proof-field';
import {
  ConversionFields,
  type ConversionProblems,
  ConversionSummary,
  type ConversionValues,
  conversionProblems,
  toConversion,
  useConversionValues,
} from '../leads/conversion-fields';
import { conversionRefusal } from '../leads/lead-dialogs';
import { DepartmentChips } from '../projects/project-badges';
import { useProjectManagerOptions } from '../projects/project-form';
import { DeliverableIcon, lineName, RetainerStatusBadge } from '../retainers/retainer-badges';
import { templateListQuery } from '../templates/templates.queries';
import { ChoiceSelect } from './choice-select';
import { Money } from './quote-badges';
import {
  type AcceptPlanFilters,
  acceptPlanQuery,
  useAcceptQuote,
  useRefreshAfterRefusal,
} from './quotes.queries';

const NONE = 'none';

type Step = 'client' | 'response' | 'project' | 'retainer' | 'summary';

/** The dialog's fields; turned into the accept request by `toRequest`. */
interface AcceptValues {
  respondedOn: string;
  contactId: string | null;
  note: string;
  project: {
    name: string;
    projectManagerId: string;
    departments: DepartmentCode[];
    startDate: string;
    dueDate: string;
    /** The ticked templates; sent in the plan's order. */
    templateIds: string[];
    /** Per installment, an index into the plan's milestones. */
    installmentMilestones: number[];
  };
  retainer: {
    mode: 'new' | 'renew';
    retainerId: string;
    name: string;
    departments: DepartmentCode[];
    startDate: string;
    /** Empty: no renewal date. */
    renewalDate: string;
    templateId: string | null;
  };
}

type AcceptForm = UseFormReturn<AcceptValues>;

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

function defaultsOf(plan: AcceptPlan, today: string): AcceptValues {
  return {
    respondedOn: today < plan.sentOn ? plan.sentOn : today,
    contactId: null,
    note: '',
    project: {
      name: plan.project?.name ?? '',
      projectManagerId: plan.project?.projectManager?.id ?? '',
      departments: plan.project?.departments ?? [],
      startDate: plan.project?.startDate ?? today,
      dueDate: plan.project?.dueDate ?? today,
      templateIds: (plan.project?.templates ?? []).filter((t) => t.selected).map((t) => t.id),
      installmentMilestones: (plan.project?.installments ?? []).map((i) => i.milestone),
    },
    retainer: {
      mode: 'new',
      retainerId: '',
      name: plan.retainer?.name ?? '',
      departments: plan.retainer?.departments ?? [],
      startDate: plan.retainer?.startDate ?? today,
      renewalDate: plan.retainer?.renewalDate ?? '',
      templateId: plan.retainer?.template?.id ?? null,
    },
  };
}

function toRequest(
  values: AcceptValues,
  plan: AcceptPlan,
  proof: Proof | null,
  conversion: ConversionValues | null,
): AcceptQuoteInput {
  const { project, retainer } = values;
  return {
    // Step 0 of a lead quote (F03 rule 11).
    conversion: plan.conversion && conversion ? toConversion(conversion) : null,
    respondedOn: values.respondedOn,
    contactId: values.contactId,
    note: values.note.trim() || null,
    proofUploadId: proof?.uploadId ?? null,
    project: plan.project && {
      name: project.name,
      projectManagerId: project.projectManagerId,
      departments: project.departments,
      startDate: project.startDate,
      dueDate: project.dueDate,
      templateIds: plan.project.templates
        .filter((template) => project.templateIds.includes(template.id))
        .map((template) => template.id),
      installmentMilestones: project.installmentMilestones,
    },
    retainer:
      plan.retainer &&
      (retainer.mode === 'renew'
        ? { mode: 'renew', retainerId: retainer.retainerId, templateId: retainer.templateId }
        : {
            mode: 'new',
            name: retainer.name,
            departments: retainer.departments,
            startDate: retainer.startDate,
            renewalDate: retainer.renewalDate || null,
            templateId: retainer.templateId,
          }),
  };
}

/** Spec screen 6: records the client's yes and runs A01 in one confirmation. */
export function AcceptDialog({
  quote,
  open,
  onClose,
  finalFocus,
}: {
  quote: QuoteDetail;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or the page heading. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus'];
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent closeLabel={t('common.close')} className="max-w-3xl" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('quotes.accept.title', { number: quote.displayNumber })}</DialogTitle>
          <DialogDescription>{t('quotes.accept.hint')}</DialogDescription>
        </DialogHeader>
        {/* Unmounted once the dialog has faded out: each acceptance starts afresh. */}
        <AcceptFlow quote={quote} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function AcceptFlow({ quote, onClose }: { quote: QuoteDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<AcceptPlanFilters>({});
  // Step 0's existing client: the plan then offers its retainers to renew (F03 rule 11).
  const [clientId, setClientId] = useState<string | undefined>();
  const plan = useQuery(acceptPlanQuery(quote.id, { ...choices, ...(clientId && { clientId }) }));
  const refresh = useRefreshAfterRefusal(quote.id);
  useEffect(() => {
    if (plan.error) refresh(plan.error);
  }, [plan.error, refresh]);
  if (plan.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (plan.isError) {
    return (
      <LoadError
        message={
          plan.error instanceof ApiError && plan.error.knownCode
            ? errorMessage(t, plan.error)
            : t('quotes.accept.loadError')
        }
        onRetry={() => plan.refetch()}
      />
    );
  }
  return (
    <AcceptSteps
      quote={quote}
      plan={plan.data}
      planning={plan.isFetching}
      onChoices={setChoices}
      onClient={setClientId}
      onClose={onClose}
    />
  );
}

function AcceptSteps({
  quote,
  plan,
  planning,
  onChoices,
  onClient,
  onClose,
}: {
  quote: QuoteDetail;
  plan: AcceptPlan;
  /** A new plan for the latest choices is on its way: milestones may still change. */
  planning: boolean;
  onChoices: (choices: AcceptPlanFilters) => void;
  onClient: (clientId: string | undefined) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accept = useAcceptQuote(quote.id);
  const today = businessDate();
  const form = useForm<AcceptValues>({ defaultValues: defaultsOf(plan, today) });
  const [proof, setProof] = useState<Proof | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [conversion, setConversion] = useConversionValues(plan.conversion);
  const [conversionIssues, setConversionIssues] = useState<ConversionProblems>({});
  const steps: Step[] = [
    ...(plan.conversion ? (['client'] as const) : []),
    'response',
    ...(plan.project ? (['project'] as const) : []),
    ...(plan.retainer ? (['retainer'] as const) : []),
    'summary',
  ];
  const [step, setStep] = useState<Step>(plan.conversion ? 'client' : 'response');
  const index = steps.indexOf(step);

  // After each move between steps the focus goes to the new step's label; after a failed check,
  // to the first field to fix.
  const container = useRef<HTMLDivElement>(null);
  const stepLabel = useRef<HTMLParagraphElement>(null);
  const focusOn = useRef<'step' | 'invalid' | null>(null);
  const [moves, setMoves] = useState(0);
  const moveFocus = (target: 'step' | 'invalid') => {
    focusOn.current = target;
    setMoves((count) => count + 1);
  };
  useEffect(() => {
    if (moves === 0) return;
    const target = focusOn.current;
    focusOn.current = null;
    if (target === 'step') stepLabel.current?.focus();
    else if (target === 'invalid') focusFirstInvalid(container.current);
  }, [moves]);

  // Dates the user typed stay; the rest follows the plan of the current choices (A2, A3, A5).
  const edited = useRef({
    dueDate: false,
    renewalDate: false,
    templates: false,
    projectManager: false,
  });
  const first = useRef(plan);
  const latestPlan = useRef(plan);
  useEffect(() => {
    if (latestPlan.current === plan) return;
    latestPlan.current = plan;
    if (plan.project) {
      if (!edited.current.dueDate) form.setValue('project.dueDate', plan.project.dueDate);
      form.setValue(
        'project.installmentMilestones',
        plan.project.installments.map((installment) => installment.milestone),
      );
    }
    if (plan.retainer && !edited.current.renewalDate) {
      form.setValue('retainer.renewalDate', plan.retainer.renewalDate ?? '');
    }
  }, [plan, form]);

  const [projectStart, templateIds, retainerStart] = useWatch({
    control: form.control,
    name: ['project.startDate', 'project.templateIds', 'retainer.startDate'],
  });
  const choiceKey = JSON.stringify([projectStart, templateIds, retainerStart]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the watched values
  useEffect(() => {
    onChoices({
      // The first plan already answers its own defaults: only changes are sent.
      ...(isDate(projectStart) &&
        projectStart !== first.current.project?.startDate && { projectStartDate: projectStart }),
      ...(edited.current.templates && { chooseTemplates: 'true', templateIds }),
      ...(isDate(retainerStart) &&
        retainerStart !== first.current.retainer?.startDate && {
          retainerStartDate: retainerStart,
        }),
    });
  }, [choiceKey, onChoices]);

  /** Puts the step's problems on its fields; true when it may be left forward. */
  function check(current: Step): boolean {
    if (current === 'client') {
      const found = conversion ? conversionProblems(conversion) : {};
      setConversionIssues(found);
      return Object.keys(found).length === 0;
    }
    form.clearErrors();
    const values = form.getValues();
    const problems: [FieldPath<AcceptValues>, string | undefined][] = [];
    const parsed = acceptQuoteSchema.safeParse(toRequest(values, plan, proof, conversion));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [first, second] = issue.path;
        if (first === 'conversion') continue;
        const section = first === 'project' || first === 'retainer' ? first : 'response';
        if (section !== current) continue;
        const path = (section === 'response' ? first : `${String(first)}.${String(second)}`) as
          | FieldPath<AcceptValues>
          | undefined;
        if (path) problems.push([path, undefined]);
      }
    }
    if (current === 'response') {
      if (values.respondedOn < plan.sentOn || values.respondedOn > today) {
        problems.push(['respondedOn', undefined]);
      }
      if (proof && !proof.uploadId) problems.push(['respondedOn', 'proof']);
    }
    if (current === 'project' && plan.project) {
      if (isDate(values.project.startDate) && values.project.dueDate < values.project.startDate) {
        problems.push(['project.dueDate', t('quotes.accept.errors.dueAfterStart')]);
      }
      const count = plan.project.milestones.length;
      if (values.project.installmentMilestones.some((milestone) => milestone >= count)) {
        problems.push(['project.installmentMilestones', undefined]);
      }
    }
    if (current === 'retainer' && values.retainer.mode === 'new') {
      const { startDate, renewalDate } = values.retainer;
      if (renewalDate && renewalDate <= startDate) {
        problems.push(['retainer.renewalDate', t('retainers.form.errors.renewalAfterStart')]);
      }
    }
    let proofPending = false;
    for (const [path, message] of problems) {
      if (message === 'proof') {
        proofPending = true;
        continue;
      }
      form.setError(path, { type: message ? SCREEN_ERROR : 'invalid', message: message ?? '' });
    }
    setFailure(proofPending ? t('quotes.accept.proof.waiting') : null);
    return problems.length === 0;
  }

  function next() {
    if (!check(step)) {
      moveFocus('invalid');
      return;
    }
    // A2: the project manager defaults to the account manager of the client step 0 creates or
    // links, until the user picks one.
    if (step === 'client' && conversion && !edited.current.projectManager) {
      const manager =
        conversion.mode === 'new'
          ? conversion.accountManagerId
          : plan.conversion?.existingClient?.accountManager.id;
      if (manager) form.setValue('project.projectManagerId', manager);
    }
    setStep(steps[index + 1] ?? 'summary');
    moveFocus('step');
  }

  function back() {
    form.clearErrors();
    setFailure(null);
    setStep(steps[index - 1] ?? steps[0] ?? 'response');
    moveFocus('step');
  }

  async function submit() {
    setFailure(null);
    const parsed = acceptQuoteSchema.safeParse(
      toRequest(form.getValues(), plan, proof, conversion),
    );
    if (!parsed.success) {
      setFailure(t('quotes.accept.errors.review'));
      return;
    }
    try {
      const accepted = await accept.mutateAsync(parsed.data);
      toast.add({ title: t('quotes.accept.done'), type: 'success' });
      onClose();
      if (accepted.project) {
        await navigate({ to: '/projects/$projectId', params: { projectId: accepted.project.id } });
      } else if (accepted.retainer) {
        await navigate({
          to: '/retainers/$retainerId',
          params: { retainerId: accepted.retainer.id },
        });
      }
    } catch (error) {
      // A9: nothing was created, the client neither; every input stays for another try.
      const field = plan.conversion ? conversionRefusal(t, error) : null;
      if (field) {
        setConversionIssues(field);
        setStep('client');
        moveFocus('invalid');
        return;
      }
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <div ref={container} className="grid gap-5">
      <Stepper steps={steps} current={step} label={stepLabel} />
      {step === 'client' && plan.conversion && conversion && (
        <ConversionFields
          plan={plan.conversion}
          values={conversion}
          onChange={(next) => {
            setConversion(next);
            setConversionIssues({});
          }}
          problems={conversionIssues}
          onClient={onClient}
        />
      )}
      {step === 'response' && (
        <ResponseStep quote={quote} plan={plan} form={form} proof={proof} onProof={setProof} />
      )}
      {step === 'project' && plan.project && (
        <ProjectStep
          plan={plan}
          project={plan.project}
          currency={quote.currency}
          form={form}
          onEdited={(field) => {
            edited.current[field] = true;
          }}
        />
      )}
      {step === 'retainer' && plan.retainer && (
        <RetainerStep
          retainer={plan.retainer}
          form={form}
          onRenewalEdited={() => {
            edited.current.renewalDate = true;
          }}
        />
      )}
      {step === 'summary' && (
        <Summary plan={plan} form={form} proof={proof} conversion={conversion} />
      )}
      {planning && step !== 'response' && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('quotes.accept.planning')}
        </p>
      )}
      {failure && <FormAlert>{failure}</FormAlert>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" type="button" />}>
          {t('common.cancel')}
        </DialogClose>
        {index > 0 && (
          <Button variant="outline" type="button" onClick={back}>
            {t('common.previous')}
          </Button>
        )}
        {step === 'summary' ? (
          <Button type="button" disabled={accept.isPending || planning} onClick={submit}>
            {accept.isPending ? t('quotes.accept.submitting') : t('quotes.accept.submit')}
          </Button>
        ) : (
          <Button type="button" disabled={planning && step !== 'response'} onClick={next}>
            {t('common.next')}
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

/** The steps drawn as rising bars, like the strokes of the mark (as in two-factor setup). */
function Stepper({
  steps,
  current,
  label,
}: {
  steps: Step[];
  current: Step;
  label: RefObject<HTMLParagraphElement | null>;
}) {
  const { t } = useTranslation();
  const index = steps.indexOf(current);
  const heights = ['h-1.5', 'h-2', 'h-2.5', 'h-3'];
  return (
    <div className="flex flex-col gap-2">
      <p ref={label} tabIndex={-1} className="text-sm text-muted-foreground outline-none">
        {t('quotes.accept.stepOf', {
          step: formatNumber(index + 1),
          total: formatNumber(steps.length),
        })}
        {' · '}
        <span className="font-medium text-foreground">{t(`quotes.accept.steps.${current}`)}</span>
      </p>
      <ol className="flex items-end gap-1.5" aria-hidden="true">
        {steps.map((step, position) => (
          <li
            key={step}
            className={cn(
              'flex-1 rounded-sm transition-colors duration-250 ease-out',
              heights[position],
              position <= index ? 'bg-accent' : 'bg-muted',
            )}
          />
        ))}
      </ol>
    </div>
  );
}

function ResponseStep({
  quote,
  plan,
  form,
  proof,
  onProof,
}: {
  quote: QuoteDetail;
  plan: AcceptPlan;
  form: AcceptForm;
  proof: Proof | null;
  onProof: (proof: Proof | null) => void;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), date: useId(), note: useId() };
  const client = useQuery({ ...clientQuery(quote.client?.id ?? ''), enabled: !!quote.client });
  const { errors } = form.formState;
  const contactItems = [
    { value: NONE, label: t('quotes.form.noContact') },
    ...(client.data?.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  return (
    <div className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.respondedOn}>
          <FieldLabel htmlFor={ids.date}>{t('quotes.response.respondedOn')}</FieldLabel>
          <Input
            id={ids.date}
            type="date"
            dir="ltr"
            min={plan.sentOn}
            max={businessDate()}
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
      <Field invalid={!!errors.note}>
        <FieldLabel htmlFor={ids.note}>{t('quotes.response.note')}</FieldLabel>
        <Textarea id={ids.note} rows={3} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('quotes.accept.errors.note')}</FieldError>
      </Field>
      <ProofField
        proof={proof}
        onProof={onProof}
        label={t('quotes.accept.proof.label')}
        hint={t('quotes.accept.proof.hint')}
      />
    </div>
  );
}

function DepartmentsPicker({
  value,
  onChange,
  invalid,
}: {
  value: DepartmentCode[];
  onChange: (codes: DepartmentCode[]) => void;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const departments = useQuery(departmentListQuery);
  const items = (departments.data?.items ?? []).map(({ code, name }) => ({ code, name }));
  const byCode = new Map(items.map((item) => [item.code, item]));
  return (
    <Field invalid={invalid}>
      <FieldLabel htmlFor={id}>{t('projects.form.departments')}</FieldLabel>
      <MultiCombobox
        id={id}
        items={items}
        value={value.flatMap((code) => byCode.get(code) ?? [])}
        onValueChange={(next) => onChange(next.map((item) => item.code))}
        itemToLabel={(item) => item.name}
        itemToKey={(item) => item.code}
        placeholder={t('projects.form.departmentsPlaceholder')}
        emptyLabel={t('common.noMatches')}
        removeLabel={(label) => t('common.remove', { label })}
        invalid={invalid}
      />
      <FieldError match={invalid}>{t('projects.form.errors.departments')}</FieldError>
    </Field>
  );
}

function ProjectStep({
  plan,
  project,
  currency,
  form,
  onEdited,
}: {
  plan: AcceptPlan;
  currency: Currency;
  project: NonNullable<AcceptPlan['project']>;
  form: AcceptForm;
  onEdited: (field: 'dueDate' | 'templates' | 'projectManager') => void;
}) {
  const { t } = useTranslation();
  const ids = {
    name: useId(),
    manager: useId(),
    start: useId(),
    due: useId(),
    template: useId(),
  };
  const errors = form.formState.errors.project;
  const managers = useProjectManagerOptions(
    project.projectManager ? { ...project.projectManager, archived: false } : undefined,
  ).map((option) => ({ value: option.id, label: option.name }));
  const choices = useWatch({ control: form.control, name: 'project.installmentMilestones' });
  const milestoneItems = project.milestones.map((milestone, position) => ({
    value: String(position),
    label: milestone.name,
  }));

  return (
    <div className="grid gap-6">
      <section className="grid gap-5">
        <Field invalid={!!errors?.name}>
          <FieldLabel htmlFor={ids.name}>{t('projects.form.name')}</FieldLabel>
          <Input id={ids.name} autoComplete="off" {...form.register('project.name')} />
          <FieldError match={!!errors?.name}>{t('projects.form.errors.name')}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="project.projectManagerId"
          render={({ field }) => (
            <Field invalid={!!errors?.projectManagerId}>
              <FieldLabel id={ids.manager} render={<span />}>
                {t('projects.form.projectManager')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.manager}
                items={managers}
                value={field.value || null}
                placeholder={t('projects.form.projectManagerPlaceholder')}
                onChange={(next) => {
                  onEdited('projectManager');
                  field.onChange(next);
                }}
              />
              <FieldError match={!!errors?.projectManagerId}>
                {t('projects.form.errors.projectManager')}
              </FieldError>
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="project.departments"
          render={({ field }) => (
            <DepartmentsPicker
              value={field.value}
              onChange={field.onChange}
              invalid={!!errors?.departments}
            />
          )}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field invalid={!!errors?.startDate}>
            <FieldLabel htmlFor={ids.start}>{t('projects.form.startDate')}</FieldLabel>
            <Input id={ids.start} type="date" dir="ltr" {...form.register('project.startDate')} />
            <FieldError match={!!errors?.startDate}>{t('projects.form.errors.date')}</FieldError>
          </Field>
          <Field invalid={!!errors?.dueDate}>
            <FieldLabel htmlFor={ids.due}>{t('projects.form.dueDate')}</FieldLabel>
            <Input
              id={ids.due}
              type="date"
              dir="ltr"
              {...form.register('project.dueDate', { onChange: () => onEdited('dueDate') })}
            />
            <FieldDescription>{t('quotes.accept.project.dueHint')}</FieldDescription>
            <FieldError match={!!errors?.dueDate}>
              {fieldError(errors?.dueDate, t('projects.form.errors.date'))}
            </FieldError>
          </Field>
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">{t('quotes.accept.project.templates')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('quotes.accept.project.templatesHint')}
          </p>
        </div>
        <ArchivedTemplates plan={plan} />
        {project.templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('quotes.accept.project.noTemplates')}</p>
        ) : (
          <Controller
            control={form.control}
            name="project.templateIds"
            render={({ field }) => (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {project.templates.map((template) => {
                  const checked = field.value.includes(template.id);
                  const id = `${ids.template}-${template.id}`;
                  return (
                    <li key={template.id}>
                      <label
                        htmlFor={id}
                        className="flex cursor-pointer items-center gap-3 px-4 py-3"
                      >
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(next) => {
                            onEdited('templates');
                            field.onChange(
                              next
                                ? [...field.value, template.id]
                                : field.value.filter((id) => id !== template.id),
                            );
                          }}
                        />
                        <span className="flex-1 font-medium">{template.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {t('quotes.accept.revisionRounds', {
                            n: formatNumber(template.revisionLimit),
                          })}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          />
        )}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-bold">{t('quotes.accept.project.milestones')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('quotes.accept.project.milestonesHint')}
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {project.milestones.map((milestone, position) => {
            const amount = project.installments.reduce(
              (sum, installment, at) =>
                choices[at] === position ? sum + installment.amountMinor : sum,
              0,
            );
            return (
              // Milestones are de-duplicated by name (A3).
              <li key={milestone.name} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1 font-medium">{milestone.name}</span>
                {milestone.dueDate && (
                  <span className="text-sm text-muted-foreground">
                    {formatCalendarDate(milestone.dueDate)}
                  </span>
                )}
                {amount > 0 ? (
                  <Money minor={amount} currency={currency} />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t('quotes.accept.project.noInstallment')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {project.installments.length > 0 && (
          <div className="grid gap-2">
            <h4 className="text-sm font-bold">{t('quotes.installments.title')}</h4>
            <ul className="flex flex-col gap-2">
              {project.installments.map((installment, at) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: the plan's installments never reorder
                  key={at}
                  className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_14rem]"
                >
                  <span className="font-medium">
                    {installment.name}
                    <span className="ms-2 text-sm text-muted-foreground tabular-nums">
                      {formatNumber(installment.percent / 100, { style: 'percent' })}
                    </span>
                  </span>
                  <Money minor={installment.amountMinor} currency={currency} />
                  <Controller
                    control={form.control}
                    name={`project.installmentMilestones.${at}`}
                    render={({ field }) => (
                      <ChoiceSelect
                        label={t('quotes.accept.project.milestoneOf', { name: installment.name })}
                        items={milestoneItems}
                        value={String(field.value)}
                        onChange={(next) => field.onChange(Number(next))}
                      />
                    )}
                  />
                </li>
              ))}
            </ul>
            {errors?.installmentMilestones && (
              <p role="alert" className="text-sm text-destructive-text">
                {t('quotes.accept.errors.milestone')}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ArchivedTemplates({ plan }: { plan: AcceptPlan }) {
  const { t } = useTranslation();
  if (plan.archivedTemplates.length === 0) return null;
  return (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('quotes.accept.archivedTemplates')}
      description={plan.archivedTemplates.map((template) => template.name).join('، ')}
    />
  );
}

function RetainerStep({
  retainer,
  form,
  onRenewalEdited,
}: {
  retainer: NonNullable<AcceptPlan['retainer']>;
  form: AcceptForm;
  onRenewalEdited: () => void;
}) {
  const { t } = useTranslation();
  const ids = {
    mode: useId(),
    retainer: useId(),
    name: useId(),
    start: useId(),
    renewal: useId(),
    template: useId(),
  };
  const errors = form.formState.errors.retainer;
  const mode = useWatch({ control: form.control, name: 'retainer.mode' });
  const templates = useQuery(templateListQuery({ kind: 'retainer_cycle', pageSize: 100 }));
  const templateItems = [
    {
      value: NONE,
      label:
        mode === 'renew' ? t('quotes.accept.retainer.keepTemplate') : t('templates.picker.none'),
    },
    ...(retainer.template ? [{ value: retainer.template.id, label: retainer.template.name }] : []),
    ...(templates.data?.items ?? [])
      .filter((template) => template.id !== retainer.template?.id)
      .map((template) => ({ value: template.id, label: template.name })),
  ];
  const renewItems = retainer.renewable.map((item) => ({ value: item.id, label: item.name }));

  return (
    <div className="grid gap-6">
      <Controller
        control={form.control}
        name="retainer.mode"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.mode} render={<span />}>
              {t('quotes.accept.retainer.mode')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.mode}
              value={[field.value]}
              onValueChange={(next: ('new' | 'renew')[]) => {
                if (next[0]) field.onChange(next[0]);
              }}
            >
              <ToggleGroupItem value="new">{t('quotes.accept.retainer.modes.new')}</ToggleGroupItem>
              <ToggleGroupItem value="renew" disabled={retainer.renewable.length === 0}>
                {t('quotes.accept.retainer.modes.renew')}
              </ToggleGroupItem>
            </ToggleGroup>
            {retainer.renewable.length === 0 && (
              <FieldDescription>{t('quotes.accept.retainer.noRenewable')}</FieldDescription>
            )}
          </Field>
        )}
      />

      {mode === 'renew' ? (
        <section className="grid gap-5">
          <Controller
            control={form.control}
            name="retainer.retainerId"
            render={({ field }) => (
              <Field invalid={!!errors?.retainerId}>
                <FieldLabel id={ids.retainer} render={<span />}>
                  {t('quotes.accept.retainer.renewed')}
                </FieldLabel>
                <ChoiceSelect
                  labelledBy={ids.retainer}
                  items={renewItems}
                  value={field.value || null}
                  placeholder={t('quotes.accept.retainer.pickRetainer')}
                  onChange={field.onChange}
                />
                {field.value && (
                  <span>
                    <RetainerStatusBadge
                      status={
                        retainer.renewable.find((item) => item.id === field.value)?.status ??
                        'active'
                      }
                    />
                  </span>
                )}
                <FieldError match={!!errors?.retainerId}>
                  {t('quotes.accept.errors.retainer')}
                </FieldError>
              </Field>
            )}
          />
          <Callout
            title={t('quotes.accept.retainer.renewTitle')}
            description={t('quotes.accept.retainer.renewBody')}
          />
        </section>
      ) : (
        <section className="grid gap-5">
          <Field invalid={!!errors?.name}>
            <FieldLabel htmlFor={ids.name}>{t('retainers.form.name')}</FieldLabel>
            <Input id={ids.name} autoComplete="off" {...form.register('retainer.name')} />
            <FieldError match={!!errors?.name}>{t('projects.form.errors.name')}</FieldError>
          </Field>
          <Controller
            control={form.control}
            name="retainer.departments"
            render={({ field }) => (
              <DepartmentsPicker
                value={field.value}
                onChange={field.onChange}
                invalid={!!errors?.departments}
              />
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field invalid={!!errors?.startDate}>
              <FieldLabel htmlFor={ids.start}>{t('retainers.form.startDate')}</FieldLabel>
              <Input
                id={ids.start}
                type="date"
                dir="ltr"
                {...form.register('retainer.startDate')}
              />
              <FieldDescription>{t('quotes.accept.retainer.startHint')}</FieldDescription>
              <FieldError match={!!errors?.startDate}>{t('projects.form.errors.date')}</FieldError>
            </Field>
            <Field invalid={!!errors?.renewalDate}>
              <FieldLabel htmlFor={ids.renewal}>{t('retainers.form.renewalDate')}</FieldLabel>
              <Input
                id={ids.renewal}
                type="date"
                dir="ltr"
                {...form.register('retainer.renewalDate', { onChange: onRenewalEdited })}
              />
              <FieldDescription>{t('retainers.form.renewalHint')}</FieldDescription>
              <FieldError match={!!errors?.renewalDate}>
                {fieldError(errors?.renewalDate, t('projects.form.errors.date'))}
              </FieldError>
            </Field>
          </div>
        </section>
      )}

      <Controller
        control={form.control}
        name="retainer.templateId"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.template} render={<span />}>
              {t('quotes.accept.retainer.template')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={ids.template}
              items={templateItems}
              value={field.value ?? NONE}
              onChange={(next) => field.onChange(next === NONE ? null : next)}
            />
          </Field>
        )}
      />

      <section className="grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-bold">{t('retainers.lines.title')}</h3>
          <span className="text-sm">
            <span className="text-muted-foreground">{t('retainers.form.monthlyFee')} </span>
            <Money
              minor={retainer.monthlyFeeMinor}
              currency={retainer.currency}
              className="font-bold"
            />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{t('quotes.accept.retainer.linesHint')}</p>
        <DeliverableLines lines={retainer.lines} />
      </section>
    </div>
  );
}

function DeliverableLines({ lines }: { lines: NonNullable<AcceptPlan['retainer']>['lines'] }) {
  const { t } = useTranslation();
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('quotes.accept.retainer.noLines')}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {lines.map((line) => (
        <li key={`${line.kind}-${line.label ?? ''}`} className="flex items-center gap-3 px-4 py-2">
          <DeliverableIcon kind={line.kind} />
          <span className="flex-1 font-medium">{lineName(t, line)}</span>
          <span className="tabular-nums">
            {t('quotes.accept.retainer.perMonth', { n: formatNumber(line.monthlyQuantity) })}
          </span>
          <Badge tone="neutral">
            {t('quotes.accept.revisionRounds', { n: formatNumber(line.revisionLimit) })}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="font-bold">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Summary({
  plan,
  form,
  proof,
  conversion,
}: {
  plan: AcceptPlan;
  form: AcceptForm;
  proof: Proof | null;
  conversion: ConversionValues | null;
}) {
  const { t } = useTranslation();
  const values = form.getValues();
  const managers = useProjectManagerOptions();
  const managerName =
    managers.find((option) => option.id === values.project.projectManagerId)?.name ??
    plan.project?.projectManager?.name;
  const templates = plan.project?.templates.filter((template) =>
    values.project.templateIds.includes(template.id),
  );
  const renewed = plan.retainer?.renewable.find((item) => item.id === values.retainer.retainerId);
  // The retainer step loaded the monthly templates; the plan's default is among the choices too.
  const monthlyTemplates = useQuery(templateListQuery({ kind: 'retainer_cycle', pageSize: 100 }));
  const retainerTemplate =
    values.retainer.templateId === null
      ? null
      : ([
          ...(plan.retainer?.template ? [plan.retainer.template] : []),
          ...(monthlyTemplates.data?.items ?? []),
        ].find((template) => template.id === values.retainer.templateId)?.name ?? null);

  return (
    <div className="grid gap-4">
      {plan.conversion && conversion && (
        <SummaryBlock title={t('quotes.accept.steps.client')}>
          <Fact label={t('quotes.accept.summary.client')}>
            <ConversionSummary plan={plan.conversion} values={conversion} />
          </Fact>
        </SummaryBlock>
      )}
      <SummaryBlock title={t('quotes.accept.steps.response')}>
        <Fact label={t('quotes.response.respondedOn')}>
          {formatCalendarDate(values.respondedOn)}
        </Fact>
        {values.note.trim() && (
          <Fact label={t('quotes.accept.summary.note')}>{values.note.trim()}</Fact>
        )}
        {proof && <Fact label={t('quotes.accept.summary.proof')}>{proof.file.name}</Fact>}
      </SummaryBlock>
      {plan.project && (
        <SummaryBlock title={t('quotes.accept.summary.project', { name: values.project.name })}>
          <Fact label={t('projects.form.projectManager')}>{managerName}</Fact>
          <Fact label={t('projects.form.departments')}>
            <DepartmentChips codes={values.project.departments} />
          </Fact>
          <Fact label={t('projects.form.schedule')}>
            {t('quotes.accept.summary.dates', {
              start: formatCalendarDate(values.project.startDate),
              end: formatCalendarDate(values.project.dueDate),
            })}
          </Fact>
          <Fact label={t('quotes.accept.project.templates')}>
            {templates && templates.length > 0
              ? templates.map((template) => template.name).join('، ')
              : t('quotes.accept.summary.noTemplates')}
          </Fact>
          <Fact label={t('quotes.accept.project.milestones')}>
            {plan.project.milestones.map((milestone) => milestone.name).join('، ')}
          </Fact>
        </SummaryBlock>
      )}
      {plan.retainer && (
        <SummaryBlock
          title={
            values.retainer.mode === 'renew'
              ? t('quotes.accept.summary.renew', { name: renewed?.name ?? '' })
              : t('quotes.accept.summary.retainer', { name: values.retainer.name })
          }
        >
          {values.retainer.mode === 'new' && (
            <>
              <Fact label={t('projects.form.departments')}>
                <DepartmentChips codes={values.retainer.departments} />
              </Fact>
              <Fact label={t('retainers.form.startDate')}>
                {formatCalendarDate(values.retainer.startDate)}
              </Fact>
              <Fact label={t('retainers.form.renewalDate')}>
                {values.retainer.renewalDate
                  ? formatCalendarDate(values.retainer.renewalDate)
                  : t('common.none')}
              </Fact>
            </>
          )}
          <Fact label={t('retainers.form.monthlyFee')}>
            <Money minor={plan.retainer.monthlyFeeMinor} currency={plan.retainer.currency} />
          </Fact>
          <Fact label={t('retainers.lines.title')}>
            {plan.retainer.lines.length > 0
              ? plan.retainer.lines
                  .map((line) =>
                    t('catalog.packages.item', {
                      n: formatNumber(line.monthlyQuantity),
                      name: lineName(t, line),
                    }),
                  )
                  .join(' · ')
              : t('quotes.accept.retainer.noLines')}
          </Fact>
          <Fact label={t('quotes.accept.retainer.template')}>
            {retainerTemplate ??
              (values.retainer.mode === 'renew'
                ? t('quotes.accept.retainer.keepTemplate')
                : t('templates.picker.none'))}
          </Fact>
        </SummaryBlock>
      )}
    </div>
  );
}
