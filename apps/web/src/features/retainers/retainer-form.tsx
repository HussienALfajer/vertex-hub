import { useQuery } from '@tanstack/react-query';
import {
  type ClientResponse,
  type CreateRetainer,
  type CreateRetainerInput,
  CURRENCIES,
  type Currency,
  DELIVERABLE_KINDS,
  type DeliverableKind,
  type DeliverableLineInput,
  duplicateDeliverables,
  RETAINER_LIMITS,
  type RetainerDeliverables,
  retainerDeliverablesSchema,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  MultiCombobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { ArrowDownIcon, ArrowUpIcon, ListPlusIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useId } from 'react';
import { Controller, type UseFormReturn, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { errorMessage, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { formatNumber } from '../../lib/format';
import { ClientStatusBadge } from '../clients/client-badges';
import { departmentListQuery } from '../departments/departments.queries';
import { DeliverableIcon, lineName } from './retainer-badges';

export type RetainerFormMethods = UseFormReturn<CreateRetainerInput, unknown, CreateRetainer>;

/**
 * Puts a failed save on the field it concerns and returns the form-level message for anything
 * else (null when a field took it).
 */
export function retainerFormFailure(
  form: RetainerFormMethods,
  t: TFunction,
  error: unknown,
): string | null {
  const field = error instanceof ApiError ? FIELD_OF_CODE[error.code ?? ''] : undefined;
  if (field) {
    form.setError(field, {
      type: SCREEN_ERROR,
      message: errorMessage(t, error),
    });
    return null;
  }
  return errorMessage(t, error);
}

const FIELD_OF_CODE: Record<string, 'name' | 'startDate' | 'renewalDate' | 'currency'> = {
  RETAINER_NAME_TAKEN: 'name',
  RETAINER_STARTED: 'startDate',
  INVALID_DATES: 'renewalDate',
  CURRENCY_LOCKED: 'currency',
};

/** R6 before the round trip: a renewal date, when set, comes after the start date. */
export function checkRenewal(
  form: RetainerFormMethods,
  t: TFunction,
  start: string,
  renewal: string | null | undefined,
) {
  if (!renewal || renewal > start) return true;
  form.setError('renewalDate', {
    type: SCREEN_ERROR,
    message: t('retainers.form.errors.renewalAfterStart'),
  });
  return false;
}

export function ClientField({
  form,
  clients,
}: {
  form: RetainerFormMethods;
  clients: ClientResponse[];
}) {
  const { t } = useTranslation();
  const error = form.formState.errors.clientId;
  const items = clients.map((client) => ({ value: client.id, label: client.tradeName }));
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('projects.form.client')}</FieldLabel>
      <Controller
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <Select
            items={items}
            value={field.value || null}
            onValueChange={(value) => field.onChange(value ?? '')}
          >
            <SelectTrigger onBlur={field.onBlur} ref={field.ref}>
              <SelectValue placeholder={t('projects.form.clientPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  <span className="flex items-center gap-2">
                    <Avatar name={client.tradeName} shape="square" size="sm" />
                    {client.tradeName}
                    {client.status !== 'active' && <ClientStatusBadge status={client.status} />}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FieldDescription>{t('projects.form.clientHint')}</FieldDescription>
      <FieldError match={!!error}>{t('projects.form.errors.client')}</FieldError>
    </Field>
  );
}

export function NameField({ form }: { form: RetainerFormMethods }) {
  const { t } = useTranslation();
  const error = form.formState.errors.name;
  return (
    <Field invalid={!!error}>
      <FieldLabel>{t('retainers.form.name')}</FieldLabel>
      <Input
        autoComplete="off"
        placeholder={t('retainers.form.namePlaceholder')}
        {...form.register('name')}
      />
      <FieldError match={!!error}>{fieldError(error, t('projects.form.errors.name'))}</FieldError>
    </Field>
  );
}

export function DepartmentsField({ form }: { form: RetainerFormMethods }) {
  const { t } = useTranslation();
  const id = useId();
  const departments = useQuery(departmentListQuery);
  const error = form.formState.errors.departments;
  const items = (departments.data?.items ?? []).map(({ code, name }) => ({ code, name }));
  const byCode = new Map(items.map((item) => [item.code, item]));
  return (
    <Field invalid={!!error}>
      <FieldLabel htmlFor={id}>{t('projects.form.departments')}</FieldLabel>
      <Controller
        control={form.control}
        name="departments"
        render={({ field }) => (
          <MultiCombobox
            id={id}
            items={items}
            value={(field.value ?? []).flatMap((code) => byCode.get(code) ?? [])}
            onValueChange={(next) => field.onChange(next.map((item) => item.code))}
            itemToLabel={(item) => item.name}
            itemToKey={(item) => item.code}
            placeholder={t('projects.form.departmentsPlaceholder')}
            emptyLabel={t('common.noMatches')}
            removeLabel={(label) => t('common.remove', { label })}
            invalid={!!error}
          />
        )}
      />
      <FieldDescription>{t('projects.form.departmentsHint')}</FieldDescription>
      <FieldError match={!!error}>{t('projects.form.errors.departments')}</FieldError>
    </Field>
  );
}

/** Start and renewal dates side by side. The start date is locked once a cycle exists. */
export function DatesFields({
  form,
  startLocked = false,
}: {
  form: RetainerFormMethods;
  startLocked?: boolean;
}) {
  const { t } = useTranslation();
  const start = useWatch({ control: form.control, name: 'startDate' });
  const startError = form.formState.errors.startDate;
  const renewalError = form.formState.errors.renewalDate;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field invalid={!!startError}>
        <FieldLabel>{t('retainers.form.startDate')}</FieldLabel>
        <Input type="date" disabled={startLocked} {...form.register('startDate')} />
        <FieldDescription>
          {startLocked ? t('retainers.form.startLocked') : t('retainers.form.startHint')}
        </FieldDescription>
        <FieldError match={!!startError}>
          {fieldError(startError, t('projects.form.errors.date'))}
        </FieldError>
      </Field>
      <Field invalid={!!renewalError}>
        <FieldLabel>
          {t('retainers.form.renewalDate')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </FieldLabel>
        <Input
          type="date"
          min={start || undefined}
          {...form.register('renewalDate', { setValueAs: (value: string | null) => value || null })}
        />
        <FieldDescription>{t('retainers.form.renewalHint')}</FieldDescription>
        <FieldError match={!!renewalError}>
          {fieldError(renewalError, t('projects.form.errors.date'))}
        </FieldError>
      </Field>
    </div>
  );
}

/** The fee and every extra work estimate on the retainer use this currency (M2). */
export function MoneyFields({
  form,
  currencyLocked = false,
}: {
  form: RetainerFormMethods;
  currencyLocked?: boolean;
}) {
  const { t } = useTranslation();
  const ids = { currency: useId(), fee: useId() };
  const currency = useWatch({ control: form.control, name: 'currency' }) ?? 'USD';
  const error = form.formState.errors.currency;
  return (
    <div className="flex flex-col gap-5">
      <Field invalid={!!error}>
        <FieldLabel id={ids.currency} render={<span />}>
          {t('projects.form.currency')}
        </FieldLabel>
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <ToggleGroup
              aria-labelledby={ids.currency}
              value={[field.value ?? 'USD']}
              disabled={currencyLocked}
              onValueChange={(next: Currency[]) => {
                if (next[0]) field.onChange(next[0]);
              }}
            >
              {CURRENCIES.map((code) => (
                <ToggleGroupItem key={code} value={code}>
                  <Badge tone="outline" className="h-5 px-1.5">
                    {code}
                  </Badge>
                  {t(`projects.currencies.${code}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        />
        <FieldDescription>
          {currencyLocked ? t('projects.form.currencyLocked') : t('retainers.form.currencyHint')}
        </FieldDescription>
        <FieldError match={!!error}>{fieldError(error, t('errors.CURRENCY_LOCKED'))}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={ids.fee}>
          {t('retainers.form.monthlyFee')}
          <span className="ms-1 font-normal text-muted-foreground">({t('common.optional')})</span>
        </FieldLabel>
        <Controller
          control={form.control}
          name="monthlyFeeMinor"
          render={({ field }) => (
            <MoneyInput
              id={ids.fee}
              currency={currency}
              value={field.value}
              onValueChange={field.onChange}
              onBlur={field.onBlur}
            />
          )}
        />
        <FieldDescription>{t('retainers.form.monthlyFeeHint')}</FieldDescription>
      </Field>
    </div>
  );
}

/**
 * The lines a form holds under `deliverables`: the new retainer's form, and the dialog that edits
 * an existing retainer's lines (with their ids).
 */
export interface DeliverablesFormValues {
  deliverables: DeliverableLineInput[];
}

export type DeliverablesFormMethods = UseFormReturn<DeliverablesFormValues>;

/**
 * Checks the lines dialog against the contract (`retainerDeliverablesSchema`), putting each
 * problem on its row; returns the lines to send, or null. `onOther` receives a problem no row
 * shows (too many lines), so the dialog never fails without a message.
 */
export function parseLines(
  form: DeliverablesFormMethods,
  lines: DeliverableLineInput[],
  onOther: () => void,
): RetainerDeliverables['lines'] | null {
  const result = retainerDeliverablesSchema.safeParse({ lines });
  if (result.success) return result.data.lines;
  let placed = true;
  for (const issue of result.error.issues) {
    const [, index, field] = issue.path;
    if (
      typeof index === 'number' &&
      (field === 'label' || field === 'monthlyQuantity' || field === 'revisionLimit')
    ) {
      form.setError(`deliverables.${index}.${field}`, {
        type: SCREEN_ERROR,
        message: '',
      });
    } else {
      placed = false;
    }
  }
  if (!placed) onOther();
  return null;
}

/** Marks lines that repeat an earlier one's kind and name (`DUPLICATE_DELIVERABLE`). */
export function checkDuplicateLines(
  form: DeliverablesFormMethods,
  t: TFunction,
  lines: readonly { kind: DeliverableKind; label?: string | null }[],
): boolean {
  const repeated = new Set(duplicateDeliverables(lines));
  lines.forEach((line, index) => {
    if (repeated.has(line)) {
      form.setError(`deliverables.${index}.label`, {
        type: SCREEN_ERROR,
        message: t('retainers.lines.errors.duplicate'),
      });
    }
  });
  return repeated.size === 0;
}

/**
 * The retainer's standing lines: a kind (with its icon), an optional name (required for
 * "other"), a monthly quantity and an optional revision limit for the line's generated tasks
 * (empty: the template step's), in display order. New lines start from the kind chips.
 */
export function DeliverablesEditor({ form }: { form: DeliverablesFormMethods }) {
  const { t } = useTranslation();
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: 'deliverables',
  });
  const lines = useWatch({ control: form.control, name: 'deliverables' }) ?? [];
  const full = fields.length >= RETAINER_LIMITS.deliverables;
  const total = lines.reduce((sum, line) => sum + (Number(line?.monthlyQuantity) || 0), 0);
  const add = (kind: DeliverableKind) => append({ kind, label: null, monthlyQuantity: 1 });

  return (
    <div className="flex flex-col gap-4">
      {fields.length === 0 ? (
        <Callout
          icon={<ListPlusIcon />}
          title={t('retainers.lines.emptyTitle')}
          description={t('retainers.lines.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-3 px-3 text-xs text-muted-foreground"
          >
            <span>{t('retainers.lines.name')}</span>
            <span>{t('retainers.lines.columns.quantity')}</span>
            <span>{t('retainers.lines.columns.revisionLimit')}</span>
          </div>
          <ul aria-label={t('retainers.lines.title')} className="flex flex-col gap-3">
            {fields.map((row, index) => {
              const errors = form.formState.errors.deliverables?.[index];
              const kind = lines[index]?.kind ?? row.kind;
              const position = index + 1;
              const name = lineName(t, { kind });
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-1">
                    <span className="me-1 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <DeliverableIcon kind={kind} />
                    </span>
                    <span className="flex-1 text-sm font-medium">{name}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={t('projects.milestones.moveUp')}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === fields.length - 1}
                      aria-label={t('projects.milestones.moveDown')}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('retainers.lines.remove', { name })}
                      onClick={() => remove(index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-start gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Input
                        aria-label={t('retainers.lines.label', { position })}
                        aria-invalid={!!errors?.label || undefined}
                        autoComplete="off"
                        placeholder={
                          kind === 'other'
                            ? t('retainers.lines.labelRequired')
                            : t('retainers.lines.labelPlaceholder', { kind: name })
                        }
                        {...form.register(`deliverables.${index}.label`, {
                          setValueAs: (value: string | null) => value?.trim() || null,
                        })}
                      />
                      {errors?.label && (
                        <p className="text-sm text-destructive-text">
                          {fieldError(errors.label, t('retainers.lines.errors.label'))}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={999}
                        aria-label={t('retainers.lines.quantity', { position })}
                        aria-invalid={!!errors?.monthlyQuantity || undefined}
                        className="text-end tabular-nums"
                        {...form.register(`deliverables.${index}.monthlyQuantity`, {
                          valueAsNumber: true,
                        })}
                      />
                      {errors?.monthlyQuantity && (
                        <p className="text-sm text-destructive-text">
                          {t('retainers.lines.errors.quantity')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={RETAINER_LIMITS.revisionLimit}
                        aria-label={t('retainers.lines.revisionLimit', { position })}
                        aria-invalid={!!errors?.revisionLimit || undefined}
                        placeholder={t('retainers.lines.revisionLimitPlaceholder')}
                        title={t('retainers.lines.revisionLimitHint')}
                        className="text-end tabular-nums"
                        {...form.register(`deliverables.${index}.revisionLimit`, {
                          setValueAs: (value: string | number | null | undefined) =>
                            value === '' || value === null || value === undefined
                              ? null
                              : Number(value),
                        })}
                      />
                      {errors?.revisionLimit && (
                        <p className="text-sm text-destructive-text">
                          {t('retainers.lines.errors.revisionLimit', {
                            max: formatNumber(RETAINER_LIMITS.revisionLimit),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('retainers.lines.addHint')}</p>
        <div className="flex flex-wrap gap-2">
          {DELIVERABLE_KINDS.map((kind) => (
            <Button
              key={kind}
              variant="outline"
              size="sm"
              disabled={full}
              onClick={() => add(kind)}
            >
              <PlusIcon />
              <DeliverableIcon kind={kind} />
              {t(`retainers.kinds.${kind}`)}
            </Button>
          ))}
        </div>
      </div>
      {fields.length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">{t('retainers.lines.total')} </span>
          <span className="font-bold tabular-nums">{formatNumber(total)}</span>
        </p>
      )}
      {full && (
        <p className="text-sm text-muted-foreground">
          {t('retainers.lines.limit', { max: formatNumber(RETAINER_LIMITS.deliverables) })}
        </p>
      )}
    </div>
  );
}
