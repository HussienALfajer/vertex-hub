import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  type CatalogPackage,
  type CatalogService,
  CURRENCIES,
  type Currency,
  needsDiscountApproval,
  QUOTE_LIMITS,
  type QuoteDetail,
  type QuoteSection,
  type QuoteTotals,
  quoteDraftSchema,
  quoteTotals,
  TASK_LIMITS,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  CircleCheckIcon,
  PlusIcon,
  SendIcon,
  StampIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Controller,
  type FieldErrors,
  get,
  type Resolver,
  type UseFieldArrayReturn,
  type UseFormReturn,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { LoadError } from '../../components/load-error';
import { MoneyInput } from '../../components/money-input';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { focusAfterRemoval } from '../../lib/focus-after-removal';
import { useFocusFirstError } from '../../lib/focus-first-invalid';
import { formatDateTime, formatNumber, isolateLtr } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { useReturnFocus } from '../../lib/use-return-focus';
import { packageListQuery, serviceListQuery } from '../catalog/catalog.queries';
import { clientQuery } from '../clients/clients.queries';
import { ChoiceSelect } from './choice-select';
import { formatBasisPoints, Money } from './quote-badges';
import { ReturnApprovalDialog } from './quote-dialogs';
import {
  type BuilderLine,
  type BuilderValues,
  builderValues,
  draftInput,
  packageLine,
  repriced,
  serviceLine,
} from './quote-draft';
import { DraftPreview } from './quote-pdf';
import {
  quotesKeys,
  useArchiveQuote,
  useDecideApproval,
  useQuoteApproval,
  useSaveDraft,
} from './quotes.queries';

type BuilderForm = UseFormReturn<BuilderValues>;

type LinesArray = UseFieldArrayReturn<BuilderValues, 'lines', 'key'>;

const NONE = 'none';

/**
 * The contract over the draft the API saves. Its paths are the form's, so every problem shows on
 * its field at once and the focus goes to the first.
 */
function draftResolver(updatedAt: string): Resolver<BuilderValues> {
  const schema = standardSchemaResolver(quoteDraftSchema);
  return async (values, context, options) => {
    const result = await schema(
      draftInput(values, updatedAt),
      context,
      options as unknown as Parameters<typeof schema>[2],
    );
    return Object.keys(result.errors).length > 0
      ? { values: {}, errors: result.errors as FieldErrors<BuilderValues> }
      : { values, errors: {} };
  };
}

/**
 * Spec screen 4: a draft as one document, saved whole. Holds the stored version the form started
 * from: a refetch never restarts the form under unsaved work; the builder offers the newer
 * version instead (edge case 1).
 */
export function QuoteBuilder({
  quote,
  heading,
  onSend,
}: {
  quote: QuoteDetail;
  /** Where the focus goes when the control that held it leaves the page. */
  heading: RefObject<HTMLHeadingElement | null>;
  /** Opens the send confirmation, which outlives the builder. */
  onSend: (opener: HTMLElement) => void;
}) {
  const [base, setBase] = useState(quote);
  // "Discard changes" starts the form again from the same version, local state included.
  const [discards, setDiscards] = useState(0);
  // Every saved change starts the form again: the `data-focus` of the control that then takes the
  // focus, the one that started the change or the one that replaced it.
  const focus = useRef<string | null>(null);
  const focusAfter = (name: string | null) => {
    focus.current = name;
  };
  const [returning, setReturning] = useState(false);
  const returnFocus = useReturnFocus(heading);
  if (base.archivedAt !== quote.archivedAt || base.discountApproval !== quote.discountApproval) {
    setBase(quote);
  }
  return (
    <>
      <Builder
        key={`${base.updatedAt}:${discards}`}
        base={base}
        quote={quote}
        onLoad={setBase}
        onSaved={(version) => {
          focusAfter('save');
          setBase(version);
        }}
        onDiscard={() => {
          focusAfter('discard');
          setDiscards((count) => count + 1);
        }}
        focus={focus}
        focusAfter={focusAfter}
        heading={heading}
        onSend={onSend}
        onReturn={(opener) => {
          returnFocus.from(opener);
          setReturning(true);
        }}
      />
      {/* Out of the form, which starts again once the discount is returned. */}
      <ReturnApprovalDialog
        quote={quote}
        open={returning}
        onClose={() => setReturning(false)}
        finalFocus={returnFocus.target}
      />
    </>
  );
}

/** What the builder's parts take to move the focus once the form starts again. */
type FocusAfter = (name: string | null) => void;

function Builder({
  base,
  quote,
  onLoad,
  onSaved,
  onDiscard,
  focus,
  focusAfter,
  heading,
  onSend,
  onReturn,
}: {
  /** The version the form started from. */
  base: QuoteDetail;
  /** The latest stored version. */
  quote: QuoteDetail;
  onLoad: (version: QuoteDetail) => void;
  onSaved: (version: QuoteDetail) => void;
  onDiscard: () => void;
  /** The `data-focus` of the control to focus as this form starts. */
  focus: RefObject<string | null>;
  focusAfter: FocusAfter;
  heading: RefObject<HTMLHeadingElement | null>;
  onSend: (opener: HTMLElement) => void;
  onReturn: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const readOnly = !quote.permissions.canEdit;
  const form = useForm<BuilderValues>({
    defaultValues: builderValues(base),
    resolver: draftResolver(base.updatedAt),
    shouldFocusError: false,
  });
  useEffect(() => {
    const name = focus.current;
    focus.current = null;
    if (!name) return;
    (document.querySelector<HTMLElement>(`[data-focus="${name}"]`) ?? heading.current)?.focus();
  }, [focus, heading]);
  const lines = useFieldArray({ control: form.control, name: 'lines', keyName: 'key' });
  const save = useSaveDraft(quote.id);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { isDirty: dirty, isSubmitting, submitCount } = form.formState;
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(submitCount, formRef);
  const newer = quote.updatedAt > base.updatedAt;

  // Nothing to lose: take the newer version at once.
  useEffect(() => {
    if (newer && !dirty && !isSubmitting) onLoad(quote);
  }, [newer, dirty, isSubmitting, onLoad, quote]);

  const values = form.watch();
  const totals = quoteTotals({
    lines: values.lines,
    oneOffDiscountMinor: values.oneOffDiscountMinor,
    monthlyDiscountMinor: values.monthlyDiscountMinor,
    installments: values.installments,
    monthlyTermMonths: values.monthlyTermMonths,
  });
  const needsApproval = needsDiscountApproval(totals, quote.discountThresholdPercent);

  const submit = form.handleSubmit(async (current) => {
    setFailure(null);
    try {
      const stored = await save.mutateAsync(
        quoteDraftSchema.parse(draftInput(current, base.updatedAt)),
      );
      toast.add({ title: t('quotes.builder.saved'), type: 'success' });
      // Nothing changed (text that only differed by spaces): the same version, so no new form.
      if (stored.updatedAt === base.updatedAt) form.reset(builderValues(stored));
      else onSaved(stored);
    } catch (error) {
      setFailure(errorMessage(t, error));
      // Another save came first: fetch it, so the builder offers it.
      if (error instanceof ApiError && error.knownCode === 'STALE_QUOTE') {
        await queryClient.invalidateQueries({ queryKey: quotesKeys.detail(quote.id) });
      }
    }
  });

  return (
    <>
      <BuilderNotices
        quote={quote}
        needsApproval={needsApproval}
        dirty={dirty}
        focusAfter={focusAfter}
        onReturn={onReturn}
      />

      {newer && dirty && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('quotes.builder.changedTitle')}
          description={t('quotes.builder.changedBody', { when: formatDateTime(quote.updatedAt) })}
          action={
            <Button variant="outline" size="sm" onClick={() => onLoad(quote)}>
              {t('quotes.builder.loadLatest')}
            </Button>
          }
        />
      )}

      {!quote.archivedAt && (
        <DraftActions
          quote={quote}
          dirty={dirty}
          needsApproval={needsApproval}
          focusAfter={focusAfter}
          onSend={onSend}
        />
      )}
      {!quote.archivedAt && <DraftPreview quote={quote} saved={!dirty} />}

      <form ref={formRef} className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
          <legend className="sr-only">{t('quotes.builder.legend')}</legend>
          <BasicsSection form={form} quote={quote} lines={lines} />
          <LinesSection
            section="one_off"
            form={form}
            quote={quote}
            lines={lines}
            totals={totals}
            readOnly={readOnly}
          />
          <LinesSection
            section="monthly"
            form={form}
            quote={quote}
            lines={lines}
            totals={totals}
            readOnly={readOnly}
          />
          <NotesSection form={form} />
        </fieldset>
        {!readOnly && (
          <>
            {failure && <FormAlert>{failure}</FormAlert>}
            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 md:-mx-8 md:px-8">
              {dirty && (
                <p className="me-auto text-sm text-muted-foreground">
                  {quote.discountApproval === 'approved'
                    ? t('quotes.builder.unsavedApproved')
                    : t('quotes.builder.unsaved')}
                </p>
              )}
              <Button
                data-focus="discard"
                variant="outline"
                disabled={!dirty || isSubmitting}
                focusableWhenDisabled
                onClick={() => setConfirmDiscard(true)}
              >
                {t('quotes.builder.discardChanges')}
              </Button>
              <Button
                data-focus="save"
                type="submit"
                disabled={!dirty || isSubmitting}
                focusableWhenDisabled
              >
                {isSubmitting ? t('common.saving') : t('quotes.builder.save')}
              </Button>
            </div>
          </>
        )}
      </form>

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title={t('common.unsaved.title')}
        body={t('quotes.builder.discardChangesBody')}
        action={t('common.unsaved.discard')}
        destructive
        pending={false}
        onConfirm={async () => onDiscard()}
      />
      <UnsavedChangesGuard dirty={dirty && !isSubmitting} />
    </>
  );
}

/** Printed as they are; checked for length only. */
function NotesSection({ form }: { form: BuilderForm }) {
  const { t } = useTranslation();
  const { errors } = form.formState;
  return (
    <FormSection title={t('quotes.builder.notes')} hint={t('quotes.builder.notesHint')}>
      <Field invalid={!!errors.clientNotes}>
        <FieldLabel>{t('quotes.builder.clientNotes')}</FieldLabel>
        <Textarea rows={3} {...form.register('clientNotes')} />
        <FieldError match={!!errors.clientNotes}>
          {t('quotes.builder.errors.text', { max: formatNumber(2000) })}
        </FieldError>
      </Field>
      <Field invalid={!!errors.terms}>
        <FieldLabel>{t('quotes.builder.terms')}</FieldLabel>
        <Textarea rows={6} {...form.register('terms')} />
        <FieldDescription>{t('quotes.builder.termsHint')}</FieldDescription>
        <FieldError match={!!errors.terms}>
          {t('quotes.builder.errors.text', { max: formatNumber(4000) })}
        </FieldError>
      </Field>
    </FormSection>
  );
}

/** Where the draft stands: discarded, awaiting or after a discount decision, or needing one. */
function BuilderNotices({
  quote,
  needsApproval,
  dirty,
  focusAfter,
  onReturn,
}: {
  quote: QuoteDetail;
  needsApproval: boolean;
  dirty: boolean;
  focusAfter: FocusAfter;
  onReturn: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const decide = useDecideApproval(quote.id);
  const decision = quote.discountDecision;
  const effective = {
    oneOff: formatBasisPoints(quote.totals.oneOff.effectiveDiscountBasisPoints),
    monthly: formatBasisPoints(quote.totals.monthly.effectiveDiscountBasisPoints),
    threshold: formatNumber(quote.discountThresholdPercent / 100, { style: 'percent' }),
  };

  if (quote.archivedAt) {
    return (
      <Callout
        icon={<ArchiveIcon />}
        title={t('quotes.builder.discardedTitle')}
        description={t('quotes.builder.discardedBody', { when: formatDateTime(quote.archivedAt) })}
      />
    );
  }
  if (quote.discountApproval === 'pending') {
    return (
      <Callout
        tone="warning"
        icon={<StampIcon />}
        title={t('quotes.approval.pendingTitle')}
        description={t('quotes.approval.pendingBody', effective)}
        action={
          quote.permissions.canDecideApproval && (
            <span className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={async () => {
                  // The approved draft can be sent at once: the focus goes to "Send".
                  focusAfter('send');
                  try {
                    await decide.mutateAsync({ decision: 'approve', note: null });
                    toast.add({ title: t('quotes.approval.approvedToast'), type: 'success' });
                  } catch (error) {
                    focusAfter(null);
                    toast.add({ title: errorMessage(t, error), type: 'error' });
                  }
                }}
              >
                <CircleCheckIcon />
                {t('quotes.approval.approve')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => onReturn(event.currentTarget)}
              >
                <Undo2Icon />
                {t('quotes.approval.return')}
              </Button>
            </span>
          )
        }
      />
    );
  }
  if (quote.discountApproval === 'returned' && decision) {
    return (
      <Callout
        tone="warning"
        icon={<Undo2Icon />}
        title={t('quotes.approval.returnedTitle', { name: decision.by.name })}
        description={decision.note ?? ''}
      />
    );
  }
  if (quote.discountApproval === 'approved' && decision && !dirty) {
    return (
      <Callout
        tone="info"
        icon={<CircleCheckIcon />}
        title={t('quotes.approval.approvedTitle')}
        description={t('quotes.approval.approvedBody', {
          name: decision.by.name,
          when: formatDateTime(decision.at),
        })}
      />
    );
  }
  if (needsApproval && quote.discountApproval !== 'approved' && !quote.archivedAt) {
    return (
      <Callout
        tone="warning"
        icon={<StampIcon />}
        title={t('quotes.approval.neededTitle')}
        description={
          can(me, 'quotes.approve_discount')
            ? t('quotes.approval.neededSelf')
            : t('quotes.approval.neededBody')
        }
      />
    );
  }
  return null;
}

/** Request or withdraw approval, send, discard: on the saved draft only. */
function DraftActions({
  quote,
  dirty,
  needsApproval,
  focusAfter,
  onSend,
}: {
  quote: QuoteDetail;
  dirty: boolean;
  needsApproval: boolean;
  focusAfter: FocusAfter;
  onSend: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const approval = useQuoteApproval(quote.id);
  const archive = useArchiveQuote(quote.id);
  const [discarding, setDiscarding] = useState(false);
  const approver = can(useMe(), 'quotes.approve_discount');
  const { permissions } = quote;
  const blocked = needsApproval && quote.discountApproval !== 'approved' && !approver;

  async function changeApproval(action: 'request' | 'withdraw') {
    // Each button takes the place of the other.
    focusAfter(action === 'request' ? 'withdraw-approval' : 'request-approval');
    try {
      await approval.mutateAsync({ action });
      toast.add({
        title: t(action === 'request' ? 'quotes.approval.requested' : 'quotes.approval.withdrawn'),
        type: 'success',
      });
    } catch (error) {
      focusAfter(null);
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  const any =
    permissions.canRequestApproval ||
    permissions.canWithdrawApproval ||
    permissions.canSend ||
    permissions.canArchive;
  if (!any) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {permissions.canSend && (
        <Button
          data-focus="send"
          disabled={dirty || blocked}
          onClick={(event) => onSend(event.currentTarget)}
        >
          <SendIcon />
          {t('quotes.send.action')}
        </Button>
      )}
      {permissions.canRequestApproval && needsApproval && !approver && (
        <Button
          data-focus="request-approval"
          variant="outline"
          disabled={dirty || approval.isPending}
          onClick={() => changeApproval('request')}
        >
          <StampIcon />
          {t('quotes.approval.request')}
        </Button>
      )}
      {permissions.canWithdrawApproval && (
        <Button
          data-focus="withdraw-approval"
          variant="outline"
          disabled={approval.isPending}
          onClick={() => changeApproval('withdraw')}
        >
          <Undo2Icon />
          {t('quotes.approval.withdraw')}
        </Button>
      )}
      {permissions.canArchive && (
        <Button variant="ghost" className="ms-auto" onClick={() => setDiscarding(true)}>
          <Trash2Icon />
          {t('quotes.discard.action')}
        </Button>
      )}
      {dirty && <p className="text-sm text-muted-foreground">{t('quotes.builder.saveFirst')}</p>}

      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title={t('quotes.discard.title', { number: quote.displayNumber })}
        body={t('quotes.discard.body')}
        action={t('quotes.discard.action')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync();
          toast.add({ title: t('quotes.discard.done'), type: 'success' });
          await navigate({ to: '/quotes' });
        }}
      />
    </div>
  );
}

/** The catalog the pickers offer, and lookups for re-pricing and package rounds. */
function useCatalog(enabled: boolean) {
  const services = useQuery({ ...serviceListQuery({ pageSize: 100 }), enabled });
  const packages = useQuery({ ...packageListQuery({ pageSize: 100 }), enabled });
  const serviceById = new Map(services.data?.items.map((item) => [item.id, item]));
  const packageById = new Map(packages.data?.items.map((item) => [item.id, item]));
  return {
    services: services.data?.items ?? [],
    packages: packages.data?.items ?? [],
    service: (id: string) => serviceById.get(id),
    package: (id: string) => packageById.get(id),
    loaded: services.isSuccess && packages.isSuccess,
    failed: services.isError || packages.isError,
    retry: () => Promise.all([services.refetch(), packages.refetch()]),
  };
}

/**
 * Rule 3: the API prices every line again in a new currency when the draft is saved, so prices
 * and discounts wait for that save instead of being typed and then replaced.
 */
const repricing = (form: BuilderForm, quote: QuoteDetail) =>
  form.watch('currency') !== quote.currency;

function BasicsSection({
  form,
  quote,
  lines,
}: {
  form: BuilderForm;
  quote: QuoteDetail;
  lines: LinesArray;
}) {
  const { t } = useTranslation();
  const ids = { contact: useId(), currency: useId() };
  const { errors } = form.formState;
  const client = useQuery({ ...clientQuery(quote.client?.id ?? ''), enabled: !!quote.client });
  const catalog = useCatalog(quote.permissions.canEdit);

  const contactItems = [
    { value: NONE, label: t('quotes.form.noAddressee') },
    ...(client.data?.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.name })),
  ];
  // The stored addressee stays offered after being archived.
  if (quote.contact && !contactItems.some((item) => item.value === quote.contact?.id)) {
    contactItems.push({ value: quote.contact.id, label: quote.contact.name });
  }
  const currencyItems = CURRENCIES.map((currency) => ({
    value: currency,
    label: t(`quotes.currencies.${currency}`),
  }));

  function changeCurrency(currency: Currency) {
    form.setValue('currency', currency, { shouldDirty: true });
    lines.replace(repriced(form.getValues('lines'), currency, catalog));
    // Discounts are amounts in the old currency: they start again in the new one.
    form.setValue('oneOffDiscountMinor', 0, { shouldDirty: true });
    form.setValue('monthlyDiscountMinor', 0, { shouldDirty: true });
  }

  return (
    <FormSection title={t('quotes.builder.basics')} hint={t('quotes.builder.basicsHint')}>
      <Field invalid={!!errors.title}>
        <FieldLabel>{t('quotes.form.title')}</FieldLabel>
        <Input autoComplete="off" {...form.register('title')} />
        <FieldDescription>{t('quotes.form.titleHint')}</FieldDescription>
        <FieldError match={!!errors.title}>{t('quotes.form.errors.title')}</FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
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
                disabled={!quote.permissions.canEdit}
                items={contactItems}
                value={field.value ?? NONE}
                onChange={(next) => field.onChange(next === NONE ? null : next)}
              />
              {client.isError && (
                <p
                  role="alert"
                  className="flex flex-wrap items-center gap-2 text-sm text-destructive-text"
                >
                  {t('quotes.builder.contactsError')}
                  <Button type="button" variant="link" size="sm" onClick={() => client.refetch()}>
                    {t('common.retry')}
                  </Button>
                </p>
              )}
            </Field>
          )}
        />
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
                disabled={!quote.permissions.canEdit}
                items={currencyItems}
                value={field.value}
                onChange={(next) => next !== field.value && changeCurrency(next as Currency)}
              />
              <FieldDescription>
                {repricing(form, quote)
                  ? t('quotes.builder.currencyChanged')
                  : t('quotes.builder.currencyHint')}
              </FieldDescription>
            </Field>
          )}
        />
        <Field invalid={!!errors.validityDays}>
          <FieldLabel>{t('quotes.builder.validityDays')}</FieldLabel>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={QUOTE_LIMITS.validityDays}
            className="text-end tabular-nums"
            {...form.register('validityDays', { valueAsNumber: true })}
          />
          <FieldDescription>{t('quotes.builder.validityHint')}</FieldDescription>
          <FieldError match={!!errors.validityDays}>
            {t('quotes.builder.errors.validityDays', {
              max: formatNumber(QUOTE_LIMITS.validityDays),
            })}
          </FieldError>
        </Field>
      </div>
    </FormSection>
  );
}

/** One section of the quote: its lines, pickers, discount and totals (rule 5). */
function LinesSection({
  section,
  form,
  quote,
  lines,
  totals,
  readOnly,
}: {
  section: QuoteSection;
  form: BuilderForm;
  quote: QuoteDetail;
  lines: LinesArray;
  totals: QuoteTotals;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const catalog = useCatalog(!readOnly);
  const priceLocked = repricing(form, quote);
  const currency = form.watch('currency');
  const sectionTotals = section === 'one_off' ? totals.oneOff : totals.monthly;
  const rows = lines.fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.section === section);
  const full = lines.fields.length >= QUOTE_LIMITS.lines;
  const list = useRef<HTMLUListElement>(null);
  const addService = useRef<HTMLButtonElement>(null);

  function add(line: BuilderLine) {
    lines.append(line);
  }

  function remove(index: number) {
    const position = rows.findIndex((row) => row.index === index);
    flushSync(() => lines.remove(index));
    focusAfterRemoval(list.current, position, addService.current);
    if (form.getValues('lines').some((line) => line.section === section)) return;
    // An empty section has no discount (rule 5), installments or term.
    const dirty = { shouldDirty: true };
    if (section === 'one_off') {
      form.setValue('oneOffDiscountMinor', 0, dirty);
      form.setValue('installments', [], dirty);
    } else {
      form.setValue('monthlyDiscountMinor', 0, dirty);
      form.setValue('monthlyTermMonths', null, dirty);
    }
  }

  const serviceItems = catalog.services
    .filter((service) => service.billing === section)
    .map((service) => ({ value: service.id, label: service.name }));
  const packageItems = catalog.packages
    .filter((pkg) => pkg.billing === section)
    .map((pkg) => ({ value: pkg.id, label: pkg.name }));

  return (
    <FormSection
      title={t(`quotes.sections.${section}`)}
      hint={t(`quotes.builder.sectionHints.${section}`)}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('quotes.builder.noLines')}</p>
      ) : (
        <ul ref={list} className="flex flex-col gap-3">
          {rows.map(({ field, index }) => (
            <LineCard
              key={field.key}
              form={form}
              index={index}
              line={field}
              currency={currency}
              total={totals.lineTotalsMinor[index] ?? 0}
              readOnly={readOnly}
              priceLocked={priceLocked}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}

      {!readOnly && catalog.failed && (
        <LoadError message={t('catalog.loadError')} onRetry={() => catalog.retry()} />
      )}
      {!readOnly && catalog.loaded && serviceItems.length + packageItems.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('quotes.builder.noCatalogItems')}</p>
      )}
      {!readOnly && !full && serviceItems.length + packageItems.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <ChoiceSelect
            ref={addService}
            label={t('quotes.builder.addService')}
            placeholder={t('quotes.builder.addService')}
            items={serviceItems}
            value={null}
            onChange={(id) => {
              const service = catalog.service(id) as CatalogService;
              add(serviceLine(service, currency));
            }}
            className="sm:max-w-xs"
          />
          {packageItems.length > 0 && (
            <ChoiceSelect
              label={t('quotes.builder.addPackage')}
              placeholder={t('quotes.builder.addPackage')}
              items={packageItems}
              value={null}
              onChange={(id) => {
                const pkg = catalog.package(id) as CatalogPackage;
                add(
                  packageLine(
                    pkg,
                    currency,
                    (serviceId) => catalog.service(serviceId)?.revisionRounds ?? 0,
                  ),
                );
              }}
              className="sm:max-w-xs"
            />
          )}
        </div>
      )}

      {rows.length > 0 && (
        <SectionTotals
          section={section}
          form={form}
          quote={quote}
          totals={sectionTotals}
          currency={currency}
          readOnly={readOnly}
          priceLocked={priceLocked}
        />
      )}
      {section === 'one_off' && rows.length > 0 && (
        <InstallmentsEditor form={form} totals={totals} currency={currency} readOnly={readOnly} />
      )}
      {section === 'monthly' && rows.length > 0 && (
        <TermField form={form} totals={totals} currency={currency} />
      )}
    </FormSection>
  );
}

function LineCard({
  form,
  index,
  line,
  currency,
  total,
  readOnly,
  priceLocked,
  onRemove,
}: {
  form: BuilderForm;
  index: number;
  line: BuilderLine;
  currency: Currency;
  total: number;
  readOnly: boolean;
  priceLocked: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ids = { price: useId() };
  const { errors } = form.formState;
  const invalid = (path: string) => !!get(errors, `lines.${index}.${path}`);
  const listPrice = form.watch(`lines.${index}.listUnitPriceMinor`);
  const isPackage = line.packageId !== null;
  const quantityError = t('quotes.builder.errors.quantity', {
    max: formatNumber(QUOTE_LIMITS.quantity),
  });
  const roundsError = t('quotes.builder.errors.revisionRounds', {
    max: formatNumber(TASK_LIMITS.revisionLimit),
  });
  const itemsInvalid = line.items.some(
    (_, itemIndex) =>
      invalid(`items.${itemIndex}.quantity`) || invalid(`items.${itemIndex}.revisionRounds`),
  );

  return (
    <li>
      <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
        <legend className="sr-only">{line.name}</legend>
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              {line.name}
              {isPackage && <Badge tone="brand">{t('quotes.builder.package')}</Badge>}
              {line.catalogArchived && (
                <Badge tone="warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  {t('quotes.builder.catalogArchived')}
                </Badge>
              )}
            </span>
          </div>
          <span className="font-bold">
            <Money minor={total} currency={currency} />
          </span>
          {!readOnly && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('quotes.builder.removeLine', { name: line.name })}
                    data-focus="remove"
                    onClick={onRemove}
                  />
                }
              >
                <Trash2Icon />
              </TooltipTrigger>
              <TooltipContent>{t('quotes.builder.removeLine', { name: line.name })}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <Field invalid={invalid('description')}>
          <FieldLabel>{t('quotes.builder.description')}</FieldLabel>
          <Input autoComplete="off" {...form.register(`lines.${index}.description`)} />
          <FieldError match={invalid('description')}>
            {t('quotes.builder.errors.description')}
          </FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {!isPackage && (
            <Field invalid={invalid('quantity')}>
              <FieldLabel>{t('quotes.builder.quantity')}</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={QUOTE_LIMITS.quantity}
                className="text-end tabular-nums"
                {...form.register(`lines.${index}.quantity`, { valueAsNumber: true })}
              />
              <FieldError match={invalid('quantity')}>{quantityError}</FieldError>
            </Field>
          )}
          <Controller
            control={form.control}
            name={`lines.${index}.unitPriceMinor`}
            render={({ field }) => (
              <Field invalid={invalid('unitPriceMinor')}>
                <FieldLabel htmlFor={ids.price}>
                  {isPackage ? t('quotes.builder.packagePrice') : t('quotes.builder.unitPrice')}
                </FieldLabel>
                <MoneyInput
                  ref={field.ref}
                  id={ids.price}
                  currency={currency}
                  value={field.value}
                  onValueChange={(minor) => field.onChange(minor ?? 0)}
                  disabled={readOnly || priceLocked}
                />
                <FieldDescription>
                  {listPrice === null
                    ? t('quotes.builder.noCatalogPrice', { currency })
                    : t('quotes.builder.catalogPrice', {
                        price: isolateLtr(formatMoney(listPrice, currency)),
                      })}
                </FieldDescription>
              </Field>
            )}
          />
          {!isPackage && (
            <Field invalid={invalid('revisionRounds')}>
              <FieldLabel>{t('quotes.builder.revisionRounds')}</FieldLabel>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={20}
                className="text-end tabular-nums"
                {...form.register(`lines.${index}.revisionRounds`, { valueAsNumber: true })}
              />
              <FieldError match={invalid('revisionRounds')}>{roundsError}</FieldError>
            </Field>
          )}
        </div>
        {isPackage && (
          <table className="w-full text-sm">
            <caption className="sr-only">
              {t('quotes.builder.packageItems', { name: line.name })}
            </caption>
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-1 text-start font-normal">
                  {t('quotes.builder.service')}
                </th>
                <th scope="col" className="w-28 py-1 text-start font-normal">
                  {t('quotes.builder.quantity')}
                </th>
                <th scope="col" className="w-28 py-1 text-start font-normal">
                  {t('quotes.builder.revisionRounds')}
                </th>
              </tr>
            </thead>
            <tbody>
              {line.items.map((item, itemIndex) => (
                <tr key={item.serviceId} className="border-t border-border">
                  <td className="py-2 pe-3">{item.name}</td>
                  <td className="py-2 pe-3">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={QUOTE_LIMITS.quantity}
                      aria-label={t('quotes.builder.quantityOf', { name: item.name })}
                      aria-invalid={invalid(`items.${itemIndex}.quantity`)}
                      className="text-end tabular-nums"
                      {...form.register(`lines.${index}.items.${itemIndex}.quantity`, {
                        valueAsNumber: true,
                      })}
                    />
                  </td>
                  <td className="py-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={20}
                      aria-label={t('quotes.builder.roundsOf', { name: item.name })}
                      aria-invalid={invalid(`items.${itemIndex}.revisionRounds`)}
                      className="text-end tabular-nums"
                      {...form.register(`lines.${index}.items.${itemIndex}.revisionRounds`, {
                        valueAsNumber: true,
                      })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {itemsInvalid && (
          <p className="text-sm text-destructive-text">
            {t('quotes.builder.errors.items', {
              quantity: formatNumber(QUOTE_LIMITS.quantity),
              rounds: formatNumber(TASK_LIMITS.revisionLimit),
            })}
          </p>
        )}
      </fieldset>
    </li>
  );
}

/** Subtotal, the section discount (typed as an amount or a percentage, stored as an amount), net. */
function SectionTotals({
  section,
  form,
  quote,
  totals,
  currency,
  readOnly,
  priceLocked,
}: {
  section: QuoteSection;
  form: BuilderForm;
  quote: QuoteDetail;
  totals: QuoteTotals['oneOff'];
  currency: Currency;
  readOnly: boolean;
  priceLocked: boolean;
}) {
  const { t } = useTranslation();
  const locked = readOnly || priceLocked;
  const sectionName = t(`quotes.sections.${section}`);
  const name = section === 'one_off' ? 'oneOffDiscountMinor' : 'monthlyDiscountMinor';
  const [mode, setMode] = useState<'amount' | 'percent'>('amount');
  const [percent, setPercent] = useState('');
  const invalid = !!form.formState.errors[name] || totals.discountMinor > totals.subtotalMinor;
  const overThreshold = totals.effectiveDiscountBasisPoints >= quote.discountThresholdPercent * 100;
  const perMonth = section === 'monthly' ? ` ${t('quotes.perMonth')}` : '';

  return (
    <dl className="grid gap-3 rounded-lg bg-muted/40 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <dt className="text-muted-foreground">{t('quotes.totals.subtotal')}</dt>
      <dd className="text-end">
        <Money minor={totals.subtotalMinor} currency={currency} />
      </dd>
      <dt className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {t('quotes.totals.discount')}
        {!locked && (
          <ToggleGroup
            aria-label={t('quotes.builder.discountMode', { section: sectionName })}
            value={[mode]}
            onValueChange={(next: ('amount' | 'percent')[]) => {
              const chosen = next[0];
              if (!chosen) return;
              setMode(chosen);
              setPercent('');
            }}
          >
            <ToggleGroupItem value="amount">{currency}</ToggleGroupItem>
            <ToggleGroupItem value="percent">%</ToggleGroupItem>
          </ToggleGroup>
        )}
      </dt>
      <dd className="flex flex-col items-end gap-1">
        {mode === 'amount' || locked ? (
          <Controller
            control={form.control}
            name={name}
            render={({ field }) => (
              <MoneyInput
                ref={field.ref}
                aria-label={t('quotes.builder.discountAmount', { section: sectionName })}
                aria-invalid={invalid}
                currency={currency}
                value={field.value}
                onValueChange={(minor) => field.onChange(minor ?? 0)}
                disabled={locked}
                className="w-44"
              />
            )}
          />
        ) : (
          <>
            <div dir="ltr" className="relative">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                aria-label={t('quotes.builder.discountPercent', { section: sectionName })}
                value={percent}
                onChange={(event) => {
                  setPercent(event.target.value);
                  const share = Number(event.target.value);
                  if (Number.isNaN(share)) return;
                  const amount = Math.round((totals.subtotalMinor * Math.min(share, 100)) / 100);
                  form.setValue(name, Math.max(0, amount), { shouldDirty: true });
                }}
                className="w-44 pe-8 text-end tabular-nums"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
              >
                %
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              <Money minor={totals.discountMinor} currency={currency} />
            </span>
          </>
        )}
        {invalid && (
          <span role="alert" className="text-sm text-destructive-text">
            {t('errors.INVALID_DISCOUNT')}
          </span>
        )}
      </dd>
      <dt className="font-bold">{t('quotes.totals.net')}</dt>
      <dd className="text-end text-lg font-bold">
        <Money minor={totals.netMinor} currency={currency} />
        {perMonth}
      </dd>
      <dt className="text-muted-foreground">{t('quotes.totals.effectiveDiscount')}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-2">
        <span className="tabular-nums">
          {formatBasisPoints(totals.effectiveDiscountBasisPoints)}
        </span>
        {overThreshold && (
          <Badge tone="warning">
            <StampIcon aria-hidden="true" />
            {t('quotes.totals.needsApproval', {
              threshold: formatNumber(quote.discountThresholdPercent / 100, { style: 'percent' }),
            })}
          </Badge>
        )}
      </dd>
    </dl>
  );
}

/** Rule 5: installments as shares of the one-off net, the last one taking the remainder. */
function InstallmentsEditor({
  form,
  totals,
  currency,
  readOnly,
}: {
  form: BuilderForm;
  totals: QuoteTotals;
  currency: Currency;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const installments = useFieldArray({ control: form.control, name: 'installments' });
  const values = form.watch('installments');
  const sum = values.reduce((total, item) => total + (Number(item.percent) || 0), 0);
  const { errors } = form.formState;
  const list = useRef<HTMLUListElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  function remove(index: number) {
    flushSync(() => installments.remove(index));
    focusAfterRemoval(list.current, index, addButton.current);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-bold">{t('quotes.installments.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('quotes.installments.hint')}</p>
      </div>
      {installments.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('quotes.installments.none')}</p>
      ) : (
        <ul ref={list} className="flex flex-col gap-2">
          {installments.fields.map((field, index) => (
            <li key={field.id} className="flex flex-wrap items-center gap-3">
              <Input
                autoComplete="off"
                aria-label={t('quotes.installments.name', { n: formatNumber(index + 1) })}
                aria-invalid={!!errors.installments?.[index]?.name}
                className="min-w-40 flex-1"
                {...form.register(`installments.${index}.name`)}
              />
              <div dir="ltr" className="relative">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  aria-label={t('quotes.installments.percent', { n: formatNumber(index + 1) })}
                  aria-invalid={!!errors.installments?.[index]?.percent}
                  className="w-24 pe-8 text-end tabular-nums"
                  {...form.register(`installments.${index}.percent`, { valueAsNumber: true })}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground"
                >
                  %
                </span>
              </div>
              <Money
                minor={totals.installmentAmountsMinor[index] ?? 0}
                currency={currency}
                className="w-36 text-end"
              />
              {!readOnly && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('quotes.installments.remove', { n: formatNumber(index + 1) })}
                        data-focus="remove"
                        onClick={() => remove(index)}
                      />
                    }
                  >
                    <Trash2Icon />
                  </TooltipTrigger>
                  <TooltipContent>
                    {t('quotes.installments.remove', { n: formatNumber(index + 1) })}
                  </TooltipContent>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      )}
      {errors.installments && (
        <p className="text-sm text-destructive-text">{t('quotes.installments.errors.invalid')}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && installments.fields.length < QUOTE_LIMITS.installments && (
          <Button
            ref={addButton}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => installments.append({ name: '', percent: Math.max(1, 100 - sum) })}
          >
            <PlusIcon />
            {t('quotes.installments.add')}
          </Button>
        )}
        {installments.fields.length > 0 && (
          <span
            className={
              sum === 100 ? 'text-sm text-muted-foreground' : 'text-sm text-destructive-text'
            }
          >
            {t('quotes.installments.sum', { sum: formatNumber(sum) })}
          </span>
        )}
      </div>
    </div>
  );
}

/** The monthly section's optional term and what it comes to (rule 5). */
function TermField({
  form,
  totals,
  currency,
}: {
  form: BuilderForm;
  totals: QuoteTotals;
  currency: Currency;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
      <Field invalid={!!form.formState.errors.monthlyTermMonths}>
        <FieldLabel>{t('quotes.builder.termMonths')}</FieldLabel>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          max={QUOTE_LIMITS.termMonths}
          className="text-end tabular-nums"
          {...form.register('monthlyTermMonths', {
            setValueAs: (value: unknown) => (value === '' || value === null ? null : Number(value)),
          })}
        />
        <FieldDescription>{t('quotes.builder.termHint')}</FieldDescription>
        <FieldError match={!!form.formState.errors.monthlyTermMonths}>
          {t('quotes.builder.errors.termMonths', { max: formatNumber(QUOTE_LIMITS.termMonths) })}
        </FieldError>
      </Field>
      {totals.monthlyTermTotalMinor !== null && (
        <p className="text-sm text-muted-foreground">
          {t('quotes.totals.termTotal')}{' '}
          <Money
            minor={totals.monthlyTermTotalMinor}
            currency={currency}
            className="font-bold text-foreground"
          />
        </p>
      )}
    </div>
  );
}
