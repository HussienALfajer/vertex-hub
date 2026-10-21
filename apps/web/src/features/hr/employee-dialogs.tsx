import { useQuery } from '@tanstack/react-query';
import {
  businessDate,
  CURRENCIES,
  type Currency,
  createSalaryChangeSchema,
  EMPLOYMENT_TYPES,
  type EmployeeFile,
  type EmploymentType,
  END_REASONS,
  type EndReason,
  endServiceSchema,
  fileDatesValid,
  PAYOUT_METHODS,
  type PayoutMethod,
  payoutSchema,
  type SalaryChange,
  updateEmployeeFileSchema,
  WEEKDAYS,
  type Weekday,
} from '@vertex-hub/contracts';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { type ComponentProps, useId, useState } from 'react';
import {
  Controller,
  type FieldValues,
  type Path,
  type UseFormReturn,
  useForm,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MoneyInput } from '../../components/money-input';
import { ApiError } from '../../lib/api/client';
import { can, useMe } from '../../lib/auth';
import { errorMessage, errorRole, fieldError, SCREEN_ERROR } from '../../lib/errors';
import { rateInput } from '../../lib/money';
import { ChoiceSelect } from '../quotes/choice-select';
import { FormDialog } from '../quotes/quote-dialogs';
import {
  useAddSalaryChange,
  useArchiveSalaryChange,
  useEndService,
  useSetPayout,
  useUpdateEmployeeFile,
  workSchedulesQuery,
} from './hr.queries';

interface DialogProps {
  file: EmployeeFile;
  open: boolean;
  onClose: () => void;
  /** Where the focus goes when it closes. */
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}

type Issue = { path: PropertyKey[] };

/** The values checked with the contract schema; the fields it refuses are marked. */
export function checked<T, V extends FieldValues>(
  form: UseFormReturn<V>,
  result: { success: true; data: T } | { success: false; error: { issues: Issue[] } },
): T | undefined {
  if (result.success) return result.data;
  for (const [index, issue] of result.error.issues.entries()) {
    form.setError(
      issue.path.join('.') as Path<V>,
      { type: 'schema' },
      { shouldFocus: index === 0 },
    );
  }
  return undefined;
}

const dateOrNull = (day: string) => day || null;

interface PersonalValues {
  nationalId: string;
  birthDate: string;
  address: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

/** The personal section, kept by HR (owner, 2026-10-21: employees do not edit it). */
export function PersonalDialog({ file, open, onClose, finalFocus }: DialogProps) {
  const { t } = useTranslation();
  const update = useUpdateEmployeeFile(file.userId);
  const personal = file.personal;
  const defaults: PersonalValues = {
    nationalId: personal?.nationalId ?? '',
    birthDate: personal?.birthDate ?? '',
    address: personal?.address ?? '',
    emergencyName: personal?.emergencyName ?? '',
    emergencyRelation: personal?.emergencyRelation ?? '',
    emergencyPhone: personal?.emergencyPhone ?? '',
  };
  const form = useForm<PersonalValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  // `isDirty` read during render: the form tracks it only for a component that reads it.
  const { errors, isDirty } = form.formState;
  const today = businessDate();

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return onClose();
    const input = checked(
      form,
      updateEmployeeFileSchema.safeParse({ ...values, birthDate: dateOrNull(values.birthDate) }),
    );
    if (!input) return;
    try {
      await update.mutateAsync(input);
      toast.add({ title: t('hr.file.saved'), type: 'success' });
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
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.personal.title')}
      description={t('hr.personal.hint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.nationalId}>
          <FieldLabel>{t('hr.fields.nationalId')}</FieldLabel>
          <Input dir="ltr" autoComplete="off" {...form.register('nationalId')} />
          <FieldError match={!!errors.nationalId}>{t('hr.personal.errors.tooLong')}</FieldError>
        </Field>
        <Field invalid={!!errors.birthDate}>
          <FieldLabel>{t('hr.fields.birthDate')}</FieldLabel>
          <Input type="date" dir="ltr" max={today} {...form.register('birthDate')} />
          <FieldError match={!!errors.birthDate}>{t('hr.personal.errors.date')}</FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.address}>
        <FieldLabel>{t('hr.fields.address')}</FieldLabel>
        <Textarea rows={2} {...form.register('address')} />
        <FieldError match={!!errors.address}>{t('hr.personal.errors.tooLong')}</FieldError>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field invalid={!!errors.emergencyName}>
          <FieldLabel>{t('hr.fields.emergencyName')}</FieldLabel>
          <Input autoComplete="off" {...form.register('emergencyName')} />
          <FieldError match={!!errors.emergencyName}>{t('hr.personal.errors.tooLong')}</FieldError>
        </Field>
        <Field invalid={!!errors.emergencyRelation}>
          <FieldLabel>{t('hr.fields.emergencyRelation')}</FieldLabel>
          <Input autoComplete="off" {...form.register('emergencyRelation')} />
          <FieldError match={!!errors.emergencyRelation}>
            {t('hr.personal.errors.tooLong')}
          </FieldError>
        </Field>
      </div>
      <Field invalid={!!errors.emergencyPhone}>
        <FieldLabel>{t('hr.fields.emergencyPhone')}</FieldLabel>
        <Input type="tel" dir="ltr" autoComplete="off" {...form.register('emergencyPhone')} />
        <FieldError match={!!errors.emergencyPhone}>{t('users.form.errors.phone')}</FieldError>
      </Field>
    </FormDialog>
  );
}

interface ContractValues {
  employmentType: EmploymentType;
  startDate: string;
  probationEndDate: string;
  contractEndDate: string;
  attendanceExempt: boolean;
  remoteWeekdays: Weekday[];
  annualLeaveDays: string;
  scheduleId: string;
}

/**
 * The contract and schedule section. The schedule is chosen among those of HR settings (rule B2),
 * listed for `hr.read`.
 */
export function ContractDialog({ file, open, onClose, finalFocus }: DialogProps) {
  const { t } = useTranslation();
  const me = useMe();
  const ids = { type: useId(), exempt: useId(), remote: useId(), schedule: useId() };
  const update = useUpdateEmployeeFile(file.userId);
  const schedules = useQuery({ ...workSchedulesQuery, enabled: open && can(me, 'hr.read') });
  const employment = file.employment;
  const defaults: ContractValues = {
    employmentType: employment?.employmentType ?? 'full_time',
    startDate: employment?.startDate ?? '',
    probationEndDate: employment?.probationEndDate ?? '',
    contractEndDate: employment?.contractEndDate ?? '',
    attendanceExempt: employment?.attendanceExempt ?? false,
    remoteWeekdays: employment?.remoteWeekdays ?? [],
    annualLeaveDays: String(employment?.annualLeaveDays ?? ''),
    scheduleId: employment?.schedule.id ?? '',
  };
  const form = useForm<ContractValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  // `isDirty` read during render: the form tracks it only for a component that reads it.
  const { errors, isDirty } = form.formState;
  const startDate = form.watch('startDate');

  /** Rule A1: probation and contract end on or after the start date. */
  function markDates() {
    form.setError(
      'probationEndDate',
      { type: SCREEN_ERROR, message: t('hr.contract.errors.order') },
      { shouldFocus: true },
    );
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return onClose();
    const dates = {
      startDate: dateOrNull(values.startDate),
      probationEndDate: dateOrNull(values.probationEndDate),
      contractEndDate: dateOrNull(values.contractEndDate),
    };
    if (!fileDatesValid(dates)) return markDates();
    const input = checked(
      form,
      updateEmployeeFileSchema.safeParse({
        ...dates,
        employmentType: values.employmentType,
        attendanceExempt: values.attendanceExempt,
        remoteWeekdays: values.remoteWeekdays,
        // Arabic-Indic digits and the Arabic decimal mark are read as typed on an Arabic keyboard.
        annualLeaveDays: Number(rateInput(values.annualLeaveDays)),
        scheduleId: values.scheduleId || undefined,
      }),
    );
    if (!input) return;
    try {
      await update.mutateAsync(input);
      toast.add({ title: t('hr.file.saved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DATES') markDates();
      else setFailure(errorMessage(t, error));
    }
  });

  const typeItems = EMPLOYMENT_TYPES.map((type) => ({
    value: type,
    label: t(`hr.employmentTypes.${type}`),
  }));
  const scheduleItems = (schedules.data?.items ?? []).map((schedule) => ({
    value: schedule.id,
    label: schedule.isDefault
      ? t('hr.contract.defaultSchedule', { name: schedule.name })
      : schedule.name,
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.contract.title')}
      description={t('hr.contract.hint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Controller
        control={form.control}
        name="employmentType"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.type} render={<span />}>
              {t('hr.fields.employmentType')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={ids.type}
              items={typeItems}
              value={field.value}
              onChange={field.onChange}
            />
          </Field>
        )}
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <Field>
          <FieldLabel>{t('hr.fields.startDate')}</FieldLabel>
          <Input type="date" dir="ltr" {...form.register('startDate')} />
        </Field>
        <Field invalid={!!errors.probationEndDate}>
          <FieldLabel>{t('hr.fields.probationEndDate')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            min={startDate || undefined}
            {...form.register('probationEndDate')}
          />
          <FieldError match={!!errors.probationEndDate} role={errorRole(errors.probationEndDate)}>
            {fieldError(errors.probationEndDate, t('hr.contract.errors.order'))}
          </FieldError>
        </Field>
        <Field invalid={!!errors.contractEndDate}>
          <FieldLabel>{t('hr.fields.contractEndDate')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            min={startDate || undefined}
            {...form.register('contractEndDate')}
          />
          <FieldDescription>{t('hr.contract.openEndedHint')}</FieldDescription>
        </Field>
      </div>
      {scheduleItems.length > 0 && (
        <Controller
          control={form.control}
          name="scheduleId"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.schedule} render={<span />}>
                {t('hr.fields.schedule')}
              </FieldLabel>
              <ChoiceSelect
                labelledBy={ids.schedule}
                items={scheduleItems}
                value={field.value}
                onChange={field.onChange}
              />
              <FieldDescription>{t('hr.contract.scheduleHint')}</FieldDescription>
            </Field>
          )}
        />
      )}
      <Field invalid={!!errors.annualLeaveDays}>
        <FieldLabel>{t('hr.fields.annualLeaveDays')}</FieldLabel>
        <Input
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          {...form.register('annualLeaveDays', { validate: (text) => text.trim().length > 0 })}
        />
        <FieldError match={!!errors.annualLeaveDays}>
          {t('hr.contract.errors.leaveDays')}
        </FieldError>
      </Field>
      <Controller
        control={form.control}
        name="remoteWeekdays"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.remote} render={<span />}>
              {t('hr.fields.remoteWeekdays')}
            </FieldLabel>
            <ToggleGroup
              aria-labelledby={ids.remote}
              multiple
              value={field.value}
              onValueChange={(next: Weekday[]) => field.onChange(next)}
              className="flex-wrap"
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem key={day} value={day}>
                  {t(`hr.weekdays.${day}`)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>{t('hr.contract.remoteHint')}</FieldDescription>
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="attendanceExempt"
        render={({ field }) => (
          <Field>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor={ids.exempt}>{t('hr.fields.attendanceExempt')}</FieldLabel>
              <Switch id={ids.exempt} checked={field.value} onCheckedChange={field.onChange} />
            </div>
            <FieldDescription>{t('hr.contract.exemptHint')}</FieldDescription>
          </Field>
        )}
      />
    </FormDialog>
  );
}

interface PayoutValues {
  method: PayoutMethod | null;
  institution: string;
  account: string;
  holder: string;
}

/** Rule A5: the details are required for a transfer or a wallet and cleared for cash. */
export function PayoutDialog({ file, open, onClose, finalFocus }: DialogProps) {
  const { t } = useTranslation();
  const ids = { method: useId() };
  const setPayout = useSetPayout(file.userId);
  const pay = file.pay;
  const defaults: PayoutValues = {
    method: pay?.payoutMethod ?? null,
    institution: pay?.payoutInstitution ?? '',
    account: pay?.payoutAccount ?? '',
    holder: pay?.payoutHolder ?? '',
  };
  const form = useForm<PayoutValues>({ values: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  // `isDirty` read during render: the form tracks it only for a component that reads it.
  const { errors, isDirty } = form.formState;
  const method = form.watch('method');
  const details = method === 'bank_transfer' || method === 'mobile_wallet';

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    // Nothing changed: close without a request or a "saved" toast.
    if (!isDirty) return onClose();
    const input = checked(form, payoutSchema.safeParse(values));
    if (!input) return;
    try {
      await setPayout.mutateAsync(input);
      toast.add({ title: t('hr.pay.saved'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  const methodItems = PAYOUT_METHODS.map((value) => ({
    value,
    label: t(`hr.payoutMethods.${value}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.pay.payoutTitle')}
      description={t('hr.pay.payoutHint')}
      action={t('common.save')}
      failure={failure}
      onSubmit={submit}
    >
      <Controller
        control={form.control}
        name="method"
        render={({ field }) => (
          <Field>
            <FieldLabel id={ids.method} render={<span />}>
              {t('hr.fields.payoutMethod')}
            </FieldLabel>
            <ChoiceSelect
              labelledBy={ids.method}
              items={methodItems}
              value={field.value}
              onChange={field.onChange}
              placeholder={t('hr.pay.chooseMethod')}
            />
          </Field>
        )}
      />
      {method && details && (
        <>
          <Field invalid={!!errors.institution}>
            <FieldLabel>{t(`hr.payoutInstitution.${method}`)}</FieldLabel>
            <Input autoComplete="off" {...form.register('institution')} />
            <FieldError match={!!errors.institution}>{t('hr.pay.errors.required')}</FieldError>
          </Field>
          <Field invalid={!!errors.account}>
            <FieldLabel>{t(`hr.payoutAccount.${method}`)}</FieldLabel>
            <Input dir="ltr" autoComplete="off" {...form.register('account')} />
            <FieldError match={!!errors.account}>{t('hr.pay.errors.required')}</FieldError>
          </Field>
          <Field invalid={!!errors.holder}>
            <FieldLabel>{t('hr.fields.payoutHolder')}</FieldLabel>
            <Input autoComplete="off" {...form.register('holder')} />
            <FieldError match={!!errors.holder}>{t('hr.pay.errors.required')}</FieldError>
          </Field>
        </>
      )}
    </FormDialog>
  );
}

interface SalaryValues {
  effectiveOn: string;
  amountMinor: number | null;
  currency: Currency;
  reason: string;
}

/** Rule A4: a monthly fixed salary from a date; added, never edited. */
export function SalaryDialog({
  userId,
  open,
  onClose,
  finalFocus,
}: Omit<DialogProps, 'file'> & { userId: string }) {
  const { t } = useTranslation();
  const ids = { amount: useId(), currency: useId() };
  const add = useAddSalaryChange(userId);
  const defaults: SalaryValues = {
    effectiveOn: businessDate(),
    amountMinor: null,
    currency: 'USD',
    reason: '',
  };
  const form = useForm<SalaryValues>({ defaultValues: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;
  const currency = form.watch('currency');

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const input = checked(
      form,
      createSalaryChangeSchema.safeParse({ ...values, amountMinor: values.amountMinor ?? 0 }),
    );
    if (!input) return;
    try {
      await add.mutateAsync(input);
      toast.add({ title: t('hr.salary.added'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'DUPLICATE_EFFECTIVE_DATE') {
        form.setError(
          'effectiveOn',
          { type: SCREEN_ERROR, message: errorMessage(t, error) },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
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
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.salary.addTitle')}
      description={t('hr.salary.addHint')}
      action={t('hr.salary.add')}
      failure={failure}
      onSubmit={submit}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Controller
          control={form.control}
          name="currency"
          render={({ field }) => (
            <Field>
              <FieldLabel id={ids.currency} render={<span />}>
                {t('hr.salary.currency')}
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
              <FieldLabel htmlFor={ids.amount}>{t('hr.salary.amount')}</FieldLabel>
              <MoneyInput
                id={ids.amount}
                currency={currency}
                value={field.value}
                onValueChange={field.onChange}
              />
              <FieldError match={!!errors.amountMinor}>{t('hr.salary.errors.amount')}</FieldError>
            </Field>
          )}
        />
      </div>
      <Field invalid={!!errors.effectiveOn}>
        <FieldLabel>{t('hr.salary.effectiveOn')}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          {...form.register('effectiveOn', { validate: (day) => !!day })}
        />
        <FieldError match={!!errors.effectiveOn} role={errorRole(errors.effectiveOn)}>
          {fieldError(errors.effectiveOn, t('hr.salary.errors.effectiveOn'))}
        </FieldError>
      </Field>
      <Field invalid={!!errors.reason}>
        <FieldLabel>{t('hr.salary.reason')}</FieldLabel>
        <Input
          autoComplete="off"
          placeholder={t('hr.salary.reasonPlaceholder')}
          {...form.register('reason', { validate: (text) => text.trim().length > 0 })}
        />
        <FieldError match={!!errors.reason}>{t('hr.salary.errors.reason')}</FieldError>
      </Field>
    </FormDialog>
  );
}

/** Rule A4: a wrong entry is archived with its reason, never edited. */
export function ArchiveSalaryDialog({
  change,
  onClose,
  finalFocus,
}: {
  /** The change to archive; none keeps the dialog closed. */
  change: SalaryChange | null;
  onClose: () => void;
  finalFocus: ComponentProps<typeof FormDialog>['finalFocus'];
}) {
  const { t } = useTranslation();
  const archive = useArchiveSalaryChange();
  const form = useForm<{ reason: string }>({ defaultValues: { reason: '' } });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async ({ reason }) => {
    if (!change) return;
    setFailure(null);
    try {
      await archive.mutateAsync({ id: change.id, reason: reason.trim() });
      toast.add({ title: t('hr.salary.archivedToast'), type: 'success' });
      onClose();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <FormDialog
      open={change !== null}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset({ reason: '' });
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.salary.archiveTitle')}
      description={t('hr.salary.archiveHint')}
      action={t('hr.salary.archive')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.reason}>
        <FieldLabel>{t('hr.salary.archiveReason')}</FieldLabel>
        <Textarea
          rows={2}
          {...form.register('reason', {
            validate: (text) => text.trim().length > 0 && text.trim().length <= 200,
          })}
        />
        <FieldError match={!!errors.reason}>{t('hr.salary.errors.reason')}</FieldError>
      </Field>
    </FormDialog>
  );
}

interface EndValues {
  endedOn: string;
  reason: EndReason | null;
  note: string;
}

/** Rule A8: the last working day, today or later; the account is archived the day after. */
export function EndServiceDialog({ file, open, onClose, finalFocus }: DialogProps) {
  const { t } = useTranslation();
  const ids = { reason: useId() };
  const end = useEndService(file.userId);
  const today = businessDate();
  const defaults: EndValues = { endedOn: today, reason: null, note: '' };
  const form = useForm<EndValues>({ defaultValues: defaults });
  const [failure, setFailure] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const input = checked(
      form,
      endServiceSchema.safeParse({
        endedOn: values.endedOn,
        reason: values.reason,
        note: values.note,
      }),
    );
    if (!input) return;
    try {
      await end.mutateAsync(input);
      toast.add({ title: t('hr.end.saved'), type: 'success' });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INVALID_DATES') {
        form.setError(
          'endedOn',
          { type: SCREEN_ERROR, message: t('hr.end.errors.date') },
          { shouldFocus: true },
        );
      } else {
        setFailure(errorMessage(t, error));
      }
    }
  });

  const reasonItems = END_REASONS.map((reason) => ({
    value: reason,
    label: t(`hr.endReasons.${reason}`),
  }));

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onClosed={() => {
        setFailure(null);
        form.reset(defaults);
      }}
      finalFocus={finalFocus}
      submitting={form.formState.isSubmitting}
      title={t('hr.end.title', { name: file.name })}
      description={t('hr.end.hint')}
      action={t('hr.end.action')}
      failure={failure}
      onSubmit={submit}
    >
      <Field invalid={!!errors.endedOn}>
        <FieldLabel>{t('hr.end.endedOn')}</FieldLabel>
        <Input
          type="date"
          dir="ltr"
          min={today}
          {...form.register('endedOn', { validate: (day) => !!day && day >= today })}
        />
        <FieldError match={!!errors.endedOn} role={errorRole(errors.endedOn)}>
          {fieldError(errors.endedOn, t('hr.end.errors.date'))}
        </FieldError>
      </Field>
      <Controller
        control={form.control}
        name="reason"
        rules={{ validate: (reason) => reason !== null }}
        render={({ field }) => (
          <Field invalid={!!errors.reason}>
            <FieldLabel id={ids.reason} render={<span />}>
              {t('hr.end.reason')}
            </FieldLabel>
            <ChoiceSelect
              ref={field.ref}
              labelledBy={ids.reason}
              items={reasonItems}
              value={field.value}
              onChange={field.onChange}
              placeholder={t('hr.end.chooseReason')}
            />
            <FieldError match={!!errors.reason}>{t('hr.end.errors.reason')}</FieldError>
          </Field>
        )}
      />
      <Field invalid={!!errors.note}>
        <FieldLabel>{t('hr.end.note')}</FieldLabel>
        <Textarea rows={2} {...form.register('note')} />
        <FieldError match={!!errors.note}>{t('hr.personal.errors.tooLong')}</FieldError>
      </Field>
    </FormDialog>
  );
}
