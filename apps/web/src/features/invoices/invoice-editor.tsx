import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  INVOICE_LIMITS,
  type InvoiceDetail,
  type InvoiceDraftInput,
  type InvoiceSettings,
  invoiceDraftSchema,
  invoiceTotal,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ListPlusIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import {
  Controller,
  get,
  type UseFieldArrayReturn,
  type UseFormReturn,
  useFieldArray,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { FormSection } from '../../components/form-section';
import { MoneyInput } from '../../components/money-input';
import { UnsavedChangesGuard } from '../../components/unsaved-changes-guard';
import { ApiError } from '../../lib/api/client';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber } from '../../lib/format';
import { projectListQuery } from '../projects/projects.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { retainerListQuery } from '../retainers/retainers.queries';
import { BillablePicker, engagementKey, type LineSource, type PickedLine } from './billable-picker';
import { IssueDialog } from './invoice-dialogs';
import { DraftPreview } from './invoice-pdf';
import { invoicesKeys, useArchiveInvoice, useSaveInvoiceDraft } from './invoices.queries';
import { LineServiceField } from './line-services';
import { SourceChip } from './source-chip';

interface EditorLine {
  /** Set once saved. */
  id?: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  source: LineSource | null;
  /** The catalog service (F15); kept on save, none for a new line. */
  serviceId?: string | null;
}

interface EditorValues {
  /** `none`, `project:<id>` or `retainer:<id>`. */
  engagement: string;
  paymentTermsDays: number;
  notes: string;
  lines: EditorLine[];
}

type EditorForm = UseFormReturn<EditorValues>;

const NONE = 'none';

function editorValues(invoice: InvoiceDetail): EditorValues {
  return {
    engagement: invoice.engagement ? `${invoice.engagement.type}:${invoice.engagement.id}` : NONE,
    paymentTermsDays: invoice.paymentTermsDays,
    notes: invoice.notes ?? '',
    lines: invoice.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      source: line.source,
      serviceId: line.service?.id ?? null,
    })),
  };
}

function draftInput(values: EditorValues, updatedAt: string): InvoiceDraftInput {
  const [type, id = null] = values.engagement.split(':');
  return {
    updatedAt,
    projectId: type === 'project' ? id : null,
    retainerId: type === 'retainer' ? id : null,
    paymentTermsDays: values.paymentTermsDays,
    notes: values.notes,
    lines: values.lines.map((line) => ({
      ...(line.id && { id: line.id }),
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      source: line.source ? { type: line.source.type, id: line.source.id } : null,
      serviceId: line.serviceId ?? null,
    })),
  };
}

/**
 * Spec screen 2: a draft as one document, saved whole (rule 7). Holds the stored version the form
 * started from: a refetch never restarts the form under unsaved work; the editor offers the newer
 * version instead (edge case 1).
 */
export function InvoiceEditor({
  invoice,
  settings,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
}) {
  const [base, setBase] = useState(invoice);
  if (base.archivedAt !== invoice.archivedAt) setBase(invoice);
  return (
    <Editor
      key={base.updatedAt}
      base={base}
      invoice={invoice}
      settings={settings}
      onLoad={setBase}
    />
  );
}

function Editor({
  base,
  invoice,
  settings,
  onLoad,
}: {
  /** The version the form started from. */
  base: InvoiceDetail;
  /** The latest stored version. */
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  onLoad: (version: InvoiceDetail) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const readOnly = !invoice.permissions.canEdit;
  const form = useForm<EditorValues>({ defaultValues: editorValues(base) });
  const lines = useFieldArray({ control: form.control, name: 'lines', keyName: 'key' });
  const save = useSaveInvoiceDraft(invoice.id);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const { isDirty: dirty, isSubmitting } = form.formState;
  const newer = invoice.updatedAt > base.updatedAt;

  // Nothing to lose: take the newer version at once.
  useEffect(() => {
    if (newer && !dirty && !isSubmitting) onLoad(invoice);
  }, [newer, dirty, isSubmitting, onLoad, invoice]);

  const submit = form.handleSubmit(async (current) => {
    setFailure(null);
    const checked = invoiceDraftSchema.safeParse(draftInput(current, base.updatedAt));
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        form.setError(issue.path.join('.') as 'notes', { type: 'schema' });
      }
      setFailure(t('invoices.editor.errors.invalid'));
      return;
    }
    try {
      const saved = await save.mutateAsync(checked.data);
      toast.add({ title: t('invoices.editor.saved'), type: 'success' });
      onLoad(saved);
    } catch (error) {
      setFailure(errorMessage(t, error));
      // Another save came first: fetch it, so the editor offers it.
      if (error instanceof ApiError && error.knownCode === 'STALE_INVOICE') {
        await queryClient.invalidateQueries({ queryKey: invoicesKeys.detail(invoice.id) });
      }
    }
  });

  return (
    <>
      {invoice.archivedAt && (
        <Callout
          icon={<ArchiveIcon />}
          title={t('invoices.editor.discardedTitle')}
          description={t('invoices.editor.discardedBody', {
            when: formatDateTime(invoice.archivedAt),
          })}
        />
      )}
      {newer && dirty && (
        <Callout
          tone="warning"
          icon={<TriangleAlertIcon />}
          title={t('invoices.editor.changedTitle')}
          description={t('invoices.editor.changedBody', {
            when: formatDateTime(invoice.updatedAt),
          })}
          action={
            <Button variant="outline" size="sm" onClick={() => onLoad(invoice)}>
              {t('invoices.editor.loadLatest')}
            </Button>
          }
        />
      )}

      {!invoice.archivedAt && <DraftActions invoice={invoice} settings={settings} dirty={dirty} />}
      {!invoice.archivedAt && invoice.permissions.canEdit && (
        <DraftPreview invoice={invoice} saved={!dirty} />
      )}

      <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-6">
          <legend className="sr-only">{t('invoices.editor.legend')}</legend>
          <LinesSection form={form} invoice={invoice} lines={lines} readOnly={readOnly} />
          <TermsSection form={form} invoice={invoice} settings={settings} lines={lines} />
        </fieldset>
        {!readOnly && (
          <>
            {failure && <FormAlert>{failure}</FormAlert>}
            <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-background px-4 py-3 md:-mx-8 md:px-8">
              {dirty && (
                <p className="me-auto text-sm text-muted-foreground">{t('invoices.unsaved')}</p>
              )}
              <Button
                variant="outline"
                disabled={!dirty || isSubmitting}
                onClick={() => setConfirmReset(true)}
              >
                {t('invoices.editor.discardChanges')}
              </Button>
              <Button type="submit" disabled={!dirty || isSubmitting}>
                {isSubmitting ? t('common.saving') : t('invoices.editor.save')}
              </Button>
            </div>
          </>
        )}
      </form>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('common.unsaved.title')}
        body={t('invoices.editor.discardChangesBody')}
        action={t('common.unsaved.discard')}
        destructive
        pending={false}
        onConfirm={async () => {
          setFailure(null);
          form.reset();
        }}
      />
      <UnsavedChangesGuard dirty={dirty && !isSubmitting} />
    </>
  );
}

/** Issue and discard act on the saved draft only. */
function DraftActions({
  invoice,
  settings,
  dirty,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  dirty: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const archive = useArchiveInvoice(invoice.id);
  const [open, setOpen] = useState<'issue' | 'discard' | null>(null);
  const { permissions } = invoice;
  if (!permissions.canIssue && !permissions.canArchive) return null;
  const empty = invoice.lines.length === 0 || invoice.totalMinor === 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {permissions.canIssue && (
        <Button disabled={dirty || empty} onClick={() => setOpen('issue')}>
          <SendIcon />
          {t('invoices.issue.action')}
        </Button>
      )}
      {permissions.canArchive && (
        <Button variant="ghost" className="ms-auto" onClick={() => setOpen('discard')}>
          <Trash2Icon />
          {t('invoices.discard.action')}
        </Button>
      )}
      {dirty ? (
        <p className="text-sm text-muted-foreground">{t('invoices.editor.saveFirst')}</p>
      ) : (
        empty && <p className="text-sm text-muted-foreground">{t('invoices.issue.empty')}</p>
      )}

      <IssueDialog
        invoice={invoice}
        settings={settings}
        open={open === 'issue'}
        onClose={() => setOpen(null)}
      />
      <ConfirmDialog
        open={open === 'discard'}
        onClose={() => setOpen(null)}
        title={t('invoices.discard.title')}
        body={t('invoices.discard.body')}
        action={t('invoices.discard.action')}
        destructive
        pending={archive.isPending}
        onConfirm={async () => {
          await archive.mutateAsync();
          toast.add({ title: t('invoices.discard.done'), type: 'success' });
          await navigate({ to: '/invoices' });
        }}
      />
    </div>
  );
}

type LinesArray = UseFieldArrayReturn<EditorValues, 'lines', 'key'>;

/** The lines: copies of their sources, every field editable (rule 7). */
function LinesSection({
  form,
  invoice,
  lines,
  readOnly,
}: {
  form: EditorForm;
  invoice: InvoiceDetail;
  lines: LinesArray;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const values = form.watch('lines');
  const engagement = form.watch('engagement');
  const total = invoiceTotal(values);
  const full = lines.fields.length >= INVOICE_LIMITS.lines;
  const sourced = values.flatMap((line) => (line.source ? [line.source] : []));
  const locked =
    (sourced[0] && engagementKey(sourced[0])) ?? (engagement === NONE ? null : engagement);

  function pick(picked: PickedLine[]) {
    const room = INVOICE_LIMITS.lines - lines.fields.length;
    lines.append(picked.slice(0, room).map((line) => ({ ...line, quantity: 1 })));
    const first = picked[0];
    // The sources set the engagement (rule 6).
    if (first) {
      form.setValue('engagement', engagementKey(first.source) ?? NONE, { shouldDirty: true });
    }
  }

  return (
    <FormSection title={t('invoices.editor.lines')} hint={t('invoices.editor.linesHint')}>
      {lines.fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('invoices.editor.noLines')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.fields.map((field, index) => (
            <LineCard
              key={field.key}
              form={form}
              index={index}
              line={field}
              invoice={invoice}
              readOnly={readOnly}
              onRemove={() => lines.remove(index)}
            />
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={full} onClick={() => setPicking(true)}>
            <ListPlusIcon />
            {t('invoices.editor.addBillable')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={full}
            onClick={() =>
              lines.append({ description: '', quantity: 1, unitPriceMinor: 0, source: null })
            }
          >
            <PlusIcon />
            {t('invoices.editor.addLine')}
          </Button>
          {full && (
            <p className="text-sm text-muted-foreground">
              {t('invoices.editor.full', { n: INVOICE_LIMITS.lines })}
            </p>
          )}
        </div>
      )}
      <p className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
        <span className="font-bold">{t('invoices.facts.total')}</span>
        <Money minor={total} currency={invoice.currency} className="text-lg font-bold" />
      </p>
      {!readOnly && (
        <BillablePicker
          open={picking}
          onClose={() => setPicking(false)}
          clientId={invoice.client.id}
          currency={invoice.currency}
          taken={new Set(sourced.map((source) => source.id))}
          engagement={locked}
          onPick={pick}
        />
      )}
    </FormSection>
  );
}

function LineCard({
  form,
  index,
  line,
  invoice,
  readOnly,
  onRemove,
}: {
  form: EditorForm;
  index: number;
  line: EditorLine;
  invoice: InvoiceDetail;
  readOnly: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ids = { price: useId() };
  const { errors } = form.formState;
  const invalid = (path: string) => !!get(errors, `lines.${index}.${path}`);
  const [quantity, price] = form.watch([
    `lines.${index}.quantity`,
    `lines.${index}.unitPriceMinor`,
  ]);
  const name = t('invoices.editor.lineN', { n: formatNumber(index + 1) });

  return (
    <li>
      <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
        <legend className="sr-only">{name}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{name}</span>
          {line.source ? (
            <SourceChip source={line.source} />
          ) : (
            <Badge tone="outline">{t('invoices.editor.freeLine')}</Badge>
          )}
          <span className="ms-auto font-bold">
            <Money
              minor={(Number.isFinite(quantity) ? quantity : 0) * (price ?? 0)}
              currency={invoice.currency}
            />
          </span>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('invoices.editor.removeLine', { name })}
              onClick={onRemove}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
        <Field invalid={invalid('description')}>
          <FieldLabel>{t('invoices.editor.description')}</FieldLabel>
          <Input autoComplete="off" {...form.register(`lines.${index}.description`)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field invalid={invalid('quantity')}>
            <FieldLabel>{t('invoices.editor.quantity')}</FieldLabel>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={INVOICE_LIMITS.quantity}
              className="text-end tabular-nums"
              {...form.register(`lines.${index}.quantity`, { valueAsNumber: true })}
            />
          </Field>
          <Controller
            control={form.control}
            name={`lines.${index}.unitPriceMinor`}
            render={({ field }) => (
              <Field invalid={invalid('unitPriceMinor')}>
                <FieldLabel htmlFor={ids.price}>{t('invoices.editor.unitPrice')}</FieldLabel>
                <MoneyInput
                  id={ids.price}
                  currency={invoice.currency}
                  value={field.value}
                  onValueChange={(minor) => field.onChange(minor ?? 0)}
                  disabled={readOnly}
                />
              </Field>
            )}
          />
        </div>
        <Controller
          control={form.control}
          name={`lines.${index}.serviceId`}
          render={({ field }) => (
            <LineServiceField
              value={field.value ?? null}
              onChange={field.onChange}
              current={invoice.lines.find((saved) => saved.id === line.id)?.service ?? null}
              disabled={readOnly}
            />
          )}
        />
      </fieldset>
    </li>
  );
}

/** The engagement link, payment terms, notes and the rate the invoice will be issued at. */
function TermsSection({
  form,
  invoice,
  settings,
  lines,
}: {
  form: EditorForm;
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
  lines: LinesArray;
}) {
  const { t } = useTranslation();
  const ids = { engagement: useId() };
  const { errors } = form.formState;
  const clientId = invoice.client.id;
  const projects = useQuery(
    projectListQuery({
      clientId,
      status: ['planned', 'active', 'on_hold', 'completed', 'cancelled'],
      pageSize: 100,
    }),
  );
  const retainers = useQuery(
    retainerListQuery({ clientId, status: ['active', 'paused', 'ended'], pageSize: 100 }),
  );
  const sourced = lines.fields.some((line) => line.source !== null);
  const current = invoice.engagement;

  const items = [
    { value: NONE, label: t('invoices.editor.noEngagement') },
    ...(projects.data?.items ?? []).map((project) => ({
      value: `project:${project.id}`,
      label: t('invoices.editor.projectOption', { name: project.name }),
    })),
    ...(retainers.data?.items ?? []).map((retainer) => ({
      value: `retainer:${retainer.id}`,
      label: t('invoices.editor.retainerOption', { name: retainer.name }),
    })),
  ];
  // The stored engagement stays choosable even when its list has not loaded or left it out.
  if (current && !items.some((item) => item.value === `${current.type}:${current.id}`)) {
    items.push({
      value: `${current.type}:${current.id}`,
      label: t(`invoices.editor.${current.type}Option`, { name: current.name }),
    });
  }

  return (
    <FormSection title={t('invoices.editor.terms')} hint={t('invoices.editor.termsHint')}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="engagement"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.engagement} render={<span />}>
                {t('invoices.editor.engagement')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.engagement}
                items={items}
                value={field.value}
                disabled={sourced || !invoice.permissions.canEdit}
                onChange={field.onChange}
              />
              <FieldDescription>
                {sourced
                  ? t('invoices.editor.engagementFromSources')
                  : t('invoices.editor.engagementHint')}
              </FieldDescription>
            </Field>
          )}
        />
        <Field invalid={!!errors.paymentTermsDays}>
          <FieldLabel>{t('invoices.editor.paymentTermsDays')}</FieldLabel>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={INVOICE_LIMITS.paymentTermsDays}
            className="text-end tabular-nums"
            {...form.register('paymentTermsDays', { valueAsNumber: true })}
          />
          <FieldDescription>{t('invoices.editor.paymentTermsHint')}</FieldDescription>
        </Field>
      </div>
      <Field invalid={!!errors.notes}>
        <FieldLabel>{t('invoices.editor.notes')}</FieldLabel>
        <Textarea rows={3} {...form.register('notes')} />
        <FieldDescription>{t('invoices.editor.notesHint')}</FieldDescription>
      </Field>
      <RateNotice settings={settings} />
    </FormSection>
  );
}

/** The rate the draft would be issued at, with its date; stale or missing ones warn (rules 9–10). */
function RateNotice({ settings }: { settings: InvoiceSettings | undefined }) {
  const { t } = useTranslation();
  if (!settings) return null;
  if (settings.sypPerUsd === null) {
    return (
      <Callout
        tone="warning"
        icon={<TriangleAlertIcon />}
        title={t('invoices.settings.noRateTitle')}
        description={t('invoices.settings.noRateBody')}
      />
    );
  }
  const text = settings.rateUpdatedAt
    ? t('invoices.rate.currentAt', {
        rate: settings.sypPerUsd,
        when: formatDateTime(settings.rateUpdatedAt),
      })
    : t('invoices.rate.currentPlain', { rate: settings.sypPerUsd });
  return settings.rateStale ? (
    <Callout
      tone="warning"
      icon={<TriangleAlertIcon />}
      title={t('invoices.rate.staleTitle')}
      description={text}
    />
  ) : (
    <p className="text-sm text-muted-foreground">{text}</p>
  );
}
