import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  CURRENCIES,
  type Currency,
  createProjectExpenseSchema,
  type ProjectExpense,
  updateProjectExpenseSchema,
} from '@vertex-hub/contracts';
import { Field, FieldError, FieldLabel, Input, Textarea, toast } from '@vertex-hub/ui';
import { type ComponentProps, useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { errorMessage } from '../../lib/errors';
import { rateInput, rateText } from '../../lib/money';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import { RateHint, validRate } from './invoice-dialogs';
import { invoiceSettingsQuery, useCreateExpense, useUpdateExpense } from './invoices.queries';

type Issue = { path: PropertyKey[] };

interface ExpenseValues {
  spentOn: string;
  description: string;
  amountMinor: number | null;
  currency: Currency;
  sypPerUsd: string;
  note: string;
}

/**
 * Rule 26: a direct cost of the project, dated today or earlier, at its own rate (ADR 0006). A new
 * expense starts in the project's currency at the current rate; editing keeps the expense's own.
 */
export function ExpenseDialog({
  projectId,
  projectCurrency,
  expense,
  open,
  onClose,
  finalFocus,
}: {
  projectId: string;
  projectCurrency: Currency;
  /** The expense to edit; none adds one. */
  expense?: ProjectExpense;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes: the button that opened it, or a fallback. */
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const ids = { amount: useId(), currency: useId() };
  const settings = useQuery({ ...invoiceSettingsQuery, enabled: open });
  const create = useCreateExpense(projectId);
  const update = useUpdateExpense(projectId);
  const today = businessDate();
  const defaults: ExpenseValues = expense
    ? {
        spentOn: expense.spentOn,
        description: expense.description,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        sypPerUsd: rateText(expense.sypPerUsd),
        note: expense.note ?? '',
      }
    : {
        spentOn: today,
        description: '',
        amountMinor: null,
        currency: projectCurrency,
        sypPerUsd: rateText(settings.data?.sypPerUsd ?? null),
        note: '',
      };
  const form = useForm<ExpenseValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  // `isDirty` read during render: the form tracks it only for a component that reads it.
  const { errors, isDirty } = form.formState;
  const currency = form.watch('currency');

  // After the exit animation, so the fields do not change while the dialog fades.
  function closed() {
    setFailure(null);
    form.reset(defaults);
  }

  /** The values checked with the contract schema; the fields it refuses are marked. */
  function checked<T>(
    result: { success: true; data: T } | { success: false; error: { issues: Issue[] } },
  ): T | undefined {
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      form.setError(issue.path.join('.') as keyof ExpenseValues, { type: 'schema' });
    }
    return undefined;
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const input = {
      spentOn: values.spentOn,
      description: values.description,
      amountMinor: values.amountMinor ?? 0,
      currency: values.currency,
      // Arabic-Indic digits and the Arabic decimal mark are read as typed on an Arabic keyboard.
      sypPerUsd: rateInput(values.sypPerUsd),
      note: values.note.trim() || null,
    };
    try {
      if (expense) {
        // Nothing changed: close without a request or a "saved" toast.
        if (!isDirty) return onClose();
        const changes = checked(updateProjectExpenseSchema.safeParse(input));
        if (!changes) return;
        await update.mutateAsync({ expenseId: expense.id, ...changes });
        toast.add({ title: t('invoices.expenses.saved'), type: 'success' });
      } else {
        const created = checked(createProjectExpenseSchema.safeParse(input));
        if (!created) return;
        await create.mutateAsync(created);
        toast.add({ title: t('invoices.expenses.added'), type: 'success' });
      }
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const currencyItems = CURRENCIES.map((code) => ({
    value: code,
    label: t(`invoices.currencies.${code}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={closed}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={expense ? t('invoices.expenses.editTitle') : t('invoices.expenses.addTitle')}
      description={t('invoices.expenses.hint')}
      action={expense ? t('common.save') : t('invoices.expenses.add')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.description}>
        <FieldLabel>{t('invoices.expenses.description')}</FieldLabel>
        <Input
          autoComplete="off"
          {...form.register('description', { validate: (text) => text.trim().length > 0 })}
        />
        <FieldError match={!!errors.description}>
          {t('invoices.expenses.errors.description')}
        </FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.spentOn}>
          <FieldLabel>{t('invoices.expenses.spentOn')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            max={today}
            {...form.register('spentOn', { validate: (day) => !!day && day <= today })}
          />
          <FieldError match={!!errors.spentOn}>{t('invoices.expenses.errors.spentOn')}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.currency} render={<span />}>
                {t('invoices.expenses.currency')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.currency}
                items={currencyItems}
                value={field.value}
                onChange={field.onChange}
              />
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="amountMinor"
          rules={{ validate: (minor) => !!minor && minor > 0 }}
          render={({ field }) => (
            <Field invalid={!!errors.amountMinor}>
              <FieldLabel htmlFor={ids.amount}>{t('invoices.expenses.amount')}</FieldLabel>
              <MoneyInput
                id={ids.amount}
                currency={currency}
                value={field.value}
                onValueChange={field.onChange}
              />
              <FieldError match={!!errors.amountMinor}>
                {t('invoices.expenses.errors.amount')}
              </FieldError>
            </Field>
          )}
        />
        <Field invalid={!!errors.sypPerUsd}>
          <FieldLabel>{t('invoices.rate.label')}</FieldLabel>
          <Input
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            {...form.register('sypPerUsd', { validate: (value) => validRate(rateInput(value)) })}
          />
          {!expense && <RateHint settings={settings.data} />}
          <FieldError match={!!errors.sypPerUsd}>{t('invoices.rate.invalid')}</FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('invoices.expenses.note')}</FieldLabel>
        <Textarea rows={2} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('invoices.expenses.errors.note')}</FieldError>
      </Field>
    </FormDialog>
  );
}
